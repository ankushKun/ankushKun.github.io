// Site wide settings. Everything here is placeholder data, replace it with the real values.

export const SITE = {
  url: 'https://ankush.one',
  title: 'Ankush Singh',
  description: 'Placeholder site description. One or two sentences on who you are and what you do.',
  locale: 'en_US',
  lang: 'en',
};

export const AUTHOR = {
  name: 'Ankush Singh',
  alternateName: ['Ankush Kun', 'ankushKun'],
  jobTitle: 'Placeholder role',
  worksFor: { name: 'Placeholder Company', url: 'https://example.com' },
  email: 'hello@example.com',
  location: 'Placeholder City, Country',
};

/** Profiles that represent you. Rendered on About and Contact, and used as schema.org sameAs. */
export const SOCIALS = [
  { platform: 'GitHub', handle: '@placeholder', url: 'https://github.com/placeholder' },
  { platform: 'X', handle: '@placeholder', url: 'https://x.com/placeholder' },
  { platform: 'LinkedIn', handle: 'placeholder', url: 'https://linkedin.com/in/placeholder' },
  { platform: 'YouTube', handle: '@placeholder', url: 'https://youtube.com/@placeholder' },
];

export const NAV = [
  { label: 'Blog', href: '/blogs/' },
  { label: 'Projects', href: '/projects/' },
  { label: 'Timeline', href: '/timeline/' },
  { label: 'Talks', href: '/talks/' },
  { label: 'About', href: '/about/' },
];

export const FOOTER_NAV = [
  { label: 'Now', href: '/now/' },
  { label: 'Resume', href: '/resume/' },
  { label: 'Consoles', href: '/console-collection/' },
  { label: 'Newsletter', href: '/newsletter/' },
  { label: 'Contact', href: '/contact/' },
  { label: 'Privacy', href: '/privacy/' },
  { label: 'Credits', href: '/credits/' },
  { label: 'RSS', href: '/blogs/index.xml' },
];

export const BOOKING_URL = 'https://cal.com/placeholder';

/** Newsletter form target. Point action at your provider (Buttondown, ConvertKit, Resend...). */
export const NEWSLETTER = {
  action: 'https://example.com/subscribe',
  emailField: 'email',
};
