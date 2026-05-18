import type { RenderSpec, Size } from '../canvas/types.ts';
import type { RenderResult, ValidationError } from './registry.ts';
import { D2RewriteError, rewriteD2DarkMode } from './d2-css-rewrite.ts';
import { parseSvgDimensions } from './svg.ts';

const D2_ERR_LINE = /^err:\s*(?:\S+:\s*)?(\d+):(\d+):\s*(.+)$/;

// Theme IDs paired so D2 emits both palettes in one SVG; the dark palette
// lands inside `@media (prefers-color-scheme:dark)` which we rewrite at
// ingest to fire from tldraw's `.tl-theme__dark` class instead.
const D2_LIGHT_THEME = '0';
const D2_DARK_THEME = '200';

export async function renderD2(
  spec: Extract<RenderSpec, { kind: 'd2' }>
): Promise<RenderResult> {
  const args = [
    '--stdout-format', 'svg',
    '--theme', D2_LIGHT_THEME,
    '--dark-theme', D2_DARK_THEME,
  ];
  if (spec.layout) args.push('--layout', spec.layout);
  args.push('-', '-');

  let proc;
  try {
    proc = Bun.spawn({
      cmd: ['d2', ...args],
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (err) {
    return internalError(`failed to spawn d2: ${(err as Error).message}`);
  }

  // Write source and close stdin so d2 sees EOF and starts compiling.
  // With stdin:'pipe' the FileSink is always available; the typed union
  // also includes raw fds for other config paths, which don't apply here.
  // Wrap to surface a broken pipe as structured `internalError` rather than
  // an unhandled rejection (happens if d2 crashes mid-write).
  try {
    const stdin = proc.stdin as unknown as {
      write: (data: string) => unknown;
      end: () => Promise<unknown>;
    };
    stdin.write(spec.source);
    await stdin.end();
  } catch (err) {
    return internalError(`d2 stdin pipe failed: ${(err as Error).message}`);
  }

  // Drain both streams as whole-buffer reads — line-by-line draining
  // deadlocks on backpressure when d2 produces a large SVG.
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    return { ok: false, error: parseD2Errors(stderr) };
  }

  let rewritten: string;
  try {
    rewritten = rewriteD2DarkMode(stdout);
  } catch (err) {
    if (err instanceof D2RewriteError) {
      return internalError(err.message);
    }
    throw err;
  }

  const dims = parseSvgDimensions(rewritten);
  if (dims === null) {
    // SVG had no parseable width/height — every diagram silently snaps to
    // FALLBACK_SIZE. Surface so the operator knows why dimensions look off.
    console.warn(
      '[visualize] d2 output had no parseable dimensions; using fallback size'
    );
  }
  return {
    ok: true,
    bytes: new TextEncoder().encode(rewritten),
    mime: 'image/svg+xml',
    size: dims ?? FALLBACK_SIZE,
  };
}

function parseD2Errors(stderr: string): ValidationError {
  const messages: ValidationError['messages'] = [];
  for (const raw of stderr.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = D2_ERR_LINE.exec(line);
    if (m) {
      messages.push({
        line: Number(m[1]),
        column: Number(m[2]),
        text: m[3]!,
      });
    } else if (line.startsWith('err:')) {
      messages.push({ text: line.slice(4).trim() });
    }
  }
  if (messages.length === 0) messages.push({ text: stderr.trim() || 'd2 compile failed' });
  return { kind: 'validation', renderer: 'd2', messages };
}

function internalError(text: string): RenderResult {
  return {
    ok: false,
    error: { kind: 'internal', renderer: 'd2', messages: [{ text }] },
  };
}

const FALLBACK_SIZE: Size = { width: 640, height: 420 };
