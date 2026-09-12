// 代理 g0v 標案 API。GitHub Actions 的機房 IP 會被上游擋（403），
// 所以每週更新改由 CI 打 /pcc-proxy/api/<endpoint>，讓 Cloudflare 的網路去拿資料。
// 只放行三個唯讀端點，避免變成開放代理。
const UPSTREAM = 'https://pcc-api.openfun.app/api/';
const ALLOWED = new Set(['searchbytitle', 'tender', 'listbyunit']);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 skyfaring-drone-tenders/1.0 (+https://tenders.skyfaring.net)';

export async function onRequestGet({ request, params }) {
  const parts = params.path || [];
  if (parts.length !== 1 || !ALLOWED.has(parts[0])) {
    return new Response('not found', { status: 404 });
  }
  const url = new URL(request.url);
  const target = UPSTREAM + parts[0] + url.search;
  const r = await fetch(target, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  const headers = new Headers({
    'content-type': r.headers.get('content-type') || 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'x-upstream-status': String(r.status),
  });
  return new Response(r.body, { status: r.status, headers });
}
