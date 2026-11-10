/** 錄影共用工具：虛擬游標、平滑捲動、節奏控制 */
export const BASE = 'http://localhost:4188/C.A.R.E.-System/';

/** 在頁面注入一顆看得見的游標（Playwright 錄影不會畫出真實游標） */
export async function installCursor(page) {
  await page.addStyleTag({
    content: `
      #demo-cursor {
        position: fixed; left: 0; top: 0; width: 22px; height: 22px;
        margin: -11px 0 0 -11px; border-radius: 50%;
        background: rgba(28,92,171,.25); border: 2px solid #1c5cab;
        box-shadow: 0 2px 10px rgba(0,0,0,.25);
        pointer-events: none; z-index: 2147483647;
        transition: transform .05s linear;
      }
      #demo-cursor.click { animation: demo-click .4s ease-out; }
      @keyframes demo-click {
        0% { box-shadow: 0 0 0 0 rgba(28,92,171,.45); }
        100% { box-shadow: 0 0 0 26px rgba(28,92,171,0); }
      }
      /* 錄影時關閉游標本身的 hover 閃爍，畫面較穩 */
      * { scroll-behavior: smooth; }
    `,
  });
  await page.evaluate(() => {
    const el = document.createElement('div');
    el.id = 'demo-cursor';
    document.body.appendChild(el);
    window.__moveCursor = (x, y) => {
      el.style.transform = `translate(${x}px, ${y}px)`;
    };
    window.__clickCursor = () => {
      el.classList.remove('click');
      void el.offsetWidth;
      el.classList.add('click');
    };
  });
  await page.evaluate(() => window.__moveCursor(960, 600));
}

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** 游標平滑移動到元素中央 */
export async function moveTo(page, locator, { steps = 26 } = {}) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('找不到元素位置');
  const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const from = await page.evaluate(() => {
    const el = document.getElementById('demo-cursor');
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { x: m.m41, y: m.m42 };
  });
  for (let i = 1; i <= steps; i += 1) {
    const t = ease(i / steps);
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    await page.evaluate(([px, py]) => window.__moveCursor(px, py), [x, y]);
    await page.waitForTimeout(12);
  }
  return to;
}

/** 移動 → 點擊（含漣漪） */
export async function clickAt(page, locator, { settle = 600 } = {}) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(150);
  await moveTo(page, locator);
  await page.evaluate(() => window.__clickCursor());
  await page.waitForTimeout(160);
  await locator.click();
  await page.waitForTimeout(settle);
}

/** 緩慢捲動到指定位置（像人在看畫面） */
export async function scrollTo(page, y, { duration = 1200 } = {}) {
  await page.evaluate(
    ([target, dur]) =>
      new Promise((resolve) => {
        const start = window.scrollY;
        const diff = target - start;
        const t0 = performance.now();
        const step = (now) => {
          const p = Math.min(1, (now - t0) / dur);
          const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          window.scrollTo(0, start + diff * e);
          if (p < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
    [y, duration],
  );
}

/** 以示範身分登入並開啟指定路由 */
export async function openApp(page, hash = '#/admin') {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => sessionStorage.setItem('care.session', '1'));
  await page.goto(BASE + hash);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await installCursor(page);
}

/** 點左側導覽（手機版是橫向標籤列，桌面版是直欄） */
export async function nav(page, label) {
  await clickAt(page, page.locator('.nav__item', { hasText: label }).first(), {
    settle: 900,
  });
}
