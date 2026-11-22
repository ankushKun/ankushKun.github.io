// Slash commands, as the old site's IRC chat had them. Each turns what was typed into something to
// do: post a message, act, change your name, or show a note only you see.

/** Faces typed for you. */
const FACES: Record<string, string> = {
  shrug: '¯\\_(ツ)_/¯',
  tableflip: '(╯°□°)╯︵ ┻━┻',
  unflip: '┬─┬ノ( º _ ºノ)',
  lenny: '( ͡° ͜ʖ ͡°)',
};

/** Things you do, alone or to someone. */
const ACTIONS: Record<string, [solo: string, target: string]> = {
  slap: ['slaps the air dramatically', 'slaps {t} around a bit with a large trout'],
  hug: ['hugs themselves', 'hugs {t} warmly'],
  poke: ['pokes the void', 'pokes {t}'],
  wave: ['waves at everyone', 'waves at {t}'],
  dance: ['busts out some sick dance moves', 'dances with {t}'],
  highfive: ['high-fives the air... awkward', 'high-fives {t}'],
  fistbump: ['fist-bumps the air', 'fist-bumps {t}'],
  pat: ['pats their own head', 'pats {t} on the head'],
  tickle: ['tickles themselves and giggles', 'tickles {t} mercilessly'],
  boop: ['boops their own nose', "boops {t}'s nose"],
  throw: ['throws something at the wall', 'throws something at {t}'],
  bonk: ['bonks themselves on the head', 'bonks {t} with a hammer'],
  kick: ['kicks the wall in frustration', 'kicks {t}!'],
  hit: ['swings at the air', 'hits {t}!'],
};

export type Command =
  | { do: 'post'; text: string; action?: boolean }
  | { do: 'nick'; nick: string }
  | { do: 'clear' }
  | { do: 'note'; text: string };

export const HELP = [
  '**/me** does something',
  '**/nick** newname',
  '**/clear** empties your screen',
  `**/${Object.keys(ACTIONS).join('**, **/')}** someone`,
  `**/${Object.keys(FACES).join('**, **/')}**`,
].join('\n');

/** What a line typed into the box asks for. Anything that isn't a command is posted as it is. */
export function parse(line: string): Command {
  const m = /^\/([a-z0-9]+)(?:\s+([\s\S]*))?$/i.exec(line);
  if (!m) return { do: 'post', text: line };
  const name = m[1].toLowerCase();
  const rest = (m[2] ?? '').trim();
  if (name === 'help' || name === 'commands') return { do: 'note', text: HELP };
  if (name === 'me') return rest ? { do: 'post', text: rest, action: true } : { do: 'note', text: 'Usage: **/me** does something' };
  if (name === 'nick') return { do: 'nick', nick: rest };
  if (name === 'clear') return { do: 'clear' };
  if (FACES[name]) return { do: 'post', text: rest ? `${FACES[name]} ${rest}` : FACES[name] };
  const act = ACTIONS[name];
  if (act) return { do: 'post', text: rest ? act[1].replace('{t}', rest) : act[0], action: true };
  return { do: 'note', text: `There's no **/${name}**. Try **/help**.` };
}
