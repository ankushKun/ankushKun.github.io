// Faces the slash commands type for you. Kept apart from commands.ts so the formatter can draw
// them as they are: their _ and * would otherwise read as Markdown (the shrug lost its arms).

/** Typed for you, with whatever follows after them. */
export const FACES: Record<string, string> = {
  shrug: '¯\\_(ツ)_/¯',
  tableflip: '(╯°□°)╯︵ ┻━┻',
  rageflip: '(ノಠ益ಠ)ノ彡┻━┻',
  doubleflip: '┻━┻ ︵ヽ(`Д´)ﾉ︵ ┻━┻',
  unflip: '┬─┬ノ( º _ ºノ)',
  lenny: '( ͡° ͜ʖ ͡°)',
  disapprove: 'ಠ_ಠ',
  cool: '(⌐■_■)',
  deal: '( •_•)>⌐■-■',
  flex: 'ᕦ(ò_óˇ)ᕤ',
  fight: '(ง •̀_•́)ง',
  gimme: '༼ つ ◕_◕ ༽つ',
  yay: '\\(^o^)/',
  party: 'ヽ(⌐■_■)ノ♪♬',
  boogie: '♪┏(・o・)┛♪┗ ( ・o・) ┓♪',
  love: '(♥ω♥*)',
  snuggle: '(づ｡◕‿‿◕｡)づ',
  happy: '(◕‿◕)',
  blush: '(⁄ ⁄•⁄ω⁄•⁄ ⁄)',
  cry: '(╥﹏╥)',
  sad: '(｡•́︿•̀｡)',
  why: 'щ(ﾟДﾟщ)',
  whatever: '(¬_¬)',
  sleepy: '(－_－) zzZ',
  hide: '┬┴┬┴┤･ω･)ﾉ├┬┴┬┴',
  run: 'ᕕ( ᐛ )ᕗ',
  bow: 'm(_ _)m',
  o7: '(￣^￣)ゞ',
  wizard: '(∩｀-´)⊃━☆ﾟ.*･｡ﾟ',
  fingerguns: '(☞ﾟヮﾟ)☞',
  bear: 'ʕ•ᴥ•ʔ',
  kitty: '(=^･ω･^=)',
  fish: '><(((º>',
  sparkles: '✧･ﾟ: *✧･ﾟ:*',
};

/** /sparkle's ends, which wrap someone's words. */
export const SPARKLE = ['✧･ﾟ: *✧･ﾟ:*', '*:･ﾟ✧*:･ﾟ✧'] as const;

/** Every face and kaomoji end, as text never to format. */
export const LITERALS = [...Object.values(FACES), ...SPARKLE];
