// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://ankush.one',
  trailingSlash: 'always',
  redirects: {
    '/schedule/': '/contact/',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
