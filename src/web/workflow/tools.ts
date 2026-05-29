import {
  Mat,
  StateNode,
  createShapeId,
  type TLShapeId,
  type TLStateNodeConstructor,
} from 'tldraw';
import type { EdgeClass, WorkflowNodeKind } from '../../canvas/workflow.ts';
import { PRIMITIVES, defaultNodeProps } from './primitives.ts';
import { getPortAtPoint, type WfNodeShape } from './wf-node-shape.tsx';
import {
  createOrUpdateConnectionBinding,
  getConnectionBindings,
  type WfConnectionShape,
} from './connection.tsx';

export interface WfToolDef {
  id: string;
  label: string;
  kbd?: string;
  group: 'node' | 'container' | 'connection';
}

// ---- Placement tools (one per primitive) ----------------------------------

/** Below this drag extent (page px, either axis) a gesture counts as a click. */
const MIN_DRAG = 20;

/**
 * Custom placement tool — deliberately NOT `BaseBoxShapeTool`. Two reasons the
 * box tool was wrong here:
 *   1. its drag path creates a `{w:1,h:1}` shape, so a small drag stamped a
 *      1px node that collapsed to a dot; and
 *   2. its click path never runs `onCreate` and `getDefaultProps` can't know
 *      the kind, so a single click always produced an Agent.
 * This tool stamps the CORRECT kind at the primitive's default size on a click
 * (centered on the press), and sizes to the drag box on a deliberate drag.
 */
class WfPlaceToolBase extends StateNode {
  static override id = 'wf-place';
  kind: WorkflowNodeKind = 'agent';
  private shapeId: TLShapeId | null = null;

  override onPointerDown(): void {
    const p = this.editor.inputs.originPagePoint;
    const base = defaultNodeProps(this.kind);
    const id = createShapeId();
    this.shapeId = id;
    this.editor.markHistoryStoppingPoint();
    this.editor.createShape<WfNodeShape>({
      id,
      type: 'wf-node',
      x: p.x - base.w / 2,
      y: p.y - base.h / 2,
      props: base,
    });
  }

  override onPointerMove(): void {
    const id = this.shapeId;
    if (!id || !this.editor.inputs.isDragging) return;
    const { originPagePoint: o, currentPagePoint: c } = this.editor.inputs;
    const base = defaultNodeProps(this.kind);
    this.editor.updateShape<WfNodeShape>({
      id,
      type: 'wf-node',
      x: Math.min(o.x, c.x),
      y: Math.min(o.y, c.y),
      props: { ...base, w: Math.max(Math.abs(c.x - o.x), 1), h: Math.max(Math.abs(c.y - o.y), 1) },
    });
  }

  override onPointerUp(): void {
    const id = this.shapeId;
    if (!id) return;
    this.shapeId = null;
    const { originPagePoint: o, currentPagePoint: c } = this.editor.inputs;
    const base = defaultNodeProps(this.kind);
    // A click (or a too-small drag) → default size centered on the press point.
    if (Math.abs(c.x - o.x) < MIN_DRAG || Math.abs(c.y - o.y) < MIN_DRAG) {
      this.editor.updateShape<WfNodeShape>({
        id,
        type: 'wf-node',
        x: o.x - base.w / 2,
        y: o.y - base.h / 2,
        props: base,
      });
    }
    if (PRIMITIVES[this.kind].group === 'container') this.editor.sendToBack([id]);
    this.editor.setSelectedShapes([id]);
    this.editor.setCurrentTool('select');
  }

  override onCancel(): void {
    if (this.shapeId) {
      this.editor.deleteShapes([this.shapeId]);
      this.shapeId = null;
    }
    this.editor.setCurrentTool('select');
  }

  override onInterrupt(): void {
    this.onCancel();
  }
}

function makePlaceTool(kind: WorkflowNodeKind): TLStateNodeConstructor {
  return class extends WfPlaceToolBase {
    static override id = `wf-place-${kind}`;
    override kind = kind;
  } as unknown as TLStateNodeConstructor;
}

// ---- Connection tool (drag from an output port to an input port) ----------

class WfConnectToolBase extends StateNode {
  static override id = 'wf-connect';
  edgeClass: EdgeClass = 'control';
  private connectionId: TLShapeId | null = null;

  override onPointerDown(): void {
    const src = getPortAtPoint(this.editor, this.editor.inputs.currentPagePoint, 'start');
    if (!src) return; // must start on an OUTPUT port
    const pagePos = this.editor
      .getShapePageTransform(src.shape)
      .applyToPoint({ x: src.port.x, y: src.port.y });
    const id = createShapeId();
    this.connectionId = id;
    this.editor.markHistoryStoppingPoint();
    this.editor.createShape<WfConnectionShape>({
      id,
      type: 'wf-connection',
      x: pagePos.x,
      y: pagePos.y,
      props: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, edgeClass: this.edgeClass },
    });
    createOrUpdateConnectionBinding(this.editor, id, src.shape.id, { portId: src.port.id, terminal: 'start' });
    this.editor.sendToBack([id]);
  }

  override onPointerMove(): void {
    if (!this.connectionId) return;
    const conn = this.editor.getShape<WfConnectionShape>(this.connectionId);
    if (!conn) {
      this.connectionId = null;
      return;
    }
    const local = Mat.applyToPoint(
      Mat.Inverse(this.editor.getShapePageTransform(conn)),
      this.editor.inputs.currentPagePoint
    );
    this.editor.updateShape<WfConnectionShape>({
      id: this.connectionId,
      type: 'wf-connection',
      props: { end: { x: local.x, y: local.y } },
    });
  }

  override onPointerUp(): void {
    const id = this.connectionId;
    if (!id) return;
    this.connectionId = null;
    const dst = getPortAtPoint(this.editor, this.editor.inputs.currentPagePoint, 'end');
    const start = getConnectionBindings(this.editor, id).start;
    if (dst && !(start && dst.shape.id === start.toId)) {
      createOrUpdateConnectionBinding(this.editor, id, dst.shape.id, { portId: dst.port.id, terminal: 'end' });
    } else {
      this.editor.deleteShapes([id]); // dropped on empty canvas / same node → discard
    }
  }

  override onCancel(): void {
    if (this.connectionId) {
      this.editor.deleteShapes([this.connectionId]);
      this.connectionId = null;
    }
    this.editor.setCurrentTool('select');
  }
}

function makeConnectTool(edgeClass: EdgeClass): TLStateNodeConstructor {
  return class extends WfConnectToolBase {
    static override id = `wf-connect-${edgeClass}`;
    override edgeClass = edgeClass;
  } as unknown as TLStateNodeConstructor;
}

// ---- Registry of tools + their toolbar metadata ---------------------------

const PLACE_DEFS: WfToolDef[] = Object.values(PRIMITIVES).map(d => ({
  id: `wf-place-${d.kind}`,
  label: d.label,
  kbd: d.kbd,
  group: d.group,
}));

const CONNECT_DEFS: WfToolDef[] = [
  { id: 'wf-connect-control', label: 'Connect (control)', group: 'connection' },
  { id: 'wf-connect-data', label: 'Connect (data)', group: 'connection' },
  { id: 'wf-connect-propagate', label: 'Connect (propagate)', group: 'connection' },
];

export const WF_TOOL_DEFS: WfToolDef[] = [...PLACE_DEFS, ...CONNECT_DEFS];

export const WF_TOOLS: TLStateNodeConstructor[] = [
  ...Object.values(PRIMITIVES).map(d => makePlaceTool(d.kind)),
  makeConnectTool('control'),
  makeConnectTool('data'),
  makeConnectTool('propagate'),
];
