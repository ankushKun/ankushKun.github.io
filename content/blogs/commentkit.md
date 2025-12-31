+++
# date = '2026-01-01'
date = '2025-12-30'
draft = false
title = "CommentKit: A Modern Embeddable Comment System"
description = "How I built CommentKit - an open-source, embeddable comment system powered by Cloudflare Workers, featuring magic link authentication, nested replies, and a simple two-line integration."
summary = "Discover how CommentKit provides a seamless commenting experience for any website with just two lines of code, powered by Cloudflare's edge infrastructure."
tags = ["cloudflare", "workers", "commentkit", "open-source", "edge-runtime", "D1"]
og_image = "/blogs/commentkit-og.jpg"
author = 'Ankush'
+++


I've written a handful of blogs now, and wanted to add a comment section. My first thought was to use Disqus — I'd seen it everywhere. But the free tier has ads, and the paid plans felt like overkill for a personal blog.

I looked at alternatives like Commento, Giscus, and Hyvor Talk, but none really fit what I wanted.

So I built my own: **CommentKit**.

<center>

{{< button "https://commentkit.ankush.one" "Try CommentKit" >}}
{{< github "ankushKun/commentkit" >}}

</center>


## The Two-Line Integration

After you create and verify a site on commentkits dashboard, this is all it takes to add comments to your website:

```html
<!-- Include the CommentKit bundle -->
<script src="https://commentkit.ankush.one/bundle.js"></script>

<!-- Add a div where you want comments -->
<div data-commentkit></div>
```

That's it. No complex configuration, no API keys in your frontend code, no build steps. The widget automatically:
- Detects the current page URL
- Creates a page entry if it doesn't exist
- Loads existing comments
- Handles user authentication
- Supports nested replies


## Architecture Overview

CommentKit has two main parts: the **embeddable widget** that runs on your website, and a **backend API** that handles storage and authentication.

```text
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────┐
│   Your Website  │◄───►│  Cloudflare Workers  │◄───►│ D1 Database │
│   (bundle.js)   │     │      (API Layer)     │     │  (SQLite)   │
└─────────────────┘     └──────────────────────┘     └─────────────┘
```


## The Embeddable Widget

When you add `<script src="https://commentkit.ankush.one/bundle.js">` to your page, here's what happens:

1. The script finds all `<div data-commentkit>` elements
2. It creates a hidden iframe pointing to the CommentKit domain
3. The iframe handles authentication and loads comments
4. Comments are rendered in place of the div on the host website

### Why an Iframe?

The tricky part is authentication. The widget runs on *your* website (`myblog.com`), but auth tokens need to be stored on the *CommentKit* domain. Cookies don't work cross-domain, so I use an iframe with `postMessage` instead.

```text
Your Website (bundle.js)
    │
    ├── Creates hidden iframe → commentkit.ankush.one/widget
    │
    ├── Sends messages via postMessage:
    │     { action: 'loadComments', domain: 'myblog.com', pageId: '/post' }
    │
    └── Receives responses:
          { action: 'commentsLoaded', data: [...] }
```

The iframe acts as a secure bridge. All API calls happen inside the iframe, so auth tokens stay in its localStorage — never exposed to the parent website.

### The Bundle

The `bundle.js` is a single js file containing all the vanilla code needed to talk to the iframe and render comments.

The final bundle is around 40KB, self-contained with no external dependencies at runtime.


## The Dashboard

Site owners get an admin panel to manage their comments. It includes:

- **Overview** — stats, recent activity, analytics charts
- **Sites** — manage multiple sites, view comments by page
- **Settings** — account settings and profile

The dashboard communicates with the backend through a typed API client.


## The Backend

The API runs on [Cloudflare Workers](https://workers.cloudflare.com/) using [Hono.js](https://hono.dev/) as the backend framework.

Data is stored in [Cloudflare D1](https://developers.cloudflare.com/d1/) — SQLite at the edge. The schema has tables for sites, pages, users, comments, reactions, and sessions.

Authentication uses SSO links via [Resend](https://resend.com/). When you log in:

1. You enter your email
2. Backend generates a secure token, stores it, and emails you a link
3. You click the link
4. Token is validated, session is created, you're in

No passwords to store, no passwords to leak


## The Dashboard

Site owners get access to a clean, functional dashboard:

- **Overview Tab**: Quick stats, recent activity, and analytics charts
- **Sites Tab**: Manage multiple sites, view comments by page, moderate content
- **Settings Tab**: Account settings, display name, and profile management

The dashboard is built with React and styled with a modern, minimal aesthetic using Tailwind CSS and Shadcn/ui components.


## Why Cloudflare Workers?

I chose Cloudflare Workers for several reasons:

1. **Global edge deployment**: Your API is served from the nearest datacenter to each user
2. **No cold starts**: Workers are always warm and respond in milliseconds
3. **D1 integration**: SQLite database with global replication, no separate database service needed
4. **Generous free tier**: 100,000 requests/day for free
5. **Simple deployment**: `wrangler deploy` and you're live


## Now What?

CommentKit is actively maintained and I'm planning several improvements:

- [ ] **Email notifications** when someone replies to your comment
- [ ] **Markdown support** in comments
- [ ] **Spam detection**
- [ ] **Theming** for customizing the widget appearance
- [ ] **Webhooks** for integrating with other services



## Contributing

CommentKit is open to contributions! Whether it's bug fixes, new features, or documentation improvements, check out the [CONTRIBUTING.md](https://github.com/ankushKun/commentkit/blob/main/CONTRIBUTING.md) for guidelines.



## Try It Out

The best way to understand CommentKit is to try it. Check out the [live demo](https://commentkit.ankush.one/example) or embed it on your own site. And if you find it useful, a star on [GitHub](https://github.com/ankushKun/commentkit) would be much appreciated!

PS. You can even see commentkit in action at the bottom of this page! Leave a message.