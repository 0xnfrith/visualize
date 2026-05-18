import { describe, expect, it } from 'bun:test';
import { D2RewriteError, rewriteD2DarkMode } from './d2-css-rewrite.ts';

const wrap = (rules: string) =>
  `<svg><style>${rules}</style><rect class="a"/></svg>`;

describe('rewriteD2DarkMode', () => {
  it('hoists rules out of the @media block and prefixes selectors', () => {
    const input = wrap(
      `.d2-x{fill:#fff}@media screen and (prefers-color-scheme:dark){.d2-x{fill:#000}.d2-y,.d2-z{stroke:#111}}`
    );
    const output = rewriteD2DarkMode(input);
    expect(output).toContain('.tl-theme__dark .d2-x{fill:#000}');
    expect(output).toContain('.tl-theme__dark .d2-y, .tl-theme__dark .d2-z{stroke:#111}');
    expect(output).not.toContain('@media screen and (prefers-color-scheme:dark)');
    // Light palette outside the media block must be untouched.
    expect(output).toContain('.d2-x{fill:#fff}');
  });

  it('throws D2RewriteError when the @media block is missing', () => {
    const input = wrap('.d2-x{fill:#fff}');
    expect(() => rewriteD2DarkMode(input)).toThrow(D2RewriteError);
  });

  it('throws D2RewriteError on unbalanced braces inside the dark block', () => {
    const input = `<svg><style>@media screen and (prefers-color-scheme:dark){.d2-x{fill:#000</style></svg>`;
    expect(() => rewriteD2DarkMode(input)).toThrow(D2RewriteError);
  });

  it('throws D2RewriteError when an at-rule appears inside the dark block', () => {
    const input = wrap(
      `@media screen and (prefers-color-scheme:dark){@keyframes pulse{0%{opacity:0}100%{opacity:1}}}`
    );
    expect(() => rewriteD2DarkMode(input)).toThrow(D2RewriteError);
  });

  it('handles a single-rule dark block', () => {
    const input = wrap(`@media screen and (prefers-color-scheme:dark){.d2-x{fill:#000}}`);
    const output = rewriteD2DarkMode(input);
    expect(output).toContain('.tl-theme__dark .d2-x{fill:#000}');
  });
});
