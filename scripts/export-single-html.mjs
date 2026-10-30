#!/usr/bin/env node
/**
 * 把当前站点打包成一个可离线双击打开的单文件 HTML：
 *   1. 临时切换 next.config.ts 为静态导出（output: export，assetPrefix 相对路径，独立 distDir 不碰 dev）
 *   2. next build --webpack → out/
 *   3. 把 out/index.html 里的 CSS/JS 全部内联，剥掉对 _next/ 的所有引用
 *   4. 产出 智教系统首页.html，恢复配置并清理临时目录
 *
 * 用法：npm run export:single
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const configPath = path.join(root, "next.config.ts");
const tmpDist = path.join(root, ".next-export");
/* 自定义 distDir 时，静态导出产物直接落在 distDir 里 */
const outDir = tmpDist;
const finalPath = path.join(root, "智教系统首页.html");

const originalConfig = fs.readFileSync(configPath, "utf8");

const exportConfig = `import type { NextConfig } from "next";

/* 临时配置：仅用于 scripts/export-single-html.mjs 的静态导出，脚本结束会恢复原文件 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  distDir: ".next-export",
  devIndicators: false,
};

export default nextConfig;
`;

function safeScript(html) {
  /* 内联脚本里出现 </script> 会截断标签 */
  return html.split("</script>").join("<\\/script>");
}

function safeStyle(css) {
  return css.split("</style>").join("<\\/style>");
}

function run() {
  console.log("[export] 切换为静态导出配置…");
  fs.writeFileSync(configPath, exportConfig, "utf8");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(tmpDist, { recursive: true, force: true });

  console.log("[export] next build --webpack …");
  const build = spawnSync("npx next build --webpack", {
    cwd: root,
    stdio: "inherit",
    shell: true,
  });
  if (build.status !== 0) {
    throw new Error("next build 失败（退出码 " + build.status + "）");
  }

  const htmlPath = path.join(outDir, "index.html");
  if (!fs.existsSync(htmlPath)) {
    throw new Error("未找到 " + htmlPath + "，导出没有产出 index.html");
  }

  let html = fs.readFileSync(htmlPath, "utf8");

  /* <link … _next/…>：stylesheet 就地替换为占位符，其余（preload 等）直接删除 */
  html = html.replace(/<link[^>]+href="\.?\/?_next\/([^"]+)"[^>]*\/?>/g, (tag, rel) =>
    tag.includes('rel="stylesheet"') ? `@@CSS::${rel}@@` : "",
  );

  /* <script src="_next/…">：替换为占位符（其余属性全部丢弃，按文档顺序内联） */
  html = html.replace(
    /<script[^>]*src="\.?\/?_next\/([^"]+)"[^>]*><\/script>/g,
    (_tag, rel) => `@@JS::${rel}@@`,
  );

  /* 资源实际位于 <distDir>/_next/…，正则已把 _next/ 前缀吃掉，这里补回来 */
  const readAsset = (rel) => fs.readFileSync(path.join(outDir, "_next", rel), "utf8");

  html = html.replace(/@@CSS::([^@]+)@@/g, (_m, rel) => "<style>" + safeStyle(readAsset(rel)) + "</style>");

  /* 记录 HTML 里已内联过的 chunk，下面补懒加载 chunk 时跳过，避免同一份代码出现两次 */
  const inlined = new Set();

  /* Next 的 getAssetPrefix 会在启动时读 document.currentScript.src 并要求里面有 /_next/。
     内联脚本没有 src，因此给每个内联脚本挂一个合成 data-src，并把该读取改成
     优先取 data-src、以 location.href 为 base 解析（合成地址只是字符串，不会发起请求）。 */
  html = html.replace(/@@JS::([^@]+)@@/g, (_m, rel) => {
    inlined.add(rel);
    return `<script data-src="http://localhost/_next/${rel}">` + safeScript(readAsset(rel)) + "<\/script>";
  });

  /* 懒加载 chunk（next/dynamic 的产物）不出现在 HTML 里，是 webpack 运行时注入 <script> 才取的。
     file:// 下没有服务器，那一取就是 404 —— 表现为 3D 层永远不挂载，而残留检查也发现不了
     （它只看 HTML 里的标签）。webpack 5 的 chunk 文件自身会往 self.webpackChunk_* 里 push，
     runtime 初始化时重放这些条目，所以把它们也内联进来，__webpack_require__.e(chunkId)
     就直接命中已安装的分片，不发任何请求。 */
  const chunkFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) {
        chunkFiles.push(path.relative(path.join(outDir, "_next"), full).split(path.sep).join("/"));
      }
    }
  };
  const chunksDir = path.join(outDir, "_next", "static", "chunks");
  if (fs.existsSync(chunksDir)) walk(chunksDir);
  const lazy = chunkFiles.filter((rel) => !inlined.has(rel));

  if (lazy.length) {
    /* 追加在 </body> 前：此时 runtime 已解析完，push 进来的模块会被它自己排队处理，
       而水合要等这批脚本执行完才发生，不会抢在它们前面。
       必须用函数型替换：压缩后的 JS 里会出现 $` / $& 这类序列，
       字符串型替换会把它们展开成「匹配点之前的整段文档」，
       表现为 chunk 被重复内联若干次、体积翻数倍、bootstrap 直接跑坏。 */
    const tags = lazy
      .map(
        (rel) =>
          `<script data-src="http://localhost/_next/${rel}">` + safeScript(readAsset(rel)) + "<\/script>",
      )
      .join("");
    html = html.includes("</body>") ? html.replace("</body>", () => tags + "</body>") : html + tags;
  }
  console.log(
    "[export] 懒加载 chunk 内联：" +
      lazy.length +
      " 个（HTML 直接引用 " +
      inlined.size +
      " 个，合计 " +
      (lazy.length + inlined.size) +
      "）",
  );

  let patched = 0;
  html = html.replace(
    /let\{pathname:([a-zA-Z$_]+)\}=new URL\(([a-zA-Z$_]+)\.src\)/g,
    (_m, name, holder) => {
      patched++;
      return `let{pathname:${name}}=new URL(${holder}.getAttribute("data-src")||${holder}.src,location.href)`;
    },
  );
  console.log("[export] currentScript 补丁应用次数：" + patched);
  if (patched === 0) {
    console.warn("[export] 警告：未命中 currentScript 补丁，页面可能无法水合（构建格式可能已变化）");
  }

  /* 飞行数据（self.__next_f）里仍保留 CSS 路径：水合后 React 会按 :HL/link 载荷
     重新插入 <link> 并发起请求，文件不存在 → 404 → unhandledrejection。
     把这些字符串换成 data: 空样式表（base64 避免引号/花括号破坏飞行字符串），
     即便被重新插入也是即时加载、零网络请求。
     前导斜杠必须一起吃掉：飞行数据里存的是 "/_next/..."，只换后半段会得到
     "/data:text/css;…" —— 浏览器把它当相对路径解析，file:// 下就是 ERR_FILE_NOT_FOUND。 */
  const flightCss = html.match(/\/?_next\/static\/css\/[A-Za-z0-9._-]+\.css/g) || [];
  const emptySheet = "data:text/css;base64," + Buffer.from(":root{}").toString("base64");
  html = html.replace(/\/?_next\/static\/css\/[A-Za-z0-9._-]+\.css/g, emptySheet);
  console.log("[export] 飞行数据 CSS 引用重写：" + flightCss.length + " 处" + (flightCss.length ? "（" + flightCss[0] + "）" : ""));

  /* 残留检查：不允许还有指向 _next/ 的真实 src/href 引用（data-src 合成地址与 flight 字符串无害） */
  const strayTag = html.match(/<(script|link)[^>]*[\s"'](src|href)="\.?\/?_next\//);
  if (strayTag) {
    console.warn("[export] 警告：仍有外部引用 " + strayTag[0].slice(0, 120));
  }

  fs.writeFileSync(finalPath, html, "utf8");
  const size = (fs.statSync(finalPath).size / 1024 / 1024).toFixed(2);
  console.log("[export] 完成：" + finalPath + "（" + size + " MB）");

  /* 实验沙盒：面板里的相对链接 experiments/exp-eXX.html 在 dev 下走 public/，
     file:// 下则要求实验目录与 智教系统首页.html 同级——复制一份。
     过滤 _ 开头的临时自检脚本与废弃目录。 */
  const expSrc = path.join(root, "public", "experiments");
  const expDst = path.join(root, "experiments");
  if (fs.existsSync(expSrc)) {
    fs.rmSync(expDst, { recursive: true, force: true });
    fs.cpSync(expSrc, expDst, {
      recursive: true,
      filter: (src) => {
        const base = path.basename(src);
        return (
          !base.startsWith("_") &&
          !base.startsWith("tmp-") &&
          base !== "exps"
        );
      },
    });
    const pages = fs.readdirSync(expDst).filter((n) => n.endsWith(".html")).length;
    console.log("[export] 实验目录已复制：" + expDst + "（" + pages + " 个实验页）");
  }

  /* 教材切片：与实验目录同理 —— src/lib/kb-images.ts 输出的是相对路径 images/kb/xxx，
     dev 下由 public/ 提供，file:// 下要求它与 智教系统首页.html 同级。
     不做 base64 内联：12 张页面图会把单文件 HTML 撑到几十 MB，首屏解码也吃不消。
     整个 public/images 一起搬，将来加子目录不用改这里。 */
  const imgSrc = path.join(root, "public", "images");
  const imgDst = path.join(root, "images");
  if (fs.existsSync(imgSrc)) {
    fs.rmSync(imgDst, { recursive: true, force: true });
    fs.cpSync(imgSrc, imgDst, { recursive: true });
    const kbDir = path.join(imgDst, "kb");
    const shots = fs.existsSync(kbDir) ? fs.readdirSync(kbDir).length : 0;
    console.log("[export] 图片目录已复制：" + imgDst + "（kb/ " + shots + " 张）");
  } else {
    console.warn("[export] 未找到 public/images —— 离线版的教材切片会缺图（先放图再导出）");
  }
}

try {
  run();
} finally {
  fs.writeFileSync(configPath, originalConfig, "utf8");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(tmpDist, { recursive: true, force: true });
  console.log("[export] 已恢复 next.config.ts，临时目录已清理");
}
