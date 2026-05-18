import { describe, expect, it, spyOn } from 'bun:test';
import { injectRootClass } from './svg-utils.ts';

describe('injectRootClass', () => {
  it('adds the class to a bare <svg> tag', () => {
    const out = injectRootClass('<svg width="10" height="10"></svg>', 'tl-theme__dark');
    expect(out).toContain('<svg class="tl-theme__dark"');
    expect(out).toContain('width="10"');
  });

  it('appends to an existing class attribute', () => {
    const out = injectRootClass('<svg class="foo"></svg>', 'tl-theme__dark');
    expect(out).toContain('class="foo tl-theme__dark"');
  });

  it('handles an empty class attribute', () => {
    const out = injectRootClass('<svg class=""></svg>', 'tl-theme__dark');
    expect(out).toContain('class="tl-theme__dark"');
    // No leading space — `.trim()` should handle the join cleanly.
    expect(out).not.toContain('class=" ');
  });

  it('is idempotent when the class is already present', () => {
    const input = '<svg class="tl-theme__dark"></svg>';
    expect(injectRootClass(input, 'tl-theme__dark')).toBe(input);
  });

  it('handles single-quoted class attributes', () => {
    const out = injectRootClass("<svg class='foo'></svg>", 'tl-theme__dark');
    expect(out).toContain('class="foo tl-theme__dark"');
  });

  it('warns and returns input unchanged when there is no <svg> tag', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const input = '<div>not an svg</div>';
    expect(injectRootClass(input, 'tl-theme__dark')).toBe(input);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns and returns input unchanged when the <svg> tag is unterminated', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const input = '<svg class="foo"';
    expect(injectRootClass(input, 'tl-theme__dark')).toBe(input);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
