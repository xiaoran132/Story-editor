import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

// 显示字体：Space Grotesk —— 几何 grotesk，太空气质，用于标题/标签/数字。
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: "星图 · AI 互动剧情",
  description: "AI 驱动的互动剧情共创社区 — 你的每个选择，都是一颗星",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className={spaceGrotesk.variable}>
      <body>{children}</body>
    </html>
  );
}
