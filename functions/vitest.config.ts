import { defineConfig } from 'vitest/config';

/** 預設測試：純領域邏輯，不需任何外部服務 */
export default defineConfig({
  test: {
    include: ['test/*.test.ts'],
    environment: 'node',
  },
});
