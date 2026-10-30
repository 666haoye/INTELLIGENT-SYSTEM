import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./knowledge-panel.css";
import "./sandbox-panel.css";

export const metadata: Metadata = {
  title: "智教系统 · 全息学习空间",
  description:
    "智教系统深度学习教学平台：镂空线框蝴蝶、神经节点、Canvas 蓝色光轨与知识库索引。",
};

export const viewport: Viewport = {
  themeColor: "#010204",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
