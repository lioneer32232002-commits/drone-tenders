// 共用：載資料、格式化、頁頭頁尾
// 頁頭頁尾的連結寫在各頁 HTML（爬蟲要看得到），這裡只負責標記目前頁籤與補上更新時間。

export const STATUS = {
  awarded: '已決標',
  failed: '無法決標',
  closed: '已截止',
  open: '招標中',
  pre: '前置作業',
};

// 原產地排序：優先國別照這個順序，其餘依名稱排，「其他」永遠最後
export const ORIGIN_PREF = ['臺灣', '台灣', '美國', '中國', '中國大陸', '日本'];

export function originOrder(countries) {
  const list = [...new Set(countries)];
  const known = ORIGIN_PREF.filter(c => list.includes(c));
  const rest = list
    .filter(c => !ORIGIN_PREF.includes(c) && c !== '其他')
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  return [...known, ...rest, ...(list.includes('其他') ? ['其他'] : [])];
}

export const DOMAIN = { air: '空中', sea: '水上水下', ground: '地面' };

const NBSP = ' ';

/* ---------- 載入 ---------- */

const cache = new Map();

export function loadJSON(path) {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(path, { cache: 'no-cache' }).then(r => {
        if (!r.ok) throw new Error(`${path} ${r.status}`);
        return r.json();
      })
    );
  }
  return cache.get(path);
}

export function failInto(node, err) {
  console.error(err);
  if (node) {
    node.className = 'empty';
    node.textContent = '資料暫時讀不到，請稍後重新整理。';
  }
}

/* ---------- 數字與金額 ---------- */

const group = n => n.toLocaleString('en-US');

const trim = s => (s.indexOf('.') < 0 ? s : s.replace(/\.?0+$/, ''));

// 1.23 億 / 4,500 萬 / 8,300
export function fmtAmount(n) {
  const p = amountParts(n);
  return p == null ? '—' : p.unit ? `${p.value}${NBSP}${p.unit}` : p.value;
}

export function amountParts(n) {
  if (n == null || !isFinite(n)) return null;
  const neg = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e8) return { value: neg + trim((a / 1e8).toFixed(2)), unit: '億' };
  if (a >= 1e4) return { value: neg + group(Math.round(a / 1e4)), unit: '萬' };
  return { value: neg + group(Math.round(a)), unit: '' };
}

export const fmtInt = n => (n == null ? '—' : group(Math.round(n)));

export const pct = (n, total) => (!total ? 0 : (n / total) * 100);

export const fmtPct = (n, total) => `${trim(pct(n, total).toFixed(1))}%`;

/* ---------- 日期 ---------- */

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${y}.${m}.${d}`;
}

export function fmtMonth(iso) {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  return `${+m}月${+d}日`;
}

export function fmtStamp(iso) {
  if (!iso) return '';
  return iso.slice(0, 10).replace(/-/g, '.');
}

export const year = iso => (iso ? iso.slice(0, 4) : '');

/* ---------- DOM ---------- */

export function el(tag, attrs, kids) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
  }
  if (kids) for (const k of [].concat(kids)) if (k) n.append(k);
  return n;
}

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/* ---------- 頁頭頁尾 ---------- */

export function initChrome(page) {
  const link = document.querySelector(`.nav a[data-p="${page}"]`);
  if (link) link.setAttribute('aria-current', 'page');
  document.documentElement.classList.add('ready');
}

export function stampFooter(generatedAt) {
  const s = fmtStamp(generatedAt);
  for (const n of $$('[data-updated]')) {
    n.textContent = s || '—';
    if (n.tagName === 'TIME' && generatedAt) n.setAttribute('datetime', generatedAt.slice(0, 10));
  }
}

/* ---------- 提示框 ---------- */

let tipNode = null;

export function showTip(evt, html) {
  if (!tipNode) {
    tipNode = el('div', { class: 'tip', role: 'status' });
    document.body.append(tipNode);
  }
  tipNode.innerHTML = html;
  tipNode.hidden = false;
  tipNode.style.left = `${evt.clientX}px`;
  tipNode.style.top = `${evt.clientY}px`;
}

export function hideTip() {
  if (tipNode) tipNode.hidden = true;
}

/* ---------- 小工具 ---------- */

export const sum = (arr, f = x => x) => arr.reduce((s, x) => s + (f(x) || 0), 0);

export function colorClass(i) {
  return `c${(i % 6) + 1}`;
}

// 標案唯一 id 放進網址時要能還原
export const idKey = id => encodeURIComponent(id);
