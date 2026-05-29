/**
 * The WorkflowGraph IR — the contract between the operator's hand-drawn canvas
 * and the Claude Code Workflow tool.
 *
 * The operator draws shapes that map to Workflow-tool primitives; the browser
 * serializes the *selected* shapes into a `WorkflowGraph` and pushes it to the
 * server; Claude reads it (via the `get_workflow` tool or the
 * `visualize://workflow` MCP resource) and authors a `.workflow.js` from it.
 *
 * This module is deliberately PURE — no tldraw imports, no I/O — so it can be
 * shared by the browser (serialize side) and the server (read + hint side) and
 * unit-tested without a DOM. The client sends only `{ version, nodes, edges }`;
 * the server computes `hints` on read via `computeHints`.
 *
 * Primitive semantics are grounded in the operator's empirical findings on the
 * Workflow tool (workflow-composition-mechanics): `workflow()` is inlined;
 * `needs_input` is a return-value convention that every `workflow()` boundary on
 * the path must explicitly propagate; loop-back is best modeled as a
 * dispatcher-loop. The hints below surface the graph-shaped facts Claude needs
 * to get that discipline right.
 */

// ---- Node kinds -----------------------------------------------------------

/** Leaf primitives (point nodes) + container primitives (grouping nodes). */
export type WorkflowNodeKind =
  | 'agent'
  | 'gate'
  | 'branch'
  | 'terminal'
  | 'phase'
  | 'parallel'
  | 'pipeline'
  | 'workflow';

/** Kinds that hold other nodes via `parentId`. */
export type ContainerKind = 'phase' | 'parallel' | 'pipeline' | 'workflow';

const CONTAINER_KINDS: ReadonlySet<WorkflowNodeKind> = new Set<WorkflowNodeKind>([
  'phase',
  'parallel',
  'pipeline',
  'workflow',
]);

export function isContainerKind(kind: WorkflowNodeKind): kind is ContainerKind {
  return CONTAINER_KINDS.has(kind);
}

// ---- Per-kind props (all optional so a sparse hand-drawing still validates) -

export interface AgentNodeProps {
  prompt?: string;
  /** Operator annotation; Claude maps to opus/sonnet/haiku or `inherit`. */
  model?: string;
  /** Raw schema text the operator wrote, if any; Claude interprets it. */
  schema?: string;
  agentType?: string;
}
export interface GateNodeProps {
  /** The needs_input prompt the gate asks the operator. */
  question?: string;
}
export interface BranchNodeProps {
  /** Labels of the outgoing control arms; each maps to an `out-i` port. */
  outLabels: string[];
}
export interface TerminalNodeProps {
  role?: 'start' | 'end';
  /** e.g. 'approved' | 'rejected' | 'done' — the status a terminal returns. */
  status?: string;
}
export interface WorkflowRefProps {
  scriptPath?: string;
  name?: string;
  args?: Record<string, unknown>;
}

// ---- Graph ----------------------------------------------------------------

export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  label: string;
  /** Containment; null = top level (or parent not in the selection). */
  parentId: string | null;
  agent?: AgentNodeProps;
  gate?: GateNodeProps;
  branch?: BranchNodeProps;
  terminal?: TerminalNodeProps;
  workflowRef?: WorkflowRefProps;
}

export type EdgeClass = 'data' | 'control' | 'propagate';

export interface WorkflowPort {
  node: string;
  /** Named arm (e.g. a branch label / 'out-0' / 'in'); omitted for default. */
  port?: string;
}

export interface WorkflowEdge {
  id: string;
  from: WorkflowPort;
  to: WorkflowPort;
  class: EdgeClass;
  label?: string;
}

/** One gate that sits inside ≥1 `workflow()` boundary. */
export interface PropagationPath {
  gateId: string;
  /**
   * The `workflow`-kind container ancestors of the gate, OUTERMOST first.
   * Each is a `workflow()` call boundary at which the generated parent MUST
   * propagate: `const c = await workflow(...); if (c?.status==='needs_input') return c`.
   * Only `workflow` containers appear — phase/parallel/pipeline are inline
   * constructs in the same script and create no return-value boundary.
   */
  boundaryChain: string[];
}

export interface WorkflowHints {
  /** Nodes with no incoming control/data edge — execution roots. */
  entryNodes: string[];
  /** A valid topological order over control+data edges, ignoring loop-backs. */
  topoOrder: string[] | null;
  /** Control/data edge ids that point back to an ancestor (a loop). */
  loopBackEdges: string[];
  /** One entry per gate nested inside a `workflow()` boundary. */
  propagationPaths: PropagationPath[];
  /** Nodes the operator drew but left completely unwired. */
  danglingNodes: string[];
  /** Nodes whose `parentId` points at a missing or non-container node. */
  unknownContainerChildren: string[];
}

export interface WorkflowGraph {
  version: 1;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** Absent on the wire (client omits); filled by the server on read. */
  hints?: WorkflowHints;
}

/** A connected (control + data) edge — propagate edges are return-bubbles, not flow. */
function isFlowEdge(e: WorkflowEdge): boolean {
  return e.class === 'control' || e.class === 'data';
}

// ---- Hint derivation (pure) ----------------------------------------------

/**
 * Execution roots = nodes with no incoming control/data edge. Loop-back edges
 * are excluded so a "rejected → re-classify" loop doesn't hide the true entry
 * (whose only incoming edge is the back-edge).
 */
export function findEntryNodes(graph: WorkflowGraph): string[] {
  const ids = new Set(graph.nodes.map(n => n.id));
  const loopBack = new Set(findLoopBackEdges(graph));
  const hasIncoming = new Set<string>();
  for (const e of graph.edges) {
    if (isFlowEdge(e) && !loopBack.has(e.id) && ids.has(e.to.node)) {
      hasIncoming.add(e.to.node);
    }
  }
  return graph.nodes
    .map(n => n.id)
    .filter(id => !hasIncoming.has(id))
    .sort();
}

/**
 * DFS over control+data edges. Classifies back-edges (an edge to a node still
 * on the recursion stack = a loop) and produces a topological order of the
 * remaining DAG (reverse finish order). Node iteration is sorted for a stable
 * result. Returns both so `computeHints` can derive `loopBackEdges` + `topoOrder`
 * from one traversal.
 */
function dfsClassify(graph: WorkflowGraph): {
  loopBackEdges: string[];
  topoOrder: string[];
} {
  const ids = new Set(graph.nodes.map(n => n.id));
  // adjacency: node -> outgoing flow edges, sorted for determinism
  const adj = new Map<string, WorkflowEdge[]>();
  for (const id of ids) adj.set(id, []);
  for (const e of graph.edges) {
    if (isFlowEdge(e) && ids.has(e.from.node) && ids.has(e.to.node)) {
      adj.get(e.from.node)!.push(e);
    }
  }
  for (const list of adj.values()) {
    list.sort((a, b) => (a.to.node < b.to.node ? -1 : a.to.node > b.to.node ? 1 : a.id < b.id ? -1 : 1));
  }

  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const id of ids) color.set(id, WHITE);
  const loopBack = new Set<string>();
  const finished: string[] = [];

  const visit = (u: string): void => {
    color.set(u, GRAY);
    for (const e of adj.get(u)!) {
      const c = color.get(e.to.node);
      if (c === GRAY) loopBack.add(e.id); // back-edge → loop
      else if (c === WHITE) visit(e.to.node);
    }
    color.set(u, BLACK);
    finished.push(u);
  };

  for (const id of [...ids].sort()) {
    if (color.get(id) === WHITE) visit(id);
  }

  return {
    loopBackEdges: [...loopBack].sort(),
    topoOrder: finished.reverse(),
  };
}

export function findLoopBackEdges(graph: WorkflowGraph): string[] {
  return dfsClassify(graph).loopBackEdges;
}

export function topoSort(graph: WorkflowGraph): string[] | null {
  return dfsClassify(graph).topoOrder;
}

/**
 * For each `gate`, walk up `parentId` collecting `workflow`-kind ancestors —
 * the `workflow()` call boundaries that must propagate needs_input. Gates with
 * no `workflow` ancestor return needs_input directly (the dispatcher reads it)
 * and produce no path.
 */
export function computePropagationPaths(graph: WorkflowGraph): PropagationPath[] {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const paths: PropagationPath[] = [];
  for (const node of graph.nodes) {
    if (node.kind !== 'gate') continue;
    const chain: string[] = [];
    const seen = new Set<string>([node.id]); // guard against parentId cycles
    let cur = node.parentId;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const parent = byId.get(cur);
      if (!parent) break;
      if (parent.kind === 'workflow') chain.push(parent.id);
      cur = parent.parentId;
    }
    if (chain.length > 0) {
      chain.reverse(); // outermost workflow first
      paths.push({ gateId: node.id, boundaryChain: chain });
    }
  }
  return paths.sort((a, b) => (a.gateId < b.gateId ? -1 : 1));
}

/** Nodes with no edge touching them, excluding containers that have children. */
export function findDanglingNodes(graph: WorkflowGraph): string[] {
  const touched = new Set<string>();
  for (const e of graph.edges) {
    touched.add(e.from.node);
    touched.add(e.to.node);
  }
  const hasChildren = new Set<string>();
  for (const n of graph.nodes) {
    if (n.parentId) hasChildren.add(n.parentId);
  }
  return graph.nodes
    .filter(n => !touched.has(n.id))
    .filter(n => !(isContainerKind(n.kind) && hasChildren.has(n.id)))
    .map(n => n.id)
    .sort();
}

/** Nodes whose `parentId` points at a missing or non-container node. */
export function findUnknownContainerChildren(graph: WorkflowGraph): string[] {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  return graph.nodes
    .filter(n => n.parentId !== null)
    .filter(n => {
      const parent = byId.get(n.parentId!);
      return !parent || !isContainerKind(parent.kind);
    })
    .map(n => n.id)
    .sort();
}

export function computeHints(graph: WorkflowGraph): WorkflowHints {
  const { loopBackEdges, topoOrder } = dfsClassify(graph);
  return {
    entryNodes: findEntryNodes(graph),
    topoOrder,
    loopBackEdges,
    propagationPaths: computePropagationPaths(graph),
    danglingNodes: findDanglingNodes(graph),
    unknownContainerChildren: findUnknownContainerChildren(graph),
  };
}

/** Empty selection sentinel — the canonical "nothing drawn/selected" graph. */
export function emptyGraph(): WorkflowGraph {
  return { version: 1, nodes: [], edges: [] };
}
