import {
  loadJSON, failInto, initChrome, stampFooter, fmtAmount, fmtInt, fmtDate,
  el, $, clear, sum, STATUS, DOMAIN, TRACK, trackOf,
} from './common.js';

initChrome('tenders');

// 手機預設收合，節省第一屏空間；桌面版一律展開（.filters-summary 在桌面隱藏，開不了關不了）
if (window.matchMedia('(max-width: 640px)').matches) {
  document.querySelector('.filters-wrap')?.removeAttribute('open');
}

const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, v);
  return n;
}

const STATUS_CLASS = { awarded: 'c1', open: 'c2', closed: 'c5', failed: 'c3', pre: 'c6' };

const PAGE = 200;

const F = {
  scope: $('#f-scope'), year: $('#f-year'), status: $('#f-status'), category: $('#f-category'),
  group: $('#f-group'), domain: $('#f-domain'), q: $('#f-q'),
};

let ALL = [];
let view = [];
let shown = 0;

loadJSON('data/tenders.json').then(start).catch(err => failInto($('#tbody-host'), err));

function start(d) {
  ALL = (d.tenders || []).map(t => (t.track ? t : { ...t, track: trackOf(t) }));
  stampFooter(d.generated_at);
  buildOptions();
  readURL();
  for (const [k, node] of Object.entries(F)) {
    if (!node) continue;
    node.addEventListener(k === 'q' ? 'input' : 'change', () => { writeURL(); apply(); });
  }
  $('#f-reset').addEventListener('click', () => {
    F.scope.value = 'domestic'; F.year.value = ''; F.status.value = ''; F.category.value = '';
    F.group.value = ''; F.domain.value = 'air'; F.q.value = '';
    writeURL(); apply();
  });
  window.addEventListener('popstate', () => { readURL(); apply(); });
  apply();
}

function uniq(key) {
  return [...new Set(ALL.map(t => t[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

function fill(node, values, labeller) {
  for (const v of values) node.append(el('option', { value: v, text: labeller ? labeller(v) : v }));
}

function buildOptions() {
  const years = [...new Set(ALL.map(t => (t.award_date || t.first_notice_date || '').slice(0, 4)).filter(Boolean))]
    .sort().reverse();
  fill(F.year, years);
  fill(F.status, ['awarded', 'open', 'closed', 'failed', 'pre'].filter(s => ALL.some(t => t.status === s)), s => STATUS[s]);
  fill(F.category, uniq('category'));
  fill(F.group, uniq('agency_group'));
}

/* ---------- 網址同步 ---------- */

const KEYS = { scope: 'k', year: 'y', status: 's', category: 'c', group: 'g', domain: 'd', q: 'q' };

const DEFAULTS = { scope: 'domestic', domain: 'air' };

function readURL() {
  const p = new URLSearchParams(location.search);
  for (const [k, short] of Object.entries(KEYS)) {
    const node = F[k];
    if (!node) continue;
    const fallback = DEFAULTS[k] ?? '';
    const v = p.get(short) ?? fallback;
    node.value = v;
    if (node.tagName === 'SELECT' && node.value !== v) node.value = fallback;
  }
}

function writeURL() {
  const p = new URLSearchParams();
  for (const [k, short] of Object.entries(KEYS)) {
    const v = F[k]?.value || '';
    if (!v) continue;
    if (DEFAULTS[k] && v === DEFAULTS[k]) continue;
    p.set(short, v);
  }
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

/* ---------- 篩選 ---------- */

function apply() {
  const y = F.year.value, s = F.status.value, c = F.category.value;
  const g = F.group.value, d = F.domain.value, k = F.scope.value;
  const q = F.q.value.trim().toLowerCase();

  view = ALL.filter(t => {
    // 「全部」才會帶出其他軌，以及標題沒寫無人機的案子（定翼機撈到的有人機）
    if (k) {
      if (t.track !== k) return false;
      if (t.drone_in_title === false) return false;
    }
    if (y && (t.award_date || t.first_notice_date || '').slice(0, 4) !== y) return false;
    if (s && t.status !== s) return false;
    if (c && t.category !== c) return false;
    if (g && t.agency_group !== g) return false;
    if (d && t.domain !== d) return false;
    if (q) {
      const hay = `${t.title} ${t.agency} ${(t.winners || []).map(w => w.name).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const awarded = view.filter(t => t.status === 'awarded');
  const total = awarded.reduce((a, t) => a + (t.award_amount || 0), 0);
  const label = TRACK[F.scope.value] || '全部範圍';
  $('#result').innerHTML =
    `${label}<span class="sep"> · </span>` +
    `<span class="n">${fmtInt(view.length)}</span> 件` +
    `<span class="sep"> · </span>決標 ${fmtInt(awarded.length)} 件，共 ${fmtAmount(total)}`;

  shown = 0;
  clear($('#tbody'));
  more();
  monthlyChart();
}

let mcT = 0;
window.addEventListener('resize', () => { clearTimeout(mcT); mcT = setTimeout(monthlyChart, 160); });

/* ---------- 每月件數（依目前篩選即時重算） ---------- */

function monthlyChart() {
  const host = clear($('#month-chart'));
  if (!host) return;

  const counts = new Map();
  for (const t of view) {
    const d = t.award_date || t.last_notice_date || t.first_notice_date;
    if (!d || d.slice(0, 4) < '2016') continue;
    const m = d.slice(0, 7);
    counts.set(m, (counts.get(m) || 0) + 1);
  }
  if (!counts.size) { host.append(el('p', { class: 'empty', text: '沒有可畫的月份資料。' })); return; }

  const months = [...counts.keys()].sort();
  const [sy, sm] = months[0].split('-').map(Number);
  const [ey, em] = months.at(-1).split('-').map(Number);
  const start = sy * 12 + sm - 1, end = ey * 12 + em - 1;
  const rows = [];
  for (let i = start; i <= end; i++) {
    const key = `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
    rows.push({ m: key, count: counts.get(key) || 0 });
  }

  const W = Math.max(320, Math.round(host.clientWidth || 1000));
  const H = 74, PB = 18, PT = 6;
  const max = Math.max(...rows.map(r => r.count), 1);
  const step = W / rows.length;
  const bw = Math.max(1, Math.min(6, step * 0.7));
  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  g.setAttribute('aria-label', `2016 年起每月件數，最高一個月 ${fmtInt(max)} 件。`);

  g.append(svg('line', { x1: 0, x2: W, y1: H - PB, y2: H - PB, class: 'axis' }));

  rows.forEach((r, i) => {
    const h = (r.count / max) * (H - PB - PT);
    if (h > 0) {
      g.append(svg('rect', {
        x: i * step + (step - bw) / 2, y: H - PB - h, width: bw, height: Math.max(1, h), class: 'bar',
      }));
    }
    if (r.m.endsWith('-01')) {
      const t = svg('text', { x: i * step, y: H - 4, class: 'tlabel' });
      t.textContent = r.m.slice(0, 4);
      g.append(t);
      g.append(svg('line', { x1: i * step, x2: i * step, y1: H - PB, y2: H - PB + 3, class: 'axis' }));
    }
  });

  host.append(g);
}

function more() {
  const body = $('#tbody');
  const slice = view.slice(shown, shown + PAGE);
  const frag = document.createDocumentFragment();
  for (const t of slice) frag.append(row(t));
  body.append(frag);
  shown += slice.length;

  const btn = $('#more-btn');
  const empty = $('#empty');
  empty.hidden = view.length > 0;
  $('#table').hidden = view.length === 0;
  if (shown < view.length) {
    btn.hidden = false;
    btn.textContent = `再看 ${Math.min(PAGE, view.length - shown)} 筆（還有 ${fmtInt(view.length - shown)} 筆）`;
  } else {
    btn.hidden = true;
  }
}

$('#more-btn').addEventListener('click', more);

/* ---------- 列 ---------- */

function row(t) {
  const tr = el('tr');
  const date = t.award_date || t.last_notice_date || t.first_notice_date;

  const btn = el('button', {
    type: 'button', class: 'linkbtn open-btn', 'aria-expanded': 'false', text: t.title,
  });

  tr.append(
    el('td', { class: 't-date', text: fmtDate(date) }),
    el('td', { class: 't-agency', text: t.agency }),
    el('td', { class: 't-title' }, [
      btn,
      t.framework ? el('span', { class: 'flag', text: '共同供應契約' }) : null,
    ]),
    el('td', { class: 't-num t-budget', 'data-l': '預算', text: fmtAmount(t.budget) }),
    el('td', { class: 't-num t-award', 'data-l': '決標', text: fmtAmount(t.award_amount) }),
    el('td', { class: 't-vendor', text: (t.winners || []).map(w => w.name).join('、') || '—' }),
    el('td', { class: 't-status' }, [
      el('span', { class: `stag ${STATUS_CLASS[t.status] || 'c5'}` }),
      document.createTextNode(STATUS[t.status] || t.status),
    ])
  );

  let det = null;
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') === 'true';
    if (open) { det?.remove(); det = null; btn.setAttribute('aria-expanded', 'false'); return; }
    det = detail(t);
    tr.after(det);
    btn.setAttribute('aria-expanded', 'true');
  });

  return tr;
}

function detail(t) {
  const tr = el('tr', { class: 'detail' });
  const td = el('td', { colspan: 7 });

  const dl = (pairs) => el('dl', null, pairs.flatMap(([k, v]) =>
    v == null ? [] : [el('dt', { text: k }), el('dd', { text: v })]));

  const origins = (t.winners || []).flatMap(w => w.origins || []);
  const oText = origins.length
    ? origins.map(o => `${o.country} ${fmtAmount(o.amount)}`).join('、')
    : '機關未填';

  const box = el('div', { class: 'detail-box' }, [
    dl([
      ['類別', t.category],
      ['範圍', TRACK[t.track] || null],
      ['領域', DOMAIN[t.domain] || t.domain],
      ['採購性質', t.procurement_type],
      ['招標方式', t.method],
      ['決標方式', t.award_method],
      ['投標家數', t.bidders_count == null ? null : `${fmtInt(t.bidders_count)} 家`],
      ['原產地', oText],
      ['標的分類', t.subject_class],
      ['國安採購', t.national_security ? '是' : null],
      ['標題關鍵字', t.drone_in_title === false ? '標題沒有無人機字樣' : null],
    ]),
    el('div', null, [
      el('h3', { text: '公告時間軸' }),
      el('ul', { class: 'tl' }, (t.announcements || []).map(a =>
        el('li', null, [el('b', { text: fmtDate(a.date) }), document.createTextNode(a.type)]))),
      el('p', { class: 'more' }, [
        el('a', { href: t.pcc_url, rel: 'noopener', target: '_blank', text: '政府電子採購網原頁' }),
      ]),
    ]),
  ]);

  td.append(box);
  tr.append(td);
  return tr;
}
