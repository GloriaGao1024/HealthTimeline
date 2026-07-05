const { URLSearchParams } = require("url");

const MAX_IMAGE_BASE64_LENGTH = 18 * 1024 * 1024;
let tokenCache = { token: "", expiresAt: 0 };

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: "25mb"
    }
  }
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, body) {
  setCors(res);
  res.status(status).json(body);
}

async function getBaiduAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  const apiKey = process.env.BAIDU_OCR_API_KEY;
  const secretKey = process.env.BAIDU_OCR_SECRET_KEY;
  if (!apiKey || !secretKey) {
    const err = new Error("OCR 后端缺少百度 API Key 或 Secret Key 环境变量");
    err.status = 500;
    throw err;
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: apiKey,
    client_secret: secretKey
  });

  const response = await fetch(`https://aip.baidubce.com/oauth/2.0/token?${params.toString()}`, {
    method: "POST"
  });
  const data = await response.json();

  if (!response.ok || !data.access_token) {
    const err = new Error(data.error_description || data.error || "百度 access_token 获取失败");
    err.status = 502;
    throw err;
  }

  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 2592000) * 1000
  };
  return tokenCache.token;
}

async function callBaiduOcr(imageBase64) {
  const token = await getBaiduAccessToken();
  const params = new URLSearchParams({
    image: imageBase64.replace(/^data:image\/\w+;base64,/, ""),
    detect_direction: "true",
    paragraph: "false"
  });

  const response = await fetch(`https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  const data = await response.json();

  if (!response.ok || data.error_code) {
    const err = new Error(data.error_msg || `百度 OCR 调用失败：${response.status}`);
    err.status = 502;
    err.details = data;
    throw err;
  }

  const words = Array.isArray(data.words_result) ? data.words_result.map(row => row.words).filter(Boolean) : [];
  return {
    text: words.join("\n"),
    words,
    provider: "baidu-accurate-basic"
  };
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (!body.mimeType || !String(body.mimeType).startsWith("image/")) {
      sendJson(res, 415, { error: "OCR 当前仅处理图片。PDF 请先转成图片后上传。" });
      return;
    }
    if (!body.imageBase64 || typeof body.imageBase64 !== "string") {
      sendJson(res, 400, { error: "缺少 imageBase64" });
      return;
    }
    if (body.imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
      sendJson(res, 413, { error: "图片过大，请压缩后重试" });
      return;
    }

    const result = await callBaiduOcr(body.imageBase64);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error.message || "OCR 服务异常",
      details: error.details
    });
  }
};
