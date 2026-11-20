import { defineCollection, type SchemaContext } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * Every entry is a folder: src/content/<collection>/<slug>/index.md with its images beside it.
 * The folder name is the URL slug. A cover image doubles as list thumbnail and social preview.
 */
const bundle = (base: string) =>
  glob({
    base: `./src/content/${base}`,
    pattern: '**/index.md',
    generateId: ({ entry }) => entry.replace(/\/index\.md$/, ''),
  });

/** Fields every dated entry shares, so lists, feeds, SEO and the sitemap treat them the same way. */
const entry = ({ image }: SchemaContext) =>
  z.object({
    title: z.string(),
    description: z.string().max(200),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    cover: image().optional(),
    coverAlt: z.string().default(''),
    draft: z.boolean().default(false),
  });

const link = z.object({ label: z.string(), url: z.url() });

const blog = defineCollection({
  loader: bundle('blog'),
  schema: (ctx) => entry(ctx),
});

const projects = defineCollection({
  loader: bundle('projects'),
  schema: (ctx) =>
    entry(ctx).extend({
      featured: z.boolean().default(false),
      status: z.enum(['active', 'archived']).default('active'),
      stack: z.array(z.string()).default([]),
      links: z.array(link).default([]),
    }),
});

const timeline = defineCollection({
  loader: bundle('timeline'),
  schema: (ctx) =>
    entry(ctx).extend({
      /** Groups events on the timeline page, for example work, win, hackathon or speaking. */
      kind: z.string(),
      links: z.array(link).default([]),
    }),
});

const talks = defineCollection({
  loader: bundle('talks'),
  schema: (ctx) =>
    entry(ctx).extend({
      event: z.string(),
      location: z.string().optional(),
      video: z.url().optional(),
      slides: z.url().optional(),
    }),
});

const consoles = defineCollection({
  loader: bundle('consoles'),
  schema: (ctx) =>
    entry(ctx).extend({
      maker: z.string(),
      /** Year the console came out. `date` is when you got it. */
      released: z.number().int(),
      mods: z.array(z.string()).default([]),
    }),
});

/** Standalone pages and the intro text of each section index. One file per page, named by its route. */
const pages = defineCollection({
  loader: glob({ base: './src/content/pages', pattern: '*.md' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string().max(200),
      updated: z.coerce.date().optional(),
      cover: image().optional(),
    }),
});

export const collections = { blog, projects, timeline, talks, consoles, pages };
