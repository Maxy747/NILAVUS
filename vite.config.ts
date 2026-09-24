import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset URLs: one identical build runs on all three NILAVUS sites
  // (GitHub Pages at /NILAVUS/, the Cloudflare Worker and Dosimeter at /).
  base: './',
  plugins: [react()],
});
