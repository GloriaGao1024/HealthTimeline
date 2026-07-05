const fs = require("fs");

const backendUrl = process.argv[2];
if (!backendUrl || !/^https?:\/\//.test(backendUrl)) {
  console.error("Usage: node scripts/set-ocr-backend.js https://your-ocr-backend.example.com");
  process.exit(1);
}

const input = "outputs/health-timeline-mvp-wechat-ocr.html";
const output = "outputs/health-timeline-mvp-wechat-ocr.html";
let html = fs.readFileSync(input, "utf8");
html = html.replace(/const OCR_API_BASE = \"https?:\/\/[^\"]+\";/, `const OCR_API_BASE = "${backendUrl.replace(/\/$/, "")}";`);
fs.writeFileSync(output, html);
fs.writeFileSync("outputs/OCR_BACKEND_URL.txt", `${backendUrl.replace(/\/$/, "")}\n`);

console.log(`Updated OCR_API_BASE to ${backendUrl.replace(/\/$/, "")}`);
