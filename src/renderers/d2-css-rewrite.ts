// Rewrite D2's dark-mode CSS so it activates from a tldraw ancestor class
// instead of the OS `prefers-color-scheme` media query.
//
// D2's `--dark-theme` paired output wraps the dark palette in:
//   @media screen and (prefers-color-scheme:dark){ <rules> }
// where each rule is `<selector>{<decls>}` with no nesting and no at-rules
// inside the block.
//
// We hoist those rules out and prefix every selector with `.tl-theme__dark `
// so they activate when tldraw's container has that class — letting tldraw's
// colorScheme preference drive the diagram palette directly.

const MEDIA_OPEN = '@media screen and (prefers-color-scheme:dark){';
const SCOPE_PREFIX = '.tl-theme__dark ';
const CONTEXT_CHARS = 400;

export class D2RewriteError extends Error {
  constructor(message: string, readonly context: string) {
    super(`${message}\n--- context ---\n${context.slice(0, CONTEXT_CHARS)}`);
    this.name = 'D2RewriteError';
  }
}

export function rewriteD2DarkMode(svg: string): string {
  const start = svg.indexOf(MEDIA_OPEN);
  if (start === -1) {
    throw new D2RewriteError(
      `D2 output missing expected dark-mode @media block. ` +
        `Did D2's CSS emission format change?`,
      // Prefer the <style> block as context; it's where the answer lives.
      // Fall back to the file head with a marker so the operator knows.
      sliceContextAroundStyle(svg)
    );
  }

  // Brace-match to find the @media block's closing `}`.
  const contentStart = start + MEDIA_OPEN.length;
  let depth = 1;
  let i = contentStart;
  while (i < svg.length && depth > 0) {
    const c = svg[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  if (depth !== 0) {
    throw new D2RewriteError(
      'Unbalanced braces inside D2 dark-mode @media block.',
      // Slice around the failure point, not the block start — the unbalanced
      // brace is at the tail.
      sliceContextAround(svg, i, CONTEXT_CHARS)
    );
  }
  const contentEnd = i - 1; // index of the matching `}`
  const inner = svg.slice(contentStart, contentEnd);

  const rewritten = prefixRules(inner);
  return svg.slice(0, start) + rewritten + svg.slice(contentEnd + 1);
}

// Walk the inner content of the @media block, splitting into rules and
// prefixing each rule's selector(s) with `.tl-theme__dark `.
//
// Rules look like `<selector>{<decls>}` and can be packed run-on with no
// separators. We track brace depth: when depth transitions 0 -> 1 we close
// the selector and open the body; when it transitions back to 0 we close
// the rule. Throws if D2 ever starts emitting at-rules (@font-face,
// @keyframes, @supports) inside the dark block — those can't be naively
// prefixed and the silent-wrong path is worse than loud failure.
function prefixRules(inner: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < inner.length) {
    // Skip leading whitespace between rules; preserve it in output.
    const wsStart = i;
    while (i < inner.length && /\s/.test(inner[i]!)) i++;
    if (i > wsStart) out.push(inner.slice(wsStart, i));
    if (i >= inner.length) break;

    // Read selector up to the next `{`.
    const selStart = i;
    while (i < inner.length && inner[i] !== '{') i++;
    if (i >= inner.length) {
      // Trailing content without a brace — malformed. Surface loudly so the
      // operator knows D2's emission shifted, rather than silently shipping
      // truncated CSS.
      throw new D2RewriteError(
        'Trailing content with no rule body inside D2 dark-mode block.',
        inner.slice(Math.max(0, selStart - 100), Math.min(inner.length, selStart + 300))
      );
    }
    const selector = inner.slice(selStart, i).trim();
    if (selector.startsWith('@')) {
      // At-rules (@font-face, @keyframes, @supports, ...) can't be naively
      // scoped by selector prefix. D2 v0.7.1 doesn't emit any, but if a
      // future release does, the rewrite would produce invalid CSS the
      // browser silently drops. Throw so the regression is loud.
      throw new D2RewriteError(
        `Cannot prefix at-rule inside D2 dark-mode block: ${selector}`,
        inner.slice(Math.max(0, selStart - 100), Math.min(inner.length, i + 300))
      );
    }

    // Read body up to the matching `}`. Bodies don't contain nested braces
    // in D2's output, but we count anyway for safety.
    const bodyStart = i; // points at the opening `{`
    let depth = 0;
    do {
      if (inner[i] === '{') depth++;
      else if (inner[i] === '}') depth--;
      i++;
    } while (i < inner.length && depth > 0);
    const body = inner.slice(bodyStart, i); // includes `{...}`

    out.push(prefixSelector(selector), body);
  }
  return out.join('');
}

function prefixSelector(selector: string): string {
  // Handle comma-separated selectors: each gets its own prefix.
  // D2's emitted selectors are simple class chains with no quoted strings
  // or attribute selectors, so naive split-on-comma is safe.
  return selector
    .split(',')
    .map(part => SCOPE_PREFIX + part.trim())
    .join(', ');
}

function sliceContextAround(s: string, pos: number, span: number): string {
  const half = Math.floor(span / 2);
  const lo = Math.max(0, pos - half);
  const hi = Math.min(s.length, pos + half);
  return s.slice(lo, hi);
}

function sliceContextAroundStyle(svg: string): string {
  const styleIdx = svg.indexOf('<style');
  if (styleIdx === -1) {
    return `(no <style> block found; file head)\n${svg.slice(0, 800)}`;
  }
  return svg.slice(styleIdx, Math.min(svg.length, styleIdx + 1200));
}
