// schema.org JSON-LD builders. Base.astro always emits website() and person();
// pages add their own nodes and point at those two by @id.
import { AUTHOR, SITE, SOCIALS } from '../site';
import { absUrl, isoDate, urlOf, type Entry } from './content';

export const WEBSITE_ID = `${SITE.url}/#website`;
export const PERSON_ID = `${SITE.url}/#person`;

type Node = Record<string, unknown>;

export const website = (): Node => ({
  '@type': 'WebSite',
  '@id': WEBSITE_ID,
  url: absUrl('/'),
  name: SITE.title,
  description: SITE.description,
  inLanguage: SITE.lang,
  publisher: { '@id': PERSON_ID },
});

export const person = (): Node => ({
  '@type': 'Person',
  '@id': PERSON_ID,
  name: AUTHOR.name,
  alternateName: AUTHOR.alternateName,
  url: absUrl('/'),
  email: `mailto:${AUTHOR.email}`,
  jobTitle: AUTHOR.jobTitle,
  worksFor: { '@type': 'Organization', ...AUTHOR.worksFor },
  sameAs: SOCIALS.map((s) => s.url),
});

export const breadcrumbs = (items: { name: string; path: string }[]): Node => ({
  '@type': 'BreadcrumbList',
  itemListElement: [{ name: 'Home', path: '/' }, ...items].map((item, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: item.name,
    item: absUrl(item.path),
  })),
});

export const webPage = (type: string, path: string, name: string, description: string, extra: Node = {}): Node => ({
  '@type': type,
  url: absUrl(path),
  name,
  description,
  isPartOf: { '@id': WEBSITE_ID },
  ...extra,
});

/** The main node for a blog post, project, timeline event, talk or console page. */
export function entryNode(entry: Entry, image?: string): Node {
  const { data } = entry;
  const base: Node = {
    url: absUrl(urlOf(entry)),
    name: data.title,
    description: data.description,
    ...(image && { image }),
    ...(data.tags.length && { keywords: data.tags }),
  };
  const dated = {
    datePublished: isoDate(data.date),
    dateModified: isoDate(data.updated ?? data.date),
    author: { '@id': PERSON_ID },
  };

  switch (entry.collection) {
    case 'blog':
      return { '@type': 'BlogPosting', headline: data.title, mainEntityOfPage: base.url, ...base, ...dated };
    case 'projects':
      return { '@type': 'CreativeWork', ...base, ...dated, sameAs: entry.data.links.map((l) => l.url) };
    case 'timeline':
      return { '@type': 'Article', headline: data.title, articleSection: entry.data.kind, ...base, ...dated };
    case 'talks':
      return {
        '@type': 'Event',
        ...base,
        startDate: isoDate(data.date),
        eventStatus: 'https://schema.org/EventScheduled',
        performer: { '@id': PERSON_ID },
        organizer: { '@type': 'Organization', name: entry.data.event },
        ...(entry.data.location && { location: { '@type': 'Place', name: entry.data.location, address: entry.data.location } }),
        ...(entry.data.video && { recordedIn: { '@type': 'VideoObject', name: data.title, contentUrl: entry.data.video } }),
      };
    case 'consoles':
      return {
        '@type': 'WebPage',
        ...base,
        about: { '@type': 'Product', name: data.title, brand: { '@type': 'Brand', name: entry.data.maker }, releaseDate: String(entry.data.released) },
      };
  }
}
