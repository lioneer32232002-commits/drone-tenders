import {
  loadJSON, failInto, initChrome, stampFooter, fmtAmount, fmtInt, fmtDate, fmtPct,
  el, $, clear, sum, STATUS, trackOf,
} from './common.js';

initChrome('agencies');

const GROUP_ORDER = ['國防', '中央部會', '地方政府', '國營事業', '學校', '其他'];

loadJSON('data/tenders.json').then(start).catch(err => failInto($('#groups'), err));

function start(d) {
  stampFooter(d.generated_at);
  // 與廠商頁一致，只算國內標案
  const tenders = (d.tenders || []).filter(t =>
    (t.track || trackOf(t)) === 'domestic' && t.drone_in_title !== false);

  const byAgency = new Map();
  for (const t of tenders) {
    let a = byAgency.get(t.agency);
    if (!a) byAgency.set(t.agency, (a = {
      name: t.agency, id: t.agency_id, group: t.agency_group || '其他',
      count: 0, awarded: 0, amount: 0, tenders: [],
    }));
    a.count++;
    if (t.status === 'awarded') { a.awarded++; a.amount += t.award_amount || 0; }
    a.tenders.push(t);
  }

  const agencies = [...byAgency.values()];
  $('#result').innerHTML =
    `國內標案<span class="sep"> · </span>` +
    `<span class="n">${fmtInt(agencies.length)}</span> 個機關買過無人機` +
    `<span class="sep"> · </span>決標合計 ${fmtAmount(sum(agencies, a => a.amount))}`;

  const host = clear($('#groups'));
  const groups = [...new Set(agencies.map(a => a.group))]
    .sort((x, y) => {
      const i = GROUP_ORDER.indexOf(x), j = GROUP_ORDER.indexOf(y);
      return (i < 0 ? 99 : i) - (j < 0 ? 99 : j);
    });

  for (const g of groups) {
    const list = agencies.filter(a => a.group === g).sort((a, b) => b.amount - a.amount || b.count - a.count);
    const total = sum(list, a => a.amount);

    const rows = el('ul', { class: 'rows' });
    const btnByName = new Map();
    list.forEach((a, i) => {
      const row = agencyRow(a, i);
      btnByName.set(a.name, row.querySelector('.row-btn'));
      rows.append(row);
    });

    const goTo = (name) => {
      const btn = btnByName.get(name);
      if (!btn) return;
      if (btn.getAttribute('aria-expanded') !== 'true') btn.click();
      btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    host.append(el('section', { class: 'rank-group' }, [
      el('div', { class: 'rank-head' }, [
        el('h3', { text: g }),
        el('span', { class: 's', text: `${fmtInt(list.length)} 個機關　${fmtAmount(total)}` }),
      ]),
      total ? groupBar(list, total, goTo) : null,
      rows,
    ]));
  }
}

// 前 5 機關分段＋其他，一條堆疊橫條；點色塊或圖例可跳到下面該機關展開
function groupBar(list, total, goTo) {
  const top = list.slice(0, 5).filter(a => a.amount > 0);
  const otherAmt = total - sum(top, a => a.amount);
  const segs = top.map((a, i) => ({ name: a.name, amount: a.amount, c: `c${i + 1}` }));
  if (otherAmt > 0) segs.push({ name: '其他', amount: otherAmt, c: 'c6' });

  const bar = el('div', {
    class: 'sbar sbar-sm', role: 'img',
    'aria-label': segs.map(s => `${s.name} ${fmtAmount(s.amount)}`).join('，'),
  });
  const keys = el('ul', { class: 'legend legend-click' });

  for (const s of segs) {
    const seg = el('span', { class: s.c, style: `width:${Math.max(0.6, (s.amount / total) * 100)}%` });
    const li = el('li', null, [
      el('span', { class: `sw ${s.c}` }),
      el('span', { class: 'k', text: s.name }),
      el('span', { class: 'v', text: `${fmtAmount(s.amount)} · ${fmtPct(s.amount, total)}` }),
    ]);
    if (s.name !== '其他') {
      seg.style.cursor = 'pointer';
      li.style.cursor = 'pointer';
      seg.addEventListener('click', () => goTo(s.name));
      li.addEventListener('click', () => goTo(s.name));
    }
    bar.append(seg);
    keys.append(li);
  }

  return el('div', { class: 'group-bar' }, [bar, keys]);
}

function agencyRow(a, i) {
  const btn = el('button', { type: 'button', class: 'row-btn', 'aria-expanded': 'false' }, [
    el('span', { class: 'i', text: String(i + 1).padStart(2, '0') }),
    el('span', { class: 'nm', text: a.name }),
    el('span', { class: 'amt', text: a.awarded ? fmtAmount(a.amount) : '—' }),
    el('span', { class: 'cnt', text: `${fmtInt(a.count)} 件` }),
  ]);

  const li = el('li', null, [btn]);
  let body = null;
  btn.addEventListener('click', () => {
    if (body) { body.remove(); body = null; btn.setAttribute('aria-expanded', 'false'); return; }
    body = agencyBody(a);
    li.append(body);
    btn.setAttribute('aria-expanded', 'true');
  });
  return li;
}

function agencyBody(a) {
  const winners = new Map();
  for (const t of a.tenders) for (const w of t.winners || []) {
    winners.set(w.name, (winners.get(w.name) || 0) + (w.amount || 0));
  }
  const top = [...winners].sort((x, y) => y[1] - x[1]).slice(0, 3)
    .map(([n, amt]) => `${n}（${fmtAmount(amt)}）`).join('、');

  return el('div', { class: 'row-body' }, [
    el('p', { class: 'sub', text: `決標 ${fmtInt(a.awarded)} 件。主要供應商：${top || '—'}` }),
    el('ul', { class: 'mini-list' }, a.tenders
      .slice()
      .sort((x, y) => ((x.award_date || x.first_notice_date) < (y.award_date || y.first_notice_date) ? 1 : -1))
      .map(t => el('li', null, [
        el('span', { class: 'd', text: fmtDate(t.award_date || t.first_notice_date) }),
        el('span', { class: 'k' }, [
          el('a', { href: `tenders?q=${encodeURIComponent(t.title)}`, text: t.title }),
          el('span', { class: 'ag', text: ` ${STATUS[t.status] || t.status}` }),
        ]),
        el('span', { class: 'v', text: fmtAmount(t.award_amount ?? t.budget) }),
      ]))),
  ]);
}
