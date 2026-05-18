import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type SvgExportContext,
  type TLBaseShape,
} from 'tldraw';

// Discriminated union for what we display in the shape. SVG content is
// inlined into the DOM so tldraw's `.tl-theme__dark` ancestor class can
// scope to the diagram's CSS — that's how light/dark switching is free.
// Raster content stays behind a URL because base64-inlining it would
// balloon the WS messages.
export type DiagramContent =
  | { kind: 'svg'; text: string }
  | { kind: 'image'; url: string };

export type DiagramShape = TLBaseShape<
  'diagram',
  {
    w: number;
    h: number;
    version: number;
    content: DiagramContent;
  }
>;

export class DiagramShapeUtil extends BaseBoxShapeUtil<DiagramShape> {
  static override type = 'diagram' as const;

  override isAspectRatioLocked(): boolean {
    return true;
  }

  override canResize(): boolean {
    return true;
  }

  override getDefaultProps(): DiagramShape['props'] {
    return {
      w: 320,
      h: 240,
      version: 0,
      content: { kind: 'svg', text: '' },
    };
  }

  override component(shape: DiagramShape) {
    const { w, h, content } = shape.props;
    if (content.kind === 'image') {
      return (
        <HTMLContainer
          id={shape.id}
          style={{ width: w, height: h, pointerEvents: 'all' }}
        >
          <img
            src={content.url}
            alt=""
            draggable={false}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
        </HTMLContainer>
      );
    }
    return (
      <HTMLContainer
        id={shape.id}
        style={{ width: w, height: h, pointerEvents: 'all' }}
      >
        <div
          className="visualize-svg-host"
          // The inlined SVG carries its own <style> block whose `.tl-theme__dark`
          // -prefixed rules light up when tldraw toggles the ancestor class.
          dangerouslySetInnerHTML={{ __html: content.text }}
        />
      </HTMLContainer>
    );
  }

  override indicator(shape: DiagramShape) {
    return <rect width={shape.props.w} height={shape.props.h} />;
  }

  override async toSvg(shape: DiagramShape, ctx: SvgExportContext) {
    // For canvas export, we want the diagram to appear with the palette
    // that matches the *exported* color scheme — which tldraw tells us via
    // `ctx.isDarkMode`. The CSS rules inside the diagram fire from a
    // `.tl-theme__dark` ancestor; in a standalone exported SVG there's no
    // such ancestor, so we add it to the root <svg> element itself when
    // exporting in dark mode.
    const { w, h, content } = shape.props;
    if (content.kind === 'image') {
      return (
        <image
          href={content.url}
          width={w}
          height={h}
          preserveAspectRatio="xMidYMid meet"
        />
      );
    }
    const themed = ctx.isDarkMode
      ? injectRootClass(content.text, 'tl-theme__dark')
      : content.text;
    const url = `data:image/svg+xml;utf8,${encodeURIComponent(themed)}`;
    return (
      <image
        href={url}
        width={w}
        height={h}
        preserveAspectRatio="xMidYMid meet"
      />
    );
  }
}

// Add a class to the root <svg> element. Used only for export — at canvas
// runtime, the class lives on tldraw's container instead and cascades down.
function injectRootClass(svgText: string, cls: string): string {
  const open = svgText.indexOf('<svg');
  if (open === -1) return svgText;
  const closeAngle = svgText.indexOf('>', open);
  if (closeAngle === -1) return svgText;
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
