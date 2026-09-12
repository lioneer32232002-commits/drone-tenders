import { loadJSON, initChrome, stampFooter, fmtInt, $ } from './common.js';

initChrome('about');

loadJSON('data/summary.json').then(s => {
  stampFooter(s.generated_at);

  const n = s.data_notes || {};
  const bits = [];
  if (n.awarded_total) {
    bits.push(`目前 ${fmtInt(n.awarded_total)} 筆決標裡，有 ${fmtInt(n.awarded_without_origin || 0)} 筆機關沒填原產地。`);
  }
  if (n.framework_without_amount) {
    bits.push(`另有 ${fmtInt(n.framework_without_amount)} 件共同供應契約沒有總額，金額一律留空。`);
  }
  const node = $('#data-notes');
  if (node) node.textContent = bits.join('');
}).catch(err => console.error(err));
