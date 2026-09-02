import { defineConfig } from "vitest/config";

// 纯函数测试：lib/ 不依赖 DOM 与网络，不需要 jsdom/环境模拟。
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
