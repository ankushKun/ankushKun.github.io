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
  { platform: 'Discord', handle: '@ankushkun', url: 'https://discord.com/users/666578281142812673' },
  { platform: 'Instagram', handle: '@ankushKun_', url: 'https://instagram.com/ankushKun_' },
  { platform: 'Reddit', handle: 'u/TECHIE6023', url: 'https://reddit.com/user/TECHIE6023' },
  { platform: 'Medium', handle: '@ankushkun', url: 'https://ankushkun.medium.com' },
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

/** The footer at the end of every page. Home is the plaza, settled (see the TV's plaza button). */
export const FOOTER_NAV = [
  { label: 'Home', href: '/#0' },
  { label: 'About', href: '/about/' },
  { label: 'Blog', href: '/blogs/' },
  { label: 'Projects', href: '/projects/' },
  { label: 'Timeline', href: '/timeline/' },
  { label: 'Apps', href: '/apps/' },
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
 * The site worker (ankushKun.github.io/workers/site-worker) that searches Klipy for the chat's GIFs
 * with the key kept on its side. It answers only https://ankush.one. Empty turns GIFs off.
 */
export const GIF_PROXY = 'https://ankush-site-worker.ankushkun.workers.dev';

export const BOOKING_URL = 'https://cal.com/ankushkun/call';

/** Newsletter form target. Set `action` to your provider URL (Buttondown, ConvertKit, Resend...) to enable the form. */
export const NEWSLETTER = {
  action: '',
  emailField: 'email',
};
