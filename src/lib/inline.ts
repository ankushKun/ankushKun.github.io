// Inline markdown for short strings in data files and FAQs: **bold**, *italic*, `code` and [links](url).
// Links out of the site open in a new tab, as they do in Markdown (src/lib/external.ts).
import { NEW_TAB, isExternal } from './external';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const link = (_: string, text: string, href: string) =>
  isExternal(href)
    ? `<a href="${href}" class="ext" target="_blank" rel="noopener">${text}<span class="sr-only">${NEW_TAB}</span></a>`
    : `<a href="${href}">${text}</a>`;

export const inline = (s: string) =>
  escape(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, link)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
