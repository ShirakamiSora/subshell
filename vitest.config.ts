import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      reportsDirectory: 'coverage',
      // 只统计主进程逻辑：入口、演示服务器与纯 UI 不在单测范围内。
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts'],
      exclude: ['src/main/index.ts', 'src/main/demo/**', 'src/main/**/*.d.ts'],
      thresholds: {
        lines: 40,
        functions: 40,
        statements: 40,
        branches: 30,
      },
    },
  },
});
