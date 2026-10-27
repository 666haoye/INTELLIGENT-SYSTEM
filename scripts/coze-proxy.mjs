#!/usr/bin/env node
/**
 * 扣子 v3 chat 本地代理。
 * 1) 解决浏览器直连 api.coze.cn 的 CORS（含 file:// 的 null 源）
 * 2) 把「创建会话 → 轮询状态 → 拉取消息」三段式封装成前端的一次 POST /chat
 * 3) PAT 只存在于本进程，浏览器永远拿不到
 *
 * 用法： npm run proxy
 *       COZE_MOCK=1 node scripts/coze-proxy.mjs   // 不打上游，返回协议样例，用于验 UI
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
/* 本地默认只绑 127.0.0.1，避免暴露到局域网。
   云端部署必须设 COZE_PROXY_HOST=0.0.0.0，否则平台的反向代理连不进来。 */
const HOST = process.env.COZE_PROXY_HOST ?? "127.0.0.1";
/* 云端平台通常用 PORT 注入端口；本地仍可用 COZE_PROXY_PORT 显式覆盖。 */
const PORT = Number(process.env.COZE_PROXY_PORT ?? process.env.PORT ?? 8787);
const COZE_HOST = "api.coze.cn";
const POLL_INTERVAL_MS = 800;
/* 25s 而非 60s：云端函数型托管常在 30-60s 掐断长请求，超时后前端只能拿到 502。
   实测正常回答约 15-17s，这里留约 1.5 倍余量。 */
const POLL_TIMEOUT_MS = 25_000;
const MAX_TEXT_LENGTH = 4000;

/* 内置 .env 解析：不用 node --env-file（文件缺失时硬失败），
   也不用 --env-file-if-exists（需 Node 22+，而 package.json 只要求 >=20.9）。 */
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    let value = trimmed.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    result[trimmed.slice(0, eq).trim()] = value;
  }
  return result;
}

const fileEnv = loadEnvFile(path.join(ROOT, ".env.local"));
const PAT = process.env.COZE_PAT ?? fileEnv.COZE_PAT ?? "";
const BOT_ID = process.env.COZE_BOT_ID ?? fileEnv.COZE_BOT_ID ?? "";
const MOCK = (process.env.COZE_MOCK ?? fileEnv.COZE_MOCK ?? "") === "1";
const USER_ID = "zj-web-" + crypto.randomUUID();

const MOCK_REPLY = [
  "反向传播写得对不对，教材给的办法是**数值梯度检查**：用有限差分对拍解析梯度。",
  "",
  "第 373 页是教材明文要求的内容，误差要压到 1e-6 以下才算实现正确。",
  "[查看教材 P.373](kb://373)",
  "[运行反向传播对拍](exp://E13)",
  "",
  "下面是几个健壮性样例，都应该被正确识别或安全降级：",
  "全角括号：[主成分分析]（kb://42）",
  "全角方括号：【Dropout 开关对比】(exp://E21)",
  "小写编号：[过拟合实验](exp://e04)",
  "不存在的实验应降级为纯文本：[坏链接](exp://E99)",
  "未闭合的残片不应吞字符：](kb://",
].join("\n");

function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function fail(kind, error) {
  return { ok: false, kind, error };
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function cozeRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const request = https.request(
      {
        host: COZE_HOST,
        path: urlPath,
        method,
        headers: {
          Authorization: "Bearer " + PAT,
          Accept: "application/json",
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null; /* 非 JSON 响应，保留原文用于报错 */
          }
          resolve({ status: res.statusCode ?? 0, json, text });
        });
      },
    );
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 从 message/list 里取正文。
 * 实测本接口返回的 answer 消息 content 是「纯文本」，且消息对象上没有 status 字段；
 * 同一批消息里还混有 function_call / tool_response / verbose / follow_up，必须按 type 过滤。
 * 兼容两种形态：纯文本，以及旧版的 [{type:"text",text:"…"}] JSON 字符串数组。
 */
function extractAnswer(payload) {
  const messages = Array.isArray(payload?.data)
    ? payload.data
    : (payload?.data?.messages ?? []);
  const texts = [];
  for (const message of messages) {
    if (message?.role !== "assistant" || message?.type !== "answer") continue;
    const content = message.content;
    if (typeof content !== "string" || content.trim() === "") continue;

    let parsed = null;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = null;
    }

    if (Array.isArray(parsed)) {
      const parts = parsed
        .filter(
          (part) => part?.type === "text" && typeof part.text === "string",
        )
        .map((part) => part.text);
      if (parts.length > 0) texts.push(parts.join(""));
    } else {
      texts.push(content);
    }
  }
  return texts.join("\n").trim();
}

async function runChat(text, conversationId) {
  const requestBody = {
    bot_id: BOT_ID,
    user_id: USER_ID,
    stream: false,
    additional_messages: [
      { role: "user", content: text, content_type: "text" },
    ],
  };
  if (conversationId) requestBody.conversation_id = conversationId;

  const created = await cozeRequest("POST", "/v3/chat", requestBody);
  if (created.status === 401 || created.status === 403) {
    return fail("config", "PAT 无效或已过期，请更新 .env.local 里的 COZE_PAT");
  }
  if (created.status === 429) {
    return fail("rate", "扣子接口限流，请稍后再试");
  }
  const createdJson = created.json;
  if (!createdJson || createdJson.code !== 0 || !createdJson.data?.id) {
    const detail = createdJson?.msg ?? created.text.slice(0, 200);
    return fail("coze", "创建会话失败：" + (detail || "上游无响应"));
  }

  const chatId = createdJson.data.id;
  const resolvedConversationId =
    createdJson.data.conversation_id ?? conversationId ?? null;
  const query =
    "?chat_id=" +
    encodeURIComponent(chatId) +
    "&conversation_id=" +
    encodeURIComponent(resolvedConversationId ?? "");

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let status = createdJson.data.status;
  let lastError = createdJson.data.error ?? null;

  while (status !== "completed" && status !== "failed") {
    if (Date.now() > deadline) {
      return fail("timeout", "AI 响应超时（60 秒），请重试或把问题问短一点");
    }
    await sleep(POLL_INTERVAL_MS);
    const polled = await cozeRequest("GET", "/v3/chat/retrieve" + query);
    if (polled.status === 429) return fail("rate", "扣子接口限流，请稍后再试");
    if (!polled.json || polled.json.code !== 0) {
      return fail(
        "coze",
        "查询会话状态失败：" + (polled.json?.msg ?? polled.status),
      );
    }
    status = polled.json.data?.status ?? status;
    lastError = polled.json.data?.last_error ?? lastError;
  }

  if (status === "failed") {
    return fail("coze", "智能体执行失败：" + (lastError ?? "未知错误"));
  }

  const listed = await cozeRequest("GET", "/v3/chat/message/list" + query);
  if (!listed.json || listed.json.code !== 0) {
    return fail("coze", "拉取回复失败：" + (listed.json?.msg ?? listed.status));
  }
  const reply = extractAnswer(listed.json);
  if (!reply) return fail("empty", "AI 没有返回正文，请换一种问法再试");

  return { ok: true, reply, conversationId: resolvedConversationId };
}

const server = http.createServer(async (req, res) => {
  applyCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://" + HOST + ":" + PORT);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      mock: MOCK,
      hasPat: Boolean(PAT),
      hasBotId: Boolean(BOT_ID),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/chat") {
    let parsed = null;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, fail("config", "请求体不是合法 JSON"));
      return;
    }

    const text = typeof parsed?.text === "string" ? parsed.text.trim() : "";
    if (!text) {
      sendJson(res, 400, fail("config", "text 不能为空"));
      return;
    }
    if (text.length > MAX_TEXT_LENGTH) {
      sendJson(res, 400, fail("config", "消息过长（上限 " + MAX_TEXT_LENGTH + " 字）"));
      return;
    }
    const conversationId =
      typeof parsed?.conversationId === "string" && parsed.conversationId
        ? parsed.conversationId
        : null;

    try {
      const result = MOCK
        ? {
            ok: true,
            reply: MOCK_REPLY,
            conversationId: conversationId ?? "mock-conversation",
          }
        : await runChat(text, conversationId);
      sendJson(res, result.ok ? 200 : 502, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ENOTFOUND") || message.includes("ECONNRESET")) {
        sendJson(res, 502, fail("network", "代理连不上 api.coze.cn，请检查网络"));
        return;
      }
      sendJson(res, 502, fail("coze", "代理内部错误：" + message));
    }
    return;
  }

  sendJson(res, 404, fail("config", "未知路径：" + url.pathname));
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      "[coze-proxy] 端口 " + PORT + " 已被占用，请先关掉旧进程，或用 COZE_PROXY_PORT 换端口。",
    );
    process.exit(1);
  }
  throw error;
});

if (!MOCK && (!PAT || !BOT_ID)) {
  console.error(
    [
      "[coze-proxy] 缺少凭证，无法启动。",
      "请在项目根目录创建 .env.local，内容：",
      "  COZE_PAT=<你的真实令牌>",
      "  COZE_BOT_ID=7xxxxxxxxxxxxxxxx",
      "（.gitignore 已含 .env*，不会被提交）",
      "只想验 UI 可用 mock 模式：COZE_MOCK=1 node scripts/coze-proxy.mjs",
    ].join("\n"),
  );
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  console.log(
    "[coze-proxy] http://" +
      HOST +
      ":" +
      PORT +
      (MOCK ? "（MOCK 模式，不打上游）" : "（bot_id " + BOT_ID + "）"),
  );
});
