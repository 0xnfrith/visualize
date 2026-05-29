import type { WorkflowNodeKind } from '../../canvas/workflow.ts';

/**
 * The data-driven primitive registry. One `wf-node` tldraw shape handles all 8
 * Workflow-tool primitives; per-kind appearance, default size, and PORTS live
 * here as data so adding a primitive is an edit to this table, not a new class.
 *
 * Ports use the official tldraw-workflow convention: `terminal: 'start'` is an
 * OUTPUT/source port, `terminal: 'end'` is an INPUT/target port. A connection is
 * drawn by dragging from a `start` port to an `end` port. Port `x/y` are in the
 * shape's LOCAL space (relative to its top-left); the single source of truth for
 * both the rendered port dots and the serializer.
 */

export type PortTerminal = 'start' | 'end';

export interface PortSpec {
  id: string;
  terminal: PortTerminal;
  x: number;
  y: number;
}

/** The flat prop bag stored on every `wf-node` shape (avoids nested validators). */
export interface WfNodeProps {
  w: number;
  h: number;
  kind: WorkflowNodeKind;
  label: string;
  // agent
  prompt: string;
  model: string;
  schema: string;
  agentType: string;
  // gate
  question: string;
  // branch
  cases: string[];
  // terminal
  role: string; // 'start' | 'end'
  status: string;
  // workflow container
  scriptPath: string;
  name: string;
  args: string; // JSON text
}

export interface PrimitiveDef {
  kind: WorkflowNodeKind;
  group: 'node' | 'container';
  /** Toolbar label. */
  label: string;
  /** Accent color (fixed hue that reads on both light + dark canvases). */
  accent: string;
  defaultSize: { w: number; h: number };
  /** Single-key toolbar shortcut. Avoids space/g/z (owned by vim-nav). */
  kbd?: string;
  ports: (p: WfNodeProps) => PortSpec[];
}

const inPort = (p: WfNodeProps): PortSpec => ({ id: 'in', terminal: 'end', x: 0, y: p.h / 2 });
const outPort = (p: WfNodeProps): PortSpec => ({ id: 'out', terminal: 'start', x: p.w, y: p.h / 2 });
const inOut = (p: WfNodeProps): PortSpec[] => [inPort(p), outPort(p)];

export const PRIMITIVES: Record<WorkflowNodeKind, PrimitiveDef> = {
  agent: {
    kind: 'agent',
    group: 'node',
    label: 'Agent',
    accent: '#4f8cff',
    defaultSize: { w: 220, h: 110 },
    kbd: 'a',
    ports: inOut,
  },
  gate: {
    kind: 'gate',
    group: 'node',
    label: 'Gate (needs_input)',
    accent: '#f59e0b',
    defaultSize: { w: 200, h: 90 },
    kbd: 'i',
    ports: inOut,
  },
  branch: {
    kind: 'branch',
    group: 'node',
    label: 'Branch',
    accent: '#a855f7',
    defaultSize: { w: 200, h: 120 },
    kbd: 'b',
    // One input; one output per case, distributed down the right edge.
    ports: p => {
      const cases = p.cases.length > 0 ? p.cases : ['a', 'b'];
      return [
        inPort(p),
        ...cases.map((_, i) => ({
          id: `out-${i}`,
          terminal: 'start' as const,
          x: p.w,
          y: (p.h * (i + 1)) / (cases.length + 1),
        })),
      ];
    },
  },
  terminal: {
    kind: 'terminal',
    group: 'node',
    label: 'Terminal',
    accent: '#10b981',
    defaultSize: { w: 150, h: 70 },
    kbd: 't',
    // start terminal emits (out only); end terminal receives (in only).
    ports: p => (p.role === 'start' ? [outPort(p)] : p.role === 'end' ? [inPort(p)] : inOut(p)),
  },
  phase: {
    kind: 'phase',
    group: 'container',
    label: 'Phase',
    accent: '#64748b',
    defaultSize: { w: 420, h: 300 },
    kbd: 'p',
    ports: () => [], // pure grouping band
  },
  parallel: {
    kind: 'parallel',
    group: 'container',
    label: 'Parallel',
    accent: '#ec4899',
    defaultSize: { w: 420, h: 300 },
    ports: inOut,
  },
  pipeline: {
    kind: 'pipeline',
    group: 'container',
    label: 'Pipeline',
    accent: '#14b8a6',
    defaultSize: { w: 480, h: 240 },
    ports: inOut,
  },
  workflow: {
    kind: 'workflow',
    group: 'container',
    label: 'Sub-workflow',
    accent: '#6366f1',
    defaultSize: { w: 460, h: 320 },
    kbd: 'w',
    ports: inOut,
  },
};

export const NODE_KINDS = Object.values(PRIMITIVES)
  .filter(d => d.group === 'node')
  .map(d => d.kind);
export const CONTAINER_KINDS_LIST = Object.values(PRIMITIVES)
  .filter(d => d.group === 'container')
  .map(d => d.kind);

/** Default flat props for a freshly-stamped node of `kind`. */
export function defaultNodeProps(kind: WorkflowNodeKind): WfNodeProps {
  const def = PRIMITIVES[kind];
  return {
    w: def.defaultSize.w,
    h: def.defaultSize.h,
    kind,
    label: def.label,
    prompt: '',
    model: '',
    schema: '',
    agentType: '',
    question: '',
    cases: kind === 'branch' ? ['a', 'b'] : [],
    role: kind === 'terminal' ? 'end' : '',
    status: '',
    scriptPath: '',
    name: '',
    args: '',
  };
}
