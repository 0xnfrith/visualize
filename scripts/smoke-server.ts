#!/usr/bin/env bun
// Standalone HTTP-only harness for browser smoke-testing the worktree's
// changes without colliding with the user's running MCP-driven server.
// Loads one D2 diagram and one raw SVG into a CanvasIndex, starts the
// server, prints the URL, and waits.

import { CanvasIndex } from '../src/canvas/index.ts';
import { startServer } from '../src/mcp/server.ts';
import { render } from '../src/renderers/registry.ts';

const D2_SOURCE = `
a: Light
b: Dark
c: Theme follows tldraw
a -> b: toggle
b -> c
`.trim();

async function main() {
  const canvas = new CanvasIndex();
  const handle = startServer(canvas);

  // 1) D2-rendered diagram (exercises the css-rewrite path).
  const d2 = await render({ kind: 'd2', source: D2_SOURCE });
  if (!d2.ok) {
    console.error('[smoke] d2 render failed:', d2.error);
    process.exit(1);
  }
  canvas.upsert(
    { id: 'd2-smoke', title: 'D2 smoke', spec: { kind: 'd2', source: D2_SOURCE } },
    d2.bytes,
    d2.mime,
    d2.size
  );

  // 2) Raw SVG (exercises the sanitizer path; <script> should be stripped).
  const svgWithScript =
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">` +
    `<rect width="200" height="100" fill="hsl(280 60% 50%)"/>` +
    `<text x="100" y="55" text-anchor="middle" fill="white" font-family="sans-serif">sanitized</text>` +
    `<script>console.error('[smoke] SCRIPT EXECUTED — sanitizer FAILED');</script>` +
    `</svg>`;
  const svg = await render({ kind: 'svg', source: svgWithScript });
  if (!svg.ok) {
    console.error('[smoke] svg render failed:', svg.error);
    process.exit(1);
  }
  canvas.upsert(
    { id: 'svg-smoke', title: 'SVG smoke', spec: { kind: 'svg', source: svgWithScript } },
    svg.bytes,
    svg.mime,
    svg.size
  );

  console.error(`[smoke] ready: ${handle.url}`);
  process.on('SIGINT', () => {
    handle.stop();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('[smoke] fatal:', err);
  process.exit(1);
});
