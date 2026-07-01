console.log("app.js loaded");

const STORAGE_KEY = "health_timeline_mvp_v1";
const ALIASES = {
  "总胆固醇": "TC", "TC": "TC", "胆固醇": "TC",
  "低密度脂蛋白": "LDL-C", "低密度脂蛋白胆固醇": "LDL-C", "LDL-C": "LDL-C", "LDL": "LDL-C",
  "高密度脂蛋白": "HDL-C", "高密度脂蛋白胆固醇": "HDL-C", "HDL-C": "HDL-C", "HDL": "HDL-C",
  "甘油三酯": "TG", "TG": "TG",
  "空腹血糖": "GLU", "葡萄糖": "GLU", "血糖": "GLU", "GLU": "GLU",
  "尿酸": "UA", "UA": "UA",
  "肌酐": "CREA", "CREA": "CREA",
  "谷丙转氨酶": "ALT", "ALT": "ALT",
  "谷草转氨酶": "AST", "AST": "AST",
  "白细胞": "WBC", "WBC": "WBC",
  "血红蛋白": "HGB", "HGB": "HGB",
  "钾离子": "K", "钠离子": "NA", "氯离子": "CL", "碳酸氢根": "HCO3", "钙离子": "CA",
  "血清磷": "P", "血清镁": "MG", "尿素氮": "BUN",
  "碱性磷酸酶": "ALP", "谷酰转肽酶": "GGT", "乳酸脱氢酶": "LDH",
  "总胆红素": "TBIL", "直接胆红素": "DBIL", "间接胆红素": "IBIL",
  "总蛋白": "TP", "白蛋白": "ALB", "球蛋白": "GLB", "白球比": "A/G",
  "淀粉酶": "AMY", "前白蛋白": "PA",
  "载酯蛋白-B": "APOB", "载脂蛋白-B": "APOB", "载酯蛋白B": "APOB", "载脂蛋白B": "APOB",
  "载酯蛋白A1": "APOA1", "载脂蛋白A1": "APOA1"
};
const SAMPLE_TEXT = `检验项目
结果
单位
参考范围
钾离子
4.60
mmol/L
3.5-5.5
载酯蛋白-B
0.31
↓g/L
0.46-1.25
钠离子
140
mmol/L
137-147
谷丙转氨酶
14.4
U/L
9.0-50.0
碳酸氢根
31.4
↑mmol/L
20.0-30.0
总胆红素
22.7
↑μmol/L 3.0-22
直接胆红素
8.8
↑μmol/L1.0-6.0
尿酸
301.6
μmol/L
90.0-420
甘油三酯
0.53
mmol/L
0.38-1.80
总胆固醇
2.64
↓mmol/L
3.10-6.5
高密度脂蛋白胆固醇
1.33
mmol/L
0.45-1.95
低密度脂蛋白胆固醇
1.21
mmol/L
1.20-4.00`;

let state = loadState();
let draft = [];
let sourceFile = null;
let selectedFile = null;
let selectedIndicator = null;
let familyMembers = [];
let activeFamilyMemberId = "";
let documents = [];
let documentsLoaded = false;
const REPORTS_BUCKET = "reports";
const DOCUMENTS_TABLE = "documents";

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return { reports: saved.reports || [], indicators: saved.indicators || [] };
  } catch {
    return { reports: [], indicators: [] };
  }
}
function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function id(prefix) { return prefix + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36); }
function showToast(text) {
  const t = document.getElementById("toast");
  t.textContent = text; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}
function today() { return new Date().toISOString().slice(0, 10); }
function escapeHtml(s) { return String(s || "").replace(/[&<>"']/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m])); }

document.getElementById("reportDate").value = today();
document.getElementById("institution").value = "本地体检机构";
document.getElementById("reportType").value = "年度体检";
document.getElementById("toggleMemberForm").addEventListener("click", () => document.getElementById("memberForm").classList.toggle("show"));
document.getElementById("confirmMemberAdd").addEventListener("click", addFamilyMember);
document.getElementById("memberNameInput").addEventListener("keydown", e => { if (e.key === "Enter") addFamilyMember(); });

async function initFamilyMembers() {
  renderFamilyMembers("正在加载家庭成员...");

  try {
    const supabase = await window.getSupabaseClient();
    const { data, error } = await supabase
      .from("family_members")
      .select("*");

    if (error) throw error;

    familyMembers = data || [];
    if (!familyMembers.length) {
      const { data: created, error: createError } = await supabase
        .from("family_members")
        .insert({ name: "我" })
        .select("*")
        .single();

      if (createError) throw createError;
      familyMembers = created ? [created] : [];
    }

    activeFamilyMemberId = familyMembers[0]?.id || "";
    renderFamilyMembers();
    renderArchive();
  } catch (error) {
    console.error(error);
    renderFamilyMembers("家庭成员加载失败，请检查 Supabase family_members 表");
  }
}

function renderFamilyMembers(message = "") {
  const tabs = document.getElementById("memberTabs");
  if (!tabs) return;

  if (message) {
    tabs.innerHTML = `<div class="member-empty">${escapeHtml(message)}</div>`;
    return;
  }

  tabs.innerHTML = familyMembers.length
    ? familyMembers.map(member => `<button class="member-chip ${String(member.id) === String(activeFamilyMemberId) ? "active" : ""}" data-family-member="${escapeHtml(member.id)}">${escapeHtml(member.name || "未命名")}</button>`).join("")
    : `<div class="member-empty">还没有家庭成员。</div>`;

  tabs.querySelectorAll("[data-family-member]").forEach(btn => {
    btn.addEventListener("click", () => {
      activeFamilyMemberId = btn.dataset.familyMember;
      renderFamilyMembers();
      showToast(`已切换到 ${currentFamilyMemberName()} 的健康档案`);
    });
  });
}

function currentFamilyMemberName() {
  return (familyMembers.find(member => String(member.id) === String(activeFamilyMemberId)) || {}).name || "当前成员";
}

async function ensureActiveFamilyMember(supabase) {
  if (activeFamilyMemberId) return activeFamilyMemberId;

  const { data, error } = await supabase
    .from("family_members")
    .select("*")
    .limit(1);

  if (error) throw error;

  familyMembers = data || [];
  if (!familyMembers.length) {
    const { data: created, error: createError } = await supabase
      .from("family_members")
      .insert({ name: "我" })
      .select("*")
      .single();

    if (createError) throw createError;
    familyMembers = created ? [created] : [];
  }

  activeFamilyMemberId = familyMembers[0]?.id || "";
  renderFamilyMembers();
  return activeFamilyMemberId;
}

async function addFamilyMember() {
  const input = document.getElementById("memberNameInput");
  const name = input.value.trim();
  if (!name) {
    showToast("请输入成员姓名");
    return;
  }

  try {
    const supabase = await window.getSupabaseClient();
    const { data, error } = await supabase
      .from("family_members")
      .insert({ name })
      .select("*")
      .single();

    if (error) throw error;

    familyMembers.push(data);
    activeFamilyMemberId = data.id;
    input.value = "";
    document.getElementById("memberForm").classList.remove("show");
    renderFamilyMembers();
    showToast(`已添加 ${name}`);
  } catch (error) {
    console.error(error);
    alert(error.message || "添加家庭成员失败");
  }
}

initFamilyMembers();
initDocuments();

function activateScreen(screen) {
  document.querySelectorAll(".nav button").forEach(x => x.classList.toggle("active", x.dataset.screen === screen));
  document.querySelectorAll(".screen").forEach(x => x.classList.toggle("active", x.id === screen));
  renderAll();
}

document.querySelectorAll(".nav button").forEach(btn => {
  btn.addEventListener("click", () => activateScreen(btn.dataset.screen));
});
document.querySelectorAll("[data-jump-screen]").forEach(btn => {
  btn.addEventListener("click", () => activateScreen(btn.dataset.jumpScreen));
});

function bindFilePickerEvents() {
  const fileInput = document.getElementById("fileInput");
  const pickFile = document.getElementById("pickFile");
  const dropZone = document.getElementById("dropZone");

  console.log("fileInput", fileInput);
  console.log("pickFile", pickFile);

  if (!fileInput || !pickFile || !dropZone) return;

  pickFile.addEventListener("click", () => {
    fileInput.click();
  });
  dropZone.addEventListener("dragover", e => e.preventDefault());
  dropZone.addEventListener("drop", e => {
    e.preventDefault();
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    console.log("file selected", file.name);
    handleFile(file);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindFilePickerEvents);
} else {
  bindFilePickerEvents();
}

async function handleFile(file) {
  if (!isSupportedReportFile(file)) {
    alert("仅支持上传图片或PDF文件");
    return;
  }

  selectedFile = file;
  sourceFile = { name: file.name, type: file.type, size: file.size };
  const preview = document.getElementById("preview");
  const ocrBtn = document.getElementById("ocrBtn");
  const ocrStatus = document.getElementById("ocrStatus");
  ocrBtn.disabled = !file.type.startsWith("image/");
  ocrStatus.style.display = "block";
  preview.style.display = "block";
  if (file.type.startsWith("image/")) {
    const reader = new FileReader();
    reader.onload = e => preview.innerHTML = `<img src="${e.target.result}" alt="报告预览">`;
    reader.readAsDataURL(file);
    ocrStatus.textContent = "图片已本地预览。纯 HTML 展示版不上传图片；请粘贴 OCR 文本，或点击“载入示例报告”体验解析。";
  } else if (file.type === "application/pdf") {
    const url = URL.createObjectURL(file);
    preview.innerHTML = `<embed src="${url}" type="application/pdf">`;
    ocrStatus.textContent = "PDF 已预览。当前百度 OCR 接口只接图片，请先将 PDF 页面转成图片后上传。";
  } else {
    preview.innerHTML = `<div class="empty">已接收 ${escapeHtml(file.name)}，请粘贴报告文字后解析。</div>`;
    ocrStatus.textContent = "当前文件类型不能 OCR，请粘贴文字或手动录入。";
  }
  showToast("文件已本地预览，请粘贴 OCR 文本或载入示例报告");

  try {
    await uploadReportFile(file);
  } catch (error) {
    console.error(error);
    alert(error.message || "上传失败");
  }
}

function isSupportedReportFile(file) {
  return file.type.startsWith("image/") || file.type === "application/pdf";
}

async function uploadReportFile(file) {
  const supabase = await window.getSupabaseClient();
  const fileName = `${Date.now()}${file.name}`;
  const { error } = await supabase.storage.from(REPORTS_BUCKET).upload(fileName, file);

  if (error) {
    throw error;
  }

  const { data } = supabase.storage.from(REPORTS_BUCKET).getPublicUrl(fileName);
  const url = data.publicUrl;
  console.log("uploaded url", url);
  await createDocumentRecord(supabase, file, url);
  alert("上传成功");
  return url;
}

async function createDocumentRecord(supabase, file, storageUrl) {
  const memberId = await ensureActiveFamilyMember(supabase);
  const documentRecord = {
    member_id: memberId,
    title: file.name,
    category: document.getElementById("reportType").value || "体检报告",
    report_date: document.getElementById("reportDate").value || today(),
    source_type: file.type === "application/pdf" ? "pdf" : "image",
    storage_url: storageUrl,
    created_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from(DOCUMENTS_TABLE)
    .insert(documentRecord);

  if (error) throw error;
}

document.getElementById("ocrBtn").addEventListener("click", recognizeSelectedFile);

async function recognizeSelectedFile() {
  const ocrStatus = document.getElementById("ocrStatus");
  ocrStatus.style.display = "block";
  ocrStatus.textContent = "当前是纯 HTML 展示版，不连接后端 OCR。请粘贴 OCR 文本，或点击“载入示例报告”体验完整流程。";
  showToast("展示版不连接后端 OCR");
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

document.getElementById("loadSample").addEventListener("click", () => {
  document.getElementById("rawText").value = SAMPLE_TEXT;
  document.getElementById("reportDate").value = "2026-06-10";
  document.getElementById("institution").value = "上海市某体检中心";
  document.getElementById("reportType").value = "年度体检";
  parseText();
});
document.getElementById("parseBtn").addEventListener("click", parseText);
document.getElementById("addBlankBtn").addEventListener("click", () => {
  draft.push({ name: "", alias: "", value: "", unit: "", referenceRange: "", status: "ok", confidence: 1, originalText: "" });
  renderDraft();
});
document.getElementById("clearDraft").addEventListener("click", () => { draft = []; renderDraft(); });

function parseText() {
  const text = document.getElementById("rawText").value.trim();
  if (!text) { showToast("先粘贴报告文字，或载入示例报告"); return; }
  draft = parseIndicators(text);
  if (!draft.length) showToast("没有识别到常见指标，请手动添加字段");
  renderDraft();
}

function parseIndicators(text) {
  const tableItems = parseTableText(text);
  const inlineItems = parseInlineText(text);
  const merged = [];
  for (const item of [...tableItems, ...inlineItems]) {
    if (!item.name || item.value === "") continue;
    const key = `${item.alias}|${item.value}|${item.referenceRange || ""}`;
    if (!merged.some(x => `${x.alias}|${x.value}|${x.referenceRange || ""}` === key)) merged.push(item);
  }
  return merged;
}

function parseInlineText(text) {
  const result = [];
  const lines = text.split(/\n|；|;/).map(x => x.trim()).filter(Boolean);
  const names = Object.keys(ALIASES).sort((a, b) => b.length - a.length);
  for (const line of lines) {
    const normalizedLine = normalizeOcrLine(line);
    const hit = names.find(n => normalizedLine.toUpperCase().includes(n.toUpperCase()));
    const val = normalizedLine.match(/(-?\d+(?:\.\d+)?)/);
    if (!hit || !val) continue;
    const after = normalizedLine.slice(normalizedLine.indexOf(val[0]) + val[0].length);
    const unitMatch = after.match(/^\s*[↑↓]?\s*([a-zA-Zμuμ\/%]+(?:\/[a-zA-Z]+)?)/);
    const refMatch = normalizedLine.match(/(?:参考|范围|ref)?[:：\s]*(<\s*\d+(?:\.\d+)?|>\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*[-~]\s*\d+(?:\.\d+)?)/i);
    const referenceRange = refMatch ? refMatch[1].replace(/\s+/g, "") : "";
    const explicitStatus = normalizedLine.includes("↑") ? "high" : normalizedLine.includes("↓") ? "low" : "";
    const item = {
      name: canonicalName(hit),
      alias: ALIASES[hit] || hit,
      value: val[0],
      unit: unitMatch ? normalizeUnit(unitMatch[1]) : "",
      referenceRange,
      status: explicitStatus || inferStatus(Number(val[0]), referenceRange),
      confidence: refMatch ? 0.88 : 0.72,
      originalText: normalizedLine
    };
    result.push(item);
  }
  return result;
}

function parseTableText(text) {
  const lines = text.split(/\n|；|;/).map(normalizeOcrLine).map(x => x.trim()).filter(Boolean);
  const result = [];
  const names = Object.keys(ALIASES).sort((a, b) => b.length - a.length);
  const headerWords = new Set(["检验项目", "结果", "单位", "参考范围"]);
  let current = null;

  for (const line of lines) {
    if (headerWords.has(line)) continue;

    const name = names.find(n => line.toUpperCase() === n.toUpperCase()) ||
      names.find(n => line.length > 2 && line.toUpperCase().includes(n.toUpperCase()) && !hasNumber(line));
    if (name) {
      if (current && current.name && current.value !== "") result.push(finalizeParsedItem(current));
      current = {
        name: canonicalName(name),
        alias: ALIASES[name] || name,
        value: "",
        unit: "",
        referenceRange: "",
        status: "",
        confidence: 0.82,
        originalText: line
      };
      continue;
    }

    if (!current) continue;

    if (current.value === "" && isNumberLine(line)) {
      current.value = line.match(/-?\d+(?:\.\d+)?/)[0];
      current.originalText += " " + line;
      continue;
    }

    const refInLine = extractReferenceRange(line);
    const statusInLine = line.includes("↑") ? "high" : line.includes("↓") ? "low" : "";
    const unitInLine = extractUnit(line);
    if (unitInLine && !current.unit) current.unit = unitInLine;
    if (statusInLine) current.status = statusInLine;
    if (refInLine) current.referenceRange = refInLine;
    if (unitInLine || statusInLine || refInLine) current.originalText += " " + line;

    if (current.value !== "" && current.referenceRange) {
      result.push(finalizeParsedItem(current));
      current = null;
    }
  }

  if (current && current.name && current.value !== "") result.push(finalizeParsedItem(current));
  return result;
}

function finalizeParsedItem(item) {
  return {
    ...item,
    unit: normalizeUnit(item.unit),
    status: item.status || inferStatus(Number(item.value), item.referenceRange),
    confidence: item.referenceRange ? item.confidence : 0.68
  };
}

function normalizeOcrLine(line) {
  return String(line || "")
    .replace(/[：]/g, ":")
    .replace(/[－—–~～]/g, "-")
    .replace(/μmol\/L(?=\d)/g, "μmol/L ")
    .replace(/μmol\/L1/g, "μmol/L 1")
    .replace(/↓\s*/g, "↓")
    .replace(/↑\s*/g, "↑")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUnit(unit) {
  return String(unit || "").replace(/^u/, "μ").replace(/umol/i, "μmol").trim();
}

function hasNumber(line) {
  return /-?\d+(?:\.\d+)?/.test(line);
}

function isNumberLine(line) {
  return /^-?\d+(?:\.\d+)?$/.test(line);
}

function extractReferenceRange(line) {
  const normalized = normalizeOcrLine(line);
  const match = normalized.match(/(<\s*\d+(?:\.\d+)?|>\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?)/);
  return match ? match[1].replace(/\s+/g, "") : "";
}

function extractUnit(line) {
  const normalized = normalizeOcrLine(line).replace(/[↑↓]/g, "");
  const match = normalized.match(/([μu]mol\/L|mmol\/L|g\/L|mg\/L|U\/L|%)/i);
  return match ? normalizeUnit(match[1]) : "";
}

function canonicalName(name) {
  const map = { "TC":"总胆固醇", "LDL-C":"低密度脂蛋白胆固醇", "LDL":"低密度脂蛋白胆固醇", "HDL-C":"高密度脂蛋白胆固醇", "HDL":"高密度脂蛋白胆固醇", "TG":"甘油三酯", "GLU":"葡萄糖", "UA":"尿酸", "CREA":"肌酐", "ALT":"谷丙转氨酶", "AST":"谷草转氨酶", "WBC":"白细胞", "HGB":"血红蛋白" };
  return map[name] || name;
}
function inferStatus(value, ref) {
  if (!ref) return "pending";
  const range = ref.match(/^(\d+(?:\.\d+)?)[-~](\d+(?:\.\d+)?)$/);
  const lt = ref.match(/^<(\d+(?:\.\d+)?)$/);
  const gt = ref.match(/^>(\d+(?:\.\d+)?)$/);
  if (range) return value < Number(range[1]) ? "low" : value > Number(range[2]) ? "high" : "ok";
  if (lt) return value > Number(lt[1]) ? "high" : "ok";
  if (gt) return value < Number(gt[1]) ? "low" : "ok";
  return "pending";
}
function statusLabel(s) { return ({ high: "偏高", low: "偏低", ok: "正常", pending: "待确认" })[s] || "待确认"; }

function renderDraft() {
  const tbody = document.getElementById("draftRows");
  if (!draft.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">解析后会在这里确认字段。所有字段保存前都可修改。</td></tr>`;
    renderSummary();
    return;
  }
  tbody.innerHTML = draft.map((d, i) => `<tr>
    <td><input value="${escapeHtml(d.name)}" data-i="${i}" data-k="name"></td>
    <td><input type="number" step="any" value="${escapeHtml(d.value)}" data-i="${i}" data-k="value"></td>
    <td><input value="${escapeHtml(d.unit)}" data-i="${i}" data-k="unit"></td>
    <td><input value="${escapeHtml(d.referenceRange)}" data-i="${i}" data-k="referenceRange"></td>
    <td><select data-i="${i}" data-k="status">
      ${["ok","high","low","pending"].map(s => `<option value="${s}" ${d.status === s ? "selected" : ""}>${statusLabel(s)}</option>`).join("")}
    </select></td>
    <td><button class="btn danger" data-remove="${i}">删</button></td>
  </tr>`).join("");
  tbody.querySelectorAll("input,select").forEach(el => el.addEventListener("input", e => {
    const i = Number(e.target.dataset.i), k = e.target.dataset.k;
    draft[i][k] = e.target.value;
    if (k === "name") draft[i].alias = ALIASES[e.target.value] || draft[i].alias || e.target.value;
    if (k === "value" || k === "referenceRange") draft[i].status = inferStatus(Number(draft[i].value), draft[i].referenceRange);
    renderSummary();
  }));
  tbody.querySelectorAll("[data-remove]").forEach(btn => btn.addEventListener("click", () => {
    draft.splice(Number(btn.dataset.remove), 1);
    renderDraft();
  }));
  renderSummary();
}

document.getElementById("saveReport").addEventListener("click", () => {
  const valid = draft.filter(d => d.name && d.value !== "");
  if (!valid.length) { showToast("至少确认一项指标后再保存"); return; }
  const report = {
    id: id("report"),
    userId: "local-user",
    reportDate: document.getElementById("reportDate").value || today(),
    institution: document.getElementById("institution").value || "未填写机构",
    reportType: document.getElementById("reportType").value || "体检报告",
    sourceFile,
    createdAt: new Date().toISOString(),
    status: valid.some(d => d.status === "high" || d.status === "low") ? "abnormal" : "ok"
  };
  const indicators = valid.map(d => ({
    id: id("ind"),
    reportId: report.id,
    name: d.name,
    alias: d.alias || ALIASES[d.name] || d.name,
    value: Number(d.value),
    unit: d.unit,
    referenceRange: d.referenceRange,
    status: d.status,
    confidence: d.confidence || 1,
    originalText: d.originalText || ""
  }));
  state.reports.push(report);
  state.indicators.push(...indicators);
  persist();
  draft = [];
  sourceFile = null;
  selectedFile = null;
  document.getElementById("rawText").value = "";
  document.getElementById("preview").style.display = "none";
  document.getElementById("ocrStatus").style.display = "none";
  document.getElementById("ocrBtn").disabled = true;
  renderAll();
  showToast("已保存到个人健康档案");
});

function renderSummary() {
  const items = draft.length ? draft : latestIndicators();
  const abnormal = items.filter(d => d.status === "high" || d.status === "low");
  const summary = document.getElementById("summaryList");
  const questions = document.getElementById("doctorQuestions");
  if (!items.length) {
    summary.innerHTML = "<li>上传或载入报告后，这里会生成本次体检总结。</li>";
    questions.innerHTML = "<li>确认异常项后，会生成适合复诊时询问医生的问题。</li>";
    return;
  }
  summary.innerHTML = [
    `共识别 ${items.length} 项指标，其中 ${abnormal.length} 项异常。`,
    abnormal.length ? `异常项：${abnormal.map(x => `${x.name} ${x.value}${x.unit || ""}（${statusLabel(x.status)}）`).join("、")}。` : "本次已确认指标均在参考范围内。",
    compareSentence(items)
  ].map(x => `<li>${escapeHtml(x)}</li>`).join("");
  questions.innerHTML = (abnormal.length ? abnormal.slice(0, 4).map(x => `${x.name} ${statusLabel(x.status)}是否需要复查？多久复查合适？`) : ["这些指标是否需要结合年龄、体重、家族史进一步判断？", "下次年度体检还需要增加哪些项目？"])
    .map(x => `<li>${escapeHtml(x)}</li>`).join("");
}
function latestIndicators() {
  const report = [...state.reports].sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0];
  return report ? state.indicators.filter(i => i.reportId === report.id) : [];
}
function compareSentence(items) {
  const sentences = [];
  for (const item of items) {
    const history = trendFor(item.alias || item.name, item.unit).filter(p => p.reportId !== item.reportId);
    if (history.length) {
      const prev = history[history.length - 1];
      const diff = Number(item.value) - Number(prev.value);
      sentences.push(`${item.name} 较上次 ${diff >= 0 ? "上升" : "下降"} ${Math.abs(diff).toFixed(2)}${item.unit || ""}`);
    }
  }
  return sentences[0] || "保存多次报告后，会自动比较本次与上次的变化。";
}

function renderStats() {
  document.getElementById("statReports").textContent = documentsLoaded ? documents.length : state.reports.length;
  document.getElementById("statIndicators").textContent = state.indicators.length;
  document.getElementById("statAbnormal").textContent = state.indicators.filter(i => i.status === "high" || i.status === "low").length;
  const latestDocument = [...documents].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
  const latestReport = [...state.reports].sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0];
  document.getElementById("statLatest").textContent = latestDocument ? formatDate(latestDocument.report_date || latestDocument.created_at).slice(5) : latestReport ? latestReport.reportDate.slice(5) : "-";
}

async function initDocuments() {
  renderArchive();

  try {
    const supabase = await window.getSupabaseClient();
    const { data, error } = await supabase
      .from(DOCUMENTS_TABLE)
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    documents = data || [];
    documentsLoaded = true;
    renderAll();
  } catch (error) {
    console.error(error);
    documentsLoaded = true;
    documents = [];
    renderArchive("Supabase documents 读取失败，请检查 documents 表");
  }
}

function renderArchive(message = "") {
  if (documentsLoaded || message) {
    renderDocumentsArchive(message);
    return;
  }

  document.getElementById("archiveList").innerHTML = `<div class="empty">正在加载档案记录...</div>`;
}

function renderDocumentsArchive(message = "") {
  const yearFilter = document.getElementById("yearFilter");
  const years = [...new Set(documents.map(d => formatDate(d.report_date || d.created_at).slice(0, 4)).filter(Boolean))].sort((a, b) => b.localeCompare(a));
  const current = yearFilter.value;
  yearFilter.innerHTML = `<option value="">全部年份</option>` + years.map(y => `<option value="${y}">${y}</option>`).join("");
  if (years.includes(current)) yearFilter.value = current;
  const type = document.getElementById("typeFilter").value.trim();
  const rows = documents.filter(d => {
    const date = formatDate(d.report_date || d.created_at);
    return (!yearFilter.value || date.startsWith(yearFilter.value)) &&
      (!type || String(d.category || "").includes(type));
  }).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

  if (message) {
    document.getElementById("archiveList").innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
    return;
  }

  document.getElementById("archiveList").innerHTML = rows.length ? rows.map(d => {
    const date = formatDate(d.report_date || d.created_at);
    return `<div class="report-row clickable" data-document-id="${escapeHtml(d.id)}">
      <div>
        <h3>${escapeHtml(date)} · ${escapeHtml(d.title || "未命名档案")} <span class="tag pending">${escapeHtml(d.category || "资料")}</span></h3>
        <p>${escapeHtml(memberNameById(d.member_id))} · ${escapeHtml(d.source_type || "上传")} · 来源：Supabase documents</p>
        <p>${escapeHtml(d.storage_url || "")}</p>
      </div>
    </div>`;
  }).join("") : `<div class="empty">还没有符合条件的报告。</div>`;

  document.querySelectorAll("[data-document-id]").forEach(row => {
    row.addEventListener("click", () => openDocumentDetail(row.dataset.documentId));
  });
}
["yearFilter","typeFilter","instFilter","statusFilter"].forEach(id => document.getElementById(id).addEventListener("input", () => renderArchive()));

function formatDate(value) {
  return String(value || "").slice(0, 10);
}

function memberNameById(memberId) {
  return (familyMembers.find(member => String(member.id) === String(memberId)) || {}).name || "未指定成员";
}

function openDocumentDetail(documentId) {
  const documentRecord = documents.find(d => String(d.id) === String(documentId));
  if (!documentRecord) return;

  const modal = document.getElementById("detailModal");
  document.getElementById("detailTitle").textContent = documentRecord.title || "档案详情";
  document.getElementById("detailSubtitle").textContent = `${formatDate(documentRecord.report_date || documentRecord.created_at)} · ${documentRecord.category || "资料"}`;
  document.getElementById("detailBody").innerHTML = buildDocumentDetail(documentRecord);
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}

function closeDocumentDetail() {
  const modal = document.getElementById("detailModal");
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}

function buildDocumentDetail(documentRecord) {
  const storageUrl = documentRecord.storage_url || "";
  const preview = storageUrl
    ? documentRecord.source_type === "pdf" || /\.pdf($|\?)/i.test(storageUrl)
      ? `<embed src="${escapeHtml(storageUrl)}" type="application/pdf">`
      : `<img src="${escapeHtml(storageUrl)}" alt="原始资料预览">`
    : `<div class="empty">没有可预览的 storage_url。</div>`;

  return `<div class="detail-grid">
      <div class="detail-kv"><small>标题</small><strong>${escapeHtml(documentRecord.title || "未命名档案")}</strong></div>
      <div class="detail-kv"><small>所属家庭成员</small><strong>${escapeHtml(memberNameById(documentRecord.member_id))}</strong></div>
      <div class="detail-kv"><small>资料类型</small><strong>${escapeHtml(documentRecord.category || "资料")}</strong></div>
      <div class="detail-kv"><small>上传日期</small><strong>${escapeHtml(formatDate(documentRecord.created_at))}</strong></div>
    </div>
    <div class="detail-grid">
      <div class="detail-kv"><small>storage_url</small><strong>${escapeHtml(storageUrl)}</strong></div>
      <div class="detail-kv"><small>报告日期</small><strong>${escapeHtml(formatDate(documentRecord.report_date))}</strong></div>
      <div class="detail-kv"><small>来源类型</small><strong>${escapeHtml(documentRecord.source_type || "上传")}</strong></div>
      <div class="detail-kv"><small>档案 ID</small><strong>${escapeHtml(documentRecord.id || "")}</strong></div>
    </div>
    <h3 class="section-title">原始图片/PDF预览</h3>
    <div class="detail-preview">${preview}</div>
    <h3 class="section-title">OCR 内容</h3>
    <div class="empty" style="padding:14px">暂未接入 OCR。</div>
    <h3 class="section-title" style="margin-top:16px">指标列表</h3>
    <div class="empty" style="padding:14px">暂未关联指标。</div>`;
}

document.getElementById("closeDetail").addEventListener("click", closeDocumentDetail);
document.getElementById("detailModal").addEventListener("click", e => {
  if (e.target.id === "detailModal") closeDocumentDetail();
});

function deleteReport(reportId) {
  state.reports = state.reports.filter(r => r.id !== reportId);
  state.indicators = state.indicators.filter(i => i.reportId !== reportId);
  persist();
  renderAll();
  showToast("报告和关联指标已删除");
}

function indicatorGroups() {
  const groups = {};
  for (const i of state.indicators) {
    const key = `${i.alias || i.name}|${i.unit || ""}`;
    if (!groups[key]) groups[key] = { key, name: i.name, alias: i.alias || i.name, unit: i.unit || "", count: 0 };
    groups[key].count++;
  }
  return Object.values(groups).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
function trendFor(alias, unit) {
  return state.indicators
    .filter(i => (i.alias || i.name) === alias && (unit === undefined || (i.unit || "") === unit))
    .map(i => ({ ...i, report: state.reports.find(r => r.id === i.reportId) }))
    .filter(i => i.report)
    .sort((a, b) => a.report.reportDate.localeCompare(b.report.reportDate));
}
function renderTrends() {
  const groups = indicatorGroups();
  if (!groups.length) {
    document.getElementById("indicatorList").innerHTML = `<div class="empty">保存报告后会出现指标列表。</div>`;
    document.getElementById("trendChart").innerHTML = "";
    document.getElementById("trendMeta").innerHTML = "";
    return;
  }
  if (!selectedIndicator || !groups.some(g => g.key === selectedIndicator)) selectedIndicator = groups[0].key;
  document.getElementById("indicatorList").innerHTML = groups.map(g => `<button class="${g.key === selectedIndicator ? "active" : ""}" data-key="${escapeHtml(g.key)}">${escapeHtml(g.name)}<br><small>${escapeHtml(g.alias)} · ${g.count} 次</small></button>`).join("");
  document.querySelectorAll("[data-key]").forEach(btn => btn.addEventListener("click", () => { selectedIndicator = btn.dataset.key; renderTrends(); }));
  const group = groups.find(g => g.key === selectedIndicator);
  renderTrendChart(group);
}
function renderTrendChart(group) {
  const points = trendFor(group.alias, group.unit);
  document.getElementById("trendTitle").textContent = `${group.name} · 指标详情`;
  const svg = document.getElementById("trendChart");
  if (!points.length) { svg.innerHTML = ""; return; }
  const w = 720, h = 280, pl = 56, pr = 28, pt = 26, pb = 48;
  const values = points.map(p => Number(p.value));
  const min = Math.min(...values) * 0.92;
  const max = Math.max(...values) * 1.08 || 1;
  const x = i => points.length === 1 ? w / 2 : pl + (w - pl - pr) * i / (points.length - 1);
  const y = v => pt + (h - pt - pb) * (1 - (v - min) / (max - min || 1));
  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  svg.innerHTML = `
    <rect x="0" y="0" width="${w}" height="${h}" fill="#fff"/>
    ${[0,1,2,3].map(i => `<line x1="${pl}" y1="${pt + (h-pt-pb)*i/3}" x2="${w-pr}" y2="${pt + (h-pt-pb)*i/3}" stroke="#dfe9e7"/>`).join("")}
    <polyline points="${line}" fill="none" stroke="#1f6d6e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <polygon points="${pl},${h-pb} ${line} ${w-pr},${h-pb}" fill="#2d9596" opacity=".12"/>
    ${points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.value)}" r="6" fill="${p.status === "high" || p.status === "low" ? "#d86535" : "#1f6d6e"}" stroke="#fff" stroke-width="2"/>
      <text x="${x(i)}" y="${y(p.value)-12}" font-size="12" text-anchor="middle" fill="#172526" font-weight="700">${p.value}</text>
      <text x="${x(i)}" y="${h-22}" font-size="11" text-anchor="middle" fill="#657475">${p.report.reportDate.slice(2)}</text>`).join("")}`;
  const first = points[0], last = points[points.length - 1];
  const diff = last.value - first.value;
  const abnormal = points.filter(p => p.status === "high" || p.status === "low").length;
  document.getElementById("trendMeta").innerHTML = `
    <li>最新：${escapeHtml(last.value)} ${escapeHtml(last.unit || "")}（${statusLabel(last.status)}），来源 ${escapeHtml(last.report.reportDate)} ${escapeHtml(last.report.institution)}。</li>
    <li>首末变化：${diff >= 0 ? "上升" : "下降"} ${Math.abs(diff).toFixed(2)} ${escapeHtml(last.unit || "")}。</li>
    <li>历史异常次数：${abnormal} / ${points.length}。</li>`;
}

document.querySelectorAll(".suggestions button").forEach(btn => btn.addEventListener("click", () => ask(btn.dataset.q)));
document.getElementById("qaSend").addEventListener("click", () => {
  const input = document.getElementById("qaInput");
  if (!input.value.trim()) return;
  ask(input.value.trim());
  input.value = "";
});
document.getElementById("qaInput").addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("qaSend").click(); });
function ask(q) {
  const msgs = document.getElementById("msgs");
  msgs.insertAdjacentHTML("beforeend", `<div class="msg user">${escapeHtml(q)}</div>`);
  const answer = answerQuestion(q);
  setTimeout(() => {
    msgs.insertAdjacentHTML("beforeend", `<div class="msg ai">${answer}<br><br><small>数据来源：本机已保存的结构化体检指标。以上为信息辅助，非医疗诊断。</small></div>`);
    msgs.scrollTop = msgs.scrollHeight;
  }, 250);
}
function answerQuestion(q) {
  if (!state.reports.length) return "还没有保存报告。请先在首页上传或载入示例报告，并保存到健康档案。";
  const latest = [...state.reports].sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0];
  const inds = state.indicators.filter(i => i.reportId === latest.id);
  const ab = inds.filter(i => i.status === "high" || i.status === "low");
  if (q.includes("异常") || q.includes("最近")) {
    return ab.length ? `最近一次报告是 ${latest.reportDate} ${latest.reportType}，异常项包括：${ab.map(i => `${i.name} ${i.value}${i.unit || ""}（${statusLabel(i.status)}）`).join("、")}。` : `最近一次报告是 ${latest.reportDate}，已保存指标均未标记为异常。`;
  }
  if (q.includes("趋势") || q.includes("胆固醇") || q.includes("尿酸") || q.includes("血糖")) {
    const target = Object.keys(ALIASES).find(k => q.toUpperCase().includes(k.toUpperCase()));
    const alias = target ? ALIASES[target] : (indicatorGroups()[0] || {}).alias;
    const points = trendFor(alias);
    if (!points.length) return "没有找到对应指标的历史记录。可以先多保存几次同类报告，趋势会自动合并。";
    const first = points[0], last = points[points.length - 1];
    const diff = last.value - first.value;
    return `${last.name} 共有 ${points.length} 次记录，从 ${first.report.reportDate} 的 ${first.value}${first.unit || ""} 到 ${last.report.reportDate} 的 ${last.value}${last.unit || ""}，整体${diff >= 0 ? "上升" : "下降"} ${Math.abs(diff).toFixed(2)}${last.unit || ""}。`;
  }
  if (q.includes("医生") || q.includes("复查") || q.includes("摘要")) {
    return `给医生看的摘要：最近报告 ${latest.reportDate}，机构 ${latest.institution}，共 ${inds.length} 项指标，${ab.length} 项异常。建议重点询问：${(ab.length ? ab : inds.slice(0, 3)).map(i => `${i.name} 是否需要复查或结合其他检查判断`).join("；")}。`;
  }
  return `我找到了 ${state.reports.length} 份报告和 ${state.indicators.length} 项指标。你可以问“最近一次体检有哪些异常”“某个指标趋势怎么样”或“帮我生成给医生看的摘要”。`;
}

document.getElementById("exportCsv").addEventListener("click", () => {
  const rows = [["reportId","reportDate","institution","reportType","name","alias","value","unit","referenceRange","status","confidence","originalText"]];
  for (const i of state.indicators) {
    const r = state.reports.find(x => x.id === i.reportId) || {};
    rows.push([i.reportId, r.reportDate, r.institution, r.reportType, i.name, i.alias, i.value, i.unit, i.referenceRange, i.status, i.confidence, i.originalText]);
  }
  download("indicators.csv", rows.map(row => row.map(csvCell).join(",")).join("\n"), "text/csv;charset=utf-8");
});
function csvCell(v) { return `"${String(v ?? "").replace(/"/g, '""')}"`; }
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
document.getElementById("printPdf").addEventListener("click", () => {
  const latest = [...state.reports].sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0];
  document.getElementById("printSummary").innerHTML = buildPrintSummary(latest);
  window.print();
});
function buildPrintSummary(latest) {
  const reports = latest ? [latest] : state.reports;
  const inds = latest ? state.indicators.filter(i => i.reportId === latest.id) : state.indicators;
  return `<h1>Health Timeline 个人体检摘要</h1>
    <p>生成时间：${new Date().toLocaleString()}</p>
    <p>报告数量：${reports.length}，指标数量：${inds.length}，异常指标：${inds.filter(i => i.status === "high" || i.status === "low").length}</p>
    <table><thead><tr><th>指标</th><th>数值</th><th>单位</th><th>参考范围</th><th>状态</th></tr></thead><tbody>
    ${inds.map(i => `<tr><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.value)}</td><td>${escapeHtml(i.unit || "")}</td><td>${escapeHtml(i.referenceRange || "")}</td><td>${statusLabel(i.status)}</td></tr>`).join("")}
    </tbody></table><p>说明：本摘要为信息整理，不构成医疗诊断。</p>`;
}
document.getElementById("deleteAll").addEventListener("click", () => {
  if (!confirm("确定删除本浏览器中的全部健康档案吗？此操作不可恢复。")) return;
  state = { reports: [], indicators: [] };
  persist();
  renderAll();
  showToast("本地数据已清空");
});

function renderAll() {
  renderStats();
  renderDraft();
  renderArchive();
  renderTrends();
}
renderAll();
