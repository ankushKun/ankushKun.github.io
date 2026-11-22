// A page's Markdown, as cat shows it: headings, paragraphs, lists, quotes and code, with links you
// can press. Drawn as DOM text, never as HTML, and only as much Markdown as the site's pages use.
// Pictures show as their alt text; raw HTML is left out.

/** Inline Markdown into nodes: **bold**, *italic*, `code` and [links](url). */
export function inline(text: string, base: string): Node[] {
  const out: Node[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(document.createTextNode(text.slice(last, m.index)));
    last = m.index! + m[0].length;
    if (m[2]) out.push(el('b', m[2]));
    else if (m[3]) out.push(el('code', m[3]));
    else if (m[4]) {
      const href = linkHref(m[5], base);
      if (!href) out.push(document.createTextNode(m[4]));
      else {
        const a = el('a', m[4]) as HTMLAnchorElement;
        a.href = href;
        if (/^https?:/.test(href) && !href.startsWith(location.origin)) {
          a.target = '_blank';
          a.rel = 'noopener';
        }
        out.push(a);
      }
    } else out.push(el('i', m[6] ?? m[7]));
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

function linkHref(raw: string, base: string) {
  if (/^(https?:|mailto:)/.test(raw)) return raw;
  if (raw.startsWith('/')) return raw;
  if (raw.startsWith('#')) return base + raw;
  // Pictures and files beside the page are left out; there is nothing to open in a terminal.
  return null;
}

function el(tag: string, text: string) {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}

export function markdown(src: string, base: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'md';
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  let list: HTMLElement | null = null;
  const flush = () => {
    if (para.length) {
      const p = root.appendChild(document.createElement('p'));
      p.append(...inline(para.join(' '), base));
    }
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      flush();
      list = null;
      const code: string[] = [];
      while (++i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i]);
      const pre = root.appendChild(document.createElement('pre'));
      pre.textContent = code.join('\n');
      continue;
    }
    if (!line.trim()) {
      flush();
      list = null;
      continue;
    }
    // Raw HTML, imports and components: not for a terminal.
    if (/^\s*<\/?[a-z!]/i.test(line) || /^(import|export) /.test(line)) continue;
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      list = null;
      const e = root.appendChild(document.createElement(h[1].length === 1 ? 'h2' : 'h3'));
      e.append(...inline(h[2], base));
      continue;
    }
    const img = /^\s*!\[([^\]]*)\]\([^)]*\)\s*$/.exec(line);
    if (img) {
      flush();
      root.appendChild(el('p', `[picture${img[1] ? `: ${img[1]}` : ''}]`)).className = 'md-pic';
      continue;
    }
    const li = /^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      if (!list || list.tagName !== (li[1] ? 'OL' : 'UL')) list = root.appendChild(document.createElement(li[1] ? 'ol' : 'ul'));
      list.appendChild(document.createElement('li')).append(...inline(li[2], base));
      continue;
    }
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) {
      flush();
      list = null;
      root.appendChild(document.createElement('blockquote')).append(...inline(q[1], base));
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flush();
      continue;
    }
    // A table, as its rows of text.
    if (/^\s*\|/.test(line)) {
      flush();
      list = null;
      const rows: string[] = [];
      for (; i < lines.length && /^\s*\|/.test(lines[i]); i++) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join('  |  '));
      }
      i--;
      const pre = root.appendChild(document.createElement('pre'));
      pre.textContent = rows.join('\n');
      continue;
    }
    list = null;
    para.push(line.trim().replace(/!\[([^\]]*)\]\([^)]*\)/g, '[picture: $1]'));
  }
  flush();
  return root;
}
