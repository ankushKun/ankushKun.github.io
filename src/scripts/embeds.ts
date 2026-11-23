// Live embeds in posts. A post marks one with <figure data-embed="https://.../embed/?..."> around a
// plain link to the same tool, so the Markdown twin and any reader without the embed still get there.
// The frame loads when the figure nears the screen and stays hidden until the page inside says it's
// ready, so a host that refuses to be framed leaves only the link. The embedded page talks back with
// postMessage: { source: 'construct-embed', type: 'ready' | 'height', height }. It gets the theme in its
// address and again whenever it changes here: { source: 'construct-embed', type: 'theme', theme }.
const SOURCE = 'construct-embed';
const html = document.documentElement;
const theme = () => (html.dataset.theme === 'dark' ? 'dark' : 'light');
const embedded = new Map<Window, HTMLElement>();

function mount(figure: HTMLElement) {
  const src = figure.dataset.embed;
  if (!src || figure.querySelector('iframe')) return;
  const url = new URL(src);
  url.searchParams.set('theme', theme());
  const frame = document.createElement('iframe');
  frame.src = url.href;
  frame.title = figure.querySelector('a')?.textContent?.trim() || 'Embedded tool';
  frame.setAttribute('allow', 'clipboard-write');
  figure.prepend(frame);
  if (frame.contentWindow) embedded.set(frame.contentWindow, figure);
}

const seen = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      seen.unobserve(e.target);
      mount(e.target as HTMLElement);
    }
  },
  { rootMargin: '600px 0px' },
);

window.addEventListener('message', (e) => {
  const figure = e.source && embedded.get(e.source as Window);
  const data = e.data as { source?: string; type?: string; height?: number } | null;
  if (!figure || data?.source !== SOURCE || e.origin !== new URL(figure.dataset.embed!).origin) return;
  if (data.type === 'ready') figure.dataset.ready = '';
  if (typeof data.height === 'number' && data.height > 0) {
    figure.querySelector('iframe')!.style.height = `${Math.ceil(data.height)}px`;
  }
});

new MutationObserver(() => {
  for (const [win, figure] of embedded) {
    if (!figure.isConnected) embedded.delete(win);
    else win.postMessage({ source: SOURCE, type: 'theme', theme: theme() }, new URL(figure.dataset.embed!).origin);
  }
}).observe(html, { attributes: true, attributeFilter: ['data-theme'] });

document.addEventListener('astro:page-load', () => {
  for (const figure of document.querySelectorAll<HTMLElement>('figure[data-embed]')) seen.observe(figure);
});
