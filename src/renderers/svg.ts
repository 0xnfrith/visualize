import type { RenderSpec, Size } from '../canvas/types.ts';
import type { RenderResult } from './registry.ts';

const SVG_TAG = /<svg\b[^>]*>/i;
const VIEWBOX = /viewBox\s*=\s*"([^"]+)"/i;
const WIDTH = /\bwidth\s*=\s*"([^"]+)"/i;
const HEIGHT = /\bheight\s*=\s*"([^"]+)"/i;

export async function renderSvg(
  spec: Extract<RenderSpec, { kind: 'svg' }>
): Promise<RenderResult> {
  const match = SVG_TAG.exec(spec.source);
  if (!match) {
    return {
      ok: false,
      error: {
        kind: 'validation',
        renderer: 'svg',
        messages: [{ text: 'source does not contain an <svg> root element' }],
      },
    };
  }
  const dims = parseSvgDimensions(spec.source);
  return {
    ok: true,
    bytes: new TextEncoder().encode(spec.source),
    mime: 'image/svg+xml',
    size: dims ?? { width: 640, height: 420 },
  };
}

/** Pull intrinsic dimensions out of an SVG string. Used by both the
 *  passthrough renderer and the d2 renderer (since d2's output is SVG). */
export function parseSvgDimensions(svg: string): Size | null {
  const tagMatch = SVG_TAG.exec(svg);
  if (!tagMatch) return null;
  const tag = tagMatch[0];

  const w = numericAttr(tag, WIDTH);
  const h = numericAttr(tag, HEIGHT);
  if (w !== null && h !== null) return { width: w, height: h };

  const vb = VIEWBOX.exec(tag);
  if (vb) {
    const parts = vb[1]!.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(n => Number.isFinite(n))) {
      return { width: parts[2]!, height: parts[3]! };
    }
  }
  return null;
}

function numericAttr(tag: string, re: RegExp): number | null {
  const m = re.exec(tag);
  if (!m) return null;
  // Strip units (px, pt, etc.) — SVG values like "640px" are fine, treat as raw.
  const v = parseFloat(m[1]!);
  return Number.isFinite(v) ? v : null;
}
