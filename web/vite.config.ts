import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * GitHub Pages 部署設定
 *  - `base` 必須等於 repository 名稱（https://<user>.github.io/<repo>/）。
 *    可用環境變數 VITE_BASE 覆寫（自訂網域時設為 '/'）。
 *  - 路由採 HashRouter，避免 Pages 對 SPA 深層路徑回 404。
 */
export default defineConfig(() => ({
  plugins: [react()],
  base: process.env.VITE_BASE ?? '/C.A.R.E.-System/',
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: { port: 5173, host: true },
}));
