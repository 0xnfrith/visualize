import type { Editor, TLShapeId } from 'tldraw';
import {
  isContainerKind,
  type EdgeClass,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
} from '../../canvas/workflow.ts';
import { PRIMITIVES, type WfNodeProps } from './primitives.ts';
import { getConnectionBindings, type WfConnectionBinding, type WfConnectionShape } from './connection.tsx';
import type { WfNodeShape } from './wf-node-shape.tsx';

// ---- Pure snapshot → IR (no tldraw / DOM; unit-tested) --------------------

export interface SnapshotNode {
  id: string;
  props: WfNodeProps;
  /** Container the node sits inside (already de-prefixed); null = top level. */
  parentId: string | null;
}
export interface SnapshotEdge {
  id: string;
  edgeClass: EdgeClass;
  from: { nodeId: string; portId: string } | null;
  to: { nodeId: string; portId: string } | null;
}
export interface WfSnapshot {
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
}

/** Map a node's flat prop bag to the IR's per-kind sub-object (empties omitted). */
function kindProps(p: WfNodeProps): Partial<WorkflowNode> {
  switch (p.kind) {
    case 'agent': {
      const agent: NonNullable<WorkflowNode['agent']> = {};
      if (p.prompt) agent.prompt = p.prompt;
      if (p.model) agent.model = p.model;
      if (p.schema) agent.schema = p.schema;
      if (p.agentType) agent.agentType = p.agentType;
      return { agent };
    }
    case 'gate':
      return { gate: p.question ? { question: p.question } : {} };
    case 'branch':
      return { branch: { outLabels: p.cases.length ? [...p.cases] : ['a', 'b'] } };
    case 'terminal': {
      const terminal: NonNullable<WorkflowNode['terminal']> = {};
      if (p.role === 'start' || p.role === 'end') terminal.role = p.role;
      if (p.status) terminal.status = p.status;
      return { terminal };
    }
    case 'workflow': {
      const workflowRef: NonNullable<WorkflowNode['workflowRef']> = {};
      if (p.scriptPath) workflowRef.scriptPath = p.scriptPath;
      if (p.name) workflowRef.name = p.name;
      if (p.args) {
        try {
          workflowRef.args = JSON.parse(p.args) as Record<string, unknown>;
        } catch {
          // leave args unset on invalid JSON; Claude sees scriptPath/name only
        }
      }
      return { workflowRef };
    }
    default:
      return {};
  }
}

/** Resolve an edge's source port to a meaningful label (branch arms → case label). */
function portLabel(source: SnapshotNode | undefined, portId: string): string {
  if (source && source.props.kind === 'branch') {
    const m = /^out-(\d+)$/.exec(portId);
    if (m) {
      const cases = source.props.cases.length ? source.props.cases : ['a', 'b'];
      return cases[Number(m[1])] ?? portId;
    }
  }
  return portId;
}

export function serializeWorkflow(snap: WfSnapshot): WorkflowGraph {
  const nodeIds = new Set(snap.nodes.map(n => n.id));
  const byId = new Map(snap.nodes.map(n => [n.id, n]));

  const nodes: WorkflowNode[] = snap.nodes.map(n => ({
    id: n.id,
    kind: n.props.kind,
    label: n.props.label || PRIMITIVES[n.props.kind].label,
    // selection-scoped: drop a parent ref the serialized set doesn't contain.
    parentId: n.parentId && nodeIds.has(n.parentId) ? n.parentId : null,
    ...kindProps(n.props),
  }));

  const edges: WorkflowEdge[] = snap.edges
    .filter(e => e.from && e.to && nodeIds.has(e.from.nodeId) && nodeIds.has(e.to.nodeId))
    .map(e => {
      const from = e.from!;
      const to = e.to!;
      const fromPort = portLabel(byId.get(from.nodeId), from.portId);
      const edge: WorkflowEdge = {
        id: e.id,
        from: { node: from.nodeId, port: fromPort },
        to: { node: to.nodeId, port: to.portId },
        class: e.edgeClass,
      };
      return edge;
    });

  // Stable ordering for dedupe-by-key in the push loop and clean diffs.
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  edges.sort((a, b) =>
    a.from.node !== b.from.node
      ? a.from.node < b.from.node
        ? -1
        : 1
      : a.id < b.id
        ? -1
        : 1
  );

  return { version: 1, nodes, edges };
}

// ---- Editor → snapshot (selection-scoped; reads tldraw) -------------------

const deprefix = (id: TLShapeId): string => String(id).replace(/^shape:/, '');

/**
 * Build a snapshot of the operator's CURRENTLY-SELECTED workflow shapes.
 * Containment is geometric (a node sits in the smallest selected container whose
 * page-bounds contain its center) — deliberately NOT tldraw parenting, so it
 * works regardless of custom-shape re-parenting behavior. Connections are
 * included when BOTH endpoints are selected nodes (even if the edge itself isn't).
 */
export function selectedSnapshot(editor: Editor): WfSnapshot {
  const selected = editor.getSelectedShapes();
  const wfNodes = selected.filter(s => s.type === 'wf-node') as WfNodeShape[];
  const nodeIds = new Set(wfNodes.map(n => n.id));
  const containers = wfNodes.filter(n => isContainerKind(n.props.kind));

  const nodes: SnapshotNode[] = wfNodes.map(node => ({
    id: deprefix(node.id),
    props: node.props,
    parentId: geometricParent(editor, node, containers),
  }));

  // Gather every connection touching a selected node, then keep those whose
  // both endpoints are selected.
  const conns = new Map<TLShapeId, WfConnectionShape>();
  for (const node of wfNodes) {
    for (const b of editor.getBindingsToShape<WfConnectionBinding>(node, 'wf-connection')) {
      const conn = editor.getShape(b.fromId);
      if (conn && conn.type === 'wf-connection') conns.set(conn.id, conn as WfConnectionShape);
    }
  }

  const edges: SnapshotEdge[] = [];
  for (const conn of conns.values()) {
    const { start, end } = getConnectionBindings(editor, conn);
    if (!start || !end) continue;
    if (!nodeIds.has(start.toId) || !nodeIds.has(end.toId)) continue;
    edges.push({
      id: deprefix(conn.id),
      edgeClass: conn.props.edgeClass,
      from: { nodeId: deprefix(start.toId), portId: start.props.portId },
      to: { nodeId: deprefix(end.toId), portId: end.props.portId },
    });
  }

  return { nodes, edges };
}

function geometricParent(editor: Editor, node: WfNodeShape, containers: WfNodeShape[]): string | null {
  const nb = editor.getShapePageBounds(node);
  if (!nb) return null;
  const cx = nb.midX;
  const cy = nb.midY;
  let best: WfNodeShape | null = null;
  let bestArea = Infinity;
  for (const cont of containers) {
    if (cont.id === node.id) continue;
    const b = editor.getShapePageBounds(cont);
    if (!b) continue;
    if (cx >= b.minX && cx <= b.maxX && cy >= b.minY && cy <= b.maxY) {
      const area = b.width * b.height;
      if (area < bestArea) {
        bestArea = area;
        best = cont;
      }
    }
  }
  return best ? deprefix(best.id) : null;
}
