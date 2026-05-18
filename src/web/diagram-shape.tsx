import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type SvgExportContext,
  type TLBaseShape,
} from 'tldraw';
import { injectRootClass } from './svg-utils.ts';

// Discriminated union for what we display in the shape. SVG content is
// inlined into the DOM so tldraw's `.tl-theme__dark` ancestor class can
// scope to the diagram's CSS — that's how light/dark switching is free,
// and avoids a per-update network round-trip for re-fetching the asset.
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
      // `text: ''` is a deliberate "no payload yet" sentinel rendered as an
      // empty placeholder by `component`. Real content arrives via the WS
      // `diagram_upserted` message and triggers a re-render.
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
    // Empty-string sentinel: render a neutral placeholder rather than an
    // empty host (which would silently look like a broken render).
    if (content.text === '') {
      return (
        <HTMLContainer
          id={shape.id}
          style={{
            width: w,
            height: h,
            pointerEvents: 'all',
            display: 'grid',
            placeItems: 'center',
            opacity: 0.5,
            fontFamily: 'system-ui, sans-serif',
            fontSize: 12,
          }}
        >
          <span>diagram pending…</span>
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
          // SVG markup is sanitized at the WS boundary (see `sync.ts`
          // `sanitizeSvg`) — by the time it lands in shape props, `<script>`
          // tags and `on*` handlers have been stripped. The inlined SVG's own
          // `<style>` block carries `.tl-theme__dark`-prefixed rules that
          // light up when tldraw toggles the ancestor class.
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
    // exporting in dark mode. (Raster `image`-kind shapes are themed by the
    // renderer at draw time, not by tldraw at export, so no class needed.)
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

