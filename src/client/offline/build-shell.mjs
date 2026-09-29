import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
// The static fallback contains no session or user data. It reuses the real form,
// IndexedDB and queue instead of caching an authenticated Next.js document.
await build({
  entryPoints: ['src/client/offline/entry.tsx'],
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  outfile: 'public/w2-offline-app.js',
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: '/* eslint-disable */' },
  logLevel: 'error',
});
const source = await readFile('src/app/globals.css', 'utf8');
const result = await postcss([tailwind()]).process(source, {
  from: 'src/app/globals.css',
  to: 'public/w2-offline-app.css',
});
await writeFile('public/w2-offline-app.css', result.css);

// Fingerprint the public shell so installing a new release refreshes its cache.
const version = createHash('sha256')
  .update(await readFile('public/w2-offline-app.js'))
  .update(result.css)
  .digest('hex')
  .slice(0, 12);
const worker = await readFile('public/sw.js', 'utf8');
await writeFile(
  'public/sw.js',
  worker.replace(/const CACHE = '[^']+';/, `const CACHE = 'vehicle-shell-w2-${version}';`),
);
