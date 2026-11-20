# ankush.one

Personal site built with Astro and Tailwind. Static output, no client JavaScript.

```sh
pnpm dev      # http://localhost:4321
pnpm check    # type check content and templates
pnpm build    # static site in dist/
```

## Adding content

Every entry is a folder with an `index.md` and its images. The folder name is the URL.

| Section | Folder | URL |
| --- | --- | --- |
| Blog | `src/content/blog/<slug>/` | `/blogs/<slug>/` |
| Projects | `src/content/projects/<slug>/` | `/projects/<slug>/` |
| Timeline | `src/content/timeline/<slug>/` | `/timeline/<slug>/` |
| Talks | `src/content/talks/<slug>/` | `/talks/<slug>/` |
| Consoles | `src/content/consoles/<slug>/` | `/console-collection/<slug>/` |

Copy an existing entry to start a new one. All entries share `title`, `description`, `date`, `updated`, `tags`, `cover`, `coverAlt`, `canonical`, `links`, `faq`, `related` and `draft`; each section adds a few fields of its own, defined in `src/content.config.ts`. The build fails if a required field is missing.

`cover` is optional: when set, it is used for the list thumbnail, detail hero image, and social preview. When omitted, a theme-agnostic 1200x630 card is generated at build time via `src/lib/og.ts` (`/og/<section>/<slug>.png`) for list thumbnails and social previews (configurable via `OG_THEME` in `src/lib/og.ts`). `description` is the meta description, social card text, RSS summary and `llms.txt` line, so keep it to one clear sentence. `draft: true` shows the entry in dev only.

Standalone pages (About, Now, Privacy...) and the intro of every section index are Markdown files in `src/content/pages/`, named after the page. Resume data lives in `src/data/resume.ts` and also feeds the About page. Name, socials, nav, booking link and newsletter form target live in `src/site.ts`.

## Structure

```
src/
  site.ts               site identity, socials, nav, newsletter
  content.config.ts     content schemas
  content/              all writing and images
  data/resume.ts        experience, education, skills
  layouts/
    Base.astro          html shell, meta tags, Open Graph, JSON-LD
    Page.astro          page driven by src/content/pages/<id>.md
    Entry.astro         detail page for any entry
  components/           EntryList (thumbnail list), YearGroups
  lib/
    content.ts          queries, URLs, dates
    schema.ts           schema.org builders
  pages/                routes, plus sitemap.xml, robots.txt, llms.txt, blogs/index.xml
public/                 favicon, resume.pdf
```

## SEO, AEO and GEO

Every page gets a canonical URL, a meta description, Open Graph and Twitter tags with a 1200x630 image, and a JSON-LD graph that ties it to the `WebSite` and `Person` nodes: `BlogPosting` for posts, `CreativeWork` for projects, `Article` for timeline entries, `Event` for talks, `ProfilePage` for About, `ContactPage` for Contact, `CollectionPage` for indexes, and breadcrumbs everywhere. The sitemap picks up new pages automatically.
