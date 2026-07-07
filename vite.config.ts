import { defineConfig } from 'vite';

// Minimal config. Default base '/' works for Cloudflare Pages.
export default defineConfig({
  build: {
    target: 'es2022',
  },
});
