import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 互动剧情",
  description: "AI 驱动的互动剧情共创社区 — 游玩",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
