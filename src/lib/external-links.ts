// A Sätteri plugin (astro.config.mjs): every link out of the site in Markdown opens in a new tab. It
// gets target and rel, the small arrow after its text (a.ext in global.css) and words saying so for
// screen readers. A link around a picture keeps the new tab but gets no arrow. A link written as
// HTML in the Markdown gets the new tab and the arrow on its opening tag. Astro caches rendered
// Markdown: after changing this file, delete node_modules/.astro/data-store.json before building.
import type { satteri } from '@astrojs/markdown-satteri';
import { NEW_TAB, isExternal } from './external';

type Entry = NonNullable<NonNullable<Parameters<typeof satteri>[0]>['hastPlugins']>[number];
type Plugin = Extract<Entry, { name: string; element?: unknown }>;
type Node = { type: string; tagName?: string; children?: readonly Node[] };

const PICTURES = ['img', 'picture', 'video', 'svg'];
const holdsPicture = (node: Node): boolean =>
  (node.children ?? []).some((c) => (c.type === 'element' && PICTURES.includes(c.tagName ?? '')) || holdsPicture(c));

/** An opening <a> tag in raw HTML whose href leaves the site, and has no target of its own. */
const RAW_LINK = /<a\b(?![^>]*\btarget=)([^>]*\bhref=["']https?:\/\/[^>]*)>/gi;
const rawLink = (_: string, attrs: string) =>
  `<a${/\bclass=/i.test(attrs) ? attrs : `${attrs} class="ext"`} target="_blank" rel="noopener">`;

export const externalLinks: Plugin = {
  name: 'external-links',
  raw(node, ctx) {
    const value = node.value.replace(RAW_LINK, rawLink);
    if (value !== node.value) ctx.setField(node, 'value', value);
  },
  element: {
    filter: ['a'],
    visit(node, ctx) {
      const href = node.properties.href;
      if (!isExternal(typeof href === 'string' ? href : undefined)) return;
      ctx.setProperty(node, 'target', '_blank');
      ctx.setProperty(node, 'rel', ['noopener']);
      if (!holdsPicture(node)) {
        const classes = Array.isArray(node.properties.className) ? node.properties.className : [];
        ctx.setProperty(node, 'className', [...classes, 'ext']);
      }
      ctx.appendChild(node, {
        type: 'element',
        tagName: 'span',
        properties: { className: ['sr-only'] },
        children: [{ type: 'text', value: ` ${NEW_TAB}` }],
      });
    },
  },
};
