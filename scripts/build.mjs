#!/usr/bin/env node
/**
 * drone-tenders / scripts/build.mjs
 *
 * 從 g0v 標案 API（https://pcc-api.openfun.app/）抓取無人機相關標案，
 * 去重、解析、分類後產出 data/tenders.json 與 data/summary.json。
 *
 * 用法：
 *   node scripts/build.mjs                          增量更新（預設，數分鐘）
 *   node scripts/build.mjs --full                    完整重抓（約 2 小時，見 scripts/README.md）
 *   node scripts/build.mjs --limit 2                 每個關鍵字只抓前 2 頁
 *   node scripts/build.mjs --keywords 無人機,UAV     只跑指定關鍵字
 *   node scripts/build.mjs --max-age-days 7          本機快取幾天內視為新鮮（預設 7）
 *   node scripts/build.mjs --no-cache                完全不用快取
 *
 * 只用 Node 內建功能（fetch / fs / path），不依賴任何套件。Node 22+。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');

// ---------------------------------------------------------------------------
// 規則表（要改分類規則改這裡就好）
// ---------------------------------------------------------------------------

/** 標題搜尋用的關鍵字。之後以 unit_id + job_number 去重。 */
const KEYWORDS = [
  '無人機', '無人飛行載具', '無人載具', 'UAV', 'UAS', '空拍機', '多旋翼',
  '遙控飛行', '無人飛機', '無人直升機', '反無人機', '無人機反制', '定翼機', '垂直起降',
];

/**
 * category 規則，**由上往下第一個命中者勝出**（順序即優先序，照 SPEC）。
 * agency：比對機關名稱；title：比對標案名稱；custom：兩者都給。
 */
const CATEGORY_RULES = [
  // 海巡自成一類（含反制的海巡案也歸海巡，不再歸國防），所以排在國防前面
  { category: '海巡', agency: /海巡/ },
  {
    category: '國防',
    agency: /國防部|軍司令部|防衛指揮部|作戰區|中山科學研究院|軍備局|國防大學|陸軍|海軍|空軍|憲兵|後備|聯合後勤|國軍|軍醫|政治作戰|兵工|飛彈|備役/,
  },
  {
    category: '反制',
    title: /反制|反無人機|無人機防禦|防禦系統|偵測干擾|偵蒐干擾|干擾槍|電子干擾|射頻偵測|RF偵測|聯防/,
  },
  { category: '警政', agency: /警察|警政|調查局|刑事警察|保安警察|移民署|矯正/ },
  {
    category: '消防救災',
    agency: /消防|空中勤務|災害防救|災防/,
    title: /搜救|救災|防災|災害|火災|山域|水域搜索/,
  },
  {
    category: '農林漁業',
    agency: /農業部|農業局|林業|農糧|農業改良|農改|漁業|水產|動植物防疫|農田水利|畜產|茶業|種苗/,
    title: /噴灑|農藥|植保|施藥|作物|果園|魚塭|林班|造林|病蟲害/,
  },
  {
    category: '測繪巡檢',
    agency: /國土測繪|水利署|水利局|公路局|地政|台灣電力|臺灣電力|港務|自來水|鐵道|高速公路/,
    title: /測量|測繪|航拍|航測|遙測|正射|巡檢|巡查|橋梁|橋樑|電力|輸電|變電|饋線|水利|河川|排水|國土|管線|堤防|坡地|地形|測製|3D建模|點雲/,
  },
  {
    category: '教育研究',
    agency: /大學|學院|學校|研究院|研究所|研究中心|實驗中學|高級中|國民中學|國民小學|科學園區實驗/,
    title: /研究|教學|教育|訓練|實習|考照|操作證|課程|人才培育|培訓|競賽|營隊|師資|教具/,
  },
  {
    category: '環境監測',
    agency: /環保局|環境保護|環境部|環境管理|空氣品質/,
    title: /空污|空氣污染|空氣品質|水質|污染|排放|稽查/,
  },
];
const CATEGORY_FALLBACK = '其他';

/**
 * agency_group 規則，由上往下第一個命中者勝出。
 * code：比對機關代碼（字串開頭），name：比對機關名稱，localCode：地方政府的代碼特徵。
 */
const AGENCY_GROUP_RULES = [
  {
    group: '國防',
    code: /^(3\.5(\.|$)|A\.5(\.|$))/,
    name: /國防部|軍司令部|防衛指揮部|作戰區|中山科學研究院|軍備局|國防大學|陸軍|海軍|空軍|憲兵|後備|聯合後勤|國軍|軍事|兵工|政治作戰|退除役/,
  },
  { group: '學校', name: /大學|學院|專科學校|高級中|國民中學|國民小學|附設|實驗中學|(^|[^科])學校/ },
  { group: '國營事業', name: /股份有限公司|有限公司|中華郵政|臺灣港務|台灣港務|中央銀行|農業金庫/ },
  // 機關代碼第二段 70–99 = 地方政府（3.71 金門、3.76 縣市警局、3.79 臺北市、3.82 新北市、3.97 高雄市…）
  { group: '地方政府', localCode: true },
  { group: '地方政府', name: /縣政府|市政府|鄉公所|鎮公所|市公所|區公所|縣議會|市議會|村里/ },
  { group: '中央部會', code: /^(3\.|A\.)/ },
];
const AGENCY_GROUP_FALLBACK = '其他';

/** domain：`無人載具` 等關鍵字會撈到船艇車輛，用標題判斷。 */
const DOMAIN_SEA = /船|艇|水下|水面|潛|浮標|海床|載人動力/;
const DOMAIN_GROUND = /無人車|地面載具|地面機器人|車輛|履帶|輪型|巡邏車|運輸車/;
const DOMAIN_AIR_OVERRIDE = /機|飛|空拍|旋翼|UAV|UAS|飛行/i;

/** 視為「有決標結果」的公告類型。定期彙送也帶完整決標資料。 */
const AWARD_TYPES = /^(更正)?(決標公告|定期彙送)$/;
/** 無法決標。 */
const FAIL_TYPES = /^(更正)?無法決標公告$/;
/** 招標中／已招標。 */
const TENDER_TYPES = /(招標公告|報價單或企劃書公告|招標更正公告|企劃書更正公告|限制性招標)/;
/** 前置作業（尚未正式招標）。 */
const PRE_TYPES = /(公開徵求廠商提供參考資料|公開閱覽)/;

/** 外幣關鍵字：金額欄位出現這些字就存 null，並在 data_notes 計數。 */
const FOREIGN_CURRENCY = /美元|美金|USD|日圓|日元|JPY|歐元|EUR|英鎊|GBP|港幣|HKD|人民幣|RMB|CNY|新加坡幣|SGD|澳幣|AUD|加幣|CAD|瑞士法郎|CHF/i;

/**
 * 對美軍購（FMS）。這類案子單筆動輒上百億，會淹沒國內採購的趨勢，
 * 所以標記 fms: true 並在 summary 裡獨立成一軌。
 * A. I. T. = 美國在台協會，是軍售案在採購網上的「得標廠商」。
 */
const FMS_VENDOR = /^A\.?\s*I\.?\s*T\.?$|美國在台協會|American Institute in Taiwan/i;
const FMS_TEXT = /軍售|外購案|FMS/i;

/** 代辦採購的機關（實際買家在「履約執行機關」）。 */
const PROCUREMENT_AGENTS = /臺灣銀行股份有限公司|台灣銀行股份有限公司/;

/**
 * 標題是否真的提到無人機。有些機關重複使用標案案號（同一個 unit_id+job_number
 * 底下混進完全無關的公告），也有「定翼機」這種關鍵字會撈到有人駕駛的飛機隊維修案。
 * 這個 regex 用來（a）在同一案有多個標案名稱時挑出正確的那一組公告，
 * （b）標記 drone_in_title，summary.json 只統計 true 的案子。
 */
const DRONE_IN_TITLE = /無人|UAV|UAS|空拍|遙控|drone|多旋翼|旋翼機|飛行載具|航空器系統|垂直起降/i;

/** 原產地國別正規化（summary 的 by_origin 分桶）。 */
const ORIGIN_BUCKETS = ['臺灣', '美國', '中國', '日本'];

// ---------------------------------------------------------------------------
// 抓取層：節流、退避、快取
// ---------------------------------------------------------------------------

const API = 'https://pcc-api.openfun.app';
const USER_AGENT = 'skyfaring-drone-tenders/1.0 (+https://tenders.skyfaring.net)';

// 實測（2026-09）：上游 Cloudflare 限流約 30 req/min，突發上限 10。
// 間隔 2000 ms 可穩定不觸發 429；觸發時拉長間隔並冷卻。
const MIN_INTERVAL_MS = 2000;
const MAX_INTERVAL_MS = 12000;
const CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;       // 非 429 的重試次數（指數退避）
const MAX_RATE_RETRIES = 20;  // 429 另外算，不佔用上面的次數
const REQUEST_TIMEOUT_MS = 45000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pacer = {
  interval: MIN_INTERVAL_MS,
  nextAt: 0,
  chain: Promise.resolve(),
  streak: 0,
  slot() {
    const p = this.chain.then(async () => {
      const wait = this.nextAt - Date.now();
      if (wait > 0) await sleep(wait);
      this.nextAt = Date.now() + this.interval;
    });
    this.chain = p.catch(() => {});
    return p;
  },
  throttled() {
    this.streak = 0;
    this.interval = Math.min(Math.round(this.interval * 1.4), MAX_INTERVAL_MS);
    this.nextAt = Math.max(this.nextAt, Date.now() + 15000); // 冷卻，讓 token bucket 回補
  },
  ok() {
    if (++this.streak % 40 === 0) {
      this.interval = Math.max(Math.round(this.interval * 0.9), MIN_INTERVAL_MS);
    }
  },
};

const stats = { requests: 0, rateLimited: 0, retries: 0, cacheHits: 0 };

async function fetchJson(url) {
  let attempt = 0;
  let rateRetries = 0;
  for (;;) {
    await pacer.slot();
    stats.requests++;
    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (++attempt >= MAX_ATTEMPTS) throw new Error(`fetch failed ${url}: ${err.message}`);
      stats.retries++;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.status === 429 || res.status === 503) {
      stats.rateLimited++;
      pacer.throttled();
      if (++rateRetries > MAX_RATE_RETRIES) throw new Error(`rate limited too long: ${url}`);
      await sleep(Math.min(5000 * rateRetries, 60000));
      continue;
    }
    if (!res.ok) {
      if (res.status >= 500 && ++attempt < MAX_ATTEMPTS) {
        stats.retries++;
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new Error(`HTTP ${res.status} ${url}`);
    }
    let json;
    try {
      json = await res.json();
    } catch (err) {
      if (++attempt >= MAX_ATTEMPTS) throw new Error(`bad JSON ${url}: ${err.message}`);
      stats.retries++;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    pacer.ok();
    return json;
  }
}

const cachePath = (unitId, jobNumber) =>
  path.join(CACHE_DIR, `${String(unitId).replace(/[^\w.\-]/g, '_')}__${String(jobNumber).replace(/[^\w.\-]/g, '_')}.json`);

async function fetchTender(unitId, jobNumber, opts) {
  const file = cachePath(unitId, jobNumber);
  if (opts.useCache) {
    try {
      const st = fs.statSync(file);
      const ageDays = (Date.now() - st.mtimeMs) / 86400000;
      if (ageDays <= opts.maxAgeDays) {
        stats.cacheHits++;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      }
    } catch { /* 沒有快取就照抓 */ }
  }
  const url = `${API}/api/tender?unit_id=${encodeURIComponent(unitId)}&job_number=${encodeURIComponent(jobNumber)}`;
  const json = await fetchJson(url);
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(json));
  } catch { /* 快取寫不進去不影響結果 */ }
  return json;
}

async function pool(items, worker, concurrency = CONCURRENCY) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

// ---------------------------------------------------------------------------
// 解析工具
// ---------------------------------------------------------------------------

/** 全形英數字與空白轉半形，去除前後空白。 */
function toHalfWidth(s) {
  return String(s ?? '')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/ /g, ' ')
    .trim();
}

/** 民國日期 115/08/17 或 115/08/17 10:30 → 2026-08-17。 */
function rocDate(value) {
  const s = toHalfWidth(value);
  const m = s.match(/^(\d{2,3})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]) + 1911;
  const mo = String(Number(m[2])).padStart(2, '0');
  const d = String(Number(m[3])).padStart(2, '0');
  if (Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[3]) < 1 || Number(m[3]) > 31) return null;
  return `${y}-${mo}-${d}`;
}

/** 搜尋結果的 20260902 → 2026-09-02。 */
function numericDate(value) {
  const s = String(value ?? '');
  if (!/^\d{8}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

const amountFlags = { undisclosed: 0, foreign: 0, unparsed: new Map() };

/**
 * 「3,200,000元」→ 3200000；「不公開」「」→ null；「0元」→ 0；外幣 → null（計數）。
 */
function parseAmount(value) {
  if (value === null || value === undefined) return null;
  let s = toHalfWidth(value);
  if (!s) return null;
  if (/不公開|不予公開|未公開/.test(s)) { amountFlags.undisclosed++; return null; }
  if (FOREIGN_CURRENCY.test(s)) { amountFlags.foreign++; return null; }
  const m = s.match(/-?[\d,]+(\.\d+)?/);
  if (!m) {
    amountFlags.unparsed.set(s, (amountFlags.unparsed.get(s) || 0) + 1);
    return null;
  }
  const n = Number(m[0].replace(/,/g, ''));
  if (!Number.isFinite(n)) {
    amountFlags.unparsed.set(s, (amountFlags.unparsed.get(s) || 0) + 1);
    return null;
  }
  return Math.round(n);
}

/** 同一法人的舊名／別名 → 現名。中科院 2014 年行政法人化後改「院」。 */
const VENDOR_ALIAS = new Map([
  ['國家中山科學研究所', '國家中山科學研究院'],
  ['中山科學研究院', '國家中山科學研究院'],
  ['國防部軍備局中山科學研究院', '國家中山科學研究院'],
]);
/** 名稱含這些片段的一律視為同一法人（中科院各所、打錯字的變體）。 */
const VENDOR_CANON = [[/中山科(學|山)/, '國家中山科學研究院']];
function canonVendor(name) {
  if (VENDOR_ALIAS.has(name)) return VENDOR_ALIAS.get(name);
  for (const [re, canon] of VENDOR_CANON) if (re.test(name)) return canon;
  return name;
}

/** 廠商名稱正規化：去掉括號內含英文的部分、全形空白、統一空白。不動法定名稱本體。 */
function normalizeVendorName(raw) {
  let s = toHalfWidth(raw);
  if (!s) return '';
  // 去掉整段括號內含拉丁字母者（英文譯名）
  s = s.replace(/[（(][^（）()]*[A-Za-z][^（）()]*[）)]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  // 中文名稱不該有空白，全部拿掉，讓同一家公司的不同寫法可以合併
  if (/[一-鿿]/.test(s)) s = s.replace(/\s+/g, '');
  s = s.replace(/[，,、]$/, '').trim();
  return canonVendor(s);
}

/** 合併用的 key：統一台/臺、去標點。顯示仍用 normalizeVendorName 的結果。 */
function vendorKey(name) {
  return normalizeVendorName(name)
    .replace(/臺/g, '台')
    .replace(/[^一-鿿A-Za-z0-9]/g, '')
    .toUpperCase();
}

/** 「美國(United States of America)」→「美國」；「中華民國(...)」→「臺灣」。 */
function normalizeOrigin(raw) {
  let s = toHalfWidth(raw);
  if (!s) return null;
  s = s.split(/[（(]/)[0].trim();
  if (!s) return null;
  if (/^中華民國|^台灣|^臺灣/.test(s)) return '臺灣';
  if (/^中國大陸|^中華人民共和國|^中國$/.test(s)) return '中國';
  if (/^美國/.test(s)) return '美國';
  if (/^日本/.test(s)) return '日本';
  return s;
}

/** 「<財物類>496航空器,太空船及其零件」或「財物類496-航空器…」→ {type:'財物', class:'496航空器,太空船及其零件'} */
function parseSubjectClass(raw) {
  const s = toHalfWidth(raw);
  if (!s) return { type: null, cls: null };
  const m = s.match(/[<＜]?(工程|財物|勞務)類[>＞]?[-－]?\s*(.*)$/);
  if (m) return { type: m[1], cls: (m[2] || '').replace(/^[-－]/, '').trim() || null };
  if (/^(工程|財物|勞務)$/.test(s)) return { type: s, cls: null };
  return { type: null, cls: s };
}

const pick = (detail, keys) => {
  for (const k of keys) {
    const v = detail?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
  }
  return null;
};

/** 找出第一個符合 regex 的 key 的值（欄位名在不同公告類型會換前綴時很有用）。 */
const pickBy = (detail, re) => {
  for (const [k, v] of Object.entries(detail || {})) {
    if (re.test(k) && v !== undefined && v !== null && String(v).trim() !== '') return String(v);
  }
  return null;
};

const isYes = (v) => v !== null && v !== undefined && /^是/.test(toHalfWidth(v));

// ---------------------------------------------------------------------------
// 單筆公告 → 結構化
// ---------------------------------------------------------------------------

function parseRecord(record) {
  const detail = record.detail || {};
  const type = toHalfWidth(record.brief?.type || detail.type || '');
  const date = numericDate(record.date);

  const agencyName = pick(detail, [
    '機關資料:機關名稱', '無法決標公告:機關名稱', '標案內容:機關名稱',
  ]) || pickBy(detail, /機關名稱$/);
  const agencyId = pick(detail, [
    '機關資料:機關代碼', '無法決標公告:機關代碼', '標案內容:機關代碼',
  ]) || pickBy(detail, /機關代碼$/);

  const title = pick(detail, [
    '採購資料:標案名稱', '已公告資料:標案名稱', '無法決標公告:標案名稱', '標案內容:標案名稱',
  ]) || toHalfWidth(record.brief?.title || '');

  const budget = parseAmount(pick(detail, [
    '採購資料:預算金額', '已公告資料:預算金額', '標案內容:預算金額',
  ]));
  const budgetPublic = pick(detail, ['採購資料:預算金額是否公開', '已公告資料:預算金額是否公開']);

  const subject = parseSubjectClass(pick(detail, [
    '採購資料:標的分類', '已公告資料:標的分類', '無法決標公告:標的分類', '標案內容:標的分類',
  ]));

  const method = pick(detail, [
    '招標資料:招標方式', '已公告資料:招標方式', '採購資料:招標方式',
    '無法決標公告:招標方式', '標案內容:招標方式',
  ]);
  const awardMethod = pick(detail, [
    '招標資料:決標方式', '已公告資料:決標方式', '採購資料:決標方式',
  ]);

  const deadline = rocDate(pick(detail, ['領投開標:截止投標']));
  const framework = isYes(pick(detail, [
    '招標資料:是否屬共同供應契約採購', '已公告資料:是否屬共同供應契約採購',
    '採購資料:是否屬共同供應契約採購',
  ])) || /共同供應契約/.test(title);
  const plural = isYes(pick(detail, [
    '招標資料:是否複數決標', '已公告資料:是否複數決標',
    '採購資料:是否複數決標', '無法決標公告:是否複數決標',
  ]));
  const nationalSecurity = isYes(pickBy(detail, /涉及國家安全」採購$/));
  const sensitive = isYes(pickBy(detail, /具敏感性或國安\(含資安\)疑慮/));

  const biddersRaw = pick(detail, ['投標廠商:投標廠商家數']);
  const biddersCount = biddersRaw !== null && /^\d+$/.test(toHalfWidth(biddersRaw))
    ? Number(toHalfWidth(biddersRaw)) : null;

  const isAward = AWARD_TYPES.test(type);
  const awardDate = isAward ? rocDate(pick(detail, ['決標資料:決標日期'])) : null;
  const totalPublic = pick(detail, ['決標資料:總決標金額是否公開']);
  let awardAmount = null;
  if (isAward) {
    awardAmount = totalPublic !== null && !isYes(totalPublic)
      ? (amountFlags.undisclosed++, null)
      : parseAmount(pick(detail, ['決標資料:總決標金額']));
  }

  // 履約執行機關（臺灣銀行等代辦採購時，真正的買家在這裡）
  let execAgency = null;
  let execAgencyId = null;
  const execRaw = pick(detail, ['決標資料:履約執行機關']);
  if (execRaw) {
    const mName = execRaw.match(/機關名稱[：:]\s*(.+)/);
    const mCode = execRaw.match(/機關代碼[：:]\s*([\w.]+)/);
    if (mName) execAgency = toHalfWidth(mName[1]);
    if (mCode) execAgencyId = toHalfWidth(mCode[1]);
  }

  // --- 得標廠商 ---
  const winners = [];
  if (isAward) {
    const idx = new Set();
    for (const k of Object.keys(detail)) {
      const m = k.match(/^投標廠商:投標廠商(\d+):/);
      if (m) idx.add(Number(m[1]));
    }
    for (const i of [...idx].sort((a, b) => a - b)) {
      if (!isYes(detail[`投標廠商:投標廠商${i}:是否得標`])) continue;
      const rawName = detail[`投標廠商:投標廠商${i}:廠商名稱`];
      const name = normalizeVendorName(rawName);
      if (!name) continue;
      winners.push({
        name,
        id: toHalfWidth(detail[`投標廠商:投標廠商${i}:廠商代碼`] || '') || null,
        amount: parseAmount(detail[`投標廠商:投標廠商${i}:決標金額`]),
        sme: isYes(detail[`投標廠商:投標廠商${i}:是否為中小企業`]),
        origins: [],
      });
    }

    // --- 原產地國別：決標品項:第K品項:得標廠商M:原產地國別[N]:原產地國別[得標金額] ---
    // 先把「第K品項:得標廠商M」對應到廠商名稱，再把國別金額掛回 winners。
    const originsByVendor = new Map(); // vendorKey -> Map(country -> amount)
    const itemWinnerName = new Map();  // "K|M" -> name
    for (const [k, v] of Object.entries(detail)) {
      const m = k.match(/^決標品項:第(\d+)品項:得標廠商(\d+):得標廠商$/);
      if (m) itemWinnerName.set(`${m[1]}|${m[2]}`, normalizeVendorName(v));
    }
    for (const [k, v] of Object.entries(detail)) {
      const m = k.match(/^決標品項:第(\d+)品項:得標廠商(\d+):原產地國別(\d*):原產地國別$/);
      if (!m) continue;
      const country = normalizeOrigin(v);
      if (!country) continue;
      const amtKey = `決標品項:第${m[1]}品項:得標廠商${m[2]}:原產地國別${m[3]}:原產地國別得標金額`;
      const amount = parseAmount(detail[amtKey]);
      const vk = vendorKey(itemWinnerName.get(`${m[1]}|${m[2]}`) || '');
      if (!originsByVendor.has(vk)) originsByVendor.set(vk, new Map());
      const bag = originsByVendor.get(vk);
      bag.set(country, (bag.get(country) || 0) + (amount || 0));
    }
    for (const w of winners) {
      const bag = originsByVendor.get(vendorKey(w.name));
      if (!bag) continue;
      w.origins = [...bag.entries()]
        .map(([country, amount]) => ({ country, amount: amount || null }))
        .sort((a, b) => (b.amount || 0) - (a.amount || 0));
    }
    // 有些公告的「得標廠商」欄位寫法跟投標廠商不同，對不上時整包掛到唯一得標廠商
    if (winners.length === 1 && winners[0].origins.length === 0 && originsByVendor.size > 0) {
      const merged = new Map();
      for (const bag of originsByVendor.values()) {
        for (const [c, a] of bag) merged.set(c, (merged.get(c) || 0) + a);
      }
      winners[0].origins = [...merged.entries()]
        .map(([country, amount]) => ({ country, amount: amount || null }))
        .sort((a, b) => (b.amount || 0) - (a.amount || 0));
    }

    // 品項層的決標金額加總（總決標金額不公開時的備援，不做估算，只用實際欄位）
    if (awardAmount === null && winners.length) {
      const sum = winners.reduce((acc, w) => acc + (w.amount || 0), 0);
      if (sum > 0 && winners.every((w) => w.amount !== null)) awardAmount = sum;
    }
  }

  const failReason = FAIL_TYPES.test(type)
    ? pick(detail, ['無法決標公告:無法決標的理由']) : null;

  // 軍售案常只在附加說明裡寫「軍售」「FMS」，標題看不出來
  const notes = [
    detail['決標資料:附加說明'], detail['其他:附加說明'],
    detail['採購資料:附加說明'], detail['標案內容:附加說明'],
  ].filter(Boolean).join(' ');

  return {
    type,
    date,
    url: detail.url || null,
    agencyName: agencyName ? toHalfWidth(agencyName) : null,
    agencyId: agencyId ? toHalfWidth(agencyId) : null,
    title: toHalfWidth(title),
    budget,
    budgetPublic,
    subjectType: subject.type,
    subjectClass: subject.cls,
    method: method ? toHalfWidth(method) : null,
    awardMethod: awardMethod ? toHalfWidth(awardMethod) : null,
    deadline,
    framework,
    plural,
    nationalSecurity,
    sensitive,
    biddersCount,
    isAward,
    awardDate,
    awardAmount,
    awardAmountUndisclosed: isAward && totalPublic !== null && !isYes(totalPublic),
    execAgency,
    execAgencyId,
    winners,
    failReason,
    notes,
  };
}

// ---------------------------------------------------------------------------
// 分類
// ---------------------------------------------------------------------------

function classifyCategory(title, agency) {
  const t = title || '';
  const a = agency || '';
  for (const rule of CATEGORY_RULES) {
    if (rule.custom && rule.custom(t, a)) return rule.category;
    if (rule.agency && rule.agency.test(a)) return rule.category;
    if (rule.title && rule.title.test(t)) return rule.category;
  }
  return CATEGORY_FALLBACK;
}

function classifyAgencyGroup(agencyId, agencyName) {
  const id = agencyId || '';
  const name = agencyName || '';
  const seg = id.split('.')[1];
  const localCode = /^3\./.test(id) && /^\d+$/.test(seg || '') && Number(seg) >= 70 && Number(seg) <= 99;
  for (const rule of AGENCY_GROUP_RULES) {
    if (rule.code && rule.code.test(id)) return rule.group;
    if (rule.name && rule.name.test(name)) return rule.group;
    if (rule.localCode && localCode) return rule.group;
  }
  return AGENCY_GROUP_FALLBACK;
}

function classifyDomain(title) {
  const t = title || '';
  const seaHit = DOMAIN_SEA.test(t);
  const groundHit = DOMAIN_GROUND.test(t);
  if (!seaHit && !groundHit) return 'air';
  if (DOMAIN_AIR_OVERRIDE.test(t)) return 'air';
  return seaHit ? 'sea' : 'ground';
}

// ---------------------------------------------------------------------------
// 一個標案（多筆公告）→ 一筆 tender
// ---------------------------------------------------------------------------

const maxDate = (arr) => arr.reduce((m, d) => (d && (!m || d > m) ? d : m), null);

function buildTender(unitId, jobNumber, unitNameHint, records, keywords = []) {
  let trimmedOtherCase = false;
  let parsed = records
    .map(parseRecord)
    .filter((r) => r.type)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  if (!parsed.length) return null;

  // 同一個 unit_id + job_number 底下可能混進不同標案（機關重複用案號）。
  // 依標案名稱分組，只留下標題真的命中搜尋關鍵字的那些組。
  const norm = (t) => String(t || '').replace(/\s|　/g, '');
  const groups = new Map();
  for (const r of parsed) {
    const k = norm(r.title);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  if (groups.size > 1) {
    const hit = [...groups.entries()].filter(([t]) =>
      keywords.some((kw) => t.toUpperCase().includes(kw.toUpperCase())));
    if (hit.length && hit.length < groups.size) {
      trimmedOtherCase = true;
      parsed = hit.flatMap(([, rs]) => rs)
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    }
  }
  if (!parsed.length) return null;

  const latest = parsed[parsed.length - 1];
  const awards = parsed.filter((r) => r.isAward);
  const fails = parsed.filter((r) => FAIL_TYPES.test(r.type));
  const tenders = parsed.filter((r) => TENDER_TYPES.test(r.type));
  const pres = parsed.filter((r) => PRE_TYPES.test(r.type));

  const lastAward = awards.length ? awards[awards.length - 1] : null;
  const lastTender = tenders.length ? tenders[tenders.length - 1] : null;

  // status：以最新一筆有意義的公告決定
  let status;
  if (lastAward) {
    const failAfter = fails.some((f) => f.date && f.date > lastAward.date);
    const tenderAfter = lastTender && lastTender.date > lastAward.date;
    if (failAfter && !tenderAfter) status = 'failed';
    else if (tenderAfter) status = 'open';
    else status = 'awarded';
  } else if (fails.length && (!lastTender || maxDate(fails.map((f) => f.date)) > lastTender.date)) {
    status = 'failed';
  } else if (lastTender) {
    const dl = lastTender.deadline;
    status = dl && dl >= todayISO() ? 'open' : (dl ? 'closed' : 'open');
  } else if (pres.length) {
    status = 'pre';
  } else {
    status = 'pre';
  }
  if (status === 'open' && !lastAward && lastTender && !lastTender.deadline) {
    // 沒有截止日資訊（如限制性招標），用公告日 90 天當粗略界線
    const d = lastTender.date;
    if (d && daysBetween(d, todayISO()) > 90) status = 'closed';
  }

  const firstOf = (fn) => {
    for (const r of parsed) { const v = fn(r); if (v !== null && v !== undefined && v !== '') return v; }
    return null;
  };
  const lastOf = (fn) => {
    for (let i = parsed.length - 1; i >= 0; i--) {
      const v = fn(parsed[i]);
      if (v !== null && v !== undefined && v !== '') return v;
    }
    return null;
  };

  const announcingAgency = lastOf((r) => r.agencyName) || unitNameHint || null;
  const announcingAgencyId = lastOf((r) => r.agencyId) || unitId;
  const execAgency = lastOf((r) => r.execAgency);
  const execAgencyId = lastOf((r) => r.execAgencyId);

  // 臺灣銀行等代辦採購：真正的買家是履約執行機關
  const agentCase = PROCUREMENT_AGENTS.test(announcingAgency || '') && execAgency
    && execAgency !== announcingAgency;
  const agency = agentCase ? execAgency : announcingAgency;
  const agencyId = agentCase ? (execAgencyId || announcingAgencyId) : announcingAgencyId;

  const title = lastOf((r) => r.title) || '';
  const budget = lastOf((r) => r.budget);
  const domain = classifyDomain(title);
  const category = classifyCategory(title, agency || '');
  const agencyGroup = classifyAgencyGroup(agencyId, agency);

  const winners = lastAward ? lastAward.winners : [];
  const awardAmount = lastAward ? lastAward.awardAmount : null;
  const awardDate = lastAward ? lastAward.awardDate : null;

  const announcements = [];
  const seenAnn = new Set();
  for (const r of parsed) {
    const key = `${r.date}|${r.type}`;
    if (seenAnn.has(key)) continue;
    seenAnn.add(key);
    announcements.push({ date: r.date, type: r.type });
  }

  return {
    id: `${unitId}/${jobNumber}`,
    title,
    agency,
    agency_id: agencyId,
    agency_group: agencyGroup,
    category,
    domain,
    procurement_type: lastOf((r) => r.subjectType),
    subject_class: lastOf((r) => r.subjectClass),
    method: lastOf((r) => r.method),
    award_method: lastOf((r) => r.awardMethod),
    status,
    budget,
    award_amount: awardAmount,
    award_date: awardDate,
    first_notice_date: parsed[0].date,
    last_notice_date: latest.date,
    bidders_count: lastAward ? lastAward.biddersCount : lastOf((r) => r.biddersCount),
    winners,
    national_security: parsed.some((r) => r.nationalSecurity),
    sensitive: parsed.some((r) => r.sensitive),
    framework: parsed.some((r) => r.framework),
    plural_award: parsed.some((r) => r.plural),
    drone_in_title: DRONE_IN_TITLE.test(title),
    fms: winners.some((w) => FMS_VENDOR.test(w.name))
      || FMS_TEXT.test(`${title} ${parsed.map((r) => r.notes || '').join(' ')}`),
    works: lastOf((r) => r.subjectType) === '工程',
    job_number_reused: trimmedOtherCase || undefined,
    fail_reason: status === 'failed' ? lastOf((r) => r.failReason) : null,
    exec_agency: agentCase ? null : (execAgency && execAgency !== announcingAgency ? execAgency : null),
    announcing_agency: agentCase ? announcingAgency : null,
    pcc_url: lastOf((r) => r.url),
    announcements,
  };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}
function quarterOf(iso) {
  const y = iso.slice(0, 4);
  const m = Number(iso.slice(5, 7));
  return `${y}Q${Math.floor((m - 1) / 3) + 1}`;
}

/**
 * 增量模式沿用舊 tenders.json 的案子時，重新套一次分類規則，
 * 這樣改了頂部的規則表不必整批重抓也會生效。
 */
function reclassify(t) {
  t.category = classifyCategory(t.title, t.agency || '');
  t.agency_group = classifyAgencyGroup(t.agency_id, t.agency);
  t.domain = classifyDomain(t.title);
  t.drone_in_title = DRONE_IN_TITLE.test(t.title);
  for (const w of t.winners || []) w.name = canonVendor(w.name);
  t.works = t.procurement_type === '工程';
  t.fms = (t.winners || []).some((w) => FMS_VENDOR.test(w.name)) || FMS_TEXT.test(t.title);
  return t;
}

// ---------------------------------------------------------------------------
// summary.json
// ---------------------------------------------------------------------------

function buildSummary(all, notes) {
  // 三軌：domestic（國內採購，首頁主體）／fms（對美軍購）／works（工程類）。
  // 軍購單筆上百億、工程案是蓋園區不是買飛機，混在一起會把趨勢圖壓扁。
  const air = all.filter((t) => t.domain === 'air' && t.drone_in_title);
  const fmsList = air.filter((t) => t.fms);
  const worksList = air.filter((t) => !t.fms && t.works);
  const tenders = air.filter((t) => !t.fms && !t.works);
  const today = todayISO();
  const year = today.slice(0, 4);
  const quarter = quarterOf(today);
  const awarded = tenders.filter((t) => t.status === 'awarded');
  const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);

  const dateOf = (t) => t.award_date || t.last_notice_date || t.first_notice_date;

  const inYear = (t, y) => (dateOf(t) || '').startsWith(y);
  const inQuarter = (t, q) => { const d = dateOf(t); return d && quarterOf(d) === q; };

  const totals = {
    count: tenders.length,
    awarded_count: awarded.length,
    awarded_amount: sum(awarded, (t) => t.award_amount),
    open_count: tenders.filter((t) => t.status === 'open').length,
    this_year: {
      year,
      count: tenders.filter((t) => inYear(t, year)).length,
      awarded_count: awarded.filter((t) => inYear(t, year)).length,
      awarded_amount: sum(awarded.filter((t) => inYear(t, year)), (t) => t.award_amount),
      open_count: tenders.filter((t) => t.status === 'open' && inYear(t, year)).length,
    },
    this_quarter: {
      quarter,
      count: tenders.filter((t) => inQuarter(t, quarter)).length,
      awarded_count: awarded.filter((t) => inQuarter(t, quarter)).length,
      awarded_amount: sum(awarded.filter((t) => inQuarter(t, quarter)), (t) => t.award_amount),
      open_count: tenders.filter((t) => t.status === 'open' && inQuarter(t, quarter)).length,
    },
    all_domains: {
      count: all.length,
      awarded_count: all.filter((t) => t.status === 'awarded').length,
      awarded_amount: sum(all.filter((t) => t.status === 'awarded'), (t) => t.award_amount),
    },
  };

  // 季度（2016Q1 起）與年度（2010 起）
  const byQuarter = new Map();
  const byYear = new Map();
  for (const t of tenders) {
    const d = dateOf(t);
    if (!d) continue;
    const q = quarterOf(d);
    const y = d.slice(0, 4);
    for (const [map, key] of [[byQuarter, q], [byYear, y]]) {
      if (!map.has(key)) map.set(key, { awarded_count: 0, awarded_amount: 0, open_count: 0, count: 0 });
      const row = map.get(key);
      row.count++;
      if (t.status === 'awarded') { row.awarded_count++; row.awarded_amount += t.award_amount || 0; }
      if (t.status === 'open') row.open_count++;
    }
  }
  const by_quarter = [...byQuarter.entries()]
    .filter(([q]) => q >= '2016Q1')
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([q, v]) => ({ q, ...v }));
  const by_year = [...byYear.entries()]
    .filter(([y]) => Number(y) >= 2010)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([y, v]) => ({ year: Number(y), ...v }));

  const groupBy = (keyFn) => {
    const m = new Map();
    for (const t of tenders) {
      const k = keyFn(t) || '其他';
      if (!m.has(k)) m.set(k, { count: 0, awarded_count: 0, amount: 0 });
      const row = m.get(k);
      row.count++;
      if (t.status === 'awarded') { row.awarded_count++; row.amount += t.award_amount || 0; }
    }
    return [...m.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.amount - a.amount || b.count - a.count);
  };

  const by_category = groupBy((t) => t.category).map((r) => ({ category: r.key, count: r.count, awarded_count: r.awarded_count, amount: r.amount }));
  const by_agency_group = groupBy((t) => t.agency_group).map((r) => ({ agency_group: r.key, count: r.count, awarded_count: r.awarded_count, amount: r.amount }));
  const top_agencies = groupBy((t) => t.agency).slice(0, 20)
    .map((r) => ({ agency: r.key, count: r.count, awarded_count: r.awarded_count, amount: r.amount }));

  // 廠商（以廠商代碼優先合併，沒有代碼才用正規化名稱）
  const vendors = new Map();
  const edges = new Map();
  for (const t of awarded) {
    for (const w of t.winners) {
      // 中科院等有多個統編的法人以正規化名稱合併，其餘以廠商代碼優先
      const key = canonVendor(w.name) !== w.name || VENDOR_CANON.some(([re]) => re.test(w.name)) ? vendorKey(w.name) : (w.id || vendorKey(w.name));
      if (!vendors.has(key)) vendors.set(key, { name: w.name, id: w.id, count: 0, amount: 0, sme: w.sme, agencies: new Map() });
      const v = vendors.get(key);
      v.count++;
      v.amount += w.amount ?? (t.winners.length === 1 ? (t.award_amount || 0) : 0);
      const agencyAmount = w.amount ?? (t.winners.length === 1 ? (t.award_amount || 0) : 0);
      v.agencies.set(t.agency, (v.agencies.get(t.agency) || 0) + 1);
      const ek = `${key}|${t.agency}`;
      if (!edges.has(ek)) edges.set(ek, { vendor: v.name, agency: t.agency, count: 0, amount: 0 });
      const e = edges.get(ek);
      e.count++;
      e.amount += agencyAmount;
    }
  }
  const top_vendors = [...vendors.values()]
    .sort((a, b) => b.amount - a.amount || b.count - a.count)
    .slice(0, 20)
    .map((v) => ({
      vendor: v.name,
      id: v.id,
      count: v.count,
      amount: v.amount,
      sme: v.sme,
      top_agencies: [...v.agencies.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([agency, count]) => ({ agency, count })),
    }));
  const vendor_agency_edges = [...edges.values()].sort((a, b) => b.amount - a.amount).slice(0, 400);

  // 原產地
  const bucket = (c) => (ORIGIN_BUCKETS.includes(c) ? c : '其他');
  const originTotals = new Map();
  const originYear = new Map();
  let awardedWithOrigin = 0;
  for (const t of awarded) {
    const y = (t.award_date || t.last_notice_date || '').slice(0, 4);
    let has = false;
    for (const w of t.winners) {
      for (const o of w.origins || []) {
        if (!o.amount) continue;
        has = true;
        const b = bucket(o.country);
        originTotals.set(b, (originTotals.get(b) || 0) + o.amount);
        if (y) {
          if (!originYear.has(y)) originYear.set(y, new Map());
          const m = originYear.get(y);
          m.set(b, (m.get(b) || 0) + o.amount);
        }
      }
    }
    if (has) awardedWithOrigin++;
  }
  const by_origin = [...originTotals.entries()]
    .map(([country, amount]) => ({ country, amount }))
    .sort((a, b) => b.amount - a.amount);
  const by_origin_year = [...originYear.entries()]
    .filter(([y]) => Number(y) >= 2010)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([year, m]) => ({
      year: Number(year),
      origins: [...m.entries()].map(([country, amount]) => ({ country, amount })).sort((a, b) => b.amount - a.amount),
    }));

  // 最近 60 天的公告
  const cutoff = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const recent = [];
  for (const t of all) {
    for (const a of t.announcements) {
      if (!a.date || a.date < cutoff) continue;
      recent.push({
        id: t.id,
        date: a.date,
        type: a.type,
        title: t.title,
        agency: t.agency,
        domain: t.domain,
        fms: !!t.fms,
        works: !!t.works,
        amount: AWARD_TYPES.test(a.type) ? t.award_amount : t.budget,
      });
    }
  }
  recent.sort((a, b) => b.date.localeCompare(a.date));

  // --- 對美軍購（獨立一軌） ---
  const fmsAwarded = fmsList.filter((t) => t.status === 'awarded');
  const fms = {
    count: fmsList.length,
    awarded_count: fmsAwarded.length,
    amount: sum(fmsAwarded, (t) => t.award_amount),
    items: fmsAwarded
      .slice()
      .sort((a, b) => (b.award_amount || 0) - (a.award_amount || 0))
      .map((t) => ({
        id: t.id,
        title: t.title,
        agency: t.agency,
        award_date: t.award_date,
        amount: t.award_amount,
      })),
  };

  // --- 工程類（獨立一軌） ---
  const worksAwarded = worksList.filter((t) => t.status === 'awarded');
  const works = {
    count: worksList.length,
    awarded_count: worksAwarded.length,
    amount: sum(worksAwarded, (t) => t.award_amount),
    items: worksAwarded
      .slice()
      .sort((a, b) => (b.award_amount || 0) - (a.award_amount || 0))
      .slice(0, 20)
      .map((t) => ({
        id: t.id,
        title: t.title,
        agency: t.agency,
        award_date: t.award_date,
        amount: t.award_amount,
      })),
  };

  return {
    generated_at: new Date().toISOString(),
    scope: 'domestic：domain=air 且 drone_in_title=true 且非 fms 非 works。'
      + '下面 totals / by_quarter / by_year / by_category / by_agency_group / top_agencies /'
      + ' top_vendors / by_origin / by_origin_year / vendor_agency_edges 全部只算 domestic；'
      + '對美軍購見 fms、工程類見 works、全領域件數見 totals.all_domains。',
    tracks: {
      domestic: { count: tenders.length, awarded_count: awarded.length, amount: sum(awarded, (t) => t.award_amount) },
      fms: { count: fms.count, awarded_count: fms.awarded_count, amount: fms.amount },
      works: { count: works.count, awarded_count: works.awarded_count, amount: works.amount },
    },
    fms,
    works,
    totals,
    by_quarter,
    by_year,
    by_category,
    by_agency_group,
    top_agencies,
    top_vendors,
    vendor_agency_edges,
    by_origin,
    by_origin_year,
    awarded_with_origin_count: awardedWithOrigin,
    recent: recent.slice(0, 300),
    data_notes: notes,
  };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { limit: null, keywords: KEYWORDS, useCache: true, maxAgeDays: 7, full: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice(8));
    else if (a === '--keywords') out.keywords = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--keywords=')) out.keywords = a.slice(11).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--max-age-days') out.maxAgeDays = Number(argv[++i]);
    else if (a.startsWith('--max-age-days=')) out.maxAgeDays = Number(a.slice(15));
    else if (a === '--no-cache') out.useCache = false;
    else if (a === '--full') out.full = true;
    else if (a === '--help' || a === '-h') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]); process.exit(0); }
    else { console.error(`未知參數：${a}`); process.exit(2); }
  }
  return out;
}

const log = (...args) => console.log(`[${new Date().toTimeString().slice(0, 8)}]`, ...args);

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  log(`關鍵字 ${opts.keywords.length} 個${opts.limit ? `，每個最多 ${opts.limit} 頁` : ''}`);

  // --- 1. 標題搜尋，收集 unit_id + job_number ---
  const cases = new Map(); // id -> {unit_id, job_number, unit_name, keywords:Set}
  const keywordHits = {};
  for (const kw of opts.keywords) {
    let page1;
    try {
      page1 = await fetchJson(`${API}/api/searchbytitle?query=${encodeURIComponent(kw)}&page=1`);
    } catch (err) {
      console.error(`關鍵字「${kw}」整批失敗：${err.message}`);
      process.exit(1);
    }
    const totalPages = Math.max(1, Number(page1.total_pages) || 1);
    const pages = opts.limit ? Math.min(totalPages, opts.limit) : totalPages;
    const collected = [page1];
    for (let p = 2; p <= pages; p++) {
      try {
        collected.push(await fetchJson(`${API}/api/searchbytitle?query=${encodeURIComponent(kw)}&page=${p}`));
      } catch (err) {
        console.error(`關鍵字「${kw}」第 ${p} 頁失敗：${err.message}`);
        process.exit(1);
      }
    }
    let n = 0;
    for (const d of collected) {
      for (const r of d.records || []) {
        n++;
        const id = `${r.unit_id}/${r.job_number}`;
        if (!cases.has(id)) {
          cases.set(id, {
            unit_id: r.unit_id, job_number: r.job_number, unit_name: r.unit_name,
            keywords: new Set(), latestDate: null,
          });
        }
        const c = cases.get(id);
        c.keywords.add(kw);
        const rd = numericDate(r.date);
        if (rd && (!c.latestDate || rd > c.latestDate)) c.latestDate = rd;
      }
    }
    keywordHits[kw] = { announcements: n, total_records: page1.total_records, pages_fetched: pages, total_pages: totalPages };
    log(`「${kw}」${n} 筆公告（${pages}/${totalPages} 頁），累計 ${cases.size} 個標案`);
  }

  if (cases.size === 0) {
    console.error('沒有抓到任何標案，不寫檔。');
    process.exit(1);
  }

  // --- 2. 決定要抓哪些案（增量） ---
  const allCases = [...cases.values()];
  const existing = new Map();
  if (!opts.full) {
    try {
      const prev = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'tenders.json'), 'utf8'));
      for (const t of prev.tenders || []) existing.set(t.id, t);
    } catch { /* 沒有舊檔就等於完整抓取 */ }
  }
  const mode = existing.size ? 'incremental' : 'full';
  // 18 個月內還在跑的案子每次都重抓（可能有新的決標或更正公告）
  const FRESH_CUTOFF = new Date(Date.now() - 548 * 86400000).toISOString().slice(0, 10);
  const list = [];
  const reusedCases = [];
  for (const c of allCases) {
    const id = `${c.unit_id}/${c.job_number}`;
    const prev = existing.get(id);
    if (!prev) { list.push(c); continue; }
    if (c.latestDate && prev.last_notice_date && c.latestDate > prev.last_notice_date) { list.push(c); continue; }
    if ((prev.last_notice_date || '') >= FRESH_CUTOFF
      && prev.status !== 'awarded' && prev.status !== 'failed') { list.push(c); continue; }
    reusedCases.push({ c, prev });
  }
  // 舊檔有、這次搜尋沒出現的案子（標案名稱被改過等），沿用不丟掉
  let carriedOver = 0;
  const carried = [];
  for (const [id, prev] of existing) {
    if (cases.has(id)) continue;
    carriedOver++;
    carried.push(prev);
  }
  log(mode === 'incremental'
    ? `增量模式：既有 ${existing.size} 案，需重抓 ${list.length}，沿用 ${reusedCases.length}，搜尋未出現但保留 ${carriedOver}`
    : `完整模式：${list.length} 案`);

  const failures = [];
  let done = 0;
  const results = await pool(list, async (c) => {
    let json = null;
    try {
      json = await fetchTender(c.unit_id, c.job_number, opts);
    } catch (err) {
      failures.push({ id: `${c.unit_id}/${c.job_number}`, error: err.message });
    }
    if (++done % 50 === 0) {
      const rate = done / ((Date.now() - t0) / 60000);
      const eta = Math.round((list.length - done) / Math.max(rate, 0.1));
      log(`  ${done}/${list.length}（快取 ${stats.cacheHits}，429 ${stats.rateLimited}，約 ${rate.toFixed(1)}/分，剩約 ${eta} 分）`);
    }
    return { c, json };
  });

  const failureRate = list.length ? failures.length / list.length : 0;
  if (failureRate > 0.02) {
    console.error(`抓取失敗率 ${(failureRate * 100).toFixed(1)}%（${failures.length}/${list.length}），超過 2%，不寫檔。`);
    console.error(failures.slice(0, 10).map((f) => `${f.id}: ${f.error}`).join('\n'));
    process.exit(1);
  }

  // --- 3. 解析 ---
  const tenders = [];
  let reusedJobNumbers = 0;
  for (const { c, json } of results) {
    if (!json || !Array.isArray(json.records) || json.records.length === 0) continue;
    const t = buildTender(c.unit_id, c.job_number, json.unit_name || c.unit_name, json.records, [...c.keywords]);
    if (t && t.job_number_reused) { reusedJobNumbers++; delete t.job_number_reused; }
    if (t) {
      t.keywords = [...c.keywords];
      tenders.push(t);
    }
  }
  // 沿用舊資料的案子：重新套一次分類規則（規則表改了不必整批重抓）
  for (const { c, prev } of reusedCases) {
    const t = reclassify(prev);
    t.keywords = [...c.keywords];
    tenders.push(t);
  }
  for (const prev of carried) tenders.push(reclassify(prev));

  tenders.sort((a, b) => String(b.last_notice_date || '').localeCompare(String(a.last_notice_date || '')));

  // --- 4. data_notes ---
  const awarded = tenders.filter((t) => t.status === 'awarded');
  const awardedAir = awarded.filter((t) => t.domain === 'air');
  const withOrigin = awarded.filter((t) => t.winners.some((w) => (w.origins || []).some((o) => o.amount)));
  const frameworkNoAmount = tenders.filter((t) => t.framework && t.award_amount === null);
  const notes = {
    mode,
    fetched_cases: list.length,
    reused_cases: reusedCases.length,
    carried_over_cases: carriedOver,
    keyword_hits: keywordHits,
    total_cases: tenders.length,
    domain_counts: tenders.reduce((m, t) => ((m[t.domain] = (m[t.domain] || 0) + 1), m), {}),
    status_counts: tenders.reduce((m, t) => ((m[t.status] = (m[t.status] || 0) + 1), m), {}),
    awarded_count: awarded.length,
    awarded_with_amount: awarded.filter((t) => t.award_amount !== null).length,
    awarded_without_origin: awarded.length - withOrigin.length,
    awarded_without_origin_pct: awarded.length
      ? Number((((awarded.length - withOrigin.length) / awarded.length) * 100).toFixed(1)) : 0,
    origin_amount_coverage_pct: (() => {
      const awardedSum = awarded.reduce((a, t) => a + (t.award_amount || 0), 0);
      const originSum = awarded.reduce((a, t) => a + t.winners.reduce(
        (b, w) => b + (w.origins || []).reduce((c, o) => c + (o.amount || 0), 0), 0), 0);
      return awardedSum ? Number(((originSum / awardedSum) * 100).toFixed(1)) : 0;
    })(),
    track_counts: {
      domestic: tenders.filter((t) => t.domain === 'air' && t.drone_in_title && !t.fms && !t.works).length,
      fms: tenders.filter((t) => t.domain === 'air' && t.drone_in_title && t.fms).length,
      works: tenders.filter((t) => t.domain === 'air' && t.drone_in_title && !t.fms && t.works).length,
    },
    no_drone_token_in_title: tenders.filter((t) => !t.drone_in_title).length,
    no_drone_token_awarded_amount: tenders.filter((t) => !t.drone_in_title && t.status === 'awarded')
      .reduce((a, t) => a + (t.award_amount || 0), 0),
    reused_job_number_cases: reusedJobNumbers,
    framework_count: tenders.filter((t) => t.framework).length,
    framework_without_amount: frameworkNoAmount.length,
    amount_undisclosed_fields: amountFlags.undisclosed,
    foreign_currency_amounts: amountFlags.foreign,
    unparsed_amount_samples: [...amountFlags.unparsed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([value, count]) => ({ value, count })),
    fetch_failures: failures.length,
    fetch_failure_ids: failures.slice(0, 20).map((f) => f.id),
    caveats: [
      '標題關鍵字搜尋會漏掉標案名稱沒寫「無人機」等字的案子。',
      '共同供應契約通常沒有總決標金額，award_amount 維持 null，未做估算。',
      '原產地國別由機關自填，未填者不計入 by_origin；且機關常只填國產部分，原產地金額合計會小於決標金額（覆蓋率見 origin_amount_coverage_pct），by_origin 只能看占比趨勢，不能當總額。',
      '更正公告以最新一筆為準；歷史版本不保留。',
      '臺灣銀行等代辦採購案的 agency 已改用「履約執行機關」，原公告機關記在 announcing_agency。',
      'summary.json 分三軌：domestic（國內採購，首頁主體）、fms（對美軍購，得標廠商 A. I. T. 或標題／附加說明含軍售）、works（工程類，如無人機產業園區新建工程）。totals 等所有彙總只算 domestic。',
      '增量模式只重抓「新案」「搜尋顯示有更新公告」「最後公告在 18 個月內且尚未決標／無法決標」的案子，其餘沿用舊 tenders.json 並重新套分類規則；要完整重抓用 --full。',
      '「定翼機」這個關鍵字會撈到有人駕駛的飛機（內政部空中勤務總隊 BEECH 機隊維修、金門空中醫療後送等），標題沒有無人機字樣者已標記 drone_in_title=false 並排除於 summary 之外，但仍保留在 tenders.json。',
      '少數機關會重複使用標案案號，同一個 unit_id+job_number 底下混到無關公告；已依標案名稱分組，只留標題命中搜尋關鍵字的那一組。',
    ],
  };

  // --- 5. 寫檔 ---
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tz = new Date(Date.now() + 8 * 3600000).toISOString().replace('Z', '+08:00');
  let payload = {
    generated_at: tz,
    source: '政府電子採購網（經 g0v 標案 API）',
    keywords: opts.keywords,
    count: tenders.length,
    tenders,
  };
  let json = JSON.stringify(payload);

  // 超過 6 MB 就精簡：先砍沒有金額的 origins，再砍中間的公告
  const LIMIT = 6 * 1024 * 1024;
  if (Buffer.byteLength(json) > LIMIT) {
    log(`tenders.json ${(Buffer.byteLength(json) / 1048576).toFixed(2)} MB 超過 6 MB，精簡 origins…`);
    for (const t of tenders) {
      for (const w of t.winners) w.origins = (w.origins || []).filter((o) => o.amount);
    }
    json = JSON.stringify(payload);
  }
  if (Buffer.byteLength(json) > LIMIT) {
    log(`還是 ${(Buffer.byteLength(json) / 1048576).toFixed(2)} MB，精簡 announcements（只留首尾與決標）…`);
    for (const t of tenders) {
      if (t.announcements.length > 4) {
        const keep = t.announcements.filter((a, i) => i === 0 || i === t.announcements.length - 1 || AWARD_TYPES.test(a.type) || FAIL_TYPES.test(a.type));
        t.announcements = keep.length ? keep : t.announcements.slice(-2);
      }
    }
    json = JSON.stringify(payload);
  }
  fs.writeFileSync(path.join(DATA_DIR, 'tenders.json'), json);

  const summary = buildSummary(tenders, notes);
  fs.writeFileSync(path.join(DATA_DIR, 'summary.json'), JSON.stringify(summary, null, 1));

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  log(`完成：${tenders.length} 案，awarded ${awarded.length}（其中 air ${awardedAir.length}），`
    + `tenders.json ${(Buffer.byteLength(json) / 1048576).toFixed(2)} MB，`
    + `請求 ${stats.requests}（快取 ${stats.cacheHits}、429 ${stats.rateLimited}），耗時 ${mins} 分`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
