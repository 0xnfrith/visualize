// Rewrite D2's dark-mode CSS so it activates from a tldraw ancestor class
// instead of the OS `prefers-color-scheme` media query.
//
// D2's `--dark-theme` paired output wraps the dark palette in:
//   @media screen and (prefers-color-scheme:dark){ <rules> }
// where each rule is `<selector>{<decls>}` with no nesting.
//
// We hoist those rules out and prefix every selector with `.tl-theme__dark `
// so they activate when tldraw's container has that class — letting tldraw's
// colorScheme preference drive the diagram palette directly.

const MEDIA_OPEN = '@media screen and (prefers-color-scheme:dark){';
const SCOPE_PREFIX = '.tl-theme__dark ';

export class D2RewriteError extends Error {
  constructor(message: string, readonly context: string) {
    super(`${message}\n--- context ---\n${context.slice(0, 400)}`);
    this.name = 'D2RewriteError';
  }
}

export function rewriteD2DarkMode(svg: string): string {
  const start = svg.indexOf(MEDIA_OPEN);
  if (start === -1) {
    throw new D2RewriteError(
      `D2 output missing expected dark-mode @media block. ` +
        `Did D2's CSS emission format change?`,
      svg.slice(svg.indexOf('<style') > -1 ? svg.indexOf('<style') : 0, 800)
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
      svg.slice(start, Math.min(start + 400, svg.length))
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
// the rule.
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
      // Trailing garbage; emit as-is to avoid silent loss.
      out.push(inner.slice(selStart));
      break;
    }
    const selector = inner.slice(selStart, i).trim();

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
