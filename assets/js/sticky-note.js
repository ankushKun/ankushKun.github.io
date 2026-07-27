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
    const DEFAULTS = { x: 0.72, y: 0.12, text: '', textTs: 0, moveTs: 0 };

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

    body.style.height = (MAX_LINES * LINE_HEIGHT) + 'px';

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
        return isCollapsed || localStorage.getItem('sticky_minimized') === '1';
    }

    function setCollapsed(collapsed) {
        isCollapsed = collapsed;
        if (collapsed) {
            note.classList.add('is-collapsed');
            note.setAttribute('hidden', '');
            showMenubarIcon();
            localStorage.setItem('sticky_minimized', '1');
        } else {
            note.classList.remove('is-collapsed');
            note.removeAttribute('hidden');
            hideMenubarIcon();
            localStorage.removeItem('sticky_minimized');
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

    function applyPosition(animate) {
        if (!desktop || isMobile() || isNoteCollapsed()) return;
        const { left, top } = pixelsFromNormalized(localState.x, localState.y);
        if (animate && !isDragging && !isAnimating) {
            note.classList.add('is-sync-moving');
            clearTimeout(remoteMoveTimer);
            remoteMoveTimer = setTimeout(() => note.classList.remove('is-sync-moving'), REMOTE_MOVE_MS + 30);
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
        while (val.length > 0 && body.scrollHeight > maxScroll) {
            val = val.slice(0, -1);
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

    function applyRemote(data) {
        if (!data) return;

        if (typeof data.x === 'number' && typeof data.y === 'number' &&
            (data.moveTs || 0) > localState.moveTs) {
            localState.x = data.x;
            localState.y = data.y;
            localState.moveTs = data.moveTs || localState.moveTs;
            if (!isNoteCollapsed() && !isDragging && !isAnimating) {
                applyPosition(true);
            }
        }

        if (!isEditing && typeof data.text === 'string' &&
            (data.textTs || 0) > localState.textTs) {
            localState.text = data.text;
            localState.textTs = data.textTs || 0;
            if (!isNoteCollapsed() && body.value !== localState.text) {
                body.value = localState.text;
                enforceLineLimit();
            }
            if (!isNoteCollapsed() && !isEditing) showLastEdit();
        }
    }

    function putState(partial) {
        localState = { ...localState, ...partial };
        if (ref) ref.put(localState);
    }

    function scheduleTextPut() {
        clearTimeout(textTimer);
        textTimer = setTimeout(() => {
            const text = enforceLineLimit();
            putState({ text, textTs: Date.now() });
            showSynced();
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
            putState({ text, textTs: Date.now() });
            showSynced();
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
            const paste = (e.clipboardData || window.clipboardData).getData('text');
            const start = body.selectionStart;
            const end = body.selectionEnd;
            body.value = body.value.slice(0, start) + paste + body.value.slice(end);
            body.selectionStart = body.selectionEnd = start + paste.length;
            enforceLineLimit(true);
            scheduleTextPut();
        });
    }

    function setupDrag() {
        if (!canEdit()) return;

        let startX, startY, startLeft, startTop;

        titlebar.addEventListener('mousedown', (e) => {
            if (e.target.closest('.sticky-close') || isAnimating) return;

            isDragging = true;
            note.classList.add('is-dragging');
            note.classList.remove('is-sync-moving');
            startX = e.clientX;
            startY = e.clientY;
            startLeft = note.offsetLeft;
            startTop = note.offsetTop;

            document.addEventListener('mousemove', onDrag);
            document.addEventListener('mouseup', stopDrag);
        });

        function onDrag(e) {
            if (!isDragging) return;
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

        function stopDrag() {
            if (!isDragging) return;
            isDragging = false;
            note.classList.remove('is-dragging');
            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('mouseup', stopDrag);

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

    function initMobile() {
        body.readOnly = true;
        isCollapsed = false;
        note.classList.remove('is-collapsed');
        note.removeAttribute('hidden');
        hideMenubarIcon();
        showLastEdit(true);
    }

    function initDesktop() {
        body.readOnly = false;
        isCollapsed = localStorage.getItem('sticky_minimized') === '1';
        applyMinimizedState();
        if (!isNoteCollapsed()) applyPosition(false);
        setupDrag();
    }

    function syncAfterGunInit() {
        initialized = true;
        if (isMobile()) {
            initMobile();
            return;
        }
        if (isNoteCollapsed()) {
            setCollapsed(true);
        } else if (!isAnimating) {
            setCollapsed(false);
            applyPosition(false);
            showLastEdit(true);
        }
    }

    function connectGun() {
        ref = window.SiteGun.paths.apps.sticky();
        watchConnection();

        ref.once((data) => {
            if (!data || typeof data.x !== 'number') {
                // Gun also calls back with undefined when the relay is slow or
                // unreachable. Writing DEFAULTS here would push text:'' to the
                // SHARED node and blank the note for everyone, so seed local
                // state only - the first real edit publishes.
                localState = { ...DEFAULTS };
            } else {
                localState = {
                    x: typeof data.x === 'number' ? data.x : DEFAULTS.x,
                    y: typeof data.y === 'number' ? data.y : DEFAULTS.y,
                    text: typeof data.text === 'string' ? data.text : '',
                    textTs: data.textTs || 0,
                    moveTs: data.moveTs || 0,
                };
                body.value = localState.text;
                enforceLineLimit();
            }
            syncAfterGunInit();
        });

        ref.on((data) => {
            if (!initialized) return;
            applyRemote(data);
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
