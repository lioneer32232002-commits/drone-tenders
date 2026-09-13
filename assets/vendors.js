import {
  loadJSON, failInto, initChrome, stampFooter, fmtAmount, fmtInt, fmtDate, fmtPct,
  el, $, clear, sum, showTip, hideTip, trackOf,
} from './common.js';

initChrome('vendors');

const NS = 'http://www.w3.org/2000/svg';
const svg = (t, a) => {
  const n = document.createElementNS(NS, t);
  for (const [k, v] of Object.entries(a || {})) if (v != null) n.setAttribute(k, v);
  return n;
};

loadJSON('data/tenders.json').then(start).catch(err => failInto($('#rows'), err));

function start(d) {
  stampFooter(d.generated_at);
  // 只算國內標案：對美軍購與工程類的量級不同，混在一起排行沒有意義
  const awarded = (d.tenders || []).filter(t =>
    t.status === 'awarded' && t.winners?.length
    && (t.track || trackOf(t)) === 'domestic'
    && t.drone_in_title !== false);

  const map = new Map();
  for (const t of awarded) {
    for (const w of t.winners) {
      let v = map.get(w.name);
      if (!v) map.set(w.name, (v = { name: w.name, id: w.id, sme: w.sme, count: 0, amount: 0, tenders: [], agencies: new Map() }));
      v.count++;
      v.amount += w.amount || 0;
      v.sme = v.sme || w.sme;
      v.tenders.push({ t, amount: w.amount });
      v.agencies.set(t.agency, (v.agencies.get(t.agency) || 0) + (w.amount || 0));
    }
  }

  const vendors = [...map.values()].sort((a, b) => b.amount - a.amount || b.count - a.count);
  $('#result').innerHTML =
    `國內標案<span class="sep"> · </span>` +
    `<span class="n">${fmtInt(vendors.length)}</span> 家廠商曾得標` +
    `<span class="sep"> · </span>合計 ${fmtAmount(sum(vendors, v => v.amount))}`;

  renderSme(awarded);
  renderRows(vendors);
  renderGraph(vendors);
  let t = 0;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => renderGraph(vendors), 160);
  });
}

/* ---------- 中小企業占比 ---------- */

function renderSme(awarded) {
  const big = $('#sme-big');
  const bar = clear($('#sme-bar'));
  const keys = clear($('#sme-keys'));
  if (!big) return;

  let smeAmt = 0, otherAmt = 0, smeCount = 0, otherCount = 0;
  for (const t of awarded) for (const w of t.winners || []) {
    if (w.sme === true) { smeAmt += w.amount || 0; smeCount++; }
    else if (w.sme === false) { otherAmt += w.amount || 0; otherCount++; }
  }
  const total = smeAmt + otherAmt;
  if (!total) { big.textContent = '沒有可歸戶的中小企業資料。'; return; }

  clear(big);
  big.append(el('span', { text: `中小企業得標 ${fmtPct(smeAmt, total)}` }));
  big.append(el('span', { class: 'amt', text: `${fmtInt(smeCount)} 件 · ${fmtAmount(smeAmt)}` }));

  bar.setAttribute('aria-label', `中小企業 ${fmtPct(smeAmt, total)}，非中小企業 ${fmtPct(otherAmt, total)}`);
  bar.append(el('span', { class: 'c1', style: `width:${Math.max(0.6, (smeAmt / total) * 100)}%` }));
  if (otherAmt) bar.append(el('span', { class: 'c6', style: `width:${Math.max(0.6, (otherAmt / total) * 100)}%` }));

  keys.append(el('li', null, [
    el('span', { class: 'sw c1' }),
    el('span', { class: 'k', text: `中小企業 ${fmtPct(smeAmt, total)}` }),
    el('span', { class: 'v', text: `${fmtInt(smeCount)} 件 · ${fmtAmount(smeAmt)}` }),
  ]));
  keys.append(el('li', null, [
    el('span', { class: 'sw c6' }),
    el('span', { class: 'k', text: `非中小企業 ${fmtPct(otherAmt, total)}` }),
    el('span', { class: 'v', text: `${fmtInt(otherCount)} 件 · ${fmtAmount(otherAmt)}` }),
  ]));
}

/* ---------- 排行 ---------- */

function renderRows(vendors) {
  const host = clear($('#rows'));
  vendors.forEach((v, i) => {
    const btn = el('button', { type: 'button', class: 'row-btn', 'aria-expanded': 'false' }, [
      el('span', { class: 'i', text: String(i + 1).padStart(2, '0') }),
      el('span', { class: 'nm' }, [
        document.createTextNode(v.name),
        v.sme ? el('span', { class: 'tag', text: '中小企業' }) : null,
      ]),
      el('span', { class: 'amt', text: fmtAmount(v.amount) }),
      el('span', { class: 'cnt', text: `${fmtInt(v.count)} 件` }),
    ]);

    const li = el('li', null, [btn]);
    let body = null;
    btn.addEventListener('click', () => {
      if (body) { body.remove(); body = null; btn.setAttribute('aria-expanded', 'false'); return; }
      body = vendorBody(v);
      li.append(body);
      btn.setAttribute('aria-expanded', 'true');
    });
    host.append(li);
  });
}

function vendorBody(v) {
  const clients = [...v.agencies].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const maxAmt = clients.length ? clients[0][1] : 1;

  return el('div', { class: 'row-body' }, [
    clients.length ? el('p', { class: 'sub', text: '主要客戶' }) : el('p', { class: 'sub', text: '主要客戶：—' }),
    clients.length ? el('ul', { class: 'fg-v' }, clients.map(([name, amt], i) => el('li', null, [
      el('span', { class: 'k', text: name }),
      el('span', { class: 'v num', text: fmtAmount(amt) }),
      el('span', { class: `t c${i + 1}`, style: `width:${Math.max(1, (amt / maxAmt) * 100)}%` }),
    ]))) : null,
    el('ul', { class: 'mini-list' }, v.tenders
      .slice()
      .sort((a, b) => (a.t.award_date < b.t.award_date ? 1 : -1))
      .map(({ t, amount }) => el('li', null, [
        el('span', { class: 'd', text: fmtDate(t.award_date) }),
        el('span', { class: 'k' }, [
          el('a', { href: `tenders?q=${encodeURIComponent(t.title)}`, text: t.title }),
          el('span', { class: 'ag', text: ` ${t.agency}` }),
        ]),
        el('span', { class: 'v', text: fmtAmount(amount) }),
      ]))),
  ]);
}

/* ---------- 廠商 × 機關 ---------- */

function renderGraph(vendors) {
  const host = clear($('#graph'));
  const NV = 14, NA = 14;

  const vs = vendors.slice(0, NV);
  const agTotal = new Map();
  for (const v of vs) for (const [a, amt] of v.agencies) agTotal.set(a, (agTotal.get(a) || 0) + amt);
  const as = [...agTotal].sort((x, y) => y[1] - x[1]).slice(0, NA).map(([name]) => name);
  const asSet = new Set(as);

  const edges = [];
  for (const v of vs) for (const [a, amt] of v.agencies) if (asSet.has(a) && amt > 0) edges.push({ v: v.name, a, amt });
  if (!edges.length) { host.append(el('p', { class: 'empty', text: '沒有足夠的關係資料。' })); return; }

  const vTot = new Map(), aTot = new Map();
  for (const e of edges) {
    vTot.set(e.v, (vTot.get(e.v) || 0) + e.amt);
    aTot.set(e.a, (aTot.get(e.a) || 0) + e.amt);
  }
  const L = [...vTot].sort((x, y) => y[1] - x[1]);
  const R = [...aTot].sort((x, y) => y[1] - x[1]);

  // 窄螢幕改用清單
  if (!window.matchMedia('(min-width: 760px)').matches) {
    host.append(el('ul', { class: 'mini-list two' }, edges
      .sort((x, y) => y.amt - x.amt).slice(0, 20)
      .map(e => el('li', null, [
        el('span', { class: 'k', text: `${e.v} → ${e.a}` }),
        el('span', { class: 'v', text: fmtAmount(e.amt) }),
      ]))));
    return;
  }

  // viewBox 對齊實際像素寬，字級才不會被縮掉
  const W = Math.max(600, Math.round(host.clientWidth || 1000));
  const rows = Math.max(L.length, R.length);
  const H = Math.max(400, rows * 36);
  const GAP = 10;
  const NW = 7;
  const X1 = Math.round(W * 0.30), X2 = Math.round(W * 0.70);

  // 金額分布極端時（單一大案就吃掉九成），小節點要有最小高度才看得見；
  // 畫布跟著長高，比例仍然是照金額。
  const MIN = 4;
  const CAP = H;                     // 比例照金額，不為了好看把圖拉長
  const heights = (list) => {
    const total = sum(list, x => x[1]) || 1;
    const gaps = (list.length - 1) * GAP;
    let base = H - gaps;
    for (let i = 0; i < 4; i++) {
      const extra = list.reduce((a, [, amt]) => a + Math.max(0, MIN - (amt / total) * base), 0);
      if (extra < 0.5 || base + gaps >= CAP) break;
      base = Math.min(base + extra, CAP - gaps);
    }
    let hs = list.map(([, amt]) => Math.max(MIN, (amt / total) * base));
    const span = hs.reduce((a, b) => a + b, 0) + gaps;
    if (span > CAP) {
      const k = (CAP - gaps) / (span - gaps);
      hs = hs.map(h => h * k);
    }
    return hs;
  };

  const hl = heights(L), hr = heights(R);
  const span = hs => hs.reduce((a, b) => a + b, 0);
  const H2 = Math.min(CAP, Math.max(H, span(hl) + (L.length - 1) * GAP, span(hr) + (R.length - 1) * GAP));

  const place = (list, hs) => {
    const span = hs.reduce((a, b) => a + b, 0) + (list.length - 1) * GAP;
    let y = (H2 - span) / 2;
    const m = new Map();
    list.forEach(([name, amt], i) => {
      m.set(name, { y0: y, y1: y + hs[i], amt });
      y += hs[i] + GAP;
    });
    return m;
  };

  const lp = place(L, hl), rp = place(R, hr);
  const g = svg('svg', {
    viewBox: `0 0 ${W} ${H2}`, role: 'img',
    'aria-label': `前 ${L.length} 家廠商與前 ${R.length} 個機關的得標金額關係圖。`,
  });

  const ribbons = svg('g', { class: 'ribbons' });
  g.append(ribbons);

  const off = new Map();
  const cur = (m, k, side) => {
    const key = side + k;
    const p = m.get(k);
    const o = off.get(key) ?? p.y0;
    return { p, o };
  };

  edges.sort((x, y) => (lp.get(x.v).y0 - lp.get(y.v).y0) || (rp.get(x.a).y0 - rp.get(y.a).y0));

  for (const e of edges) {
    const l = lp.get(e.v), r = rp.get(e.a);
    const lh = ((e.amt / vTot.get(e.v)) * (l.y1 - l.y0));
    const rh = ((e.amt / aTot.get(e.a)) * (r.y1 - r.y0));
    const ly = cur(lp, e.v, 'L').o, ry = cur(rp, e.a, 'R').o;
    off.set('L' + e.v, ly + lh);
    off.set('R' + e.a, ry + rh);

    const mx = (X1 + NW + X2) / 2;
    const d = `M${X1 + NW},${ly} C${mx},${ly} ${mx},${ry} ${X2},${ry}` +
      ` L${X2},${ry + rh} C${mx},${ry + rh} ${mx},${ly + lh} ${X1 + NW},${ly + lh} Z`;
    const path = svg('path', { d, class: 'ribbon', 'data-v': e.v, 'data-a': e.a });
    path.addEventListener('pointerenter', ev => {
      g.classList.add('dim');
      path.classList.add('on');
      showTip(ev, `<b>${e.v}</b><br><span class="m">${e.a} · ${fmtAmount(e.amt)}</span>`);
    });
    path.addEventListener('pointerleave', () => {
      g.classList.remove('dim');
      path.classList.remove('on');
      hideTip();
    });
    ribbons.append(path);
  }

  for (const [name, p] of lp) {
    g.append(svg('rect', { x: X1, y: p.y0, width: NW, height: p.y1 - p.y0, class: 'node-v' }));
    const t = svg('text', { x: X1 - 10, y: (p.y0 + p.y1) / 2 + 4, class: 'node-label', 'text-anchor': 'end' });
    t.textContent = name;
    g.append(t);
  }
  for (const [name, p] of rp) {
    g.append(svg('rect', { x: X2 - NW, y: p.y0, width: NW, height: p.y1 - p.y0, class: 'node-a' }));
    const t = svg('text', { x: X2 + 10, y: (p.y0 + p.y1) / 2 + 4, class: 'node-label' });
    t.textContent = name;
    g.append(t);
  }

  host.append(g);
}
