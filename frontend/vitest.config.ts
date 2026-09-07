import { defineConfig } from "vitest/config";
import path from "node:path";

// 纯函数测试：lib/ 不依赖 DOM 与网络，不需要 jsdom/环境模拟。
// alias 与 tsconfig 的 "@/*": ["./src/*"] 保持一致——测试文件里两种写法都能用。
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
