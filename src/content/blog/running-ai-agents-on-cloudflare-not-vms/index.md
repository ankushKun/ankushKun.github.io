---
title: "Running AI agents on Cloudflare without always-on VMs"
description: "How each Construct workspace gets a Linux computer that sleeps after 10 idle minutes, on Workers, Durable Objects and Containers, with our numbers."
date: 2026-07-31
updated: 2026-11-13
tags: ["ai-agents", "cloudflare", "construct"]
cover: ./cover.webp
coverAlt: "Diagram of Construct agents running on Cloudflare Workers and Containers"
canonical: "https://construct.computer/blog/running-ai-agents-on-cloudflare-not-vms/"
related: ["/blogs/clef-vs-jev-benchmark", "/blogs/cheap-llm-for-ai-agents", "/projects/construct-computer"]
---
Every workspace in Construct has its own Linux computer, and we pay for it only while it's running a command or has run one in the last ten minutes. The rest of the agent (its chats, memory, schedules and connections) lives in Durable Objects that hibernate between events and cost nothing while they wait. All of it runs on Cloudflare: three Workers, a few Durable Object classes, Containers for the computers, Workflows for saved jobs, and D1 and R2 for storage.

This post is how that's built, what it costs, and what the platform taught us along the way. We rewrote it in November 2026 for the current version of Construct, which we rebuilt from scratch in late October.

## The numbers first

Measured on our staging deployment with our smoke test, which runs real turns against real models. These are samples, not production percentiles.

| Measure                                       | Result                                               |
| --------------------------------------------- | ---------------------------------------------------- |
| A computer's first command after it slept     | 0.8 s (Nov 4, 2026)                                  |
| A command on a computer that's already awake  | 0 to 0.1 s                                           |
| Our own work before the model is called, warm | about 20 ms                                          |
| The same when the workspace has to wake up    | 181 to 417 ms                                        |
| First word of a reply in a new chat           | 2.2 s median                                         |
| First word on a second turn                   | 1.4 s median                                         |
| A computer running flat out                   | about $0.074 an hour at Cloudflare's published rates |

One cold start was much slower: 15.6 s on Oct 29, when the host hadn't pulled the image yet. We don't have enough samples for a p95.

## Why not give every user a VM?

Agents are trained on bash, and bash wants a filesystem and a process table. The simple answer is a virtual machine per user that stays on between turns, and our first backend did exactly that: a Bun and Elysia monolith on a VPS, SQLite on local disk, and about 1,300 lines of container management to hand each person a box.

It worked, and the bill grew with signups instead of with work. Someone who signed up once and never came back cost as much as someone who used Construct every day. We moved the backend to Cloudflare Workers on March 30, 2026, and the version described here keeps the same bet.

We weren't alone. camelAI [moved its coding agent off VMs into a Durable Object](https://camelai.com/blog/our-coding-agent-runs-in-a-cloudflare-durable-object-not-a-vm) for the same reason. Its post also notes that it moved again in September 2026, to a runtime of its own, which is a fair reminder that this design fits some workloads and not others.

## An agent is two different things

"The agent needs a computer" bundles two jobs. The loop holds the transcript, calls the model, routes tools and reads memory, and all it needs is durable state and a socket to the browser. The machine runs `pdftotext`, converts a spreadsheet or installs a Python package, and only this part needs Linux.

A Durable Object is durable state plus a socket, so the loop lives there. Split the two and the expensive half can sleep whenever nobody needs it. Cloudflare's own [description of an agent harness](https://developers.cloudflare.com/agents/concepts/harness/) now draws the same line: Durable Objects hold the state, Workers run code, and Containers run Linux when a task needs a shell.

## Three Workers on one origin

| Worker             | What it holds                                                                                               | What a deploy restarts                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `construct-web`    | The React app as static assets, and a forwarder for everything else                                         | Nothing                                          |
| `construct-api`    | Sign-in, the D1 database, webhooks, and the gate in front of every workspace                                | Nothing                                          |
| `construct-agents` | The Durable Objects for workspaces, chats, team apps and the Discord gateway, plus workflows and every tool | Workspaces and chats; the computers keep running |

A request for a file never runs code. Everything under `/api` goes from web to api over a service binding, which adds no latency or cost. The api checks the session and the Origin header, then opens the person's workspace in the agents Worker through a Durable Object binding. Only web has a public address, and each Worker deploys only when its own code changes.

```
browser
  |
construct-web      static app; forwards /api, /agents, /webhooks
  |  service binding
construct-api      sign-in, D1, checks you belong to the workspace
  |  Durable Object binding
construct-agents
  Space            one per person and one per team
    Chat           one Durable Object per chat, running Think
    computer       one Linux container, asleep when idle
    WorkflowRun    one Cloudflare Workflows instance per run
```

## A Space and its chats

Each person and each team has a **Space**: one Durable Object whose SQLite holds the chat list, agents, memory, workflows, connections, the index of files, mail, the computer's state and spend. Each **Chat** is its own Durable Object running [Think](https://developers.cloudflare.com/agents/harnesses/think/), the chat agent class in Cloudflare's Agents SDK, which handles the tool loop, message storage, streaming and resuming a stream.

The Space creates chats and routes to them, but a chat's traffic never wakes the Space. A Durable Object does one thing at a time, so one object per chat lets several replies stream at once: three chats of about 500,000 characters each, sent together, answered in 6.2, 8.7 and 4.2 s.

The browser holds a WebSocket to its chat, and the chat accepts it with the hibernation API, so a tab left open all afternoon is a socket Cloudflare holds and some rows in SQLite. [Hibernatable objects bill no duration](https://developers.cloudflare.com/durable-objects/platform/pricing/) while they wait.

Deploys are where long replies used to die. We tested it by asking for a 2,500-word reply and redeploying the agents Worker while it streamed. Reading the chat back gave one message of 2,465 words ending in the words we asked it to end with. Since Oct 30, 2026, Cloudflare also [defers code updates](https://developers.cloudflare.com/changelog/post/2026-10-30-durable-objects-deferred-code-updates/) for active objects, which gives in-flight work up to five minutes before the new code takes over.

Three more classes do one job each: an AppHost per team app (its spec, versions and rows), a SharedLimit per limit every workspace shares (like a vendor's browsers at once, or model requests a minute), and one ChannelGateway that holds Discord's gateway socket.

## The computer sleeps after 10 idle minutes

The Space starts its own container through the Containers [`durable_object` scheduling policy](https://developers.cloudflare.com/containers/configuration/scheduling-policy/), in public beta since Sep 30, 2026, which lets a Durable Object choose the image and size each time it starts one. Ours is `standard-1`: half a vCPU, 4 GiB of memory and 8 GB of disk.

- It starts on the first command a chat runs.
- A command gets 120 s by default and 300 s at most, and a Space runs two commands at once.
- Ten minutes after the last command, the Space packs `/workspace` into one archive in R2 and stops the container.
- The next command starts it, unpacks the archive and runs. `/workspace` keeps up to 500 MB this way, and bigger files live in Files.

The previous version mounted an R2 bucket into the container over s3fs. s3fs isn't a real POSIX filesystem, local development used a different path than production, and we ended up writing a probe that touched a file because status checks said a stale mount was fine. Now the disk is an ordinary disk while the container runs, and we save it once when it stops.

Each command is a fresh bash process, but the chat's shell carries over. The old version started every command in a clean shell, and models trained on bash kept running `cd` in one call and expecting it in the next. The wrapper around each command now looks like this, simplified:

```bash
eval "$(printf %s "$SAVED_ENV" | base64 -d)"
cd -- "$SAVED_CWD" 2>/dev/null || cd /workspace
trap 'printf "\n%s %s %s\n" "$MARKER" "$(pwd | base64 -w0)" "$(export -p | base64 -w0)" >&2' EXIT
eval "$COMMAND"
```

The Space strips the marker line from stderr and keeps the directory and exports for that chat's next command. The whole thing runs under `timeout --kill-after=5`, so the deadline or a Stop ends everything the command started.

### What a computer costs

[Containers bill](https://developers.cloudflare.com/containers/platform/pricing/) every 10 ms an instance runs: memory and disk as provisioned, CPU only as used. For `standard-1`:

- Memory and disk: 4 GiB at $0.0000025 per GiB-second plus 8 GB at $0.00000007 per GB-second, about $0.038 an hour whatever the CPU does.
- CPU: up to half a vCPU at $0.00002 per vCPU-second, at most $0.036 an hour.
- The ten idle minutes after the last command cost about 0.6 cents. A sleeping computer costs nothing.

That's before the usage included with the Workers Paid plan. The idle tail is the price of not starting the container for every command, and [an idle instance is still billed](https://developers.cloudflare.com/sandbox/concepts/lifetime/) for memory and disk, so the timeout is a trade between start-up latency and money. Ten minutes is where we landed.

## Most work never wakes Linux

Plenty of agent work needs code but not a machine. The `exec` tool runs JavaScript in a fresh [Dynamic Worker](https://developers.cloudflare.com/agents/tools/filesystem/) with no network, against the chat's own files, which `@cloudflare/computer` keeps in the Chat's SQLite. It starts in milliseconds and needs no container.

The browser doesn't run on the computer either. Public pages open in Cloudflare's Browser Run through a binding, and sites that need a sign-in or turn automated browsers away open in Browser Use. The model drives both the same way, by writing Chrome DevTools Protocol code that runs in a Dynamic Worker, so which vendor is underneath never reaches the model. A browser closes after 90 s without a step, a workspace runs one at a time, and for a sign-in or a captcha the agent hands the browser to the person.

## What the computer can reach

The container holds no secrets. Sign-ins to connected apps stay with Composio, and mailbox passwords, MCP tokens and model keys are sealed in the Space, so none of them reach the computer. Every request it makes on ports 80 and 443 is intercepted and checked by a Worker against the workspace's setting:

| Setting                | What the computer reaches                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Off                    | Nothing                                                                                                                               |
| Packages (the default) | Package registries and code hosts, downloads only, so `pip`, `npm`, `cargo` and `git clone` work and an upload to any of them doesn't |
| Full                   | The whole web, minus hosts the workspace blocks                                                                                       |

Private addresses and other ports are refused in every mode. One case took some thought: Go's module proxy fetches whatever host a module's path names, which would carry a request to anyone's server, so the proxy is only asked for modules on hosts the computer could reach itself. Every refusal starts with "Construct:" and names the setting, because the program that hit it prints the message and the agent is the one reading it.

## Saved jobs run on Workflows

A saved workflow's run is one [Cloudflare Workflows](https://developers.cloudflare.com/workflows/) instance that walks the recipe it was started with. The recipe and inputs ride in the run's parameters, so editing a workflow never changes a run that has already started, and a deploy mid-run replays the same steps by name. Step names are fixed forever, because a step's name is its identity in the run's journal: a new version that inserts a step must never shift an old run's history. A run can take up to 25,000 steps, and a batch over a spreadsheet uses about seven a row.

## Memory without a vector database

Facts sit in the Space's SQLite with full-text indexes, and learning reads a chat 10 seconds after each reply.

Memory also taught us the most about prompt caching. Anything that rewrites the system prompt costs the cache, so a chat now gets a memory card of at most 1,000 tokens, frozen when the chat starts, and a later change arrives as a one-line note after it. In the previous version, 25% of turns read the cache on their first model call. Locally, the current one reads about 99.9% of each turn's prompt from cache, a new chat's first turn included (7,184 of 7,188 tokens).

## What the platform taught us

Each of these still holds for the current version.

**Timers don't survive eviction; alarms do.** A `setTimeout` is gone when the object is evicted. The Discord gateway object runs an alarm every minute that reconnects when heartbeats stop and wakes the object after a deploy.

**Outgoing WebSockets don't hibernate.** An object [hibernates only as a WebSocket server](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), and an open outbound socket keeps it in memory. Discord's messages only arrive over its gateway, so that one object is awake and billed all the time. It resumes its session after every restart instead of starting a new one, because Discord limits [how many sessions a bot may start](https://docs.discord.com/developers/events/gateway#session-start-limit-object) in a day.

**A stub that threw can stay broken.** Cloudflare's docs [say so](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/): many exceptions leave a stub failing every later call with the same error. Each chat keeps its Space's id in its own storage and makes a new stub after a failure, which also means an object woken by an alarm always knows who it belongs to.

**A fallback has to be on another provider, and it has to accept your tools.** A backup model on the same backend as the primary goes down with it. Some models refuse a tool schema that refers to itself, so a backup has to be tried against every tool's input, or a fallback turn loses its tools. A backup that reads only text also needs another model to describe images and PDFs for it.

**Where a call leaves from matters.** A Worker's outbound request leaves from the Cloudflare location running it, and some model providers refuse places they don't serve, Hong Kong among them: Anthropic answers 403 "Request not allowed" and Google says the location isn't supported. A call refused for its location has to go to a provider that serves it, and later calls can skip the refusing one for a while, so only the first one waits.

**A Worker can't open port 25 or 53.** To check that an email address's domain takes mail, we ask Cloudflare's DNS over HTTPS for its MX records. A lookup that takes over 1.5 s lets the address through rather than guess.

## What this design costs us

- A command stops at 300 s. Long builds and test suites belong in CI.
- Nothing runs between sleeps. A server started on the computer stops when it does.
- `/workspace` keeps 500 MB between sleeps.
- A sleeping computer has to start and unpack before its first command.
- We build on young software. The versions of the Agents SDK (0.31.0) and Think (0.22.0) we pin are pre-1.0, the `durable_object` scheduling policy is in beta, and Cloudflare [deprecated `@cloudflare/shell`](https://developers.cloudflare.com/changelog/post/2026-10-20-think-computer-workspace/) for `@cloudflare/computer` on Oct 20, 2026, a week before we started this version. We pin exact versions and read the docs before every upgrade.

## When a VM is the better choice

If the workload is one long-lived process per user that never idles, like a game server, a process that must hold a connection open, or a dev server people reach from outside, this design gives you nothing but constraints. The same goes for GPUs, commands that need more than five minutes, or a Windows or macOS desktop. Rent a VM.

## What we run

Workers with static assets, Durable Objects with SQLite storage, Containers, Workflows, D1, R2, KV, Queues, Workers AI, AI Gateway, Browser Run, Email Service and Email Routing, Analytics Engine, rate limiting, Turnstile, and Worker Loaders for Dynamic Workers. The site you're reading is a Worker too. The outside services we use, from models to payments, are on our [sub-processors page](https://construct.computer/sub-processors/?utm_source=ankush.one&utm_medium=referral&utm_campaign=crosspost).
