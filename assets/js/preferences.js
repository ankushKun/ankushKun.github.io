/**
 * System Preferences
 *
 * The window body (layouts/partials/apps/preferences/window.html) is rendered
 * at build time; this file wires it to window.SitePrefs, the small store the
 * <head> bootstrap provides (layouts/partials/os/prefs-bootstrap.html). Every
 * control writes through SitePrefs.set(), which saves to localStorage
 * ("site-prefs-v1"), re-applies the attributes on <html> and fires "site:prefs";
 * this window listens for that event too, so it stays in step with changes
 * made in another tab or from elsewhere on the page.
 *
 * Lazy-loaded by the shell (LAZY_APPS in mavericks.js): initPreferences(win)
 * runs when the window opens and win.preferencesCleanup() when it closes.
 */
(function () {
    'use strict';

    const PANES = ['appearance', 'desktop', 'sound', 'accessibility'];
    const GENERAL_KEYS = ['appearance', 'accent', 'chrome'];

    function track(name, props) {
        try { if (typeof window.track === 'function') window.track(name, props); } catch (e) { /* analytics is optional */ }
    }

    function initPreferences(win) {
        const root = win.querySelector('.sp-window');
        if (!root || root.dataset.init) return;
        root.dataset.init = '1';

        const prefs = window.SitePrefs;
        const body = root.querySelector('.sp-body');
        if (!prefs || typeof prefs.set !== 'function') {
            body.textContent = '';
            const note = document.createElement('p');
            note.className = 'sp-footnote';
            note.textContent = 'Preferences could not be loaded. Reload the page to try again.';
            body.appendChild(note);
            return;
        }

        const titleEl = root.querySelector('.sp-title');
        const appTitle = titleEl.textContent || 'System Preferences';
        const backBtn = root.querySelector('.sp-back');
        const fwdBtn = root.querySelector('.sp-forward');
        const panels = Array.from(root.querySelectorAll('[data-view-panel]'));
        const cleanups = [];

        function on(target, type, fn, opts) {
            target.addEventListener(type, fn, opts);
            cleanups.push(() => target.removeEventListener(type, fn, opts));
        }

        // ---------- Navigation: Show All, panes, back/forward ----------

        const history = ['overview'];
        let at = 0;
        let lastPane = null;

        function show(view, opts) {
            const options = opts || {};
            if (view !== 'overview' && PANES.indexOf(view) === -1) return;
            panels.forEach((p) => { p.hidden = p.dataset.viewPanel !== view; });
            root.dataset.view = view;
            const panel = panels.find((p) => p.dataset.viewPanel === view);
            const name = view === 'overview' ? appTitle : (panel.dataset.title || appTitle);
            // The pane name shows in the toolbar; the window keeps its own
            // title, which the menu bar and the Window menu use
            titleEl.textContent = name;

            if (options.push !== false && history[at] !== view) {
                history.splice(at + 1);
                history.push(view);
                at = history.length - 1;
            }
            backBtn.disabled = at <= 0;
            fwdBtn.disabled = at >= history.length - 1;

            if (view === 'desktop') revealCurrentWallpaper();

            if (options.focus !== false) {
                if (view === 'overview') {
                    const btn = lastPane && root.querySelector('[data-open-pane="' + lastPane + '"]');
                    (btn || root.querySelector('.sp-pane-btn')).focus();
                } else {
                    const first = panel.querySelector('[role="radio"][tabindex="0"], [role="tab"][aria-selected="true"], input:not(:disabled), button:not(:disabled)');
                    if (first) first.focus();
                }
            }
            if (view !== 'overview') {
                lastPane = view;
                track('preferences_pane', { pane: view });
            }
        }

        on(root, 'click', (e) => {
            const paneBtn = e.target.closest('[data-open-pane]');
            if (paneBtn) show(paneBtn.dataset.openPane);
        });
        on(root.querySelector('.sp-showall'), 'click', () => show('overview'));
        on(backBtn, 'click', () => { if (at > 0) { at--; show(history[at], { push: false }); } });
        on(fwdBtn, 'click', () => { if (at < history.length - 1) { at++; show(history[at], { push: false }); } });

        // Cmd/Ctrl+[ and ] step through history, Cmd/Ctrl+L shows all
        on(root, 'keydown', (e) => {
            if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
            if (e.key === '[') { e.preventDefault(); backBtn.click(); }
            else if (e.key === ']') { e.preventDefault(); fwdBtn.click(); }
            else if (e.key === 'l' || e.key === 'L') { e.preventDefault(); show('overview'); }
        });

        // ---------- Radio groups (tiles, swatches, thumbnails) ----------

        const groups = Array.from(root.querySelectorAll('[role="radiogroup"][data-pref]'));

        function radiosOf(group) {
            return Array.from(group.querySelectorAll('[role="radio"]'));
        }

        function syncGroup(group) {
            const value = prefs.get(group.dataset.pref);
            const radios = radiosOf(group);
            if (radios.length) {
                let any = false;
                radios.forEach((r) => {
                    const checked = r.dataset.value === value;
                    any = any || checked;
                    r.setAttribute('aria-checked', checked ? 'true' : 'false');
                    r.tabIndex = checked ? 0 : -1;
                });
                // Keep one stop in the tab order even when nothing here is chosen
                if (!any) radios[0].tabIndex = 0;
            } else {
                group.querySelectorAll('input[type="radio"]').forEach((input) => {
                    input.checked = input.value === value;
                });
            }
        }

        function choose(key, value) {
            if (prefs.get(key) === value) return;
            if (prefs.set(key, value)) track('preferences_change', { key: key, value: String(value) });
        }

        groups.forEach((group) => {
            on(group, 'click', (e) => {
                const radio = e.target.closest('[role="radio"]');
                if (radio && group.contains(radio)) choose(group.dataset.pref, radio.dataset.value);
            });
            on(group, 'change', (e) => {
                if (e.target.type === 'radio' && e.target.checked) choose(group.dataset.pref, e.target.value);
            });
            on(group, 'keydown', (e) => {
                const radios = radiosOf(group);
                const i = radios.indexOf(document.activeElement);
                if (i === -1) return;
                let next = -1;
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % radios.length;
                else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + radios.length) % radios.length;
                else if (e.key === 'Home') next = 0;
                else if (e.key === 'End') next = radios.length - 1;
                else if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    choose(group.dataset.pref, radios[i].dataset.value);
                    return;
                }
                if (next === -1) return;
                e.preventDefault();
                radios[next].focus();
                choose(group.dataset.pref, radios[next].dataset.value);
            });
        });

        // ---------- Desktop: collections and the current picture ----------

        const sources = Array.from(root.querySelectorAll('.sp-source'));
        const sets = Array.from(root.querySelectorAll('.sp-thumbs[data-set]'));
        const currentPic = root.querySelector('.sp-current-pic');
        const currentName = root.querySelector('.sp-current-name');
        const currentKind = root.querySelector('.sp-current-kind');

        function selectSource(name, focus) {
            sources.forEach((s) => {
                const selected = s.dataset.source === name;
                s.setAttribute('aria-selected', selected ? 'true' : 'false');
                s.tabIndex = selected ? 0 : -1;
                if (selected && focus) s.focus();
            });
            sets.forEach((set) => { set.hidden = set.dataset.set !== name; });
        }

        function revealCurrentWallpaper() {
            const wp = prefs.resolved().wallpaper;
            selectSource(wp && wp.src ? 'pictures' : 'colors', false);
        }

        sources.forEach((s) => {
            on(s, 'click', () => selectSource(s.dataset.source, false));
            on(s, 'keydown', (e) => {
                const i = sources.indexOf(s);
                let next = -1;
                if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (i + 1) % sources.length;
                else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (i - 1 + sources.length) % sources.length;
                if (next === -1) return;
                e.preventDefault();
                selectSource(sources[next].dataset.source, true);
            });
        });

        function syncCurrentWallpaper() {
            const wp = prefs.resolved().wallpaper;
            if (!wp) return;
            currentPic.style.backgroundColor = wp.color;
            currentPic.style.backgroundImage = wp.src ? 'url("/wallpapers/thumbs/' + wp.id + '.webp")' : 'none';
            currentName.textContent = wp.name;
            currentKind.textContent = wp.src ? 'Desktop Picture' : 'Solid Colour';
        }

        // ---------- Sound ----------

        const uiSounds = root.querySelector('.sp-ui-sounds');
        const sound = window.SiteSound;
        if (uiSounds && sound && typeof sound.isMuted === 'function') {
            const syncSound = () => { uiSounds.checked = !sound.isMuted(); };
            on(uiSounds, 'change', () => {
                sound.setMuted(!uiSounds.checked);
                track('preferences_change', { key: 'sound', value: uiSounds.checked ? 'on' : 'off' });
            });
            on(document, 'site-sound-change', syncSound);
            syncSound();
        } else if (uiSounds) {
            uiSounds.closest('.sp-row').hidden = true;
        }

        const openMusic = root.querySelector('.sp-open-music');
        const shell = window.SiteShell;
        if (openMusic && shell && typeof shell.openApp === 'function' && shell.resolveApp && shell.resolveApp('music')) {
            on(openMusic, 'click', () => shell.openApp('music', openMusic, 'preferences'));
        } else if (openMusic) {
            openMusic.closest('.sp-row').hidden = true;
        }

        // ---------- Accessibility: motion and contrast ----------

        const systemQueries = {
            motion: window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null,
            contrast: window.matchMedia ? window.matchMedia('(prefers-contrast: more)') : null
        };
        const toggles = Array.from(root.querySelectorAll('[data-pref-toggle]'));

        function syncToggle(input) {
            const key = input.dataset.prefToggle;
            const help = input.closest('.sp-field').querySelector('.sp-help');
            const system = systemQueries[key] && systemQueries[key].matches;
            if (!help.dataset.text) help.dataset.text = help.textContent;
            // When the device already asks for it, it is on whatever is saved here
            input.checked = system || prefs.get(key) === input.dataset.on;
            input.disabled = !!system;
            help.textContent = system ? 'On, because your device asks for it in its own settings.' : help.dataset.text;
        }

        toggles.forEach((input) => {
            on(input, 'change', () => {
                choose(input.dataset.prefToggle, input.checked ? input.dataset.on : input.dataset.off);
            });
            const query = systemQueries[input.dataset.prefToggle];
            if (query) {
                const onQuery = () => syncToggle(input);
                if (query.addEventListener) {
                    query.addEventListener('change', onQuery);
                    cleanups.push(() => query.removeEventListener('change', onQuery));
                }
            }
        });

        // ---------- General: Restore Defaults ----------

        on(root.querySelector('.sp-restore'), 'click', () => {
            GENERAL_KEYS.forEach((key) => prefs.set(key, null));
            track('preferences_change', { key: 'general', value: 'defaults' });
        });

        // ---------- Keep everything in step with the store ----------

        function syncAll() {
            groups.forEach(syncGroup);
            toggles.forEach(syncToggle);
            syncCurrentWallpaper();
        }

        // Every change, including one made in another tab (key '*')
        const unsubscribe = typeof prefs.subscribe === 'function' ? prefs.subscribe(syncAll) : function () { };

        // SitePrefs.openPane() while the window is open, or before it was ready
        on(document, 'site:prefs-pane', (e) => {
            const pane = e.detail && e.detail.pane;
            if (pane) { show(pane); prefs.pendingPane = ''; }
        });

        syncAll();
        const pending = prefs.pendingPane;
        prefs.pendingPane = '';
        show(PANES.indexOf(pending) !== -1 ? pending : 'overview', { focus: false });

        win.preferencesCleanup = function () {
            unsubscribe();
            cleanups.splice(0).forEach((fn) => fn());
        };
    }

    window.initPreferences = initPreferences;
})();
