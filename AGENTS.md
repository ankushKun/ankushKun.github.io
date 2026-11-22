## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

## This project

Read `README.md` first. Conventions to keep:

- Content lives in `src/content/<collection>/<slug>/index.md` with images beside it. Routes come from `SECTION_PATH` in `src/lib/content.ts`; change a route there and in `src/pages` together.
- Query entries with `getEntries()` from `src/lib/content.ts`, never `getCollection()` directly, so drafts and sort order stay consistent.
- Every page renders through `Base.astro`, usually via `Page.astro` or `Entry.astro`. Pass schema.org nodes from `src/lib/schema.ts` instead of writing JSON-LD inline.
- Site identity and placeholder values live in `src/site.ts`. Do not hardcode names, emails or URLs in templates.
- Hard rule: Never use em dashes (U+2014) or en dashes (U+2013) anywhere in this repo (content, UI copy, metadata, comments, docs, or commit messages). Use standard ASCII hyphens (`-`), commas, colons, parentheses, or separate sentences instead.
- Run `pnpm check && pnpm build` before calling a change done.
