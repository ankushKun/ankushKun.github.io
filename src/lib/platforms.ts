// The platforms the site links to, each with its real mark: Simple Icons (CC0, `simple-icons`) where
// it has one, vendored below where it does not. A link to any other site shows that site's own icon
// (scripts/favicons.mjs), or a globe. Adding a platform is one row. Cal.com is left to its own icon:
// Simple Icons only has its wordmark, which is unreadable at badge size.
import {
  siAppstore,
  siBuymeacoffee,
  siGithubsponsors,
  siKofi,
  siArxiv,
  siChromewebstore,
  siDevpost,
  siDiscord,
  siFirefoxbrowser,
  siGithub,
  siInstagram,
  siInternetarchive,
  siInternetcomputer,
  siItchdotio,
  siMedium,
  siNpm,
  siProducthunt,
  siReddit,
  siTelegram,
  siTopdotgg,
  siVercel,
  siX,
  siYcombinator,
  siYoutube,
} from 'simple-icons';

export interface Platform {
  name: string;
  /** The mark, one path on a 24 by 24 grid, drawn white on `bg`. */
  path: string;
  /** Any CSS background: the brand's color, or Instagram's gradient. */
  bg: string;
  hosts: string[];
  /** A mark that is itself a rounded square (Medium) fills the badge, drawn in `ink` on `bg`. */
  bleed?: boolean;
  ink?: string;
}

/** LinkedIn asked Simple Icons to drop its mark; this is its official "in" from Simple Icons 9 (CC0). */
const LINKEDIN =
  'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z';

const si = (icon: { title: string; path: string; hex: string }, hosts: string[], bg = `#${icon.hex}`): Platform => ({
  name: icon.title,
  path: icon.path,
  bg,
  hosts,
});

export const PLATFORMS: Platform[] = [
  si(siGithubsponsors, ['github.com/sponsors']),
  si(siGithub, ['github.com']),
  si(siX, ['x.com', 'twitter.com']),
  si(siYoutube, ['youtube.com', 'youtu.be']),
  si(siDiscord, ['discord.com', 'discord.gg']),
  { name: 'LinkedIn', path: LINKEDIN, bg: '#0a66c2', hosts: ['linkedin.com'] },
  si(siTelegram, ['t.me', 'telegram.me']),
  si(siInstagram, ['instagram.com'], 'radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285aeb 90%)'),
  si(siReddit, ['reddit.com']),
  { ...si(siMedium, ['medium.com'], '#fff'), bleed: true, ink: '#000' },
  si(siNpm, ['npmjs.com']),
  si(siProducthunt, ['producthunt.com']),
  si(siItchdotio, ['itch.io']),
  si(siChromewebstore, ['chromewebstore.google.com']),
  si(siFirefoxbrowser, ['addons.mozilla.org']),
  si(siAppstore, ['apps.apple.com']),
  si(siDevpost, ['devpost.com']),
  si(siVercel, ['vercel.app']),
  si(siInternetcomputer, ['icp0.io']),
  si(siInternetarchive, ['archive.org']),
  si(siYcombinator, ['news.ycombinator.com']),
  si(siArxiv, ['arxiv.org']),
  si(siTopdotgg, ['top.gg']),
  si(siKofi, ['ko-fi.com']),
  { ...si(siBuymeacoffee, ['buymeacoffee.com']), ink: '#000' },
];

/**
 * The platform a host belongs to, its subdomains included (gist.github.com is GitHub). A platform listed with a path,
 * like github.com/sponsors, wins for addresses under that path.
 */
export function platformFor(host: string, path = ''): Platform | undefined {
  const h = host.toLowerCase().replace(/^www\./, '');
  const at = `${h}${path.toLowerCase().replace(/\/$/, '')}`;
  const under = (d: string) => at === d || at.startsWith(`${d}/`);
  const onHost = (d: string) => h === d || h.endsWith(`.${d}`);
  return (
    PLATFORMS.find((p) => p.hosts.some((d) => d.includes('/') && under(d))) ??
    PLATFORMS.find((p) => p.hosts.some((d) => !d.includes('/') && onHost(d)))
  );
}
