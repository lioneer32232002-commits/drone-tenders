import {
  loadJSON, failInto, initChrome, stampFooter, fmtAmount, amountParts, fmtInt,
  fmtPct, fmtDate, el, $, clear, sum, showTip, hideTip, originOrder,
} from './common.js';

initChrome('index');

const NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, v);
  return n;
}

loadJSON('data/summary.json').then(render).catch(err => failInto($('#lede'), err));

function render(s) {
  stampFooter(s.generated_at);

  const T = s.totals || {};
  const year = T.this_year || T.year || {};
  const all = T.all || T;

  const yearCount = year.awarded_count ?? year.count ?? 0;
  const yearAmount = year.awarded_amount ?? 0;
  const openCount = all.open_count ?? 0;
  const allCount = all.count ?? 0;
  const allAmount = all.awarded_amount ?? 0;

  const money = amountParts(yearAmount) || { value: '0', unit: '' };
  $('#lede').innerHTML =
    `今年到目前為止，台灣政府決標了 <b>${fmtInt(yearCount)}</b> 件無人機採購，` +
    `共 <b>${money.value}${money.unit ? ' ' + money.unit : ''}</b>元。`;

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

  origin(s);
  quarters(s);
  sources(s);
  vendors(s);
  recent(s);
}

function num(node, v, unit) {
  clear(node);
  node.append(v);
  if (unit) node.append(el('span', { class: 'u', text: unit }));
}

/* ---------- 01 哪裡製造 ---------- */

// 每個國別在主條與逐年小圖用同一個顏色
const colorOf = (order, c) => (c === '其他' ? 'c6' : `c${(order.indexOf(c) % 5) + 1}`);

function origin(s) {
  const rows = (s.by_origin || []).filter(r => r.amount > 0);
  const years = (s.by_origin_year || []).map(r => ({
    year: String(r.year ?? r.y),
    map: Array.isArray(r.origins)
      ? new Map(r.origins.map(o => [o.country, o.amount]))
      : new Map(Object.entries(r).filter(([k, v]) => k !== 'y' && k !== 'year' && typeof v === 'number')),
  })).filter(r => sum([...r.map.values()]) > 0);

  const names = [...new Set([...rows.map(r => r.country), ...years.flatMap(r => [...r.map.keys()])])];
  const order = originOrder(names);

  const total = sum(rows, r => r.amount);
  const bar = clear($('#origin-bar'));
  const leg = clear($('#origin-legend'));

  if (!total) {
    bar.remove();
    leg.append(el('li', { class: 'v', text: '目前沒有可歸戶的原產地金額。' }));
  }

  const sorted = order.filter(c => rows.some(r => r.country === c));
  for (const c of sorted) {
    const amount = rows.find(r => r.country === c).amount;
    bar.append(el('span', {
      class: colorOf(order, c),
      style: `width:${(amount / total) * 100}%`,
      title: `${c} ${fmtAmount(amount)}`,
    }));
    leg.append(el('li', null, [
      el('span', { class: `sw ${colorOf(order, c)}` }),
      el('span', { class: 'k', text: c }),
      el('span', { class: 'v', text: `${fmtAmount(amount)}　${fmtPct(amount, total)}` }),
    ]));
  }

  bar.setAttribute('aria-label',
    '原產地金額占比：' + sorted.map(c => `${c} ${fmtPct(rows.find(r => r.country === c).amount, total)}`).join('、'));

  const wrap = clear($('#origin-years'));
  if (years.length < 2) { $('#origin-years-note')?.remove(); wrap.remove(); return; }

  for (const r of years) {
    const t = sum([...r.map.values()]);
    const col = el('span', { class: 'col-bar' });
    for (const c of order) {
      const v = r.map.get(c) || 0;
      if (!v) continue;
      col.append(el('span', {
        class: colorOf(order, c),
        style: `height:${(v / t) * 100}%`,
        title: `${r.year} ${c} ${fmtAmount(v)}`,
      }));
    }
    wrap.append(el('div', {
      class: 'yr',
      role: 'listitem',
      'aria-label': `${r.year} 年，` + order.filter(c => r.map.get(c)).map(c => `${c} ${fmtPct(r.map.get(c), t)}`).join('、'),
    }, [
      col,
      el('span', { class: 'yl', text: r.year }),
      el('span', { class: 'yv', text: fmtAmount(t) }),
    ]));
  }
}

/* ---------- 02 季度 ---------- */

let qRows = null;

function quarters(s) {
  const given = (s.by_quarter || []).map(r => ({
    q: r.q || r.quarter,
    awarded_count: r.awarded_count || 0,
    awarded_amount: r.awarded_amount || 0,
  })).filter(r => r.q).sort((a, b) => (a.q < b.q ? -1 : 1));

  // 補上沒有資料的季，時間軸才是真的等距
  qRows = [];
  if (given.length) {
    const at = new Map(given.map(r => [r.q, r]));
    const [y0, q0] = [+given[0].q.slice(0, 4), +given[0].q.slice(5)];
    const [y1, q1] = [+given.at(-1).q.slice(0, 4), +given.at(-1).q.slice(5)];
    for (let i = y0 * 4 + (q0 - 1); i <= y1 * 4 + (q1 - 1); i++) {
      const key = `${Math.floor(i / 4)}Q${(i % 4) + 1}`;
      qRows.push(at.get(key) || { q: key, awarded_count: 0, awarded_amount: 0 });
    }
    const note = $('#quarter-note');
    if (note) note.textContent = `一根是一季，${y0} 年起。`;
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
  g.setAttribute('aria-label', `每季決標金額長條圖，最高 ${fmtAmount(max)}。`);

  for (const f of [0.5, 1]) {
    const yy = PT + (H - PB - PT) * (1 - f);
    g.append(svg('line', { x1: 0, x2: W, y1: yy, y2: yy, class: 'tickline' }));
    const lab = svg('text', { x: 0, y: yy - 5, class: 'tlabel' });
    lab.textContent = fmtAmount(max * f);
    g.append(lab);
  }
  g.append(svg('line', { x1: 0, x2: W, y1: H - PB, y2: H - PB, class: 'axis' }));

  const manyYears = new Set(rows.map(r => r.q.slice(0, 4))).size > 8;
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
    const tick = rows.length <= 8 || r.q.endsWith('Q1');
    if (tick && (!narrow || !manyYears || yr % 2 === 0)) {
      const t = svg('text', { x: i * step, y: H - 8, class: 'tlabel' });
      t.textContent = narrow && manyYears ? `'${String(yr).slice(2)}` : (rows.length <= 8 ? r.q : String(yr));
      g.append(t);
      g.append(svg('line', { x1: i * step, x2: i * step, y1: H - PB, y2: H - PB + 4, class: 'axis' }));
    }
    const hit = svg('rect', { x: i * step, y: 0, width: step, height: H - PB, class: 'hit' });
    hit.addEventListener('pointerenter', e => {
      host.classList.add('dim');
      bars[i]?.classList.add('on');
      showTip(e, `<b>${r.q}</b> 決標 ${fmtInt(r.awarded_count)} 件<br><span class="m">${fmtAmount(r.awarded_amount)}</span>`);
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

function sources(s) {
  const rows = (s.by_agency_group || [])
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

function vendors(s) {
  const rows = (s.top_vendors || [])
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

function recent(s) {
  const rows = (s.recent || []).slice(0, 15);
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
