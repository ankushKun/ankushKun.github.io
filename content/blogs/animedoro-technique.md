+++
date = '2026-10-13T09:00:00+05:30'
draft = false
title = "The Animedoro Technique: How It Works vs Pomodoro"
description = "Animedoro explained: 40 to 60 minutes of study, then one anime episode as the break. Origin, why the ratio works, Pomodoro and 52/17 compared, and a free timer."
summary = "I built one of the first Animedoro timers back in 2021, and it is still the most used thing I have ever shipped. This is the full explanation of the technique: the origin, the 40/20 ratio, how it compares to Pomodoro, who it suits, and how to keep one episode from becoming four."
tags = ["productivity", "animedoro", "web"]
related = ["/projects/2021.animedoro"]
links = [
  { label = "Open the Animedoro timer", url = "https://ankush.one/animedoro-timer/", icon = "globe" },
  { label = "Source on GitHub", url = "https://github.com/ankushKun/animedoro-timer", icon = "code" },
]
faq = [
  { q = "What is the Animedoro technique?", a = "Animedoro is a study method where you work for 40 to 60 minutes, then watch one anime episode, about 20 minutes, as your break, and repeat. It was named by medical student Josh Chen in a January 2021 YouTube video and is a longer-block variant of the Pomodoro technique." },
  { q = "What is the difference between Animedoro and Pomodoro?", a = "Pomodoro is 25 minutes of work and a 5 minute break, with a longer break every fourth round. Animedoro is 40 to 60 minutes of work and a 20 minute break shaped as one episode. The longer block suits deep work, and the episode gives the break a natural end." },
  { q = "How long should an Animedoro work block be?", a = "Start at 40 minutes. If you regularly hit the timer while still in flow, move to 50 or 60. If you drift before it rings, drop back. The episode stays at one episode regardless." },
  { q = "Does Animedoro work for ADHD?", a = "Many people with ADHD report it works better for them than Pomodoro, because 25 minutes can end before focus has started and a concrete, time-boxed reward is easier to commit to. The failure mode is the second episode, so use a timer that notifies you when the anime block is over." },
  { q = "Is there a free Animedoro timer?", a = "Yes. The Animedoro timer at ankush.one/animedoro-timer has been free and online since January 2021. It lets you set work and anime minutes, notifies you when each block ends, and counts your sessions locally without an account." },
  { q = "Can I use Animedoro with shows that are not anime?", a = "Yes. Josh Chen originally used sitcoms. Anything with 20 to 25 minute episodes works. Avoid cliffhanger-heavy shows if you have trouble stopping." },
]
+++

In January 2021 a medical student named Josh Chen posted a video titled ["How I Studied 600 hrs + Watched 300 hrs of Anime in 4 Months"](https://www.youtube.com/watch?v=bUjGZJIgse0). It has since passed a million and a half views, and it gave a name to a study pattern a lot of people were already half doing: work for a while, watch an episode, work again. He called it **Animedoro**. A couple of weeks later I built a small browser timer for it, mostly to learn HTML, and five years on it is still the most visited page I have ever made. So this is the explanation I wish had existed then.

## What Animedoro is

Animedoro is a time-boxing technique: **40 to 60 minutes of focused work, then one anime episode (about 20 minutes) as the break, then repeat.** That is the whole method. The name is anime plus pomodoro, after the Pomodoro technique whose tomato-shaped kitchen timer it borrows from.

Two things make it different from "study, then watch something":

1. **The work block is long enough to get somewhere.** Forty minutes is enough to load a hard problem into your head and make progress on it. Twenty-five often is not.
2. **The break has a built-in end.** An episode finishes. A five minute break does not; it leaks into fifteen. The episode is both the reward and the stop signal.

Chen describes it in his own video description as "an extended 52/17 pomodoro variant that I modified to fit my own needs," and notes he started with sitcoms, not anime. The ratio is the point, the medium is a preference.

## Animedoro vs Pomodoro vs 52/17

| | Pomodoro | 52/17 | Animedoro |
|---|---|---|---|
| Work block | 25 min | 52 min | 40 to 60 min |
| Break | 5 min, longer every 4th round | 17 min | One episode, ~20 min |
| Work to break | 5:1 | ~3:1 | 2:1 to 3:1 |
| Break ends on its own | No | No | Yes |
| Good for | Starting, shallow tasks, admin | Knowledge work | Deep study, long days |
| Risk | Breaking flow every 25 min | Unstructured break | Watching a second episode |

Pomodoro is the better tool for a task you are avoiding: 25 minutes is a small enough promise to actually start. Animedoro is the better tool once you are working: problem sets, reading, writing, coding, anything where the first ten minutes are warm-up. The 52/17 split comes from a 2014 DeskTime analysis of its most productive users and is, as Chen says, essentially what Animedoro is with a nicer break.

## Why the ratio works

Nothing here is magic, but three ordinary mechanisms stack up.

**Rewards you look forward to get you to sit down.** The hardest part of studying is starting. "Forty minutes, then the next episode of the show you are into" is a trade your brain will take. "Forty minutes, then five minutes of staring at your phone" is not.

**A break with a fixed end costs less.** Most break schemes fail at the resume step. With an episode, the credits roll and the decision is made for you. You already knew when it would end when you started it.

**Longer blocks match how focus actually builds.** Attention is not flat across a session; it ramps. Cutting at 25 minutes can mean cutting at the peak. Forty to sixty minutes lets the ramp pay off, and the long break afterwards is what makes the long block sustainable.

## How to run a session

1. Pick a show with 20 minute episodes that you have either already seen or that is not a cliffhanger machine. Slice-of-life is ideal. Shonen finales are not.
2. Set a timer for 40 minutes of work and 20 minutes of anime. [My timer](https://ankush.one/animedoro-timer/) defaults to exactly this and remembers your settings.
3. Work until it rings. If you are deep in something, add five minutes, not another forty.
4. Watch one episode. Skip the opening and ending; that is how a 24 minute episode fits a 20 minute break.
5. When the anime timer rings, start the next work block before you do anything else. The gap between episode and work is where sessions die.
6. Three or four rounds is a serious study day. Count them; the numbers are motivating.

## Who it suits, and who it does not

It suits people who find Pomodoro's blocks too short, people who already watch something between study sessions and want structure around it, and people who need a concrete reward to get started. Many people with ADHD say the longer block and the tangible reward work better for them than Pomodoro, with the caveat that the stop rule matters more, not less.

It does not suit tasks that are genuinely short, or days where you cannot trust yourself with the remote. If one episode reliably becomes three, switch the reward to something that cannot continue on its own: a walk, a meal, a game with fixed rounds.

## About the timer

I wrote the [Animedoro timer](https://ankush.one/animedoro-timer/) in January 2021 in plain HTML, CSS and JavaScript. It sets separate work and anime minutes, plays a sound and sends a browser notification when a block ends, has a +5 button, and keeps a count of your study and anime sessions and total hours in local storage. No account, no server, and the [source is on GitHub](https://github.com/ankushKun/animedoro-timer) if you want to run your own. The original animedoro.io site that Chen linked in his video is gone now, which is partly why so many people end up on mine.

If you want the method in Chen's own words, watch the original video. If you just want to try it, open the timer, set 40 and 20, and start.
