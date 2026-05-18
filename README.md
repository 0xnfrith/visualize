# visualize

A Claude Code plugin that gives Claude a diagram-rendering canvas. Claude generates D2 (or raw SVG, or an image URL); the plugin renders it server-side and pushes the result onto a tldraw surface the operator can pan, zoom, drag, and annotate.

## Renderers

- **D2** — default for almost every diagram kind. Flow, topology, C4 with nested containers, sequence (`shape: sequence_diagram`), ER (`shape: sql_table`), UML class (`shape: class`).
- **Raw SVG passthrough** — Claude pastes in arbitrary SVG markup; server validates it's well-formed and forwards.
- **Image-by-URL** — fetch a PNG/JPEG by URL and place it on the canvas.

Mermaid (state diagrams) is intentionally **not** in v0. The in-process path requires browser DOM APIs (`getBBox`, layout measurement) that pure-JS shims can't fake; the CLI path pulls Chromium. We'll revisit when there's appetite for one of those costs.

## Prerequisites

- **[Bun](https://bun.sh)** — the runtime.
- **[D2](https://d2lang.com)** on `PATH`:

```sh
brew install d2
```

The plugin detects `d2` at startup and exits with a clear message if it's missing.

## Install

In Claude Code:

```
/plugin install ~/HUB/visualize
```

Or from the marketplace once published.

## What's in here

```
.claude-plugin/plugin.json   plugin manifest
.mcp.json                    MCP server entry pointing at server.ts
server.ts                    MCP stdio entry, d2 detection, channel wiring
src/canvas/                  CanvasIndex — in-memory store of rendered diagrams
src/renderers/               d2 (CLI shell-out), svg, image, registry
src/mcp/                     Bun.serve HTTP+WS, tools, channel emitter, protocol
src/web/                     tldraw SPA (canvas surface)
scripts/build-web.ts         Bun.build for the SPA (content-hashed filenames)
```

## License

Apache-2.0.
