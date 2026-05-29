import { describe, expect, it } from 'bun:test';
import {
  computeHints,
  computePropagationPaths,
  emptyGraph,
  findDanglingNodes,
  findEntryNodes,
  findLoopBackEdges,
  findUnknownContainerChildren,
  isContainerKind,
  topoSort,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowEdge,
} from './workflow.ts';

function node(id: string, kind: WorkflowNode['kind'], parentId: string | null = null, extra: Partial<WorkflowNode> = {}): WorkflowNode {
  return { id, kind, label: id, parentId, ...extra };
}
function edge(id: string, from: string, to: string, cls: WorkflowEdge['class'] = 'control', extra: Partial<WorkflowEdge> = {}): WorkflowEdge {
  return { id, from: { node: from }, to: { node: to }, class: cls, ...extra };
}

/**
 * The canonical e3-sdlc shape (from the workflow-composition-mechanics findings):
 *   classifier → branch[ux|dev] → workflow(mock-ux){ ux-plan → gate } → done
 *   with a "rejected" loop-back (done → classifier) and a propagate bubble-up.
 * Plus an unconnected `orphan` and a mis-parented `lost` to exercise the
 * dangling / unknown-parent hints.
 */
function e3Fixture(): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      node('classifier', 'agent', null, { agent: { prompt: 'classify the task', model: 'haiku' } }),
      node('dispatch', 'branch', null, { branch: { outLabels: ['ux', 'dev'] } }),
      node('ux', 'workflow', null, { workflowRef: { scriptPath: './mock-ux.workflow.js', name: 'mock-ux' } }),
      node('dev', 'workflow', null, { workflowRef: { scriptPath: './dev.workflow.js' } }),
      node('ux-plan', 'agent', 'ux', { agent: { prompt: 'plan the UX' } }),
      node('approve', 'gate', 'ux', { gate: { question: 'Approve the UX?' } }),
      node('done', 'terminal', null, { terminal: { role: 'end', status: 'approved' } }),
      node('orphan', 'agent', null),
      node('lost', 'agent', 'nonexistent'),
    ],
    edges: [
      edge('e1', 'classifier', 'dispatch'),
      { id: 'e2', from: { node: 'dispatch', port: 'ux' }, to: { node: 'ux' }, class: 'control' },
      { id: 'e3', from: { node: 'dispatch', port: 'dev' }, to: { node: 'dev' }, class: 'control' },
      edge('e4', 'ux-plan', 'approve'),
      edge('e5', 'ux', 'done'),
      edge('e6', 'done', 'classifier', 'control', { label: 'rejected' }), // loop-back
      edge('e7', 'approve', 'ux', 'propagate', { label: 'needs_input' }), // bubble-up, not flow
    ],
  };
}

describe('isContainerKind', () => {
  it('classifies container vs leaf kinds', () => {
    for (const k of ['phase', 'parallel', 'pipeline', 'workflow'] as const) {
      expect(isContainerKind(k)).toBe(true);
    }
    for (const k of ['agent', 'gate', 'branch', 'terminal'] as const) {
      expect(isContainerKind(k)).toBe(false);
    }
  });
});

describe('findLoopBackEdges', () => {
  it('finds the rejected back-edge and ignores propagate edges', () => {
    expect(findLoopBackEdges(e3Fixture())).toEqual(['e6']);
  });
  it('returns empty for an acyclic chain', () => {
    const g: WorkflowGraph = { version: 1, nodes: [node('a', 'agent'), node('b', 'agent')], edges: [edge('x', 'a', 'b')] };
    expect(findLoopBackEdges(g)).toEqual([]);
  });
});

describe('topoSort', () => {
  it('orders so every flow edge goes forward (ignoring loop-backs)', () => {
    const g = e3Fixture();
    const order = topoSort(g)!;
    const pos = new Map(order.map((id, i) => [id, i]));
    // every node appears exactly once
    expect(order.length).toBe(g.nodes.length);
    expect(new Set(order).size).toBe(g.nodes.length);
    const loopBack = new Set(findLoopBackEdges(g));
    for (const e of g.edges) {
      if ((e.class === 'control' || e.class === 'data') && !loopBack.has(e.id)) {
        expect(pos.get(e.from.node)!).toBeLessThan(pos.get(e.to.node)!);
      }
    }
  });
});

describe('findEntryNodes', () => {
  it('treats the loop-back target as an entry and finds disconnected nodes', () => {
    // classifier's only incoming is the loop-back e6 → still an entry.
    expect(findEntryNodes(e3Fixture())).toEqual(['classifier', 'lost', 'orphan', 'ux-plan']);
  });
});

describe('computePropagationPaths', () => {
  it('lists the workflow boundary enclosing a gate', () => {
    expect(computePropagationPaths(e3Fixture())).toEqual([{ gateId: 'approve', boundaryChain: ['ux'] }]);
  });
  it('emits no path for a top-level gate', () => {
    const g: WorkflowGraph = { version: 1, nodes: [node('g', 'gate', null)], edges: [] };
    expect(computePropagationPaths(g)).toEqual([]);
  });
  it('orders nested workflow boundaries outermost-first', () => {
    const g: WorkflowGraph = {
      version: 1,
      nodes: [
        node('outer', 'workflow', null),
        node('mid', 'phase', 'outer'),
        node('inner', 'workflow', 'mid'),
        node('g', 'gate', 'inner'),
      ],
      edges: [],
    };
    // phase 'mid' is skipped (not a workflow boundary); outer before inner.
    expect(computePropagationPaths(g)).toEqual([{ gateId: 'g', boundaryChain: ['outer', 'inner'] }]);
  });
});

describe('findDanglingNodes', () => {
  it('flags unwired nodes but not containers with children', () => {
    // orphan + lost have no edges; ux/dispatch are wired; ux is a container with children.
    expect(findDanglingNodes(e3Fixture())).toEqual(['lost', 'orphan']);
  });
  it('flags an empty container', () => {
    const g: WorkflowGraph = { version: 1, nodes: [node('p', 'phase', null)], edges: [] };
    expect(findDanglingNodes(g)).toEqual(['p']);
  });
});

describe('findUnknownContainerChildren', () => {
  it('flags a child whose parent is missing or not a container', () => {
    expect(findUnknownContainerChildren(e3Fixture())).toEqual(['lost']);
  });
  it('flags a child parented to a leaf node', () => {
    const g: WorkflowGraph = { version: 1, nodes: [node('a', 'agent'), node('b', 'agent', 'a')], edges: [] };
    expect(findUnknownContainerChildren(g)).toEqual(['b']);
  });
});

describe('computeHints', () => {
  it('assembles the full hint set for the e3 fixture', () => {
    const h = computeHints(e3Fixture());
    expect(h.loopBackEdges).toEqual(['e6']);
    expect(h.entryNodes).toEqual(['classifier', 'lost', 'orphan', 'ux-plan']);
    expect(h.propagationPaths).toEqual([{ gateId: 'approve', boundaryChain: ['ux'] }]);
    expect(h.danglingNodes).toEqual(['lost', 'orphan']);
    expect(h.unknownContainerChildren).toEqual(['lost']);
    expect(h.topoOrder).not.toBeNull();
    expect(h.topoOrder!.length).toBe(9);
  });
  it('handles the empty graph', () => {
    const h = computeHints(emptyGraph());
    expect(h).toEqual({
      entryNodes: [],
      topoOrder: [],
      loopBackEdges: [],
      propagationPaths: [],
      danglingNodes: [],
      unknownContainerChildren: [],
    });
  });
});
