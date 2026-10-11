(function () {
    'use strict';

    const MAX_LINES = 7;
    const LINE_HEIGHT = 22;
    const TEXT_DEBOUNCE_MS = 400;
    const DRAG_PUT_MS = 80;
    const REMOTE_MOVE_MS = 120;
    const FLY_SCALE = 0.08;
    const FLY_MS = 320;
    const SYNCED_HOLD_MS = 3000;
    const LAST_EDIT_TICK_MS = 30_000;
    const MAX_TEXT = 600;            // far more than 7 lines can show
    const EMPTY_NODE_GRACE_MS = 4000;
    const GLIDE_MS = 480;            // a correction of more than a nudge
    const GLIDE_MIN_PX = 40;
    const REVEAL_MS = 260;
    const REVEAL_FALLBACK_MS = 2500; // relay slow or down: show it anyway
    const CACHE_KEY = 'sticky_cache';
    const DEFAULTS = { x: 0.72, y: 0.12, text: '', textTs: 0, moveTs: 0 };

    // The note is one node anyone can write to, so nothing a peer sends is
    // used before it has been bounded.
    const clamp01 = (v, fallback) =>
        Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
    const cleanText = (v) => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : '');
    // A timestamp from the future would otherwise outrank every later edit.
    const cleanTs = (v) => Math.min(Number(v) || 0, Date.now());

    // Storage may be blocked entirely; the note must still work.
    const store = {
        get(key) {
            try {
                const s = window.SiteGun && window.SiteGun.store;
                return s ? s.get(key) : localStorage.getItem(key);
            } catch (e) { return null; }
        },
        set(key, value) {
            try {
                const s = window.SiteGun && window.SiteGun.store;
                if (s) s.set(key, value); else localStorage.setItem(key, value);
            } catch (e) { /* ignore */ }
        },
        remove(key) {
            try {
                const s = window.SiteGun && window.SiteGun.store;
                if (s) s.remove(key); else localStorage.removeItem(key);
            } catch (e) { /* ignore */ }
        }
    };

    const note = document.getElementById('desktop-sticky-note');
    const menubarToggle = document.getElementById('menubar-sticky-toggle');
    if (!note) return;

    const desktop = document.getElementById('desktop');
    const titlebar = note.querySelector('.sticky-titlebar');
    const closeBtn = note.querySelector('.sticky-close');
    const body = note.querySelector('.sticky-body');
    const statusEl = note.querySelector('.sticky-status');

    const isMobile = () => window.matchMedia('(max-width: 768px)').matches;
    const canEdit = () => !isMobile();

    let ref = null;
    let localState = { ...DEFAULTS };
    let isEditing = false;
    let isDragging = false;
    let isAnimating = false;
    let isCollapsed = false;
    let textTimer = null;
    let lastDragPut = 0;
    let remoteMoveTimer = null;
    let statusTimer = null;
    let lastEditTickTimer = null;
    let statusMode = 'lastEdit';
    let initialized = false;
    let isOffline = false;
    // True once the shared note has really arrived (or the relay answered and
    // there is no note yet). Text is never published before that.
    let loaded = false;
    let loadGraceTimer = null;
    let lastRemote = null;

    body.style.height = (MAX_LINES * LINE_HEIGHT) + 'px';

    const reducedMotion = () =>
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // The last note this browser saw, so a returning visitor gets it in the
    // right place straight away instead of the default spot and then a jump.
    // It is only ever a starting point: the relay's copy always wins.
    function readCache() {
        try {
            const data = JSON.parse(store.get(CACHE_KEY) || 'null');
            return data && typeof data === 'object' ? sanitize(data) : null;
        } catch (e) { return null; }
    }

    let cacheTimer = null;
    function saveCache() {
        clearTimeout(cacheTimer);
        cacheTimer = setTimeout(() => {
            const { x, y, text, textTs, moveTs } = localState;
            store.set(CACHE_KEY, JSON.stringify({ x, y, text, textTs, moveTs }));
        }, 300);
    }

    // First visit: nothing cached, so the note stays invisible until the real
    // one arrives (or the relay takes too long) and then fades in where it lives.
    let awaiting = false;
    let revealTimer = null;
    function holdUntilLoaded() {
        awaiting = true;
        note.classList.add('is-awaiting');
        revealTimer = setTimeout(reveal, REVEAL_FALLBACK_MS);
    }

    function reveal() {
        if (!awaiting) return;
        awaiting = false;
        clearTimeout(revealTimer);
        if (reducedMotion()) {
            note.classList.remove('is-awaiting');
            return;
        }
        note.classList.add('is-revealing');
        note.classList.remove('is-awaiting');
        setTimeout(() => note.classList.remove('is-revealing'), REVEAL_MS + 40);
    }

    function waitSiteGun() {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            (function wait() {
                if (window.SiteGun) return resolve();
                if (++attempts > 100) return reject(new Error('SiteGun unavailable'));
                setTimeout(wait, 50);
            })();
        });
    }

    function setStatus(msg) {
        if (!statusEl) return;
        statusEl.textContent = msg || '';
    }

    function clearStatusTimers() {
        clearTimeout(statusTimer);
        statusTimer = null;
        clearInterval(lastEditTickTimer);
        lastEditTickTimer = null;
    }

    function formatRelativeAgo(ts) {
        if (!ts) return '';
        const ago = Math.max(0, Date.now() - ts);
        if (ago < 60_000) return 'now';
        const mins = Math.floor(ago / 60_000);
        if (mins < 60) return `${mins}m ago`;
        const weeks = Math.floor(ago / (86_400_000 * 7));
        if (weeks >= 1) {
            const years = Math.floor(ago / (86_400_000 * 365));
            if (years >= 1) return `${years}y ago`;
            const months = Math.floor(ago / (86_400_000 * 30));
            if (months >= 1) return `${months}mo ago`;
            return `${weeks}w ago`;
        }
        const days = Math.floor(ago / 86_400_000);
        return `${Math.max(1, days)}d ago`;
    }

    function lastEditLabel() {
        const rel = formatRelativeAgo(localState.textTs);
        return rel ? `last edit ${rel}` : '';
    }

    function showLastEdit(force) {
        if (isNoteCollapsed()) return;
        if (isOffline) return;
        if (!force && isEditing) return;
        clearStatusTimers();
        statusMode = 'lastEdit';
        setStatus(lastEditLabel());
        lastEditTickTimer = setInterval(() => {
            if (statusMode === 'lastEdit' && !isEditing) setStatus(lastEditLabel());
        }, LAST_EDIT_TICK_MS);
    }

    function showSynced() {
        if (isNoteCollapsed()) return;
        if (isOffline) return;
        clearStatusTimers();
        statusMode = 'synced';
        setStatus('Synced');
        statusTimer = setTimeout(() => showLastEdit(true), SYNCED_HOLD_MS);
    }

    function showEditing() {
        // Keep "Offline" visible - "Editing…" would imply the edit is syncing.
        if (isOffline) return;
        clearStatusTimers();
        statusMode = 'editing';
        setStatus('Editing…');
    }

    // Report the real relay state. Previously "Offline" only appeared if the
    // SiteGun script itself failed to load, never when the relay was down.
    function watchConnection() {
        if (!window.SiteGun.getConnection) return;
        window.SiteGun.getConnection().onChange((connected) => {
            isOffline = !connected;
            clearTimeout(loadGraceTimer);
            if (connected && !loaded) {
                // A relay that is up but sends nothing has no note stored
                // yet, so the first edit is allowed to create it.
                loadGraceTimer = setTimeout(() => {
                    if (!isOffline) loaded = true;
                }, EMPTY_NODE_GRACE_MS);
            }
            if (isNoteCollapsed()) return;
            if (!connected) {
                clearStatusTimers();
                statusMode = 'offline';
                setStatus('Offline');
            } else if (statusMode === 'offline') {
                showLastEdit(true);
            }
        });
    }

    function showMenubarIcon() {
        if (!menubarToggle) return;
        menubarToggle.removeAttribute('hidden');
        menubarToggle.classList.add('is-available');
    }

    function hideMenubarIcon() {
        if (!menubarToggle) return;
        menubarToggle.setAttribute('hidden', '');
        menubarToggle.classList.remove('is-available');
    }

    function isNoteCollapsed() {
        return isCollapsed || store.get('sticky_minimized') === '1';
    }

    function setCollapsed(collapsed) {
        isCollapsed = collapsed;
        if (collapsed) {
            note.classList.add('is-collapsed');
            note.setAttribute('hidden', '');
            showMenubarIcon();
            store.set('sticky_minimized', '1');
        } else {
            note.classList.remove('is-collapsed');
            note.removeAttribute('hidden');
            hideMenubarIcon();
            store.remove('sticky_minimized');
        }
    }

    function clearAnimStyles() {
        note.classList.remove('is-animating', 'is-dragging', 'is-sync-moving', 'is-minimizing', 'is-restoring');
        note.style.transition = '';
        note.style.transform = '';
        note.style.opacity = '';
        note.style.transformOrigin = '';
        note.style.position = '';
        note.style.width = '';
        note.style.margin = '';
        note.style.zIndex = '';
    }

    function bounds() {
        const maxLeft = Math.max(0, desktop.clientWidth - note.offsetWidth);
        const maxTop = Math.max(0, desktop.clientHeight - note.offsetHeight);
        return { maxLeft, maxTop };
    }

    function pixelsFromNormalized(x, y) {
        const { maxLeft, maxTop } = bounds();
        return {
            left: Math.round(x * maxLeft),
            top: Math.round(y * maxTop),
        };
    }

    function normalizedFromPixels(left, top) {
        const { maxLeft, maxTop } = bounds();
        return {
            x: left / Math.max(1, maxLeft),
            y: top / Math.max(1, maxTop),
        };
    }

    function setPixelPosition(left, top) {
        note.style.left = left + 'px';
        note.style.top = top + 'px';
    }

    /**
     * The shared spot is a fraction of each visitor's own desktop, so on a
     * narrower screen it can land on the desktop icons (on a tablet it hid
     * whole icons). Shown here only: slide it left of the icons it would
     * cover, and leave the shared position alone.
     */
    function clearOfIcons(left, top) {
        const icons = document.querySelectorAll('.desktop-icon');
        if (!icons.length) return left;
        const origin = desktop.getBoundingClientRect();
        const w = note.offsetWidth;
        const h = note.offsetHeight;
        let minLeft = Infinity;
        icons.forEach((icon) => {
            const r = icon.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const x = r.left - origin.left;
            const y = r.top - origin.top;
            const hit = x < left + w && x + r.width > left && y < top + h && y + r.height > top;
            if (hit) minLeft = Math.min(minLeft, x);
        });
        if (minLeft === Infinity) return left;
        const moved = Math.round(minLeft - w - 12);
        return moved >= 0 ? moved : left;
    }

    function applyPosition(animate) {
        if (!desktop || isMobile() || isNoteCollapsed()) return;
        const spot = pixelsFromNormalized(localState.x, localState.y);
        const top = spot.top;
        const left = clearOfIcons(spot.left, top);
        if (animate && !awaiting && !isDragging && !isAnimating && !reducedMotion()) {
            // Someone dragging it live sends a stream of small steps, which a
            // short linear tween keeps continuous; a bigger correction (the
            // relay's copy differing from the cached spot, or a move made
            // while this tab was away) glides and settles instead of snapping.
            const fromLeft = parseFloat(note.style.left);
            const fromTop = parseFloat(note.style.top);
            const dist = Number.isFinite(fromLeft) && Number.isFinite(fromTop)
                ? Math.hypot(left - fromLeft, top - fromTop) : 0;
            const glide = dist > GLIDE_MIN_PX;
            const ms = glide ? GLIDE_MS : REMOTE_MOVE_MS;
            const ease = glide ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'linear';
            note.style.transition = `left ${ms}ms ${ease}, top ${ms}ms ${ease}`;
            note.classList.add('is-sync-moving');
            clearTimeout(remoteMoveTimer);
            remoteMoveTimer = setTimeout(() => {
                note.classList.remove('is-sync-moving');
                note.style.transition = '';
            }, ms + 30);
        }
        setPixelPosition(left, top);
    }

    /**
     * Trim to the visible line budget.
     *
     * This still has to truncate (remote updates and pastes can both overflow),
     * but when it fires because someone is typing we now say so - previously
     * the note just silently swallowed keystrokes at the cap with no feedback
     * at all, which reads as the input being broken.
     */
    function enforceLineLimit(announce) {
        const maxScroll = MAX_LINES * LINE_HEIGHT;
        let val = body.value;
        body.style.height = 'auto';
        body.style.height = (MAX_LINES * LINE_HEIGHT) + 'px';

        let trimmed = false;
        if (val.length > 0 && body.scrollHeight > maxScroll) {
            // Binary search for the longest prefix that fits. Each probe is a
            // forced layout, so trimming one character at a time let a single
            // oversized remote update lock the page up.
            let lo = 0;
            let hi = val.length - 1;
            while (lo < hi) {
                const mid = (lo + hi + 1) >> 1;
                body.value = val.slice(0, mid);
                if (body.scrollHeight > maxScroll) hi = mid - 1;
                else lo = mid;
            }
            val = val.slice(0, lo);
            body.value = val;
            trimmed = true;
        }

        if (trimmed && announce) flashLimit();
        return val;
    }

    let limitTimer = null;

    function flashLimit() {
        note.classList.add('at-limit');
        clearTimeout(limitTimer);
        limitTimer = setTimeout(() => note.classList.remove('at-limit'), 600);

        if (statusEl && !isOffline) {
            clearStatusTimers();
            statusMode = 'limit';
            setStatus(`${MAX_LINES} line limit`);
            statusTimer = setTimeout(() => showLastEdit(true), 1600);
        }
    }

    function flushToDom() {
        if (body.value !== localState.text) {
            body.value = localState.text;
            enforceLineLimit();
        }
        applyPosition(false);
    }

    function flyDelta(noteRect, iconRect) {
        const noteCx = noteRect.left + noteRect.width / 2;
        const noteCy = noteRect.top + noteRect.height / 2;
        const iconCx = iconRect.left + iconRect.width / 2;
        const iconCy = iconRect.top + iconRect.height / 2;
        return { dx: iconCx - noteCx, dy: iconCy - noteCy };
    }

    function pinNoteFixed(noteRect) {
        note.style.position = 'fixed';
        note.style.left = noteRect.left + 'px';
        note.style.top = noteRect.top + 'px';
        note.style.width = noteRect.width + 'px';
        note.style.margin = '0';
        note.style.zIndex = '9999';
        note.style.transformOrigin = 'center center';
    }

    function iconRectOrFallback(noteRect) {
        if (menubarToggle) return menubarToggle.getBoundingClientRect();
        return { left: noteRect.left, top: 0, width: 14, height: 14 };
    }

    /** Bounded copy of whatever a peer put on the shared node. */
    function sanitize(data) {
        return {
            x: clamp01(data.x, DEFAULTS.x),
            y: clamp01(data.y, DEFAULTS.y),
            text: cleanText(data.text),
            textTs: cleanTs(data.textTs),
            moveTs: cleanTs(data.moveTs),
        };
    }

    const hasPosition = (data) => Number.isFinite(data.x) && Number.isFinite(data.y);

    function applyRemote(data) {
        if (!data) return;
        const clean = sanitize(data);

        if (hasPosition(data) && clean.moveTs > localState.moveTs) {
            localState.x = clean.x;
            localState.y = clean.y;
            localState.moveTs = clean.moveTs;
            if (!isNoteCollapsed() && !isDragging && !isAnimating) {
                applyPosition(true);
            }
        }

        if (!isEditing && typeof data.text === 'string' &&
            clean.textTs > localState.textTs) {
            localState.text = clean.text;
            localState.textTs = clean.textTs;
            if (!isNoteCollapsed() && body.value !== localState.text) {
                body.value = localState.text;
                enforceLineLimit();
            }
            if (!isNoteCollapsed() && !isEditing) showLastEdit();
        }
        saveCache();
    }

    // Only the fields that changed are written. Publishing the whole state on
    // every drag or blur re-sent this viewer's copy of the text and silently
    // reverted whatever someone else had typed in the meantime.
    function putState(partial) {
        localState = { ...localState, ...partial };
        if (ref) ref.put(partial);
        saveCache();
    }

    /**
     * Publish the text, unless the shared note has not arrived yet: until
     * then this viewer's copy is just the empty default, and writing it (or
     * anything typed on top of it) would replace the real note for everyone.
     * A draft started before the note arrived is dropped when it does (see
     * dropUnloadedDraft), so it cannot be published afterwards either.
     */
    function putText(text) {
        if (!ref || !loaded) {
            if (!isOffline) {
                clearStatusTimers();
                statusMode = 'unsynced';
                setStatus('Not synced yet');
            }
            return;
        }
        putState({ text, textTs: Date.now() });
        showSynced();
    }

    function scheduleTextPut() {
        clearTimeout(textTimer);
        textTimer = setTimeout(() => {
            putText(enforceLineLimit());
        }, TEXT_DEBOUNCE_MS);
    }

    function finishMinimize() {
        isAnimating = false;
        clearStatusTimers();
        setCollapsed(true);
        clearAnimStyles();
    }

    function minimize() {
        if (isAnimating || isNoteCollapsed()) return;

        showMenubarIcon();

        const noteRect = note.getBoundingClientRect();
        const { dx, dy } = flyDelta(noteRect, iconRectOrFallback(noteRect));

        isAnimating = true;
        note.classList.add('is-minimizing');
        pinNoteFixed(noteRect);
        note.style.transform = 'rotate(0deg) scale(1)';
        note.style.opacity = '1';
        note.style.transition = 'none';

        const done = () => {
            note.removeEventListener('transitionend', onEnd);
            clearTimeout(fallback);
            finishMinimize();
        };
        const onEnd = (e) => {
            if (e.propertyName !== 'transform') return;
            done();
        };

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                note.style.transition = `transform ${FLY_MS}ms ease-in, opacity ${FLY_MS}ms ease-in`;
                note.style.transform = `translate(${dx}px, ${dy}px) scale(${FLY_SCALE}) rotate(0deg)`;
                note.style.opacity = '0';
            });
        });

        const fallback = setTimeout(done, FLY_MS + 40);
        note.addEventListener('transitionend', onEnd);
    }

    function finishRestore() {
        isAnimating = false;
        clearAnimStyles();
        applyPosition(false);
        showLastEdit();
    }

    function restore() {
        if (isAnimating || !isNoteCollapsed()) return;

        const iconRect = menubarToggle
            ? menubarToggle.getBoundingClientRect()
            : null;

        setCollapsed(false);
        clearAnimStyles();
        flushToDom();

        const noteRect = note.getBoundingClientRect();
        const icon = iconRect || iconRectOrFallback(noteRect);
        const { dx, dy } = flyDelta(noteRect, icon);

        isAnimating = true;
        note.classList.add('is-restoring');
        pinNoteFixed(noteRect);
        note.style.transform = `translate(${dx}px, ${dy}px) scale(${FLY_SCALE}) rotate(0deg)`;
        note.style.opacity = '0';
        note.style.transition = 'none';

        const done = () => {
            note.removeEventListener('transitionend', onEnd);
            clearTimeout(fallback);
            finishRestore();
        };
        const onEnd = (e) => {
            if (e.propertyName !== 'transform') return;
            done();
        };

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                note.style.transition = `transform ${FLY_MS}ms ease-out, opacity ${FLY_MS}ms ease-out`;
                note.style.transform = 'rotate(-0.8deg) scale(1)';
                note.style.opacity = '1';
            });
        });

        const fallback = setTimeout(done, FLY_MS + 40);
        note.addEventListener('transitionend', onEnd);
    }

    function setupMinimizeControls() {
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                minimize();
            });
            closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        }

        if (menubarToggle) {
            menubarToggle.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                restore();
            });
            menubarToggle.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    restore();
                }
            });
        }
    }

    function setupTextSync() {
        body.addEventListener('focus', () => {
            if (!canEdit()) return;
            isEditing = true;
            showEditing();
        });

        body.addEventListener('blur', () => {
            isEditing = false;
            if (!canEdit()) return;
            clearTimeout(textTimer);
            const text = enforceLineLimit();
            if (text !== localState.text) {
                putText(text);
                return;
            }
            // Nothing was typed, so there is nothing to publish. Remote text
            // is held back while the note has focus; catch up on it now.
            if (lastRemote) applyRemote(lastRemote);
            showLastEdit(true);
        });

        body.addEventListener('input', () => {
            if (!canEdit()) return;
            enforceLineLimit(true);
            showEditing();
            scheduleTextPut();
        });

        body.addEventListener('paste', (e) => {
            if (!canEdit()) {
                e.preventDefault();
                return;
            }
            e.preventDefault();
            const start = body.selectionStart;
            const end = body.selectionEnd;
            const room = Math.max(0, MAX_TEXT - (body.value.length - (end - start)));
            const paste = (e.clipboardData || window.clipboardData).getData('text').slice(0, room);
            body.value = body.value.slice(0, start) + paste + body.value.slice(end);
            body.selectionStart = body.selectionEnd = start + paste.length;
            enforceLineLimit(true);
            scheduleTextPut();
        });
    }

    function setupDrag() {
        if (!canEdit()) return;

        let startX, startY, startLeft, startTop, pointerId = null;

        // Pointer events with capture, so a finger on a tablet can drag it
        // as well as a mouse; touch-action stops the page panning instead.
        titlebar.style.touchAction = 'none';
        titlebar.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || isDragging || e.target.closest('.sticky-close') || isAnimating) return;

            isDragging = true;
            pointerId = e.pointerId;
            note.classList.add('is-dragging');
            note.classList.remove('is-sync-moving');
            startX = e.clientX;
            startY = e.clientY;
            startLeft = note.offsetLeft;
            startTop = note.offsetTop;

            try { titlebar.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
            titlebar.addEventListener('pointermove', onDrag);
            titlebar.addEventListener('pointerup', stopDrag);
            titlebar.addEventListener('pointercancel', stopDrag);
        });

        function onDrag(e) {
            if (!isDragging || e.pointerId !== pointerId) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const { maxLeft, maxTop } = bounds();
            const left = Math.min(maxLeft, Math.max(0, startLeft + dx));
            const top = Math.min(maxTop, Math.max(0, startTop + dy));
            setPixelPosition(left, top);

            const now = Date.now();
            if (now - lastDragPut >= DRAG_PUT_MS) {
                lastDragPut = now;
                const norm = normalizedFromPixels(left, top);
                localState.x = norm.x;
                localState.y = norm.y;
                localState.moveTs = now;
                putState({ x: norm.x, y: norm.y, moveTs: now });
            }
        }

        function stopDrag(e) {
            if (!isDragging || (e && e.pointerId !== pointerId)) return;
            isDragging = false;
            note.classList.remove('is-dragging');
            titlebar.removeEventListener('pointermove', onDrag);
            titlebar.removeEventListener('pointerup', stopDrag);
            titlebar.removeEventListener('pointercancel', stopDrag);
            try { titlebar.releasePointerCapture(pointerId); } catch (err) { /* ignore */ }
            pointerId = null;

            const norm = normalizedFromPixels(note.offsetLeft, note.offsetTop);
            putState({ x: norm.x, y: norm.y, moveTs: Date.now() });
        }
    }

    function applyMinimizedState() {
        if (isNoteCollapsed()) {
            setCollapsed(true);
        } else if (!isAnimating) {
            setCollapsed(false);
            applyPosition(false);
        }
    }

    // Phones can read the note but not write on it; the placeholder says so
    // instead of inviting a tap that does nothing.
    const editPlaceholder = body.getAttribute('placeholder') || '';
    const READ_ONLY_PLACEHOLDER = 'Open this site on a bigger screen to write here.';

    function initMobile() {
        body.readOnly = true;
        body.setAttribute('placeholder', READ_ONLY_PLACEHOLDER);
        isCollapsed = false;
        note.classList.remove('is-collapsed');
        note.removeAttribute('hidden');
        hideMenubarIcon();
        showLastEdit(true);
    }

    function initDesktop() {
        body.readOnly = false;
        body.setAttribute('placeholder', editPlaceholder);
        isCollapsed = store.get('sticky_minimized') === '1';
        const cached = readCache();
        if (cached) {
            localState = cached;
            body.value = cached.text;
            enforceLineLimit();
        } else if (!isCollapsed) {
            holdUntilLoaded();
        }
        applyMinimizedState();
        if (!isNoteCollapsed()) applyPosition(false);
        setupDrag();
    }

    function syncAfterGunInit(real) {
        initialized = true;
        if (isMobile()) {
            initMobile();
            return;
        }
        if (isNoteCollapsed()) {
            setCollapsed(true);
        } else if (!isAnimating) {
            setCollapsed(false);
            // Already on screen at the cached spot: glide to the real one.
            // Still held back: place it, then fade it in there.
            applyPosition(!awaiting);
            showLastEdit(true);
        }
        // An empty answer is often just the relay being slow: keep holding
        // for the real note (the fallback timer still shows it eventually).
        if (real) reveal();
    }

    function connectGun() {
        ref = window.SiteGun.paths.apps.sticky();
        watchConnection();

        const isReal = (data) =>
            !!data && (hasPosition(data) || typeof data.text === 'string');

        function seed(data) {
            localState = sanitize(data);
            loaded = true;
            saveCache();
            if (!isEditing) {
                body.value = localState.text;
                enforceLineLimit();
            } else {
                dropUnloadedDraft(data);
            }
        }

        // Anything typed before the shared note arrived (relay slow or down
        // at page load) was written on top of the empty default, not on the
        // real note. Publishing it would replace a note this visitor never
        // saw, so the note wins and the draft is dropped.
        function dropUnloadedDraft(data) {
            if (typeof data.text !== 'string') return;
            const clean = sanitize(data);
            clearTimeout(textTimer);
            localState.text = clean.text;
            localState.textTs = clean.textTs;
            if (body.value === clean.text) return;
            body.value = clean.text;
            enforceLineLimit();
            if (!isNoteCollapsed() && !isOffline) {
                clearStatusTimers();
                statusMode = 'unsynced';
                setStatus('Note loaded');
            }
        }

        ref.once((data) => {
            if (initialized) return;
            // Gun also calls back with undefined when the relay is slow or
            // unreachable. Nothing is written then (DEFAULTS would push text:''
            // to the SHARED node and blank the note for everyone) and the local
            // state is left as it is: the defaults, or the cached last-seen note
            // this visitor is already looking at. `loaded` stays false, so
            // putText() refuses to publish until the real note shows up.
            if (isReal(data)) seed(data);
            syncAfterGunInit(isReal(data));
        });

        ref.on((data) => {
            if (!isReal(data)) return;
            lastRemote = data;
            if (!initialized) {
                // The first real payload can arrive here before (or instead
                // of) the once() above when the relay is slow.
                seed(data);
                syncAfterGunInit(true);
                return;
            }
            if (!loaded) {
                loaded = true;
                if (isEditing) dropUnloadedDraft(data);
            }
            applyRemote(data);
            // First visit, relay slower than once(): it has just been placed
            // (without a tween, while invisible), so now it can fade in.
            if (awaiting) reveal();
        });
    }

    waitSiteGun()
        .then(() => {
            setupMinimizeControls();
            setupTextSync();
            if (isMobile()) initMobile();
            else initDesktop();
            connectGun();
            window.addEventListener('resize', () => {
                if (!isMobile() && !isNoteCollapsed() && !isAnimating) {
                    enforceLineLimit();
                    applyPosition(false);
                }
            });
        })
        .catch(() => {
            clearStatusTimers();
            statusMode = 'offline';
            setStatus('Offline');
        });
})();
