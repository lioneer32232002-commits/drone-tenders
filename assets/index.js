import {
  loadJSON, failInto, initChrome, stampFooter, fmtAmount, amountParts, fmtInt,
  fmtPct, fmtDate, el, $, clear, sum, showTip, hideTip,
} from './common.js';

initChrome('index');

const NS = 'http://www.w3.org/2000/svg';
const FIRST_YEAR = 2016;

function svg(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, v);
  return n;
}

loadJSON('data/summary.json').then(render).catch(err => failInto($('#lede'), err));

/* ---------- 三軌：國內／對美軍購／工程 ---------- */

// summary 的頂層就是 domestic（資料還沒切軌時也一樣成立），fms / works 掛在旁邊
const pickTracks = s => ({ d: s.domestic || s, fms: s.fms, works: s.works });

function trackTotals(t) {
  if (!t) return null;
  const T = t.totals || t;
  const count = T.awarded_count ?? T.count ?? (Array.isArray(t.items) ? t.items.length : 0);
  const amount = T.awarded_amount ?? T.amount ?? 0;
  return count || amount ? { count, amount } : null;
}

const itemsOf = t => (Array.isArray(t?.items) ? t.items : Array.isArray(t?.tenders) ? t.tenders : []);

function render(s) {
  stampFooter(s.generated_at);

  const { d, fms, works } = pickTracks(s);
  const T = d.totals || {};
  const year = T.this_year || T.year || {};
  const all = T.all || T;

  const yearCount = year.awarded_count ?? year.count ?? 0;
  const yearAmount = year.awarded_amount ?? 0;
  const openCount = all.open_count ?? 0;
  const allCount = all.count ?? 0;
  const allAmount = all.awarded_amount ?? 0;

  const money = amountParts(yearAmount) || { value: '0', unit: '' };
  $('#lede').innerHTML =
    `今年到目前為止，台灣政府決標了 <b>${fmtInt(yearCount)}</b> 件國內無人機採購，` +
    `共 <b>${money.value}${money.unit ? ' ' + money.unit : ''}</b>元。`;

  aside(fms, works);

  $('#hero-meta').innerHTML =
    `資料更新 <time data-updated>—</time><span class="sep">·</span>` +
    `招標中 ${fmtInt(openCount)} 件<span class="sep">·</span>` +
    `收錄 ${fmtInt(allCount)} 件`;
  stampFooter(s.generated_at);

  const ya = amountParts(yearAmount) || { value: '0', unit: '' };
  const aa = amountParts(allAmount) || { value: '0', unit: '' };
  num($('#t-year-count'), fmtInt(yearCount), '件');
  num($('#t-year-amount'), ya.value, ya.unit);
  num($('#t-open'), fmtInt(openCount), '件');
  num($('#t-all-amount'), aa.value, aa.unit);

  origin(d);
  quarters(d);
  sources(d);
  vendors(d);
  recent(d);
  offBook(fms, works);
}

function aside(fms, works) {
  const node = $('#hero-aside');
  if (!node) return;
  const bits = [];
  const f = trackTotals(fms);
  const w = trackTotals(works);
  if (f) bits.push(`對美軍購 ${fmtInt(f.count)} 件 ${fmtAmount(f.amount)}`);
  if (w) bits.push(`工程類 ${fmtInt(w.count)} 件 ${fmtAmount(w.amount)}`);
  if (!bits.length) { node.hidden = true; return; }
  node.hidden = false;
  node.textContent = `另有${bits.join('、')}，未計入下方圖表。`;
}

function num(node, v, unit) {
  clear(node);
  node.append(v);
  if (unit) node.append(el('span', { class: 'u', text: unit }));
}

/* ---------- 01 哪裡製造 ---------- */

// 原產地收斂成四類，顏色固定
const BUCKETS = ['臺灣', '美國', '中國', '其他'];
const BUCKET_CLASS = { 臺灣: 'c1', 美國: 'c2', 中國: 'c3', 其他: 'c6' };

function bucket(country) {
  if (country === '臺灣' || country === '台灣') return '臺灣';
  if (country === '美國') return '美國';
  if (country === '中國' || country === '中國大陸') return '中國';
  return '其他';
}

function origin(d) {
  const main = new Map(BUCKETS.map(b => [b, 0]));
  for (const r of d.by_origin || []) main.set(bucket(r.country), main.get(bucket(r.country)) + (r.amount || 0));

  const total = sum([...main.values()]);
  const bar = clear($('#origin-bar'));
  const leg = clear($('#origin-legend'));

  if (!total) {
    bar.remove();
    leg.append(el('li', { class: 'v', text: '目前沒有可歸戶的原產地金額。' }));
  }

  for (const b of BUCKETS) {
    const amount = main.get(b);
    if (amount > 0) {
      bar.append(el('span', {
        class: BUCKET_CLASS[b],
        style: `width:${(amount / total) * 100}%`,
        title: `${b} ${fmtAmount(amount)}`,
      }));
    }
    leg.append(el('li', null, [
      el('span', { class: `sw ${BUCKET_CLASS[b]}` }),
      el('span', { class: 'k', text: b }),
      el('span', { class: 'v', text: `${fmtAmount(amount)}　${fmtPct(amount, total)}` }),
    ]));
  }

  bar.setAttribute('aria-label',
    '原產地金額占比：' + BUCKETS.map(b => `${b} ${fmtPct(main.get(b), total)}`).join('、'));

  originYears(d);
}

// 2016 起每年一根 100% 堆疊條，年份下方是該年國內決標總額
function originYears(d) {
  const wrap = clear($('#origin-years'));
  const rows = new Map();
  for (const r of d.by_origin_year || []) {
    const y = +(r.year ?? r.y);
    if (!(y >= FIRST_YEAR)) continue;
    const m = rows.get(y) || new Map(BUCKETS.map(b => [b, 0]));
    const pairs = Array.isArray(r.origins)
      ? r.origins.map(o => [o.country, o.amount])
      : Object.entries(r).filter(([k, v]) => k !== 'y' && k !== 'year' && typeof v === 'number');
    for (const [c, amt] of pairs) m.set(bucket(c), m.get(bucket(c)) + (amt || 0));
    rows.set(y, m);
  }

  const awardedByYear = new Map(
    (d.by_year || []).map(r => [+(r.year ?? r.y), r.awarded_amount || 0])
  );

  const last = Math.max(FIRST_YEAR, ...[...rows.keys()], ...[...awardedByYear.keys()]);
  if (!isFinite(last)) { wrap.remove(); return; }

  for (let y = FIRST_YEAR; y <= last; y++) {
    const m = rows.get(y);
    const t = m ? sum([...m.values()]) : 0;
    const col = el('span', { class: 'col-bar' });
    if (t > 0) {
      for (const b of BUCKETS) {
        const v = m.get(b) || 0;
        if (!v) continue;
        col.append(el('span', {
          class: BUCKET_CLASS[b],
          style: `height:${(v / t) * 100}%`,
          title: `${y} ${b} ${fmtAmount(v)}`,
        }));
      }
    }
    const awarded = awardedByYear.get(y);
    wrap.append(el('div', {
      class: 'yr',
      role: 'listitem',
      'aria-label': t
        ? `${y} 年，` + BUCKETS.filter(b => m.get(b)).map(b => `${b} ${fmtPct(m.get(b), t)}`).join('、')
        : `${y} 年沒有填報原產地的決標`,
    }, [
      col,
      el('span', { class: 'yl', text: String(y) }),
      el('span', { class: 'yv', text: awarded ? fmtAmount(awarded) : '—' }),
    ]));
  }
}

/* ---------- 02 每季 ---------- */

let qRows = null;

function quarters(d) {
  const given = (d.by_quarter || []).map(r => ({
    q: r.q || r.quarter,
    awarded_count: r.awarded_count || 0,
    awarded_amount: r.awarded_amount || 0,
  })).filter(r => r.q && +r.q.slice(0, 4) >= FIRST_YEAR).sort((a, b) => (a.q < b.q ? -1 : 1));

  // 補上沒有資料的季，時間軸才是真的等距
  qRows = [];
  if (given.length) {
    const at = new Map(given.map(r => [r.q, r]));
    const start = FIRST_YEAR * 4;
    const endRow = given.at(-1).q;
    const end = +endRow.slice(0, 4) * 4 + (+endRow.slice(5) - 1);
    for (let i = start; i <= end; i++) {
      const key = `${Math.floor(i / 4)}Q${(i % 4) + 1}`;
      qRows.push(at.get(key) || { q: key, awarded_count: 0, awarded_amount: 0 });
    }
  }
  drawQuarters();
  let t = 0;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(drawQuarters, 160);
  });
}

function drawQuarters() {
  const rows = qRows;
  const host = clear($('#quarter-chart'));
  if (!rows || !rows.length) { host.append(el('p', { class: 'empty', text: '沒有季度資料。' })); return; }

  // viewBox 對齊實際像素寬，字級才不會被縮掉
  const W = Math.max(320, Math.round(host.clientWidth || 1000));
  const narrow = W < 560;
  const H = narrow ? 180 : 230;
  const PB = 24, PT = 12;
  const max = Math.max(...rows.map(r => r.awarded_amount), 1);
  const step = W / rows.length;
  const bw = Math.max(2, Math.min(46, step * 0.62));
  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  g.setAttribute('aria-label', `${FIRST_YEAR} 年起每季決標金額長條圖，最高一季 ${fmtAmount(max)}。`);

  for (const f of [0.5, 1]) {
    const yy = PT + (H - PB - PT) * (1 - f);
    g.append(svg('line', { x1: 0, x2: W, y1: yy, y2: yy, class: 'tickline' }));
    const lab = svg('text', { x: 0, y: yy - 5, class: 'tlabel' });
    lab.textContent = fmtAmount(max * f);
    g.append(lab);
  }
  g.append(svg('line', { x1: 0, x2: W, y1: H - PB, y2: H - PB, class: 'axis' }));

  const bars = [];
  rows.forEach((r, i) => {
    const h = (r.awarded_amount / max) * (H - PB - PT);
    if (h > 0) {
      const b = svg('rect', {
        x: i * step + (step - bw) / 2, y: H - PB - h, width: bw, height: h, class: 'bar',
      });
      bars[i] = b;
      g.append(b);
    }
    const yr = +r.q.slice(0, 4);
    if (r.q.endsWith('Q1') && (!narrow || yr % 2 === 0)) {
      const t = svg('text', { x: i * step, y: H - 8, class: 'tlabel' });
      t.textContent = narrow ? `'${String(yr).slice(2)}` : String(yr);
      g.append(t);
      g.append(svg('line', { x1: i * step, x2: i * step, y1: H - PB, y2: H - PB + 4, class: 'axis' }));
    }
    const hit = svg('rect', { x: i * step, y: 0, width: step, height: H - PB, class: 'hit' });
    hit.addEventListener('pointerenter', e => {
      host.classList.add('dim');
      bars[i]?.classList.add('on');
      const q = `${r.q.slice(0, 4)} 年第 ${r.q.slice(5)} 季`;
      showTip(e, r.awarded_count
        ? `<b>${q}</b><br><span class="m">決標 ${fmtInt(r.awarded_count)} 件 · ${fmtAmount(r.awarded_amount)}</span>`
        : `<b>${q}</b><br><span class="m">沒有決標</span>`);
    });
    hit.addEventListener('pointerleave', () => {
      host.classList.remove('dim');
      bars[i]?.classList.remove('on');
      hideTip();
    });
    g.append(hit);
  });

  host.append(g);
}

/* ---------- 03 錢從哪裡來 ---------- */

function sources(d) {
  const rows = (d.by_agency_group || [])
    .map(r => ({ name: r.agency_group ?? r.name, count: r.count, amount: r.amount || 0 }))
    .filter(r => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const total = sum(rows, r => r.amount);
  const bar = clear($('#group-bar'));
  const leg = clear($('#group-legend'));
  rows.forEach((r, i) => {
    bar.append(el('span', {
      class: `c${(i % 6) + 1}`,
      style: `width:${(r.amount / total) * 100}%`,
      title: `${r.name} ${fmtAmount(r.amount)}`,
    }));
    leg.append(el('li', null, [
      el('span', { class: `sw c${(i % 6) + 1}` }),
      el('span', { class: 'k', text: r.name }),
      el('span', { class: 'v', text: `${fmtAmount(r.amount)}　${fmtInt(r.count)} 件` }),
    ]));
  });
  bar.setAttribute('aria-label',
    '機關群組金額占比：' + rows.map(r => `${r.name} ${fmtPct(r.amount, total)}`).join('、'));
}

/* ---------- 04 錢到哪裡去 ---------- */

function vendors(d) {
  const rows = (d.top_vendors || [])
    .map(r => ({ name: r.vendor ?? r.name, count: r.count, amount: r.amount || 0 }))
    .slice(0, 10);
  const host = clear($('#vendor-bars'));
  if (!rows.length) { host.append(el('p', { class: 'empty', text: '沒有得標廠商資料。' })); return; }
  const max = Math.max(...rows.map(r => r.amount), 1);
  for (const r of rows) {
    host.append(el('div', { class: 'hbar' }, [
      el('span', { class: 'k', text: r.name }),
      el('span', { class: 't', style: `width:${(r.amount / max) * 100}%` }),
      el('span', { class: 'v', text: `${fmtAmount(r.amount)}　${fmtInt(r.count)} 件` }),
    ]));
  }
}

/* ---------- 05 最近 ---------- */

function recent(d) {
  const rows = (d.recent || []).slice(0, 15);
  const host = clear($('#recent-list'));
  if (!rows.length) { host.append(el('li', { class: 'empty', text: '最近 60 天沒有新公告。' })); return; }
  for (const r of rows) {
    host.append(el('li', null, [
      el('span', { class: 'd', text: fmtDate(r.date) }),
      el('span', { class: 't' }, [
        el('a', { href: `tenders.html?q=${encodeURIComponent(r.title)}`, text: r.title }),
        el('span', { class: 'ag', text: r.agency }),
      ]),
      el('span', { class: 'a' }, [
        document.createTextNode(fmtAmount(r.amount)),
        el('span', { class: 'ty', text: r.type }),
      ]),
    ]));
  }
}

/* ---------- 06 帳外：對美軍購與工程類 ---------- */

function offBook(fms, works) {
  const sec = $('#offbook');
  const host = $('#offbook-list');
  if (!sec || !host) return;
  clear(host);

  const rows = [
    ...itemsOf(fms).map(r => ({ ...r, kind: '對美軍購' })),
    ...itemsOf(works).map(r => ({ ...r, kind: '工程類' })),
  ].sort((a, b) => ((a.award_date || a.date || '') < (b.award_date || b.date || '') ? 1 : -1));

  if (!rows.length) { sec.hidden = true; return; }
  sec.hidden = false;

  for (const r of rows.slice(0, 20)) {
    host.append(el('li', null, [
      el('span', { class: 'd', text: fmtDate(r.award_date || r.date) }),
      el('span', { class: 't' }, [
        el('a', { href: `tenders.html?k=${r.kind === '對美軍購' ? 'fms' : 'works'}&q=${encodeURIComponent(r.title || '')}`, text: r.title || '(無標題)' }),
        el('span', { class: 'ag', text: r.agency || '' }),
      ]),
      el('span', { class: 'a' }, [
        document.createTextNode(fmtAmount(r.award_amount ?? r.amount)),
        el('span', { class: 'ty', text: r.kind }),
      ]),
    ]));
  }
}
