---
title: "Jev for AI agents: what we learned testing it"
description: "TypeSafe's Jev on an AI agent's entity matching: measured latency, how we set a 0.7 threshold, where Jev fails and what it costs."
date: 2026-09-30
updated: 2026-11-13
tags: ["ai-agents", "machine-learning", "construct"]
cover: ./cover.webp
coverAlt: "What we learned testing TypeSafe's Jev decision model"
canonical: "https://construct.computer/blog/jev-ai-agents/"
related: ["/blogs/clef-vs-jev-benchmark", "/blogs/cheap-llm-for-ai-agents", "/projects/construct-computer"]
---
Jev is a decision model from TypeSafe AI: you give it a state and a set of typed questions, and instead of generating text it returns a probability for each possible answer, in well under a second, for $0.042 per million input tokens with output free. TypeSafe released it in early access on September 15, 2026. Five days later we tested it on one of an agent's memory decisions: whether a person or project the agent had just read about was one it already knew.

> **Note, November 13, 2026.** The method (state in, probabilities out, a threshold placed by what each mistake costs) carries over to any decision model, including [Cloudflare's Clef, which we benchmarked against Jev](https://construct.computer/blog/clef-vs-jev-benchmark/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost).

Here is the problem we tested Jev on. Your AI agent reads an email that mentions "Dr. Priya Shah". Last week it met "Priya Shah" in a meeting invite. Same person? Guess yes and get it wrong, and two people's histories are welded together in its memory. Guess no and get it wrong, and you have a duplicate. It makes that call every time it learns something, in the background, where nobody is watching.

The numbers in this post come from our own tests, measured on September 20, 2026 against `jev-1.13.0`. Everything else about Jev comes from TypeSafe's launch post and docs and from independent tests, all checked on **September 30, 2026**.

| What we measured                           | Result                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| Latency, one question on about 400 tokens  | 358 to 611 ms                                                              |
| Latency, seven questions on the same state | 377 to 544 ms                                                              |
| Change between repeated identical calls    | 0.02 at most                                                               |
| Merge threshold                            | 0.7, with real matches at 0.71 to 0.82 and everything else at 0.34 or less |
| Calls per entity                           | One, scoring every candidate at once                                       |
| Cost                                       | About $0.017 per 1,000 decisions of 400 input tokens at list price         |

## What is Jev?

Jev is a decision model, and TypeSafe says it is not a large language model: it never generates text. TypeSafe AI calls Jev the first "System One model", after the fast, intuitive System 1 in Daniel Kahneman's _Thinking, Fast and Slow_, and describes it as "a frontier-intelligence function call: unstructured state in, typed probabilistic decisions out" ([TypeSafe](https://typesafe.ai/blog/introducing-system-one-models-and-jev)).

You send one `state`, as text or JSON, and a map of named questions. These are the three question types we used ([TypeSafe API reference](https://docs.typesafe.ai/api)):

- Choice picks one of up to 255 labels you define and returns a probability for every label.
- Score rates the state on an ordered scale of up to 10 levels.
- Noul, short for Bernoulli, returns the probability that a statement is true.

The API now has a fourth type, Box, for questions about images.

Every question is answered against the same state in one parallel pass, so adding questions barely changes the response time. Jev can't write a sentence, and that is the point: you read typed values instead of parsing prose, output tokens cost nothing, and an answer can't fall outside the labels you gave it.

|                                   | Jev (System One model)                            | Language model (LLM)                          |
| --------------------------------- | ------------------------------------------------- | --------------------------------------------- |
| What comes back                   | A typed answer with a probability for each option | Generated text, optionally JSON               |
| Can it write, plan, or call tools | No                                                | Yes                                           |
| Latency                           | 70 to 500 ms claimed; 358 to 611 ms in our tests  | Usually seconds for a short structured answer |
| Price per million input tokens    | $0.042, output free                               | From about $0.05 to $10, plus billed output   |
| Answer outside your options       | Impossible by construction                        | Possible without a strict schema              |
| Wrong answer                      | Possible, with a probability attached             | Possible, usually with no probability         |
| Input                             | Text and JSON, 64k tokens per request             | Text, and often images and files              |

In Kahneman's terms, the language model is the slow, deliberate System 2 and Jev is the fast System 1. The analogy used to run the other way: in 2023, plain LLMs were the System 1 of the story. Simon Willison and Maggie Appleton suggest the plainer name "decision models" ([Simon Willison](https://simonwillison.net/2026/Sep/21/jev/)).

## How Jev fits AI agent memory

An agent's long-term memory is often a graph of the people, companies and projects in your work, with facts attached to each. After a conversation, it extracts what's worth keeping, and for every person or project mentioned it has to decide whether that's someone it already knows. That is entity resolution, and it is a textbook System One question: a judgment a knowledgeable person makes in a second, asked over and over, in the background, with nobody waiting on the answer. A September paper, Jev-Mem, proposes putting a System One model in control of an agent's memory ([arXiv:2609.23986](https://arxiv.org/abs/2609.23986)).

Most cases never need a model. A platform ID, an exact alias or a single exact-name match resolves in code. What's left is the ambiguous part, where several candidates share a name or the only matches are fuzzy.

The usual tool for those leftovers is a generative judge: a small language model constrained by a JSON schema whose only allowed values are the candidate IDs or null, asked about each candidate set in turn, which can take up to three sequential calls per entity.

With Jev, one call scores every candidate at once, whichever lookup found it, plus an explicit "none". In our tests entities resolved in parallel, eight at a time, so a large batch didn't run into TypeSafe's per-account rate limit, and no answer within two seconds, or an answer in a shape we hadn't asked for, counted as no verdict.

Who decides what matters, so here it is plainly:

- Code finds the candidates with exact-name and fuzzy-name lookups, enforces the threshold and performs the merge.
- Jev answers one question: which candidate, if any, is the same real entity, with a probability for each.
- A language model has extracted the entity from the conversation earlier, and it takes no part in the decision.

That split is also our answer to the fair criticism that a decision model has no context. It doesn't need the whole conversation. Retrieval builds a small state, and Jev makes one bounded call on it. One reply in the Hacker News thread on Jev's launch put it this way: "the hard part for coding is actually state engineering" ([Hacker News](https://news.ycombinator.com/item?id=49718867)). For an agent with its own computer and memory, most of that state already exists, structured, before the question is asked.

## How fast was Jev in our tests?

| Call                              | Input            | Latency       |
| --------------------------------- | ---------------- | ------------- |
| One question                      | About 400 tokens | 358 to 611 ms |
| Seven questions on the same state | About 711 tokens | 377 to 544 ms |

Both rows were measured against `jev-1.13.0` through Cloudflare AI Gateway on September 20, 2026. Repeating the seven-question call moved the probabilities by 0.02 at most, and p95 latency was about 0.6 seconds, so a two-second budget before giving up leaves plenty of room. TypeSafe says its service runs on the US West Coast, so your numbers depend on where you call from: OpenRouter measured a 175 ms median ([OpenRouter](https://openrouter.ai/blog/insights/jev-vs-claude-opus-5-classification/)), and a tester in Japan measured a 245 ms median ([Towards Data Science](https://towardsdatascience.com/jev-vs-llms-when-ai-moves-from-generation-to-decision-making/)).

The second row is the useful one. Seven questions took no longer than one and used 1.8 times the input tokens, because Jev reads the state once and answers every question in parallel. Batch every judgment you have about the same state into one call instead of making several. TypeSafe's own cookbook reports 13 batched questions running 12.2 times cheaper and 10 times faster than separate calls, with no change in answers ([TypeSafe docs](https://docs.typesafe.ai/)).

## How we picked the 0.7 threshold

Jev returns a probability for every candidate and for "none". The real engineering question is where to draw the line. These are the probes we measured on September 20:

| New mention       | Existing candidates         | Jev's answer                       | Outcome at 0.7 |
| ----------------- | --------------------------- | ---------------------------------- | -------------- |
| "Dr. Priya Shah"  | Priya Shah                  | Priya Shah, 0.71                   | Merged         |
| "Priya Shah"      | Priya Shah                  | Priya Shah, 0.76                   | Merged         |
| "atlas migration" | Atlas Migration             | Atlas Migration, 0.82              | Merged         |
| "Acme"            | Acme Corporation            | None, 0.66 (Acme Corporation 0.34) | Kept separate  |
| "Acme"            | Acme Corporation, Acme Labs | None, 0.79                         | Kept separate  |
| "Sam"             | Sam Altman, Samantha Reyes  | None, 1.00                         | Kept separate  |
| "Marcus Webb"     | Unrelated people            | None, 1.00                         | Kept separate  |

In this probe set, real matches landed between 0.71 and 0.82, and everything else put 0.34 or less on its best candidate. We set the merge threshold at 0.7, inside that gap.

Two things decided where in the gap. First, the mistakes aren't symmetrical. A wrong merge fuses two real entities and can't be split again, while a missed merge leaves a duplicate that splits one entity's facts across two records. Second, raising the bar to 0.8 would have refused exactly the alias cases, like "Dr. Priya Shah", that the model is there to catch.

Look at the second row again. An identical name scored 0.76, not 0.99. We asked for "the same real entity", "not merely a similar name", and Jev priced in that a shared name is no proof of a shared identity. That is what you want from a decision about who someone is.

Seven probes are not a benchmark, and we don't present them as one. What transfers is the method: log the probabilities on your own traffic, look for the gap, and place the threshold by what each kind of mistake costs. Then pin the model version if your route lets you: TypeSafe's docs say to pin a version's ID once you have tuned confidence thresholds against it ([TypeSafe docs](https://docs.typesafe.ai/models)). Cloudflare's `typesafe/jev` route, the one we called, has no version field, so it answers with whatever TypeSafe serves ([Cloudflare](https://developers.cloudflare.com/ai/models/typesafe/jev/)). Every response names the model that answered, so record it next to each decision and treat a change as a reason to measure again. Two weeks later we did, and Jev's scores on these same probes had moved below the threshold under the same version name; the [Clef and Jev benchmark](https://construct.computer/blog/clef-vs-jev-benchmark/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost) has the numbers.

### Use the probability, not the top answer

The most important line in our test code was a helper that refused to use Jev's top answer unless its probability cleared the threshold. Real matches didn't always clear it. In a case outside that probe set, Jev picked the right candidate at 0.63 with "none" holding 0.37. Taking the top answer would have merged, and this time it would have been right. The helper still didn't merge at 0.63. A rule that merges at 63% will also merge the wrong candidate whenever Jev is 63% sure of it, and a wrong merge costs far more than the duplicate this leaves behind.

If you take the top label and discard the probability, you have thrown away the one thing you were paying for. This is the same arithmetic as in [nobody merges an email](https://construct.computer/blog/agent-verification-gap/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost): delegating pays when the cost of checking plus the expected cost of a mistake is lower than doing the work yourself, and the model only shows up in the probability of a mistake. A generative judge hands you an answer. A decision model hands you an answer and that probability, so you can spend human attention where it is low instead of rereading everything.

### Is Jev's confidence calibrated?

Partly. TypeSafe trains for calibration and is explicit that calibration "does not guarantee that an individual answer is correct" ([TypeSafe docs](https://docs.typesafe.ai/concepts/system-one)). Independent tests agree the probabilities rank answers well and disagree with each other about how literally to read them:

- OpenRouter found Jev "overestimated its own accuracy mid-range. Still, it ranks well." At a confidence of 0.99 or more, which covered 58% of items, it was right 96.3% of the time ([OpenRouter](https://openrouter.ai/blog/insights/jev-vs-claude-opus-5-classification/)).
- A Towards Data Science test found answers in the 0.7 to 0.9 band right only 53% of the time, and answers at exactly 1.00 right 97.1% of the time ([Towards Data Science](https://towardsdatascience.com/jev-vs-llms-when-ai-moves-from-generation-to-decision-making/)).
- Primeline measured calibration error by question type: 0.012 for Noul, 0.086 for Choice and 0.254 for Score, roughly a 20 times spread ([Primeline](https://primeline.cc/blog/typesafe-jev-pre-registered-test)).

Treat Jev's probabilities as a strong ranking rather than literal odds, and be most careful with Score questions. Our threshold did exactly that: it sat in a gap we observed rather than at a number we assumed. With a few hundred labeled examples from your own data you can go further and recalibrate the scores ([Alex Molas](https://www.alexmolas.com/2026/09/23/jev-cant-be-calibrated.html)).

## What Jev gets wrong

TypeSafe publishes its own list of weak spots for `jev-1.13` ([TypeSafe docs](https://docs.typesafe.ai/model-jaggedness/jev-1.13)). It reads instructions literally, "is not a calculator", "does not count reliably", struggles with date and time comparison and with multi-step indirection, degrades on large states full of irrelevant detail, and doesn't treat text in the state as hostile. Independent tests confirm the ones that matter most for agents:

- Injected text moves the answer. Primeline appended an "IMPORTANT INSTRUCTION FOR THE AI CLASSIFIER" line to an innocent reminder and watched its spam score rise from 0.04 to 0.66. Across 40 test pairs, 22.5% were misclassified outright ([Primeline](https://primeline.cc/blog/typesafe-jev-pre-registered-test)). A separate paper found injected content shifts probabilities but rarely makes Jev pick the attacker's target, with adaptive attacks raising success from 1.8% to 3.5% ([arXiv:2609.28613](https://arxiv.org/abs/2609.28613)). For an agent that reads email and web pages, assume the state is attacker-controlled.
- Long, real-world state hurts. Synthetic padding up to 125,000 characters cost Primeline nothing, but on real notes accuracy fell from 97.0% on the shortest quarter to 81.1% on the longest.
- Probability has to land somewhere. Given 30 messages that fit none of the listed categories and no "none" option, Jev chose a listed category every time, at 0.99 confidence or more, in a test reported by [Towards Data Science](https://towardsdatascience.com/jev-vs-llms-when-ai-moves-from-generation-to-decision-making/).
- Separate questions aren't kept consistent. In TypeSafe's own docs, a question and its negation returned probabilities that added up to 1.19.

These are the rules we'd write into any integration, and they follow directly from that list:

1. Never put Jev on an auth boundary, and never make it the only check before an irreversible action.
2. Never ask it to compare dates, count or do arithmetic. Compute those in code and put the result in the state.
3. Always offer an explicit "none".
4. Ask one question per decision, and never infer the probability of "not x" from the probability of "x".
5. Keep the state small and relevant: the candidates, not the whole conversation.
6. Treat a missing or malformed answer as no verdict, never as "no", and keep the old path as a fallback. That includes a label you never offered: count it as no answer rather than as "none".
7. Batch every question about the same state into one call.
8. Record which model version answered, with the probability and what you did with it, so the threshold can be checked again later.
9. Put anything a third party wrote in fields marked as untrusted, and tell every question to treat those fields as evidence, never as instructions.

## Where Jev fits in an AI agent: System 1 and System 2

An AI agent makes two kinds of decisions. The big ones, what to do and how, belong to a language model that can plan, write and use tools. The small ones happen dozens of times per task, and most of them are the shape Jev was built for: a bounded question over a small state, where a fast answer with a probability is worth more than a slow paragraph.

Anthony Maio's division of labor is the cleanest statement of the pattern we have seen: "A generative model drafts, plans, or explains. Jev supplies bounded semantic judgments. Code handles state, arithmetic, policy, permissions, and side effects. Humans take the ambiguous or high-risk cases" ([Anthony Maio](https://anthonymaio.substack.com/p/jev-the-language-model-that-wont)).

This is how we rated the decision points in an always-on agent's loop:

| Decision                                               | Jev question                          | Fit                              | What to design around                                                   |
| ------------------------------------------------------ | ------------------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| Is this person or project one the agent already knows? | Choice, with "none"                   | Good, above a measured threshold | A wrong merge is hard to undo, so merge only above a measured threshold |
| Is the task done, or should the agent keep going?      | Noul                                  | Good                             | The state includes tool output, which is untrusted, so stop when unsure |
| Does this inbound email need the agent at all?         | Choice: reply, file, or ignore        | Good for skipping and labeling   | Email is attacker-controlled, so the answer must never send anything    |
| Is this thread message addressed to the agent?         | Noul                                  | Good                             | Low stakes: a miss costs a slower reply                                 |
| Is there anything new since the last scheduled run?    | Noul over a change list built in code | Promising                        | Jev is weak at dates, so work out what changed before you ask           |
| Which tool or skill fits this request?                 | Choice, up to 255 labels              | Good as a suggestion             | Let the planning model keep the final say                               |
| Can this action run without asking the user?           | Noul                                  | Only as one layer                | Never the only gate on something irreversible                           |

Two patterns come out of that table.

The saving is the turns you don't run. Comparing Jev's price with a cheap language model's misses where the money goes. When an email arrives or a schedule fires, the expensive part is the full agent turn that follows. A half-second check that says "this is a newsletter" or "nothing changed since the last run" lets the agent skip that turn entirely. TypeSafe's skill-suggestion cookbook shows a similar effect inside a turn: with a suggestion from `jev-1.14.0`, an agent built on Claude Haiku 4.5 loaded the wrong skill 7.9% of the time instead of 15.7% ([TypeSafe docs](https://docs.typesafe.ai/cookbooks/skill_suggestion), checked November 13, 2026).

Escalate up, never sideways. The obvious move is to send low-confidence decisions to a bigger model, and it works only if the fallback is better at the hard cases. OpenRouter sent Jev's answers below 0.90 confidence to Claude Opus 5 and got within 0.4 points of Opus alone, with 76% of traffic never touching Opus, an upper bound because the cutoff was tuned on the test set ([OpenRouter](https://openrouter.ai/blog/insights/jev-vs-claude-opus-5-classification/)). A Towards Data Science test sent them to a weaker local model instead, and every cascade did worse than Jev alone: one "fixed 84 mistakes, but introduced 211 new ones" ([Towards Data Science](https://towardsdatascience.com/jev-vs-llms-when-ai-moves-from-generation-to-decision-making/)). Knowing which cases are hard doesn't give you something that can solve them. For irreversible actions, the right place to escalate is usually a person.

## What does Jev cost compared with an LLM?

At list prices, for a decision with about 400 tokens of input, and assuming a 20-token JSON answer from the models that generate one (prices as of September 30, 2026; the Claude rows re-checked on [Anthropic's pricing page](https://platform.claude.com/docs/en/about-claude/pricing) on November 13, 2026):

| Model                       | Price per million tokens, input / output | Cost per 1,000 decisions |
| --------------------------- | ---------------------------------------- | ------------------------ |
| Jev 1.13                    | $0.042 / free                            | $0.017                   |
| Llama 4 Scout on Workers AI | $0.27 / $0.85                            | $0.125                   |
| Claude Haiku 4.5            | $1 / $5                                  | $0.50                    |
| Claude Sonnet 5.5           | $2 / $10                                 | $1.00                    |

Two notes make the comparison fairer. Prompt caching cuts repeated input on Claude models to about a tenth of the price, but Haiku 4.5 only caches prompts of 4,096 tokens or more ([Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)), so a short decision prompt gets no discount. Jev has no prompt caching at all, and Primeline saw identical requests billed in full every time, which barely matters at $0.042 per million tokens. A generative judge asked about each candidate set in turn needs up to three calls per entity, so its real cost can be up to three times its row.

The honest conclusion is less dramatic than the launch claims. Independent tests put Jev at roughly 8 to 20 times cheaper per call than Haiku 4.5 and 10 to 20 times faster than strong language models on like-for-like classification, a few accuracy points behind the best of them ([Primeline](https://primeline.cc/blog/typesafe-jev-pre-registered-test); [OpenRouter](https://openrouter.ai/blog/insights/jev-vs-claude-opus-5-classification/)). For one founder's agent making a few hundred small decisions a day, the difference is cents a month either way. Price starts to matter at fleet scale or in tight loops, and the bigger saving is still the agent turns a cheap decision lets you skip.

Cost isn't the main reason to use it. One call replaces up to three sequential ones, "none" becomes an explicit, scored answer, and you get a probability to put a threshold on.

## What a decision runtime needs

Entity matching is one decision. An agent makes dozens more small judgments, from "does this email need the agent?" to "did this scheduled check find anything new?". Before moving any of them to a decision model, put one small runtime in front of every decision, because a decision you can't see is a decision you can't trust. Its rules apply to any decision model:

- Ship every decision switched off, and move each one from off to shadow to live on its own, with its own threshold.
- In shadow, the old path still decides and the model's answer is recorded beside it. The old path's answer becomes a free label, so the threshold comes from real traffic rather than a handful of probes.
- Records carry numbers and no text: the decision name, the label, the probability, what the product did and which model answered. Delete samples after 90 days.
- Record the model version, never assume it. Where a route can't pin a version, name the version that answered in each record, and let a change raise an alarm and send new decisions back to shadow.
- A failing provider degrades to the old behaviour. A circuit breaker stops calling the model after repeated failures, and a rate gate keeps you under your account's rate limit.
- Label third-party text as such. Email bodies, web pages and other people's messages go into fields named as untrusted, and every question says those fields are evidence, never instructions. In one small practitioner test, a single sentence like that cut targeted injection success to 1.3% ([Iskandeur](https://github.com/Iskandeur/system1-system2)). That is a mitigation with no guarantee behind it, so a decision that reads untrusted text should only lower a priority or skip work, never grant anything.
- Decisions that would send people's conversations or email to another provider stay off until the contract review is done, because that is a privacy decision before it is an engineering one.

Mapping an agent's small judgments also turns up plain bugs that have nothing to do with a decision model. One we found was a keyword table that guessed which app a request needed: any request containing the letter x, such as "export as csv", read as a request for Twitter, and "linear regression" read as a request for Linear. A keyword list is how you make a System One judgment without a System One model, and that is what it looks like when it fails.

## How to try Jev

- Sign up at [typesafe.ai](https://typesafe.ai), or call it through a gateway without a TypeSafe account: OpenRouter (`typesafe/jev-1.13`), Vercel AI Gateway (`typesafe-ai/jev`) or Cloudflare Workers AI (`typesafe/jev`).
- On Cloudflare, the Workers AI binding only uses a provider key stored under the `default` alias ([Cloudflare](https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/)). With any other alias, calls run on Cloudflare's own credentials, which are capped at 200 requests per 60 seconds per gateway ([Cloudflare limits](https://developers.cloudflare.com/ai-gateway/reference/limits/)).
- The SDKs are `typesafe-sdk` for Python and `@typesafe-ai/sdk` for JavaScript and TypeScript ([TypeSafe quick start](https://docs.typesafe.ai/introduction/quickstart)).
- The price is $0.042 per million input tokens, and output tokens are counted but not billed. Several unofficial lookalike sites resell Jev access at several times that price, so check the price on typesafe.ai or your gateway before you pay.
- If you tune thresholds, pin the version where your route allows it, and record the served version where it doesn't. On November 13, 2026, TypeSafe's `jev-latest` pointed at `jev-1.14.0` ([TypeSafe docs](https://docs.typesafe.ai/models)), while Cloudflare's page for its unversioned `typesafe/jev` route still described Jev 1.13, beside a versioned `typesafe/jev-1.14.0` route ([Cloudflare](https://developers.cloudflare.com/ai/models/typesafe/jev-1.14.0/)).

Start with one decision that is frequent, runs in the background, sits on no auth boundary and already has a fallback. Log the probabilities for a week before you let them act on anything.

## What most Jev coverage gets wrong

- "Jev never hallucinates." It can't return a value outside your schema. It can return the wrong valid one, and TypeSafe's own FAQ says it "can choose the wrong one" ([TypeSafe](https://typesafe.ai)).
- "Jev is 67.8% accurate." That figure is TypeSafe's own score against consensus labels on its four workflow evals ([TypeSafe evals](https://evals.typesafe.ai/)), which says little about accuracy on your task. Measure it on your own cases.
- "Jev has a 32k context window." It takes 64k tokens per request, of which 32k covers the state plus the longest question ([TypeSafe docs](https://docs.typesafe.ai/models)). Cloudflare's model page lists 32,000 tokens for its route, so check the limit on the route you actually call.
- "It is deterministic." TypeSafe designs for consistency, which is a weaker promise. Our repeated calls moved by 0.02 at most in September, and by up to 0.10 in our October benchmark.
- "Just send the uncertain ones to a bigger model." Only if that model is better at the hard cases, as the escalation results above show.

For the reliability argument behind all of this, read [your agent has a half-life](https://construct.computer/blog/agent-task-half-life/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost), and for the infrastructure underneath, [how our agents get computers we mostly don't pay for](https://construct.computer/blog/running-ai-agents-on-cloudflare-not-vms/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost).
