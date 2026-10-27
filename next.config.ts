import type { NextConfig } from "next";

/* 代理进程的可达地址。默认与本地一致（同机 8787）。
 *
 * 绝对不要在这里读 process.env.PORT：Next 会把自身的启动端口（-p 8899 / 平台注入的
 * PORT）写进自己的进程环境，用它当代理端口会让 /chat 转发回 Next 自己，形成自我循环
 * ——表现为 500 + 日志里的 "Failed to proxy ... socket hang up"。
 * 云端若把代理跑在别的端口，请显式设置 COZE_PROXY_ORIGIN，例如
 *   COZE_PROXY_ORIGIN=http://127.0.0.1:8000
 */
const PROXY_ORIGIN = process.env.COZE_PROXY_ORIGIN ?? "http://127.0.0.1:8787";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  devIndicators: false,
  /* 云端同域部署：前端请求相对路径 /chat，由 Next 转发给代理进程。
     只在 npm run dev / npm start 的服务模式下生效；export:single 会临时替换整个
     配置文件，所以静态导出版不受影响。 */
  async rewrites() {
    return [
      {
        source: "/chat",
        destination: `${PROXY_ORIGIN}/chat`,
      },
    ];
  },
};

export default nextConfig;
