import {
  loadJSON, failInto, initChrome, stampFooter, fmtAmount, fmtInt, fmtDate,
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
    list.forEach((a, i) => rows.append(agencyRow(a, i)));

    host.append(el('section', { class: 'rank-group' }, [
      el('div', { class: 'rank-head' }, [
        el('h3', { text: g }),
        el('span', { class: 's', text: `${fmtInt(list.length)} 個機關　${fmtAmount(total)}` }),
      ]),
      rows,
    ]));
  }
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
