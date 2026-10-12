/**
 * Activity Monitor
 *
 * Top: recent public GitHub activity, repo-level only (GitHub's events feed
 * no longer carries commit messages, and titles of issues are none of this
 * window's business). Bottom: what the site itself is doing right now - the
 * music that is playing, visitors online, the realtime relay, and the build
 * being served.
 *
 * Loaded lazily the first time the window is opened. The only network request
 * is one unauthenticated call to api.github.com, made when the window opens and
 * at most every ten minutes after that while it stays open and visible. The
 * result is kept in sessionStorage so reopening the window costs nothing, and a
 * rate limit (60 requests an hour per IP, shared with everything else on the
 * visitor's network) is remembered until GitHub says it has reset.
 *
 * Everything else is read from what the page already has: SiteMusic, the
 * online pill maintained by cursors.js, SiteGun's connection state and the
 * git-commit meta tags. None of those are required.
 */
(function () {
    'use strict';

    const CACHE_KEY = 'activity-monitor-gh-v1';
    const CACHE_TTL_MS = 10 * 60 * 1000;
    const PER_PAGE = 100;              // the feed holds 30 days at most
    const GRAPH_DAYS = 30;
    const MAX_ROWS = 60;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const REPO_RE = /^[A-Za-z0-9_.-]{1,60}\/[A-Za-z0-9_.-]{1,100}$/;
    const SHA_RE = /^[0-9a-f]{7,40}$/i;
    const SVG_NS = 'http://www.w3.org/2000/svg';

    // 16x16 stroke glyphs, one per kind of activity
    const GLYPHS = {
        push: 'M8 13V3.5M4.2 7.2 8 3.4l3.8 3.8',
        star: 'M8 2.2l1.75 3.6 3.95.55-2.87 2.76.69 3.92L8 11.15l-3.52 1.88.69-3.92L2.3 6.35l3.95-.55z',
        branch: 'M5 2.8v10.4M5 9.2c0-2.4 6-1.6 6-4.4M5 2.8a1.3 1.3 0 1 0 0 .01M5 13.2a1.3 1.3 0 1 0 0 .01M11 4.4a1.3 1.3 0 1 0 0 .01',
        remove: 'M3.2 4.6h9.6M6.4 4.6V3h3.2v1.6M4.6 4.6l.6 8.4h5.6l.6-8.4M6.9 7v3.8M9.1 7v3.8',
        pull: 'M4.5 4.8v6.4M4.5 3.5a1.3 1.3 0 1 0 0 .01M4.5 12.5a1.3 1.3 0 1 0 0 .01M11.5 12.5a1.3 1.3 0 1 0 0 .01M11.5 11.2V6.4c0-1.3-.8-2.1-2.1-2.1H7.6M9.2 2.6 7.5 4.3l1.7 1.7',
        issue: 'M8 2.2a5.8 5.8 0 1 0 0 11.6A5.8 5.8 0 0 0 8 2.2zM8 5v3.6M8 10.9v.1',
        comment: 'M2.8 3.4h10.4v7H7.6L4.8 13v-2.6h-2z',
        tag: 'M2.8 2.8h4.6l5.8 5.8-4.6 4.6-5.8-5.8zM5.4 5.4v.1',
        fork: 'M4.5 4.8v1.4c0 1.2.8 2 2 2h3c1.2 0 2-.8 2-2V4.8M8 8.2v3M4.5 3.5a1.3 1.3 0 1 0 0 .01M11.5 3.5a1.3 1.3 0 1 0 0 .01M8 12.5a1.3 1.3 0 1 0 0 .01',
        repo: 'M3.6 2.6h8.8v10.8H3.6zM6 2.6v10.8M8.2 5.4h2M8.2 7.8h2'
    };

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // ------------------------------------------------------------------
    // Small helpers
    // ------------------------------------------------------------------

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function glyph(kind) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('width', '14');
        svg.setAttribute('height', '14');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', GLYPHS[kind] || GLYPHS.repo);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '1.4');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(path);
        return svg;
    }

    function plural(n, one, many) {
        return n + ' ' + (n === 1 ? one : many);
    }

    function dayStart(ms) {
        const d = new Date(ms);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    }

    /** Whole local days between two timestamps (DST-safe). */
    function daysBetween(fromMs, toMs) {
        return Math.round((dayStart(toMs) - dayStart(fromMs)) / DAY_MS);
    }

    function shortDate(ms) {
        const d = new Date(ms);
        return MONTHS[d.getMonth()] + ' ' + d.getDate();
    }

    function clock(ms) {
        const d = new Date(ms);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    function fullDate(ms) {
        const d = new Date(ms);
        return shortDate(ms) + ', ' + d.getFullYear() + ' at ' + clock(ms);
    }

    function relativeTime(ms, now) {
        const diff = Math.max(0, now - ms);
        const min = Math.floor(diff / 60000);
        if (min < 1) return 'Just now';
        if (min < 60) return min + ' min ago';
        const days = daysBetween(ms, now);
        if (days === 0) return plural(Math.floor(min / 60), 'hour', 'hours') + ' ago';
        if (days === 1) return 'Yesterday';
        if (days < 7) return days + ' days ago';
        return shortDate(ms);
    }

    function duration(ms) {
        const total = Math.max(0, Math.floor(ms / 1000));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h) return h + 'h ' + String(m).padStart(2, '0') + 'm';
        if (m) return m + 'm ' + String(s).padStart(2, '0') + 's';
        return s + 's';
    }

    function cleanRef(value) {
        if (typeof value !== 'string') return '';
        const ref = value.replace(/^refs\/(heads|tags)\//, '');
        return /^[\w./+@-]{1,80}$/.test(ref) ? ref : '';
    }

    function refPath(ref) {
        return ref.split('/').map(encodeURIComponent).join('/');
    }

    function posInt(value) {
        const n = Number(value);
        return Number.isInteger(n) && n > 0 && n < 1e9 ? n : 0;
    }

    // ------------------------------------------------------------------
    // GitHub events -> compact, validated rows
    // The API response is third-party data: every field is type-checked,
    // every link is rebuilt here from validated parts, nothing is rendered
    // as HTML.
    // ------------------------------------------------------------------

    function normalizeEvent(ev) {
        if (!ev || typeof ev !== 'object' || !ev.repo || typeof ev.repo.name !== 'string') return null;
        const repo = ev.repo.name;
        if (!REPO_RE.test(repo)) return null;
        const at = Date.parse(ev.created_at);
        if (!Number.isFinite(at)) return null;

        const p = (ev.payload && typeof ev.payload === 'object') ? ev.payload : {};
        const base = 'https://github.com/' + repo;
        const row = { kind: 'repo', text: '', repo: repo, at: at, href: base, n: 1, key: '' };

        switch (ev.type) {
            case 'PushEvent': {
                const branch = cleanRef(p.ref);
                row.kind = 'push';
                row.text = branch ? 'Pushed to ' + branch : 'Pushed commits';
                row.branch = branch;
                row.key = 'push:' + repo + ':' + branch;
                if (SHA_RE.test(p.head || '')) {
                    row.href = (SHA_RE.test(p.before || '') && !/^0+$/.test(p.before))
                        ? base + '/compare/' + p.before + '...' + p.head
                        : base + '/commit/' + p.head;
                }
                break;
            }
            case 'CreateEvent': {
                const ref = cleanRef(p.ref);
                if (p.ref_type === 'repository') {
                    row.kind = 'repo';
                    row.text = 'Created repository';
                } else if (p.ref_type === 'tag' && ref) {
                    row.kind = 'tag';
                    row.text = 'Created tag ' + ref;
                    row.href = base + '/releases/tag/' + refPath(ref);
                } else if (p.ref_type === 'branch' && ref) {
                    row.kind = 'branch';
                    row.text = 'Created branch ' + ref;
                    row.href = base + '/tree/' + refPath(ref);
                } else {
                    return null;
                }
                break;
            }
            case 'DeleteEvent': {
                const ref = cleanRef(p.ref);
                if (!ref || (p.ref_type !== 'branch' && p.ref_type !== 'tag')) return null;
                row.kind = 'remove';
                row.text = 'Deleted ' + p.ref_type + ' ' + ref;
                break;
            }
            case 'WatchEvent':
                row.kind = 'star';
                row.text = 'Starred';
                break;
            case 'ForkEvent':
                row.kind = 'fork';
                row.text = 'Forked';
                break;
            case 'PublicEvent':
                row.kind = 'repo';
                row.text = 'Made public';
                break;
            case 'PullRequestEvent': {
                const pr = (p.pull_request && typeof p.pull_request === 'object') ? p.pull_request : {};
                const num = posInt(p.number) || posInt(pr.number);
                const verbs = { opened: 'Opened', reopened: 'Reopened', closed: pr.merged === true ? 'Merged' : 'Closed', merged: 'Merged' };
                const verb = verbs[p.action];
                if (!verb || !num) return null;
                row.kind = 'pull';
                row.text = verb + ' pull request #' + num;
                row.href = base + '/pull/' + num;
                break;
            }
            case 'PullRequestReviewEvent': {
                const num = posInt(p.pull_request && p.pull_request.number);
                if (!num) return null;
                row.kind = 'pull';
                row.text = 'Reviewed pull request #' + num;
                row.href = base + '/pull/' + num;
                break;
            }
            case 'PullRequestReviewCommentEvent': {
                const num = posInt(p.pull_request && p.pull_request.number);
                if (!num) return null;
                row.kind = 'comment';
                row.text = 'Commented on pull request #' + num;
                row.href = base + '/pull/' + num;
                break;
            }
            case 'IssuesEvent': {
                const num = posInt(p.issue && p.issue.number);
                const verb = { opened: 'Opened', reopened: 'Reopened', closed: 'Closed' }[p.action];
                if (!verb || !num) return null;
                row.kind = 'issue';
                row.text = verb + ' issue #' + num;
                row.href = base + '/issues/' + num;
                break;
            }
            case 'IssueCommentEvent': {
                const num = posInt(p.issue && p.issue.number);
                if (!num) return null;
                row.kind = 'comment';
                row.text = 'Commented on #' + num;
                row.href = base + '/issues/' + num;
                break;
            }
            case 'ReleaseEvent': {
                const tag = cleanRef(p.release && p.release.tag_name);
                if (p.action !== 'published' || !tag) return null;
                row.kind = 'tag';
                row.text = 'Published release ' + tag;
                row.href = base + '/releases/tag/' + refPath(tag);
                break;
            }
            default:
                return null;
        }
        return row;
    }

    /** A burst of pushes to one branch on one day reads as a single line. */
    function groupRows(rows) {
        const out = [];
        rows.forEach((row) => {
            const last = out[out.length - 1];
            if (last && row.key && last.key === row.key && daysBetween(row.at, last.at) === 0) {
                last.n += 1;
                return;
            }
            out.push(Object.assign({}, row));
        });
        out.forEach((row) => {
            if (row.kind === 'push' && row.n > 1) {
                row.text = 'Pushed ' + row.n + ' times' + (row.branch ? ' to ' + row.branch : '');
                row.href = 'https://github.com/' + row.repo + (row.branch ? '/commits/' + refPath(row.branch) : '/commits');
            }
        });
        return out;
    }

    // ------------------------------------------------------------------
    // Session cache
    // ------------------------------------------------------------------

    function readCache(user) {
        try {
            const raw = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
            if (!raw || raw.user !== user) return null;
            const rows = Array.isArray(raw.rows) ? raw.rows.filter((r) =>
                r && typeof r.text === 'string' && typeof r.repo === 'string' && REPO_RE.test(r.repo) &&
                Number.isFinite(r.at) && typeof r.href === 'string' && r.href.indexOf('https://github.com/') === 0
            ) : null;
            return {
                at: Number(raw.at) || 0,
                rows: rows,
                full: raw.full === true,
                blockedUntil: Number(raw.blockedUntil) || 0
            };
        } catch (e) {
            return null;
        }
    }

    function writeCache(user, cache) {
        try {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify({
                user: user, at: cache.at, rows: cache.rows, full: cache.full, blockedUntil: cache.blockedUntil || 0
            }));
        } catch (e) { /* private mode or quota: the window still works, uncached */ }
    }

    // ------------------------------------------------------------------
    // Window
    // ------------------------------------------------------------------

    function initActivityMonitor(win) {
        const root = win.querySelector('.am-app');
        if (!root || root.dataset.init) return;
        root.dataset.init = '1';

        const user = /^[A-Za-z0-9-]{1,39}$/.test(root.dataset.githubUser || '') ? root.dataset.githubUser : '';
        const profileUrl = user ? 'https://github.com/' + user : 'https://github.com/';

        const els = {
            updated: root.querySelector('.am-updated'),
            refresh: root.querySelector('.am-refresh'),
            wrap: root.querySelector('.am-table-wrap'),
            table: root.querySelector('.am-table'),
            rows: root.querySelector('.am-rows'),
            state: root.querySelector('.am-state'),
            graph: root.querySelector('.am-graph'),
            bars: root.querySelector('.am-bars'),
            axisFrom: root.querySelector('.am-axis-from'),
            graphSum: root.querySelector('.am-graph-sum'),
            now: root.querySelector('.am-now'),
            nowArt: root.querySelector('.am-now-art img'),
            nowLabel: root.querySelector('.am-now-label'),
            nowTitle: root.querySelector('.am-now-title'),
            nowBar: root.querySelector('.am-now-bar'),
            online: root.querySelector('.am-online'),
            relay: root.querySelector('.am-relay'),
            relayText: root.querySelector('.am-relay-text'),
            windows: root.querySelector('.am-windows'),
            uptime: root.querySelector('.am-uptime'),
            commitRow: root.querySelector('.am-commit-row'),
            commit: root.querySelector('.am-commit'),
            built: root.querySelector('.am-built')
        };

        let cache = readCache(user) || { at: 0, rows: null, full: false, blockedUntil: 0 };
        let loading = false;
        let problem = '';          // short status-line explanation of the last failure
        let disposed = false;
        let controller = null;
        let lastAttempt = 0;       // last time GitHub was actually asked

        // -------------------- GitHub table --------------------

        function setState(kind, title, text, withRetry) {
            els.state.textContent = '';
            if (!kind) {
                els.state.hidden = true;
                els.table.hidden = false;
                return;
            }
            els.table.hidden = true;
            els.state.hidden = false;

            const box = el('div', 'window-empty');
            if (kind === 'loading') {
                box.setAttribute('role', 'status');
                box.appendChild(el('span', 'mac-spinner'));
                box.appendChild(el('p', 'window-empty-text', title));
            } else {
                if (kind === 'error') box.setAttribute('role', 'alert');
                box.appendChild(el('div', 'window-empty-title', title));
                box.appendChild(el('p', 'window-empty-text', text));
                const actions = el('div', 'window-empty-actions');
                if (withRetry) {
                    const retry = el('button', 'mac-btn', 'Try Again');
                    retry.type = 'button';
                    retry.addEventListener('click', () => load(true));
                    actions.appendChild(retry);
                }
                const link = el('a', 'mac-btn', 'Open GitHub Profile');
                link.href = profileUrl;
                link.target = '_blank';
                link.rel = 'noopener';
                link.dataset.open = 'tab';
                actions.appendChild(link);
                box.appendChild(actions);
            }
            els.state.appendChild(box);
        }

        function externalLink(className, href, text) {
            const a = el('a', className, text);
            a.href = href;
            a.target = '_blank';
            a.rel = 'noopener';
            a.dataset.open = 'tab';
            return a;
        }

        function renderRows() {
            const now = Date.now();
            const frag = document.createDocumentFragment();
            groupRows(cache.rows || []).slice(0, MAX_ROWS).forEach((row) => {
                const tr = document.createElement('tr');
                tr.setAttribute('role', 'row');

                const what = el('td', 'am-cell-what');
                what.setAttribute('role', 'cell');
                const icon = el('span', 'am-kind am-kind-' + (GLYPHS[row.kind] ? row.kind : 'repo'));
                icon.appendChild(glyph(row.kind));
                what.appendChild(icon);
                what.appendChild(externalLink('am-what', row.href, row.text.slice(0, 120)));
                tr.appendChild(what);

                const repo = el('td', 'am-cell-repo');
                repo.setAttribute('role', 'cell');
                repo.appendChild(externalLink('am-repo', 'https://github.com/' + row.repo, row.repo));
                tr.appendChild(repo);

                const when = el('td', 'am-cell-when');
                when.setAttribute('role', 'cell');
                const time = el('time', '', relativeTime(row.at, now));
                time.dateTime = new Date(row.at).toISOString();
                time.title = fullDate(row.at);
                time.dataset.at = String(row.at);
                when.appendChild(time);
                tr.appendChild(when);

                frag.appendChild(tr);
            });
            els.rows.textContent = '';
            els.rows.appendChild(frag);
        }

        function refreshTimes() {
            const now = Date.now();
            els.rows.querySelectorAll('time[data-at]').forEach((time) => {
                const text = relativeTime(Number(time.dataset.at), now);
                if (time.textContent !== text) time.textContent = text;
            });
            renderStatus();
        }

        // -------------------- Graph --------------------

        function renderGraph() {
            const now = Date.now();
            const today = dayStart(now);
            els.bars.textContent = '';
            const first = new Date(today);
            first.setDate(first.getDate() - (GRAPH_DAYS - 1));
            els.axisFrom.textContent = shortDate(first.getTime());

            const rows = cache.rows;
            if (!rows) {
                els.bars.setAttribute('aria-label', 'No activity loaded yet');
                // Say so inside the well rather than leave an empty box
                els.bars.appendChild(el('span', 'am-bars-empty', 'No activity loaded yet'));
                els.graphSum.textContent = '';
                root.classList.add('am-no-graph');
                return;
            }
            root.classList.remove('am-no-graph');

            const counts = new Array(GRAPH_DAYS).fill(0);
            const repos = new Set();
            let total = 0;
            let oldest = now;
            rows.forEach((row) => {
                if (row.at < oldest) oldest = row.at;
                const age = daysBetween(row.at, now);
                if (age < 0 || age >= GRAPH_DAYS) return;
                counts[GRAPH_DAYS - 1 - age] += 1;
                repos.add(row.repo);
                total += 1;
            });
            // A full page means older days may simply not have fitted
            const known = cache.full ? Math.min(GRAPH_DAYS, daysBetween(oldest, now) + 1) : GRAPH_DAYS;
            const peak = Math.max(1, Math.max.apply(null, counts));
            let peakIndex = -1;

            counts.forEach((count, i) => {
                const day = new Date(today);
                day.setDate(day.getDate() - (GRAPH_DAYS - 1 - i));
                const unknown = i < GRAPH_DAYS - known;
                const slot = el('span', 'am-bar-slot');
                slot.dataset.tip = shortDate(day.getTime()) + ' · ' +
                    (unknown ? 'not in the feed' : plural(count, 'event', 'events'));
                slot.dataset.tipPos = 'above';
                if (i < 5) slot.dataset.tipAlign = 'start';
                else if (i >= GRAPH_DAYS - 5) slot.dataset.tipAlign = 'end';
                const bar = el('span', 'am-bar' + (unknown ? ' is-unknown' : count ? '' : ' is-zero'));
                if (count) bar.style.height = Math.max(8, Math.round(count / peak * 100)) + '%';
                slot.appendChild(bar);
                els.bars.appendChild(slot);
                if (count && (peakIndex < 0 || count > counts[peakIndex])) peakIndex = i;
            });

            const span = known < GRAPH_DAYS ? plural(known, 'day', 'days') : GRAPH_DAYS + ' days';
            const summary = total
                ? plural(total, 'event', 'events') + ' in ' + plural(repos.size, 'repository', 'repositories')
                : 'No public activity';
            els.graphSum.textContent = summary + ' · last ' + span;

            let label = summary + ' over the last ' + span + '.';
            if (peakIndex >= 0) {
                const peakDay = new Date(today);
                peakDay.setDate(peakDay.getDate() - (GRAPH_DAYS - 1 - peakIndex));
                label += ' Busiest day: ' + shortDate(peakDay.getTime()) + ' with ' +
                    plural(counts[peakIndex], 'event', 'events') + '.';
            }
            els.bars.setAttribute('aria-label', label);
        }

        // -------------------- Status line --------------------

        function renderStatus() {
            let text = '';
            if (loading) text = 'Checking GitHub…';
            else if (problem) text = problem;
            else if (cache.at) text = 'Updated ' + relativeTime(cache.at, Date.now()).toLowerCase();
            if (els.updated.textContent !== text) els.updated.textContent = text;
            els.refresh.disabled = loading;
        }

        function render() {
            if (cache.rows && cache.rows.length) {
                setState(null);
                renderRows();
            } else if (cache.rows) {
                els.rows.textContent = '';
                setState('empty', 'Nothing in the last 30 days',
                    'GitHub only keeps a month of public events, and there are none for that month.', false);
            }
            renderGraph();
            renderStatus();
        }

        // -------------------- Fetch --------------------

        function fail(title, text, note) {
            // The note ends "· showing saved activity"; with nothing saved the
            // empty state already says what went wrong.
            problem = cache.rows ? note : '';
            if (cache.rows) {
                render();           // keep showing what we have, explain in the status line
            } else if (/rate-limiting/.test(title)) {
                // Nothing saved and GitHub is counting requests: not an error
                // on the visitor's side, so no alert, no retry button, and no
                // empty graph well. The rest of the window (what is playing,
                // who is online, the build) is still worth opening.
                setState('quiet', 'GitHub activity is taking a break', text, false);
                if (els.graph) els.graph.hidden = true;
                renderStatus();
            } else {
                setState('error', title, text, true);
                renderGraph();
                renderStatus();
            }
        }

        function load(manual) {
            if (loading || disposed) return;
            if (!user) {
                fail('GitHub activity is unavailable', 'No GitHub account is configured for this site.', '');
                return;
            }

            const now = Date.now();
            if (cache.blockedUntil > now) {
                const until = clock(cache.blockedUntil);
                fail('GitHub is rate-limiting this network',
                    'GitHub allows a limited number of anonymous requests per hour from one network. It will answer again after ' + until + '.',
                    cache.rows ? 'Rate limited until ' + until + ' · showing saved activity' : '');
                return;
            }
            if (!manual && cache.rows && now - cache.at < CACHE_TTL_MS) {
                problem = '';
                render();
                return;
            }

            loading = true;
            lastAttempt = now;
            if (!cache.rows) setState('loading', 'Loading activity…');
            renderStatus();

            controller = ('AbortController' in window) ? new AbortController() : null;
            const timeout = setTimeout(() => { if (controller) controller.abort(); }, 15000);

            fetch('https://api.github.com/users/' + encodeURIComponent(user) + '/events/public?per_page=' + PER_PAGE, {
                signal: controller ? controller.signal : undefined,
                credentials: 'omit',
                referrerPolicy: 'no-referrer'
            }).then((res) => {
                if (res.status === 403 || res.status === 429) {
                    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
                    const retryAfter = Number(res.headers.get('retry-after')) * 1000;
                    const until = reset > Date.now() ? reset
                        : Date.now() + (retryAfter > 0 ? retryAfter : 15 * 60 * 1000);
                    const err = new Error('rate-limited');
                    err.blockedUntil = Math.min(until, Date.now() + 60 * 60 * 1000);
                    throw err;
                }
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            }).then((data) => {
                if (disposed) return;
                if (!Array.isArray(data)) throw new Error('Unexpected response');
                const rows = data.map(normalizeEvent).filter(Boolean).sort((a, b) => b.at - a.at);
                cache = { at: Date.now(), rows: rows, full: data.length >= PER_PAGE, blockedUntil: 0 };
                writeCache(user, cache);
                problem = '';
                loading = false;
                if (els.graph) els.graph.hidden = false;
                render();
            }).catch((err) => {
                if (disposed) return;
                loading = false;
                if (err && err.blockedUntil) {
                    cache.blockedUntil = err.blockedUntil;
                    writeCache(user, cache);
                    const until = clock(err.blockedUntil);
                    fail('GitHub is rate-limiting this network',
                        'GitHub allows a limited number of anonymous requests per hour from one network. It will answer again after ' + until + '.',
                        'Rate limited until ' + until + ' · showing saved activity');
                } else if (navigator.onLine === false) {
                    fail('You are offline', 'Recent activity will load once the connection is back.',
                        'Offline · showing saved activity');
                } else {
                    fail('Could not reach GitHub', 'The request for recent activity did not go through.',
                        'Could not reach GitHub · showing saved activity');
                }
            }).finally(() => {
                clearTimeout(timeout);
                controller = null;
            });
        }

        function onRefresh() {
            if (window.track) window.track('activity_refresh');
            load(true);
        }
        els.refresh.addEventListener('click', onRefresh);

        // -------------------- Now playing --------------------

        let unsubMusic = null;
        let unsubMusicTime = null;
        let lastArt = null;

        function syncMusic(snap) {
            const track = snap && snap.playing ? snap.track : null;
            const title = track && typeof track.title === 'string' ? track.title.slice(0, 120) : '';
            const artist = track && typeof track.artist === 'string' ? track.artist.slice(0, 80) : '';

            root.classList.toggle('am-is-playing', !!title);
            els.nowLabel.textContent = title ? 'Now playing' : 'Music';
            els.nowTitle.textContent = title ? (artist ? title + ' – ' + artist : title) : 'Nothing playing';
            els.now.setAttribute('aria-label', title
                ? 'Now playing: ' + title + (artist ? ' by ' + artist : '') + '. Open Music'
                : 'Nothing playing. Open Music');
            els.nowBar.hidden = !title;

            // Only the covers shipped with the site - never a third-party image
            const art = title && typeof track.thumb === 'string' && track.thumb.indexOf('/music/covers/') === 0
                ? track.thumb : '';
            if (art !== lastArt) {
                lastArt = art;
                if (art) els.nowArt.src = art;
                else els.nowArt.removeAttribute('src');
                els.nowArt.hidden = !art;
            }
            if (title) syncMusicTime(snap);
        }

        function syncMusicTime(time) {
            const pct = time && time.duration > 0 ? Math.min(100, Math.max(0, time.currentTime / time.duration * 100)) : 0;
            els.nowBar.firstElementChild.style.width = pct.toFixed(1) + '%';
        }

        function attachMusic() {
            const music = window.SiteMusic;
            if (unsubMusic || !music || typeof music.on !== 'function' || typeof music.snapshot !== 'function') return;
            unsubMusic = music.on(syncMusic);
            if (typeof music.onTime === 'function') unsubMusicTime = music.onTime(syncMusicTime);
            syncMusic(music.snapshot());
        }

        function onNowClick() {
            if (typeof window.openWindow === 'function') window.openWindow('music', 'Music');
        }
        els.now.addEventListener('click', onNowClick);

        // -------------------- Visitors, relay, windows, session --------------------

        let pillObserver = null;
        let unsubRelay = null;

        function syncOnline(pill) {
            const match = /^\s*(\d{1,5})\b/.exec(pill.textContent || '');
            els.online.textContent = match ? match[1] : '–';
        }

        function attachOnline() {
            if (pillObserver) return;
            const pill = document.getElementById('online-count');
            if (!pill || !('MutationObserver' in window)) return;
            pillObserver = new MutationObserver(() => syncOnline(pill));
            pillObserver.observe(pill, { childList: true, characterData: true, subtree: true });
            syncOnline(pill);
        }

        function syncRelay(connected) {
            els.relay.classList.toggle('is-up', !!connected);
            els.relayText.textContent = connected ? 'Connected' : 'Offline';
        }

        function attachRelay() {
            if (unsubRelay || !window.SiteGun || typeof window.SiteGun.getConnection !== 'function') return;
            try {
                unsubRelay = window.SiteGun.getConnection().onChange(syncRelay);
            } catch (e) { /* relay bundle not usable: the row keeps saying so */ }
        }

        const startedAt = Date.now() - (window.performance && performance.now ? performance.now() : 0);
        let ticks = 0;

        function tick() {
            if (document.hidden) return;
            ticks += 1;
            els.uptime.textContent = duration(Date.now() - startedAt);

            const open = document.querySelectorAll('#windows-container .window:not(.closing)').length;
            const openText = String(open);
            if (els.windows.textContent !== openText) els.windows.textContent = openText;

            // These arrive whenever their own bundles do
            if (!unsubMusic) attachMusic();
            if (!pillObserver) attachOnline();
            if (!unsubRelay) attachRelay();

            if (ticks % 30 === 0) {
                refreshTimes();
                const shown = !win.classList.contains('minimized') && win.style.display !== 'none';
                const now = Date.now();
                if (shown && !loading && cache.blockedUntil <= now &&
                    now - Math.max(cache.at, lastAttempt) >= CACHE_TTL_MS) load(false);
            }
        }

        // -------------------- Build --------------------

        function renderBuild() {
            const hash = document.querySelector('meta[name="git-commit-hash"]');
            const sha = hash && SHA_RE.test(hash.content) ? hash.content : '';
            const repoUrl = root.dataset.repo || '';
            if (sha && repoUrl.indexOf('https://github.com/') === 0) {
                els.commit.textContent = sha.slice(0, 7);
                els.commit.href = repoUrl + '/commit/' + sha;
                els.commitRow.hidden = false;
            }
            const built = Date.parse(root.dataset.built || '');
            if (Number.isFinite(built)) {
                els.built.textContent = '';
                const time = el('time', '', shortDate(built) + ', ' + new Date(built).getFullYear());
                time.dateTime = new Date(built).toISOString();
                time.title = fullDate(built);
                els.built.appendChild(time);
            }
        }

        // -------------------- Boot --------------------

        renderBuild();
        renderGraph();
        syncMusic(null);
        tick();
        const timer = setInterval(tick, 1000);
        load(false);

        win.activityCleanup = function () {
            disposed = true;
            clearInterval(timer);
            if (controller) controller.abort();
            if (unsubMusic) unsubMusic();
            if (unsubMusicTime) unsubMusicTime();
            if (pillObserver) pillObserver.disconnect();
            if (typeof unsubRelay === 'function') unsubRelay();
            els.refresh.removeEventListener('click', onRefresh);
            els.now.removeEventListener('click', onNowClick);
        };
    }

    window.initActivityMonitor = initActivityMonitor;
})();
