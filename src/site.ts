// Site-wide identity, navigation, social links, booking and newsletter settings.

export const SITE = {
  url: 'https://ankush.one',
  title: 'Ankush Kun',
  description:
    'Co-founder of Construct Computer. Building AI agents, developer tools, and Nintendo 3DS homebrew.',
  locale: 'en_US',
  lang: 'en',
};

export const AUTHOR = {
  name: 'Ankush Singh',
  alternateName: ['Ankush Kun', 'ankushKun'],
  jobTitle: 'Co-founder',
  worksFor: { name: 'Construct Computer', url: 'https://construct.computer' },
  alumniOf: { name: 'Chandigarh University' },
  email: 'ankush4singh@gmail.com',
  location: 'India',
  knowsAbout: [
    'AI Agents',
    'Developer Tools',
    'Cloudflare Workers',
    'Model Context Protocol',
    'TypeScript',
    'React',
    'Rust',
    'C++',
    'Solana',
    'Arweave',
    'AO',
    'Nintendo 3DS Homebrew',
    'Open Source',
  ],
};

/** Profiles that represent Ankush. Rendered on About and Contact, and used as schema.org sameAs. */
export const SOCIALS = [
  { platform: 'GitHub', handle: '@ankushKun', url: 'https://github.com/ankushKun' },
  { platform: 'X', handle: '@ankushKun_', url: 'https://x.com/ankushKun_' },
  { platform: 'LinkedIn', handle: 'ankushkun', url: 'https://linkedin.com/in/ankushkun' },
  { platform: 'YouTube', handle: '@ankushkun', url: 'https://youtube.com/@ankushkun' },
  { platform: 'Telegram', handle: '@ankushKun', url: 'https://t.me/ankushKun' },
  { platform: 'Discord', handle: '@ankushkun', url: 'https://discord.gg/fpKJebdQKZ' },
  { platform: 'Instagram', handle: '@ankushKun_', url: 'https://instagram.com/ankushKun_' },
  { platform: 'Reddit', handle: 'u/TECHIE6023', url: 'https://reddit.com/user/TECHIE6023' },
  { platform: 'Medium', handle: '@ankushkun', url: 'https://ankushkun.medium.com' },
];

/** Where people can chip in for the work. Rendered on About under Socials, where the footer's Support goes, and in the lobby (`short` under its mark on a phone). */
export const SUPPORT = [
  { platform: 'GitHub Sponsors', short: 'Sponsor', url: 'https://github.com/sponsors/ankushKun' },
  { platform: 'Ko-fi', short: 'Ko-fi', url: 'https://ko-fi.com/ankushkun' },
  { platform: 'Buy Me a Coffee', short: 'Coffee', url: 'https://buymeacoffee.com/ankushkun' },
];

export const NAV = [
  { label: 'Blog', href: '/blogs/' },
  { label: 'Projects', href: '/projects/' },
  { label: 'Timeline', href: '/timeline/' },
  { label: 'About', href: '/about/' },
  { label: 'Apps', href: '/apps/' },
];

/**
 * The home page's menu beside your floating Mii, for visitors who would rather not play
 * (plaza/Lobby.astro). `wide` links show on big screens only; they stay in the page for crawlers.
 */
export const LOBBY_NAV: { label: string; href: string; wide?: boolean }[] = [...NAV, { label: 'Games', href: '/games/', wide: true }];

/**
 * The lobby's other column, on the right on a big screen: things you've built, each opening its own site, with its
 * icon and, on a phone where it's a caption under the icon, a short name.
 */
export const LOBBY_BUILT: { label: string; short: string; href: string; icon: string }[] = [
  { label: 'Construct Computer', short: 'Construct', href: 'https://construct.computer', icon: '/favicons/construct.computer.png' },
  { label: 'Nepotism Network', short: 'NepoNet', href: 'https://nepotism.network', icon: '/favicons/nepotism.network.png' },
  { label: 'Silent Hill 2 on 3DS', short: 'SH2 3DS', href: 'https://ankush.one/sh23ds/', icon: '/lobby/sh23ds.png' },
  { label: '3dsDL', short: '3dsDL', href: 'https://ankush.one/3dsDL/', icon: '/lobby/3dsdl.png' },
  { label: 'BetterIDEa', short: 'BetterIDEa', href: 'https://betteridea.dev', icon: '/lobby/betteridea.png' },
];

/** The footer at the end of every page. Home is the plaza, settled (see the TV's plaza button). */
export const FOOTER_NAV = [
  { label: 'Home', href: '/#0' },
  { label: 'About', href: '/about/' },
  { label: 'Blog', href: '/blogs/' },
  { label: 'Projects', href: '/projects/' },
  { label: 'Timeline', href: '/timeline/' },
  { label: 'Apps', href: '/apps/' },
  { label: 'Support', href: '/about/#support' },
  { label: 'Privacy', href: '/privacy/' },
  { label: 'Credits', href: '/credits/' },
  { label: 'RSS', href: '/blogs/index.xml' },
];

/**
 * Chat names that can delete anyone's post on /apps/chat/. The relay has no accounts, so this only
 * decides who is shown Delete; it is moderation by courtesy, not a lock.
 */
export const CHAT_MODS = ['ankush'];

/**
 * The Worker in workers/gif-proxy that searches Klipy for the chat's GIFs, with the key kept on
 * its side as a secret. It answers only https://ankush.one. Empty turns GIFs off.
 */
export const GIF_PROXY = 'https://ankush-gif-proxy.ankushkun.workers.dev';

/**
 * PostHog analytics (src/scripts/analytics.ts): the EU project's key, the first-party proxy that
 * carries everything to it, and the app its links open. Empty `key` turns analytics off.
 */
export const POSTHOG = { key: 'phc_nBvIMuMmaqQkAXL36Bi6eyTRga0A04klevYFyZf4cfc', host: 'https://p1.ankush.one', ui: 'https://eu.posthog.com' };

/**
 * The other repos served under ankush.one whose names have capitals. GitHub Pages matches addresses
 * exactly, so the 404 page sends one in the wrong case on to the right spelling: one of these, or
 * else lowercase, as every page here and every other repo is.
 */
export const CASED_SITES = ['3dsDL', '3dsFM', 'Derived-Key-Manager'];

export const BOOKING_URL = 'https://cal.com/ankushkun/call';

/** Newsletter form target. Set `action` to your provider URL (Buttondown, ConvertKit, Resend...) to enable the form. */
export const NEWSLETTER = {
  action: '',
  emailField: 'email',
};
