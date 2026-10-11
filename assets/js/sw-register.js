/*
 * Service worker registration, kill switch and "new version" notice.
 *
 * Inlined into every page by layouts/partials/sw/register.html, which sets
 * window.SW_CONFIG = { marker: "sw-build:<build id>", enabled, url, kill }.
 * The worker itself is layouts/index.sw.js (/sw.js). Owner notes, including
 * how to switch it all off: docs/service-worker.md.
 *
 * - Registers only when enabled (production build, not switched off in
 *   hugo.toml), on https or localhost, after load once the browser is idle.
 * - Kill switch: when /sw-disabled.txt exists, or the build has the worker
 *   off, every registration of this origin is removed and its caches deleted.
 * - Updates: a new worker waits. If this is the only tab and it already shows
 *   the new build, it takes over silently. Otherwise a notification offers a
 *   reload; clicking it activates the new worker and reloads, so a page never
 *   runs on one build while the worker serves another.
 */
(function () {
    'use strict';

    var cfg = window.SW_CONFIG || {};
    var sw = navigator.serviceWorker;
    if (!sw || !cfg.marker) return;

    // marker is "sw-build:<id>"; that prefix is spelled out nowhere else in
    // the page, so the worker's search for it can only hit the config
    var BUILD = String(cfg.marker).split(':')[1] || '';
    var PREFIX = 'ankush-sw-';
    var CHECK_KEY = 'sw-kill-check';           // sessionStorage: { at, off }
    var CHECK_ON_FOR = 10 * 60 * 1000;         // a "switched off" answer is trusted this long
    var CHECK_OFF_FOR = 60 * 1000;             // a "not switched off" answer only this long
    var UPDATE_EVERY = 30 * 60 * 1000;

    var host = location.hostname;
    var local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    if (location.protocol !== 'https:' && !local) return;

    var reg = null;
    var expecting = null;   // 'claim' | 'silent' | 'reload' while a controller change is ours
    var noticeShown = false;
    var lastUpdate = Date.now();

    function buildTime(id) { return parseInt(id, 10) || 0; }

    /** Post a message to a worker and wait (briefly) for its reply. */
    function ask(worker, message) {
        return new Promise(function (resolve) {
            if (!worker || !window.MessageChannel) { resolve(null); return; }
            var channel = new window.MessageChannel();
            var timer = setTimeout(function () { resolve(null); }, 3000);
            channel.port1.onmessage = function (e) { clearTimeout(timer); resolve(e.data || null); };
            try { worker.postMessage(message, [channel.port2]); } catch (e) { clearTimeout(timer); resolve(null); }
        });
    }

    // ------------------------------------------------------------ kill switch

    function clearCaches() {
        if (!window.caches) return Promise.resolve();
        return window.caches.keys().then(function (keys) {
            return Promise.all(keys.filter(function (k) { return k.indexOf(PREFIX) === 0; })
                .map(function (k) { return window.caches.delete(k); }));
        }).catch(function () { /* storage blocked */ });
    }

    function teardown() {
        if (sw.controller) {
            try { sw.controller.postMessage({ type: 'KILL' }); } catch (e) { /* gone already */ }
        }
        return sw.getRegistrations().then(function (regs) {
            return Promise.all(regs.map(function (r) { return r.unregister(); }));
        }).catch(function () { /* nothing registered */ }).then(clearCaches).then(function () {
            // Once more, after anything the old worker still had in flight
            setTimeout(clearCaches, 4000);
        });
    }

    /** true when /sw-disabled.txt exists. A HEAD request (no body); a "no"
     * is remembered for a minute per tab, a "yes" for ten. The worker also
     * asks on every page load it serves, so a switch-off acts on the next
     * page load either way. */
    function killSwitchOn() {
        var memo = null;
        try { memo = JSON.parse(sessionStorage.getItem(CHECK_KEY)); } catch (e) { /* blocked */ }
        var age = memo ? Date.now() - memo.at : Infinity;
        if (age >= 0 && age < (memo && memo.off ? CHECK_ON_FOR : CHECK_OFF_FOR)) return Promise.resolve(!!memo.off);
        return fetch(cfg.kill, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' }).then(function (res) {
            // A host that answers every path with an HTML page must not trip it
            var off = res.status === 200 && !/html/i.test(res.headers.get('content-type') || '');
            try { sessionStorage.setItem(CHECK_KEY, JSON.stringify({ at: Date.now(), off: off })); } catch (e) { /* blocked */ }
            return off;
        }, function () {
            return false; // offline: leave whatever is installed alone
        });
    }

    // ------------------------------------------------------------ update notice

    function noticeIcon() {
        try {
            var apps = JSON.parse(document.getElementById('app-registry').textContent);
            for (var i = 0; i < apps.length; i++) {
                if (apps[i].id === 'software-update' && apps[i].iconHtml) {
                    return apps[i].iconHtml.replace('app-icon-spotlight', 'app-icon-notification');
                }
            }
        } catch (e) { /* no registry on this page */ }
        return '';
    }

    /** worker: the waiting worker to activate on click (null = just reload). */
    function showNotice(worker) {
        if (noticeShown || typeof window.showNotification !== 'function') return;
        noticeShown = true;
        window.showNotification({
            title: 'Website Update',
            message: 'A new version of this site is ready. Click to reload.',
            iconHtml: noticeIcon(),
            duration: 0,
            sound: false,
            onClick: function () {
                if (worker && worker.state === 'installed') {
                    expecting = 'reload';
                    worker.postMessage({ type: 'SKIP_WAITING' });
                    // Reloads on controllerchange; this is the safety net
                    setTimeout(function () { location.reload(); }, 4000);
                } else {
                    location.reload();
                }
            }
        });
    }

    function onWaiting(worker) {
        if (noticeShown || !worker) return;
        expecting = 'silent';
        ask(worker, { type: 'ACTIVATE_IF_ALONE', build: BUILD }).then(function (reply) {
            if (reply && reply.activated) return;
            expecting = null;
            showNotice(worker);
        });
    }

    function watch(r) {
        if (r.waiting && sw.controller) onWaiting(r.waiting);
        r.addEventListener('updatefound', function () {
            var w = r.installing;
            if (!w) return;
            w.addEventListener('statechange', function () {
                if (w.state === 'installed' && sw.controller && r.waiting === w) onWaiting(w);
            });
        });
    }

    sw.addEventListener('controllerchange', function () {
        if (expecting === 'reload') { expecting = 'done'; location.reload(); return; }
        if (expecting === 'done') return;
        if (expecting === 'silent' || expecting === 'claim') { expecting = null; return; }
        // Another tab moved the site on to a newer worker than this page's build
        ask(sw.controller, { type: 'HELLO', build: BUILD }).then(function (reply) {
            if (reply && reply.build && buildTime(reply.build) > buildTime(BUILD)) showNotice(null);
        });
    });

    // ------------------------------------------------------------ register

    function register() {
        sw.register(cfg.url, { scope: '/', updateViaCache: 'none' }).then(function (r) {
            reg = r;
            watch(r);
            if (sw.controller) {
                // Tells the worker which build this page is (a newer page
                // makes an old worker stop serving unhashed files from cache)
                ask(sw.controller, { type: 'HELLO', build: BUILD });
            } else {
                // First install: the worker takes this page over only if both
                // come from the same build
                sw.ready.then(function (ready) {
                    if (sw.controller || !ready.active) return;
                    expecting = 'claim';
                    ask(ready.active, { type: 'CLAIM', build: BUILD }).then(function () {
                        if (expecting === 'claim') expecting = null;
                    });
                });
            }
        }).catch(function () {
            // Private mode, blocked or offline: leave things alone. But if the
            // server positively has no worker any more (/sw.js deleted or
            // answered by an HTML page), remove the old one and its caches
            // rather than let it serve an old deploy for ever.
            return fetch(cfg.url, { cache: 'no-store', credentials: 'same-origin' }).then(function (res) {
                var gone = res.status === 404 || res.status === 410 ||
                    (res.ok && !/javascript|ecmascript/i.test(res.headers.get('content-type') || ''));
                if (gone) teardown();
            }, function () { /* offline */ });
        });

        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState !== 'visible' || !reg || Date.now() - lastUpdate < UPDATE_EVERY) return;
            lastUpdate = Date.now();
            killSwitchOn().then(function (off) {
                if (off) teardown();
                else reg.update().catch(function () { /* offline */ });
            });
        });
    }

    function start() {
        if (!cfg.enabled) { teardown(); return; }
        killSwitchOn().then(function (off) {
            if (off) return teardown();
            // Controlled by a worker that has no registration any more: it
            // retired itself on this page load (it saw the kill file, or the
            // deploy has no worker). Registering now would undo that.
            if (sw.controller) {
                return sw.getRegistration().then(function (r) {
                    if (r) register();
                    else clearCaches();
                }, register);
            }
            return register();
        });
    }

    function whenIdle() {
        if (window.requestIdleCallback) requestIdleCallback(start, { timeout: 5000 });
        else setTimeout(start, 1000);
    }
    if (document.readyState === 'complete') whenIdle();
    else window.addEventListener('load', whenIdle);

    window.SiteServiceWorker = {
        build: BUILD,
        registration: function () { return reg; }
    };
})();
