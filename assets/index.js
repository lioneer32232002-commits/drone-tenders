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
  categories(d);
  competition(d);
  flow(d);
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
  const big = $('#origin-big');
  const rest = clear($('#origin-rest'));

  if (!total) {
    big.textContent = '沒有可歸戶的原產地金額。';
    return;
  }

  // 臺灣壓倒性多數，畫成色帶看不出東西，改用大字直接把數字講出來
  clear(big);
  big.append(el('span', { text: `臺灣 ${fmtPct(main.get('臺灣'), total)}` }));
  big.append(el('span', { class: 'amt', text: fmtAmount(main.get('臺灣')) }));

  for (const b of BUCKETS) {
    if (b === '臺灣') continue;
    rest.append(el('li', null, [
      el('span', { class: `sw ${BUCKET_CLASS[b]}` }),
      el('span', { class: 'k', text: `${b} ${fmtPct(main.get(b), total)}` }),
      el('span', { class: 'v', text: fmtAmount(main.get(b)) }),
    ]));
  }

  originYears(d);
}

// 2016 起每年一列：長條長度是該年國內決標總額，分段顏色是原產地，右側是非國產占比
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

  const awardedByYear = new Map((d.by_year || []).map(r => [+(r.year ?? r.y), r.awarded_amount || 0]));
  const last = Math.max(FIRST_YEAR, ...rows.keys(), ...awardedByYear.keys());
  if (!isFinite(last)) { wrap.remove(); return; }

  const maxAwarded = Math.max(1, ...[...awardedByYear.entries()].filter(([y]) => y >= FIRST_YEAR).map(([, v]) => v));

  // 門檻用各年非國產比例的平均。整期比例會被金額最大的那一年壓低，
  // 拿來當門檻會有一半以上的年份都被標成偏高，反而看不出哪一年異常。
  const yearly = [...rows.entries()]
    .filter(([y, m]) => y >= FIRST_YEAR && sum([...m.values()]) > 0)
    .map(([, m]) => { const t = sum([...m.values()]); return (t - m.get('臺灣')) / t; });
  const avgForeign = yearly.length ? sum(yearly) / yearly.length : 0;

  for (let y = FIRST_YEAR; y <= last; y++) {
    const m = rows.get(y);
    const oTotal = m ? sum([...m.values()]) : 0;
    const awarded = awardedByYear.get(y) || 0;

    // 左欄：該年決標總額，線性，年與年之間可比
    const totalBar = el('span', { class: awarded ? 'yb-bar' : 'yb-bar empty' });
    totalBar.style.width = `${Math.max(awarded ? 0.8 : 0, (awarded / maxAwarded) * 100)}%`;

    // 右欄：永遠滿格，只表示當年原產地組成，早年金額小也讀得出來
    const mixBar = el('span', { class: oTotal ? 'yb-bar' : 'yb-bar empty' });
    if (oTotal) {
      for (const b of BUCKETS) {
        const v = m.get(b) || 0;
        if (!v) continue;
        mixBar.append(el('i', { class: BUCKET_CLASS[b], style: `width:${(v / oTotal) * 100}%` }));
      }
    }

    const foreign = oTotal ? (oTotal - m.get('臺灣')) / oTotal : null;
    const pctText = foreign != null ? fmtPct(oTotal - m.get('臺灣'), oTotal) : '—';
    const hot = foreign != null && foreign > avgForeign;

    const row = el('div', {
      class: 'yb',
      role: 'listitem',
      'aria-label': `${y} 年，國內決標 ${fmtAmount(awarded)}，非國產占 ${pctText}`,
    }, [
      el('span', { class: 'yb-y', text: String(y) }),
      el('span', { class: 'yb-track' }, [totalBar]),
      el('span', { class: 'yb-total num', text: awarded ? fmtAmount(awarded) : '—' }),
      el('span', { class: 'yb-mix' }, [mixBar]),
      el('span', { class: `yb-pct num${hot ? ' hot' : ''}`, text: pctText }),
    ]);

    const detail = oTotal
      ? BUCKETS.filter(b => m.get(b)).map(b => `${b} ${fmtAmount(m.get(b))}`).join('　')
      : '這一年沒有填報原產地';
    row.addEventListener('pointerenter', e => showTip(e,
      `<b>${y}</b> 國內決標 ${fmtAmount(awarded)}<br><span class="m">${detail}</span>`));
    row.addEventListener('pointerleave', hideTip);

    wrap.append(row);
  }
}

/* ---------- 02 每季 ---------- */

let qRows = null;

function quarters(d) {
  const given = (d.by_quarter || []).map(r => ({
    q: r.q || r.quarter,
    awarded_count: r.awarded_count || 0,
    awarded_amount: r.awarded_amount || 0,
    top: r.top || null,
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

  // 註記：金額最高的幾季，在長條上方標那一季最大的一案。手機只留最高的一季。
  const notes = rows
    .map((r, i) => ({ r, i }))
    .filter(x => x.r.top && x.r.awarded_amount > 0)
    .sort((a, b) => b.r.awarded_amount - a.r.awarded_amount)
    .slice(0, narrow ? 1 : 3)
    .sort((a, b) => a.i - b.i);
  const ROW = 21;
  const AN = notes.length ? notes.length * ROW + 10 : 0;

  const H = (narrow ? 180 : 230) + AN;
  const PB = 24, PT = 12 + AN;
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

  // 註記：細線從長條頂端拉到上方，字 14px。標題截到 14 字。
  notes.forEach((n, k) => {
    const x = n.i * step + step / 2;
    const barTop = H - PB - (n.r.awarded_amount / max) * (H - PB - PT);
    const y = 14 + k * ROW;
    const wide = Math.min(300, W * 0.72);
    let left = x > W * 0.5;
    if (left && x - wide < 0) left = false;
    if (!left && x + wide > W) left = true;

    g.append(svg('line', { x1: x, x2: x, y1: barTop - 4, y2: y + 4, class: 'anno-line' }));
    const t = svg('text', { x: left ? x - 9 : x + 9, y, class: 'anno', 'text-anchor': left ? 'end' : 'start' });
    const q = svg('tspan', { class: 'anno-q' });
    q.textContent = `${n.r.q.slice(0, 4)}Q${n.r.q.slice(5)}　`;
    const ttl = svg('tspan');
    ttl.textContent = cut(n.r.top.title, 14);
    const amt = svg('tspan', { class: 'anno-a' });
    amt.textContent = `　${fmtAmount(n.r.top.amount)}`;
    t.append(q, ttl, amt);
    g.append(t);
  });

  host.append(g);
}

const cut = (s, n) => (!s ? '' : s.length > n ? `${s.slice(0, n)}…` : s);

/* ---------- 03 哪一類 ---------- */

function categories(d) {
  const rows = (d.by_category || [])
    .map(r => ({ name: r.category ?? r.name, count: r.awarded_count ?? r.count, amount: r.amount || 0 }))
    .filter(r => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const host = clear($('#category-bars'));
  if (!rows.length) { host.append(el('p', { class: 'empty', text: '沒有分類資料。' })); return; }

  const max = Math.max(...rows.map(r => r.amount), 1);
  const total = sum(rows, r => r.amount);
  for (const r of rows) {
    const row = el('div', { class: 'hbar' }, [
      el('span', { class: 'k', text: r.name }),
      el('span', { class: 'trk' }, [
        el('span', { class: 't', style: `width:${Math.max(0.4, (r.amount / max) * 100)}%` }),
      ]),
      el('span', { class: 'v num' }, [
        el('span', { class: 'amt', text: fmtAmount(r.amount) }),
        el('span', { class: 'n', text: `${fmtInt(r.count)} 件` }),
      ]),
    ]);
    row.addEventListener('pointerenter', e => showTip(e,
      `<b>${r.name}</b><br><span class="m">決標 ${fmtInt(r.count)} 件 · ${fmtAmount(r.amount)} · 占 ${fmtPct(r.amount, total)}</span>`));
    row.addEventListener('pointerleave', hideTip);
    host.append(row);
  }
}

/* ---------- 04 競爭程度 ---------- */

const COMP_CLASS = ['c1', 'c2', 'c3'];

function competition(d) {
  const b = d.by_bidders;
  const big = $('#comp-big');
  const bar = clear($('#comp-bar'));
  const keys = clear($('#comp-keys'));
  if (!big) return;
  if (!b || !b.counted) {
    big.textContent = '沒有可歸戶的投標家數。';
    return;
  }

  const single = b.buckets[0];
  const pctSingle = fmtPct(single.count, b.counted);
  clear(big);
  big.append(el('span', { text: `單一投標占 ${pctSingle}` }));
  big.append(el('span', { class: 'amt', text: `${fmtInt(single.count)} 件 · ${fmtAmount(single.amount)}` }));

  bar.setAttribute('aria-label', b.buckets
    .map((r, i) => `${r.label} ${fmtPct(r.count, b.counted)}`).join('，'));

  b.buckets.forEach((r, i) => {
    if (!r.count) return;
    bar.append(el('span', { class: COMP_CLASS[i], style: `width:${Math.max(0.6, (r.count / b.counted) * 100)}%` }));

    keys.append(el('li', null, [
      el('span', { class: `sw ${COMP_CLASS[i]}` }),
      el('span', { class: 'k', text: `${r.label} ${fmtPct(r.count, b.counted)}` }),
      el('span', { class: 'v', text: `${fmtInt(r.count)} 件 · ${fmtAmount(r.amount)}` }),
    ]));
  });
}

/* ---------- 05 錢的流向（手刻兩欄桑基圖） ---------- */

// 廠商全名太長，右欄標不下，去掉公司型態的後綴
const shortVendor = n => (n || '')
  .replace(/股份有限公司|有限公司|股份公司/g, '')
  .replace(/^財團法人/, '')
  .trim() || (n || '');

let flowData = null;

function flow(d) {
  const f = d.flow;
  const sec = $('#flow');
  if (!sec) return;
  if (!f || !f.groups?.length || !f.vendors?.length || !f.links?.length) {
    clear($('#flow-chart')).append(el('p', { class: 'empty', text: '沒有可畫的流向資料。' }));
    return;
  }

  const gi = new Map(f.groups.map((g, i) => [g.name, i]));
  flowData = {
    groups: f.groups.map((g, i) => ({ ...g, c: i % 6 + 1 })),
    vendors: f.vendors.map(v => ({ ...v, label: shortVendor(v.name) })),
    links: f.links.map(l => ({ ...l, c: (gi.get(l.group) ?? 5) % 6 + 1 })),
  };

  drawFlow();
  flowList();

  let t = 0;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(drawFlow, 160);
  });
}

function drawFlow() {
  const wrap = $('#flow');
  const host = clear($('#flow-chart'));
  if (!flowData || !wrap) return;

  const { groups, vendors: vs, links } = flowData;
  // 外層一定看得到，內層在窄螢幕被 CSS 收起來，量它會是 0
  const W = Math.max(360, Math.round(wrap.clientWidth || 960));
  const LW = W < 820 ? 120 : 150;
  const RW = W < 820 ? 200 : 248;
  const NW = 9;
  const x0 = LW, x1 = W - RW - NW;

  const total = Math.max(1, sum(groups, g => g.amount));
  const GAP = 11;
  const H = 470;
  const scale = (H - Math.max(groups.length - 1, vs.length - 1) * GAP) / total;

  const place = (list) => {
    const h = sum(list, r => r.amount) * scale + (list.length - 1) * GAP;
    let y = (H - h) / 2;
    return list.map(r => {
      const box = { ...r, y, h: Math.max(1.5, r.amount * scale) };
      y += box.h + GAP;
      return box;
    });
  };

  const L = place(groups);
  const R = place(vs);
  const byName = m => new Map(m.map(r => [r.name, r]));
  const lAt = byName(L), rAt = byName(R);

  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  g.setAttribute('aria-label',
    `機關群組到廠商的金額流向圖。${L.map(r => `${r.name} ${fmtAmount(r.amount)}`).join('、')}；`
    + `收錢的是 ${R.map(r => `${r.label} ${fmtAmount(r.amount)}`).join('、')}。`);

  // 帶狀：左邊依右欄順序疊、右邊依左欄順序疊，線才不會打結
  const lCur = new Map(L.map(r => [r.name, r.y]));
  const rCur = new Map(R.map(r => [r.name, r.y]));
  const order = [];
  for (const rr of R) for (const ll of L) {
    const link = links.find(x => x.group === ll.name && x.vendor === rr.name);
    if (link) order.push(link);
  }
  for (const link of order) {
    const a = lAt.get(link.group), b = rAt.get(link.vendor);
    if (!a || !b) continue;
    const th = Math.max(1, link.amount * scale);
    const ya = lCur.get(link.group), yb = rCur.get(link.vendor);
    lCur.set(link.group, ya + th);
    rCur.set(link.vendor, yb + th);
    const xa = x0 + NW, xb = x1, xm = (xa + xb) / 2;
    const p = svg('path', {
      class: `ribbon-f f${link.c}`,
      d: `M${xa} ${ya} C${xm} ${ya} ${xm} ${yb} ${xb} ${yb}`
        + ` L${xb} ${yb + th} C${xm} ${yb + th} ${xm} ${ya + th} ${xa} ${ya + th} Z`,
    });
    p.addEventListener('pointerenter', e => {
      g.classList.add('dim');
      p.classList.add('on');
      showTip(e, `<b>${link.group} → ${shortVendor(link.vendor)}</b><br>`
        + `<span class="m">${fmtAmount(link.amount)} · ${fmtInt(link.count)} 件</span>`);
    });
    p.addEventListener('pointerleave', () => {
      g.classList.remove('dim');
      p.classList.remove('on');
      hideTip();
    });
    g.append(p);
  }

  // 節點與標籤。標籤中心會被推開，避免小節點的字疊在一起
  const labelY = (boxes, minGap) => {
    const ys = boxes.map(b => b.y + b.h / 2);
    for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + minGap);
    const over = ys.length ? ys[ys.length - 1] - (H - 6) : 0;
    if (over > 0) {
      ys[ys.length - 1] -= over;
      for (let i = ys.length - 2; i >= 0; i--) ys[i] = Math.min(ys[i], ys[i + 1] - minGap);
    }
    return ys;
  };

  const lys = labelY(L, 23);
  const rys = labelY(R, 23);

  L.forEach((b, i) => {
    g.append(svg('rect', { x: x0, y: b.y, width: NW, height: b.h, class: `fnode f${b.c}` }));
    const y = lys[i];
    if (Math.abs(y - (b.y + b.h / 2)) > 2.5) {
      g.append(svg('path', {
        class: 'anno-line',
        d: `M${x0 - 4} ${b.y + b.h / 2} L${x0 - 11} ${y - 4} L${x0 - 15} ${y - 4}`,
      }));
    }
    const t = svg('text', { x: x0 - 16, y: y + 5, 'text-anchor': 'end', class: 'fl' });
    const nm = svg('tspan'); nm.textContent = b.name;
    const am = svg('tspan', { class: 'fa' }); am.textContent = `　${fmtAmount(b.amount)}`;
    t.append(nm, am);
    g.append(t);
  });

  R.forEach((b, i) => {
    g.append(svg('rect', { x: x1, y: b.y, width: NW, height: b.h, class: 'fnode fv' }));
    const y = rys[i];
    if (Math.abs(y - (b.y + b.h / 2)) > 2.5) {
      g.append(svg('path', {
        class: 'anno-line',
        d: `M${x1 + NW + 4} ${b.y + b.h / 2} L${x1 + NW + 11} ${y - 4} L${x1 + NW + 15} ${y - 4}`,
      }));
    }
    const t = svg('text', { x: x1 + NW + 16, y: y + 5, class: 'fl' });
    const nm = svg('tspan'); nm.textContent = b.label;
    const am = svg('tspan', { class: 'fa' }); am.textContent = `　${fmtAmount(b.amount)}`;
    t.append(nm, am);
    g.append(t);
  });

  host.append(g);
}

// 手機：桑基圖看不清楚，改成每個群組一段，列出三個最大的廠商
function flowList() {
  const host = clear($('#flow-list'));
  if (!flowData) return;
  for (const gp of flowData.groups) {
    const rows = flowData.links
      .filter(l => l.group === gp.name)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3);
    if (!rows.length) continue;
    const ul = el('ul', { class: 'fg-v' });
    for (const r of rows) {
      ul.append(el('li', null, [
        el('span', { class: 'k', text: shortVendor(r.vendor) }),
        el('span', { class: 'v num', text: fmtAmount(r.amount) }),
        el('span', { class: `t c${gp.c}`, style: `width:${Math.max(1, (r.amount / gp.amount) * 100)}%` }),
      ]));
    }
    host.append(el('div', { class: 'fg' }, [
      el('div', { class: 'fg-h' }, [
        el('span', { class: `sw c${gp.c}` }),
        el('span', { class: 'fg-n', text: gp.name }),
        el('span', { class: 'fg-a num', text: fmtAmount(gp.amount) }),
      ]),
      ul,
    ]));
  }
}

/* ---------- 06 最近 ---------- */

function recent(d) {
  const rows = (d.recent || []).slice(0, 15);
  const host = clear($('#recent-list'));
  if (!rows.length) { host.append(el('li', { class: 'empty', text: '最近 60 天沒有新公告。' })); return; }
  for (const r of rows) {
    host.append(el('li', null, [
      el('span', { class: 'd', text: fmtDate(r.date) }),
      el('span', { class: 't' }, [
        el('a', { href: `tenders?q=${encodeURIComponent(r.title)}`, text: r.title }),
        el('span', { class: 'ag', text: r.agency }),
      ]),
      el('span', { class: 'a' }, [
        document.createTextNode(fmtAmount(r.amount)),
        el('span', { class: 'ty', text: r.type }),
      ]),
    ]));
  }
}

/* ---------- 07 帳外：對美軍購與工程類 ---------- */

function offBook(fms, works) {
  const sec = $('#offbook');
  const host = $('#offbook-list');
  if (!sec || !host) return;
  clear(host);

  const byAmount = (a, b) => (b.award_amount ?? b.amount ?? 0) - (a.award_amount ?? a.amount ?? 0);
  const rows = [
    // 對美軍購本來就沒幾件，全列；工程類只列最大的幾件
    ...itemsOf(fms).sort(byAmount).slice(0, 10).map(r => ({ ...r, kind: '對美軍購' })),
    ...itemsOf(works).sort(byAmount).slice(0, 5).map(r => ({ ...r, kind: '工程類' })),
  ].sort(byAmount);

  if (!rows.length) { sec.hidden = true; return; }
  sec.hidden = false;

  for (const r of rows) {
    host.append(el('li', null, [
      el('span', { class: 'd', text: fmtDate(r.award_date || r.date) }),
      el('span', { class: 't' }, [
        el('a', { href: `tenders?k=${r.kind === '對美軍購' ? 'fms' : 'works'}&q=${encodeURIComponent(r.title || '')}`, text: r.title || '(無標題)' }),
        el('span', { class: 'ag', text: r.agency || '' }),
      ]),
      el('span', { class: 'a' }, [
        document.createTextNode(fmtAmount(r.award_amount ?? r.amount)),
        el('span', { class: 'ty', text: r.kind }),
      ]),
    ]));
  }
}
