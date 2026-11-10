import pw from '/opt/node-tools/node_modules/playwright/index.js';
import { mkdirSync } from 'node:fs';
import { openApp, nav, clickAt, moveTo, scrollTo, installCursor, BASE } from './lib.mjs';
const { chromium } = pw;

const OUT = new URL('./scenes/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const only = process.argv[2] ? new Set(process.argv.slice(2)) : null;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

const search = (page) => page.locator('input[placeholder*="1140101"]').first();
const submit = (page) => page.locator('button', { hasText: '登錄違規' }).last();

/**
 * 進入登錄畫面。
 * 注意：重新載入深層路由（#/admin/log）時，登入狀態的還原是非同步的，
 * 畫面會先被導回儀表板，因此一律改從導覽列點進去。
 */
async function gotoLog(page) {
  await openApp(page, '#/admin');
  await nav(page, '登錄違規');
  await page.waitForTimeout(500);
}

async function scene(name, fn) {
  if (only && !only.has(name)) return;
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'light',
    recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
    reducedMotion: 'no-preference',
  });
  const page = await ctx.newPage();
  const t0 = Date.now();
  try {
    await fn(page);
  } catch (error) {
    console.error(`✖ ${name}:`, error.message);
  }
  await page.waitForTimeout(700);
  const video = page.video();
  await ctx.close();
  await video.saveAs(`${OUT}${name}.webm`);
  console.log(`✔ ${name}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

/* 1. 登入 */
await scene('s01-login', async (page) => {
  await page.goto(BASE + '#/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1300);
  await installCursor(page);
  await page.waitForTimeout(900);
  await clickAt(page, page.locator('button').first(), { settle: 2000 });
  await page.waitForTimeout(1600);
});

/* 2. 儀表板 */
await scene('s02-dashboard', async (page) => {
  await openApp(page, '#/admin');
  await page.waitForTimeout(1600);
  await scrollTo(page, 420, { duration: 1500 });
  await page.waitForTimeout(1800);
  await scrollTo(page, 980, { duration: 1500 });
  await page.waitForTimeout(1800);
  await scrollTo(page, 1600, { duration: 1500 });
  await page.waitForTimeout(1800);
});

/* 3. 登錄：兩種找人方式 */
await scene('s03-log-find', async (page) => {
  await gotoLog(page);
  const box = search(page);
  await moveTo(page, box);
  await box.click();
  await box.type('小', { delay: 240 });
  await page.waitForTimeout(1200);
  await box.type('美', { delay: 240 });
  await page.waitForTimeout(2000);
  await box.fill('');
  await page.waitForTimeout(700);
  const cls = page.locator('.select--class');
  await moveTo(page, cls);
  await cls.selectOption('八年二班');
  await page.waitForTimeout(1000);
  const seat = page.locator('.select--seat');
  await moveTo(page, seat);
  await seat.selectOption({ index: 2 });
  await page.waitForTimeout(2200);
});

/* 4. 第一次＝只記錄勸導 */
await scene('s04-log-first', async (page) => {
  await gotoLog(page);
  const box = search(page);
  await moveTo(page, box);
  await box.click();
  await box.type('廖婉瑜', { delay: 160 });
  await page.waitForTimeout(1500);
  await clickAt(page, page.locator('.choice').first(), { settle: 600 });
  const place = page.locator('select').nth(2);
  await moveTo(page, place);
  await place.selectOption({ index: 1 });
  await page.waitForTimeout(800);
  await clickAt(page, submit(page), { settle: 1800 });
  await page.waitForTimeout(2600);
});

/* 5. 第二次＝發卡並凍結下課 */
await scene('s05-log-second', async (page) => {
  await gotoLog(page);
  // 先快速記下第一次（不入鏡重點），再示範第二次的差別
  const first = search(page);
  await first.click();
  await first.type('廖婉瑜', { delay: 40 });
  await page.waitForTimeout(700);
  await page.locator('.choice').first().click();
  await page.locator('select').nth(2).selectOption({ index: 1 });
  await submit(page).click();
  await page.waitForTimeout(1600);
  await clickAt(page, page.locator('button', { hasText: '繼續登錄下一件' }), { settle: 700 });
  const again = search(page);
  await moveTo(page, again);
  await again.click();
  await again.type('廖婉瑜', { delay: 160 });
  await page.waitForTimeout(1400);
  await clickAt(page, page.locator('.choice').first(), { settle: 500 });
  const place = page.locator('select').nth(2);
  await moveTo(page, place);
  await place.selectOption({ index: 2 });
  await page.waitForTimeout(700);
  await clickAt(page, submit(page), { settle: 1800 });
  await page.waitForTimeout(3000);
});

/* 6. 初犯名單 */
await scene('s06-first-offenders', async (page) => {
  await openApp(page, '#/admin');
  await nav(page, '初犯名單');
  await page.waitForTimeout(2200);
  await scrollTo(page, 420, { duration: 1400 });
  await page.waitForTimeout(2400);
});

/* 7. 待回收紙本 → 已回收 */
await scene('s07-cases', async (page) => {
  await openApp(page, '#/admin');
  await nav(page, '待回收紙本');
  await page.waitForTimeout(1600);
  await clickAt(page, page.locator('button', { hasText: '已回收' }).first(), { settle: 2200 });
  await page.waitForTimeout(2000);
});

/* 8. 再犯警示 */
await scene('s08-alerts', async (page) => {
  await openApp(page, '#/admin');
  await nav(page, '再犯警示');
  await page.waitForTimeout(1800);
  await clickAt(page, page.locator('button', { hasText: '依據' }).first(), { settle: 1500 });
  await page.waitForTimeout(2400);
});

/* 9. 安全觀察員值勤台 */
await scene('s09-observer', async (page) => {
  await openApp(page, '#/admin');
  await nav(page, '安全觀察員');
  await page.waitForTimeout(2000);
  await scrollTo(page, 380, { duration: 1300 });
  await page.waitForTimeout(2200);
});

/* 10. 下課管制名單 */
await scene('s10-restrictions', async (page) => {
  await openApp(page, '#/admin');
  await nav(page, '下課管制名單');
  await page.waitForTimeout(2600);
  await scrollTo(page, 300, { duration: 1200 });
  await page.waitForTimeout(1600);
});

/* 11. 學生查詢與歷程 */
await scene('s11-student', async (page) => {
  await openApp(page, '#/admin');
  await nav(page, '學生查詢');
  await page.waitForTimeout(800);
  const input = page.locator('input[placeholder*="1140101"]').first();
  await moveTo(page, input);
  await input.click();
  await input.type('八年二班', { delay: 150 });
  await page.waitForTimeout(1600);
  // 挑有紀錄的學生（1130205），否則歷程會是空的，看不出這頁的用處
  const row = page.locator('tr', { hasText: '1130205' }).first();
  await clickAt(page, row.locator('a', { hasText: '查看歷程' }).first(), { settle: 2000 });
  await scrollTo(page, 420, { duration: 1300 });
  await page.waitForTimeout(2000);
});

/* 12. 系統設定 */
await scene('s12-settings', async (page) => {
  await openApp(page, '#/admin');
  await nav(page, '系統設定');
  await page.waitForTimeout(1600);
  const preset = page.locator('button', { hasText: '一個月' }).first();
  await clickAt(page, preset, { settle: 1400 });
  await scrollTo(page, 760, { duration: 1400 });
  await page.waitForTimeout(2000);
  await scrollTo(page, 1500, { duration: 1400 });
  await page.waitForTimeout(2200);
  await scrollTo(page, 2400, { duration: 1500 });
  await page.waitForTimeout(2400);
});

/* 13. 帳號管理 */
await scene('s13-users', async (page) => {
  await openApp(page, '#/admin');
  await nav(page, '帳號管理');
  await page.waitForTimeout(2400);
  await scrollTo(page, 420, { duration: 1200 });
  await page.waitForTimeout(1800);
});

/* 14. 公開看板 */
await scene('s14-public', async (page) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  await installCursor(page);
  await scrollTo(page, 400, { duration: 1400 });
  await page.waitForTimeout(1800);
  await scrollTo(page, 900, { duration: 1400 });
  await page.waitForTimeout(2000);
});

await browser.close();
console.log('錄製完成');
