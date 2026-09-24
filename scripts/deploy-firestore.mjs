/**
 * 直接以 REST API 發布 Firestore 安全規則與索引。
 *
 * 為什麼不用 `firebase deploy`：
 * firebase-tools 在部署前一定會呼叫 serviceusage 檢查 API 是否啟用
 * （src/deploy/firestore/prepare.ts 的 ensure()，在判斷 --only 之前就執行，
 * 且沒有環境變數可以跳過）。該呼叫需要 `serviceusage.services.get` 權限，
 * Firebase 產生的服務帳戶預設沒有，於是 CI 會以 403 失敗。
 *
 * 這支腳本改為直接呼叫：
 *   - Firebase Rules API   → 建立 ruleset 並切換 release（需 firebaserules.admin）
 *   - Firestore Admin API  → 建立索引（需 datastore.indexAdmin；已存在則略過）
 *
 * 沒有任何 npm 相依：JWT 用 node:crypto 自行簽章。
 *
 * 用法：GOOGLE_APPLICATION_CREDENTIALS=/path/sa.json node scripts/deploy-firestore.mjs
 */
import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

const die = (message) => {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
};

/** 以服務帳戶金鑰換取存取權杖（JWT Bearer flow） */
async function accessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: credentials.client_email,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const b64 = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${b64(header)}.${b64(claims)}`;
  const signature = createSign('RSA-SHA256')
    .update(unsigned)
    .sign(credentials.private_key, 'base64url');

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    die(`取得存取權杖失敗（${response.status}）：${JSON.stringify(body)}`);
  }
  return body.access_token;
}

async function api(token, url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  return { ok: response.ok, status: response.status, body };
}

/** 發布安全規則：建立 ruleset → 將 cloud.firestore 這個 release 指向它 */
async function deployRules(token, projectId, source) {
  const created = await api(
    token,
    `https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`,
    {
      method: 'POST',
      body: JSON.stringify({
        source: { files: [{ name: 'firestore.rules', content: source }] },
      }),
    },
  );
  if (!created.ok) {
    die(
      `建立 ruleset 失敗（${created.status}）：${JSON.stringify(created.body)}\n` +
        '若為權限不足，請在 Google Cloud Console → IAM 給這個服務帳戶\n' +
        '「Firebase Rules Admin」（roles/firebaserules.admin）角色。',
    );
  }
  const rulesetName = created.body.name;
  const releaseName = `projects/${projectId}/releases/cloud.firestore`;

  // release 已存在就用 PATCH 更新，不存在才 POST 建立
  const patched = await api(
    token,
    `https://firebaserules.googleapis.com/v1/${releaseName}`,
    { method: 'PATCH', body: JSON.stringify({ release: { name: releaseName, rulesetName } }) },
  );
  if (patched.ok) return rulesetName;

  const posted = await api(
    token,
    `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases`,
    { method: 'POST', body: JSON.stringify({ name: releaseName, rulesetName }) },
  );
  if (!posted.ok) {
    die(
      `切換 release 失敗（${posted.status}）：${JSON.stringify(posted.body)}`,
    );
  }
  return rulesetName;
}

/**
 * 建立複合索引；已存在（409）視為成功。
 *
 * 權限不足（403）不讓整個流程失敗：規則已經發布成功，索引是獨立的一件事，
 * 而且多半在初次設定時就手動建好了。改為回報並提示要補哪個角色。
 */
async function deployIndexes(token, projectId, indexes) {
  const base =
    `https://firestore.googleapis.com/v1/projects/${projectId}` +
    '/databases/(default)/collectionGroups';
  let created = 0;
  let existing = 0;
  let denied = 0;

  for (const index of indexes) {
    const { collectionGroup, queryScope = 'COLLECTION', fields } = index;
    const result = await api(
      token,
      `${base}/${collectionGroup}/indexes`,
      { method: 'POST', body: JSON.stringify({ queryScope, fields }) },
    );
    if (result.ok) {
      created += 1;
      continue;
    }
    const message = JSON.stringify(result.body);
    if (result.status === 409 || /already exists/i.test(message)) {
      existing += 1;
      continue;
    }
    if (result.status === 403) {
      denied += 1;
      continue;
    }
    // 400 等錯誤代表索引定義本身有問題，那是該修的設定，照樣中止
    die(
      `建立索引失敗（${collectionGroup}，${result.status}）：${message}`,
    );
  }
  return { created, existing, denied };
}

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath) die('未設定 GOOGLE_APPLICATION_CREDENTIALS');

const raw = (await readFile(keyPath, 'utf8')).trim();
if (!raw.startsWith('{')) {
  // 常見誤貼：Firebase 主控台「服務帳戶」頁面上方的 Admin SDK 範例程式碼
  die(
    '金鑰內容不是 JSON。\n' +
      (/require\(|admin\.initializeApp|import /.test(raw)
        ? '看起來貼到的是「Admin SDK 設定程式碼片段」那段範例程式碼。\n'
        : '') +
      '請改貼「產生新的私密金鑰」下載的 .json 檔案內容，\n' +
      '內容以 { 開頭，並包含 "type": "service_account" 與 "private_key"。',
  );
}

let credentials;
try {
  credentials = JSON.parse(raw);
} catch (error) {
  die(`金鑰 JSON 無法解析：${error instanceof Error ? error.message : error}`);
}

for (const field of ['client_email', 'private_key']) {
  if (!credentials[field]) {
    die(
      `金鑰缺少必要欄位 "${field}"。請確認貼的是完整的服務帳戶 JSON 檔內容。`,
    );
  }
}
const projectId =
  process.env.FIREBASE_PROJECT_ID ||
  JSON.parse(await readFile(resolve(ROOT, '.firebaserc'), 'utf8')).projects
    .default;
if (!projectId) die('找不到專案 ID（.firebaserc 或 FIREBASE_PROJECT_ID）');

const rules = await readFile(resolve(ROOT, 'firestore.rules'), 'utf8');
const { indexes } = JSON.parse(
  await readFile(resolve(ROOT, 'firestore.indexes.json'), 'utf8'),
);

console.log(`=== 發布到 ${projectId} ===`);
const token = await accessToken(credentials);

const rulesetName = await deployRules(token, projectId, rules);
console.log(`✔ 安全規則已發布：${rulesetName}`);

const summary = await deployIndexes(token, projectId, indexes ?? []);
console.log(
  `✔ 索引：新建 ${summary.created} 筆、已存在 ${summary.existing} 筆` +
    (summary.denied ? `、無權限略過 ${summary.denied} 筆` : ''),
);

if (summary.denied) {
  console.log(
    '\n⚠ 規則已發布，但有索引因權限不足未建立。\n' +
      '  要讓索引也自動化，請在 Google Cloud Console → IAM 給這個服務帳戶\n' +
      '  「Cloud Datastore Index Admin」（roles/datastore.indexAdmin）角色；\n' +
      '  或依 docs/firebase-setup.md 在主控台手動建立索引（只需一次）。',
  );
}

// 給 GitHub Actions 的執行摘要（本機執行時 GITHUB_STEP_SUMMARY 不存在，自動略過）
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '## ✅ 安全規則已發布',
      '',
      `專案：\`${projectId}\``,
      `Ruleset：\`${rulesetName}\``,
      '',
      `索引：新建 ${summary.created} 筆、已存在 ${summary.existing} 筆` +
        (summary.denied
          ? `、**無權限略過 ${summary.denied} 筆**（需 roles/datastore.indexAdmin）`
          : ''),
      '',
    ].join('\n'),
  );
}
