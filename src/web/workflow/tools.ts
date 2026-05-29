import {
  BaseBoxShapeTool,
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

function makePlaceTool(kind: WorkflowNodeKind): TLStateNodeConstructor {
  return class extends BaseBoxShapeTool {
    static override id = `wf-place-${kind}`;
    override shapeType = 'wf-node';
    override onCreate(shape: WfNodeShape | null): void {
      if (!shape) return;
      const base = defaultNodeProps(kind);
      // Keep the drag-sized box; just stamp the kind + its defaults.
      this.editor.updateShape<WfNodeShape>({
        id: shape.id,
        type: 'wf-node',
        props: { ...base, kind, w: shape.props.w || base.w, h: shape.props.h || base.h },
      });
      if (PRIMITIVES[kind].group === 'container') this.editor.sendToBack([shape.id]);
      // Return to the select tool so the operator can immediately arrange/edit.
      this.editor.setCurrentTool('select');
    }
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
