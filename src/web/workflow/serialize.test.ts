import { describe, expect, it } from 'bun:test';
import type { WorkflowNodeKind } from '../../canvas/workflow.ts';
import { defaultNodeProps, type WfNodeProps } from './primitives.ts';
import { serializeWorkflow, type SnapshotEdge, type SnapshotNode } from './serialize.ts';

function snapNode(id: string, kind: WorkflowNodeKind, parentId: string | null = null, over: Partial<WfNodeProps> = {}): SnapshotNode {
  return { id, parentId, props: { ...defaultNodeProps(kind), ...over } };
}
function snapEdge(id: string, from: string, fromPort: string, to: string, toPort = 'in', edgeClass: SnapshotEdge['edgeClass'] = 'control'): SnapshotEdge {
  return { id, edgeClass, from: { nodeId: from, portId: fromPort }, to: { nodeId: to, portId: toPort } };
}

describe('serializeWorkflow', () => {
  it('serializes two agents joined by a control edge', () => {
    const g = serializeWorkflow({
      nodes: [snapNode('b', 'agent'), snapNode('a', 'agent', null, { prompt: 'classify', model: 'haiku' })],
      edges: [snapEdge('e1', 'a', 'out', 'b')],
    });
    expect(g.version).toBe(1);
    expect(g.nodes.map(n => n.id)).toEqual(['a', 'b']); // sorted
    expect(g.nodes[0]!.agent).toEqual({ prompt: 'classify', model: 'haiku' });
    expect(g.edges).toEqual([
      { id: 'e1', from: { node: 'a', port: 'out' }, to: { node: 'b', port: 'in' }, class: 'control' },
    ]);
  });

  it('translates branch out-ports to case labels', () => {
    const g = serializeWorkflow({
      nodes: [
        snapNode('br', 'branch', null, { cases: ['ux', 'dev', 'docs'] }),
        snapNode('x', 'agent'),
        snapNode('y', 'agent'),
        snapNode('z', 'agent'),
      ],
      edges: [snapEdge('e0', 'br', 'out-0', 'x'), snapEdge('e1', 'br', 'out-1', 'y'), snapEdge('e2', 'br', 'out-2', 'z')],
    });
    expect(g.nodes.find(n => n.id === 'br')!.branch).toEqual({ outLabels: ['ux', 'dev', 'docs'] });
    const ports = g.edges.map(e => e.from.port);
    expect(ports).toEqual(['ux', 'dev', 'docs']);
  });

  it('keeps parentId only when the parent is in the selection', () => {
    const g = serializeWorkflow({
      nodes: [
        snapNode('ph', 'phase'),
        snapNode('c', 'agent', 'ph'), // parent selected → kept
        snapNode('d', 'agent', 'missing'), // parent not in set → null
      ],
      edges: [],
    });
    expect(g.nodes.find(n => n.id === 'c')!.parentId).toBe('ph');
    expect(g.nodes.find(n => n.id === 'd')!.parentId).toBeNull();
  });

  it('drops edges whose endpoint is missing or unselected', () => {
    const g = serializeWorkflow({
      nodes: [snapNode('a', 'agent'), snapNode('b', 'agent')],
      edges: [
        snapEdge('keep', 'a', 'out', 'b'),
        { id: 'dangling', edgeClass: 'control', from: { nodeId: 'a', portId: 'out' }, to: null },
        snapEdge('offscreen', 'a', 'out', 'notselected'),
      ],
    });
    expect(g.edges.map(e => e.id)).toEqual(['keep']);
  });

  it('parses workflow-container args JSON and tolerates invalid JSON', () => {
    const ok = serializeWorkflow({ nodes: [snapNode('w', 'workflow', null, { scriptPath: './c.js', args: '{"task":"x"}' })], edges: [] });
    expect(ok.nodes[0]!.workflowRef).toEqual({ scriptPath: './c.js', args: { task: 'x' } });
    const bad = serializeWorkflow({ nodes: [snapNode('w', 'workflow', null, { scriptPath: './c.js', args: '{not json' })], edges: [] });
    expect(bad.nodes[0]!.workflowRef).toEqual({ scriptPath: './c.js' });
  });
});
