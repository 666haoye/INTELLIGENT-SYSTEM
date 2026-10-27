/**
 * 前端只存代理地址，禁止出现 PAT / bot_id。
 * NEXT_PUBLIC_* 在构建期内联，因此 export:single 产出的 file:// 单文件版同样带着这个地址。
 *
 * 默认空字符串 = 同源相对路径（请求 /chat），适配扣子云端前后端同域部署。
 * 本地开发必须显式覆盖，因为前端在 8899、代理在 8787，属跨端口：
 *   .env.local 里写 NEXT_PUBLIC_COZE_PROXY_URL=http://127.0.0.1:8787
 * 云端不要设这个变量（或显式设为空），否则会退化成连本机地址。
 */
export const COZE_PROXY_URL = process.env.NEXT_PUBLIC_COZE_PROXY_URL ?? "";
