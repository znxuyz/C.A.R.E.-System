/** 標題卡：以 HTML 排版後截圖，沿用系統本身的視覺語言 */
import pw from '/opt/node-tools/node_modules/playwright/index.js';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = pw;

const OUT = new URL('./cards/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const shell = (body, { tone = 'light' } = {}) => `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><style>
  @font-face { font-family: 'WQY'; src: local('WenQuanYi Zen Hei'); }
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1920px; height: 1080px; display: grid; place-items: center;
    font-family: 'WenQuanYi Zen Hei', sans-serif;
    background: ${tone === 'dark' ? '#101828' : '#f4f5f3'};
    color: ${tone === 'dark' ? '#f8fafc' : '#0b0b0b'};
    position: relative; overflow: hidden;
  }
  body::before {
    content: ''; position: absolute; inset: -20%;
    background: radial-gradient(circle at 20% 15%, rgba(28,92,171,.16), transparent 42%),
                radial-gradient(circle at 82% 78%, rgba(235,104,52,.13), transparent 46%);
  }
  .wrap { position: relative; text-align: center; max-width: 1480px; padding: 0 80px; }
  .eyebrow { font-size: 30px; letter-spacing: .34em; color: #1c5cab; margin-bottom: 34px; font-weight: 700; }
  h1 { font-size: 112px; line-height: 1.16; letter-spacing: .01em; }
  h1 .hl { color: #1c5cab; }
  .sub { font-size: 40px; line-height: 1.6; margin-top: 40px; color: ${tone === 'dark' ? '#cbd5e1' : '#44443f'}; }
  .tiny { font-size: 26px; margin-top: 52px; color: #7b7a74; letter-spacing: .06em; }
  .rule { width: 132px; height: 7px; border-radius: 99px; background: #1c5cab; margin: 46px auto 0; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 34px; margin-top: 56px; text-align: left; }
  .item { background: ${tone === 'dark' ? 'rgba(255,255,255,.06)' : '#ffffff'};
          border: 1px solid ${tone === 'dark' ? 'rgba(255,255,255,.12)' : '#e2e3df'};
          border-radius: 22px; padding: 34px 38px; }
  .item b { display: block; font-size: 36px; margin-bottom: 12px; }
  .item span { font-size: 27px; line-height: 1.55; color: ${tone === 'dark' ? '#cbd5e1' : '#52514e'}; }
  .mark { width: 128px; height: 128px; border-radius: 30px; margin: 0 auto 44px;
          background: linear-gradient(135deg, #1c5cab, #3987e5); color: #fff;
          display: grid; place-items: center; font-size: 34px; font-weight: 700; letter-spacing: .08em; }
</style></head><body><div class="wrap">${body}</div></body></html>`;

const CARDS = {
  'c00-open': shell(`
    <div class="mark">CARE</div>
    <h1>C.A.R.E. <span class="hl">System</span></h1>
    <div class="sub">校園生活管教 —— 違規登錄與<strong>再犯追蹤</strong></div>
    <div class="tiny">Conduct Assessment &amp; Reflection Education System</div>`),
  'c01-problem': shell(`
    <div class="eyebrow">現場的難題</div>
    <h1>「他這是<span class="hl">第幾次</span>了？」</h1>
    <div class="sub">紙本反思卡照舊。<br>真正難的是：誰在 15 天內又犯了第幾次 —— 那不該用手算。</div>
    <div class="rule"></div>`),
  'c02-daily': shell(`
    <div class="eyebrow">PART 1</div>
    <h1>每日作業</h1>
    <div class="sub">登錄 → 發卡 → 回收 → 解除管制，現場 30 秒完成</div>`),
  'c03-followup': shell(`
    <div class="eyebrow">PART 2</div>
    <h1>追蹤輔導</h1>
    <div class="sub">在處分發生前就看見需要關心的學生</div>`),
  'c04-admin': shell(`
    <div class="eyebrow">PART 3</div>
    <h1>設定與權限</h1>
    <div class="sub">校規不必改程式，名冊換屆一次搞定</div>`),
  'c05-arch': shell(`
    <div class="eyebrow">技術與成本</div>
    <h1>完全在<span class="hl">免費方案</span>內運作</h1>
    <div class="grid">
      <div class="item"><b>前端 GitHub Pages</b><span>React + TypeScript，推上 main 自動部署</span></div>
      <div class="item"><b>後端 Firebase Spark</b><span>Firestore + Google 登入，不需信用卡</span></div>
      <div class="item"><b>不使用 Cloud Functions</b><span>邏輯在前端以交易執行，安全規則把關</span></div>
      <div class="item"><b>29 項安全規則測試</b><span>提權、竄改時間、刪除紀錄皆有覆蓋</span></div>
    </div>`, { tone: 'dark' }),
  'c06-end': shell(`
    <div class="mark">CARE</div>
    <h1>把時間還給<span class="hl">輔導</span></h1>
    <div class="sub">計次、管制、追蹤交給系統；<br>老師專心處理真正需要對話的部分。</div>
    <div class="tiny">管制期間學生可正常飲水與如廁 —— 反思是教育歷程，不是剝奪基本需求</div>`),
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
for (const [name, html] of Object.entries(CARDS)) {
  const file = `${OUT}${name}.html`;
  writeFileSync(file, html);
  await page.goto(`file://${file}`);
  await page.waitForTimeout(220);
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log('✔', name);
}
await browser.close();
