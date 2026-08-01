+++
date = '2026-07-31'
draft = false
title = "All our Agents get computers, we pay for almost none"
description = "Construct is an AI employee with a real Linux computer per user. Don't get excited - we are not paying for all of them. How we run that on Cloudflare Durable Objects, Sandboxes, and R2."
summary = "Every Construct agent gets a real Linux computer. We pay for almost none of them. How we run that on Cloudflare Durable Objects, Sandboxes, and R2."
tags = ["engineering", "cloudflare", "durable-objects", "infrastructure", "construct"]
og_image = "/media/cloudflare-agents-og.jpg"
author = 'Ankush'
+++

Construct is an AI employee. You hand it a job. It goes and does the job, without you having to babysit it.

To do that with agents like Hermes or OpenClaw, you spin up a VPS. Real CPU. Real disk. A full Linux machine that stays on between turns. That costs real money, and the moment more people sign up to poke around and never come back, it **murders your infrastructure bill**.

We give every Agent that same kind of computer.

Don't get excited - we are not paying for all of them.

The computers work. When someone asks Construct to do something, the machine wakes up and does it. When the tab goes quiet, nothing stays on just to cosplay as useful. Idle boxes are a kink we refuse to subsidize.

We like edging. So we put the whole stack on the edge. Agent loop in a Durable Object. Linux summoned for one tool call, then gone. Disk that is not a disk. The bill only finishes when somebody actually works.

This post is how we built that. Behaviour, constants, and tradeoffs are production.

## The bill that scaled with people who never came back

The default way to run an AI agent is to hand it a Linux box and walk away.

Not stupid. Agents are trained on bash. Bash wants a filesystem and a process table. The lazy move is a machine that stays up between turns. Lazy is usually correct.

Until the invoice arrives.

We know that invoice because we signed it first. Construct's original backend was a Bun and Elysia monolith on a VPS. SQLite on local disk. nginx out front. Roughly 1,300 lines of container management whose only job was handing every user their own box. It worked. Growing the product meant growing a fleet of real machines with real disks, billed through the silent hours where nobody typed a character.

That is the expensive version of "every user gets a computer." Technically true. Financially a treadmill. Someone who signed up once and ghosted cost the same as a power user. The product could not scale if the bill scaled with accounts instead of work.

We killed it on 30 March 2026. Commit title: "migrate backend from VPS monolith to Cloudflare Workers." Everything in this post starts there.

Hono on Workers. Per-user WebSocket hub in a Durable Object with hibernation. Container object that archived to R2 on sleep and restored on wake. D1 for relational state. R2 for files. Frontend on Workers assets. Two days later we dragged the leftover container infrastructure into a legacy folder and wrote the plan we still run: the agent runs headlessly inside Durable Objects.

Containers and Sandboxes went GA on 13 April 2026. We moved onto the Sandbox SDK once it had the shape we wanted.

We did not see the future. We stared at a cost curve that scaled with signups instead of usage, bet on Durable Objects before there was a tidy product name for the thing, and watched the platform walk to the same answer. camelAI [hit the same wall and reached nearly the same conclusion](https://camelai.com/blog/our-coding-agent-runs-in-a-cloudflare-durable-object-not-a-vm) independently. Validation, or a warning about people who write posts like this. Both.

## Only half a computer deserves to be awake

"The agent needs a computer" is two unrelated things taped together.

**Agent loop:** transcript, tool routing, model calls, memory recall. This is how Construct thinks across a turn.

**Machine:** the thing that runs `pdftotext`, converts a spreadsheet, compiles a project, unzips the archive somebody should not have uploaded. This is how Construct touches a real filesystem.

Only the second needs Linux.

The first needs durable state and a socket. Cloudflare sells exactly that. Split the two and the expensive half stops needing to be alive at all.

Everybody argues about which model to use. Almost nobody argues about which half of their stack is getting paid to nap. That is the whole post, in one sentence.

## Linux shows up, edges the job, and leaves

This is the section the title is about.

Each Construct agent gets one Durable Object, resolved by name. Sessions are rows inside it, not objects of their own. Temporary subagents run as delegated sessions on the same parent. Fan out a job - buy concurrency, not instances. That is how Construct can split a big ask without spinning up a fleet.

The transcript lives in that object's SQLite. Two things, kept apart on purpose. One table is the append-only message log the user scrolls through. A separate record holds the compaction summary plus a watermark of how far it has already consumed. That second one is what reaches the model. Conflate them and you pay, per turn, to re-send an afternoon of conversation to a model that did not ask for it. People do this. At scale.

Hibernation is where the bill actually moves. We use the WebSocket hibernation API, stash per-connection state on the socket itself, and let the runtime answer keepalives without ever waking the object.

A tab open all afternoon is not a running process. It is a socket the runtime holds and a handful of SQLite rows. The object wakes when something happens. Goes back down when it does not. Held, not running. Your Construct session feels continuous. Our invoice does not.

Eviction can happen any moment, so every transcript row also archives to D1. Empty on start? Restore from the archive. Make death cheap and constant and it stops being an incident.

One annoying edge case: replayed reconnect events can include a turn-started with no matching completion, because the object got evicted mid-turn. Client reconnects, nothing is running - we send terminal idle status so nobody sits watching a spinner think about a thought that died twenty minutes ago.

When the agent calls the terminal tool, we resolve a sandbox:

```
sandbox = getSandbox(SANDBOX_BINDING, instanceKeyFor(user, workspace), {
    transport:            rpc,
    enableDefaultSession: false,          # every exec is a fresh shell
    sleepAfter:           idleWindowFor(plan),
})
```

Instance key scoped to user, or workspace when we know it. Not per agent. Not per session. Live containers track active humans, not agent count. Matters the moment somebody spawns twelve agents and goes to lunch.

`sleepAfter` is the pivot. Ten minutes idle and the box is gone. We call that a feature. You can call it edging. Same config value. The idle window is the plan's command ceiling in minutes, clamped by a global 300-second cap, plus a five minute buffer. That resolves to a ten minute sleep on every plan today. Pair with active CPU billing on Cloudflare Containers - charged for CPU consumed, not wall-clock uptime - and an idle sandbox stops being something you manage.

Difference between "we should build a reaper for idle machines" and "there is nothing to reap." One is a roadmap item forever. The other is a config value.

Unglamorous consequence: every exec is a fresh shell. Working directory does not persist. Agents hate this personally. We wrote a hint into the failure path explaining that each terminal call starts clean, relative paths resolve against the scratch tree, and any directory change or exported variable from an earlier call is gone forever. Grief counselling in a string in an error branch.

Before each exec: kill leftover processes, then mount, then run. Kill after mount and you drop the local bucket's inotify watch and can leave a stale read-only workspace behind. Learned that the hard way.

## She wrangler on my D1 till I R2

Construct's durable workspace is an R2 bucket mounted into the container over s3fs. `allow_other`. Explicit uid and gid so the non-root user can actually write.

She wrangler on my D1 till I R2. The files finish. The machine does not have to.

This is the second half of the cost story, and the half people skip. Quotas of 100 MB, 1 GB, and 3 GB are quotas on bytes stored, not volumes kept spun up. When Construct saves a report, a spreadsheet, or a research brief, those files outlive the machine by construction. They were never on the machine. Nobody's work sits on provisioned block storage waiting for their owner to remember the product exists.

Contrast again: provisioned volume waiting patiently versus bytes in R2 that do not care if the box is awake.

How we verify the mount matters more than the mount itself. Checking the directory exists is useless. Passes on a stale read-only mount every time. So we make the non-root user touch a probe file and delete it, with a ten second timeout. Exit code zero means the mount is actually writable.

Probe fails: unmount, remount, fix ownership, probe again, only then give up. Debounced to once a minute. Isolate-level mount cache key carries a version string we bump when mount policy changes, so a warm isolate can never silently skip a policy change.

Honest footnote: local development uses plain directory sync, not FUSE. Files land root-owned. We chown on mount. That local/prod divergence cost us an afternoon. It is why we trust a write probe over any status output that claims everything is fine.

## What living on the edge actually costs

No sales pitch from here down. Living on the edge has a price. We pay it.

You cannot set `USER` in a Cloudflare Sandbox image. Control plane intercepts HTTPS and needs root. Privilege drop moves to the point of execution. Dom energy stays with the control plane. The agent bottoms out as `runuser`. Elevated commands stay root through a wrapper. Everything else is `runuser -u <agent user>`.

No sudo. No passwordless sudoers. Process and FD limits by the wrapper. Elevated access per command or until the container sleeps. Grants live inside the container, not Worker memory. Once the machine is disposable, the container is the correct place for short-lived trust. Permission that dies with the box is permission you never have to remember to revoke.

Memory and a registry catalog used to be separate Workers behind service bindings. We folded them into one. Never a latency optimisation. Service bindings are already efficient in-account transport. The cost was operational: two more deployments, more local processes, more domains, more generated binding contracts, releases that had to be choreographed. Microservice theatre for 41 KiB. We stopped. Nothing came.

Memory was about 41 KiB compressed. Registry under 1 KiB. Combined Worker about 1,002 KiB against a 2 MiB gate. 500 ms startup stays a cutover check because Wrangler dry runs do not report startup. We wrote down when to undo it: compressed bundle past 2 MiB, startup past 500 ms, own release cadence needed, or failures widen the API blast radius. Four triggers. Before anyone got attached.

Web app served by a Worker with static assets rather than Pages, because we needed custom domains to manage their own DNS and Pages OAuth could not.

Living on the edge means never assuming you have time. Construct's memory recall runs on a budget. Whole recall: 800 ms. Inside that, remote embedding plus Vectorize: 250 ms. Those are configured budgets, not measured percentiles. We do not have deployed latency dashboards yet. Docs say so.

SQLite full-text search and graph traversal are the floor and always return, local to the Durable Object. Vectorize is best-effort on top. Vector path drags: slightly worse answer, not a hang. On one big warm box you would simply wait. Waiting is exactly what you cannot afford when nothing is warm by default. Warmth is a luxury. Edging is the default.

Embedding model was the one place with real measurements. 18-query set with close distractors, on Workers AI:

| Model                | recall@1 | mrr   |
| -------------------- | -------- | ----- |
| qwen3-embedding-0.6b | 15/18    | 0.892 |
| bge-m3               | 14/18    | 0.889 |
| bge-large-en-v1.5    | 13/18    | 0.852 |
| embeddinggemma-300m  | 12/18    | 0.824 |

Qwen3 is trained for asymmetric retrieval. Tell it whether it holds a question or a stored record and ranking tightens. Query-side instruction moved mrr from 0.892 to 0.924 on the same set. Free accuracy for one string. Take it.

A 0.6b model also keeps this inside budget. Memory pipeline gate: USD 1 per 1,000 turns, excluding the primary chat model. Do not swap embedding models casually. Vectorize indexes are built at those exact dimensions. Different model means recreate and re-embed everything.

Three scars from the platform:

**`setTimeout` versus `setAlarm` has a boundary around ten seconds.** Discord gateway reconnects with backoff. Anything beyond ten seconds goes on an alarm. Timers do not survive eviction. That object holds one WebSocket for every guild we serve. Split it when Discord reports more than one shard, somewhere around 2,500 guilds. Better to schedule that than discover it at 3am.

**A fallback on the same backend as its primary is not a fallback.** Same outage, different name. Compaction runs the same Gemma build on Workers AI and AI Studio. Failover costs the route. Every other slot crosses providers.

**Alarms hand you a bare Durable Object id.** `ctx.id.name` only exists when you reached the object through a named stub. Alarm-triggered instantiation does not. Ours addressed outbound messages. Queue rejected them. Repair alarm re-queued forever, at cost. Infinite unfinished business. Fix: persist the name on first use. Nothing warns you.

The container is real. It is not free. Image lands between 1.5 and 1.9 GB, which forces `standard-1`, because disk allocation is effectively the image size limit. LibreOffice needs 4 GiB or it gets OOM killed. Production configured for up to 100 concurrent instances. Command execution capped at 300 seconds on every plan today. That is a real product limit this architecture caused, not a feature. s3fs is not real POSIX. It will surprise you on a weekend. Fresh shells irritate agents trained on bash. We pay for that in prompt tokens.

Flat version: if your workload is one long-lived process per user that truly never idles, none of this helps you. Buy a VM. Simpler. Happier. Nobody will make edging jokes at you.

## What we run today

Workers. Durable Objects with SQLite storage. Containers through the Sandbox SDK. D1. R2. Queues with dead letter queues. Vectorize. Workers AI. AI Gateway. Email Routing inbound with the send binding outbound. Rate limiting bindings. Cache API. Turnstile. Cron triggers. Static assets. Workers Logs. Agents SDK.

No KV. No Hyperdrive. No machines of our own. Just Construct users with computers that mostly sleep.

[construct.computer](https://construct.computer) is Cloudflare too: Pages, Functions, D1, Turnstile, and the WAF.

All our Agents get computers, we pay for almost none.

We like edging. So we put the whole stack on the edge.

That is how an AI employee can feel always-on without an always-on bill.

If you want the product side rather than the plumbing, [what an AI employee actually does](https://construct.computer/blog/ai-employee/) covers the work it completes, [inspectable agent memory](https://construct.computer/blog/ai-agent-memory/) covers what it remembers and how you correct it, and [building your own agent stack](https://construct.computer/blog/construct-vs-diy/) is the honest version of what you would be operating instead.

---

*Originally posted on [construct.computer](https://construct.computer/blog/running-ai-agents-on-cloudflare-not-vms/).*
