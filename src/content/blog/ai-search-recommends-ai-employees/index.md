---
title: "Which AI employees do ChatGPT, Google and Claude recommend?"
description: "We asked six AI engines 60 buyer questions about AI employees: Lindy was named most, vendors' own lists were cited most, and we came up 3 times in 219."
date: 2026-11-13
tags: ["ai-agents", "seo", "construct"]
cover: ./cover.webp
coverAlt: "Chart comparing how often AI search engines recommend AI employee products"
canonical: "https://construct.computer/blog/ai-search-recommends-ai-employees/"
related: ["/blogs/grokbot-alternative", "/blogs/cheap-llm-for-ai-agents", "/projects/construct-computer"]
---
When buyers ask AI engines which AI employee or AI agent to use, the product they hear most is Lindy. On September 30, 2026 we put 60 buyer questions to ChatGPT, Perplexity, Gemini, Google AI Mode, Claude and Grok and got 264 answers. Across the 224 answers to the 50 questions that don't name our product, Lindy was named in 33% of the answers whose question didn't already mention it, ahead of Zapier (25%), n8n (20%), Manus (20%) and Relevance AI (16%), and lindy.ai was cited by all six engines.

The sources behind those answers are mostly vendors. Of the citations to sites cited more than once, 58% went to companies selling software, often to the "best AI agents" lists they write about their own category. G2 was cited once in 224 answers and Capterra never. Google AI Mode stands apart: it cited YouTube in 66% of its answers and Reddit in 28%.

We make Construct Computer, one of the products in this category, which is why we ran the audit. Our own result was poor: Construct Computer came up as an option in 3 of the 219 answers to questions that don't name it, and in one of the 85 answers to "best AI employee for..." style questions.

## How the audit ran

A script opened each engine in a real Chrome window and sent the 60 prompts one at a time, all six engines in parallel, each in its private or temporary mode so that no history, memory or personalisation shaped the answers. If the script couldn't confirm private mode was on, it skipped the prompt and logged an error instead.

| Engine         | Mode                                                                  | Signed in                            |
| -------------- | --------------------------------------------------------------------- | ------------------------------------ |
| ChatGPT        | Temporary Chat, Unpersonalized; memory off, custom instructions empty | Yes                                  |
| Perplexity     | Incognito                                                             | Yes, incognito needs an account      |
| Gemini         | Temporary chat, pinned to the Flash model                             | Yes                                  |
| Google AI Mode | A separate blank browser window, since it has no incognito option     | No                                   |
| Claude         | Incognito chat                                                        | Yes                                  |
| Grok           | Private Chat                                                          | Yes, it no longer answers signed out |

Each engine got each prompt once. When an engine answered with a short clarifying question and no sources, the script sent one fixed reply, "A generalist that can run multi-step tasks.", and kept the second answer; that happened 11 times, all on Gemini. The script saved every answer's text and every link it cited.

The prompts fall into four groups: 17 category questions ("best AI employee for solo founders"), 18 comparison questions ("Lindy alternatives"), 15 problem questions ("AI that sources leads and updates HubSpot automatically") and 10 brand questions about Construct Computer. We wrote them, and a few describe the category the way we describe our product, such as "best AI agent with its own cloud computer" and "cheapest AI employee under $10/month". If anything, that tilts the results toward us. The full list is at the end of this post.

## How many answers each engine gave

Not every engine finished. Perplexity stopped answering after 16 prompts, Gemini after 36 and Claude after 46, logging errors such as "no answer from Perplexity (message limit or a changed page?)" and Gemini's own "Sorry, something went wrong". We report what completed on the day and didn't top it up later, so the six engines aren't equally weighted.

| Engine         | Attempted | Answered | Errors | Answers to non-brand questions | Non-brand answers citing nothing | Distinct sites cited per answer (mean) |
| -------------- | --------- | -------- | ------ | ------------------------------ | -------------------------------- | -------------------------------------- |
| ChatGPT        | 60        | 60       | 0      | 50                             | 2                                | 2.9                                    |
| Perplexity     | 16        | 13       | 3      | 13                             | 0                                | 3.9                                    |
| Gemini         | 36        | 29       | 7      | 24                             | 17                               | 1.0                                    |
| Google AI Mode | 60        | 60       | 0      | 50                             | 2                                | 6.6                                    |
| Claude         | 46        | 43       | 3      | 38                             | 12                               | 3.1                                    |
| Grok           | 60        | 59       | 1      | 49                             | 3                                | 24.4                                   |
| All            | 278       | 264      | 14     | 224                            | 36                               |                                        |

The engines differ more in how they source an answer than in what they say. Grok cited about 24 different sites per answer and wrote the shortest replies (a median of 584 characters); Gemini usually cited nothing. Any count pooled across engines is therefore mostly Grok, so we report the engines separately wherever it matters.

## Which products the engines name

We counted an answer as naming a product when the product's name appears in the answer's own prose. We removed the source labels engines print beside a claim, so a site cited as a source doesn't count as a recommendation. An answer to a question that already names the product is left out of that product's count, so "Lindy alternatives" doesn't inflate Lindy.

Products named most often in answers to the 50 non-brand questions, among answers whose question didn't name the product:

| Product                     | Answers naming it | Share of eligible answers | Engines that named it (of 6) |
| --------------------------- | ----------------- | ------------------------- | ---------------------------- |
| Lindy                       | 70 of 210         | 33%                       | 6                            |
| Zapier, incl. Zapier Agents | 54 of 219         | 25%                       | 6                            |
| n8n                         | 44 of 224         | 20%                       | 6                            |
| Manus                       | 43 of 215         | 20%                       | 6                            |
| Relevance AI                | 35 of 224         | 16%                       | 6                            |
| OpenClaw                    | 31 of 218         | 14%                       | 6                            |
| Claude Cowork               | 28 of 206         | 14%                       | 6                            |
| Microsoft Copilot           | 25 of 224         | 11%                       | 6                            |
| ChatGPT agent or Operator   | 23 of 224         | 10%                       | 6                            |
| CrewAI                      | 22 of 224         | 10%                       | 6                            |
| Cursor                      | 21 of 224         | 9%                        | 5                            |
| Gumloop                     | 20 of 224         | 9%                        | 6                            |
| Construct Computer          | 3 of 219          | 1%                        | 2                            |

Naming is weaker than recommending. Some answers name Zapier or n8n to contrast them with agents, and Cursor shows up when an answer drifts to coding, so read the table as who is in the conversation.

Three engines lean toward their own maker. Claude named an Anthropic agent product (Claude Cowork, Claude Code) in 46% of the answers where the question didn't mention Claude, against 5% to 28% on the other engines. ChatGPT named an OpenAI agent product in 23%, against 11% to 17% elsewhere, and Grok named Grok Bot or another xAI agent in 11%, against at most 8% elsewhere. Gemini and Google AI Mode named Google's agent products in 4% to 6% of answers, no more than the others did. The samples are small (35 to 49 answers per engine), so read this as a pattern worth checking, and stop short of calling it a verdict.

## Which sites the engines cite

Most cited sites per engine, by share of that engine's answers to the 50 non-brand questions:

| Engine         | Most cited         | Second                   | Third                                  |
| -------------- | ------------------ | ------------------------ | -------------------------------------- |
| ChatGPT        | reuters.com (18%)  | lindy.ai (14%)           | slack.com (10%)                        |
| Perplexity     | vellum.ai (23%)    | taskade.com (23%)        | lindy.ai (15%)                         |
| Gemini         | vellum.ai (12%)    | several sites at 4% each |                                        |
| Google AI Mode | youtube.com (66%)  | reddit.com (28%)         | linkedin.com (26%)                     |
| Claude         | vellum.ai (18%)    | gravity.fast (11%)       | usecarly.com (8%)                      |
| Grok           | usecarly.com (41%) | lowcode.agency (31%)     | agnt.gg and itechguides.com (29% each) |

Across all engines, 224 answers cited 973 different sites, most of them once. The sites cited by the most engines were vendors: lindy.ai and vellum.ai by all six, eesel.ai and cellcog.ai by five. ChatGPT was the only engine to lean on news, with Reuters in nearly a fifth of its answers.

To see what kind of site gets cited, we sorted every site cited in two or more answers (263 sites, 62% of all citations) by its own homepage: a company selling software, a review site or software directory, an agency or consultant, news, YouTube, Reddit, other social and community sites, and reference sources such as GitHub and Wikipedia.

Citations by type of site, for sites cited in two or more answers to the 50 non-brand questions:

| Site type                             | ChatGPT | Perplexity | Gemini | Google AI Mode | Claude | Grok | All |
| ------------------------------------- | ------- | ---------- | ------ | -------------- | ------ | ---- | --- |
| Software vendor                       | 80%     | 80%        | 76%    | 61%            | 76%    | 49%  | 58% |
| Review site or directory              | 2%      | 5%         | 0%     | 2%             | 4%     | 16%  | 11% |
| Agency, consultant or personal blog   | 0%      | 7%         | 14%    | 3%             | 12%    | 14%  | 10% |
| News and newsletters                  | 13%     | 5%         | 5%     | 1%             | 5%     | 14%  | 10% |
| YouTube                               | 0%      | 0%         | 0%     | 14%            | 0%     | 2%   | 4%  |
| Reddit                                | 0%      | 0%         | 0%     | 6%             | 0%     | 0%   | 1%  |
| Other social and community            | 0%      | 2%         | 5%     | 11%            | 0%     | 3%   | 4%  |
| Reference (GitHub, papers, Wikipedia) | 4%      | 0%         | 0%     | 2%             | 3%     | 2%   | 2%  |

Most of the vendor share is vendors writing about their category. Of the 853 cited URLs on those vendor sites, 49% are list or comparison pages and another 24% are blog posts and guides; product pages, docs and everything else make up 27%. Of all 2,175 cited URLs, 39% look like lists or comparisons ("best", "top 10", "alternatives", "vs"), and 49% of those sit on the site of a vendor we could identify, which makes that a floor. For Perplexity and Gemini about three in four cited URLs were list or comparison pages, and for Claude nearly two in three. The review sites that do get cited are mostly newer AI-tool directories; the established review platforms barely register, with one G2 citation, one Product Hunt citation and no Capterra or Trustpilot citations in 224 answers.

## Where Construct Computer showed up

Our audit script marks an answer as naming us when it says "Construct Computer" or "construct.computer", or links to our site. By that rule 37 of the 264 answers named us, which sounds better than it is. Thirty-one of them answer questions that already contain our name: the ten brand questions and "CellCog vs Lindy vs Construct". That leaves six, and in three of those our site is only a source.

| Question                                                 | Engine         | What the answer did                                                                                       |
| -------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| cheapest AI employee under $10/month                     | ChatGPT        | Listed Construct at $9 a month among five options, citing our blog                                        |
| cheaper alternative to Grok Bot                          | Google AI Mode | Recommended Construct's $9 Lite plan as a managed alternative                                             |
| Claude Cowork vs a cloud AI employee                     | Google AI Mode | Named Construct Computer as an example of a cloud AI employee, citing a directory listing                 |
| Zapier vs AI agent for small business                    | Google AI Mode | Cited our [AI agent vs Zapier post](https://construct.computer/blog/ai-agent-vs-zapier/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost) as a source; no product recommended        |
| my AI agent keeps failing halfway through long workflows | Google AI Mode | Built its advice on our [agent half-life post](https://construct.computer/blog/agent-task-half-life/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost); recommended workflow engines |
| my AI agent keeps failing halfway through long workflows | Grok           | Quoted our "95% per step, about 8% on a 48-step job" figure; recommended LangGraph and Temporal           |

So the column that says "named" and the column that says construct.computer was cited measure different things. A citation means an engine used one of our pages as evidence. A recommendation means it put the product in front of the buyer. Outside the brand questions our site was cited in eight answers, three of them to the question that names us, and the product came up as an option three times: twice in Google AI Mode and once in ChatGPT. Two of the three were questions about price, and one of those, the cheapest AI employee under $10 a month, is a question we wrote around our own $9 plan.

The brand questions show a second problem. "Construct Computer pricing" was read as the price of building a PC by all five engines that answered it; ChatGPT gave PC build prices and Grok reviewed a Russian PC builder called Construct PC. Claude took the name to mean the Construct 3 game engine. Overall, Google AI Mode identified us correctly in 9 of its 10 brand answers, Grok in 6 of 10, ChatGPT in 5 of 10, Claude in 4 of 5 and Gemini in 2 of 5. "Construct" is a common word, and a computer is a thing people build.

## What this audit cannot tell you

It is one run per prompt per engine on one day. AI answers vary from run to run, so any single answer could come out differently tomorrow; the patterns across 224 answers are sturdier than any one row. Three engines stopped partway, so Perplexity is represented by its answers to the first 13 prompts only, and every engine was run from one location with the accounts noted above.

The product counts come from matching names in the answer text after removing source labels. We checked every Construct Computer match by hand, and spot-checked the others, but a name used in passing counts the same as a recommendation. The site types come from each site's own homepage as we read it on October 26, 2026, and cover the 263 sites cited more than once; the other 710 sites, cited once each, are counted in the list-page share but not in the site-type table. And we wrote the prompts, as described above.

## What this means for a small software company

If you sell software in a crowded category, this is the picture the data gives, and most of it applies beyond AI agents.

The engines answer from what is written about a category, and most of what is written is vendors' own lists. Lindy's lead fits that: it is named most and cited by every engine. A company that hasn't written about its category, or been written about, gives the engines nothing to retrieve.

Each engine reads a different web. A strategy that works for Grok, which pulls two dozen listicles per answer, does little for Google AI Mode, which leans on YouTube, Reddit and LinkedIn, or for ChatGPT, which cited Reuters more than any vendor. Watching one engine tells you little about the others.

A citation and a recommendation are different results. Two engines used our reliability numbers to explain why agents fail and then recommended other tools. The two answers that recommended us on price both cited our own pages: ChatGPT cited a list of AI employee platforms on our blog, and Google AI Mode our homepage.

An ambiguous name costs you the brand questions. If a buyer who already knows your name can't get your pricing from an AI engine, every other gain leaks away.

And the established review platforms aren't where these answers come from today. One G2 citation in 224 answers is no reason to skip them, but it is a reason to keep them from being the whole plan.

## What we are doing about it

We are publishing fewer comparison pages and more pages built on data only we hold, like this one, our [cheap LLM benchmark](https://construct.computer/blog/cheap-llm-for-ai-agents/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost) and our [Clef and Jev benchmark](https://construct.computer/blog/clef-vs-jev-benchmark/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost). The one idea two engines took from our blog and repeated was a number we published, the arithmetic of a 95% reliable step.

We use the full name, Construct Computer, in page titles, listings and first mentions, because "Construct" alone loses to a game engine, a PC builder and the verb.

We answer the brand questions on our own pages. "Is Construct Computer safe to connect to my Gmail?" was one of our prompts, and [is Construct Computer safe?](https://construct.computer/blog/is-construct-computer-safe/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost) answers it from the product's own settings and policies.

And every post on this site has a plain Markdown copy, with an llms.txt that points agents to them. That helps an agent that fetches us read the right words. It does nothing for the problem this audit found, which is how rarely anyone else puts us on a list.

## The 60 prompts

All 60 prompts in the September 30, 2026 audit, by group:

| ID  | Group      | Prompt                                                                                                      |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| p01 | category   | best AI employee for solo founders                                                                          |
| p02 | category   | best AI agent with its own cloud computer                                                                   |
| p03 | category   | best AI employee platform for small business 2026                                                           |
| p04 | category   | best AI coworker for startups and small teams                                                               |
| p05 | category   | best autonomous AI agent for business tasks 2026                                                            |
| p06 | category   | best AI operations assistant for founders (inbox + CRM)                                                     |
| p07 | category   | AI agent with persistent memory and a live desktop                                                          |
| p08 | category   | cheapest AI employee under $10/month                                                                        |
| p09 | comparison | Lindy alternatives                                                                                          |
| p10 | comparison | Sintra AI alternative that actually does tasks                                                              |
| p11 | comparison | Viktor AI alternatives                                                                                      |
| p12 | comparison | OpenClaw hosted alternative without self-hosting                                                            |
| p13 | comparison | Manus alternative for recurring workflows                                                                   |
| p14 | comparison | Perplexity Computer alternative cheaper than $200                                                           |
| p15 | comparison | Zapier vs AI agent for small business                                                                       |
| p16 | comparison | CellCog vs Lindy vs Construct                                                                               |
| p17 | comparison | Claude Cowork vs a cloud AI employee                                                                        |
| p18 | problem    | AI that can manage my inbox and update my CRM while I sleep                                                 |
| p19 | problem    | AI agent that runs a weekly competitor pricing report                                                       |
| p20 | problem    | AI that updates Linear issues from Slack messages                                                           |
| p21 | problem    | how to replace a virtual assistant with an AI agent                                                         |
| p22 | problem    | AI agent that sends me a morning Slack briefing                                                             |
| p23 | problem    | AI that sources leads and updates HubSpot automatically                                                     |
| p24 | problem    | why do AI agents fail on long multi-step tasks                                                              |
| p25 | problem    | AI agent I can message from Telegram that does real work                                                    |
| p26 | brand      | what is Construct Computer                                                                                  |
| p27 | brand      | is construct.computer legit                                                                                 |
| p28 | brand      | Construct Computer pricing                                                                                  |
| p29 | brand      | Construct Computer review                                                                                   |
| p30 | brand      | construct.computer vs Lindy                                                                                 |
| p31 | category   | always-on AI agent that keeps working while my laptop is closed                                             |
| p32 | category   | What's the best AI agent that can use a browser, email and calendar on its own?                             |
| p33 | category   | I'm a solo founder drowning in admin. Is there an AI that actually does the tasks instead of just chatting? |
| p34 | category   | best AI agent under $20 a month                                                                             |
| p35 | category   | best AI employee for a small marketing agency                                                               |
| p36 | category   | AI agent with an activity log so I can see everything it did                                                |
| p37 | category   | safest AI agent to give access to my Gmail and Slack                                                        |
| p38 | category   | best personal AI agent for work, not shopping                                                               |
| p39 | category   | AI agent I can assign work to in Slack                                                                      |
| p40 | comparison | ChatGPT Dots alternatives without a Pro subscription                                                        |
| p41 | comparison | cheaper alternative to Grok Bot                                                                             |
| p42 | comparison | Meta Muse alternatives for running a small business                                                         |
| p43 | comparison | Claude Cowork vs ChatGPT Dots vs Grok Bot for a small business                                              |
| p44 | comparison | Perplexity Computer vs Claude Cowork vs Manus for background tasks                                          |
| p45 | comparison | Gemini Spark alternatives                                                                                   |
| p46 | comparison | Is Genspark Claw worth it, or is there a better AI employee with its own cloud computer?                    |
| p47 | comparison | Sintra vs Marblism vs Lindy for a small business                                                            |
| p48 | comparison | hosted Hermes Agent vs a managed AI employee for a non-technical founder                                    |
| p49 | problem    | How can I give an AI agent its own email inbox?                                                             |
| p50 | problem    | How do I safely let an AI agent use my Gmail without it deleting things?                                    |
| p51 | problem    | how do I run an AI agent on a schedule without keeping my laptop on?                                        |
| p52 | problem    | AI assistant that drafts email replies but waits for my approval before sending                             |
| p53 | problem    | AI that can research a list of companies and fill in a spreadsheet with sources                             |
| p54 | problem    | my AI agent keeps failing halfway through long workflows. What should I use instead?                        |
| p55 | problem    | how do I hire an AI employee for my startup?                                                                |
| p56 | brand      | Construct Computer alternatives                                                                             |
| p57 | brand      | Construct Computer vs Grok Bot                                                                              |
| p58 | brand      | Construct Computer vs ChatGPT Dots                                                                          |
| p59 | brand      | is Construct Computer safe to connect to my Gmail?                                                          |
| p60 | brand      | who is behind Construct Computer and what does it do?                                                       |

## How we checked this

The audit ran on September 30, 2026, with our audit script driving each engine in Chrome; the counts above come from its saved answers and links (`summary.csv` and `results.json` for that date), analysed with a script that reproduces every table in this post. Every answer that mentions Construct was read in full, and every brand answer was read to judge whether the engine identified us. Site types were assigned from each site's homepage title and description, fetched on October 26, 2026. We make Construct Computer, a product in the category these questions are about.
