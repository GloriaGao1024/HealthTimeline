const SUPABASE_URL = "https://keiovavmwbepmsqsagmd.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const USER_ID = process.env.DEMO_USER_ID || "0fd0bcbb-19c7-531c-b339-adc05be8accb";
const MEMBER_ID = process.env.DEMO_MEMBER_ID || "50";

if (!SUPABASE_ANON_KEY) {
  console.error("Missing SUPABASE_ANON_KEY");
  process.exit(1);
}

async function request(table, query, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${table} ${response.status}: ${text}`);
  }
  return text;
}

async function removeDemoRows() {
  await request("documents", `?user_id=eq.${USER_ID}&source_type=eq.demo`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
  await request("reports", `?user_id=eq.${USER_ID}&file_url=like.demo://healthtimeline/*`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
}

async function insertRows(table, rows) {
  const text = await request(table, "", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(rows)
  });
  console.log(`${table}: ${text}`);
}

const documents = [
  {
    user_id: USER_ID,
    member_id: MEMBER_ID,
    title: "2024 入职体检报告",
    category: "体检报告",
    report_type: "入职体检",
    hospital: "珠海市人民医院医疗集团高新医院",
    institution: "珠海市人民医院医疗集团高新医院",
    report_date: "2024-02-29",
    source_type: "demo",
    raw_text: "身高 187cm，体重 61kg，血压 121/86mmHg。胸部正位片未见明显异常。",
    ocr_text: "演示 OCR 文本：2024 入职体检报告，基础体格检查、胸片、血常规。"
  },
  {
    user_id: USER_ID,
    member_id: MEMBER_ID,
    title: "2024 血脂四项化验单",
    category: "检验化验",
    report_type: "血脂四项",
    hospital: "本地体检机构",
    institution: "本地体检机构",
    report_date: "2024-09-16",
    source_type: "demo",
    raw_text: "总胆固醇 3.42 mmol/L，甘油三酯 0.72 mmol/L，高密度脂蛋白 1.28 mmol/L，低密度脂蛋白 1.68 mmol/L。",
    ocr_text: "演示 OCR 文本：2024 血脂四项化验单。"
  },
  {
    user_id: USER_ID,
    member_id: MEMBER_ID,
    title: "2025 门诊病历",
    category: "门诊病历",
    report_type: "门诊记录",
    hospital: "社区卫生服务中心",
    institution: "社区卫生服务中心",
    report_date: "2025-03-26",
    source_type: "demo",
    raw_text: "主诉：咽痛两天。医生建议多饮水，观察体温，如持续不适复诊。",
    ocr_text: "演示 OCR 文本：2025 门诊病历。"
  },
  {
    user_id: USER_ID,
    member_id: MEMBER_ID,
    title: "2025 腹部超声检查",
    category: "影像检查",
    report_type: "腹部超声",
    hospital: "上海市某体检中心",
    institution: "上海市某体检中心",
    report_date: "2025-11-08",
    source_type: "demo",
    raw_text: "肝胆胰脾双肾超声检查，未见明显异常回声。建议结合临床。",
    ocr_text: "演示 OCR 文本：2025 腹部超声检查。"
  },
  {
    user_id: USER_ID,
    member_id: MEMBER_ID,
    title: "2026 年度体检报告",
    category: "体检报告",
    report_type: "年度体检",
    hospital: "上海市某体检中心",
    institution: "上海市某体检中心",
    report_date: "2026-06-10",
    source_type: "demo",
    raw_text: "载脂蛋白-B 偏低，碳酸氢根偏高，总胆红素偏高，直接胆红素偏高，总胆固醇偏低。",
    ocr_text: "演示 OCR 文本：2026 年度体检报告。"
  }
];

const reports = [
  {
    user_id: USER_ID,
    member_id: MEMBER_ID,
    hospital: "上海市某体检中心",
    report_date: "2023-06-20",
    report_type: "年度体检",
    file_url: "demo://healthtimeline/2023-annual"
  },
  {
    user_id: USER_ID,
    member_id: MEMBER_ID,
    hospital: "珠海市人民医院医疗集团高新医院",
    report_date: "2024-02-29",
    report_type: "入职体检",
    file_url: "demo://healthtimeline/2024-entry"
  },
  {
    user_id: USER_ID,
    member_id: MEMBER_ID,
    hospital: "上海市某体检中心",
    report_date: "2025-06-16",
    report_type: "年度体检",
    file_url: "demo://healthtimeline/2025-annual"
  },
  {
    user_id: USER_ID,
    member_id: MEMBER_ID,
    hospital: "上海市某体检中心",
    report_date: "2026-06-10",
    report_type: "年度体检",
    file_url: "demo://healthtimeline/2026-annual"
  }
];

await removeDemoRows();
await insertRows("documents", documents);
await insertRows("reports", reports);
