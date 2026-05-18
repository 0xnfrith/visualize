/**
 * Add a class to the root `<svg>` element. Used only for export — at canvas
 * runtime the class lives on tldraw's container instead and cascades down.
 *
 * Returns the SVG unmodified (with a console.warn) when the markup is too
 * malformed to find the root tag. Silent return here would mean dark
 * exports silently ship the light palette.
 */
export function injectRootClass(svgText: string, cls: string): string {
  const open = svgText.indexOf('<svg');
  if (open === -1) {
    console.warn(
      '[visualize] injectRootClass: no <svg> tag found; export palette may be wrong'
    );
    return svgText;
  }
  const closeAngle = svgText.indexOf('>', open);
  if (closeAngle === -1) {
    console.warn(
      '[visualize] injectRootClass: unterminated <svg> tag; export palette may be wrong'
    );
    return svgText;
  }
  const opening = svgText.slice(open, closeAngle);
  const classMatch = /\sclass=("([^"]*)"|'([^']*)')/i.exec(opening);
  if (classMatch) {
    const existing = classMatch[2] ?? classMatch[3] ?? '';
    const combined = existing.includes(cls) ? existing : `${existing} ${cls}`.trim();
    const replaced = opening.replace(classMatch[0], ` class="${combined}"`);
    return svgText.slice(0, open) + replaced + svgText.slice(closeAngle);
  }
  return svgText.slice(0, open + 4) + ` class="${cls}"` + svgText.slice(open + 4);
}
