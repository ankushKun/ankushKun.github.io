(function () {
    'use strict';

    const GUN_RELAY = 'https://gun.ankush.one/gun';
    const ROOT = 'ankush-one';

    function getGun() {
        if (!window.__siteGun) {
            window.__siteGun = Gun({ peers: [GUN_RELAY] });
        }
        return window.__siteGun;
    }

    function gunRoot() {
        return getGun().get(ROOT);
    }

    const paths = {
        live: {
            cursors: () => gunRoot().get('live').get('cursors'),
            ircPresence: (channel = 'general') =>
                gunRoot().get('live').get('irc').get(channel).get('presence'),
        },
        apps: {
            ircMessages: (channel = 'general') =>
                gunRoot().get('apps').get('irc').get(channel).get('messages'),
        },
    };

    window.SiteGun = { getGun, paths, GUN_RELAY, ROOT };
})();
