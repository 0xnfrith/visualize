import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  Vec,
  type Editor,
  type RecordProps,
  type TLBaseShape,
  type VecLike,
} from 'tldraw';
import {
  PRIMITIVES,
  defaultNodeProps,
  type PortSpec,
  type PortTerminal,
  type WfNodeProps,
} from './primitives.ts';

export type WfNodeShape = TLBaseShape<'wf-node', WfNodeProps>;

/** Ports for a node — the single source for both the dots and the serializer. */
export function getNodePorts(shape: WfNodeShape): PortSpec[] {
  return PRIMITIVES[shape.props.kind].ports(shape.props);
}

/** World position of a port, for connection rendering + hit-testing. */
export function getPortPagePosition(editor: Editor, shape: WfNodeShape, port: PortSpec): Vec {
  return editor.getShapePageTransform(shape).applyToPoint({ x: port.x, y: port.y });
}

/** px tolerance around a port dot. The dot renders 10px wide centered ON the
 *  node edge, so half of it sits OUTSIDE the node's hit rectangle — a strict
 *  `hitInside` test misses it. This radius lets the operator grab the dot. */
const PORT_HIT_TOLERANCE = 18;

/** Nearest port (optionally of a given terminal) to a page point, or null. */
export function getPortAtPoint(
  editor: Editor,
  point: VecLike,
  terminal?: PortTerminal
): { shape: WfNodeShape; port: PortSpec } | null {
  let best: { shape: WfNodeShape; port: PortSpec } | null = null;
  let bestDist = Infinity;
  const consider = (shape: WfNodeShape) => {
    const ports = getNodePorts(shape).filter(p => !terminal || p.terminal === terminal);
    for (const port of ports) {
      const d = Vec.Dist(point, getPortPagePosition(editor, shape, port));
      if (d < bestDist) {
        bestDist = d;
        best = { shape, port };
      }
    }
  };

  // 1) Nearest matching port across all nodes, within tolerance — grabs the dot
  //    even where it overhangs the node edge.
  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type === 'wf-node') consider(shape as WfNodeShape);
  }
  if (best && bestDist <= PORT_HIT_TOLERANCE) return best;

  // 2) Otherwise fall back to the node under the point, so a connection can also
  //    start by clicking anywhere inside a node's body (its nearest matching port).
  const hit = editor.getShapeAtPoint(point, { hitInside: true, filter: s => s.type === 'wf-node' });
  if (hit) {
    best = null;
    bestDist = Infinity;
    consider(hit as WfNodeShape);
    return best;
  }
  return null;
}

export class WfNodeShapeUtil extends BaseBoxShapeUtil<WfNodeShape> {
  static override type = 'wf-node' as const;
  static override props: RecordProps<WfNodeShape> = {
    w: T.number,
    h: T.number,
    kind: T.literalEnum('agent', 'gate', 'branch', 'terminal', 'phase', 'parallel', 'pipeline', 'workflow'),
    label: T.string,
    prompt: T.string,
    model: T.string,
    schema: T.string,
    agentType: T.string,
    question: T.string,
    cases: T.arrayOf(T.string),
    role: T.string,
    status: T.string,
    scriptPath: T.string,
    name: T.string,
    args: T.string,
  };

  override getDefaultProps(): WfNodeProps {
    return defaultNodeProps('agent');
  }

  override canResize() {
    return true;
  }

  override canEdit() {
    return true;
  }

  override component(shape: WfNodeShape) {
    const { w, h, kind } = shape.props;
    const def = PRIMITIVES[kind];
    const isContainer = def.group === 'container';
    const isEditing = this.editor.getEditingShapeId() === shape.id;
    const ports = getNodePorts(shape);

    // Diamond visual for branch; rounded box otherwise. Containers render as a
    // translucent labeled band so child nodes drawn on top stay readable.
    const accent = def.accent;
    const secondaryText = secondaryLine(shape.props);

    return (
      <HTMLContainer
        id={shape.id}
        style={{
          width: w,
          height: h,
          // pointerEvents only while editing — otherwise the canvas-level
          // hit-test (select/drag/connect tools) owns the pointer.
          pointerEvents: isEditing ? 'all' : 'none',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: kind === 'branch' ? 0 : 10,
            clipPath: kind === 'branch' ? 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' : undefined,
            background: isContainer ? `${accent}1a` : 'var(--color-panel, #fff)',
            border: `2px solid ${accent}`,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              background: accent,
              color: '#fff',
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 8px',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              flex: '0 0 auto',
            }}
          >
            {def.label}
          </div>
          <div
            style={{
              flex: '1 1 auto',
              padding: 8,
              color: 'var(--color-text, #111)',
              fontSize: 13,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              minHeight: 0,
            }}
          >
            {isEditing ? (
              <textarea
                autoFocus
                defaultValue={editableText(shape.props)}
                onChange={e => this.editor.updateShape<WfNodeShape>({ id: shape.id, type: 'wf-node', props: applyEditableText(shape.props, e.target.value) })}
                onPointerDown={e => e.stopPropagation()}
                style={{
                  width: '100%',
                  height: '100%',
                  resize: 'none',
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  color: 'inherit',
                  font: 'inherit',
                }}
              />
            ) : (
              <>
                <div style={{ fontWeight: 600, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>
                  {shape.props.label || def.label}
                </div>
                {secondaryText && (
                  <div style={{ opacity: 0.7, fontSize: 11, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>
                    {secondaryText}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Port dots — purely visual; the connect tool hit-tests them by position. */}
        {ports.map(port => (
          <div
            key={port.id}
            title={`${port.terminal === 'start' ? 'output' : 'input'}: ${port.id}`}
            style={{
              position: 'absolute',
              left: port.x - 5,
              top: port.y - 5,
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: port.terminal === 'start' ? accent : 'var(--color-panel, #fff)',
              border: `2px solid ${accent}`,
              boxSizing: 'border-box',
              pointerEvents: 'none',
            }}
          />
        ))}
      </HTMLContainer>
    );
  }

  override indicator(shape: WfNodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={shape.props.kind === 'branch' ? 0 : 10} />;
  }
}

/** The secondary detail line shown under the label per kind. */
function secondaryLine(p: WfNodeProps): string {
  switch (p.kind) {
    case 'agent':
      return p.prompt || (p.model ? `model: ${p.model}` : '');
    case 'gate':
      return p.question ? `? ${p.question}` : 'needs_input';
    case 'branch':
      return (p.cases.length ? p.cases : ['a', 'b']).map(c => `→ ${c}`).join('  ');
    case 'terminal':
      return [p.role && `(${p.role})`, p.status && `status: ${p.status}`].filter(Boolean).join(' ');
    case 'workflow':
      return p.scriptPath || p.name || 'child workflow';
    default:
      return '';
  }
}

/** Which prop a double-click edits, per kind. */
function editableText(p: WfNodeProps): string {
  if (p.kind === 'agent') return p.prompt;
  if (p.kind === 'gate') return p.question;
  if (p.kind === 'workflow') return p.scriptPath;
  return p.label;
}

function applyEditableText(p: WfNodeProps, value: string): Partial<WfNodeProps> {
  if (p.kind === 'agent') return { prompt: value };
  if (p.kind === 'gate') return { question: value };
  if (p.kind === 'workflow') return { scriptPath: value };
  return { label: value };
}
