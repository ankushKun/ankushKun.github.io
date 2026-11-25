// The chat's GIF search (src/components/chat/gifs.ts): forwards /gif/search and /gif/trending to
// Klipy's v2 API with the key added here, so it never reaches the page. Browsers on other sites
// get a 403. Origin can be forged outside a browser, so this keeps the key off other pages, not
// out of every script.

const SITE = 'https://ankush.one';
const KLIPY = 'https://api.klipy.com/v2';
// Only the copies gifs.ts reads, which keeps each page of results small.
const FORMATS = 'tinygif,nanogif,mediumgif,gif,mp4,loopedmp4';
const ROUTES = { '/gif/search': 'search', '/gif/trending': 'featured' };

const cors = { 'Access-Control-Allow-Origin': SITE, 'Access-Control-Allow-Methods': 'GET', Vary: 'Origin' };

const fromSite = (req) => {
  const origin = req.headers.get('Origin');
  if (origin) return origin === SITE;
  return (req.headers.get('Referer') ?? '').startsWith(`${SITE}/`);
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const route = ROUTES[url.pathname];
    if (!route) return new Response('Not found', { status: 404 });
    if (!fromSite(req)) return new Response('Forbidden', { status: 403 });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Max-Age': '86400' } });
    if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });

    const q = url.searchParams.get('q')?.trim().slice(0, 100) ?? '';
    if (route === 'search' && !q) return new Response('Missing q', { status: 400, headers: cors });
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 30, 1), 50);

    const upstream = new URL(`${KLIPY}/${route}`);
    if (q) upstream.searchParams.set('q', q);
    upstream.searchParams.set('limit', String(limit));
    const pos = url.searchParams.get('pos');
    if (pos) upstream.searchParams.set('pos', pos.slice(0, 100));
    upstream.searchParams.set('media_filter', FORMATS);
    upstream.searchParams.set('contentfilter', 'medium');
    upstream.searchParams.set('key', env.KLIPY_KEY);

    const res = await fetch(upstream, { cf: { cacheTtl: route === 'search' ? 3600 : 600, cacheEverything: true } });
    if (!res.ok) return new Response('GIF search failed', { status: 502, headers: cors });
    return new Response(res.body, {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${route === 'search' ? 3600 : 600}` },
    });
  },
};
