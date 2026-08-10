import type { Metadata } from "next";
import { Inter, Noto_Serif_SC } from "next/font/google";
import "./globals.css";
import PrefsBoot from "@/components/PrefsBoot";

// UI / 管理态无衬线：Inter —— 清晰、可扫，用于界面文本、标签、数字。
// 注意变量名：注入的是 --font-sans-inter，由 globals.css 的 --font-sans 引用并接系统回退栈。
// 两边不能同名，否则 globals.css 的 :root 与 next/font 注入的 class 权重相同、
// 后加载的 globals 覆盖掉真实字体名，webfont 白下载不生效。
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans-inter",
  display: "swap",
});

// 中文标题 + 阅读态正文衬线：Noto Serif SC。
const notoSerif = Noto_Serif_SC({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  variable: "--font-serif-noto",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Story Editor · AI 互动剧情",
  description: "AI 驱动的互动剧情共创社区 — 你的每个选择，都通向无穷种可能",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className={`${inter.variable} ${notoSerif.variable}`}>
      <body>
        <PrefsBoot />
        {children}
      </body>
    </html>
  );
}
