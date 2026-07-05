console.log("app.js loaded");

const STORAGE_KEY = "health_timeline_mvp_v1";
const AUTH_STORAGE_KEY = "health_timeline_current_user_v1";
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
const DOCUMENT_CATEGORIES = ["体检报告", "检验化验", "影像检查", "门诊病历", "处方", "其他资料"];

let currentUser = loadCurrentUser();
let state = loadState();
let draft = [];
let sourceFile = null;
let selectedFile = null;
let selectedIndicator = null;
let selectedTimelineReportId = "";
let familyMembers = [];
let activeFamilyMemberId = "";
let documents = [];
let backendReports = [];
let documentsLoaded = false;
const REPORTS_BUCKET = "reports";
const DOCUMENTS_TABLE = "documents";
const USERS_TABLE = "users";

function loadCurrentUser() {
  try {
    const user = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
    return user && user.id && user.email ? user : null;
  } catch {
    return null;
  }
}

function persistCurrentUser(user) {
  currentUser = user;
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function emailToUserId(email) {
  const seed = `healthtimeline:${email}`;
  const hash = await stableHashBytes(seed);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.slice(0, 16).map(byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function stableHashBytes(text) {
  if (window.crypto?.subtle && window.TextEncoder) {
    const bytes = new TextEncoder().encode(text);
    return Array.from(new Uint8Array(await window.crypto.subtle.digest("SHA-256", bytes)));
  }

  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 16777619);
    h2 ^= code + i;
    h2 = Math.imul(h2, 2246822519);
  }

  const bytes = [];
  for (let i = 0; i < 32; i += 1) {
    h1 = Math.imul(h1 ^ (h1 >>> 13), 3266489917);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 668265263);
    bytes.push(((h1 >>> ((i % 4) * 8)) ^ (h2 >>> (((i + 1) % 4) * 8))) & 0xff);
  }
  return bytes;
}

function isOptionalUsersTableError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return ["42P01", "42703", "PGRST205"].includes(code) || /public\.users|schema cache|USERS_TABLE|users/i.test(message);
}

function userStorageKey() {
  return currentUser?.id ? `${STORAGE_KEY}_${currentUser.id}` : `${STORAGE_KEY}_anonymous`;
}

function currentUserId() {
  if (!currentUser?.id) throw new Error("请先登录");
  return currentUser.id;
}

function storageUserPath() {
  return String(currentUserId()).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(userStorageKey()) || "{}");
    return { reports: saved.reports || [], indicators: saved.indicators || [], documents: saved.documents || [] };
  } catch {
    return { reports: [], indicators: [], documents: [] };
  }
}
function persist() { localStorage.setItem(userStorageKey(), JSON.stringify(state)); }
function id(prefix) { return prefix + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36); }
function showToast(text) {
  const t = document.getElementById("toast");
  t.textContent = text; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}
function today() { return new Date().toISOString().slice(0, 10); }
function escapeHtml(s) { return String(s || "").replace(/[&<>"']/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m])); }
function setSelectOptions(select, emptyLabel, values) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = (emptyLabel ? `<option value="">${escapeHtml(emptyLabel)}</option>` : "") +
    values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  if (values.includes(current)) select.value = current;
}

async function loginWithEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("请输入有效邮箱");
  }
  const userId = await emailToUserId(normalizedEmail);

  const supabase = await window.getSupabaseClient();
  const { data: existing, error: findError } = await supabase
    .from(USERS_TABLE)
    .select("*")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (findError && !isOptionalUsersTableError(findError)) throw findError;

  if (existing) {
    return {
      id: existing.id || userId,
      email: existing.email || normalizedEmail
    };
  }

  if (findError && isOptionalUsersTableError(findError)) {
    return { id: userId, email: normalizedEmail };
  }

  const { data: created, error: createError } = await supabase
    .from(USERS_TABLE)
    .insert({ id: userId, email: normalizedEmail })
    .select("*")
    .single();

  if (createError && !isOptionalUsersTableError(createError)) throw createError;

  if (createError && isOptionalUsersTableError(createError)) {
    return { id: userId, email: normalizedEmail };
  }

  return {
    id: created.id || userId,
    email: created.email || normalizedEmail
  };
}

async function handleLogin(event) {
  event.preventDefault();
  const input = document.getElementById("loginEmail");
  const button = document.getElementById("loginContinue");
  const error = document.getElementById("loginError");
  error.textContent = "";
  button.disabled = true;
  button.textContent = "Continuing...";

  try {
    const user = await loginWithEmail(input.value);
    persistCurrentUser(user);
    startAuthenticatedApp();
    showToast("已登录");
  } catch (err) {
    console.error(err);
    error.textContent = err.message || "登录失败，请稍后再试";
  } finally {
    button.disabled = false;
    button.textContent = "Continue";
  }
}

function startAuthenticatedApp() {
  if (!currentUser) return;
  document.body.classList.remove("auth-locked");
  document.body.classList.add("auth-ready");
  state = loadState();
  draft = [];
  sourceFile = null;
  selectedFile = null;
  selectedIndicator = null;
  selectedTimelineReportId = "";
  familyMembers = [];
  activeFamilyMemberId = "";
  documents = [];
  backendReports = [];
  documentsLoaded = false;
  initFamilyMembers();
  initDocuments();
  renderAll();
}

document.getElementById("reportDate").value = today();
document.getElementById("institution").value = "本地体检机构";
document.getElementById("reportType").value = "年度体检";
setSelectOptions(document.getElementById("docCategory"), "", DOCUMENT_CATEGORIES);
document.getElementById("toggleMemberForm").addEventListener("click", () => document.getElementById("memberForm").classList.toggle("show"));
document.getElementById("confirmMemberAdd").addEventListener("click", addFamilyMember);
document.getElementById("memberNameInput").addEventListener("keydown", e => { if (e.key === "Enter") addFamilyMember(); });

document.querySelectorAll("[data-upload-mode]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-upload-mode]").forEach(x => x.classList.toggle("active", x === btn));
    const isCt = btn.dataset.uploadMode === "ct";
    document.getElementById("docCategory").value = isCt ? "影像检查" : "体检报告";
    document.getElementById("reportType").value = isCt ? "影像检查" : "年度体检";
    document.querySelector("#dropZone strong").textContent = isCt ? "拖入 CT 二维码、影像截图或 PDF" : "拖入报告单、病历或检查单";
    document.querySelector("#dropZone p").textContent = isCt
      ? "可保存医院提供的影像二维码、链接或截图，复诊时方便快速找到。"
      : "支持 jpg / png / pdf。识别文字后会先判断资料类型，体检和化验类再进入指标分析。";
  });
});

async function initFamilyMembers() {
  renderFamilyMembers("正在加载家庭成员...");

  try {
    const userId = currentUserId();
    const supabase = await window.getSupabaseClient();
    const { data, error } = await supabase
      .from("family_members")
      .select("*")
      .eq("user_id", userId);

    if (error) throw error;

    familyMembers = data || [];
    if (!familyMembers.length) {
      const { data: created, error: createError } = await supabase
        .from("family_members")
        .insert({ name: "我", user_id: userId })
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
  renderHomeProfiles();
}

function currentFamilyMemberName() {
  return (familyMembers.find(member => String(member.id) === String(activeFamilyMemberId)) || {}).name || "当前成员";
}

async function ensureActiveFamilyMember(supabase) {
  if (activeFamilyMemberId) return activeFamilyMemberId;

  const userId = currentUserId();
  const { data, error } = await supabase
    .from("family_members")
    .select("*")
    .eq("user_id", userId)
    .limit(1);

  if (error) throw error;

  familyMembers = data || [];
  if (!familyMembers.length) {
    const { data: created, error: createError } = await supabase
      .from("family_members")
      .insert({ name: "我", user_id: userId })
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
      .insert({ name, user_id: currentUserId() })
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

function activateScreen(screen) {
  document.body.dataset.activeScreen = screen;
  document.querySelectorAll(".nav button").forEach(x => x.classList.toggle("active", x.dataset.screen === screen));
  document.querySelectorAll(".screen").forEach(x => x.classList.toggle("active", x.id === screen));
  const activeNav = document.querySelector(`.nav button[data-screen="${screen}"]`);
  const mobileTitle = document.getElementById("mobileScreenTitle");
  if (mobileTitle && activeNav) mobileTitle.textContent = activeNav.textContent.trim();
  toggleMobileNav(false);
  renderAll();
}

function toggleMobileNav(open) {
  document.body.classList.toggle("nav-open", open);
}

document.getElementById("mobileMenuBtn")?.addEventListener("click", () => {
  toggleMobileNav(!document.body.classList.contains("nav-open"));
});
document.getElementById("mobileMenuBtn")?.addEventListener("mouseenter", () => toggleMobileNav(true));
document.getElementById("mobileMenuBtn")?.addEventListener("focus", () => toggleMobileNav(true));
document.querySelector("aside")?.addEventListener("mouseleave", () => {
  if (window.matchMedia("(max-width: 980px)").matches) toggleMobileNav(false);
});
document.getElementById("navScrim")?.addEventListener("click", () => toggleMobileNav(false));

document.querySelectorAll(".nav button").forEach(btn => {
  btn.addEventListener("click", () => activateScreen(btn.dataset.screen));
});
document.querySelectorAll("[data-jump-screen]").forEach(btn => {
  btn.addEventListener("click", () => activateScreen(btn.dataset.jumpScreen));
});
document.querySelectorAll("[data-home-question]").forEach(btn => {
  btn.addEventListener("click", () => {
    activateScreen("assistant");
    ask(btn.dataset.homeQuestion);
  });
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
    ocrStatus.textContent = "图片已预览。上线后可点击“识别图片”调用服务器百度 OCR；也可以直接粘贴文字。";
  } else if (file.type === "application/pdf") {
    const url = URL.createObjectURL(file);
    preview.innerHTML = `<embed src="${url}" type="application/pdf">`;
    ocrStatus.textContent = "PDF 已预览。当前百度 OCR 接口只接图片，请先将 PDF 页面转成图片后上传。";
  } else {
    preview.innerHTML = `<div class="empty">已接收 ${escapeHtml(file.name)}，请粘贴报告文字后解析。</div>`;
    ocrStatus.textContent = "当前文件类型不能 OCR，请粘贴文字或手动录入。";
  }
  showToast("文件已预览，可以识别图片或粘贴文字");

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
  await ensureActiveFamilyMember(supabase);
  const fileName = createSafeStorageFileName(file.name);
  const { error } = await supabase.storage.from(REPORTS_BUCKET).upload(fileName, file);

  if (error) {
    throw error;
  }

  const { data } = supabase.storage.from(REPORTS_BUCKET).getPublicUrl(fileName);
  const url = data.publicUrl;
  console.log("uploaded url", url);
  await saveReportRecord(supabase, url);
  alert("上传成功");
  return url;
}

async function saveReportRecord(supabase, publicUrl) {
  const memberId = await ensureActiveFamilyMember(supabase);
  const { data, error } = await supabase
    .from("reports")
    .insert({
      user_id: currentUserId(),
      member_id: memberId,
      hospital: "本地体检机构",
      report_date: today(),
      report_type: "体检报告",
      file_url: publicUrl
    })
    .select();

  if (error) {
    alert(error.message);
    return;
  }

  console.log("report saved", data);
}

function createSafeStorageFileName(originalName) {
  const extensionMatch = String(originalName || "").match(/\.([a-zA-Z0-9]+)$/);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase().replace(/[^a-z0-9]/g, "") : "bin";
  const random = Math.random().toString(36).slice(2, 8);
  return `${storageUserPath()}/${Date.now()}-${random}.${extension}`;
}

document.getElementById("ocrBtn").addEventListener("click", recognizeSelectedFile);

async function recognizeSelectedFile() {
  const ocrStatus = document.getElementById("ocrStatus");
  const rawText = document.getElementById("rawText");
  ocrStatus.style.display = "block";
  if (!selectedFile || !selectedFile.type.startsWith("image/")) {
    ocrStatus.textContent = "请先选择 jpg 或 png 图片，再点击识别图片。PDF 建议先转成图片。";
    return;
  }

  ocrStatus.textContent = "正在识别图片文字...";
  try {
    const imageBase64 = await fileToBase64(selectedFile);
    const response = await fetch("/api/ocr/baidu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64 })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "OCR 接口调用失败");

    rawText.value = result.text || "";
    if (!rawText.value.trim()) {
      ocrStatus.textContent = "OCR 已返回，但没有识别到有效文字。可以换一张更清晰的图片，或手动粘贴文字。";
      return;
    }

    classifyCurrentText();
    parseText();
    ocrStatus.textContent = `识别完成，已导入 ${result.words?.length || 0} 行文字，并完成自动归类和解析。`;
    showToast("图片文字已识别");
  } catch (error) {
    console.error(error);
    ocrStatus.textContent = `OCR 暂不可用：${error.message || "接口调用失败"}。可先粘贴识别文字继续使用。`;
    showToast("OCR 暂不可用，请粘贴文字");
  }
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
  classifyCurrentText();
  parseText();
});
document.getElementById("addBlankBtn").addEventListener("click", () => {
  classifyCurrentText();
  draft.push({ name: "", alias: "", value: "", unit: "", referenceRange: "", status: "ok", confidence: 1, originalText: "" });
  renderDraft();
  document.getElementById("draftRows")?.scrollIntoView({ behavior: "smooth", block: "center" });
  requestAnimationFrame(() => {
    const lastIndex = draft.length - 1;
    document.querySelector(`#draftRows [data-i="${lastIndex}"][data-k="name"]`)?.focus();
  });
  showToast("已添加一项空白指标");
});
document.getElementById("clearDraft").addEventListener("click", () => { draft = []; renderDraft(); });
document.getElementById("rawText").addEventListener("input", classifyCurrentText);
document.getElementById("saveDocument").addEventListener("click", saveCurrentDocument);
document.getElementById("quickSaveUpload").addEventListener("click", saveCurrentUpload);

function classifyDocumentText(text) {
  const normalized = String(text || "");
  if (/处方|用法|用量|每日|口服|片|胶囊|药/.test(normalized)) return "处方";
  if (/CT|磁共振|MRI|DR|胸片|影像|放射|超声|彩超|检查所见|影像表现|结果描述/.test(normalized)) return "影像检查";
  if (/主诉|现病史|既往史|诊断|门诊|住院|病历|查体/.test(normalized)) return "门诊病历";
  if (/检验项目|参考范围|血常规|生化|尿常规|肝功能|肾功能|胆固醇|尿酸|血糖|白细胞/.test(normalized)) return "检验化验";
  if (/体检|身高|体重|血压|内外科|一般检查|检查医生/.test(normalized)) return "体检报告";
  return "其他资料";
}

function classifyCurrentText() {
  const text = document.getElementById("rawText").value.trim();
  const category = text ? classifyDocumentText(text) : document.getElementById("docCategory").value || "体检报告";
  document.getElementById("docCategory").value = category;
  document.getElementById("reportType").value = category === "检验化验" ? "检验化验" : category;
  document.getElementById("classifyHint").textContent = category === "体检报告" || category === "检验化验"
    ? `已识别为「${category}」，可以继续解析指标并生成趋势。`
    : `已识别为「${category}」，建议直接保存到档案库，不强制做指标分析。`;
  return category;
}

function saveCurrentDocument() {
  const text = document.getElementById("rawText").value.trim();
  const category = document.getElementById("docCategory").value || classifyCurrentText();
  const date = document.getElementById("reportDate").value || today();
  const title = `${date} ${category}`;
  const doc = {
    id: id("doc"),
    userId: currentUserId(),
    title,
    category,
    member_id: activeFamilyMemberId || "local",
    hospital: document.getElementById("institution").value || "未填写机构",
    report_date: date,
    created_at: new Date().toISOString(),
    source_type: sourceFile?.type || "手动录入",
    storage_url: sourceFile?.name || "",
    raw_text: text
  };
  state.documents = state.documents || [];
  state.documents.unshift(doc);
  persist();
  document.getElementById("rawText").value = "";
  document.getElementById("preview").style.display = "none";
  document.getElementById("ocrStatus").style.display = "none";
  sourceFile = null;
  selectedFile = null;
  renderAll();
  showToast(`已保存为${category}档案`);
}

function parseText(options = {}) {
  const text = document.getElementById("rawText").value.trim();
  if (!text) { showToast("先粘贴报告文字，或载入示例报告"); return; }
  const category = classifyCurrentText();
  if (!["体检报告", "检验化验"].includes(category)) {
    if (!options.silent) showToast(`已识别为${category}，可直接保存到档案库`);
  }
  draft = parseIndicators(text);
  if (!draft.length && !options.silent) showToast("没有识别到常见指标，请手动添加字段");
  renderDraft();
}

function saveCurrentUpload() {
  const text = document.getElementById("rawText").value.trim();
  const category = classifyCurrentText();
  const shouldAnalyze = ["体检报告", "检验化验"].includes(category);

  if (!text && !draft.length) {
    showToast("请先上传图片、粘贴文字，或手动添加指标");
    return;
  }

  if (!shouldAnalyze) {
    saveCurrentDocument();
    return;
  }

  if (!draft.length && text) parseText({ silent: true });
  const valid = draft.filter(d => d.name && d.value !== "");
  if (!valid.length) {
    showToast("请确认识别字段，或手动添加至少一项指标");
    document.getElementById("draftRows")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  saveCurrentReport();
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

document.getElementById("saveReport").addEventListener("click", saveCurrentReport);

function saveCurrentReport() {
  const valid = draft.filter(d => d.name && d.value !== "");
  if (!valid.length) { showToast("至少确认一项指标后再保存"); return false; }
  const report = {
    id: id("report"),
    userId: currentUserId(),
    member_id: activeFamilyMemberId || "",
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
  return true;
}

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
  const archiveCount = archiveRows().length || (documentsLoaded ? documents.length : state.reports.length);
  const statReports = document.getElementById("statReports");
  const statIndicators = document.getElementById("statIndicators");
  const statAbnormal = document.getElementById("statAbnormal");
  const statLatest = document.getElementById("statLatest");
  if (statReports) statReports.textContent = archiveCount;
  if (statIndicators) statIndicators.textContent = state.indicators.length;
  if (statAbnormal) statAbnormal.textContent = state.indicators.filter(i => i.status === "high" || i.status === "low").length;
  const latestDocument = archiveRows().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
  const latestReport = [...state.reports].sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0];
  if (statLatest) statLatest.textContent = latestDocument ? formatDate(latestDocument.date).slice(5) : latestReport ? latestReport.reportDate.slice(5) : "-";
}

function renderHomeProfiles() {
  const container = document.getElementById("profileCards");
  if (!container) return;

  const tones = ["green", "blue", "red", "green"];
  const cards = familyMembers.map((member, index) => `
    <button class="profile-card ${String(member.id || "") === String(activeFamilyMemberId) ? "active" : ""}" type="button" data-home-member="${escapeHtml(member.id)}">
      <span class="profile-avatar emoji ${tones[index % tones.length]}" aria-hidden="true">${profileIconForName(member.name)}</span>
      <span><strong>${escapeHtml(member.name || "家庭成员")}</strong><small>${String(member.id || "") === String(activeFamilyMemberId) ? "当前档案" : "点击切换"}</small></span>
    </button>
  `).join("");

  container.innerHTML = `${cards || `
    <div class="home-empty-state profile-empty">
      <strong>还没有档案人</strong>
      <p>添加本人或家庭成员后，首页会按真实档案显示并支持切换。</p>
    </div>
  `}
  <button class="profile-card add-profile-card" type="button" id="homeAddMember">
    <span class="profile-avatar add" aria-hidden="true">＋</span>
    <span><strong>添加成员</strong><small>新建真实档案人</small></span>
  </button>`;

  container.querySelectorAll("[data-home-member]").forEach(btn => {
    btn.addEventListener("click", () => {
      activeFamilyMemberId = btn.dataset.homeMember;
      renderFamilyMembers();
      renderAll();
      showToast(`已切换到 ${currentFamilyMemberName()} 的健康档案`);
    });
  });
  document.getElementById("homeAddMember")?.addEventListener("click", () => {
    document.getElementById("memberForm")?.classList.add("show");
    document.getElementById("memberNameInput")?.focus();
    toggleMobileNav(true);
  });
}

function profileIconForName(name = "") {
  const value = String(name).trim();
  if (/奶奶|外婆|姥姥/.test(value)) return "👵";
  if (/爷爷|外公|姥爷/.test(value)) return "👴";
  if (/妈妈|母亲|妈|娘|女士|太太/.test(value)) return "👩";
  if (/爸爸|父亲|爸|先生/.test(value)) return "👨";
  if (/女儿|妹妹|姐姐|女孩|姑娘/.test(value)) return "👧";
  if (/儿子|弟弟|哥哥|男孩/.test(value)) return "👦";
  if (/宝宝|孩子|小朋友/.test(value)) return "🧒";
  if (/我|本人|自己/.test(value)) return "🙂";
  return "🙂";
}

function renderHomeRecentReports() {
  const list = document.getElementById("recentReportsPreview");
  if (!list) return;

  const rows = archiveRows()
    .sort((a, b) => String(b.createdAt || b.date || "").localeCompare(String(a.createdAt || a.date || "")))
    .slice(0, 5);
  const reports = rows.map(row => ({
    title: row.title || "未命名报告",
    date: row.date || formatDate(row.createdAt),
    category: row.category || "健康资料",
    uid: row.uid
  }));

  if (!reports.length) {
    list.innerHTML = `<div class="home-empty-state">
      <strong>还没有上传记录</strong>
      <p>上传报告单、病历或检查影像后，这里会显示最近真实档案。</p>
      <button class="btn primary" type="button" data-home-upload>上传健康资料</button>
    </div>`;
    list.querySelector("[data-home-upload]")?.addEventListener("click", () => activateScreen("upload"));
    return;
  }

  list.innerHTML = reports.map(report => `
    <button class="recent-report-item" type="button" ${report.uid ? `data-home-document="${escapeHtml(report.uid)}"` : ""}>
      <span class="report-file-icon" aria-hidden="true">▤</span>
      <span class="report-main"><strong>${escapeHtml(report.title)}</strong><small>上传于 ${escapeHtml(report.date || "未填写日期")}</small></span>
      <span class="report-type">${escapeHtml(report.category)}</span>
      <span class="report-arrow" aria-hidden="true">›</span>
    </button>
  `).join("");

  list.querySelectorAll("[data-home-document]").forEach(row => {
    row.addEventListener("click", () => openDocumentDetail(row.dataset.homeDocument));
  });
}

function renderHomeAssistant() {
  const preview = document.getElementById("homeAiPreview");
  const pills = document.getElementById("homeQuestionPills");
  const input = document.getElementById("homeAiInput");
  const send = document.getElementById("homeAiSend");
  if (!preview || !pills || !input || !send) return;

  const latestReport = [...state.reports].sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0];
  const latest = latestReport ? state.indicators.filter(item => item.reportId === latestReport.id) : [];
  const abnormal = latest.filter(item => item.status === "high" || item.status === "low");

  if (!latestReport || !latest.length) {
    preview.innerHTML = `<div class="home-empty-state">
      <strong>还没有可解读的指标</strong>
      <p>AI 问答只会基于已保存的结构化指标回答。请先上传体检或化验资料并保存指标。</p>
      <button class="btn primary" type="button" data-home-upload>上传并解析</button>
    </div>`;
    pills.innerHTML = "";
    input.value = "";
    input.placeholder = "保存指标后可基于档案提问";
    input.disabled = true;
    send.disabled = true;
    preview.querySelector("[data-home-upload]")?.addEventListener("click", () => activateScreen("upload"));
    return;
  }

  const summary = abnormal.length
    ? `最近一次 ${latestReport.reportDate} ${latestReport.reportType} 中有 ${abnormal.length} 项异常：${abnormal.slice(0, 3).map(item => `${item.name}${statusLabel(item.status)}`).join("、")}。`
    : `最近一次 ${latestReport.reportDate} ${latestReport.reportType} 已保存 ${latest.length} 项指标，暂未标记异常。`;
  const questions = [
    abnormal[0] ? `${abnormal[0].name} ${statusLabel(abnormal[0].status)}需要关注什么？` : "最近一次体检有哪些重点？",
    "下次复查应该关注哪些指标？",
    "帮我生成给医生看的摘要"
  ];

  preview.innerHTML = `
    <div class="bubble-row ai-row">
      <span class="chat-avatar bot-avatar" aria-hidden="true">☷</span>
      <div class="chat-bubble ai-bubble">${escapeHtml(summary)}</div>
    </div>
    <div class="bubble-row ai-row">
      <span class="chat-avatar bot-avatar" aria-hidden="true">☷</span>
      <div class="chat-bubble ai-bubble">点击下方问题或输入问题，将跳转到 AI 问答页并基于这些真实指标回答。</div>
    </div>`;
  pills.innerHTML = questions.map(q => `<button type="button" data-home-question="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join("");
  pills.querySelectorAll("[data-home-question]").forEach(btn => {
    btn.addEventListener("click", () => {
      activateScreen("assistant");
      ask(btn.dataset.homeQuestion);
    });
  });
  input.disabled = false;
  send.disabled = false;
  input.placeholder = "输入问题，例如：最近一次体检有哪些异常？";
}

async function initDocuments() {
  renderArchive();

  try {
    const userId = currentUserId();
    const supabase = await window.getSupabaseClient();
    const { data, error } = await supabase
      .from(DOCUMENTS_TABLE)
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    documents = data || [];
    const reportsResult = await supabase
      .from("reports")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (reportsResult.error) {
      console.warn("Supabase reports 读取失败", reportsResult.error);
      backendReports = [];
    } else {
      backendReports = reportsResult.data || [];
    }
    documentsLoaded = true;
    renderAll();
  } catch (error) {
    console.error(error);
    documentsLoaded = true;
    documents = [];
    backendReports = [];
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
  const dateFilter = document.getElementById("dateFilter");
  const typeFilter = document.getElementById("typeFilter");
  const instFilter = document.getElementById("instFilter");
  const statusFilter = document.getElementById("statusFilter");
  const allRows = archiveRows();
  setSelectOptions(dateFilter, "全部日期", [...new Set(allRows.map(r => r.date).filter(Boolean))].sort((a, b) => b.localeCompare(a)));
  setSelectOptions(typeFilter, "全部类型", [...new Set(allRows.map(r => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")));
  setSelectOptions(instFilter, "全部机构", [...new Set(allRows.map(r => r.institution).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")));
  const rows = allRows.filter(row => {
    return (!dateFilter.value || row.date === dateFilter.value) &&
      (!typeFilter.value || row.category === typeFilter.value) &&
      (!instFilter.value || row.institution === instFilter.value) &&
      (!statusFilter.value || row.status === statusFilter.value);
  }).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  if (message) {
    document.getElementById("archiveList").innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
    return;
  }

  document.getElementById("archiveList").innerHTML = rows.length ? rows.map(row => {
    const fallbackSummary = row.storageUrl ? "文件/链接已保存" : (row.textSummary || "已保存资料");
    const rowSummary = row.indicatorCount
      ? `${row.indicatorCount} 项指标 · ${row.abnormalCount} 项异常`
      : fallbackSummary;
    return `<div class="report-row clickable" data-document-id="${escapeHtml(row.uid)}">
      <div>
        <h3>${escapeHtml(row.date || "未填日期")} · ${escapeHtml(row.title || "未命名档案")} <span class="tag ${row.status === "abnormal" ? "low" : "pending"}">${escapeHtml(row.category || "资料")}</span></h3>
        <p>${escapeHtml(row.memberName)} · ${escapeHtml(row.institution || "未填写机构")} · 来源：${escapeHtml(row.sourceLabel)}</p>
        <p>${escapeHtml(rowSummary)}</p>
      </div>
      <button class="btn" type="button">详情</button>
    </div>`;
  }).join("") : `<div class="empty">还没有符合条件的报告。</div>`;

  document.querySelectorAll("[data-document-id]").forEach(row => {
    row.addEventListener("click", () => openDocumentDetail(row.dataset.documentId));
  });
}
["dateFilter","typeFilter","instFilter","statusFilter"].forEach(id => document.getElementById(id).addEventListener("input", () => renderArchive()));

function archiveRows() {
  const dbRows = (documents || []).map(d => ({
    uid: `db-${d.id}`,
    kind: "db",
    raw: d,
    id: d.id,
    title: d.title || d.report_type || "未命名档案",
    category: d.category || d.report_type || "健康资料",
    date: formatDate(d.report_date || d.created_at),
    createdAt: d.created_at || d.report_date || "",
    institution: d.hospital || d.institution || "未填写机构",
    memberName: memberNameById(d.member_id),
    sourceLabel: "数据库",
    storageUrl: d.storage_url || d.file_url || "",
    textSummary: d.raw_text || d.ocr_text || "",
    status: "ok",
    indicatorCount: 0,
    abnormalCount: 0
  }));
  const dbReportRows = (backendReports || []).map(report => ({
    uid: `db-report-${report.id}`,
    kind: "db-report",
    raw: report,
    id: report.id,
    title: report.report_type || "体检报告",
    category: report.report_type || "体检报告",
    date: formatDate(report.report_date || report.created_at),
    createdAt: report.created_at || report.report_date || "",
    institution: report.hospital || "未填写机构",
    memberName: memberNameById(report.member_id),
    sourceLabel: "数据库 reports",
    storageUrl: report.file_url || "",
    textSummary: "",
    status: "ok",
    indicatorCount: 0,
    abnormalCount: 0
  }));
  const localDocs = (state.documents || []).map(d => ({
    uid: `local-${d.id}`,
    kind: "local-doc",
    raw: d,
    id: d.id,
    title: d.title || "未命名档案",
    category: d.category || "健康资料",
    date: formatDate(d.report_date || d.created_at),
    createdAt: d.created_at || "",
    institution: d.hospital || "未填写机构",
    memberName: memberNameById(d.member_id),
    sourceLabel: "本机归档",
    storageUrl: d.storage_url || "",
    textSummary: d.raw_text || "",
    status: "ok",
    indicatorCount: 0,
    abnormalCount: 0
  }));
  const reportRows = state.reports.map(report => {
    const indicators = state.indicators.filter(i => i.reportId === report.id);
    const abnormal = indicators.filter(i => i.status === "high" || i.status === "low");
    return {
      uid: `report-${report.id}`,
      kind: "local-report",
      raw: report,
      id: report.id,
      title: report.reportType || "体检报告",
      category: report.reportType || "体检报告",
      date: report.reportDate || "",
      createdAt: report.createdAt || report.reportDate || "",
      institution: report.institution || "未填写机构",
      memberName: memberNameById(report.member_id) || currentFamilyMemberName(),
      sourceLabel: "指标分析",
      storageUrl: report.sourceFile?.name || "",
      textSummary: "",
      status: abnormal.length ? "abnormal" : "ok",
      indicatorCount: indicators.length,
      abnormalCount: abnormal.length
    };
  });
  return [...dbRows, ...dbReportRows, ...localDocs, ...reportRows];
}

function formatDate(value) {
  return String(value || "").slice(0, 10);
}

function memberNameById(memberId) {
  return (familyMembers.find(member => String(member.id) === String(memberId)) || {}).name || "未指定成员";
}

function openDocumentDetail(documentId) {
  const row = archiveRows().find(item => item.uid === documentId || String(item.id) === String(documentId));
  if (!row) return;

  const modal = document.getElementById("detailModal");
  document.getElementById("detailTitle").textContent = row.title || "档案详情";
  document.getElementById("detailSubtitle").textContent = `${row.date || "未填日期"} · ${row.category || "资料"}`;
  document.getElementById("detailBody").innerHTML = buildDocumentDetail(row);
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}

function closeDocumentDetail() {
  const modal = document.getElementById("detailModal");
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}

function buildDocumentDetail(row) {
  const storageUrl = row.storageUrl || "";
  const preview = storageUrl
    ? /\.pdf($|\?)/i.test(storageUrl)
      ? `<embed src="${escapeHtml(storageUrl)}" type="application/pdf">`
      : `<img src="${escapeHtml(storageUrl)}" alt="原始资料预览">`
    : `<div class="empty">没有可预览的原始文件。</div>`;
  const indicators = row.kind === "local-report" ? state.indicators.filter(i => i.reportId === row.id) : [];

  return `<div class="detail-grid">
      <div class="detail-kv"><small>标题</small><strong>${escapeHtml(row.title || "未命名档案")}</strong></div>
      <div class="detail-kv"><small>所属家庭成员</small><strong>${escapeHtml(row.memberName)}</strong></div>
      <div class="detail-kv"><small>资料类型</small><strong>${escapeHtml(row.category || "资料")}</strong></div>
      <div class="detail-kv"><small>日期</small><strong>${escapeHtml(row.date || "未填写")}</strong></div>
    </div>
    <div class="detail-grid">
      <div class="detail-kv"><small>检查机构</small><strong>${escapeHtml(row.institution || "未填写机构")}</strong></div>
      <div class="detail-kv"><small>来源</small><strong>${escapeHtml(row.sourceLabel)}</strong></div>
      <div class="detail-kv"><small>文件/链接</small><strong>${escapeHtml(storageUrl || "无")}</strong></div>
      <div class="detail-kv"><small>档案 ID</small><strong>${escapeHtml(row.id || "")}</strong></div>
    </div>
    <h3 class="section-title">原始图片/PDF预览</h3>
    <div class="detail-preview">${preview}</div>
    <h3 class="section-title">文字内容</h3>
    <div class="detail-text">${escapeHtml(row.textSummary || "暂无文字内容。")}</div>
    <h3 class="section-title" style="margin-top:16px">指标列表</h3>
    ${indicators.length ? `<div class="timeline-indicators">${indicators.map(i => `<div class="timeline-indicator"><strong>${escapeHtml(i.name)}</strong><small>${escapeHtml(i.value)} ${escapeHtml(i.unit || "")} · ${statusLabel(i.status)}</small><small>参考范围：${escapeHtml(i.referenceRange || "未填写")}</small></div>`).join("")}</div>` : `<div class="empty" style="padding:14px">该资料未关联结构化指标。</div>`}`;
}

document.getElementById("closeDetail").addEventListener("click", closeDocumentDetail);
document.getElementById("detailModal").addEventListener("click", e => {
  if (e.target.id === "detailModal") closeDocumentDetail();
});

document.getElementById("timelineFullscreenBtn")?.addEventListener("click", () => {
  const enabled = !document.body.classList.contains("timeline-fullscreen");
  document.body.classList.toggle("timeline-fullscreen", enabled);
  document.getElementById("timelineFullscreenBtn").textContent = enabled ? "退出" : "全屏";
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
  const reports = [...state.reports]
    .filter(report => state.indicators.some(i => i.reportId === report.id))
    .sort((a, b) => String(a.reportDate || "").localeCompare(String(b.reportDate || "")));
  const detail = document.getElementById("trendDetail");
  if (!reports.length) {
    document.getElementById("indicatorList").innerHTML = `<div class="empty">保存体检或化验指标后，这里会出现按日期排列的时间轴节点。</div>`;
    document.getElementById("trendChart").innerHTML = "";
    document.getElementById("trendMeta").innerHTML = "";
    detail?.classList.remove("show");
    return;
  }
  document.getElementById("indicatorList").innerHTML = reports.map(report => {
    const indicators = state.indicators.filter(i => i.reportId === report.id);
    const abnormal = indicators.filter(i => i.status === "high" || i.status === "low").length;
    const active = report.id === selectedTimelineReportId;
    const label = report.reportType || "体检报告";
    return `<button class="timeline-node ${active ? "active" : ""}" data-report-node="${escapeHtml(report.id)}" title="${escapeHtml(report.reportDate || "")} ${escapeHtml(label)}">
      <span class="timeline-dot">${escapeHtml(String(indicators.length || 0))}</span>
      <span class="timeline-date">${escapeHtml(report.reportDate || "未填日期")}</span>
      <span class="timeline-type">${escapeHtml(label)}${abnormal ? ` · ${abnormal} 异常` : ""}</span>
    </button>`;
  }).join("");
  document.querySelectorAll("[data-report-node]").forEach(btn => btn.addEventListener("click", () => {
    selectedTimelineReportId = selectedTimelineReportId === btn.dataset.reportNode ? "" : btn.dataset.reportNode;
    renderTrends();
  }));
  if (!selectedTimelineReportId) {
    detail?.classList.remove("show");
    document.getElementById("trendChart").innerHTML = "";
    document.getElementById("trendMeta").innerHTML = "";
    return;
  }
  const report = reports.find(r => r.id === selectedTimelineReportId);
  if (report) renderTimelineDetail(report);
}

function renderTimelineDetail(report) {
  const detail = document.getElementById("trendDetail");
  detail?.classList.add("show");
  const indicators = state.indicators.filter(i => i.reportId === report.id);
  const abnormal = indicators.filter(i => i.status === "high" || i.status === "low");
  document.getElementById("trendTitle").textContent = `${report.reportDate || "未填日期"} · ${report.reportType || "健康指标"}`;
  document.getElementById("trendChart").innerHTML = "";
  document.getElementById("trendMeta").innerHTML = `
    <li>检查机构：${escapeHtml(report.institution || "未填写机构")}</li>
    <li>共 ${indicators.length} 项指标，${abnormal.length} 项异常。</li>
    <li>点击其他时间轴节点可切换查看对应报告。</li>
    <div class="indicator-chart-grid">
      ${indicators.map(i => `<div class="indicator-chart-card">
        <div>
          <strong>${escapeHtml(i.name)}</strong>
          <small>${escapeHtml(i.value)} ${escapeHtml(i.unit || "")} · ${statusLabel(i.status)}</small>
          <small>参考范围：${escapeHtml(i.referenceRange || "未填写")}</small>
        </div>
        ${renderMiniIndicatorChart(i)}
      </div>`).join("")}
    </div>`;
}

function renderMiniIndicatorChart(indicator) {
  const points = trendFor(indicator.alias || indicator.name, indicator.unit)
    .map(point => ({
      value: Number(point.value),
      date: point.report?.reportDate || "",
      active: point.id === indicator.id,
      status: point.status
    }))
    .filter(point => Number.isFinite(point.value));
  const data = points.length ? points : [{ value: Number(indicator.value), date: "", active: true, status: indicator.status }];
  const w = 360, h = 88, pl = 28, pr = 18, pt = 14, pb = 24;
  const values = data.map(point => point.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= Math.max(Math.abs(min) * 0.08, 1);
    max += Math.max(Math.abs(max) * 0.08, 1);
  }
  const x = index => data.length === 1 ? w / 2 : pl + (w - pl - pr) * index / (data.length - 1);
  const y = value => pt + (h - pt - pb) * (1 - (value - min) / (max - min || 1));
  const line = data.map((point, index) => `${x(index)},${y(point.value)}`).join(" ");
  const current = data.find(point => point.active) || data[data.length - 1];
  return `<svg class="mini-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(indicator.name)}趋势图">
    <line x1="${pl}" y1="${h - pb}" x2="${w - pr}" y2="${h - pb}" stroke="#dfe9e7" stroke-width="2"/>
    <line x1="${pl}" y1="${pt}" x2="${w - pr}" y2="${pt}" stroke="#eef5f1" stroke-width="1"/>
    ${data.length > 1 ? `<polyline points="${line}" fill="none" stroke="#1f9d70" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
    ${data.length > 1 ? `<polygon points="${pl},${h - pb} ${line} ${w - pr},${h - pb}" fill="#1f9d70" opacity=".09"/>` : ""}
    ${data.map((point, index) => `<circle cx="${x(index)}" cy="${y(point.value)}" r="${point.active ? 5 : 4}" fill="${point.status === "high" || point.status === "low" ? "#d86535" : "#1f9d70"}" stroke="#fff" stroke-width="2"/>`).join("")}
    <text x="${w - pr}" y="18" text-anchor="end" font-size="11" fill="#657475">${escapeHtml(data.length)} 次记录</text>
    <text x="${x(data.indexOf(current))}" y="${Math.max(12, y(current.value) - 8)}" text-anchor="middle" font-size="11" font-weight="800" fill="#172526">${escapeHtml(current.value)}</text>
  </svg>`;
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
async function ask(q) {
  const msgs = document.getElementById("msgs");
  msgs.insertAdjacentHTML("beforeend", `<div class="msg user">${escapeHtml(q)}</div>`);
  const pendingId = `qa_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  msgs.insertAdjacentHTML("beforeend", `<div class="msg ai" id="${pendingId}">正在基于已保存数据整理回答...</div>`);
  msgs.scrollTop = msgs.scrollHeight;

  try {
    const answer = await answerQuestionWithApi(q);
    document.getElementById(pendingId).innerHTML = `${answer}<br><br><small>数据来源：已保存的结构化体检指标。以上为信息辅助，非医疗诊断。</small>`;
    msgs.scrollTop = msgs.scrollHeight;
  } catch (error) {
    console.error(error);
    document.getElementById(pendingId).innerHTML = `${answerQuestion(q)}<br><br><small>AI 接口暂不可用，已使用本地规则回答。数据来源：本机已保存的结构化体检指标。以上为信息辅助，非医疗诊断。</small>`;
    msgs.scrollTop = msgs.scrollHeight;
  }
}

async function answerQuestionWithApi(q) {
  const response = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildAiPayload(q))
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "AI 接口调用失败");
  if (!result.answer) throw new Error("AI 未返回回答");
  return escapeHtml(result.answer).replace(/\n/g, "<br>");
}

function buildAiPayload(question) {
  const groups = indicatorGroups().slice(0, 20).map(group => ({
    name: group.name,
    alias: group.alias,
    unit: group.unit,
    points: trendFor(group.alias).map(point => ({
      reportDate: point.report.reportDate,
      value: point.value,
      status: point.status
    }))
  }));
  return {
    user_id: currentUserId(),
    question,
    reports: state.reports,
    indicators: state.indicators,
    trends: groups
  };
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
document.getElementById("exportPrescriptionCsv").addEventListener("click", () => {
  const rows = [["date","member","institution","title","content"]];
  archiveRows()
    .filter(row => row.category === "处方")
    .forEach(row => rows.push([row.date, row.memberName, row.institution, row.title, row.textSummary || row.storageUrl]));
  download("prescriptions.csv", rows.map(row => row.map(csvCell).join(",")).join("\n"), "text/csv;charset=utf-8");
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
  state = { reports: [], indicators: [], documents: [] };
  persist();
  renderAll();
  showToast("本地数据已清空");
});

function renderAll() {
  renderStats();
  renderHomeProfiles();
  renderHomeAssistant();
  renderHomeRecentReports();
  renderDraft();
  renderArchive();
  renderTrends();
}

document.getElementById("loginForm").addEventListener("submit", handleLogin);
document.getElementById("homeAiSend")?.addEventListener("click", () => {
  const input = document.getElementById("homeAiInput");
  const question = input?.value.trim();
  if (!question) return;
  activateScreen("assistant");
  ask(question);
  input.value = "";
});
document.getElementById("homeAiInput")?.addEventListener("keydown", event => {
  if (event.key === "Enter") document.getElementById("homeAiSend")?.click();
});
if (currentUser) {
  startAuthenticatedApp();
} else {
  document.body.classList.add("auth-locked");
  renderAll();
}
