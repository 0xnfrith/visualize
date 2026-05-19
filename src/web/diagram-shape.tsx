import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type SvgExportContext,
  type TLBaseShape,
} from 'tldraw';

// Discriminated union for what we display in the shape. SVG content is
// inlined into the DOM so updates avoid a network round-trip for re-fetching
// the asset. Raster content stays behind a URL because base64-inlining it
// would balloon the WS messages. The agent picks colors at draw time based
// on the operator's current canvas theme — diagrams don't re-theme when the
// operator flips themes after drawing.
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
          // tags and `on*` handlers have been stripped.
          dangerouslySetInnerHTML={{ __html: content.text }}
        />
      </HTMLContainer>
    );
  }

  override indicator(shape: DiagramShape) {
    return <rect width={shape.props.w} height={shape.props.h} />;
  }

  override async toSvg(shape: DiagramShape, _ctx: SvgExportContext) {
    // The inlined SVG already carries its single, agent-chosen palette —
    // there's no light/dark variant to switch between at export time.
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
    const url = `data:image/svg+xml;utf8,${encodeURIComponent(content.text)}`;
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

