import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Files the installed web app caches up front so it opens offline. Big media that the
// page doesn't need to start (the 8.5 MB menu track, README screenshots) stays network-only.
const PRECACHE_MAX_BYTES = 1_000_000;
const PRECACHE_SKIP = [/^showcase\//, /^nilavus-architecture\.png$/, /^sw\.js$/];

function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path, root) : [relative(root, path).replace(/\\/g, '/')];
  });
}

/** Writes the built file list (with content-hashed JS/CSS names) and a cache version into dist/sw.js. */
function precacheManifest(): Plugin {
  let outDir = 'dist';
  return {
    name: 'nilavus-precache-manifest',
    apply: 'build',
    configResolved(config) { outDir = config.build.outDir; },
    closeBundle() {
      const files = listFiles(outDir)
        .filter(file => !PRECACHE_SKIP.some(pattern => pattern.test(file)))
        .filter(file => statSync(join(outDir, file)).size <= PRECACHE_MAX_BYTES)
        .sort();
      const swPath = join(outDir, 'sw.js');
      const sw = readFileSync(swPath, 'utf8');
      // Version from names *and* contents (plus the worker itself), so any change refreshes the cache.
      const hash = createHash('sha256').update(sw);
      for (const file of files) hash.update(file).update(readFileSync(join(outDir, file)));
      const version = hash.digest('hex').slice(0, 12);
      if (!sw.includes('self.__PRECACHE__') || !sw.includes('__PRECACHE_VERSION__')) {
        throw new Error('public/sw.js is missing the precache placeholders');
      }
      writeFileSync(swPath, sw
        .replace('self.__PRECACHE__', JSON.stringify(['./', ...files.map(file => `./${file}`)]))
        .replace('__PRECACHE_VERSION__', version));
    },
  };
}

export default defineConfig({
  // Relative asset URLs: one identical build runs on all three NILAVUS sites
  // (GitHub Pages at /NILAVUS/, the Cloudflare Worker and Dosimeter at /).
  base: './',
  plugins: [react(), precacheManifest()],
});
