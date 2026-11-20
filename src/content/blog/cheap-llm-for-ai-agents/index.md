---
title: "Best cheap LLM for AI agents: 11 models through our agent loop"
description: "11 cheap model setups on 11 real agent tasks: GLM-5.3-Flash and Gemini 3.8 Flash passed 19 of 22, and GLM cost least per passed task by far."
date: 2026-11-10
updated: 2026-11-13
tags: ["ai-agents", "machine-learning", "construct"]
cover: ./cover.webp
coverAlt: "Benchmark chart of cheap LLMs tested through the Construct agent loop"
canonical: "https://construct.computer/blog/cheap-llm-for-ai-agents/"
related: ["/blogs/clef-vs-jev-benchmark", "/blogs/grokbot-alternative", "/projects/construct-computer"]
---
On our benchmark of 11 agent tasks, the best cheap LLMs for AI agents were GLM-5.3-Flash and Gemini 3.8 Flash, which both passed 19 of 22 runs. GLM-5.3-Flash was the cheapest per passed task by far, at $0.0036, and Gemini 3.8 Flash was the fastest of the leaders at 24 seconds of model time per task, with the best writing, at about nine times the cost. DeepSeek V4.1 Flash passed 18 of 22 at $0.0086 per pass and wrote nearly as well as Gemini. In a separate run on a larger task set, Claude Haiku 5.5 matched DeepSeek on passes in under half the time.

We make Construct Computer, and on October 23, 2026 we ran 11 model configurations through Construct's own agent loop as it ran then: the production prompts, tools, tool executor and continuation logic, on 11 tasks shaped like real customer work, two runs each, with no other model taking over a turn, so every model stood alone. Every model and setting in this post is one we ran. The headline numbers:

- The top pass rate was 19 of 22, shared by GLM-5.3-Flash at high effort and Gemini 3.8 Flash at low effort.
- GLM-5.3-Flash cost $3.61 per 1,000 passed tasks. Qwen3.8 27B, which passed 18 of 22 like DeepSeek, cost $33.34 per 1,000.
- Gemini 3.1 Flash-Lite was the fastest, at 12 seconds of model time per task, and passed 14 of 22.
- gpt-oss-120b passed 10 of 22, the lowest.
- All 242 runs together cost about $3.56 in model spend.

## How we tested

The API of the previous version of Construct had an agent benchmark, `benchmark:agent`, that ran whole tasks the way a real chat runs: the user's message, the agent's turn, the continuation judge that decides whether the agent should keep going, and another hop if it says yes. The agent loop, tool definitions, tool executor and continuation decision were production code. The web, the files and a Notion-shaped CRM were fixtures, so every run saw the same pages and a model could only cite a URL it actually fetched.

We ran it live over our AI Gateway with these settings:

1. Tasks: 11, described in the next section, each with its own pass check written against what the run left behind.
2. Seeds: two runs per task per model, so 22 runs per configuration.
3. One model per run. The model under test handled every turn, so a pass belongs to it.
4. Effort: high for GLM, DeepSeek, Qwen, Kimi and gpt-oss; low for the Gemini Flash models. DeepSeek ran as two configurations, thinking at high and thinking off.
5. Writing judge: on three writing and revision tasks, a fixed judge model, Gemini 3.8 Flash, scored the output from 1 to 5. The score is reported next to the pass, never part of it.
6. Cost: each model's own spend at list price, with the cache hits it actually got. The judge's calls are excluded.

Separately, we sent each model a 14-check probe straight to the gateway, three runs per check: tool arguments with date math, parallel calls, nested schemas with exact enum values, recovering from a tool error, asking when a request is ambiguous, not calling a tool when none is needed, finding a superseded fact deep in a long handbook, format rules, JSON extraction, schedule planning, pricing math, a logic puzzle, and two small coding tasks scored by running the code.

## The 11 tasks

Most of the tasks are rebuilt from the real production conversations that took the most steps, with fictional companies and people:

| Task                       | What the agent is asked to do                                                                                                          | Passes when                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| ci-five-companies          | A competitive report on five companies, every claim cited                                                                              | The report exists, names all five and cites only pages it fetched                              |
| crm-leads-update           | Edit a Notion-shaped CRM whose property names differ from the user's words                                                             | Three new rows, one status change, the right duplicate archived, one date moved, nothing else  |
| notion-bulk-insert         | Add 15 pasted leads to the same CRM, some with a Source link                                                                           | All 15 rows with the right properties in at most four calls                                    |
| unsupported-app-connect    | "Give you access to my Medium", an app the integration catalog does not have                                                           | No connect card for the wrong app, and the reply tells the user                                |
| sso-pricing-recommendation | Research where one page is stale, the pricing page has moved, SSO is a paid add-on, and one page tells agents to lie                   | The right price per row, the right recommendation, only fetched pages cited                    |
| launch-plan-edit           | Update a launch plan from meeting notes                                                                                                | The plan says what the notes decided and nothing else changed                                  |
| meeting-prep               | Our longest real turn, rebuilt: plan a 90-minute meeting from five documents that conflict, with a moved deadline and a dropped item   | The agenda fits the slot with contingency, carries the moved deadline, cites the revised paper |
| content-drafts             | Four social posts from a brand brief with hard rules (dashes and invented numbers banned, Canadian spelling, a list of banned phrases) | Four posts, every hard rule kept                                                               |
| brief-cut-off              | A replacement brand brief pasted in, cut off mid-word                                                                                  | The agent doesn't fill in the rest from the old brief, and asks                                |
| feedback-revise            | "These posts are terrible" about posts that break the brief                                                                            | The posts are rewritten before any question, keeping every hard rule                           |
| ask-first-starter          | The real onboarding starter for a founder who gave no context                                                                          | It asks a question and makes no web calls or files                                             |

Two of them never failed on any model: launch-plan-edit and unsupported-app-connect. The rest separated the models.

## Results

Agent benchmark results by model configuration, 11 tasks x 2 runs, October 23, 2026:

| Model and effort                 | Passed | Cost per task | Cost per passed task | Model time per task | p90 model time | Writing judge (1 to 5) | Tool errors per task |
| -------------------------------- | ------ | ------------- | -------------------- | ------------------- | -------------- | ---------------------- | -------------------- |
| GLM-5.3-Flash, high              | 19/22  | $0.0031       | $0.0036              | 62.5 s              | 135.6 s        | 2.8                    | 0.77                 |
| Gemini 3.8 Flash, low            | 19/22  | $0.0277       | $0.0321              | 24.0 s              | 38.1 s         | 4.7                    | 0.18                 |
| DeepSeek V4.1 Flash, high        | 18/22  | $0.0070       | $0.0086              | 57.2 s              | 97.3 s         | 4.3                    | 0.86                 |
| Qwen3.8 27B, high                | 18/22  | $0.0273       | $0.0333              | 126.8 s             | 189.3 s        | 3.5                    | 0.18                 |
| Gemini 3.6 Flash, low            | 17/22  | $0.0233       | $0.0302              | 15.2 s              | 22.2 s         | 2.5                    | 0.50                 |
| DeepSeek V4.1 Flash, no thinking | 16/22  | $0.0039       | $0.0053              | 29.7 s              | 50.2 s         | 2.2                    | 0.77                 |
| GLM-5.3, high                    | 15/22  | $0.0194       | $0.0284              | 62.7 s              | 124.7 s        | 4.5                    | 0.23                 |
| Gemini 3.1 Flash-Lite, low       | 14/22  | $0.0062       | $0.0098              | 12.0 s              | 17.7 s         | 1.8                    | 0.18                 |
| Gemini 3.5 Flash-Lite, low       | 14/22  | $0.0104       | $0.0164              | 14.4 s              | 20.9 s         | 1.8                    | 0.64                 |
| Kimi K2.6, high                  | 13/22  | $0.0195       | $0.0331              | 113.1 s             | 143.9 s        | 3.7                    | 0.41                 |
| gpt-oss-120b, high               | 10/22  | $0.0138       | $0.0304              | 57.9 s              | 136.6 s        | 1.2                    | 0.18                 |

Cost per passed task is cost per task times 22, divided by the passes, so a model that fails often pays for its failures. Model time is the time spent waiting on model calls inside a task, not the wall clock. Some tool errors are by design: a few fixture pages return a 404 on purpose, so zero isn't always reachable.

Two things in that table are easy to misread. Gemini 3.8 Flash read almost nothing from its prompt cache in this run (0.4% of input tokens over the gateway route we used), while GLM and DeepSeek read 81% and 88% from cache, so Gemini's cost here is an upper bound. And GLM-5.3, the bigger and pricier sibling, did worse than GLM-5.3-Flash on these tasks.

## Where each model failed

The pass table hides where the failures sit, and they cluster. Runs passed out of 2 on the six tasks that separated the models:

| Model                            | meeting-prep | brief-cut-off | feedback-revise | sso-pricing | notion-bulk-insert | crm-leads-update |
| -------------------------------- | ------------ | ------------- | --------------- | ----------- | ------------------ | ---------------- |
| GLM-5.3-Flash, high              | 2            | 1             | 0               | 2           | 2                  | 2                |
| Gemini 3.8 Flash, low            | 2            | 2             | 0               | 2           | 2                  | 1                |
| DeepSeek V4.1 Flash, high        | 0            | 2             | 1               | 1           | 2                  | 2                |
| Qwen3.8 27B, high                | 2            | 1             | 0               | 1           | 2                  | 2                |
| Gemini 3.6 Flash, low            | 0            | 1             | 1               | 2           | 2                  | 2                |
| DeepSeek V4.1 Flash, no thinking | 1            | 0             | 0               | 2           | 2                  | 2                |
| GLM-5.3, high                    | 2            | 2             | 0               | 0           | 0                  | 1                |
| Gemini 3.1 Flash-Lite, low       | 0            | 0             | 0               | 1           | 2                  | 2                |
| Gemini 3.5 Flash-Lite, low       | 0            | 0             | 1               | 0           | 2                  | 2                |
| Kimi K2.6, high                  | 2            | 1             | 0               | 1           | 2                  | 0                |
| gpt-oss-120b, high               | 0            | 0             | 0               | 2           | 0                  | 0                |

`feedback-revise` was the hardest task in the set: 3 passes in 22 attempts across all models. Told "these posts are terrible", the agent has to find the saved brief and rewrite the posts against it before asking anything, and 19 of the 22 attempts didn't get there.

`meeting-prep` split the field. GLM-5.3-Flash, Gemini 3.8 Flash, GLM-5.3, Qwen and Kimi passed both runs; DeepSeek at high effort, Gemini 3.6 Flash, both Flash-Lites and gpt-oss passed neither. It is the one place DeepSeek clearly lost.

`notion-bulk-insert` caught the bigger model. GLM-5.3 ended both runs with zero rows written, and gpt-oss-120b failed both too, while its smaller sibling GLM-5.3-Flash passed both.

`brief-cut-off` caught the two Flash-Lite models, DeepSeek without thinking and gpt-oss: none of their runs handled a brief that ends mid-word by leaving the gap and asking. `crm-leads-update`, where the CRM's property names differ from the user's words, caught gpt-oss and Kimi in both runs. The Flash-Lite models also scored lowest on writing, 1.8 of 5.

## The 14-check probe

The probe is short single requests, and most thinking models came close to full marks on it, so it separates models less than the agent benchmark. It is most useful for speed and for spotting a model that can't do one specific thing.

Mean score across 14 checks, 3 runs each, and median time to a finished 300-word answer, October 23, 2026:

| Model and effort                 | Overall | Tools | Reasoning | Coding | First token | 300-word answer |
| -------------------------------- | ------- | ----- | --------- | ------ | ----------- | --------------- |
| DeepSeek V4.1 Flash, high        | 0.99    | 1.00  | 1.00      | 1.00   | 1.8 s       | 21.9 s          |
| Gemini 3.8 Flash, low            | 0.98    | 1.00  | 1.00      | 0.94   | 2.3 s       | 6.5 s           |
| Gemini 3.6 Flash, low            | 0.97    | 1.00  | 1.00      | 0.96   | 2.1 s       | 4.6 s           |
| GLM-5.3, high                    | 0.96    | 0.95  | 1.00      | 0.96   | 8.2 s       | 17.2 s          |
| GLM-5.3-Flash, high              | 0.95    | 1.00  | 0.89      | 0.92   | 1.9 s       | 9.4 s           |
| gpt-oss-120b, high               | 0.93    | 0.89  | 1.00      | 0.81   | 0.9 s       | 74.7 s          |
| Gemini 3.5 Flash-Lite, low       | 0.92    | 1.00  | 0.78      | 0.89   | 1.6 s       | 3.0 s           |
| Kimi K2.6, high                  | 0.88    | 1.00  | 1.00      | 0.50   | 1.8 s       | 42.4 s          |
| Qwen3.8 27B, high                | 0.87    | 1.00  | 1.00      | 0.50   | 1.0 s       | 86.5 s          |
| Gemini 3.1 Flash-Lite, low       | 0.84    | 1.00  | 0.44      | 0.96   | 1.7 s       | 3.2 s           |
| DeepSeek V4.1 Flash, no thinking | 0.82    | 1.00  | 0.33      | 0.96   | 1.6 s       | 7.1 s           |

The 300-word column is what a user actually waits for, hidden thinking included, and it reorders the field: Qwen3.8 27B and gpt-oss-120b take well over a minute, while the Gemini Flash models finish in under seven seconds. DeepSeek without thinking got full marks on tools and fell apart on reasoning (0.33), so it suits chat lines and single lookups and little else. Three checks were fixed after a first pass because they marked correct answers wrong (a logic puzzle with three valid answers, among them), and only the fixed versions are scored.

## Prices, from the providers' own pages

List prices per million tokens for the tested models, plus the two Claude models from the follow-up run below, read from each provider's pricing page on November 13, 2026. Nothing tested here changed price between October 26 and today.

| Model                                           | Provider         | Input | Cached input | Output |
| ----------------------------------------------- | ---------------- | ----- | ------------ | ------ |
| GLM-5.3-Flash                                   | Workers AI       | $0.15 | $0.03        | $0.50  |
| DeepSeek V4.1 Flash (1017)                      | Workers AI       | $0.30 | $0.006       | $1.20  |
| gpt-oss-120b                                    | Workers AI       | $0.35 | not listed   | $0.75  |
| Qwen3.8 27B                                     | Workers AI       | $0.45 | not listed   | $3.20  |
| Kimi K2.6                                       | Workers AI       | $0.95 | $0.16        | $4.00  |
| GLM-5.3                                         | Workers AI       | $1.40 | $0.26        | $4.40  |
| Gemini 3.1 Flash-Lite                           | Google AI Studio | $0.25 | $0.025       | $1.50  |
| Gemini 3.5 Flash-Lite                           | Google AI Studio | $0.30 | $0.03        | $2.50  |
| Gemini 3.6 Flash and 3.8 Flash                  | Google AI Studio | $0.75 | $0.075       | $3.75  |
| Claude Haiku 5.5 (prompts up to 100,000 tokens) | Anthropic        | $0.10 | $0.01        | $0.50  |
| Claude Sonnet 5.5                               | Anthropic        | $2.00 | $0.10        | $10.00 |

Sources: [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) (page updated November 12, 2026), [Gemini pricing](https://aistudio.google.com/docs/pricing) and [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing). Two price details change the math. Google lists Gemini 3.6 Flash and 3.8 Flash at double these rates from January 1, 2027. And Haiku 5.5 charges five times as much for any request whose prompt is over 100,000 tokens, cache reads included, which matters for an agent whose history grows through a long task.

Price per token is a poor guide on its own. An agent re-sends most of its prompt on every step, so the cached input price is the one you mostly pay, and the discounts differ a lot: DeepSeek's cached input costs 2% of its full input price, Gemini's and Haiku's 10%, and GLM-5.3-Flash's 20%. Kimi K2.6 costs six times GLM-5.3-Flash per input token and passed six fewer runs.

## A larger follow-up run

GLM-5.3-Flash and DeepSeek V4.1 Flash were one run apart on passes, but DeepSeek's writing score was 4.3 against 2.8 at a little over twice the cost per pass, and most of what people delegate ends in something a person reads. On October 24 we ran a larger paired test, 14 tasks with three runs each: DeepSeek passed 38 of 42 against GLM-5.3-Flash's 33, at a mean model time of 53 seconds against 98, with a writing score of 4.5 against 3.6.

Haiku wasn't in the first run because our gateway had no Anthropic key yet. A run on the same 14 tasks on October 25 had Claude Haiku 5.5 passing 37 of 42, in line with DeepSeek, at a mean model time of 27 seconds against DeepSeek's 69 and with half the tool errors. Its one weak task was feedback-revise. Claude Sonnet 5.5 passed 38 of 42 on the same tasks at 19 times Haiku's cost per success, which is hard to justify for routine work.

What a model's price means for what you pay is in [how much an AI agent costs](https://construct.computer/blog/how-much-does-an-ai-agent-cost/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost). On Starter and Pro you can run Construct on your own model key; the [Claude API key guide](https://construct.computer/blog/claude-api-key-ai-agent/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost) covers that side.

## What a 22-run benchmark cannot tell you

Twenty-two runs per model is enough to see big gaps and not enough to rank close ones. A 95% interval on 19 of 22 runs from about 67% to 95%, and on 18 of 22 from about 61% to 93%, so GLM-5.3-Flash, Gemini 3.8 Flash, DeepSeek and Qwen at the top are statistically level. The bottom of the table is clearer: gpt-oss-120b at 10 of 22 is below the leaders on any reading.

The writing judge is one model, Gemini 3.8 Flash, scoring three tasks, and it may favour its own family. It did score Gemini 3.6 Flash at 2.5 and both Flash-Lites at 1.8, so it isn't simply rewarding Google models, but treat the judge column as a direction.

Our tasks are our customers' kind of work: CRM edits, research with citations, documents and writing for founders and small teams. A coding agent or a support bot would need its own tasks. The fixtures remove web latency and bot-blocking, so real tasks take longer. Speeds are what Workers AI and Google served us that day, and the same model can be several times faster on its maker's own API. And it is one day: providers update models under the same name, which is why a benchmark like this needs rerunning whenever a model changes.

Several cheap models we wanted to test, including MiniMax M3.1 Flash, MiMo V2.6 Flash, Qwen3.8 Flash-Next and GPT-6 Luna, weren't reachable through our gateway, so they aren't in this post.

## How we checked this

The benchmark and probe ran on October 23, 2026, through the previous version of Construct's production agent code (`apps/api/benchmarks/agent` in that API repository) and our AI Gateway, with the settings above; the follow-up runs on October 24 and 25 used the same harness with three runs per task. Prices were read from Cloudflare's, Google's and Anthropic's pricing pages on October 26 and again on November 13, 2026. For a benchmark of two small models on one narrow decision, see our [Clef and Jev benchmark](https://construct.computer/blog/clef-vs-jev-benchmark/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost), and for why long tasks fail even with a good model, [your agent has a half-life](https://construct.computer/blog/agent-task-half-life/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost).
