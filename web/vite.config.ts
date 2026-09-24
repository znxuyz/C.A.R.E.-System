import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * GitHub Pages 部署設定
 *  - `base` 必須等於 repository 名稱（https://<user>.github.io/<repo>/）。
 *    可用環境變數 VITE_BASE 覆寫（自訂網域時設為 '/'）。
 *  - 路由採 HashRouter，避免 Pages 對 SPA 深層路徑回 404。
 */
/**
 * 版本標記：讓畫面能顯示「現在看到的是哪一版」。
 * 部署後常見的疑問是「我看到的是新版還是瀏覽器快取」，
 * 把建置時間與 commit 短碼印在側欄就能當場確認。
 */
const buildInfo = {
  sha: (process.env.GITHUB_SHA ?? '').slice(0, 7) || 'local',
  at: new Date().toISOString(),
};

export default defineConfig(() => ({
  plugins: [react()],
  define: { __BUILD_INFO__: JSON.stringify(buildInfo) },
  base: process.env.VITE_BASE ?? '/C.A.R.E.-System/',
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: { port: 5173, host: true },
}));
