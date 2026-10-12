+++
date = '2026-09-30'
draft = false
title = "We put Jev inside our AI employee"
description = "We shipped TypeSafe's Jev into our AI employee's memory five days after launch: measured latency, how we set a 0.7 threshold, where Jev fails, and what it costs."
summary = "We shipped TypeSafe's Jev into our AI employee's memory five days after launch: measured latency, how we set a 0.7 threshold, where Jev fails, and what it costs."
tags = ["ai-agents", "machine-learning", "construct"]
og_image = "/media/construct/jev-ai-agents.jpg"
author = 'Ankush'
canonical = "https://construct.computer/blog/jev-ai-agents/"
related = ["/blogs/clef-vs-jev-benchmark", "/blogs/agent-task-half-life", "/projects/2026.construct-computer"]
+++

Your AI employee reads an email that mentions "Dr. Priya Shah". Last week it met "Priya Shah" in a calendar invite. Same person? Guess yes and get it wrong, and two people's histories are welded together in its memory. Guess no and get it wrong, and you have a duplicate. It makes that call every time it learns something, in the background, where nobody is watching.

**Jev is a System One model from TypeSafe AI: you give it a state and a set of typed questions, and instead of generating text it returns a probability for each possible answer, in well under a second, for $0.042 per million input tokens with output free.** TypeSafe released it in early access on September 15, 2026. Five days later we shipped it into Construct's memory to make exactly the call above. This post covers what we measured, how we picked the threshold, what Jev gets wrong, what it costs next to a language model, and where a decision model fits in an AI agent's loop.

We build Construct, an AI employee with its own computer. The numbers in this post come from our own integration, measured on September 20, 2026 against `jev-1.13.0`. Everything else about Jev comes from TypeSafe's launch post and docs and from independent tests, all checked on **September 30, 2026**.

- **Latency:** 358 to 611 ms for one question on about 400 tokens, and 377 to 544 ms for seven questions on the same state.
- **Consistency:** repeating the same call moved Jev's probabilities by 0.02 at most.
- **Threshold:** we merge at 0.7. In our probe set, real matches scored 0.71 to 0.82 and everything else 0.34 or less.
- **Calls:** one Jev call replaced up to three sequential calls to a generative judge for each entity.
- **Cost:** about $0.017 per 1,000 decisions of 400 input tokens at list price, with output free.

## What is Jev?

Jev is a decision model, not a chat model: it never generates text, and TypeSafe says it is not a large language model. TypeSafe AI, a San Francisco company founded by Diogo Almeida (a former OpenAI researcher and co-author of the InstructGPT paper), Erik Gafni, and Sasha Sheng, released it alongside a $40 million seed round led by DCVC. TypeSafe calls Jev the first "System One model", after the fast, intuitive System 1 in Daniel Kahneman's *Thinking, Fast and Slow*, and describes it as "a frontier-intelligence function call: unstructured state in, typed probabilistic decisions out" ([TypeSafe](https://typesafe.ai/blog/introducing-system-one-models-and-jev)).

You send one `state`, as text or JSON, and a map of named questions. Each question has one of three types ([TypeSafe API reference](https://docs.typesafe.ai/api)):

- **Choice** picks one of up to 255 labels you define and returns a probability for every label.
- **Score** rates the state on an ordered scale of 2 to 10 levels.
- **Noul**, short for Bernoulli, returns the probability that a statement is true.

Every question is answered against the same state in one parallel pass, so adding questions barely changes the response time. Jev cannot write a sentence, and that is the point: there is no prose to parse, no output tokens to pay for, and no way for an answer to fall outside the labels you gave it.

| | Jev (System One model) | Language model (LLM) |
| --- | --- | --- |
| What comes back | A typed answer with a probability for each option | Generated text, optionally JSON |
| Can it write, plan, or call tools | No | Yes |
| Latency | 70 to 500 ms claimed; 358 to 611 ms in our tests | Usually seconds for a short structured answer |
| Price per million input tokens | $0.042, output free | From about $0.05 to $10, plus billed output |
| Answer outside your options | Impossible by construction | Possible without a strict schema |
| Wrong answer | Possible, with a probability attached | Possible, usually with no probability |
| Input | Text and JSON, 64k tokens per request | Text, and often images and files |

*Jev compared with a general-purpose language model*

In Kahneman's terms, the language model is the slow, deliberate System 2 and Jev is the fast System 1. The analogy used to run the other way: in 2023, plain LLMs were the System 1 of the story. Simon Willison and Maggie Appleton suggest the plainer name "decision models" ([Simon Willison](https://simonwillison.net/2026/Sep/21/jev/)), which is also the term our own code uses.

## Using Jev for AI agent memory

Construct's agent keeps a long-term memory: a graph of the people, companies, and projects in your work, with facts attached to each. After a conversation, it extracts what is worth keeping, and for every person or project it mentions it has to decide whether that is someone it already knows. That is entity resolution, and it is a textbook System One question: a judgment a knowledgeable person makes in a second, asked over and over, in the background, with nobody waiting on the answer. We are not the only ones who ended up here: a September paper, Jev-Mem, proposes putting a System One model in control of an agent's memory ([arXiv:2609.23986](https://arxiv.org/abs/2609.23986)).

Most cases never need a model. A platform ID, an exact alias, or a single exact-name match resolves in code. What is left is the ambiguous part, where several candidates share a name or the only matches are fuzzy or come from vector search.

Before Jev, those leftovers went to a generative judge: a small open model, Llama 4 Scout on Workers AI, constrained by a JSON schema whose only allowed values were the candidate IDs or null. It was asked about each candidate set in turn, up to three sequential calls per entity and up to 64 entities per batch, and it answered with a label and nothing else.

Now one Jev call scores every candidate at once, whichever lookup found it, plus an explicit "none", and entities resolve in parallel, eight at a time, so a 64-entity batch does not open 64 connections at once and run into TypeSafe's per-account rate limit. If Jev does not answer within two seconds, or answers in a shape we did not ask for, resolution falls back to the old judge.

Who decides what matters, so here it is plainly:

- **Code** finds the candidates with vector, exact-name, and fuzzy-name lookups, enforces the threshold, and performs the merge.
- **Jev** answers one question: which candidate, if any, is the same real entity, with a probability for each.
- **A language model** extracted the entity from the conversation earlier. It takes no part in the decision.

That split is also our answer to the fair criticism that a decision model has no context. It does not need the whole conversation. Retrieval builds a small state, and Jev makes one bounded call on it. TypeSafe's CEO has said "the hard part for coding is actually state engineering" ([Hacker News](https://news.ycombinator.com/item?id=49718867)). For an agent with its own computer and memory, most of that state already exists, structured, before the question is asked.

## How fast is Jev in production?

| Call | Input | Latency |
| --- | --- | --- |
| One question | About 400 tokens | 358 to 611 ms |
| Seven questions on the same state | About 711 tokens | 377 to 544 ms |

*Jev latency measured by Construct on September 20, 2026*

Both rows were measured against `jev-1.13.0` through Cloudflare AI Gateway. Repeating the seven-question call moved the probabilities by 0.02 at most, and p95 latency was about 0.6 seconds, so we gave the call a two-second budget before falling back. TypeSafe says its service runs on the US West Coast, so your numbers depend on where you call from: OpenRouter measured a 175 ms median ([OpenRouter](https://openrouter.ai/blog/insights/jev-vs-claude-opus-5-classification/)), and a tester in Japan measured a 245 ms median ([Towards Data Science](https://towardsdatascience.com/jev-vs-llms-when-ai-moves-from-generation-to-decision-making/)).

The second row is the useful one. Seven questions took no longer than one and used 1.8 times the input tokens, because Jev reads the state once and answers every question in parallel. Batch every judgment you have about the same state into one call instead of making several. TypeSafe's own cookbook reports 13 batched questions running 12.2 times cheaper and 10 times faster than separate calls, with no change in answers ([TypeSafe docs](https://docs.typesafe.ai/)).

## How we picked the 0.7 threshold

Jev returns a probability for every candidate and for "none". The real engineering question is where to draw the line. These are the probes we measured on September 20:

| New mention | Existing candidates | Jev's answer | Outcome at 0.7 |
| --- | --- | --- | --- |
| "Dr. Priya Shah" | Priya Shah | Priya Shah, 0.71 | Merged |
| "Priya Shah" | Priya Shah | Priya Shah, 0.76 | Merged |
| "atlas migration" | Atlas Migration | Atlas Migration, 0.82 | Merged |
| "Acme" | Acme Corporation | None, 0.66 (Acme Corporation 0.34) | Kept separate |
| "Acme" | Acme Corporation, Acme Labs | None, 0.79 | Kept separate |
| "Sam" | Sam Altman, Samantha Reyes | None, 1.00 | Kept separate |
| "Marcus Webb" | Unrelated people | None, 1.00 | Kept separate |

*Jev's answers on entity-resolution probes, and the outcome at a 0.7 merge threshold*

In this probe set, real matches landed between 0.71 and 0.82, and everything else put 0.34 or less on its best candidate. We set the merge threshold at 0.7, inside that gap.

Two things decided where in the gap. First, the mistakes are not symmetrical. A wrong merge fuses two real entities and cannot be split again, while a missed merge leaves a duplicate that splits one entity's facts across two records. Second, raising the bar to 0.8 would have refused exactly the alias cases, like "Dr. Priya Shah", that we added the model to catch.

Look at the second row again. An identical name scored 0.76, not 0.99. We asked for "the same real entity", "not merely a similar name", and Jev priced in that a shared name is not proof of a shared identity. That is what you want from a decision about who someone is.

Seven probes are not a benchmark, and we do not present them as one. What transfers is the method: log the probabilities on your own traffic, look for the gap, and place the threshold by what each kind of mistake costs. Then pin the model version if your route lets you: TypeSafe's docs say to pin a version's ID once you have tuned confidence thresholds against it ([TypeSafe docs](https://docs.typesafe.ai/models)). Cloudflare's `typesafe/jev` route, the one we call, has no version field, so it answers with whatever TypeSafe serves ([Cloudflare](https://developers.cloudflare.com/ai/models/typesafe/jev/)). Every response names the model that answered, so record it next to each decision and treat a change as a reason to measure again.

### Use the probability, not the top answer

The most important line in our integration is a helper that refuses to use Jev's top answer unless its probability clears the threshold. Real matches do not always clear it. In a case recorded in our code outside that probe set, Jev picked the right candidate at 0.63 with "none" holding 0.37. Taking the top answer would have merged, and this time it would have been right. We still do not merge at 0.63. A rule that merges at 63% will also merge the wrong candidate whenever Jev is 63% sure of it, and a wrong merge costs far more than the duplicate this leaves behind.

If you take the top label and discard the probability, you have thrown away the one thing you were paying for. This is the same arithmetic as in [Nobody merges an email](https://construct.computer/blog/agent-verification-gap/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost): delegating pays when the cost of checking plus the expected cost of a mistake is lower than doing the work yourself, and the model only shows up in the probability of a mistake. A generative judge hands you an answer. A decision model hands you an answer and that probability, so you can spend human attention where it is low instead of rereading everything.

### Is Jev's confidence calibrated?

Partly. TypeSafe trains for calibration and is explicit that calibration "does not guarantee that an individual answer is correct" ([TypeSafe docs](https://docs.typesafe.ai/concepts/system-one)). Independent tests agree the probabilities rank answers well and disagree with each other about how literally to read them:

- OpenRouter found Jev "overestimated its own accuracy mid-range. Still, it ranks well." At a confidence of 0.99 or more, which covered 58% of items, it was right 96.3% of the time ([OpenRouter](https://openrouter.ai/blog/insights/jev-vs-claude-opus-5-classification/)).
- A Towards Data Science test found answers in the 0.7 to 0.9 band right only 53% of the time, and answers at exactly 1.00 right 97.1% of the time ([Towards Data Science](https://towardsdatascience.com/jev-vs-llms-when-ai-moves-from-generation-to-decision-making/)).
- Primeline measured calibration error by question type: 0.012 for Noul, 0.086 for Choice, and 0.254 for Score, roughly a 20 times spread ([Primeline](https://primeline.cc/blog/typesafe-jev-pre-registered-test)).

Treat Jev's probabilities as a strong ranking, not as literal odds, and be most careful with Score questions. Our threshold does exactly that: it sits in a gap we observed rather than at a number we assumed. With a few hundred labeled examples from your own data you can go further and recalibrate the scores ([Alex Molas](https://www.alexmolas.com/2026/09/23/jev-cant-be-calibrated.html)).

## What Jev gets wrong

TypeSafe publishes its own list of weak spots for `jev-1.13` ([TypeSafe docs](https://docs.typesafe.ai/model-jaggedness/jev-1.13)). It reads instructions literally, "is not a calculator", "does not count reliably", struggles with date and time comparison and with multi-step indirection, degrades on large states full of irrelevant detail, and does not treat text in the state as hostile. Independent tests confirm the ones that matter most for agents:

- **Injected text moves the answer.** Primeline appended an "IMPORTANT INSTRUCTION FOR THE AI CLASSIFIER" line to an innocent reminder and watched its spam score rise from 0.04 to 0.66. Across 40 test pairs, 22.5% were misclassified outright ([Primeline](https://primeline.cc/blog/typesafe-jev-pre-registered-test)). A separate paper found injected content shifts probabilities but rarely makes Jev pick the attacker's target, with adaptive attacks raising success from 1.8% to 3.5% ([arXiv:2609.28613](https://arxiv.org/abs/2609.28613)). For an agent that reads email and web pages, assume the state is attacker-controlled.
- **Long, real-world state hurts.** Synthetic padding up to 125,000 characters cost Primeline nothing, but on real notes accuracy fell from 97.0% on the shortest quarter to 81.1% on the longest.
- **Probability has to land somewhere.** Given 30 messages that fit none of the listed categories and no "none" option, Jev chose a listed category every time, at 0.99 confidence or more, in a test reported by [Towards Data Science](https://towardsdatascience.com/jev-vs-llms-when-ai-moves-from-generation-to-decision-making/).
- **Separate questions are not kept consistent.** In TypeSafe's own docs, a question and its negation returned probabilities that added up to 1.19.

These are the rules we wrote into our integration, and they follow directly from that list:

1. Never put Jev on an auth boundary, and never make it the only check before an irreversible action.
2. Never ask it to compare dates, count, or do arithmetic. Compute those in code and put the result in the state.
3. Always offer an explicit "none".
4. Ask one question per decision, and never infer the probability of "not x" from the probability of "x".
5. Keep the state small and relevant: the candidates, not the whole conversation.
6. Treat a missing or malformed answer as no verdict, never as "no", and keep the old path as a fallback. That includes a label you never offered: count it as no answer, not as "none".
7. Batch every question about the same state into one call.
8. Record which model version answered, with the probability and what you did with it, so the threshold can be checked again later.
9. Put anything a third party wrote in fields marked as untrusted, and tell every question to treat those fields as evidence, never as instructions.

## Where Jev fits in an AI agent: System 1 and System 2

An AI employee makes two kinds of decisions. The big ones, what to do and how, belong to a language model that can plan, write, and use tools. The small ones happen dozens of times per task, and most of them are the shape Jev was built for: a bounded question over a small state, where a fast answer with a probability is worth more than a slow paragraph.

Anthony Maio's division of labor is the cleanest statement of the pattern we have seen: "A generative model drafts, plans, or explains. Jev supplies bounded semantic judgments. Code handles state, arithmetic, policy, permissions, and side effects. Humans take the ambiguous or high-risk cases" ([Anthony Maio](https://anthonymaio.substack.com/p/jev-the-language-model-that-wont)).

This is how we rate the decision points in an always-on agent's loop:

| Decision | Jev question | Fit | What to design around |
| --- | --- | --- | --- |
| Is this person or project one the agent already knows? | Choice, with "none" | In production at Construct | A wrong merge is hard to undo, so merge only above a measured threshold |
| Is the task done, or should the agent keep going? | Noul | Good | The state includes tool output, which is untrusted, so stop when unsure |
| Does this inbound email need the agent at all? | Choice: reply, file, or ignore | Good for skipping and labeling | Email is attacker-controlled, so the answer must never send anything |
| Is this thread message addressed to the agent? | Noul | Good | Low stakes: a miss costs a slower reply |
| Is there anything new since the last scheduled run? | Noul over a change list built in code | Promising | Jev is weak at dates, so work out what changed before you ask |
| Which tool or skill fits this request? | Choice, up to 255 labels | Good as a suggestion | Let the planning model keep the final say |
| Can this action run without asking the user? | Noul | Only as one layer | Never the only gate on something irreversible |

*Decisions in an AI employee's loop, and how well each fits a decision model*

Two patterns come out of that table.

**The saving is the turns you do not run.** Comparing Jev's price with a cheap language model's misses where the money goes. When an email arrives or a schedule fires, the expensive part is the full agent turn that follows. A half-second check that says "this is a newsletter" or "nothing changed since the last run" lets the agent skip that turn entirely. TypeSafe's skill-suggestion cookbook shows a similar effect inside a turn: with a Jev suggestion, an agent built on Claude Haiku 4.5 loaded the wrong skill 7.3% of the time instead of 16.8% ([TypeSafe docs](https://docs.typesafe.ai/cookbooks/skill_suggestion)).

**Escalate up, never sideways.** The obvious move is to send low-confidence decisions to a bigger model, and it works only if the fallback is actually better at the hard cases. OpenRouter sent Jev's answers below 0.90 confidence to Claude Opus 5 and got within 0.4 points of Opus alone, with 76% of traffic never touching Opus, an upper bound because the cutoff was tuned on the test set ([OpenRouter](https://openrouter.ai/blog/insights/jev-vs-claude-opus-5-classification/)). A Towards Data Science test sent them to a weaker local model instead, and every cascade did worse than Jev alone: one "fixed 84 mistakes, but introduced 211 new ones" ([Towards Data Science](https://towardsdatascience.com/jev-vs-llms-when-ai-moves-from-generation-to-decision-making/)). Knowing which cases are hard is not the same as having something that can solve them. For irreversible actions, the right place to escalate is usually a person.

*Read next: [Your agent has a half-life](https://construct.computer/blog/agent-task-half-life/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost)*
## What does Jev cost compared with an LLM?

At list prices, for a decision with about 400 tokens of input, and assuming a 20-token JSON answer from the models that generate one:

| Model | Price per million tokens, input / output | Cost per 1,000 decisions |
| --- | --- | --- |
| Jev 1.13 | $0.042 / free | $0.017 |
| Llama 4 Scout on Workers AI (our old judge) | $0.27 / $0.85 | $0.125 |
| Claude Haiku 4.5 | $1 / $5 | $0.50 |
| Claude Sonnet 5.5 | $2 / $10 | $1.00 |

*List-price cost per 1,000 decisions of about 400 input tokens, September 2026*

Two notes make the comparison fairer. Prompt caching cuts repeated input on Claude models to about a tenth of the price, but Haiku 4.5 only caches prompts of 4,096 tokens or more, so a short decision prompt gets no discount. Jev has no prompt caching at all, and Primeline saw identical requests billed in full every time, which barely matters at $0.042 per million tokens. Our old judge also needed up to three calls per entity, so its real cost was up to three times its row.

The honest conclusion is less dramatic than the launch claim of "444.6x cheaper". Independent tests put Jev at roughly 8 to 20 times cheaper per call than Haiku 4.5 and 10 to 20 times faster than strong language models on like-for-like classification, a few accuracy points behind the best of them ([Primeline](https://primeline.cc/blog/typesafe-jev-pre-registered-test); [OpenRouter](https://openrouter.ai/blog/insights/jev-vs-claude-opus-5-classification/)). For one founder's agent making a few hundred small decisions a day, the difference is cents a month either way. Price starts to matter at fleet scale or in tight loops, and the bigger saving is still the agent turns a cheap decision lets you skip.

For us, cost was not the reason to switch. One call replaced up to three sequential ones, "none" became an explicit, scored answer, and we got a probability to put a threshold on.

## How we are adding more Jev decisions

Entity matching was the first decision. Mapping every other place our agent makes a small judgment turned up about thirty more candidates, from "does this email need the agent?" to "did this scheduled check find anything new?". Before moving any of them, we built one small runtime that every decision goes through. The lesson of the first week was that a decision you cannot see is a decision you cannot trust.

- **Every decision ships switched off.** A flag moves each one from off to shadow to live on its own, with its own threshold.
- **Shadow before live.** In shadow the old path still decides, and Jev's answer is recorded beside it. The old path's answer becomes a free label, so the threshold comes from real traffic rather than a handful of probes.
- **Records carry numbers, not text.** We keep the decision name, the label, the probability, what the product did, and which model answered, never the text Jev saw. Samples are deleted after 90 days.
- **The model version is recorded, not assumed.** Our route cannot pin a version, so each record names the version that answered, and a change raises an alarm. New decisions drop back to shadow until they are measured again.
- **A failing provider degrades to the old behaviour.** A circuit breaker stops calling Jev after repeated failures, and a rate gate keeps us well under TypeSafe's published limit, 80 requests a second when we last checked ([TypeSafe docs](https://docs.typesafe.ai/models)). Every decision has a fallback, so an outage looks like the product before Jev.
- **Third-party text is labelled as such.** Email bodies, web pages and other people's messages go into fields named as untrusted, and every question says those fields are evidence, not instructions. In one small practitioner test, a single sentence like that cut targeted injection success to 1.3% ([Iskandeur](https://github.com/Iskandeur/system1-system2)). It is a mitigation, not a boundary, so a decision that reads untrusted text may only lower a priority or skip work, never grant anything.
- **Decisions that read your conversations or email wait for the paperwork.** Sending your text to another provider is a privacy decision before it is an engineering one. TypeSafe is on our [sub-processors list](https://construct.computer/sub-processors/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost), and the decisions that would send conversation or email text stay off until the contract review is done.

The mapping also found plain bugs that had nothing to do with Jev. One was a keyword table that guessed which app a request needed: any request containing the letter x, such as "export as csv", read as a request for Twitter, and "linear regression" read as a request for Linear. A keyword list is how you make a System One judgment without a System One model, and that is what it looks like when it fails.

## How to try Jev

- **Direct:** sign up at [typesafe.ai](https://typesafe.ai). TypeSafe paused new signups on September 22 because of demand, and its CEO said on September 27 that signups had reopened, without free credits for new accounts ([Diogo Almeida on X](https://x.com/CompleteSkeptic/status/2104338649999626397)).
- **Through a gateway, without a TypeSafe account:** OpenRouter (`typesafe/jev-1.13`), Vercel AI Gateway (`typesafe-ai/jev`), or Cloudflare Workers AI (`typesafe/jev`). We call it through Cloudflare Workers AI and AI Gateway.
- **On Cloudflare, check the key alias:** the Workers AI binding only uses a provider key stored under the `default` alias. With any other alias, calls quietly fall through to Cloudflare's Unified Billing, which is capped at 200 requests a minute per gateway ([Cloudflare](https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/)).
- **SDKs:** `typesafe-sdk` for Python and `@typesafe-ai/sdk` for JavaScript and TypeScript ([TypeSafe quick start](https://docs.typesafe.ai/introduction/quickstart)).
- **Price:** $0.042 per million input tokens. Output tokens are counted but not billed. Several unofficial lookalike sites resell Jev access at several times that price, so check the price on typesafe.ai or your gateway before you pay.
- **Version:** `jev-latest` points at `jev-1.13.0` today. If you tune thresholds, pin the version where your route allows it, and record the served version where it does not.

Start with one decision that is frequent, runs in the background, is not an auth boundary, and already has a fallback. Log the probabilities for a week before you let them act on anything.

## What most Jev coverage gets wrong

- **"Jev never hallucinates."** It cannot return a value outside your schema. It can return the wrong valid one, and TypeSafe's own FAQ says it "can choose the wrong one" ([TypeSafe](https://typesafe.ai)).
- **"Jev is 67.8% accurate."** That figure is agreement with the averaged answers of GPT-6 Astra and Claude Fable 5.1 on TypeSafe's own four workflow evals, not accuracy against verified labels ([TypeSafe evals](https://evals.typesafe.ai/)).
- **"193.6x faster and 444.6x cheaper."** On TypeSafe's eval chart, those ratios line up with the slowest model, Claude Sonnet 5 at 78.1 seconds per case, and the most expensive, Claude Opus 5 at $0.1761 per case. Against GPT-5.6 Terra, which matched Jev's agreement score, the same chart works out to about 25 times faster and 76 times cheaper.
- **"Jev has a 32k context window."** It takes 64k tokens per request, of which 32k covers the state plus the longest question ([TypeSafe docs](https://docs.typesafe.ai/models)). Cloudflare's model page lists 32,000 tokens for its route, so check the limit on the route you actually call.
- **"It is deterministic."** TypeSafe designs for consistency rather than determinism. Our repeated calls moved by 0.02 at most, which is consistent, not identical.
- **"Just send the uncertain ones to a bigger model."** Only if that model is better at the hard cases, as the escalation results above show.

## Where Construct fits

Construct is an AI employee with its own computer: a workspace filesystem, long-term memory, a schedule, email, and workflows you can read before you run them. Jev runs in one place today, deciding whether a person or project your agent just learned about is one it already knows. Planning and writing run on general-purpose language models.

Memory in Construct is inspectable and correctable, so if a merge pulls the wrong facts together, you can see which ones and correct or forget them. [AI agent memory](https://construct.computer/blog/ai-agent-memory/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost) covers how that works. Two honest boundaries: the "is this task done?" check and email triage are written as Jev decisions, but both stay switched off until shadow data shows they beat what they would replace, and Construct does not currently insert a mandatory approval gate before every external side effect, so steps that send mail or move money still need supervision before they run unattended.

If the reliability argument is new to you, start with [your agent has a half-life](https://construct.computer/blog/agent-task-half-life/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost) and [nobody merges an email](https://construct.computer/blog/agent-verification-gap/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost). For the infrastructure underneath, read [how our agents get computers we mostly do not pay for](https://construct.computer/blog/running-ai-agents-on-cloudflare-not-vms/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost), and if the category itself is new, begin with [what is an AI employee](https://construct.computer/blog/what-is-an-ai-employee/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost).

---

*Originally posted on [construct.computer](https://construct.computer/blog/jev-ai-agents/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost).*
