// Links out of the site open in a new tab. Every absolute http(s) URL counts as one: links within the
// site are written as paths. Shared by the link buttons, inline() and the Markdown plugin, so the
// rule lives in one place.

export const isExternal = (href?: string): href is string => Boolean(href && /^https?:\/\//i.test(href));

/** The attributes an external link carries, to spread onto an <a>: `<a {href} {...extAttrs(href)}>`. */
export const extAttrs = (href?: string) => (isExternal(href) ? { target: '_blank', rel: 'noopener' } : {});

/** Words for screen readers after the text of a link that opens a new tab. */
export const NEW_TAB = '(opens in a new tab)';
