import { defineConfig } from 'vitest/config';

/**
 * 安全規則測試：需 Firestore 模擬器。
 * 請以 `npm run test:rules` 執行（會自動啟動模擬器）。
 */
export default defineConfig({
  test: {
    include: ['test/emulator/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
