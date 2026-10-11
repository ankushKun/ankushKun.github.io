+++
date = '2026-08-11'
draft = false
title = "Your agent has a half-life"
description = "Why AI agents keep failing on long multi-step jobs: a 95% reliable agent finishes 48 steps 8.5% of the time. The fix is a resumable run, not a better model."
summary = "Why AI agents keep failing on long multi-step jobs: a 95% reliable agent finishes 48 steps 8.5% of the time. The fix is a resumable run, not a better model."
tags = ["ai-agents", "construct"]
og_image = "/media/construct/agent-task-half-life.jpg"
author = 'Ankush'
canonical = "https://construct.computer/blog/agent-task-half-life/"
related = ["/blogs/agent-verification-gap", "/blogs/running-ai-agents-on-cloudflare-not-vms", "/projects/2026.construct-computer"]
+++

Valve named a game *Half-Life* after the physics joke hiding in plain sight: how long something lasts before half of it is gone. Your agent has one of those. It just does not get a hazmat suit or a crowbar out of the deal.

Take an agent that gets 95% of its individual steps right. That is a good agent. Now give it a ten-step job.

It finishes six times out of ten. The other four times, it fails halfway. Literally. A half-life.

Nothing broke. No step regressed. 0.95 to the tenth power is 0.60, and that is the whole story. Reliability that looks excellent per step is mediocre per job, and it gets worse in a way most people do not feel until they schedule something and walk away.

If you have been asking why your agent keeps failing halfway through a multi-step job, this is usually the answer, and it is not the one people go looking for.

## Why your agent keeps failing on long tasks

The tempting explanation is that long tasks are harder tasks. Longer means more ambiguity, more chances to misread the goal, more compounding confusion.

That explanation is wrong, and there is a clean piece of work showing why. In "Is there a half-life for the success rates of AI agents?", Toby Ord shows that agent performance across task lengths is explained by an extremely simple model: a constant rate of failing during each minute a human would take to do the task ([Ord, arXiv:2505.05115](https://arxiv.org/abs/2505.05115)). Not accumulating confusion. A flat hazard rate, ticking the entire time the job runs.

Physicists already have a letter for that rate. It is λ, the decay constant in N(t) = N₀·e^(−λt), and the half-life is just t½ = ln(2) / λ. Valve put the same λ on Gordon Freeman's suit and in the *Half-Life* logo for the same reason: it is the constant that decides how long something lasts before it is gone. Ord's result is that your agent has one too.

That gives every agent a half-life: the task duration at which its success probability hits 50%. Longer tasks fail, in Ord's framing, because they contain increasingly large sets of subtasks where failing any one fails the whole thing. Raise λ (worse per-minute reliability) or raise exposure (longer jobs), and the surviving fraction falls the same way a sample of isotope does. You do not need a crowbar for this. You need less exposure.

This reframes the problem usefully. If failure were about difficulty, you would fix it with a smarter model. If failure is a rate per unit of exposure, you fix it by reducing exposure. Those are very different engineering programs, and almost everyone is running the first one.

## Why multi-step agent workflows fail: 48 steps, 8.5% success

Ten steps is a toy. Real recurring business work is worse, because it loops.

Here is a job we hear about constantly from small agencies: monthly client reporting. Eight clients. For each one, pull analytics, pull ad spend, pull the CRM's deal movement, write the summary, render it into the client's template, email it. Six steps, eight times. Forty-eight steps.

| Per-step reliability | One 48-step run finishes |
| -------------------- | ------------------------ |
| 99%                  | 62%                      |
| 95%                  | 8.5%                     |
| 90%                  | 0.6%                     |

A 95% agent, which is a genuinely capable agent, completes that job start to finish about one time in twelve. And the failure mode is the ugly one: it dies at client six, having already emailed five reports, and you cannot tell what state anything is in without reading the whole transcript. One continuous experiment, cascading into a mess you did not budget for. Black Mesa energy, spreadsheet edition.

So people conclude agents do not work for real operations. What actually does not work is running forty-eight steps as one uninterrupted bet.

## Will a better model fix agent reliability?

There is a genuine counterargument: models are getting better at long tasks fast. METR measures the 50% time horizon, the task duration at which an agent is predicted to succeed half the time, using how long human experts need for the same work. That horizon has been doubling roughly every seven months for six years, with recent data suggesting faster ([METR, measuring AI ability to complete long tasks](https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/); [METR, time horizons](https://metr.org/time-horizons/)).

That is real progress and it is not slowing. It is also a terrible thing to plan a business process around. The horizon is defined at 50% reliability, which is a coin flip, and the doubling curve tells you nothing about next Tuesday's client reports. Gartner predicts that over 40% of agentic AI projects will be canceled by the end of 2027, citing escalating costs, unclear business value, and inadequate risk controls ([Gartner, June 2025](https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027)). A large share of those projects will die from exactly this: a demo that worked once, scheduled weekly, quietly failing most weeks. Unforeseen consequences, delivered on a cron.

Waiting for the model is a strategy with no delivery date. Shortening the run is available now.

## How to fix an agent that fails partway: cut the job at the seams

Split those forty-eight steps into eight independent six-step runs and the arithmetic inverts.

At 95% per step, one client's six-step run finishes 73.5% of the time. So a pass over eight clients lands roughly six of them, and the two that failed are named, isolated, and retryable. Run the retry and you are at 93% of the work done, with the remaining gap being two specific clients you can look at rather than one opaque dead job.

Same model. Same per-step reliability. Same total work. The only change is where the run is allowed to stop and be resumed. You have not lowered λ. You have lowered how long any one run has to survive it.

The catch is that this only works if state survives between the pieces. A six-step run that has to rebuild its own context from scratch, re-derive what the client's template looks like, re-fetch what it already fetched, has not been shortened. It has been shortened and then padded back out. Checkpointing is only cheap when the checkpoint is written somewhere durable.

In *Half-Life 2*, the Resistance spray-painted λ on walls to mark supply caches you could find later. Your agent needs the same kind of mark: a file on disk that says "this iteration already finished," not a memory that evaporates when the turn ends. That is the actual argument for giving an agent a computer instead of a context window.

## How Construct runs the same job

Construct's agent has a persistent workspace: a filesystem that outlives the turn, long-term memories it carries across sessions, and reusable workflows that run on demand or from its Calendar. Those three pieces are what turn the client-reporting job from one long bet into a job that converges. Less HEV suit cosplay, more actual hazardous-environment gear: the state that has to survive the run is sitting on disk before anything else starts.

Concretely, the reporting job becomes one scheduled workflow rather than eight:

| Piece                | What it is in Construct                                                                                    | Why it matters to the math                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| The client list      | A file in the workspace, `clients.md`, that the agent reads at the start of every run                      | The run's scope is data on disk, not something rebuilt from a prompt each time         |
| The completed work   | One file per client under `reports/2026-08/`, written as each report finishes                              | Every finished iteration is a checkpoint that outlives the run that made it            |
| The instruction      | "For each client in `clients.md` with no report in `reports/2026-08/`, produce one and email it"           | The job describes remaining work, so a rerun is a retry rather than a duplicate         |
| Standing preferences | Long-term memory: the template a given client wants, which metrics they care about                          | Iteration six does not re-derive what iteration one already established                |
| The retry            | The schedule itself, plus an on-demand run when you want it sooner                                          | The two clients that failed get picked up next pass with no manual bookkeeping         |
| The diagnosis        | The Activity feed's bounded action summaries and best-effort reasons, plus chat's bounded tool records      | You find the step that broke instead of rereading a transcript                          |

The important line is the third one. Because the instruction is scoped to clients without a report on disk, a run that dies at client six is not a disaster that needs unwinding. The next run reads the directory, sees five reports, and works on the remaining three. Nothing is sent twice, and nobody has to remember where it stopped.

Two honest boundaries. Construct's workflows are linear today: branching, fan-out, and subworkflows are not supported, so the clients are worked through inside a run rather than dispatched as eight parallel jobs. And the schedule interval is your retry cadence, so a job that must finish within the hour needs an on-demand rerun rather than patience. The infrastructure that makes a per-user filesystem cheap enough to leave lying around between runs is in [how our agents get real computers we mostly do not pay for](https://construct.computer/blog/running-ai-agents-on-cloudflare-not-vms/).

*Read next: [AI Workflow Automation](https://construct.computer/blog/ai-workflow-automation/)*
## A checklist for building a resumable agent job

The pattern generalizes past client reports. Anything shaped as "for each X, do a few things" is a candidate.

1. **Find the loop.** Almost every recurring ops job has one: per client, per invoice, per candidate, per repo. That loop boundary is your seam. Cut there first, because it is the cut that turns one long bet into many short ones.
2. **Make each iteration leave an artifact.** A file, a CRM record, a sent email. Something a later run can check for existence. If an iteration leaves nothing behind, you cannot tell a retry from a duplicate. Leave a λ on the wall.
3. **Make iterations skip completed work.** "Write the report for any client that does not already have one dated this month" is resumable. "Write the reports" is not. This one line is usually the difference between a job you can schedule and a job you have to babysit.
4. **Put the ambiguous judgment in its own step.** Judgment steps have a lower per-step success rate than mechanical ones. Isolating them means a bad judgment call costs you that step, not the run.
5. **Supervise the first several runs on demand before scheduling.** You are looking for which step is your weak link, and you will not guess it correctly.
6. **Check the trail when something fails.** Construct's Activity feed keeps bounded action summaries and best-effort reasons, and chat retains bounded tool records, so a failed iteration can be traced to a step rather than to a vibe.

That third point is worth sitting with. Most people write agent instructions as a description of the work. The instructions that survive scheduling are written as a description of the work that remains.

## What checkpointing does not fix

Checkpointing lowers the cost of failure. It does not lower the failure rate, and there are jobs where that distinction matters. You still have the same λ. You just refuse to stake the whole sample on one continuous exposure.

If your steps are genuinely order-dependent all the way through, with no natural loop and no safe stopping point, there is no seam to cut and you are back to one long bet. If a step has an irreversible external side effect, a payment, a public post, a message to a customer, then a retry is not free and idempotency has to be designed in rather than assumed. Construct lets you inspect a running task, interrupt it mid-turn, and answer a question the agent raises, but it does not currently insert a mandatory approval gate before every external side effect, so those steps still need real supervision before they run unattended.

Memory has a boundary too. Construct keeps workspace files and selected long-term memories across sessions, but automatic memory does not currently index uploaded files, private app results, terminal output, or live browser runs. Context that has to carry across a seam should be written to a file or stored explicitly, not assumed to survive because it appeared once in a transcript.

And if the work is genuinely deterministic, the same trigger and the same transformation every time with no judgment anywhere in the middle, a rule-based automation platform will do it more cheaply and more predictably than any agent. We laid out where that line falls in [AI agent vs Zapier automation](https://construct.computer/blog/ai-agent-vs-zapier/).

## Ask this instead of "which model should I use"

"Which model should I use" is the question everyone asks. It is not usually the binding constraint. A model one tier better moves your per-step reliability a few points and leaves the exponent untouched. Restructuring a 48-step run into eight 6-step runs moves the exponent, which is where the leverage lives.

Ask instead: when this job fails at step thirty, what is left on disk, and what does the retry have to redo? If the answer is "nothing" and "all of it," the model is not your problem. You do not need the right man in the wrong place. You need a workspace that outlives the turn.

Start with [AI workflow automation](https://construct.computer/blog/ai-workflow-automation/) for how reusable steps and schedules fit together, [AI agent memory](https://construct.computer/blog/ai-agent-memory/) for what carries across runs and how to correct it, and [how to choose an AI agent platform](https://construct.computer/blog/how-to-choose-an-ai-agent-platform-for-your-team/) if you are evaluating this against other tools. If the underlying idea is new, [what is an AI employee](https://construct.computer/blog/what-is-an-ai-employee/) is the place to begin.

---

*Originally posted on [construct.computer](https://construct.computer/blog/agent-task-half-life/).*
