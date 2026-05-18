import type { PublicPayload } from '../mcp/protocol.ts';

export type DiagramContent =
  | { kind: 'svg'; text: string }
  | { kind: 'image'; url: string };

export type Sanitizer = (svgText: string) => string;

/**
 * Validates the discriminator at the WS boundary — TS only narrows at
 * compile time, the parsed JSON is `unknown` at runtime. Throws if the
 * payload violates the protocol contract.
 *
 * Runs the SVG text through `sanitize` for defense-in-depth; tests can
 * pass identity to focus on the discriminator logic.
 */
export function payloadToContent(
  payload: PublicPayload,
  entryId: string,
  sanitize: Sanitizer
): DiagramContent {
  switch (payload.kind) {
    case 'svg':
      if (typeof payload.svgText !== 'string') {
        throw new Error(
          `[visualize] entry ${entryId}: payload.kind='svg' but svgText is ${typeof payload.svgText}`
        );
      }
      return { kind: 'svg', text: sanitize(payload.svgText) };
    case 'image':
      if (typeof payload.assetUrl !== 'string' || payload.assetUrl === '') {
        throw new Error(
          `[visualize] entry ${entryId}: payload.kind='image' but assetUrl is missing or empty`
        );
      }
      return { kind: 'image', url: payload.assetUrl };
  }
}
