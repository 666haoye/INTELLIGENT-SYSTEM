#!/usr/bin/env bash
# 扣子云运行入口：平台强制执行 `bash scripts/deploy-run.sh`。
#
# 一个容器里跑两个进程：
#   next start            —— 读平台注入的 PORT，对外（80 / 5000 都由平台决定）
#   node coze-proxy.mjs   —— 固定监听内部 127.0.0.1:8787，带 PAT，不对外
# 前端只请求同源 /chat，由 next.config.ts 的 rewrites() 转给代理。
#
# 两个容易踩的点，别改回去：
#   1) 这里用 bare `next start`，不是 `npm run start` —— 后者的脚本写死了 -p 8899，
#      命令行 -p 优先级高于环境变量，会把平台注入的 PORT 直接盖掉。
#   2) 代理刻意不读 PORT，见 coze-proxy.mjs 里的注释 —— 读了就和 next 抢同一个端口。
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${PORT:-}" ]; then
  echo "[deploy-run] 警告：平台没有注入 PORT，next start 会退回 3000，大概率对不上网关。" >&2
fi

# 扣子托管不允许变量以 COZE_ 开头，云端配的是 MY_COZE_*；这里按同样的优先级探测，
# 免得日志一句「凭证缺失」把人带去查本来就已经配好的环境变量面板。
pat_state=$([ -n "${MY_COZE_PAT:-${COZE_PAT:-}}" ] && echo 已注入 || echo 缺失)
bot_state=$([ -n "${MY_COZE_BOT_ID:-${COZE_BOT_ID:-}}" ] && echo 已注入 || echo 缺失)

echo "[deploy-run] PORT=${PORT:-未设置} 代理内部端口=${MY_COZE_PROXY_PORT:-${COZE_PROXY_PORT:-8787}} rewrite 目标=${MY_COZE_PROXY_ORIGIN:-${COZE_PROXY_ORIGIN:-http://127.0.0.1:8787}}"
echo "[deploy-run] 凭证（MY_COZE_ 优先，回退 COZE_）：PAT=$pat_state BOT_ID=$bot_state"

# exec：让 concurrently 顶替 bash 成为这个 shell 的进程，平台停服时信号能直接到位。
exec npm run start:all
