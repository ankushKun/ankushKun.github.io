// The home folder the Terminal's Linux moves into (linux.ts), for whoever pokes around: a README
// with a hint, notes, a .plan, a shell history to snoop on, a text adventure and a guessing game in
// BusyBox shell, miisay, and a trail of secrets that ends in a trophy. Plain text by path from home;
// the site's pages (site/) and the radio's playlist (music/) are added beside these when it boots.
// Scripts must run in BusyBox ash: no bash-only syntax.

export function homeFiles(nick: string): Record<string, string> {
  return {
    '.motd': `
  .--------------------------------.
  |  ankush.one                    |
  |  Linux 5.6, BusyBox, 64 MB     |
  |  running in your browser tab   |
  '--------------------------------'

  Welcome, ${nick}. This is a real Linux.
  Nothing you do here leaves this tab.

  Start with:   cat README
  Get out with: poweroff

`,

    README: `Hi! You booted a whole computer inside a web page. Respect.

Things to do in here:

  ls -a              there is more here than it looks
  cat notes/todo.txt what I am meant to be doing
  less site/blog/    every post on the site, as text
  grep -ri 3ds site  search the lot
  miisay hello       a Mii says something
  games/guess.sh     guess the number
  games/plaza.sh     a very small adventure

It can reach the rest of the site too:

  open site/about.md show a page on the TV
  play doom          start a game
  music next         the radio (play, pause, next, prev, np)
  theme night        lights off
  upload             bring files in from your computer (or drop them here)
  download <file>    save a file to your computer
  wget http://...    the internet, as far as this browser allows

Somewhere in here there is a trophy. The adventure knows the way.
`,

    '.plan': `Plan for this week:

- make the plaza crowd 10% more chaotic
- teach Miku a second dance
- fix the bug where Miis thrown off the plaza come back angrier
- reply to the guestbook
- stop hiding things in the terminal (not happening)
`,

    '.ash_history': `ls
cd projects
git push --force
git push --force
git push --force # it's friday, what could go wrong
sudo make me a sandwich
vim plaza.ts
:q
:q!
how do i exit vim
pnpm build
pnpm build
pnpm build && echo it works on my machine
cat ~/.secrets/diary.txt
rm -rf node_modules && pnpm install
`,

    'notes/todo.txt': `TODO
[x] build a Wii U plaza in the browser
[x] make the Miis throwable
[x] make the thrown Miis angry about it
[x] Hatsune Miku DJ with backup dancers
[x] Paint, Guestbook, Terminal
[ ] sleep
[ ] touch grass (the plaza has a floor, does that count)
`,

    'notes/ideas.txt': `Ideas, in no order:

- a Mii that follows your cursor and judges your scrolling
- a StreetPass for websites
- a Tomodachi Life island where the Miis are everyone who signed the guestbook
- port Silent Hill 2 to something even smaller (the 3DS was not small enough?)
`,

    'notes/hello.c': `#include <stdio.h>

int main(void) {
    /* There is no compiler in here. This file is just for looking at. */
    puts("hello from ankush.one");
    return 0;
}
`,

    '.secrets/diary.txt': `Dear diary,

Day 1: Got made in the Mii Maker. Nice hair.
Day 2: Someone picked me up and threw me across the plaza. Rude.
Day 3: Someone threw me again. I have started to enjoy it.
Day 9: The DJ played Theme of Laura four times in a row. Nobody complained.
Day 12: Hid the trophy behind a door with a speaker on it. It only opens
        for the word Miiverse used when you liked a post.

P.S. If you are reading this, you are not supposed to be.
`,

    '.secrets/.deeper/trophy.txt': `
        ___________
       '._==_==_=_.'
       .-\\:      /-.
      | (|:.     |) |
       '-|:.     |-'
         \\::.    /
          '::. .'
            ) (
          _.' '._
         '-------'

  You found the trophy, ${nick}.

  Not many people get this far. Sign the guestbook and
  put WARAWARA somewhere in your note, so I know it was you.
`,

    'bin/miisay': `#!/bin/sh
# miisay: like cowsay, but a Mii.
msg="$*"
[ -z "$msg" ] && msg="Hi! I'm a Mii."
bar=$(printf '%s' "$msg" | sed 's/./-/g')
echo " -$bar-"
echo "< $msg >"
echo " -$bar-"
echo "      \\\\    ___"
echo "       \\\\  (o o)"
echo "           \\\\_/"
echo "          /| |\\\\"
echo "           / \\\\"
`,

    'bin/open': `#!/bin/sh
# open: shows a page of the site on the TV (open site/blog/some-post.md, open /games/),
# or a link in a new tab.
if [ -z "$1" ]; then
  echo "open what? Try: open site/about.md"
  exit 1
fi
t="$1"
[ -e "$t" ] && t=$(readlink -f "$t")
printf '\\033]7777;open;%s\\007' "$t"
`,

    'bin/theme': `#!/bin/sh
# theme: day or night, for the whole site.
printf '\\033]7777;theme;%s\\007' "$1"
`,

    'bin/music': `#!/bin/sh
# music: the site's radio. music play, pause, next, prev, np.
printf '\\033]7777;music;%s\\007' "\${1:-np}"
sleep 1
cat /mnt/.np 2>/dev/null
`,

    'bin/upload': `#!/bin/sh
# upload: pick files on your computer and they land here.
rm -f /mnt/.upload-done
printf '\\033]7777;upload;\\007'
echo "Pick a file in the window that opened..."
i=0
while [ ! -e /mnt/.upload-done ]; do
  sleep 1
  i=$((i + 1))
  [ $i -gt 300 ] && { echo "Gave up waiting."; exit 1; }
done
n=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  mv "/mnt/uploads/$f" . && echo "  $f" && n=$((n + 1))
done < /mnt/.upload-done
rm -f /mnt/.upload-done
[ $n -eq 0 ] && echo "Nothing uploaded." || echo "Uploaded $n file(s) to $(pwd)."
`,

    'bin/download': `#!/bin/sh
# download <file>: saves a file from in here to your computer.
if [ -z "$1" ] || [ ! -f "$1" ]; then
  echo "download what? Try: download notes/todo.txt"
  exit 1
fi
name=$(basename "$1")
cp "$1" "/mnt/downloads/$name" && sync
printf '\\033]7777;download;%s\\007' "$name"
echo "Saving $name..."
`,

    'bin/plaza': `#!/bin/sh
# A plaza, as far as text can draw one.
echo "   ___   ___   ___   ___"
echo "  |   | |   | |   | |   |    o    o"
echo "  |___| |___| |___| |___|   /|\\\\  /|\\\\   o"
echo "     o      o          o    / \\\\  / \\\\  /|\\\\"
echo "    /|\\\\    /|\\\\   o     /|\\\\              / \\\\"
echo "    / \\\\    / \\\\  /|\\\\    / \\\\    o"
echo "                / \\\\          /|\\\\   (they are all talking about you)"
echo "                              / \\\\"
`,

    'games/guess.sh': `#!/bin/sh
# Guess the number.
n=$(( $(date +%s) % 100 + 1 ))
tries=0
echo "I'm thinking of a number from 1 to 100."
while :; do
  printf "Your guess: "
  read g || exit 0
  case "$g" in
    ''|*[!0-9]*) echo "A number, please."; continue ;;
  esac
  tries=$((tries + 1))
  if [ "$g" -lt "$n" ]; then echo "Higher."
  elif [ "$g" -gt "$n" ]; then echo "Lower."
  else
    echo "Yes! $n, in $tries tries."
    [ "$tries" -le 7 ] && echo "That's as good as it gets."
    exit 0
  fi
done
`,

    'games/plaza.sh': `#!/bin/sh
# A very small adventure. Type look, go north/south/east/west (or n/s/e/w), take, open, quit.
room=plaza
key=no
say() { printf '%s\\n' "$*"; }
look() {
  case $room in
    plaza)
      say "You're in the WaraWara Plaza. Miis wander about, chatting in bubbles."
      say "Paths lead north to the chat, east to the paint studio, and south to a small door." ;;
    chat)
      say "The chat room. Someone has posted 'meow meow' forty times."
      say "A sticky note on the wall says: the door likes to be liked."
      say "The plaza is back south." ;;
    studio)
      say "The paint studio. Today's canvas is half a lighthouse."
      [ $key = no ] && say "A small brass key is stuck in a pot of red paint."
      say "The plaza is back west." ;;
    door)
      say "A small door with a keyhole and a speaker grille beside it."
      say "The plaza is back north." ;;
  esac
}
say "WARAWARA ADVENTURE"
say ""
look
while :; do
  printf "> "
  read a b || exit 0
  case "$a $b" in
    "look "*|"l "*) look ;;
    "go north"|"n "|"north ") [ $room = plaza ] && room=chat || { [ $room = door ] && room=plaza || say "You can't go that way."; }; look ;;
    "go south"|"s "|"south ") [ $room = plaza ] && room=door || { [ $room = chat ] && room=plaza || say "You can't go that way."; }; look ;;
    "go east"|"e "|"east ") [ $room = plaza ] && room=studio || say "You can't go that way."; look ;;
    "go west"|"w "|"west ") [ $room = studio ] && room=plaza || say "You can't go that way."; look ;;
    "take key"|"take "|"get key")
      if [ $room = studio ] && [ $key = no ]; then key=yes; say "You pull the key out of the paint. Your hands are red now."
      else say "There's nothing to take."; fi ;;
    "open door"|"open "|"use key")
      if [ $room != door ]; then say "There's no door here."
      elif [ $key = no ]; then say "It's locked. There's a keyhole."
      else
        say "The key turns. The speaker crackles: 'What do you say when you like something?'"
        printf "> "
        read w
        case "$w" in
          [Yy]eah|[Yy]eah!|YEAH*)
            say "The door swings open. Behind it, a staircase down into the dark."
            say "Painted on the wall: ls -a ~/.secrets"
            exit 0 ;;
          *) say "The speaker sighs. The door stays shut." ;;
        esac
      fi ;;
    "quit "|"q "|"exit ") say "Bye!"; exit 0 ;;
    *) say "You can look, go north, south, east or west, take, open, or quit." ;;
  esac
done
`,
  };
}
