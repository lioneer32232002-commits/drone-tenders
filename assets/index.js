import {
  loadJSON, failInto, initChrome, stampFooter, fmtAmount, amountParts, fmtInt,
  fmtPct, fmtDate, el, $, clear, sum, showTip, hideTip, ORIGIN_ORDER,
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

  const y = s.totals?.year || { count: 0, awarded_amount: 0, open_count: 0 };
  const all = s.totals?.all || { count: 0, awarded_amount: 0, open_count: 0 };
  const awardedThisYear = s.by_year?.find(r => r.y === String(new Date().getFullYear()))?.awarded_count;

  // ---- 開場一句 ----
  const n = awardedThisYear ?? y.count;
  const money = amountParts(y.awarded_amount) || { value: '0', unit: '' };
  $('#lede').innerHTML =
    `今年到目前為止，台灣政府決標了 <b>${fmtInt(n)}</b> 件無人機採購，` +
    `共 <b>${money.value}${money.unit ? ' ' + money.unit : ''}</b>元。`;

  $('#hero-meta').innerHTML =
    `資料更新 <time data-updated>—</time><span class="sep">·</span>` +
    `招標中 ${fmtInt(all.open_count)} 件<span class="sep">·</span>` +
    `收錄 ${fmtInt(all.count)} 件`;
  stampFooter(s.generated_at);

  fillTotals(s, y, all, n);
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

function fillTotals(s, y, all, n) {
  const ya = amountParts(y.awarded_amount) || { value: '0', unit: '' };
  const aa = amountParts(all.awarded_amount) || { value: '0', unit: '' };
  num($('#t-year-count'), fmtInt(n), '件');
  num($('#t-year-amount'), ya.value, ya.unit);
  num($('#t-open'), fmtInt(all.open_count), '件');
  num($('#t-all-amount'), aa.value, aa.unit);
}

/* ---------- 01 哪裡製造 ---------- */

function origin(s) {
  const rows = (s.by_origin || []).slice().sort(
    (a, b) => ORIGIN_ORDER.indexOf(a.country) - ORIGIN_ORDER.indexOf(b.country)
  );
  const total = sum(rows, r => r.amount);
  const bar = clear($('#origin-bar'));
  const leg = clear($('#origin-legend'));

  if (!total) {
    bar.remove();
    leg.append(el('li', { class: 'v', text: '目前沒有可歸戶的原產地金額。' }));
  }

  rows.forEach((r, i) => {
    if (r.amount > 0) {
      bar.append(el('span', {
        class: `c${i + 1}`,
        style: `width:${(r.amount / total) * 100}%`,
        title: `${r.country} ${fmtAmount(r.amount)}`,
      }));
    }
    leg.append(el('li', null, [
      el('span', { class: `sw c${i + 1}` }),
      el('span', { class: 'k', text: r.country }),
      el('span', { class: 'v', text: `${fmtAmount(r.amount)}　${fmtPct(r.amount, total)}` }),
    ]));
  });

  bar.setAttribute('aria-label',
    '原產地金額占比：' + rows.map(r => `${r.country} ${fmtPct(r.amount, total)}`).join('、'));

  // 逐年變化
  const years = (s.by_origin_year || []).filter(r => ORIGIN_ORDER.some(c => r[c] > 0));
  const wrap = clear($('#origin-years'));
  if (!years.length) { $('#origin-years-note')?.remove(); wrap.remove(); return; }

  for (const r of years) {
    const t = sum(ORIGIN_ORDER, c => r[c]);
    const col = el('span', { class: 'col-bar' });
    ORIGIN_ORDER.forEach((c, i) => {
      if (!r[c]) return;
      col.append(el('span', {
        class: `c${i + 1}`,
        style: `height:${(r[c] / t) * 100}%`,
        title: `${r.y} ${c} ${fmtAmount(r[c])}`,
      }));
    });
    wrap.append(el('div', {
      class: 'yr',
      role: 'listitem',
      'aria-label': `${r.y} 年，` + ORIGIN_ORDER.filter(c => r[c]).map(c => `${c} ${fmtPct(r[c], t)}`).join('、'),
    }, [
      col,
      el('span', { class: 'yl', text: r.y }),
      el('span', { class: 'yv', text: fmtAmount(t) }),
    ]));
  }
}

/* ---------- 02 季度 ---------- */

function quarters(s) {
  const rows = (s.by_quarter || []).filter(r => r.q >= '2016Q1');
  const host = clear($('#quarter-chart'));
  if (!rows.length) { host.append(el('p', { class: 'empty', text: '沒有季度資料。' })); return; }

  const W = 1000, H = 230, PB = 26, PT = 10;
  const max = Math.max(...rows.map(r => r.awarded_amount), 1);
  const step = W / rows.length;
  const bw = Math.max(2, step * 0.66);
  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  g.setAttribute('aria-label',
    `2016 年起每季決標金額長條圖，最高 ${fmtAmount(max)}。`);

  // 基線與刻度
  const gridY = [0.5, 1];
  for (const f of gridY) {
    const yy = PT + (H - PB - PT) * (1 - f);
    g.append(svg('line', { x1: 0, x2: W, y1: yy, y2: yy, class: f === 1 ? 'tickline' : 'tickline' }));
    const lab = svg('text', { x: 2, y: yy - 5, class: 'tlabel' });
    lab.textContent = fmtAmount(max * f);
    g.append(lab);
  }
  g.append(svg('line', { x1: 0, x2: W, y1: H - PB, y2: H - PB, class: 'axis' }));

  const bars = [];
  rows.forEach((r, i) => {
    const h = (r.awarded_amount / max) * (H - PB - PT);
    const x = i * step + (step - bw) / 2;
    if (h > 0) {
      const b = svg('rect', { x, y: H - PB - h, width: bw, height: h, class: 'bar' });
      bars[i] = b;
      g.append(b);
    }
    if (r.q.endsWith('Q1')) {
      const t = svg('text', { x: i * step, y: H - 9, class: 'tlabel' });
      t.textContent = r.q.slice(0, 4);
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
      g.querySelectorAll('.bar.on').forEach(b => b.classList.remove('on'));
      hideTip();
    });
    g.append(hit);
  });

  host.append(g);
}

/* ---------- 03 錢從哪裡來 ---------- */

function sources(s) {
  const rows = (s.by_agency_group || []).filter(r => r.amount > 0).sort((a, b) => b.amount - a.amount);
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
  const rows = (s.top_vendors || []).slice(0, 10);
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
