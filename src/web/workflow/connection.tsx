import {
  BindingUtil,
  Edge2d,
  Mat,
  ShapeUtil,
  T,
  Vec,
  createBindingId,
  type BindingOnShapeDeleteOptions,
  type BindingOnShapeIsolateOptions,
  type Editor,
  type RecordProps,
  type TLBaseBinding,
  type TLBaseShape,
  type TLShapeId,
  type VecModel,
} from 'tldraw';
import type { EdgeClass } from '../../canvas/workflow.ts';
import { getNodePorts, type WfNodeShape } from './wf-node-shape.tsx';

// ---- Connection shape -----------------------------------------------------

export type WfConnectionShape = TLBaseShape<
  'wf-connection',
  { start: VecModel; end: VecModel; edgeClass: EdgeClass }
>;

const vec = T.object({ x: T.number, y: T.number });

/** Visual encoding per edge class — dash pattern + color. */
const CLASS_STYLE: Record<EdgeClass, { dash: string | undefined; color: string }> = {
  control: { dash: undefined, color: 'var(--color-text, #111)' },
  data: { dash: '6 4', color: '#14b8a6' },
  propagate: { dash: '2 5', color: '#f59e0b' },
};

export class WfConnectionShapeUtil extends ShapeUtil<WfConnectionShape> {
  static override type = 'wf-connection' as const;
  static override props: RecordProps<WfConnectionShape> = {
    start: vec,
    end: vec,
    edgeClass: T.literalEnum('data', 'control', 'propagate'),
  };

  override getDefaultProps(): WfConnectionShape['props'] {
    return { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, edgeClass: 'control' };
  }

  override canBind() {
    return false; // connections are not themselves bind targets
  }
  override canResize() {
    return false;
  }
  override canSnap() {
    return false;
  }
  override hideRotateHandle() {
    return true;
  }
  override hideSelectionBoundsBg() {
    return true;
  }
  override hideSelectionBoundsFg() {
    return true;
  }

  override getGeometry(shape: WfConnectionShape) {
    const { start, end } = getConnectionTerminals(this.editor, shape);
    return new Edge2d({ start: Vec.From(start), end: Vec.From(end) });
  }

  override component(shape: WfConnectionShape) {
    const { start, end } = getConnectionTerminals(this.editor, shape);
    const style = CLASS_STYLE[shape.props.edgeClass];
    const head = arrowhead(start, end, 10, 0.45);
    return (
      <svg style={{ position: 'absolute', overflow: 'visible', pointerEvents: 'none' }} width={1} height={1}>
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke={style.color}
          strokeWidth={2}
          strokeDasharray={style.dash}
        />
        <polygon points={head} fill={style.color} />
      </svg>
    );
  }

  override indicator(shape: WfConnectionShape) {
    const { start, end } = getConnectionTerminals(this.editor, shape);
    return <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} />;
  }
}

/** End-cap arrowhead points (SVG polygon string), in local coords. */
function arrowhead(start: VecModel, end: VecModel, len: number, spread: number): string {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const p1 = { x: end.x - len * Math.cos(angle - spread), y: end.y - len * Math.sin(angle - spread) };
  const p2 = { x: end.x - len * Math.cos(angle + spread), y: end.y - len * Math.sin(angle + spread) };
  return `${end.x},${end.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`;
}

// ---- Connection binding ---------------------------------------------------

export type WfConnectionBinding = TLBaseBinding<
  'wf-connection',
  { portId: string; terminal: 'start' | 'end' }
>;

export class WfConnectionBindingUtil extends BindingUtil<WfConnectionBinding> {
  static override type = 'wf-connection' as const;
  static override props: RecordProps<WfConnectionBinding> = {
    portId: T.string,
    terminal: T.literalEnum('start', 'end'),
  };

  override getDefaultProps() {
    return { portId: '', terminal: 'start' as const };
  }

  // Deleting an endpoint node cascade-deletes the connection (no dangling edges).
  override onBeforeDeleteToShape({ binding }: BindingOnShapeDeleteOptions<WfConnectionBinding>): void {
    this.editor.deleteShapes([binding.fromId]);
  }
  // Duplicating a node without its connection → drop the half-bound connection.
  override onBeforeIsolateToShape({ binding }: BindingOnShapeIsolateOptions<WfConnectionBinding>): void {
    this.editor.deleteShapes([binding.fromId]);
  }
}

// ---- Helpers (binding ↔ geometry; shared by shape util + connect tool) -----

export function getConnectionBindings(
  editor: Editor,
  connection: WfConnectionShape | TLShapeId
): { start?: WfConnectionBinding; end?: WfConnectionBinding } {
  const all = editor.getBindingsFromShape<WfConnectionBinding>(connection, 'wf-connection');
  return {
    start: all.find(b => b.props.terminal === 'start'),
    end: all.find(b => b.props.terminal === 'end'),
  };
}

function bindingPortPagePosition(editor: Editor, binding: WfConnectionBinding): Vec | null {
  const target = editor.getShape(binding.toId);
  if (!target || target.type !== 'wf-node') return null;
  const port = getNodePorts(target as WfNodeShape).find(p => p.id === binding.props.portId);
  if (!port) return null;
  return editor.getShapePageTransform(target).applyToPoint({ x: port.x, y: port.y });
}

/** The two endpoints in the connection's LOCAL space; props are unbound fallback. */
export function getConnectionTerminals(
  editor: Editor,
  connection: WfConnectionShape
): { start: VecModel; end: VecModel } {
  const bindings = getConnectionBindings(editor, connection);
  const inv = Mat.Inverse(editor.getShapePageTransform(connection));
  let start: VecModel | undefined;
  let end: VecModel | undefined;
  if (bindings.start) {
    const pg = bindingPortPagePosition(editor, bindings.start);
    if (pg) start = Mat.applyToPoint(inv, pg);
  }
  if (bindings.end) {
    const pg = bindingPortPagePosition(editor, bindings.end);
    if (pg) end = Mat.applyToPoint(inv, pg);
  }
  return { start: start ?? connection.props.start, end: end ?? connection.props.end };
}

/** Create/replace a connection's binding for one terminal (at most one per terminal). */
export function createOrUpdateConnectionBinding(
  editor: Editor,
  connectionId: TLShapeId,
  nodeId: TLShapeId,
  props: { portId: string; terminal: 'start' | 'end' }
): void {
  const existing = editor
    .getBindingsFromShape<WfConnectionBinding>(connectionId, 'wf-connection')
    .filter(b => b.props.terminal === props.terminal);
  if (existing.length > 1) editor.deleteBindings(existing.slice(1));
  if (existing[0]) {
    editor.updateBinding<WfConnectionBinding>({ ...existing[0], toId: nodeId, props });
  } else {
    editor.createBinding<WfConnectionBinding>({
      id: createBindingId(),
      type: 'wf-connection',
      fromId: connectionId,
      toId: nodeId,
      props,
    });
  }
}
