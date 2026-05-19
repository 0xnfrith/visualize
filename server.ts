#!/usr/bin/env bun
import { basename } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { CanvasIndex } from './src/canvas/index.ts';
import { ChannelEmitter } from './src/mcp/channel.ts';
import { startServer } from './src/mcp/server.ts';
import { buildTools } from './src/mcp/tools.ts';

async function main() {
  await assertD2Installed();

  const cwd = process.cwd();
  const sessionId = `${basename(cwd) || 'session'}-${Date.now().toString(36)}`;

  const canvas = new CanvasIndex();
  const handle = startServer(canvas);

  const server = new Server(
    { name: 'visualize', version: '0.1.0' },
    {
      capabilities: {
        tools: {},
        experimental: { 'claude/channel': {} },
      },
      instructions:
        `Diagram-rendering canvas. Use \`draw\` to put a diagram on the board ` +
        `(D2 covers most kinds — flow, topology, C4, sequence, ER, UML class). ` +
        `When the operator points at a diagram on the board, call ` +
        `\`get_active_selection\` to see which one and refine in place via ` +
        `\`draw\` with the same id. Board for this session: ${handle.url}`,
    }
  );

  const channel = new ChannelEmitter(server);
  canvas.setChannel(channel);

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

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const cleanup = () => {
    handle.stop();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

async function assertD2Installed(): Promise<void> {
  const proc = Bun.spawn(['d2', '--version'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  try {
    const exit = await proc.exited;
    if (exit !== 0) throw new Error(`d2 exited ${exit}`);
  } catch (err) {
    console.error(
      '[visualize] d2 binary not found on PATH.\n' +
        '  Install: brew install d2\n' +
        '  See: https://d2lang.com/tour/install\n' +
        `  Underlying error: ${(err as Error).message}`
    );
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[visualize] fatal:', err);
  process.exit(1);
});
