import { describe, expect, it } from 'bun:test';
import { CanvasIndex } from '../canvas/index.ts';
import { computeHints, type WorkflowGraph } from '../canvas/workflow.ts';
import { buildTools, buildWorkflowPayload } from './tools.ts';

function getWorkflowHandler(canvas: CanvasIndex, theme: 'light' | 'dark' = 'dark') {
  const tools = buildTools(canvas, 'http://127.0.0.1:0', 'test-session', 0, () => theme);
  const tool = tools.find(t => t.name === 'get_workflow');
  if (!tool) throw new Error('get_workflow tool not registered');
  return tool;
}

const SAMPLE: WorkflowGraph = {
  version: 1,
  nodes: [
    { id: 'a', kind: 'agent', label: 'classify', parentId: null, agent: { prompt: 'classify' } },
    { id: 'b', kind: 'agent', label: 'work', parentId: null },
  ],
  edges: [{ id: 'e1', from: { node: 'a' }, to: { node: 'b' }, class: 'control' }],
};

describe('buildWorkflowPayload', () => {
  it('returns null when nothing is selected', () => {
    expect(buildWorkflowPayload(new CanvasIndex())).toBeNull();
  });
  it('fills hints on the stored graph', () => {
    const canvas = new CanvasIndex();
    canvas.setWorkflow(SAMPLE);
    const payload = buildWorkflowPayload(canvas)!;
    expect(payload.nodes).toEqual(SAMPLE.nodes);
    expect(payload.edges).toEqual(SAMPLE.edges);
    expect(payload.hints).toEqual(computeHints(SAMPLE));
  });
});

describe('get_workflow tool', () => {
  it('returns { workflow: null, theme } when unset', async () => {
    const canvas = new CanvasIndex();
    const result = (await getWorkflowHandler(canvas, 'light').handler({})) as {
      workflow: unknown;
      theme: string;
    };
    expect(result).toEqual({ workflow: null, theme: 'light' });
  });

  it('returns the graph with hints when set', async () => {
    const canvas = new CanvasIndex();
    canvas.setWorkflow(SAMPLE);
    const result = (await getWorkflowHandler(canvas, 'dark').handler({})) as {
      workflow: WorkflowGraph;
      theme: string;
    };
    expect(result.theme).toBe('dark');
    expect(result.workflow.hints).toEqual(computeHints(SAMPLE));
    expect(result.workflow.nodes).toEqual(SAMPLE.nodes);
  });

  it('reflects the latest setWorkflow (last-write-wins)', async () => {
    const canvas = new CanvasIndex();
    canvas.setWorkflow(SAMPLE);
    canvas.setWorkflow({ version: 1, nodes: [], edges: [] });
    const result = (await getWorkflowHandler(canvas).handler({})) as { workflow: WorkflowGraph };
    expect(result.workflow.nodes).toEqual([]);
  });
});

describe('CanvasIndex.setWorkflowNotifier', () => {
  it('fires the notifier on every setWorkflow', () => {
    const canvas = new CanvasIndex();
    let calls = 0;
    canvas.setWorkflowNotifier(() => {
      calls++;
    });
    canvas.setWorkflow(SAMPLE);
    canvas.setWorkflow({ version: 1, nodes: [], edges: [] });
    expect(calls).toBe(2);
  });
});
