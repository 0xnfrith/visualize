#!/usr/bin/env bun
import { basename } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { CanvasIndex } from './src/canvas/index.ts';
import { ChannelEmitter } from './src/mcp/channel.ts';
import { startServer } from './src/mcp/server.ts';
import { buildTools, buildWorkflowPayload } from './src/mcp/tools.ts';

// The operator's hand-drawn workflow, exposed as a readable MCP resource that
// fires `notifications/resources/updated` whenever the selection changes.
const WORKFLOW_URI = 'visualize://workflow';

// Read version from package.json so we only have to bump it in one place
// (`bun run bump <new-version>` keeps `.claude-plugin/plugin.json` in sync).
const PKG_VERSION = await readPackageVersion();

async function main() {
  const cwd = process.cwd();
  const sessionId = `${basename(cwd) || 'session'}-${Date.now().toString(36)}`;

  const canvas = new CanvasIndex();
  const handle = startServer(canvas);

  const server = new Server(
    { name: 'visualize', version: PKG_VERSION },
    {
      capabilities: {
        tools: {},
        resources: { subscribe: true },
        experimental: { 'claude/channel': {} },
      },
      instructions:
        `Diagram-rendering canvas. Use \`draw\` to put a diagram on the board ` +
        `(D2 covers most kinds — flow, topology, C4, sequence, ER, UML class). ` +
        `When the operator points at a diagram on the board, call ` +
        `\`get_active_selection\` to see which one and refine in place via ` +
        `\`draw\` with the same id. ` +
        `The operator can also hand-draw a workflow on the canvas: when they ` +
        `say "read my workflow" / "turn this into a workflow script", have ` +
        `them SELECT the workflow shapes, then call \`get_workflow\` (or read ` +
        `the \`${WORKFLOW_URI}\` resource) and author a \`.workflow.js\` from ` +
        `the returned graph, respecting the propagation discipline in \`hints\`. ` +
        `Board for this session: ${handle.url}`,
    }
  );

  const channel = new ChannelEmitter(server);
  canvas.setChannel(channel);

  // Emit a resource-updated notification whenever the operator's selected
  // workflow snapshot changes, so a subscribed client can re-read it live.
  // This is the standards-based stand-in for the (unused) operator channel.
  canvas.setWorkflowNotifier(() => {
    void server
      .notification({
        method: 'notifications/resources/updated',
        params: { uri: WORKFLOW_URI },
      })
      .catch((err: unknown) => {
        if (process.env.VISUALIZE_DEBUG) {
          console.error('[visualize] resource notify failed:', err);
        }
      });
  });

  const tools = buildTools(canvas, handle.url, sessionId, handle.port, () =>
    canvas.getTheme()
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async req => {
    const tool = tools.find(t => t.name === req.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }],
      };
    }
    try {
      const result = await tool.handler(req.params.arguments ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        isError: true,
        content: [
          { type: 'text', text: `Tool ${tool.name} failed: ${(err as Error).message}` },
        ],
      };
    }
  });

  // Resources: the operator's selected workflow graph. Same payload as the
  // `get_workflow` tool (shared `buildWorkflowPayload`) so the two can't drift.
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: WORKFLOW_URI,
        name: 'Selected workflow graph',
        description:
          "The Workflow-tool graph the operator currently has selected on the canvas (nodes, edges, and computed hints). Empty when nothing is selected. Subscribe for live updates as the selection changes.",
        mimeType: 'application/json',
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async req => {
    if (req.params.uri !== WORKFLOW_URI) {
      throw new Error(`Unknown resource: ${req.params.uri}`);
    }
    const payload = { workflow: buildWorkflowPayload(canvas), theme: canvas.getTheme() };
    return {
      contents: [
        {
          uri: WORKFLOW_URI,
          mimeType: 'application/json',
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  });

  // Single stdio client; we always broadcast the updated-notification, so
  // subscribe/unsubscribe just acknowledge (no per-URI bookkeeping needed).
  server.setRequestHandler(SubscribeRequestSchema, async () => ({}));
  server.setRequestHandler(UnsubscribeRequestSchema, async () => ({}));

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const cleanup = () => {
    handle.stop();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

async function readPackageVersion(): Promise<string> {
  const url = new URL('./package.json', import.meta.url);
  const pkg = JSON.parse(await Bun.file(url).text()) as { version?: string };
  return pkg.version ?? '0.0.0';
}

main().catch(err => {
  console.error('[visualize] fatal:', err);
  process.exit(1);
});
