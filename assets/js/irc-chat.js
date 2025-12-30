/**
 * IRC Chat - Gun.js powered real-time chat
 */
(function () {
    'use strict';

    const GUN_RELAY = "https://arweave.tech/gun";
    const CHANNEL = "ankush-irc-general";
    const MAX_MESSAGES = 50;
    const PRESENCE_TIMEOUT = 10000;

    // Generate a UUID v4
    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // Generate deterministic color from UUID
    function uuidToColor(uuid) {
        if (!uuid) return '#2980b9';

        // Use the UUID to generate a hash
        let hash = 0;
        for (let i = 0; i < uuid.length; i++) {
            hash = uuid.charCodeAt(i) + ((hash << 5) - hash);
        }

        // Generate HSL color with good saturation and lightness for readability
        const hue = Math.abs(hash % 360);
        const saturation = 60 + (Math.abs(hash >> 8) % 20); // 60-80%
        const lightness = 35 + (Math.abs(hash >> 16) % 15); // 35-50% (dark enough to read)

        return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    }

    // Fun action commands
    const COMMANDS = {
        'slap': {
            solo: 'slaps the air dramatically',
            target: 'slaps {target} around a bit with a large trout'
        },
        'kill': {
            solo: 'kills themselves',
            target: 'kills {target}'
        },
        'hit': {
            solo: 'swings at the air',
            target: 'hits {target}!'
        },
        'hug': {
            solo: 'hugs themselves',
            target: 'hugs {target} warmly'
        },
        'poke': {
            solo: 'pokes the void',
            target: 'pokes {target}'
        },
        'wave': {
            solo: 'waves at everyone',
            target: 'waves at {target}'
        },
        'dance': {
            solo: 'busts out some sick dance moves',
            target: 'dances with {target}'
        },
        'highfive': {
            solo: 'high-fives the air... awkward',
            target: 'high-fives {target}'
        },
        'fistbump': {
            solo: 'fist-bumps the air',
            target: 'fist-bumps {target}'
        },
        'spank': {
            solo: 'spanks themselves... that\'s weird',
            target: 'spanks {target}!'
        },
        'pat': {
            solo: 'pats their own head',
            target: 'pats {target} on the head'
        },
        'kick': {
            solo: 'kicks the wall in frustration',
            target: 'kicks {target}!'
        },
        'tickle': {
            solo: 'tickles themselves and giggles',
            target: 'tickles {target} mercilessly'
        },
        'boop': {
            solo: 'boops their own nose',
            target: 'boops {target}\'s nose'
        },
        'throw': {
            solo: 'throws something at the wall',
            target: 'throws something at {target}'
        },
        'bonk': {
            solo: 'bonks themselves on the head',
            target: 'bonks {target} with a hammer'
        }
    };

    let gunLoaded = false;
    let gunLoadPromise = null;

    function loadGun() {
        if (gunLoaded) return Promise.resolve();
        if (gunLoadPromise) return gunLoadPromise;
        gunLoadPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/gun/gun.min.js';
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
            msgInput: root.querySelector('.irc-msg-input'),
            logoutBtn: root.querySelector('.irc-logout'),
            onlineHeader: root.querySelector('.irc-online-header')
        };

        let gun, chat, presence;
        let myNick = '';
        let myUUID = '';
        let seen = new Set();
        let online = {}; // Maps nick -> {nick, uuid, status, lastSeen}
        let uuidCache = {}; // Maps nick -> uuid (persists even when offline)
        let presenceInt = null;
        let hasLeft = false;
        let recentLeaves = new Set(); // Track recent leave broadcasts to prevent duplicates
        let lastSystemMsg = {}; // Track last system message per user to collapse duplicates
        let joinTime = 0; // Track when user joined to avoid notifying for old messages
        let lastCursorPos = 0; // Track last known cursor position

        // Events
        els.nickBtn.addEventListener('click', join);
        els.logoutBtn.addEventListener('click', logout);

        // Play notification sound (Discord-like)
        function playNotificationSound() {
            try {
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();

                // First tone (lower pitch)
                const oscillator1 = audioContext.createOscillator();
                const gainNode1 = audioContext.createGain();

                oscillator1.connect(gainNode1);
                gainNode1.connect(audioContext.destination);

                oscillator1.type = 'sine';
                oscillator1.frequency.value = 440; // A4 note, lower and warmer

                // Envelope for smoother sound
                gainNode1.gain.setValueAtTime(0, audioContext.currentTime);
                gainNode1.gain.linearRampToValueAtTime(0.15, audioContext.currentTime + 0.01);
                gainNode1.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);

                oscillator1.start(audioContext.currentTime);
                oscillator1.stop(audioContext.currentTime + 0.15);
            } catch (e) {
                // Silent fail if audio not supported
            }
        }

        // Get plain text from contenteditable
        function getInputText() {
            return els.msgInput.textContent || '';
        }

        // Set text in contenteditable and update colors
        function setInputText(text) {
            els.msgInput.textContent = text;
            updateInputColors();
        }

        // Get cursor position in contenteditable
        function getCursorPosition() {
            const sel = window.getSelection();
            if (sel.rangeCount === 0) return 0;
            const range = sel.getRangeAt(0);
            const preCaretRange = range.cloneRange();
            preCaretRange.selectNodeContents(els.msgInput);
            preCaretRange.setEnd(range.endContainer, range.endOffset);
            return preCaretRange.toString().length;
        }

        // Set cursor position in contenteditable
        function setCursorPosition(pos) {
            const sel = window.getSelection();
            const range = document.createRange();

            let charCount = 0;
            let foundNode = null;
            let foundOffset = 0;

            function traverseNodes(node) {
                if (foundNode) return;

                if (node.nodeType === Node.TEXT_NODE) {
                    const nextCharCount = charCount + node.length;
                    if (pos <= nextCharCount) {
                        foundNode = node;
                        foundOffset = pos - charCount;
                    }
                    charCount = nextCharCount;
                } else {
                    for (let i = 0; i < node.childNodes.length; i++) {
                        traverseNodes(node.childNodes[i]);
                        if (foundNode) break;
                    }
                }
            }

            traverseNodes(els.msgInput);

            if (foundNode) {
                range.setStart(foundNode, foundOffset);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        }

        // Update colors for @mentions in input
        function updateInputColors() {
            const text = getInputText();

            // Quick check: if no @ symbols, don't parse
            if (!text.includes('@')) {
                return;
            }

            const cursorPos = getCursorPosition();

            // Parse and rebuild with colored mentions
            const parts = parseAndColorMentions(text);

            // Check if we have any mentions
            const hasMentions = parts.some(p => p.type === 'mention');

            if (hasMentions) {
                els.msgInput.innerHTML = '';
                parts.forEach(part => {
                    if (part.type === 'text') {
                        els.msgInput.appendChild(document.createTextNode(part.content));
                    } else if (part.type === 'mention') {
                        const mentionSpan = document.createElement('span');
                        mentionSpan.className = 'irc-mention';
                        mentionSpan.textContent = part.content;

                        if (part.uuid) {
                            mentionSpan.style.color = uuidToColor(part.uuid);
                            mentionSpan.style.fontWeight = '600';
                        } else {
                            // Invalid mention - keep default color but still bold
                            mentionSpan.style.fontWeight = '600';
                        }

                        els.msgInput.appendChild(mentionSpan);
                    }
                });

                // Restore cursor position
                setTimeout(() => setCursorPosition(cursorPos), 0);
            }
        }

        // Insert @mention at cursor position
        function insertMention(nick) {
            const val = getInputText();

            // Use last known cursor position
            let cursorPos = lastCursorPos;

            // If cursor is at start (0) and there's text, it likely means input wasn't focused
            // In that case, move cursor to end for better UX
            if (cursorPos === 0 && val.length > 0) {
                cursorPos = val.length;
            }

            const before = val.substring(0, cursorPos);
            const after = val.substring(cursorPos);

            // Add space before @ if needed
            const needsSpace = before.length > 0 && before[before.length - 1] !== ' ';
            const mention = (needsSpace ? ' ' : '') + '@' + nick + ' ';

            setInputText(before + mention + after);

            // Focus input and set cursor after the mention
            els.msgInput.focus();
            setTimeout(() => {
                const newPos = cursorPos + mention.length;
                setCursorPosition(newPos);
                lastCursorPos = newPos;
            }, 0);
        }

        // Get UUID for a username
        function getUuidForNick(nick) {
            if (nick === myNick) return myUUID;
            if (online[nick] && online[nick].uuid) return online[nick].uuid;
            // Check cache for offline users
            if (uuidCache[nick]) return uuidCache[nick];
            return null;
        }

        // Parse text and colorize @mentions
        function parseAndColorMentions(text) {
            // Match @username pattern (alphanumeric and underscores)
            const mentionRegex = /@(\w+)/g;
            const parts = [];
            let lastIndex = 0;
            let match;

            while ((match = mentionRegex.exec(text)) !== null) {
                const mentionedNick = match[1];
                const uuid = getUuidForNick(mentionedNick);

                // Add text before mention
                if (match.index > lastIndex) {
                    parts.push({
                        type: 'text',
                        content: text.substring(lastIndex, match.index)
                    });
                }

                // Add mention (colored if valid user)
                parts.push({
                    type: 'mention',
                    content: match[0],
                    nick: mentionedNick,
                    uuid: uuid
                });

                lastIndex = match.index + match[0].length;
            }

            // Add remaining text
            if (lastIndex < text.length) {
                parts.push({
                    type: 'text',
                    content: text.substring(lastIndex)
                });
            }

            return parts;
        }

        // Input handling - ensure we stop propagation so global shortcuts don't fire
        function handleInputKey(e) {
            e.stopPropagation(); // Critical for typing to work!
            if (e.key === 'Enter') {
                if (e.target === els.nickInput) {
                    e.preventDefault();
                    join();
                } else if (e.target === els.msgInput && !e.shiftKey) {
                    e.preventDefault();
                    send();
                }
            }
        }

        els.nickInput.addEventListener('keydown', handleInputKey);
        els.msgInput.addEventListener('keydown', handleInputKey);

        // Update colors as user types in contenteditable
        els.msgInput.addEventListener('input', () => {
            updateInputColors();
            lastCursorPos = getCursorPosition();
        });

        // Track cursor position on click, keyup, and selection change
        els.msgInput.addEventListener('click', () => {
            lastCursorPos = getCursorPosition();
        });
        els.msgInput.addEventListener('keyup', () => {
            lastCursorPos = getCursorPosition();
        });
        els.msgInput.addEventListener('focus', () => {
            lastCursorPos = getCursorPosition();
        });

        // Prevent window manager from stealing focus
        els.nickInput.addEventListener('mousedown', e => e.stopPropagation());
        els.msgInput.addEventListener('mousedown', e => e.stopPropagation());
        els.logoutBtn.addEventListener('mousedown', e => e.stopPropagation());

        // Load saved nick and auto-join if present
        const savedNick = localStorage.getItem('irc_nick');
        if (savedNick) {
            els.nickInput.value = savedNick;
            // Auto-join after a brief delay
            setTimeout(() => {
                join();
            }, 300);
        } else {
            setTimeout(() => els.nickInput.focus(), 50);
        }

        function join() {
            const nick = els.nickInput.value.trim().slice(0, 10);
            if (!nick) return els.nickInput.focus();

            // Save nick
            localStorage.setItem('irc_nick', nick);

            // Get or generate UUID
            let uuid = localStorage.getItem('irc_uuid');
            if (!uuid) {
                uuid = generateUUID();
                localStorage.setItem('irc_uuid', uuid);
            }

            myNick = nick;
            myUUID = uuid;
            lastCursorPos = 0;
            els.prompt.classList.add('hidden');
            els.inputNick.textContent = myNick + '>';
            els.msgInput.setAttribute('contenteditable', 'true');
            els.msgInput.setAttribute('data-placeholder', 'Write to #general');
            els.msgInput.focus();
            els.logoutBtn.style.display = 'flex'; // Show logout button
            loadGun().then(connect).catch(() => addMsg('', 'Failed to load Gun.js', true));
        }

        function logout() {
            if (!myNick) return;

            // Broadcast leave message
            if (chat && presence && !hasLeft) {
                hasLeft = true;
                publishMessage('left the room', 'system');
                presence.get(myNick).put(null);
                if (presenceInt) clearInterval(presenceInt);
            }

            // Clear localStorage
            localStorage.removeItem('irc_nick');

            // Reset UI
            myNick = '';
            seen.clear();
            online = {};
            uuidCache = {};
            hasLeft = false;
            recentLeaves.clear();
            lastSystemMsg = {};
            joinTime = 0;
            lastCursorPos = 0;

            els.log.innerHTML = '';
            els.users.innerHTML = '';
            els.prompt.classList.remove('hidden');
            els.nickInput.value = '';
            els.msgInput.setAttribute('contenteditable', 'false');
            els.msgInput.textContent = '';
            els.msgInput.setAttribute('data-placeholder', 'Type a message...');
            els.inputNick.textContent = 'guest>';
            els.status.textContent = 'Connecting...';
            els.logoutBtn.style.display = 'none'; // Hide logout button

            // Focus nickname input
            setTimeout(() => els.nickInput.focus(), 50);
        }

        function connect() {
            gun = Gun({ peers: [GUN_RELAY] });
            chat = gun.get(CHANNEL + '-messages');
            presence = gun.get(CHANNEL + '-presence');

            // Mark join time to avoid notifying for old messages
            joinTime = Date.now();

            els.log.innerHTML = '';

            chat.map().on((data, key) => {
                if (!data || seen.has(key)) return;
                seen.add(key);
                try {
                    const m = typeof data === 'string' ? JSON.parse(data) : data;
                    if (m && m.nick && m.text) {
                        // Cache UUID from message
                        if (m.uuid && m.nick) {
                            uuidCache[m.nick] = m.uuid;
                        }

                        // Filter old join/leave messages (older than 5 minutes)
                        const isSysMsg = m.type === 'system';
                        const isJoinLeave = isSysMsg && (m.text.includes('entered the room') || m.text.includes('left the room'));
                        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);

                        if (isJoinLeave && m.time && m.time < fiveMinutesAgo) {
                            return; // Skip old join/leave messages
                        }

                        addMsg(m.nick, m.text, isSysMsg, m.action, m.time, m.uuid);
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
                        const leftNick = online[key].nick;
                        delete online[key];
                        updateUsers();

                        // Prevent duplicate leave broadcasts from multiple clients
                        if (recentLeaves.has(leftNick)) return;
                        recentLeaves.add(leftNick);

                        // Broadcast leave message with delay (give the leaving client time to broadcast first)
                        setTimeout(() => {
                            if (chat && myNick && leftNick) {
                                const leaveKey = Date.now() + '-leave-' + leftNick;
                                chat.get(leaveKey).put(JSON.stringify({
                                    nick: leftNick,
                                    text: 'left the room',
                                    time: Date.now(),
                                    action: false,
                                    type: 'system'
                                }));
                            }

                            // Clear from recentLeaves after 2 seconds
                            setTimeout(() => {
                                recentLeaves.delete(leftNick);
                            }, 2000);
                        }, 800);
                    }
                    return;
                }

                try {
                    const p = typeof data === 'string' ? JSON.parse(data) : data;
                    if (p && p.nick && p.lastSeen) {
                        // Ignore stale data (older than timeout)
                        if (Date.now() - p.lastSeen > PRESENCE_TIMEOUT) return;

                        // Cache UUID for this user
                        if (p.uuid) {
                            uuidCache[p.nick] = p.uuid;
                        }

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

            // Update relative timestamps every 10 seconds
            setInterval(() => {
                els.log.querySelectorAll('.irc-msg-time').forEach(timeEl => {
                    const timestamp = parseInt(timeEl.dataset.timestamp);
                    if (timestamp) {
                        timeEl.textContent = formatRelativeTime(timestamp);
                    }
                });
            }, 10000);

            els.status.textContent = 'Connected as ' + myNick;
        }

        function announce() {
            if (!myNick || !presence) return;
            // Use nick as key for stable identity
            presence.get(myNick).put({
                nick: myNick,
                uuid: myUUID,
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

            // Update online count in header
            els.onlineHeader.textContent = `Online [${nicks.length}]`;

            nicks.forEach(n => {
                const d = document.createElement('div');
                d.className = 'irc-user' + (n === myNick ? ' me' : '');
                d.textContent = n;

                // Apply color based on UUID
                const userData = online[n];
                if (userData && userData.uuid) {
                    d.style.color = uuidToColor(userData.uuid);
                }

                // Make clickable to insert mention (except for self)
                if (n !== myNick) {
                    d.style.cursor = 'pointer';
                    d.onclick = (e) => {
                        e.stopPropagation();
                        insertMention(n);
                    };
                }

                els.users.appendChild(d);
            });
        }


        function publishMessage(text, type = 'msg', forceAction = false) {
            if (!chat) return;
            const isAction = forceAction;
            const key = Date.now() + '-' + Math.random().toString(36).substr(2, 6);
            chat.get(key).put(JSON.stringify({
                nick: myNick,
                uuid: myUUID,
                text: text,
                time: Date.now(),
                action: isAction,
                type: type
            }));
        }

        function send() {
            const text = getInputText().trim();
            if (!text) return;
            setInputText('');

            // Check for help command
            if (text === '/help' || text === '/commands') {
                const commandList = Object.keys(COMMANDS).sort().join(', ');
                addMsg('', `Available commands: /${commandList}. Usage: /command or /command username`, true);
                return;
            }

            // Check for fun commands
            if (text.startsWith('/')) {
                const parts = text.slice(1).split(' ');
                const command = parts[0].toLowerCase();
                const target = parts.slice(1).join(' ').trim();

                if (COMMANDS[command]) {
                    const cmd = COMMANDS[command];
                    let actionText;

                    if (target) {
                        // Targeted action
                        actionText = cmd.target.replace('{target}', target);
                    } else {
                        // Solo action
                        actionText = cmd.solo;
                    }

                    // Send as action message
                    publishMessage(actionText, 'msg', true);
                    return;
                }
            }

            publishMessage(text);
        }

        function formatRelativeTime(timestamp) {
            const now = Date.now();
            const msgTime = timestamp || now;
            const diff = now - msgTime;
            const seconds = Math.floor(diff / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);

            if (seconds < 60) {
                return `[now]`;
            } else if (minutes < 60) {
                return minutes === 1 ? `[1min ago]` : `[${minutes} min ago]`;
            } else if (hours < 24) {
                return hours === 1 ? `[1hr ago]` : `[${hours} hrs ago]`;
            } else if (days === 1) {
                return `[yesterday]`;
            } else if (days <= 5) {
                return `[${days}days ago]`;
            } else {
                // Show date for messages older than 5 days
                const date = new Date(msgTime);
                const month = (date.getMonth() + 1).toString().padStart(2, '0');
                const day = date.getDate().toString().padStart(2, '0');
                return `[${month}/${day}]`;
            }
        }

        function addMsg(nick, text, isSystem, isAction, timestamp, userUuid) {
            // Collapse consecutive duplicate join/leave messages
            const isJoinLeave = isSystem && (text.includes('entered the room') || text.includes('left the room'));

            if (isJoinLeave && nick) {
                const msgKey = `${nick}:${text}`;

                // Check last message in the log to see if it's the same user + action
                const lastChild = els.log.lastElementChild;
                if (lastChild) {
                    const lastNick = lastChild.querySelector('.irc-msg-nick')?.textContent;
                    const lastText = lastChild.querySelector('.irc-msg-text')?.textContent;

                    // If last message is same user doing same action, replace it
                    if (lastNick === 'system' && lastText === `${nick} ${text}`) {
                        lastChild.remove();
                    }
                }

                lastSystemMsg[nick] = msgKey;
            }

            // Check if this message mentions the current user (and is not from self)
            const mentionsMe = !isSystem && nick !== myNick && myNick && text.toLowerCase().includes('@' + myNick.toLowerCase());

            const row = document.createElement('div');
            const isLeave = isSystem && text.includes('left the room');
            row.className = 'irc-msg' + (isLeave ? ' leave' : isSystem ? ' system' : '') + (isAction ? ' action' : '') + (mentionsMe ? ' mentioned' : '');

            // Format timestamp as relative time
            const timeEl = document.createElement('div');
            timeEl.className = 'irc-msg-time';
            timeEl.textContent = formatRelativeTime(timestamp);
            // Store timestamp for updates
            timeEl.dataset.timestamp = timestamp || Date.now();

            const nickEl = document.createElement('div');
            nickEl.className = 'irc-msg-nick';
            nickEl.textContent = isSystem ? 'system' : nick;

            // Apply color to nickname based on UUID
            if (!isSystem && nick) {
                // Try to get UUID from multiple sources (message, online users, or self)
                let uuid = null;
                if (nick === myNick) {
                    uuid = myUUID;
                } else if (userUuid) {
                    // Use UUID from the message (preserves color for offline users)
                    uuid = userUuid;
                } else if (online[nick] && online[nick].uuid) {
                    // Fallback to online user's UUID
                    uuid = online[nick].uuid;
                }

                if (uuid) {
                    nickEl.style.color = uuidToColor(uuid);
                }

                // Make clickable to insert mention (except for self and system)
                if (nick !== myNick) {
                    nickEl.style.cursor = 'pointer';
                    nickEl.onclick = (e) => {
                        e.stopPropagation();
                        insertMention(nick);
                    };
                }
            }

            const textEl = document.createElement('div');
            textEl.className = 'irc-msg-text';

            // Determine the full text to display
            let fullText;
            if (isSystem && nick) {
                fullText = '@' + nick + ' ' + text;
            } else if (isAction) {
                fullText = nick + ' ' + text;
            } else {
                fullText = text;
            }

            // Parse and colorize @mentions (for all messages including system messages)
            const parts = parseAndColorMentions(fullText);

            if (parts.length > 0) {
                // Build text with colored mentions
                parts.forEach(part => {
                    if (part.type === 'text') {
                        textEl.appendChild(document.createTextNode(part.content));
                    } else if (part.type === 'mention') {
                        const mentionSpan = document.createElement('span');
                        mentionSpan.className = 'irc-mention';
                        mentionSpan.textContent = part.content;

                        if (part.uuid) {
                            mentionSpan.style.color = uuidToColor(part.uuid);
                            mentionSpan.style.fontWeight = '600';
                        }

                        // Make clickable to insert mention (if not mentioning self)
                        if (part.nick !== myNick) {
                            mentionSpan.style.cursor = 'pointer';
                            mentionSpan.onclick = (e) => {
                                e.stopPropagation();
                                insertMention(part.nick);
                            };
                        }

                        textEl.appendChild(mentionSpan);
                    }
                });
            } else {
                textEl.textContent = fullText;
            }

            row.appendChild(timeEl);
            row.appendChild(nickEl);
            row.appendChild(textEl);
            els.log.appendChild(row);

            // Play notification sound if mentioned (only for new messages, not old ones on load)
            const messageTime = timestamp || Date.now();
            const isNewMessage = messageTime >= joinTime;

            if (mentionsMe && isNewMessage) {
                playNotificationSound();
            }

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
