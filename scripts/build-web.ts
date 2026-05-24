#!/usr/bin/env bun
import { rm, mkdir, cp } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = join(ROOT, 'src', 'web');
const OUT = join(ROOT, 'dist', 'web');

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(SRC, 'main.tsx')],
  outdir: OUT,
  target: 'browser',
  format: 'esm',
  minify: false,
  splitting: false,
  sourcemap: 'linked',
  // Content-hash the bundle filename so browsers never serve a stale main.js
  // after a rebuild + plugin reload. Without this, `/main.js` is byte-cached
  // forever and operators have to hard-refresh to see new code.
  naming: {
    entry: '[name]-[hash].[ext]',
    asset: '[name]-[hash].[ext]',
    chunk: '[name]-[hash].[ext]',
  },
});

if (!result.success) {
  console.error('[build:web] failed:');
  for (const m of result.logs) console.error(m);
  process.exit(1);
}

// Rewrite the HTML to point at the built bundle. Filenames now include a
// content hash, so the find logic matches by extension + entry kind instead
// of literal filename.
const entryOutput = result.outputs.find(
  o => o.kind === 'entry-point' && o.path.endsWith('.js')
);
const cssOutput = result.outputs.find(o => o.path.endsWith('.css'));

const pkg = (await Bun.file(join(ROOT, 'package.json')).json()) as { version: string };

const html = await Bun.file(join(SRC, 'index.html')).text();
const entryName = entryOutput ? entryOutput.path.split('/').pop() : 'main.js';
let rewritten = html.replace('./main.tsx', `/${entryName}`);
if (cssOutput) {
  const cssName = cssOutput.path.split('/').pop();
  rewritten = rewritten.replace(
    '</head>',
    `    <link rel="stylesheet" href="/${cssName}" />\n  </head>`
  );
}
const badge = `<div id="visualize-version-badge" style="position:fixed;top:8px;right:8px;z-index:9999;padding:4px 8px;background:rgba(15,23,42,0.85);color:#e2e8f0;font:12px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;border:1px solid #334155;border-radius:4px;pointer-events:none;">v${pkg.version}</div>`;
rewritten = rewritten.replace('<div id="root"></div>', `<div id="root"></div>\n    ${badge}`);
await Bun.write(join(OUT, 'index.html'), rewritten);

console.log(`[build:web] built ${result.outputs.length} files → ${OUT}`);
