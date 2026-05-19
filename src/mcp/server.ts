import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserSocket, CanvasIndex } from '../canvas/index.ts';
import type { BrowserMessage } from './protocol.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const WEB_DIST = join(PROJECT_ROOT, 'dist', 'web');

const ASSET_EXTENSION =
  /\.(?:js|mjs|css|map|png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|otf|json|txt|wasm)$/i;

export interface ServerHandle {
  url: string;
  port: number;
  stop: () => void;
}

/**
 * Start the in-process HTTP + WebSocket server that backs one Claude session.
 * Binds to port 0 so multiple sessions coexist without port contention. All
 * diagnostic output goes to stderr — the MCP stdio transport shares this
 * process's stdout, so any stray console.log corrupts JSON-RPC frames.
 *
 * Bind interface and advertised hostname are configurable via the plugin's
 * userConfig, bridged into VISUALIZE_BIND_HOST / VISUALIZE_ADVERTISED_HOST
 * by .mcp.json's env block (Claude Code's ${user_config.*} substitution).
 * The auto-export-as-CLAUDE_PLUGIN_OPTION_* path the docs describe doesn't
 * fire for MCP-server subprocesses on 2.1.144, so we wire it explicitly.
 * Defaults keep host-machine behavior loopback-only; containers override to
 * bind 0.0.0.0 and advertise their host-reachable name.
 */
export function startServer(canvas: CanvasIndex): ServerHandle {
  const { bindHost, advertisedHost } = resolveHosts();

  const server = Bun.serve<unknown>({
    hostname: bindHost,
    port: 0,
    fetch(req, srv) {
      const url = new URL(req.url);

      // /diagrams/<id> serves the rendered bytes the browser embeds via
      // tldraw's image-asset URL. Encoded ids let entries use any string.
      if (url.pathname.startsWith('/diagrams/')) {
        const id = decodeURIComponent(url.pathname.slice('/diagrams/'.length));
        const entry = canvas.get(id);
        if (!entry) return new Response('not found', { status: 404 });
        // Wrap bytes in a Blob — Uint8Array isn't in lib.dom's BodyInit union
        // (Bun accepts it at runtime, TS just disagrees).
        return new Response(new Blob([new Uint8Array(entry.bytes)]), {
          headers: {
            'Content-Type': entry.mime,
            // No long-cache: the browser refetches on entry.version bumps.
            'Cache-Control': 'no-store',
          },
        });
      }

      if (url.pathname === '/ws') {
        const ok = srv.upgrade(req, { data: {} });
        if (ok) return;
        return new Response('upgrade failed', { status: 500 });
      }

      return serveStatic(url.pathname);
    },
    websocket: {
      open() {
        // Wait for browser.subscribe before adding to the broadcast set —
        // keeps subscription explicit and lets the browser identify itself
        // first if we ever want to differentiate clients.
      },
      message(ws, raw) {
        let msg: BrowserMessage;
        try {
          msg = JSON.parse(String(raw)) as BrowserMessage;
        } catch (err) {
          console.error('[visualize] bad ws message:', err);
          return;
        }
        handleMessage(canvas, ws, msg);
      },
      close(ws) {
        canvas.removeBrowser(ws);
      },
    },
  });

  // server.port is typed as optional (Bun.serve also supports unix sockets
  // where it's absent); with hostname + port:0 we always have a TCP port.
  const port = server.port!;
  const url = `http://${advertisedHost}:${port}`;
  if (bindHost === advertisedHost) {
    console.error(`[visualize] listening on ${url}`);
  } else {
    console.error(
      `[visualize] listening on ${bindHost}:${port}, advertising ${url}`
    );
  }

  return {
    url,
    port,
    stop: () => server.stop(true),
  };
}

export function resolveHosts(env: NodeJS.ProcessEnv = process.env): {
  bindHost: string;
  advertisedHost: string;
} {
  const bindHost = env.VISUALIZE_BIND_HOST?.trim() || '127.0.0.1';
  const advertisedRaw = env.VISUALIZE_ADVERTISED_HOST?.trim();
  // 0.0.0.0 isn't a dialable URL. Remap to loopback in both the fallback path
  // (advertised unset, bind is 0.0.0.0) and the explicit-misconfig path
  // (advertised set to 0.0.0.0), so the operator can't end up with a broken
  // link handed to the model. Stderr-warn on the explicit case so the
  // operator notices the override.
  const candidate = advertisedRaw || bindHost;
  const advertisedHost = candidate === '0.0.0.0' ? '127.0.0.1' : candidate;
  if (advertisedRaw === '0.0.0.0') {
    console.error(
      "[visualize] advertised_host='0.0.0.0' isn't dialable; using 127.0.0.1 instead"
    );
  }
  return { bindHost, advertisedHost };
}

function handleMessage(
  canvas: CanvasIndex,
  ws: BrowserSocket,
  msg: BrowserMessage
): void {
  switch (msg.type) {
    case 'browser.subscribe':
      canvas.addBrowser(ws);
      return;
    case 'browser.shape_moved':
      canvas.updatePosition(msg.id, msg.position);
      return;
    case 'browser.shape_removed':
      canvas.remove(msg.id);
      return;
    case 'browser.selection_changed':
      canvas.setActiveSelection(msg.ids);
      return;
  }
}

function serveStatic(pathname: string): Response {
  const candidate = pathname === '/' ? '/index.html' : pathname;
  const filePath = join(WEB_DIST, candidate);

  if (existsSync(filePath) && !filePath.includes('..')) {
    return new Response(Bun.file(filePath));
  }

  if (ASSET_EXTENSION.test(pathname)) {
    return new Response(`Not found: ${pathname}`, { status: 404 });
  }

  const indexPath = join(WEB_DIST, 'index.html');
  if (existsSync(indexPath)) {
    return new Response(Bun.file(indexPath), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return new Response(
    `<!doctype html><html><body><h1>visualize</h1>
     <p>Web bundle not built yet. Run <code>bun run build:web</code>.</p>
     </body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 200 }
  );
}
