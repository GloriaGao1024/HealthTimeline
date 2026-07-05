const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 8792);
const PUBLIC_DIR = __dirname;
const MAX_JSON_BYTES = 14 * 1024 * 1024;
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

let baiduTokenCache = { token: "", expiresAt: 0 };

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && requestUrl.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        baiduOcrConfigured: Boolean(process.env.BAIDU_OCR_API_KEY && process.env.BAIDU_OCR_SECRET_KEY),
        aiConfigured: Boolean(process.env.AI_API_KEY)
      });
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/ocr/baidu") {
      return handleBaiduOcr(req, res);
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/ai/chat") {
      return handleAiChat(req, res);
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendJson(res, 405, { error: "Method not allowed" });
    }

    return serveStatic(requestUrl.pathname, req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "服务器处理失败", detail: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`HealthTimeline running at http://127.0.0.1:${PORT}/`);
});

async function handleBaiduOcr(req, res) {
  const apiKey = process.env.BAIDU_OCR_API_KEY;
  const secretKey = process.env.BAIDU_OCR_SECRET_KEY;
  if (!apiKey || !secretKey) {
    return sendJson(res, 400, { error: "百度 OCR 未配置，请在 .env 填写 BAIDU_OCR_API_KEY 和 BAIDU_OCR_SECRET_KEY" });
  }

  const body = await readJson(req);
  const imageBase64 = normalizeBase64(body.imageBase64 || body.image || "");
  if (!imageBase64) return sendJson(res, 400, { error: "缺少图片 base64 数据" });

  const token = await getBaiduAccessToken(apiKey, secretKey);
  const endpoint = process.env.BAIDU_OCR_ENDPOINT || "https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic";
  const ocrUrl = `${endpoint}${endpoint.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;

  const response = await fetch(ocrUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ image: imageBase64 }).toString()
  });
  const result = await response.json();

  if (!response.ok || result.error_code) {
    return sendJson(res, 502, {
      error: result.error_msg || "百度 OCR 调用失败",
      code: result.error_code || response.status
    });
  }

  const words = Array.isArray(result.words_result) ? result.words_result.map(item => item.words).filter(Boolean) : [];
  sendJson(res, 200, { text: words.join("\n"), words, raw: result });
}

async function getBaiduAccessToken(apiKey, secretKey) {
  const now = Date.now();
  if (baiduTokenCache.token && baiduTokenCache.expiresAt > now + 60_000) return baiduTokenCache.token;

  const tokenUrl = "https://aip.baidubce.com/oauth/2.0/token";
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: apiKey,
      client_secret: secretKey
    }).toString()
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description || result.error || "百度 access_token 获取失败");
  }

  baiduTokenCache = {
    token: result.access_token,
    expiresAt: now + Number(result.expires_in || 2592000) * 1000
  };
  return baiduTokenCache.token;
}

async function handleAiChat(req, res) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return sendJson(res, 400, { error: "AI_API_KEY 未配置" });

  const body = await readJson(req);
  const question = String(body.question || "").trim();
  if (!question) return sendJson(res, 400, { error: "请输入问题" });

  const apiBase = (process.env.AI_API_BASE || "https://api.deepseek.com").replace(/\/$/, "");
  const aiUrl = process.env.AI_CHAT_COMPLETIONS_URL || `${apiBase}/chat/completions`;
  const model = process.env.AI_MODEL || "deepseek-chat";
  const context = compactHealthContext(body);

  const response = await fetch(aiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "你是健康档案整理助手。只能基于用户提供的结构化报告、指标和趋势信息回答。不要诊断疾病，不要开药，不要给处方，不要替代医生；涉及复查或异常时提示用户咨询医生。回答要通俗、简洁，并标明数据来源。"
        },
        {
          role: "user",
          content: `已保存健康数据：\n${JSON.stringify(context, null, 2)}\n\n用户问题：${question}`
        }
      ]
    })
  });

  const result = await response.json();
  if (!response.ok) {
    return sendJson(res, 502, { error: result.error?.message || "AI 接口调用失败", raw: result });
  }

  const answer = result.choices?.[0]?.message?.content || "";
  sendJson(res, 200, { answer });
}

function compactHealthContext(body) {
  const reports = Array.isArray(body.reports) ? body.reports : [];
  const indicators = Array.isArray(body.indicators) ? body.indicators : [];
  const trends = Array.isArray(body.trends) ? body.trends : [];
  return {
    reports: reports.slice(-8).map(report => ({
      id: report.id,
      reportDate: report.reportDate,
      institution: report.institution,
      reportType: report.reportType
    })),
    indicators: indicators.slice(-120).map(item => ({
      reportId: item.reportId,
      name: item.name,
      alias: item.alias,
      value: item.value,
      unit: item.unit,
      referenceRange: item.referenceRange,
      status: item.status
    })),
    trends: trends.slice(0, 30)
  };
}

function serveStatic(urlPath, req, res) {
  const safePath = decodeURIComponent(urlPath).split("?")[0];
  let filePath = safePath === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, "Forbidden");

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  if (!fs.existsSync(filePath)) return sendText(res, 404, "Not found");

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(filePath).pipe(res);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (Buffer.byteLength(raw) > MAX_JSON_BYTES) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("JSON 格式错误"));
      }
    });
    req.on("error", reject);
  });
}

function normalizeBase64(value) {
  return String(value || "").replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "").trim();
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
