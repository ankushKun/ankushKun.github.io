// Gives X's crawler a player card for the home page, so a post linking ankush.one plays the live
// plaza (/player/) right in the post, with the card picture as the still until it is pressed.
// Everyone else gets the page as built: iMessage and Telegram read the same tags and would show a
// player card as a small picture. Runs on the route `ankush.one/` only (wrangler.toml).
const PLAYER = { path: '/player/', width: '1200', height: '630' };

export default {
  async fetch(request) {
    const response = await fetch(request);
    const agent = request.headers.get('user-agent') ?? '';
    const html = response.headers.get('content-type')?.includes('text/html');
    if (!agent.startsWith('Twitterbot/') || !html) return response;
    const player = new URL(PLAYER.path, request.url).href;
    return new HTMLRewriter()
      .on('meta[name="twitter:card"]', {
        element(el) {
          el.setAttribute('content', 'player');
          el.after(
            `<meta name="twitter:player" content="${player}"><meta name="twitter:player:width" content="${PLAYER.width}"><meta name="twitter:player:height" content="${PLAYER.height}">`,
            { html: true },
          );
        },
      })
      .transform(response);
  },
};
