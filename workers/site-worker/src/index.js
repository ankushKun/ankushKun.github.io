/**
 * ankush-site-worker
 *
 * Lets the ankush.one desktop open external links inside its embedded windows,
 * and keeps the Klipy GIF key off the client.
 *
 *   GET /?url=<absolute http(s) url>   link proxy (documents only)
 *   GET /check?url=<url>               JSON status of a target
 *   GET /gif/search?q=&limit=          Klipy passthrough
 *   GET /gif/trending?limit=           Klipy passthrough
 *   GET /health                        "ok"
 *   POST /mcp                          read-only MCP server (src/mcp.js)
 *   GET /.well-known/mcp.json          MCP server card
 *   GET /search?q=                     the MCP search as markdown/JSON (src/mcp.js)
 *
 * No dependencies. See README.md for the abuse protections.
 */

import { handleMcp, handleSearch, handleServerCard, overLimit } from './mcp.js';

const WAYBACK_HOST = 'web.archive.org';
const WAYBACK_API = 'https://archive.org/wayback/available?url=';
const UPSTREAM_TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 8;
const WAYBACK_TIMEOUT_MS = 4000;
const ALLOWLIST_TIMEOUT_MS = 5000;
const ALLOWLIST_TTL_S = 3600;
const ALLOWLIST_RETRY_S = 60;
const MAX_URL_LENGTH = 2048;
const FORM_PARAM = '__pf';
const DEFAULT_UA = 'Mozilla/5.0 (compatible; ankush-site-worker; +https://ankush.one)';

const KLIPY_API_BASE = 'https://api.klipy.com/v2';
const KLIPY_CLIENT_KEY = 'irc-chat';
const KLIPY_TIMEOUT_MS = 8000;
const GIF_DEFAULT_LIMIT = 20;
const GIF_MAX_LIMIT = 50;

// Response headers that must never reach the visitor from a proxied document.
const STRIP_HEADERS = [
    'x-frame-options',
    'content-security-policy',
    'content-security-policy-report-only',
    'cross-origin-opener-policy',
    'cross-origin-opener-policy-report-only',
    'cross-origin-embedder-policy',
    'cross-origin-embedder-policy-report-only',
    'cross-origin-resource-policy',
    'set-cookie',
    'set-cookie2',
    'report-to',
    'reporting-endpoints',
    'nel',
    'clear-site-data',
    'service-worker-allowed',
    'strict-transport-security',
    'alt-svc',
    'refresh',
    'content-length',
    'access-control-allow-origin',
    'access-control-allow-credentials',
    'access-control-allow-methods',
    'access-control-allow-headers',
    'access-control-expose-headers',
];

export default {
    async fetch(request, env, ctx) {
        try {
            const response = await route(request, env, ctx);
            if (request.method === 'HEAD') {
                return new Response(null, { status: response.status, headers: response.headers });
            }
            return response;
        } catch (err) {
            console.error('unhandled', err && err.stack || err);
            return text('Internal error', 500);
        }
    },
};

async function route(request, env, ctx) {
    const url = new URL(request.url);
    const cfg = {
        self: url.origin,
        selfHost: url.hostname,
        siteOrigins: splitList(env.SITE_ORIGINS).map(toOrigin).filter(Boolean),
    };
    const path = url.pathname;
    // Public and read-only: no site-origin gate, its own CORS and limits.
    if (path === '/mcp') return handleMcp(request, env, ctx, cfg);
    if (path === '/search') return handleSearch(request, env, ctx, cfg);
    if ((path === '/.well-known/mcp.json' || path === '/.well-known/mcp/server-card.json') &&
        (request.method === 'GET' || request.method === 'HEAD')) {
        return handleServerCard(request, env, cfg);
    }
    const isApi = path === '/check' || path.startsWith('/gif/');

    if (request.method === 'OPTIONS' && isApi) {
        return new Response(null, {
            status: 204,
            headers: {
                ...corsHeaders(request, cfg),
                'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                'Access-Control-Max-Age': '86400',
            },
        });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return text('Method not allowed', 405, { Allow: 'GET, HEAD' });
    }

    if (path === '/health') return text('ok', 200);
    if (path === '/check') return handleCheck(request, url, env, ctx, cfg);
    if (path === '/gif/search') return handleGif(request, url, env, cfg, 'search');
    if (path === '/gif/trending' || path === '/gif/featured') return handleGif(request, url, env, cfg, 'featured');
    if (path === '/' && (url.searchParams.has('url') || url.searchParams.has(FORM_PARAM))) {
        return handleProxy(request, url, env, ctx, cfg);
    }
    return text('Not found', 404);
}

/* ------------------------------------------------------------------ */
/* Link proxy                                                          */
/* ------------------------------------------------------------------ */

async function handleProxy(request, url, env, ctx, cfg) {
    const target = parseTarget(targetFromQuery(url), cfg.selfHost);
    if (!target) {
        return page(400, 'refused', {
            title: 'Cannot open this link',
            heading: 'This link cannot be opened here',
            body: '<p>The address is missing or is not a public http(s) web address.</p>',
        });
    }

    // Gate 1: only frame navigations. A top-level visit gets a pointer to the
    // real page instead of proxied content.
    const dest = request.headers.get('Sec-Fetch-Dest');
    if (dest === 'document') {
        const allowed = isAllowed(target.hostname, await loadAllowlist(env, ctx));
        return page(403, 'refused', {
            title: 'Link viewer',
            heading: 'This address only works inside ankush.one',
            body: '<p>It is part of the link viewer on <a href="' + esc(cfg.siteOrigins[0] || 'https://ankush.one') +
                '" rel="noopener">' + esc(hostLabel(cfg.siteOrigins[0] || 'https://ankush.one')) + '</a>. The page you are looking for is:</p>' +
                '<p class="url">' + esc(target.href) + '</p>',
            actions: allowed ? [{ label: 'Go to ' + hostOf(target.hostname), href: target.href, primary: true, sameTab: true }] : [],
        });
    }
    if (dest && dest !== 'iframe' && dest !== 'frame') {
        return text('Forbidden', 403, { 'X-Link-Proxy': 'refused' });
    }

    // Gate 2: the frame must live on the site, or be an in-frame navigation
    // from a page this worker served.
    const from = toOrigin(request.headers.get('Referer'));
    if (!from || (from !== cfg.self && !cfg.siteOrigins.includes(from))) {
        // A real visitor lands here when a page suppresses the Referer of a
        // navigation, so leave them a way out. Nothing is fetched.
        return page(403, 'refused', {
            title: hostOf(target.hostname),
            heading: 'This link cannot be opened here',
            body: '<p>The page it came from did not say where the request was coming from, so it cannot be shown inside a window.</p>' +
                '<p class="url">' + esc(target.href) + '</p>',
            actions: [{ label: 'Open in new tab', href: target.href, primary: true }],
            back: true,
        });
    }

    // Gate 3: host allowlist. Not allowed is not an error for the visitor:
    // they most likely clicked onward inside a proxied page.
    const allowlist = await loadAllowlist(env, ctx);
    if (!isAllowed(target.hostname, allowlist)) return interstitial(target);

    const result = await fetchTarget(request, target, allowlist, cfg.selfHost);

    // A redirect pointed off the allowlist; that hop was not requested.
    if (result.kind === 'offlist') return interstitial(result.final);
    if (result.kind === 'unverified') {
        // Allowed, but only a browser can tell whether it loads: let it try.
        return new Response(null, {
            status: 302,
            headers: { Location: result.final.href, ...commonHeaders('redirect') },
        });
    }
    if (result.kind === 'dead' || result.kind === 'blocked') {
        discard(result.response);
        return unavailablePage(result, target, cfg);
    }

    const { response, final } = result;
    const embedders = from === cfg.self ? cfg.siteOrigins : [from];

    // Frameable: let it run natively in the frame, with full fidelity.
    if (isFrameable(response.headers, final, embedders)) {
        discard(response);
        return new Response(null, {
            status: 302,
            headers: { Location: final.href, ...commonHeaders('redirect') },
        });
    }

    const type = (response.headers.get('content-type') || '').toLowerCase();
    const isHtml = type.startsWith('text/html');
    if (!isHtml && !/^(application\/pdf|image\/|text\/plain)/.test(type)) {
        // Downloads and other non-documents are not worth proxying; hand the
        // frame the real url (a download starts, anything else just loads).
        discard(response);
        return new Response(null, {
            status: 302,
            headers: { Location: final.href, ...commonHeaders('redirect') },
        });
    }

    const headers = new Headers(response.headers);
    for (const name of STRIP_HEADERS) headers.delete(name);
    for (const [name, value] of Object.entries(commonHeaders('proxied'))) headers.set(name, value);
    headers.set('X-Content-Type-Options', 'nosniff');

    if (isHtml && url.protocol === 'https:' && final.protocol !== 'https:') {
        // Served from this https origin with an http <base>, every stylesheet,
        // script and image of the page would be blocked as mixed content.
        discard(response);
        return interstitial(final, 'is only available over an insecure (http) connection, so it cannot be shown inside a window here.');
    }

    const proxied = new Response(response.body, { status: response.status, headers });
    if (!isHtml) return proxied;

    return rewriteHtml(proxied, final, cfg.self);
}

/** `?url=` or, for a rewritten GET form, `?__pf=<action>&<fields...>`. */
function targetFromQuery(url) {
    const action = url.searchParams.get(FORM_PARAM);
    if (action === null) return url.searchParams.get('url');
    let target;
    try {
        target = new URL(action);
    } catch {
        return null;
    }
    const fields = new URLSearchParams();
    for (const [key, value] of url.searchParams) {
        if (key !== FORM_PARAM) fields.append(key, value);
    }
    target.search = fields.toString();
    target.hash = '';
    return target.href;
}

/** Parse and vet a target. Returns a URL, or null when it must be refused. */
function parseTarget(raw, selfHost) {
    if (!raw || raw.length > MAX_URL_LENGTH) return null;
    let target;
    try {
        target = new URL(raw);
    } catch {
        return null;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
    if (target.username || target.password || target.port) return null;

    const host = target.hostname.toLowerCase().replace(/\.$/, '');
    // IP literals (the URL parser has already normalised hex/decimal forms),
    // bare names and private/special suffixes.
    if (!host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host)) return null;
    if (/(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|home\.arpa|test|invalid|onion)$/.test(host)) return null;
    if (host === selfHost) return null;
    return target;
}

/**
 * Fetch the target document, following redirects by hand so that every hop
 * is vetted (parseTarget + allowlist) before it is requested.
 * Returns { kind: 'ok' | 'dead' | 'blocked' | 'offlist' | 'unverified', scope?, status, response?, final? }.
 * 'offlist' means a redirect pointed at `final`, which is not on the
 * allowlist and was not fetched. 'unverified' means `final` is allowed but
 * could not be fetched for a reason that says nothing about the site.
 */
async function fetchTarget(request, target, allowlist, selfHost) {
    const headers = new Headers();
    headers.set('User-Agent', request.headers.get('User-Agent') || DEFAULT_UA);
    headers.set('Accept', request.headers.get('Accept') || 'text/html,application/xhtml+xml,*/*;q=0.8');
    const language = request.headers.get('Accept-Language');
    if (language) headers.set('Accept-Language', language);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let final = target;
    let response;
    // Hosts with an underscore (wauth_subspace.arweave.net): TLS stacks of the
    // OpenSSL family, this runtime's included, do not match such a name against
    // a wildcard certificate, while browsers do. A failed handshake therefore
    // says nothing about the site and is reported as 'unverified'.
    try {
        for (let hops = 0; ; hops++) {
            response = await fetch(final.href, {
                method: 'GET',
                headers,
                redirect: 'manual',
                signal: controller.signal,
            });
            const location = [301, 302, 303, 307, 308].includes(response.status) ? response.headers.get('location') : null;
            if (!location) break;

            discard(response);
            let next = null;
            try {
                next = parseTarget(new URL(location, final.href).href, selfHost);
            } catch {
                // unparseable Location
            }
            // A redirect to somewhere the proxy refuses (IP literal, port,
            // non-http scheme, itself) or a loop: the site is there, but not
            // for us.
            if (!next || hops >= MAX_REDIRECTS) return { kind: 'blocked', status: response.status, final };
            if (!isAllowed(next.hostname, allowlist)) return { kind: 'offlist', status: 0, final: next };
            if (!next.hash) next.hash = final.hash;
            final = next;
        }
    } catch {
        if (final.hostname.includes('_')) return { kind: 'unverified', status: 0, final };
        return { kind: 'dead', scope: 'site', status: 0 };
    } finally {
        clearTimeout(timer);
    }

    const status = response.status;
    if ((status === 525 || status === 526) && final.hostname.includes('_')) {
        discard(response);
        return { kind: 'unverified', status, final };
    }
    if (status >= 400) {
        // 404/410 on a host that answers: the page is gone. 5xx (including
        // Cloudflare 52x/530 origin and DNS errors): the site is.
        if (status === 404 || status === 410) return { kind: 'dead', scope: 'page', status, response, final };
        if (status >= 500 && status <= 599 && !response.headers.has('cf-mitigated')) {
            return { kind: 'dead', scope: 'site', status, response, final };
        }
        // Everything else (401/403/429 bot walls and auth, challenges,
        // non-standard codes such as LinkedIn's 999) means the server is there
        // but will not talk to a proxy.
        return { kind: 'blocked', status, response, final };
    }
    return { kind: 'ok', status, response, final };
}

function discard(response) {
    if (response && response.body) response.body.cancel().catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Frameability                                                        */
/* ------------------------------------------------------------------ */

/**
 * True when every origin in `embedders` may frame a response with these
 * headers. Conservative: anything not understood counts as blocking.
 */
function isFrameable(headers, final, embedders) {
    if (headers.has('x-frame-options')) return false;
    if (!embedders.length) return false;
    // An http page inside an https site is blocked as mixed content.
    if (final.protocol !== 'https:' && embedders.some((origin) => origin.startsWith('https:'))) return false;

    const csp = headers.get('content-security-policy');
    if (!csp) return true;
    // Several policies may be comma-joined; every one of them must allow.
    for (const policy of csp.split(',')) {
        for (const directive of policy.split(';')) {
            const parts = directive.trim().split(/\s+/);
            if (parts[0].toLowerCase() !== 'frame-ancestors') continue;
            const sources = parts.slice(1);
            const ok = embedders.every((origin) => sources.some((source) => sourceMatches(source, origin)));
            if (!ok) return false;
            break; // only the first frame-ancestors of a policy counts
        }
    }
    return true;
}

/** Does one CSP source expression match an embedding origin? */
function sourceMatches(source, origin) {
    const o = new URL(origin);
    const s = source.toLowerCase();
    if (s === '*') return true;
    if (s.startsWith("'")) return false; // 'none', 'self' (self is the target, not us)
    if (/^[a-z][a-z0-9+.-]*:$/.test(s)) return s === o.protocol;

    const m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([a-z0-9.-]+)(?::(\d+|\*))?(?:\/.*)?$/.exec(s);
    if (!m) return false;
    const [, scheme, wildcard, host, port] = m;
    if (scheme ? scheme + ':' !== o.protocol : o.protocol !== 'https:') return false;
    if (wildcard ? !o.hostname.endsWith('.' + host) : o.hostname !== host) return false;
    if (port === '*') return true;
    return (port || '') === o.port;
}

/* ------------------------------------------------------------------ */
/* Host allowlist                                                      */
/* ------------------------------------------------------------------ */

let allowlistMemo = { src: '', hosts: null, expires: 0 };

/** Set of allowed hosts: generated list + EXTRA_HOSTS + the Wayback Machine. */
async function loadAllowlist(env, ctx) {
    const allowed = new Set([WAYBACK_HOST]);
    for (const host of splitList(env.EXTRA_HOSTS)) {
        const clean = cleanHost(host);
        if (clean) allowed.add(clean);
    }

    const src = (env.ALLOWLIST_URL || '').trim();
    if (!src) return allowed;

    const now = Date.now();
    if (allowlistMemo.src !== src) allowlistMemo = { src, hosts: null, expires: 0 };
    if (now >= allowlistMemo.expires) {
        const hosts = await fetchAllowlist(src, ctx);
        if (hosts) {
            allowlistMemo = { src, hosts, expires: now + ALLOWLIST_TTL_S * 1000 };
        } else {
            // Fail closed: keep the last list this isolate verified (if any),
            // otherwise nothing from the generated list is allowed. Retry soon.
            allowlistMemo.expires = now + ALLOWLIST_RETRY_S * 1000;
        }
    }
    for (const host of allowlistMemo.hosts || []) allowed.add(host);
    return allowed;
}

async function fetchAllowlist(src, ctx) {
    const cache = caches.default;
    const cacheKey = new Request(src, { method: 'GET' });
    try {
        const hit = await cache.match(cacheKey);
        if (hit) {
            const hosts = parseAllowlist(await hit.json());
            if (hosts) return hosts;
        }
    } catch {
        // fall through to the network
    }

    try {
        const response = await fetch(src, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(ALLOWLIST_TIMEOUT_MS),
        });
        if (!response.ok) {
            discard(response);
            return null;
        }
        const hosts = parseAllowlist(await response.json());
        if (!hosts) return null;
        const stored = new Response(JSON.stringify({ hosts }), {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=' + ALLOWLIST_TTL_S,
            },
        });
        ctx.waitUntil(cache.put(cacheKey, stored).catch(() => {}));
        return hosts;
    } catch {
        return null;
    }
}

function parseAllowlist(json) {
    if (!json || !Array.isArray(json.hosts)) return null;
    const hosts = [];
    for (const entry of json.hosts.slice(0, 5000)) {
        const clean = cleanHost(entry);
        if (clean) hosts.push(clean);
    }
    return hosts;
}

/**
 * Normalise an allowlist entry; '' when it is not a plausible public hostname.
 * Underscores are not valid in hostnames but exist in the wild as DNS labels
 * (wauth_subspace.arweave.net), so they are accepted inside a label.
 */
function cleanHost(value) {
    if (typeof value !== 'string') return '';
    const host = hostOf(value.trim().toLowerCase());
    return /^(?=.{1,253}$)([a-z0-9]([a-z0-9_-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(host) ? host : '';
}

/** A host is allowed when it, or a parent domain of it, is on the list. */
function isAllowed(hostname, allowed) {
    let host = hostOf(hostname.toLowerCase());
    while (host.includes('.')) {
        if (allowed.has(host)) return true;
        host = host.slice(host.indexOf('.') + 1);
    }
    return false;
}

/* ------------------------------------------------------------------ */
/* HTML rewriting                                                      */
/* ------------------------------------------------------------------ */

// Runs inside the proxied page. Sends in-frame link clicks back through the
// proxy (links are left untouched in the markup: rewriting each one costs more
// CPU than a link-heavy page can afford), keeps fragment links on the page now
// that <base> points elsewhere, and keeps history.pushState from throwing now
// that the document url is on another origin. Navigating with location.assign
// also means rel=noreferrer / referrerpolicy on a link cannot strip the
// Referer the proxy gate needs.
function clientScript(finalHref) {
    return '<script>(function(){var O=location.origin+"/",F=' + jsString(finalHref) + ';' +
        // Tell the site window which page this is, so its toolbar can follow.
        'try{parent!==window&&parent.postMessage({source:"link-proxy",url:F},"*")}catch(x){}' +
        // Setting the hash it already has does not scroll, so do that by hand.
        'function G(f){if(location.hash!=f){location.hash=f;return}' +
        'try{var x=document.getElementById(decodeURIComponent(f.slice(1)));x&&x.scrollIntoView()}catch(_){}}' +
        'addEventListener("click",function(e){' +
        'if(e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;' +
        'var a=e.target&&e.target.closest&&e.target.closest("a[href],area[href]");' +
        'if(!a||a.hasAttribute("download"))return;' +
        'var r=(a.getAttribute("href")||"").trim(),t=(a.getAttribute("target")||"").toLowerCase();' +
        'if(r.charAt(0)=="#"){e.preventDefault();G(r);return}' +
        'if(t&&t!="_self"&&t!="_top"&&t!="_parent")return;' +
        'var h=a.href;if(typeof h!="string"||!/^https?:/i.test(h)||h.indexOf(O)==0)return;' +
        'e.preventDefault();var i=h.indexOf("#"),p=i<0?h:h.slice(0,i),f=i<0?"":h.slice(i);' +
        'if(f&&p==F){G(f);return}' +
        'location.assign(O+"?url="+encodeURIComponent(p)+f)});' +
        '["pushState","replaceState"].forEach(function(k){var o=history[k];' +
        'history[k]=function(s,t,u){try{return o.call(this,s,t,u)}catch(x){return o.call(this,s,t)}}})' +
        '})();</script>';
}

/**
 * Make a blocked page usable inside the frame:
 *  - <base> so every subresource loads straight from the origin,
 *  - a small script that routes link clicks back through the proxy,
 *  - GET forms and meta refreshes routed back through the proxy,
 *  - in-page CSP / X-Frame-Options / referrer metas dropped.
 * Only elements that occur a handful of times per page get a handler; the
 * free plan allows 10 ms of CPU per request.
 */
function rewriteHtml(response, final, self) {
    const finalHref = stripHash(final);
    const state = { base: finalHref, baseDone: false, scriptDone: false };
    const proxyUrl = (target) => self + '/?url=' + encodeURIComponent(stripHash(target)) + target.hash;
    const resolve = (value) => {
        try {
            return new URL(value.trim(), state.base);
        } catch {
            return null;
        }
    };
    const baseTag = () => {
        if (state.baseDone) return '';
        state.baseDone = true;
        return '<base href="' + esc(finalHref) + '">';
    };
    const scriptTag = () => {
        if (state.scriptDone) return '';
        state.scriptDone = true;
        return clientScript(finalHref);
    };
    // Documents that leave out the optional <head>/<body> tags: inject at the
    // first head-level element instead, so <base> still precedes its url.
    const injectAround = (el) => {
        const base = baseTag();
        if (base) el.before(base, { html: true });
        const script = scriptTag();
        if (script) el.after(script, { html: true });
    };

    return new HTMLRewriter()
        .on('head', {
            element(el) {
                // <base> first so it precedes every url; the script last so it
                // cannot push <meta charset> out of the sniffing window.
                const base = baseTag();
                if (base) el.prepend(base, { html: true });
                const script = scriptTag();
                if (script) el.append(script, { html: true });
            },
        })
        .on('body', {
            element(el) {
                // Documents without a <head> tag.
                const html = baseTag() + scriptTag();
                if (html) el.before(html, { html: true });
            },
        })
        .on('title, link, style, script', { element: injectAround })
        .onDocument({
            end(end) {
                // Last resort (a bare fragment of body content): too late for
                // the urls above it, but links and later requests still work.
                const html = baseTag() + scriptTag();
                if (html) end.append(html, { html: true });
            },
        })
        .on('base', {
            element(el) {
                const href = el.getAttribute('href');
                if (href === null) return;
                let own;
                try {
                    own = new URL(href.trim(), finalHref);
                } catch {
                    el.remove();
                    return;
                }
                if (own.protocol !== 'http:' && own.protocol !== 'https:') {
                    el.remove();
                    return;
                }
                state.base = own.href;
                if (!state.baseDone) {
                    state.baseDone = true;
                    el.setAttribute('href', own.href);
                    return;
                }
                // Ours is already in the document and the first <base> wins,
                // so point it at the page's own base instead.
                el.replace('<script>(function(b){if(b)b.href=' + jsString(own.href) +
                    '})(document.querySelector("base"))</script>', { html: true });
            },
        })
        .on('form', {
            element(el) {
                const action = resolve(el.getAttribute('action') || '');
                if (!action || (action.protocol !== 'http:' && action.protocol !== 'https:')) return;
                const method = (el.getAttribute('method') || 'get').toLowerCase();
                const frame = (el.getAttribute('target') || '').toLowerCase();
                const newTab = frame && frame !== '_self' && frame !== '_parent' && frame !== '_top';
                const rel = el.getAttribute('rel');
                if (rel && /noreferrer/i.test(rel)) {
                    // The proxy gate needs the Referer of in-frame navigations.
                    el.setAttribute('rel', rel.replace(/noreferrer/gi, '').trim() || 'nofollow');
                }
                if (method !== 'get' || newTab) {
                    // Submits natively; an empty action would otherwise post
                    // to the proxy url instead of the page.
                    el.setAttribute('action', action.href);
                    return;
                }
                if (frame) el.setAttribute('target', '_self');
                // A GET submit replaces the action's query, so the real action
                // travels as a field and the worker rebuilds the url.
                action.search = '';
                action.hash = '';
                el.setAttribute('action', self + '/');
                el.prepend('<input type="hidden" name="' + FORM_PARAM + '" value="' + esc(action.href) + '">', { html: true });
            },
        })
        .on('meta', {
            element(el) {
                injectAround(el);
                const equiv = (el.getAttribute('http-equiv') || '').toLowerCase();
                const name = (el.getAttribute('name') || '').toLowerCase();
                if (equiv === 'content-security-policy' || equiv === 'content-security-policy-report-only' ||
                    equiv === 'x-frame-options' || name === 'referrer') {
                    el.remove();
                    return;
                }
                if (equiv === 'refresh') {
                    const m = /^\s*(\d+(?:\.\d*)?)\s*[;,]\s*(?:url\s*=\s*)?["']?([^"']+?)["']?\s*$/i.exec(el.getAttribute('content') || '');
                    const target = m && resolve(m[2]);
                    if (target && (target.protocol === 'http:' || target.protocol === 'https:')) {
                        el.setAttribute('content', m[1] + ';url=' + proxyUrl(target));
                    }
                }
            },
        })
        .transform(response);
}

function stripHash(url) {
    const href = url.href;
    const at = href.indexOf('#');
    return at < 0 ? href : href.slice(0, at);
}

/* ------------------------------------------------------------------ */
/* Wayback Machine                                                     */
/* ------------------------------------------------------------------ */

/** Closest archived snapshot of a url: { url, date } or null. */
async function findSnapshot(target) {
    if (hostOf(target.hostname) === WAYBACK_HOST) return null;
    try {
        const response = await fetch(WAYBACK_API + encodeURIComponent(target.href), {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(WAYBACK_TIMEOUT_MS),
        });
        if (!response.ok) {
            discard(response);
            return null;
        }
        const data = await response.json();
        const closest = data && data.archived_snapshots && data.archived_snapshots.closest;
        if (!closest || !closest.available || typeof closest.url !== 'string') return null;
        const snapshot = new URL(closest.url.replace(/^http:/, 'https:'));
        if (snapshot.hostname !== WAYBACK_HOST) return null;
        return { url: snapshot.href, date: snapshotDate(closest.timestamp) };
    } catch {
        return null;
    }
}

/** "20260207190608" -> "7 Feb 2026". */
function snapshotDate(timestamp) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(timestamp || ''));
    if (!m) return '';
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1];
    return month ? Number(m[3]) + ' ' + month + ' ' + m[1] : '';
}

/* ------------------------------------------------------------------ */
/* Pages served by the worker itself                                   */
/* ------------------------------------------------------------------ */

function interstitial(target, why = 'is not one of the sites that can be shown inside a window here.') {
    return page(200, 'interstitial', {
        title: hostOf(target.hostname),
        heading: 'This page opens in a new tab',
        body: '<p><strong>' + esc(hostOf(target.hostname)) + '</strong> ' + esc(why) + '</p>' +
            '<p class="url">' + esc(target.href) + '</p>',
        actions: [{ label: 'Open in new tab', href: target.href, primary: true }],
        back: true,
        shown: target.href,
    });
}

async function unavailablePage(result, target, cfg) {
    const shown = result.final || target;
    const host = hostOf(shown.hostname);

    if (result.kind === 'blocked') {
        return page(200, 'blocked', {
            title: host,
            heading: 'This site cannot be shown in a window',
            body: '<p><strong>' + esc(host) + '</strong> is online, but it does not allow being loaded through the link viewer.</p>' +
                '<p class="url">' + esc(shown.href) + '</p>',
            actions: [{ label: 'Open in new tab', href: shown.href, primary: true }],
            back: true,
            shown: shown.href,
        });
    }

    // Ask about the address the visitor asked for, not where it redirected.
    const snapshot = await findSnapshot(target);
    const actions = [];
    if (snapshot) {
        // Snapshot pages may be framed (no X-Frame-Options / frame-ancestors),
        // so the frame goes straight there, via the proxy in case that changes.
        actions.push({
            label: 'View archived snapshot',
            href: cfg.self + '/?url=' + encodeURIComponent(snapshot.url),
            primary: true,
            sameTab: true,
        });
    }
    actions.push({ label: 'Try the original in a new tab', href: target.href });

    const whole = result.scope === 'site';
    return page(200, 'dead', {
        title: host,
        heading: whole ? 'This site is no longer online' : 'This page is no longer online',
        body: '<p><strong>' + esc(host) + '</strong> ' +
            (whole ? 'did not respond.' : 'answered, but this page is gone.') + ' ' +
            (snapshot
                ? 'The Internet Archive saved a copy' + (snapshot.date ? ' on ' + esc(snapshot.date) : '') + '.'
                : 'The Internet Archive has no saved copy of it.') + '</p>' +
            '<p class="url">' + esc(target.href) + '</p>',
        actions,
        back: true,
        shown: target.href,
    });
}

/**
 * A small self-contained page in the site's OS X Mavericks style. `shown` is
 * the address the page is about: it is reported to the site window that frames
 * this page (the same message clientScript() sends), so its toolbar follows.
 */
function page(status, result, { title, heading, body, actions = [], back = false, shown = '' }) {
    const buttons = actions.map((action) =>
        '<a class="btn' + (action.primary ? ' primary' : '') + '" href="' + esc(action.href) + '"' +
        (action.sameTab ? ' rel="noopener"' : ' target="_blank" rel="noopener"') + '>' + esc(action.label) + '</a>'
    ).join('');
    const backLink = back
        ? '<a class="btn" href="#" onclick="history.back();return false">Back</a>'
        : '';

    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<meta name="robots" content="noindex,nofollow">' +
        '<title>' + esc(title) + '</title><style>' + PAGE_CSS + '</style></head><body>' +
        '<main class="sheet"><div class="icon" aria-hidden="true">' + PAGE_ICON + '</div>' +
        '<h1>' + esc(heading) + '</h1>' + body +
        (buttons || backLink ? '<div class="actions">' + backLink + buttons + '</div>' : '') +
        '</main>' +
        (shown
            ? '<script>try{parent!==window&&parent.postMessage({source:"link-proxy",url:' + jsString(shown) + '},"*")}catch(x){}</script>'
            : '') +
        '</body></html>';

    return new Response(html, {
        status,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
            'X-Content-Type-Options': 'nosniff',
            ...commonHeaders(result),
        },
    });
}

const PAGE_ICON = '<svg viewBox="0 0 64 64" width="64" height="64"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#8FC3FF"/><stop offset="1" stop-color="#2A7DE1"/></linearGradient></defs>' +
    '<circle cx="32" cy="32" r="27" fill="url(#g)" stroke="#1F5FB0" stroke-width="1.5"/>' +
    '<g fill="none" stroke="#fff" stroke-width="2" stroke-opacity=".9">' +
    '<ellipse cx="32" cy="32" rx="11" ry="27"/><path d="M5 32h54M9.5 18h45M9.5 46h45"/></g></svg>';

const PAGE_CSS = '*{box-sizing:border-box}' +
    'html,body{height:100%;margin:0}' +
    'body{display:flex;align-items:center;justify-content:center;padding:24px 16px;' +
    'font:13px/1.5 "Lucida Grande","Helvetica Neue",Helvetica,Arial,sans-serif;color:#2C3338;' +
    'background:#ECEFF2 linear-gradient(180deg,#F7F9FB 0%,#E4E8EC 100%) fixed;-webkit-font-smoothing:antialiased}' +
    '.sheet{width:100%;max-width:440px;text-align:center}' +
    '.icon{margin:0 auto 14px;width:64px;height:64px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.25))}' +
    'h1{margin:0 0 8px;font-size:17px;font-weight:bold;color:#1C2024;text-shadow:0 1px 0 rgba(255,255,255,.8)}' +
    'p{margin:0 0 10px;color:#525D66}' +
    'p a{color:#0066D6}' +
    '.url{font:11px/1.4 Menlo,Monaco,Consolas,monospace;color:#6E7A85;word-break:break-all;' +
    'background:rgba(255,255,255,.7);border:1px solid #C9D1D9;border-radius:4px;padding:6px 8px;text-align:left}' +
    '.actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:16px}' +
    '.btn{display:inline-block;padding:4px 14px;min-height:24px;border-radius:4px;font-size:13px;line-height:16px;' +
    'text-decoration:none;color:#1C2024;border:1px solid #B4BCC4;border-bottom-color:#9CA5AE;' +
    'background:linear-gradient(180deg,#FFFFFF 0%,#EDEFF2 100%);box-shadow:0 1px 1px rgba(0,0,0,.08)}' +
    '.btn:active{background:linear-gradient(180deg,#E2E6EA 0%,#D4DAE0 100%)}' +
    '.btn.primary{color:#fff;border-color:#2A6FCB;border-bottom-color:#1F5FB0;text-shadow:0 -1px 0 rgba(0,0,0,.25);' +
    'background:linear-gradient(180deg,#6CB3FA 0%,#1A82F7 100%)}' +
    '.btn.primary:active{background:linear-gradient(180deg,#4A9CF0 0%,#0066D6 100%)}' +
    '.btn:focus-visible{outline:2px solid #007AFF;outline-offset:2px}' +
    '@media (pointer:coarse){.btn{padding:10px 18px;font-size:15px}}';

/* ------------------------------------------------------------------ */
/* /check                                                              */
/* ------------------------------------------------------------------ */

async function handleCheck(request, url, env, ctx, cfg) {
    const cors = corsHeaders(request, cfg);
    const caller = callerOrigin(request, cfg);
    if (!caller) return json({ ok: false, error: 'forbidden' }, 403, cors);

    const target = parseTarget(url.searchParams.get('url'), cfg.selfHost);
    if (!target) return json({ ok: false, error: 'bad-url' }, 400, cors);

    const allowlist = await loadAllowlist(env, ctx);
    if (!isAllowed(target.hostname, allowlist)) {
        return json({ ok: false, error: 'not-allowed' }, 403, cors);
    }

    const result = await fetchTarget(request, target, allowlist, cfg.selfHost);
    discard(result.response);
    if (result.kind === 'offlist') {
        // Redirected off the allowlist. That hop was not requested, and where
        // it points is not reported.
        return json({
            ok: false, status: 0, finalUrl: null, frameable: false, dead: false, wayback: null, reason: 'not-allowed',
        }, 200, { ...cors, 'Cache-Control': 'private, max-age=300' });
    }
    const final = result.final || target;
    const ok = result.kind === 'ok';
    const dead = result.kind === 'dead';
    const snapshot = dead ? await findSnapshot(target) : null;

    return json({
        ok,
        status: result.status,
        finalUrl: final.href,
        frameable: ok && isFrameable(result.response.headers, final, [caller]),
        dead,
        wayback: snapshot ? snapshot.url : null,
        reason: ok ? null : dead ? 'dead' : result.kind === 'unverified' ? 'unverified' : 'blocked',
    }, 200, { ...cors, 'Cache-Control': 'private, max-age=300' });
}

/* ------------------------------------------------------------------ */
/* /gif — Klipy passthrough                                            */
/* ------------------------------------------------------------------ */

async function handleGif(request, url, env, cfg, endpoint) {
    const cors = corsHeaders(request, cfg);
    if (!callerOrigin(request, cfg)) return json({ error: 'forbidden' }, 403, cors);
    if (!env.KLIPY_API_KEY) return json({ error: 'gif-not-configured' }, 503, cors);
    // Origin and Referer are forgeable outside a browser, so the per-IP limit
    // is what bounds a script spending the Klipy key's quota.
    if (await overLimit(request, env, 'gif')) {
        return json({ error: 'rate-limited' }, 429, { ...cors, 'Retry-After': '60' });
    }

    const params = new URLSearchParams();
    if (endpoint === 'search') {
        const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
        if (!q) return json({ error: 'missing-q' }, 400, cors);
        params.set('q', q);
    }
    params.set('key', env.KLIPY_API_KEY);
    params.set('client_key', KLIPY_CLIENT_KEY);
    const limit = parseInt(url.searchParams.get('limit'), 10);
    params.set('limit', String(Math.min(Math.max(limit || GIF_DEFAULT_LIMIT, 1), GIF_MAX_LIMIT)));
    const pos = url.searchParams.get('pos');
    if (pos && pos.length <= 200) params.set('pos', pos);

    let upstream;
    try {
        upstream = await fetch(KLIPY_API_BASE + '/' + endpoint + '?' + params, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(KLIPY_TIMEOUT_MS),
        });
    } catch {
        return json({ error: 'upstream-unreachable' }, 502, cors);
    }
    if (!upstream.ok) {
        // Never relay an upstream error body: it may echo the request (and key).
        discard(upstream);
        return json({ error: 'upstream-error', status: upstream.status }, 502, cors);
    }
    return new Response(upstream.body, {
        status: 200,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
            'X-Robots-Tag': 'noindex, nofollow',
            ...cors,
        },
    });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function commonHeaders(result) {
    return {
        'X-Robots-Tag': 'noindex, nofollow',
        // In-frame navigations must still present this origin to pass gate 2.
        'Referrer-Policy': 'strict-origin',
        'Cache-Control': 'private, no-store',
        'X-Link-Proxy': result,
    };
}

function corsHeaders(request, cfg) {
    const headers = { Vary: 'Origin' };
    const origin = request.headers.get('Origin');
    if (origin && cfg.siteOrigins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
    return headers;
}

/** The site origin calling an API route, or null. Origin wins over Referer. */
function callerOrigin(request, cfg) {
    const origin = request.headers.get('Origin');
    const from = origin !== null ? origin : toOrigin(request.headers.get('Referer'));
    return from && cfg.siteOrigins.includes(from) ? from : null;
}

function splitList(value) {
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function toOrigin(value) {
    if (!value) return null;
    try {
        const origin = new URL(value).origin;
        return origin === 'null' ? null : origin;
    } catch {
        return null;
    }
}

/** Hostname without a trailing dot or leading "www.". */
function hostOf(hostname) {
    return hostname.replace(/\.$/, '').replace(/^www\./, '');
}

function hostLabel(origin) {
    try {
        return new URL(origin).host;
    } catch {
        return origin;
    }
}

function esc(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** A JS string literal that is safe inside an inline <script>. */
function jsString(value) {
    return JSON.stringify(String(value)).replace(/[<\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

function text(body, status, headers = {}) {
    return new Response(body, {
        status,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex, nofollow',
            ...headers,
        },
    });
}

function json(data, status, headers = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex, nofollow',
            ...headers,
        },
    });
}
