#!/usr/bin/env bash
# 扣子云构建入口：平台强制执行 `bash scripts/deploy-build.sh`，不接受自定义命令。
#
# 为什么要自己装依赖：云端的生产安装一般带 --omit=dev，而 `next build` 需要
# typescript 与 tailwindcss / @tailwindcss/postcss（postcss 插件），缺任何一个
# 都会直接 exit 1 —— 前端看不见错误，只有平台日志里一行 exit status 1。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[deploy-build] pwd=$(pwd)"
echo "[deploy-build] node=$(node -v) npm=$(npm -v) PORT=${PORT:-未注入}（构建阶段用不到，仅打印）"

# next@16 的 engines 要求 node >=20.9；版本不够时提前给出人话，
# 别让 next build 抛一句 ESBUILD / SyntaxError 之类的间接错误。
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=9)?0:1)' || {
  echo "[deploy-build] 运行时 Node 版本过低（当前 $(node -v)），请在平台把 Node 切到 20.9+ 或 22.x 后重试。" >&2
  exit 1
}

# 只在真的缺包时才 npm ci：ci 会整目录重装，需要网络，且会把平台已装好的东西推倒重来。
MISSING=""
# 探测列表必须覆盖「构建时真的会被 import 的包」，漏一个就会跳过安装、
# 然后在 next build 里报 Module not found。three 与 R3F 三件套是首页深空层
# 与 /lab/* 实验页的运行时依赖，加进来之前它们正好是漏的。
for pkg in next react react-dom tailwindcss @tailwindcss/postcss typescript concurrently \
           three @react-three/fiber @react-three/drei @react-three/postprocessing maath; do
  [ -d "node_modules/$pkg" ] || MISSING="$MISSING $pkg"
done

if [ -n "$MISSING" ]; then
  echo "[deploy-build] 缺少依赖：$MISSING —— 执行完整安装（含 devDependencies）"
  if [ -f package-lock.json ]; then
    npm ci --include=dev --no-audit --no-fund
  else
    npm install --include=dev --no-audit --no-fund
  fi
else
  echo "[deploy-build] 依赖齐全，跳过安装"
fi

npm run build

echo "[deploy-build] 构建完成，.next 大小：$(du -sh .next | cut -f1)"
