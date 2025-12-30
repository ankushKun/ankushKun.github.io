/**
 * IRC Chat - Gun.js powered real-time chat
 */
(function () {
    'use strict';

    const GUN_RELAY = "https://arweave.tech/gun";
    const CHANNEL = "ankush-irc-general";
    const MAX_MESSAGES = 50;
    const PRESENCE_TIMEOUT = 10000;

    let gunLoaded = false;
    let gunLoadPromise = null;

    function loadGun() {
        if (gunLoaded) return Promise.resolve();
        if (gunLoadPromise) return gunLoadPromise;
        gunLoadPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/gun/gun.js';
            s.onload = () => { gunLoaded = true; resolve(); };
            s.onerror = reject;
            document.head.appendChild(s);
        });
        return gunLoadPromise;
    }

    function initIRC(win) {
        const root = win.querySelector('.irc-window');
        if (!root || root.dataset.init) return;
        root.dataset.init = '1';

        const els = {
            prompt: root.querySelector('.irc-nick-prompt'),
            nickInput: root.querySelector('.irc-nick-dialog input'),
            nickBtn: root.querySelector('.irc-nick-dialog button'),
            status: root.querySelector('.irc-status'),
            log: root.querySelector('.irc-log'),
            users: root.querySelector('.irc-user-list'),
            inputNick: root.querySelector('.irc-input-nick'),
            msgInput: root.querySelector('.irc-msg-input')
        };

        let gun, chat, presence;
        let myNick = '';
        let seen = new Set();
        let online = {};
        let presenceInt = null;
        let hasLeft = false;

        // Events
        // Events
        els.nickBtn.addEventListener('click', join);

        // Input handling - ensure we stop propagation so global shortcuts don't fire
        function handleInputKey(e) {
            e.stopPropagation(); // Critical for typing to work!
            if (e.key === 'Enter') {
                if (e.target === els.nickInput) join();
                if (e.target === els.msgInput) send();
            }
        }

        els.nickInput.addEventListener('keydown', handleInputKey);
        els.msgInput.addEventListener('keydown', handleInputKey);

        // Prevent window manager from stealing focus
        els.nickInput.addEventListener('mousedown', e => e.stopPropagation());
        els.msgInput.addEventListener('mousedown', e => e.stopPropagation());

        // Load saved nick
        const savedNick = localStorage.getItem('irc_nick');
        if (savedNick) {
            els.nickInput.value = savedNick;
        }

        setTimeout(() => els.nickInput.focus(), 50);

        function join() {
            const nick = els.nickInput.value.trim().slice(0, 10);
            if (!nick) return els.nickInput.focus();

            // Save nick
            localStorage.setItem('irc_nick', nick);

            myNick = nick;
            els.prompt.classList.add('hidden');
            els.inputNick.textContent = myNick + '>';
            els.msgInput.disabled = false;
            els.msgInput.placeholder = 'Write to #general';
            els.msgInput.focus();
            loadGun().then(connect).catch(() => addMsg('', 'Failed to load Gun.js', true));
        }

        function connect() {
            gun = Gun({ peers: [GUN_RELAY] });
            chat = gun.get(CHANNEL + '-messages');
            presence = gun.get(CHANNEL + '-presence');

            els.log.innerHTML = '';

            chat.map().on((data, key) => {
                if (!data || seen.has(key)) return;
                seen.add(key);
                try {
                    const m = typeof data === 'string' ? JSON.parse(data) : data;
                    if (m && m.nick && m.text) {
                        addMsg(m.nick, m.text, m.type === 'system', m.action);
                    }
                } catch (e) { }
            });

            announce();
            // Faster heartbeat (5s) for responsiveness
            if (presenceInt) clearInterval(presenceInt);
            presenceInt = setInterval(announce, 5000);

            // Broadcast join message after a brief delay (let presence sync first)
            setTimeout(() => {
                publishMessage('entered the room', 'system');
            }, 500);

            // Remove presence on unload
            window.addEventListener('beforeunload', () => {
                if (myNick && presence && !hasLeft) {
                    hasLeft = true;
                    publishMessage('left the room', 'system');
                    presence.get(myNick).put(null);
                    if (presenceInt) clearInterval(presenceInt);
                }
            });

            presence.map().on((data, key) => {
                // If data is null/undefined, user logic: user is gone
                if (!data) {
                    if (online[key]) {
                        delete online[key];
                        updateUsers();
                    }
                    return;
                }

                try {
                    const p = typeof data === 'string' ? JSON.parse(data) : data;
                    if (p && p.nick && p.lastSeen) {
                        // Ignore stale data (older than timeout)
                        if (Date.now() - p.lastSeen > PRESENCE_TIMEOUT) return;

                        // Check for join event (if not in online list and not self)
                        if (!online[key] && key !== myNick) {
                            // Let updateUsers handle the message or do it here?
                            // Doing it in updateUsers is safer to batch updates
                        }
                        online[key] = p;
                        updateUsers();
                    }
                } catch (e) { }
            });

            setInterval(cleanStale, 10000);
            els.status.textContent = 'Connected as ' + myNick;
        }

        function announce() {
            if (!myNick || !presence) return;
            // Use nick as key for stable identity
            presence.get(myNick).put({
                nick: myNick,
                status: 'online',
                lastSeen: Date.now()
            });
        }

        function cleanStale() {
            const now = Date.now();
            let changed = false;

            // Clean up stale users
            Object.keys(online).forEach(nick => {
                if (now - online[nick].lastSeen > PRESENCE_TIMEOUT) {
                    // Remove from shared relay state (Garbage Collection)
                    if (presence) presence.get(nick).put(null);

                    delete online[nick];
                    changed = true;
                }
            });

            if (changed) updateUsers();
        }

        function updateUsers() {
            els.users.innerHTML = '';

            // Get sorted list of nicks (keys are nicks now)
            const nicks = Object.keys(online).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

            nicks.forEach(n => {
                const d = document.createElement('div');
                d.className = 'irc-user' + (n === myNick ? ' me' : '');
                d.textContent = n;
                els.users.appendChild(d);
            });
        }


        function publishMessage(text, type = 'msg') {
            if (!chat) return;
            const isAction = text.startsWith('/me ');
            const key = Date.now() + '-' + Math.random().toString(36).substr(2, 6);
            chat.get(key).put(JSON.stringify({
                nick: myNick,
                text: isAction ? text.slice(4) : text,
                time: Date.now(),
                action: isAction,
                type: type
            }));
        }

        function send() {
            const text = els.msgInput.value.trim();
            if (!text) return;
            els.msgInput.value = '';
            publishMessage(text);
        }

        function addMsg(nick, text, isSystem, isAction) {
            const row = document.createElement('div');
            const isLeave = isSystem && text.includes('left the room');
            row.className = 'irc-msg' + (isLeave ? ' leave' : isSystem ? ' system' : '') + (isAction ? ' action' : '');

            const nickEl = document.createElement('div');
            nickEl.className = 'irc-msg-nick';
            nickEl.textContent = isSystem ? 'system' : nick;

            const textEl = document.createElement('div');
            textEl.className = 'irc-msg-text';
            // For system messages with a nick, prepend the nick (e.g., "user entered the room")
            // For action messages, prepend the nick (e.g., "user does something")
            // For regular local system messages without nick, just show text
            if (isSystem && nick) {
                textEl.textContent = nick + ' ' + text;
            } else if (isAction) {
                textEl.textContent = nick + ' ' + text;
            } else {
                textEl.textContent = text;
            }

            row.appendChild(nickEl);
            row.appendChild(textEl);
            els.log.appendChild(row);

            while (els.log.children.length > MAX_MESSAGES) els.log.removeChild(els.log.firstChild);
            els.log.scrollTop = els.log.scrollHeight;
        }

        root.onclick = e => {
            if (els.prompt.classList.contains('hidden') && e.target.tagName !== 'INPUT') {
                els.msgInput.focus();
            }
        };

        // Expose cleanup function for when window is closed
        win.ircCleanup = function () {
            if (myNick && presence && chat && !hasLeft) {
                hasLeft = true;
                publishMessage('left the room', 'system');
                presence.get(myNick).put(null);
                if (presenceInt) clearInterval(presenceInt);
            }
        };
    }

    window.initIRCChat = initIRC;
})();
