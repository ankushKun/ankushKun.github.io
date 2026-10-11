/**
 * Read-only MCP server over the published content of the site.
 *
 *   POST /mcp                       Streamable HTTP, JSON responses, no sessions
 *   GET  /.well-known/mcp.json      server card (also /.well-known/mcp/server-card.json)
 *   GET  /search?q=                 the same search as plain markdown or JSON, for
 *                                   agents without an MCP client (browsers are sent
 *                                   on to the desktop's <site>/?q= Spotlight)
 *
 * Dual-era: modern clients (2026-07-28, per-request `_meta`, no handshake) and
 * legacy clients (2025-11-25 and earlier, `initialize` first) are both served
 * statelessly from the same endpoint. Nothing is stored and nothing is written:
 * every answer is built from files the Hugo build publishes anyway
 * (/index.json, the <page>index.md markdown twins, /llms.txt), fetched from
 * SITE_URL. No secrets are read here.
 */

export const SERVER_VERSION = '1.0.0';
const SERVER_NAME = 'ankush-site';
const SERVER_TITLE = "Ankush Singh's site";

const MODERN_VERSIONS = ['2026-07-28'];
const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const ALL_VERSIONS = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];
// A legacy client that sends no MCP-Protocol-Version header (pre 2025-06-18).
const HEADERLESS_VERSION = '2025-03-26';

const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CAPS = 'io.modelcontextprotocol/clientCapabilities';
const META_SERVER = 'io.modelcontextprotocol/serverInfo';

// JSON-RPC / MCP error codes.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const HEADER_MISMATCH = -32020;
const UNSUPPORTED_VERSION = -32022;
// Application-defined (outside the JSON-RPC reserved range).
const RATE_LIMITED = -31429;

// Limits.
const MAX_BODY_BYTES = 16 * 1024;
const MAX_QUERY = 200;
const MAX_TAG = 40;
const MAX_PAGE_INPUT = 300;
const MAX_PAGE_CHARS = 50000;
const MAX_INLINE_CHARS = 6000;
const MAX_UPSTREAM_BYTES = 2 * 1024 * 1024;
const SITE_TIMEOUT_MS = 6000;
const SITE_CACHE_S = 300;
const INDEX_TTL_MS = SITE_CACHE_S * 1000;
const LIST_TTL_MS = 3600 * 1000;
const UA = 'ankush-site-worker-mcp (+https://ankush.one)';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const SECTIONS = { blogs: 'blog', projects: 'project', timeline: 'timeline' };

// App entries in index.json carry only a title and a one-line description, so
// a question about what such a page holds would never find it. About is the
// only page with the contact list (the Contacts app is gone), so it gets the
// words people ask that with; they count like description words.
const APP_KEYWORDS = {
    '/about/': 'contact contacts email mail reach hire socials social github linkedin twitter schedule book call meeting bio',
};

const STOPWORDS = new Set(('a an the and or of to in on for with by from at as is are was were be been it its this that ' +
    'what which who whom how when where why does did do has have had his he him me my i you your about any some ' +
    'there their them they can could should would will tell show find list give get all any more most ' +
    'ankush ankushkun singh kun').split(' '));

const ITEM_SCHEMA = {
    type: 'object',
    properties: {
        title: { type: 'string' },
        url: { type: 'string', description: 'The page on the site' },
        markdown_url: { type: 'string', description: 'Plain markdown version of the page' },
        section: { type: 'string', enum: ['blog', 'project', 'timeline', 'page'] },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        tags: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' },
        archived: { type: 'boolean', description: 'Project no longer maintained' },
    },
    required: ['title', 'url', 'markdown_url', 'section'],
};

const TOOLS = [
    {
        name: 'search_site',
        title: 'Search the site',
        description: 'Full-text search over the blog posts, projects, timeline entries and main pages of ankush.one. ' +
            'Returns the best matches with a short excerpt; read one in full with get_page.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', minLength: 1, maxLength: MAX_QUERY, description: 'Words to look for, e.g. "solana hackathon" or "cloudflare durable objects"' },
                section: { type: 'string', enum: ['any', 'blog', 'project', 'timeline', 'page'], default: 'any', description: 'Limit the search to one kind of page' },
                limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
            },
            required: ['query'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                total: { type: 'integer', description: 'Number of matching pages before the limit' },
                results: {
                    type: 'array',
                    items: { ...ITEM_SCHEMA, properties: { ...ITEM_SCHEMA.properties, excerpt: { type: 'string' } } },
                },
            },
            required: ['query', 'total', 'results'],
        },
        annotations: { title: 'Search the site', ...READ_ONLY },
    },
    {
        name: 'list_posts',
        title: 'List blog posts',
        description: 'Blog posts on ankush.one, newest first, optionally only those with a tag.',
        inputSchema: {
            type: 'object',
            properties: {
                tag: { type: 'string', maxLength: MAX_TAG, description: 'Only posts with this tag, e.g. "ai-agents"' },
                limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                total: { type: 'integer' },
                posts: { type: 'array', items: ITEM_SCHEMA },
                tags: { type: 'array', items: { type: 'string' }, description: 'Every tag used by a blog post' },
            },
            required: ['total', 'posts', 'tags'],
        },
        annotations: { title: 'List blog posts', ...READ_ONLY },
    },
    {
        name: 'list_projects',
        title: 'List projects',
        description: 'Projects Ankush Singh has built, newest first, optionally only those with a tag ' +
            '(technology or ecosystem, e.g. "solana", "arweave", "ai-agents"). Archived projects are flagged.',
        inputSchema: {
            type: 'object',
            properties: {
                tag: { type: 'string', maxLength: MAX_TAG, description: 'Only projects with this tag' },
                include_archived: { type: 'boolean', default: true, description: 'Include projects that are no longer maintained' },
                limit: { type: 'integer', minimum: 1, maximum: 60, default: 40 },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                total: { type: 'integer' },
                projects: { type: 'array', items: ITEM_SCHEMA },
                tags: {
                    type: 'array',
                    description: 'Tags used by projects, most used first',
                    items: { type: 'object', properties: { tag: { type: 'string' }, count: { type: 'integer' } }, required: ['tag', 'count'] },
                },
            },
            required: ['total', 'projects', 'tags'],
        },
        annotations: { title: 'List projects', ...READ_ONLY },
    },
    {
        name: 'get_page',
        title: 'Read a page',
        description: 'The full text of one page of ankush.one as markdown (blog post, project, timeline entry, ' +
            'or a section such as /timeline/, /about/, /resume/). Accepts a url from another tool, a path such as ' +
            '"/blogs/pokemon-scanner/", or a bare slug such as "pokemon-scanner".',
        inputSchema: {
            type: 'object',
            properties: {
                page: { type: 'string', minLength: 1, maxLength: MAX_PAGE_INPUT, description: 'URL, path or slug of the page' },
            },
            required: ['page'],
            additionalProperties: false,
        },
        annotations: { title: 'Read a page', ...READ_ONLY },
    },
    {
        name: 'get_about',
        title: 'About Ankush Singh',
        description: 'Who Ankush Singh is: the About page as markdown, with his current role, work history and links.',
        inputSchema: { type: 'object', additionalProperties: false },
        annotations: { title: 'About Ankush Singh', ...READ_ONLY },
    },
    {
        name: 'get_resume',
        title: 'Resume',
        description: "Ankush Singh's resume as markdown (experience, selected projects, skills, education), plus the link to the PDF.",
        inputSchema: { type: 'object', additionalProperties: false },
        annotations: { title: 'Resume', ...READ_ONLY },
    },
    {
        name: 'get_contact',
        title: 'Contact details',
        description: 'How to reach Ankush Singh: email, social profiles and the link to book a call.',
        inputSchema: { type: 'object', additionalProperties: false },
        annotations: { title: 'Contact details', ...READ_ONLY },
    },
];

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

export async function handleMcp(request, env, ctx, cfg) {
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                ...CORS,
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID',
                'Access-Control-Max-Age': '86400',
            },
        });
    }
    if (request.method !== 'POST') {
        // No standalone SSE stream and no sessions to delete.
        return new Response('This MCP endpoint only accepts POST (Streamable HTTP, JSON responses).\n', {
            status: 405,
            headers: { Allow: 'POST, OPTIONS', 'Content-Type': 'text/plain; charset=utf-8', ...BASE_HEADERS },
        });
    }

    // DNS-rebinding guard: a browser caller must be a real web origin. The
    // data is public, so any https site (or a local dev page) may call.
    const origin = request.headers.get('Origin');
    if (origin !== null && !isAcceptableOrigin(origin)) {
        return rpcError(null, INVALID_REQUEST, 'Origin not allowed', 403);
    }

    if (await overLimit(request, env, 'mcp')) {
        return rpcError(null, RATE_LIMITED, 'Too many requests, slow down and retry in a minute', 429, { 'Retry-After': '60' });
    }

    const type = (request.headers.get('Content-Type') || '').toLowerCase();
    if (!type.startsWith('application/json')) {
        return rpcError(null, INVALID_REQUEST, 'Content-Type must be application/json', 415);
    }
    const length = Number(request.headers.get('Content-Length') || 0);
    if (length > MAX_BODY_BYTES) return rpcError(null, INVALID_REQUEST, 'Request body too large', 413);

    // Chunked bodies carry no Content-Length: stop reading past the cap
    // instead of buffering whatever the client sends.
    let raw;
    try {
        raw = await readCapped(request, MAX_BODY_BYTES, true);
    } catch {
        return rpcError(null, PARSE_ERROR, 'Could not read the request body', 400);
    }
    if (raw === null) return rpcError(null, INVALID_REQUEST, 'Request body too large', 413);

    let message;
    try {
        message = JSON.parse(raw);
    } catch {
        return rpcError(null, PARSE_ERROR, 'Parse error: the body is not valid JSON', 400);
    }
    if (Array.isArray(message)) {
        return rpcError(null, INVALID_REQUEST, 'JSON-RPC batches are not supported; send one message per POST', 400);
    }
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
        return rpcError(null, INVALID_REQUEST, 'Invalid request: expected a JSON-RPC 2.0 message', 400);
    }

    const hasId = 'id' in message;
    const id = hasId ? message.id : null;
    if (typeof message.method !== 'string') {
        // A JSON-RPC response from the client: this server never sends requests.
        return rpcError(typeof id === 'string' || typeof id === 'number' ? id : null, INVALID_REQUEST, 'Invalid request: no method', 400);
    }
    if (!hasId) {
        // Notifications (notifications/initialized, notifications/cancelled, ...)
        // need no action from a stateless server.
        return new Response(null, { status: 202, headers: BASE_HEADERS });
    }
    if ((typeof id !== 'string' && typeof id !== 'number') || (typeof id === 'string' && id.length > 200)) {
        return rpcError(null, INVALID_REQUEST, 'Invalid request: id must be a string or an integer', 400);
    }

    try {
        return await dispatch(request, env, ctx, cfg, message, id);
    } catch (err) {
        console.error('mcp', err && err.stack || err);
        return rpcError(id, INTERNAL_ERROR, 'Internal error', 500);
    }
}

async function dispatch(request, env, ctx, cfg, message, id) {
    const { method } = message;
    const params = message.params === undefined ? {} : message.params;
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
        return rpcError(id, INVALID_PARAMS, 'Invalid params: expected an object', 400);
    }
    const site = siteUrl(env, cfg);

    // Legacy handshake. Negotiation per 2025-11-25: echo a version we speak,
    // otherwise offer our latest legacy one. No session id is minted.
    if (method === 'initialize') {
        const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        return rpcResult(id, {
            protocolVersion: LEGACY_VERSIONS.includes(asked) ? asked : LEGACY_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: serverInfo(site),
            instructions: instructions(site),
        });
    }

    const meta = params._meta && typeof params._meta === 'object' ? params._meta : {};
    const metaVersion = meta[META_VERSION];
    const headerVersion = request.headers.get('MCP-Protocol-Version');
    const version = typeof metaVersion === 'string' ? metaVersion : headerVersion || HEADERLESS_VERSION;

    if (!ALL_VERSIONS.includes(version)) {
        return rpcError(id, UNSUPPORTED_VERSION, 'Unsupported protocol version', 400, {}, { supported: ALL_VERSIONS, requested: version });
    }
    const modern = MODERN_VERSIONS.includes(version);

    if (modern) {
        // Header and body must agree (intermediaries route on the headers).
        if (typeof metaVersion !== 'string') {
            return rpcError(id, INVALID_PARAMS, 'Missing _meta["' + META_VERSION + '"]', 400);
        }
        if (headerVersion !== metaVersion) {
            return rpcError(id, HEADER_MISMATCH, 'Header mismatch: MCP-Protocol-Version does not match _meta', 400);
        }
        if (!meta[META_CAPS] || typeof meta[META_CAPS] !== 'object') {
            return rpcError(id, INVALID_PARAMS, 'Missing _meta["' + META_CAPS + '"]', 400);
        }
        if (request.headers.get('Mcp-Method') !== method) {
            return rpcError(id, HEADER_MISMATCH, 'Header mismatch: Mcp-Method is missing or does not match the method', 400);
        }
        if (method === 'tools/call') {
            const name = decodeHeader(request.headers.get('Mcp-Name'));
            if (name === null || name !== params.name) {
                return rpcError(id, HEADER_MISMATCH, 'Header mismatch: Mcp-Name is missing or does not match params.name', 400);
            }
        }
    }

    const done = (result, ttlMs) => {
        if (!modern) return rpcResult(id, result);
        const extra = { resultType: 'complete', ...result, _meta: { [META_SERVER]: serverInfo(site) } };
        if (ttlMs !== undefined) {
            extra.ttlMs = ttlMs;
            extra.cacheScope = 'public';
        }
        return rpcResult(id, extra);
    };

    switch (method) {
        case 'server/discover':
            return done({
                supportedVersions: ALL_VERSIONS,
                capabilities: { tools: { listChanged: false } },
                instructions: instructions(site),
            }, LIST_TTL_MS);
        case 'ping':
            return done({});
        case 'tools/list':
            // One page holds every tool; a cursor from elsewhere is not ours.
            if (params.cursor !== undefined && params.cursor !== null) {
                return rpcError(id, INVALID_PARAMS, 'Invalid cursor', 200);
            }
            return done({ tools: TOOLS }, LIST_TTL_MS);
        case 'tools/call': {
            const tool = TOOLS.find((t) => t.name === params.name);
            if (!tool) return rpcError(id, INVALID_PARAMS, 'Unknown tool: ' + String(params.name).slice(0, 80), 200);
            const args = params.arguments === undefined || params.arguments === null ? {} : params.arguments;
            if (typeof args !== 'object' || Array.isArray(args)) {
                return done(toolError('arguments must be an object'));
            }
            return done(await callTool(tool.name, args, env, ctx, site));
        }
        default:
            return rpcError(id, METHOD_NOT_FOUND, 'Method not found: ' + method.slice(0, 80), modern ? 404 : 200);
    }
}

/** The server card: identity and where to connect. Tools come from tools/list. */
export function handleServerCard(request, env, cfg) {
    const site = siteUrl(env, cfg);
    const card = {
        name: 'one.ankush/site',
        title: SERVER_TITLE,
        description: 'Read-only tools over the public content of ' + hostLabel(site) +
            ': search, blog posts, projects, resume and contact details.',
        version: SERVER_VERSION,
        websiteUrl: site + '/',
        protocolVersions: ALL_VERSIONS,
        remotes: [{ type: 'streamable-http', url: cfg.self + '/mcp' }],
        authentication: { required: false },
        capabilities: { tools: {} },
    };
    return new Response(JSON.stringify(card, null, 2), {
        status: 200,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
            ...CORS,
            ...BASE_HEADERS,
        },
    });
}

/**
 * GET /search?q=<terms>[&section=][&limit=][&format=md|json]
 *
 * The search_site ranking as a plain answer: markdown by default (what an
 * agent's web-fetch tool reads best), JSON with format=json or
 * `Accept: application/json`. A browser navigation (Accept: text/html, no
 * format) is redirected to <site>/?q=, which opens the desktop's Spotlight.
 */
export async function handleSearch(request, env, ctx, cfg) {
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Accept', 'Access-Control-Max-Age': '86400' },
        });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return plain('This endpoint only accepts GET.\n', 405, { Allow: 'GET, HEAD, OPTIONS' });
    }
    const site = siteUrl(env, cfg);
    const url = new URL(request.url);
    const params = url.searchParams;
    const accept = (request.headers.get('Accept') || '').toLowerCase();
    const format = params.get('format');
    if (format !== null && format !== 'md' && format !== 'json') return plain('"format" must be md or json.\n', 400);
    const json = format === 'json' || (format === null && /\bapplication\/json\b/.test(accept) && !accept.includes('text/html'));

    if (format === null && accept.includes('text/html') && params.has('q')) {
        const q = (params.get('q') || '').trim().slice(0, MAX_QUERY);
        return new Response(null, {
            status: 302,
            headers: { Location: site + '/' + (q ? '?q=' + encodeURIComponent(q) : ''), 'Cache-Control': 'no-store', Vary: 'Accept', ...BASE_HEADERS },
        });
    }

    let query;
    let section;
    let limit;
    try {
        const args = { q: params.get('q'), section: params.get('section'), limit: params.get('limit') };
        if (args.limit !== null) args.limit = /^\d{1,3}$/.test(args.limit) ? Number(args.limit) : NaN;
        query = stringArg(args, 'q', MAX_QUERY, true);
        section = enumArg(args, 'section', SEARCH_SECTIONS, 'any');
        limit = intArg(args, 'limit', 1, 20, 8);
    } catch (err) {
        if (!(err instanceof ArgError)) throw err;
        return searchUsage(err.message, site, cfg, json);
    }

    if (await overLimit(request, env, 'search')) {
        return json
            ? jsonResponse({ error: 'Too many requests, retry in a minute' }, 429, { 'Retry-After': '60' })
            : plain('Too many requests, retry in a minute.\n', 429, { 'Retry-After': '60' });
    }

    let found;
    try {
        found = await rankSearch(query, section, limit, site);
    } catch (err) {
        if (err instanceof ArgError) return searchUsage('"q" has no searchable words', site, cfg, json);
        if (err instanceof SiteError) {
            return json ? jsonResponse({ error: err.message }, 502) : plain(err.message + '\n', 502);
        }
        throw err;
    }
    const { total, results } = found;
    const inline = await inlineTopPage(results[0], site);

    if (json) {
        const body = { query, section, total, results };
        if (inline) body.top_result_markdown = inline;
        return jsonResponse(body, 200, { 'Cache-Control': 'public, max-age=300' });
    }

    const host = hostLabel(site);
    const shown = query.replace(/\s+/g, ' ').replace(/"/g, "'");
    const out = ['# Search results for "' + shown + '" on ' + host, ''];
    if (results.length) {
        out.push('Found ' + total + ' page' + (total === 1 ? '' : 's') +
            (total > results.length ? ', showing the best ' + results.length : '') + ', best match first.', '');
        results.forEach((r, i) => {
            out.push((i + 1) + '. ' + itemLine(r));
            if (r.excerpt) out.push('   > ' + r.excerpt);
            out.push('   Markdown: ' + r.markdown_url, '');
        });
        out.push('Every result has a markdown version (the `Markdown:` address) with the full text.');
        if (inline) out.push('', '---', '', 'Top result in full (' + results[0].markdown_url + '):', '', inline);
    } else {
        out.push('Nothing on ' + host + ' matches "' + shown + '". Try fewer or broader words.');
    }
    out.push('', 'More: ' + site + '/llms.txt (site index) · ' + cfg.self + '/mcp (MCP server with the same search, page and contact tools)');
    return new Response(out.join('\n') + '\n', {
        status: 200,
        headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=300', Vary: 'Accept', ...CORS, ...BASE_HEADERS },
    });
}

/**
 * Questions like "how do I contact him" land on a short standalone page
 * (about, resume, privacy). When such a page is the best match its text
 * IS the answer, so it is included instead of only linked. Posts and
 * projects stay links: they are long and the excerpt already shows the hit.
 */
async function inlineTopPage(top, site) {
    if (!top || top.section !== 'page' || !top.markdown_url.startsWith(site + '/')) return '';
    const body = await fetchText(site, top.markdown_url.slice(site.length));
    if (body === null) return '';
    const text = body.replace(/^---\n[\s\S]*?\n---\n+/, '').trim();
    return text && text.length <= MAX_INLINE_CHARS ? text : '';
}

function searchUsage(problem, site, cfg, json) {
    const usage = 'Usage: ' + cfg.self + '/search?q=<terms>, optional section=' + SEARCH_SECTIONS.join('|') +
        ', limit=1..20 (default 8), format=md|json.';
    if (json) return jsonResponse({ error: problem, usage }, 400);
    return plain(problem + '\n' + usage + '\n', 400);
}

function plain(body, status, headers = {}) {
    return new Response(body, {
        status,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...BASE_HEADERS, ...headers },
    });
}

function jsonResponse(body, status, headers = {}) {
    return new Response(JSON.stringify(body, null, 2), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept', ...CORS, ...BASE_HEADERS, ...headers },
    });
}

/** Per-IP limit shared by /mcp, /search and /gif (separate keys). Fails open if the binding is missing or down. */
export async function overLimit(request, env, prefix) {
    const limiter = env.MCP_RATE_LIMITER;
    if (!limiter || typeof limiter.limit !== 'function') return false;
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    try {
        return !(await limiter.limit({ key: prefix + ':' + ip })).success;
    } catch {
        // A limiter outage must not take the server down.
        return false;
    }
}

const CORS = { 'Access-Control-Allow-Origin': '*' };
const BASE_HEADERS ={ 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' };

function rpcResult(id, result) {
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...BASE_HEADERS },
    });
}

function rpcError(id, code, message, status, headers = {}, data) {
    const error = { code, message };
    if (data !== undefined) error.data = data;
    const body = { jsonrpc: '2.0', error };
    if (id !== null && id !== undefined) body.id = id;
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...BASE_HEADERS, ...headers },
    });
}

function isAcceptableOrigin(origin) {
    let url;
    try {
        url = new URL(origin);
    } catch {
        return false;
    }
    if (url.origin === 'null' || url.origin !== origin.replace(/\/$/, '')) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
}

/** Mcp-Name may carry `=?base64?...?=` for names that are not plain ASCII. */
function decodeHeader(value) {
    if (value === null) return null;
    const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(value);
    if (!m) return value;
    try {
        const bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return null;
    }
}

function serverInfo(site) {
    return { name: SERVER_NAME, title: SERVER_TITLE, version: SERVER_VERSION, websiteUrl: site + '/' };
}

function instructions(site) {
    return 'Read-only tools over ' + hostLabel(site) + ', the personal site of Ankush Singh (also known as ' +
        'Ankush Kun / ankushKun): his blog posts, projects, timeline, hackathon wins, resume and contact details. ' +
        'Use search_site for questions about a topic, list_posts / list_projects to browse, and get_page with a ' +
        'url from those results to read a page in full. get_about, get_resume and get_contact answer the usual ' +
        'questions about him directly. Everything here is public and also published at ' + site + '/llms.txt.';
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

async function callTool(name, args, env, ctx, site) {
    try {
        switch (name) {
            case 'search_site': return await searchSite(args, site);
            case 'list_posts': return await listPosts(args, site);
            case 'list_projects': return await listProjects(args, site);
            case 'get_page': {
                const page = stringArg(args, 'page', MAX_PAGE_INPUT, true);
                return await getPage(page, site);
            }
            case 'get_about': return await getPage('/about/', site);
            case 'get_resume': {
                const result = await getPage('/resume/', site);
                if (!result.isError) result.content.push({ type: 'text', text: 'PDF version: ' + site + '/resume.pdf' });
                return result;
            }
            case 'get_contact': return await getContact(site);
        }
    } catch (err) {
        if (err instanceof ArgError) return toolError(err.message);
        if (err instanceof SiteError) return toolError(err.message);
        throw err;
    }
    return toolError('Unknown tool');
}

class ArgError extends Error {}
class SiteError extends Error {}

function toolError(text) {
    return { content: [{ type: 'text', text }], isError: true };
}

function stringArg(args, key, max, required) {
    const value = args[key];
    if (value === undefined || value === null) {
        if (required) throw new ArgError('"' + key + '" is required');
        return '';
    }
    if (typeof value !== 'string') throw new ArgError('"' + key + '" must be a string');
    const trimmed = value.trim();
    if (required && !trimmed) throw new ArgError('"' + key + '" must not be empty');
    if (trimmed.length > max) throw new ArgError('"' + key + '" must be at most ' + max + ' characters');
    return trimmed;
}

function intArg(args, key, min, max, fallback) {
    const value = args[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'number' || !Number.isInteger(value)) throw new ArgError('"' + key + '" must be an integer');
    if (value < min || value > max) throw new ArgError('"' + key + '" must be between ' + min + ' and ' + max);
    return value;
}

function boolArg(args, key, fallback) {
    const value = args[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'boolean') throw new ArgError('"' + key + '" must be true or false');
    return value;
}

function enumArg(args, key, allowed, fallback) {
    const value = args[key];
    if (value === undefined || value === null) return fallback;
    if (!allowed.includes(value)) throw new ArgError('"' + key + '" must be one of: ' + allowed.join(', '));
    return value;
}

async function searchSite(args, site) {
    const query = stringArg(args, 'query', MAX_QUERY, true);
    const section = enumArg(args, 'section', SEARCH_SECTIONS, 'any');
    const limit = intArg(args, 'limit', 1, 20, 8);
    const { total, results } = await rankSearch(query, section, limit, site);
    const lines = results.map((r, i) => (i + 1) + '. ' + itemLine(r) + (r.excerpt ? '\n   > ' + r.excerpt : ''));
    const text = results.length
        ? 'Found ' + total + ' page' + (total === 1 ? '' : 's') + ' for "' + query + '"' +
            (total > results.length ? ' (showing ' + results.length + ')' : '') + ':\n\n' + lines.join('\n') +
            '\n\nRead one in full with get_page.'
        : 'Nothing on ' + hostLabel(site) + ' matches "' + query + '". Try fewer or broader words, or list_posts / list_projects.';
    return { content: [{ type: 'text', text }], structuredContent: { query, total, results } };
}

const SEARCH_SECTIONS = ['any', 'blog', 'project', 'timeline', 'page'];

/** Shared by the search_site tool and GET /search. Throws ArgError for a query with no words. */
async function rankSearch(query, section, limit, site) {
    const { items } = await loadIndex(site);

    const terms = queryTerms(query);
    if (!terms.length) throw new ArgError('"query" has no searchable words');
    const phrase = terms.length > 1 ? terms.join(' ') : '';

    // Per-term field scores, then weight each term by how rare it is on the
    // site, so "hackathon" (dozens of timeline entries) cannot drown "solana".
    const candidates = [];
    const df = terms.map(() => 0);
    for (const item of items) {
        if (section !== 'any' && item.section !== section) continue;
        const per = terms.map((term, i) => {
            const s = 6 * hit(item.lt, term) + 5 * tagHit(item.ltags, term) + 3 * hit(item.ld, term) + hit(item.lc, term);
            if (s > 0) df[i]++;
            return s;
        });
        if (per.some((s) => s > 0)) candidates.push({ item, per });
    }
    const idf = df.map((count) => Math.log(1 + items.length / (1 + count)));

    const scored = [];
    for (const { item, per } of candidates) {
        let score = 0;
        let matched = 0;
        per.forEach((s, i) => {
            if (s > 0) matched++;
            score += s * idf[i];
        });
        if (phrase) {
            if (item.lt.includes(phrase)) score += 8;
            else if (item.ld.includes(phrase) || item.lc.includes(phrase)) score += 3;
        }
        // Pages that match every word rank well above pages matching one.
        score *= (matched / terms.length) ** 2;
        scored.push({ item, score });
    }
    scored.sort((a, b) => b.score - a.score || (b.item.date || '').localeCompare(a.item.date || ''));

    const results = scored.slice(0, limit).map(({ item }) => ({ ...publicItem(item, site), excerpt: excerpt(item, terms) }));
    return { total: scored.length, results };
}

async function listPosts(args, site) {
    const tag = stringArg(args, 'tag', MAX_TAG, false).toLowerCase();
    const limit = intArg(args, 'limit', 1, 50, 20);
    const { items } = await loadIndex(site);
    const all = items.filter((item) => item.section === 'blog').sort(byDateDesc);
    const matching = tag ? all.filter((item) => item.ltags.includes(tag)) : all;
    const posts = matching.slice(0, limit).map((item) => publicItem(item, site));
    const tags = [...new Set(all.flatMap((item) => item.ltags))].sort();

    const text = posts.length
        ? (tag ? 'Blog posts tagged "' + tag + '"' : 'Blog posts') + ', newest first (' + matching.length + '):\n\n' +
            posts.map((p) => '- ' + itemLine(p)).join('\n')
        : 'No blog post is tagged "' + tag + '". Tags in use: ' + tags.join(', ') + '.';
    return { content: [{ type: 'text', text }], structuredContent: { total: matching.length, posts, tags } };
}

async function listProjects(args, site) {
    const tag = stringArg(args, 'tag', MAX_TAG, false).toLowerCase();
    const includeArchived = boolArg(args, 'include_archived', true);
    const limit = intArg(args, 'limit', 1, 60, 40);
    const { items } = await loadIndex(site);
    const all = items.filter((item) => item.section === 'project').sort(byDateDesc);

    const counts = new Map();
    for (const item of all) for (const t of item.ltags) counts.set(t, (counts.get(t) || 0) + 1);
    const tags = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t, count]) => ({ tag: t, count }));

    const matching = all.filter((item) => (!tag || item.ltags.includes(tag)) && (includeArchived || !item.archived));
    const projects = matching.slice(0, limit).map((item) => publicItem(item, site));

    const label = (tag ? 'Projects tagged "' + tag + '"' : 'Projects') + (includeArchived ? '' : ' that are still maintained');
    const text = projects.length
        ? label + ', newest first (' + matching.length + (matching.length > projects.length ? ', showing ' + projects.length : '') + '):\n\n' +
            projects.map((p) => '- ' + itemLine(p)).join('\n')
        : 'No project matches. Tags in use: ' + tags.slice(0, 30).map((t) => t.tag).join(', ') + '.';
    return { content: [{ type: 'text', text }], structuredContent: { total: matching.length, projects, tags } };
}

async function getPage(input, site) {
    let path = await resolvePath(input, site);
    if (path === '/') {
        // The home page is the desktop; its text form is llms.txt.
        const body = await fetchText(site, '/llms.txt');
        if (body === null) throw new SiteError('The site could not be reached right now. Try again in a minute.');
        return { content: [{ type: 'text', text: clip(body, site + '/llms.txt') }] };
    }

    let body = await fetchText(site, path + 'index.md');
    if (body === null) {
        // An old address: Hugo leaves an alias page that redirects.
        const moved = await aliasTarget(site, path);
        if (moved) {
            path = moved;
            body = await fetchText(site, path + 'index.md');
        }
    }
    if (body === null) {
        throw new SiteError('There is no page at ' + site + path + '. Use search_site or list_posts / list_projects to find the right address.');
    }
    return { content: [{ type: 'text', text: clip(body, site + path) }] };
}

/**
 * The contact card. There is no Contacts page any more (/contact/ redirects to
 * About); the About page's markdown ends with an "Elsewhere" list built from
 * data/contact.yaml: social profiles, email and the booking link.
 */
async function getContact(site) {
    const result = await getPage('/about/', site);
    const text = result.content[0].text;
    const start = text.indexOf('\n## Elsewhere\n');
    if (start === -1) return result;
    const rest = text.slice(start + '\n## Elsewhere\n'.length);
    const end = rest.indexOf('\n## ');
    const list = (end === -1 ? rest : rest.slice(0, end)).trim();
    if (!list) return result;
    return { content: [{ type: 'text', text: '# Contact Ankush Singh\n\n' + list + '\n\nFrom ' + site + '/about/' }] };
}

/** A url, path or slug -> a site path with leading and trailing slash. */
async function resolvePath(input, site) {
    let value = input.trim();
    const origin = new URL(site);
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
        let url;
        try {
            url = new URL(value);
        } catch {
            throw new ArgError('"page" is not a valid url');
        }
        const host = url.hostname.replace(/^www\./, '');
        if ((url.protocol !== 'https:' && url.protocol !== 'http:') || host !== origin.hostname.replace(/^www\./, '')) {
            throw new ArgError('Only pages on ' + hostLabel(site) + ' can be read');
        }
        value = url.pathname;
    } else if (value.startsWith('//')) {
        throw new ArgError('Only pages on ' + hostLabel(site) + ' can be read');
    }
    value = value.replace(/[?#].*$/, '');

    if (!value.includes('/')) return slugPath(value, site);

    let path = value.startsWith('/') ? value : '/' + value;
    try {
        path = decodeURIComponent(path);
    } catch {
        throw new ArgError('"page" is not a valid path');
    }
    path = path.replace(/\/index\.(md|html)$/i, '/').replace(/\/+/g, '/');
    if (!path.endsWith('/')) path += '/';
    if (!/^\/[A-Za-z0-9._~\/-]*$/.test(path) || /(^|\/)\.\.?(\/|$)/.test(path) || path.length > 200) {
        throw new ArgError('"page" is not a valid path on ' + hostLabel(site));
    }
    return path;
}

/** "pokemon-scanner" -> "/blogs/pokemon-scanner/" (projects carry a "2026." prefix). */
async function slugPath(slug, site) {
    const s = slug.toLowerCase().replace(/^\/+|\/+$/g, '');
    if (!/^[a-z0-9._~-]{1,120}$/.test(s)) throw new ArgError('"page" is not a valid slug');
    const { items } = await loadIndex(site);
    const ranked = items
        .map((item) => {
            const last = item.path.split('/').filter(Boolean).pop() || '';
            const l = last.toLowerCase();
            const rank = l === s ? 3 : l.replace(/^\d{4}\./, '') === s ? 2 : 0;
            // Blog posts win over projects and timeline entries of the same name.
            return { item, rank: rank && rank * 10 + (item.section === 'blog' ? 2 : item.section === 'project' ? 1 : 0) };
        })
        .filter((r) => r.rank)
        .sort((a, b) => b.rank - a.rank);
    if (ranked.length) return ranked[0].item.path;
    // Top-level sections and pages: "about", "resume", "timeline".
    return '/' + s + '/';
}

async function aliasTarget(site, path) {
    const response = await siteFetch(site, path, 'text/html');
    if (!response || !response.ok) {
        discard(response);
        return null;
    }
    const html = (await readCapped(response, 4096)) || '';
    if (!/http-equiv=["']?refresh/i.test(html)) return null;
    const m = /<link[^>]+rel=["']?canonical["']?[^>]+href=["']([^"']+)["']/i.exec(html) ||
        /content=["']?\d+;\s*url=([^"'>]+)/i.exec(html);
    if (!m) return null;
    try {
        const target = new URL(m[1], site + path);
        if (target.origin !== new URL(site).origin) return null;
        const next = target.pathname.endsWith('/') ? target.pathname : target.pathname + '/';
        return next !== path && /^\/[A-Za-z0-9._~\/-]*$/.test(next) ? next : null;
    } catch {
        return null;
    }
}

function clip(text, url) {
    if (text.length <= MAX_PAGE_CHARS) return text;
    let cut = text.lastIndexOf('\n\n', MAX_PAGE_CHARS);
    if (cut < MAX_PAGE_CHARS / 2) cut = MAX_PAGE_CHARS;
    return text.slice(0, cut) + '\n\n[Truncated: the rest of this page is at ' + url + ']';
}

/* ------------------------------------------------------------------ */
/* Search helpers                                                      */
/* ------------------------------------------------------------------ */

function queryTerms(query) {
    const words = fold(query).match(/[a-z0-9][a-z0-9+#.-]*/g) || [];
    const clean = [...new Set(words.map((w) => w.replace(/[.-]+$/, '')).filter(Boolean))];
    const content = clean.filter((w) => !STOPWORDS.has(w));
    return (content.length ? content : clean).slice(0, 12);
}

/** 2 when `term` starts a word in `field`, 1 when it is only inside one. */
function hit(field, term) {
    let at = field.indexOf(term);
    if (at < 0) return 0;
    let inside = false;
    while (at >= 0) {
        if (at === 0 || !/[a-z0-9]/.test(field[at - 1])) return 2;
        inside = true;
        at = field.indexOf(term, at + 1);
    }
    // Short words inside longer ones ("ai" in "maintained") are noise.
    return inside && term.length > 3 ? 1 : 0;
}

function tagHit(tags, term) {
    if (tags.includes(term)) return 2;
    return tags.some((tag) => tag.split('-').includes(term)) ? 1 : 0;
}

function excerpt(item, terms) {
    const text = item.content;
    if (!text) return '';
    const lower = item.lc;
    let at = -1;
    for (const term of terms) {
        const re = new RegExp('(^|[^a-z0-9])' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const m = re.exec(lower);
        if (m && (at < 0 || m.index < at)) at = m.index + m[1].length;
    }
    if (at < 0) return '';
    let start = Math.max(0, at - 80);
    let end = Math.min(text.length, at + 160);
    if (start > 0) {
        const space = text.indexOf(' ', start);
        if (space > 0 && space < at) start = space + 1;
    }
    if (end < text.length) {
        const space = text.lastIndexOf(' ', end);
        if (space > at) end = space;
    }
    return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '');
}

function fold(value) {
    return String(value).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

function byDateDesc(a, b) {
    return (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title);
}

function publicItem(item, site) {
    const out = {
        title: item.title,
        url: site + item.path,
        markdown_url: site + (item.path === '/' ? '/llms.txt' : item.path + 'index.md'),
        section: item.section,
    };
    if (item.date) out.date = item.date;
    if (item.tags.length) out.tags = item.tags;
    if (item.description) out.description = item.description;
    if (item.section === 'project') out.archived = item.archived;
    return out;
}

function itemLine(r) {
    const bits = [r.section];
    if (r.date) bits.push(r.date);
    if (r.archived) bits.push('archived');
    if (r.tags && r.tags.length) bits.push('tags: ' + r.tags.join(', '));
    return '[' + r.title.replace(/[[\]]/g, '') + '](' + r.url + ') (' + bits.join(' · ') + ')' +
        (r.description ? '\n   ' + r.description : '');
}

/* ------------------------------------------------------------------ */
/* Site data                                                           */
/* ------------------------------------------------------------------ */

let indexMemo = { site: '', expires: 0, data: null };

/**
 * The Spotlight index (/index.json) normalised for search, plus archived
 * flags from the generated /projects/index.md. Memoised per isolate.
 */
async function loadIndex(site) {
    const now = Date.now();
    if (indexMemo.site === site && indexMemo.data && now < indexMemo.expires) return indexMemo.data;

    const [indexText, projectsMd] = await Promise.all([fetchText(site, '/index.json'), fetchText(site, '/projects/index.md')]);
    let raw = null;
    try {
        raw = indexText === null ? null : JSON.parse(indexText);
    } catch {
        raw = null;
    }
    if (!Array.isArray(raw)) {
        if (indexMemo.site === site && indexMemo.data) return indexMemo.data; // serve stale over nothing
        throw new SiteError('The site index could not be loaded right now. Try again in a minute.');
    }

    const archived = new Set();
    for (const line of (projectsMd || '').split('\n')) {
        const m = /^- \[[^\]]*\]\(([^)\s]+)\)/.exec(line);
        if (m && line.includes('Archived, no longer maintained.')) {
            const path = sitePath(m[1], site);
            if (path) archived.add(path);
        }
    }

    const items = [];
    const seen = new Set();
    for (const entry of raw.slice(0, 2000)) {
        const item = normaliseItem(entry, site, archived);
        if (item && !seen.has(item.path)) {
            seen.add(item.path);
            items.push(item);
        }
    }
    const data = { items };
    indexMemo = { site, expires: now + INDEX_TTL_MS, data };
    return data;
}

function normaliseItem(entry, site, archived) {
    if (!entry || typeof entry !== 'object') return null;
    const title = cleanText(entry.title, 200);
    const path = sitePath(entry.permalink, site);
    if (!title || !path) return null;

    let section;
    if (entry.kind === 'page') section = SECTIONS[entry.type] || 'page';
    else if (entry.kind === 'app') section = 'page'; // apps with a page of their own (About, Resume, Privacy, ...)
    else return null;

    const tags = Array.isArray(entry.tags) ? entry.tags.filter((t) => typeof t === 'string').map((t) => cleanText(t, 60)).filter(Boolean).slice(0, 20) : [];
    const date = typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date : '';
    const description = cleanText(entry.description, 400);
    const content = cleanText(entry.content, 2000);
    return {
        title,
        path,
        section,
        date,
        tags,
        description,
        content,
        archived: archived.has(path),
        lt: fold(title),
        ld: fold(entry.kind === 'app' && APP_KEYWORDS[path] ? description + ' ' + APP_KEYWORDS[path] : description),
        lc: fold(content),
        ltags: tags.map((t) => fold(t)),
    };
}

/** A site url or root-relative path -> "/a/b/" (null when it is not on the site). */
function sitePath(value, site) {
    if (typeof value !== 'string' || !value) return null;
    let url;
    try {
        url = new URL(value, site + '/');
    } catch {
        return null;
    }
    if (url.origin !== new URL(site).origin && url.hostname.replace(/^www\./, '') !== new URL(site).hostname.replace(/^www\./, '')) return null;
    let path = url.pathname.replace(/\/index\.(md|html)$/i, '/');
    if (!path.endsWith('/')) path += '/';
    return /^\/[A-Za-z0-9._~\/%-]*$/.test(path) ? path : null;
}

function cleanText(value, max) {
    if (typeof value !== 'string') return '';
    const text = value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
    return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

async function fetchText(site, path) {
    const response = await siteFetch(site, path, path.endsWith('.json') ? 'application/json' : 'text/markdown, text/plain;q=0.9');
    if (!response) return null;
    if (!response.ok) {
        discard(response);
        return null;
    }
    const type = (response.headers.get('Content-Type') || '').toLowerCase();
    if (type.startsWith('text/html')) {
        // A catch-all page instead of the file asked for.
        discard(response);
        return null;
    }
    return readCapped(response, MAX_UPSTREAM_BYTES);
}

async function siteFetch(site, path, accept) {
    try {
        return await fetch(site + path, {
            headers: { Accept: accept, 'User-Agent': UA },
            redirect: 'follow',
            signal: AbortSignal.timeout(SITE_TIMEOUT_MS),
            cf: { cacheTtl: SITE_CACHE_S, cacheEverything: true },
        });
    } catch {
        return null;
    }
}

/** Response (or request) text, or null when it is larger than `max` bytes.
 * Caps under 64 KB return the first `max` bytes instead, unless `strict`.
 * Reading stops as soon as the cap is passed, chunked bodies included. */
async function readCapped(response, max, strict = false) {
    const declared = Number(response.headers.get('Content-Length') || 0);
    if (declared > max) {
        discard(response);
        return null;
    }
    const reader = response.body && response.body.getReader();
    if (!reader) return '';
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) {
            reader.cancel().catch(() => {});
            return !strict && max < 64 * 1024 ? new TextDecoder().decode(concat(chunks, size - value.byteLength)) : null;
        }
        chunks.push(value);
    }
    return new TextDecoder().decode(concat(chunks, size));
}

function concat(chunks, size) {
    const out = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
        out.set(chunk, at);
        at += chunk.byteLength;
    }
    return out;
}

function discard(response) {
    if (response && response.body) response.body.cancel().catch(() => {});
}

/** SITE_URL, else the first of SITE_ORIGINS; never with a trailing slash. */
function siteUrl(env, cfg) {
    const value = String(env.SITE_URL || cfg.siteOrigins[0] || 'https://ankush.one').trim();
    try {
        return new URL(value).origin;
    } catch {
        return 'https://ankush.one';
    }
}

function hostLabel(site) {
    try {
        return new URL(site).host;
    } catch {
        return site;
    }
}
