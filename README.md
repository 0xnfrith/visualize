# visualize

A Claude Code plugin that gives Claude a diagram-rendering canvas. Claude generates D2 (or raw SVG, or an image URL); the plugin renders it server-side and pushes the result onto a tldraw surface the operator can pan, zoom, drag, and annotate.

## Renderers

- **D2** — default for almost every diagram kind. Flow, topology, C4 with nested containers, sequence (`shape: sequence_diagram`), ER (`shape: sql_table`), UML class (`shape: class`).
- **Raw SVG passthrough** — Claude pastes in arbitrary SVG markup; server validates it's well-formed and forwards.
- **Image-by-URL** — fetch a PNG/JPEG by URL and place it on the canvas.

Mermaid (state diagrams) is intentionally **not** in v0. The in-process path requires browser DOM APIs (`getBBox`, layout measurement) that pure-JS shims can't fake; the CLI path pulls Chromium. We'll revisit when there's appetite for one of those costs.

## Prerequisites

**[bun](https://bun.sh)** must be on `PATH` for the MCP server to spawn. **[d2](https://d2lang.com)** is needed at render time — install both up-front.

**macOS:**

```sh
brew install bun d2
```

**Linux (curl):**

```sh
curl -fsSL https://bun.sh/install | bash       # needs 'unzip' — apt-get install unzip
curl -fsSL https://d2lang.com/install.sh | sh -s --
```

Release tarballs if curl-installers don't fit: [bun releases](https://github.com/oven-sh/bun/releases), [d2 releases](https://github.com/terrastruct/d2/releases).

If `d2` is missing the server still boots — the first `draw` call surfaces install instructions through Claude as a normal tool error, so no Claude Code restart is needed once you install `d2`. If `bun` is missing the MCP server can't spawn at all, which surfaces as `× failed` in `/plugin Installed` (run `claude --debug mcp` to see the underlying ENOENT).

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
server.ts                    MCP stdio entry, channel wiring
src/canvas/                  CanvasIndex — in-memory store of rendered diagrams
src/renderers/               d2 (CLI shell-out), svg, image, registry
src/mcp/                     Bun.serve HTTP+WS, tools, channel emitter, protocol
src/web/                     tldraw SPA (canvas surface)
scripts/build-web.ts         Bun.build for the SPA (content-hashed filenames)
```

## License

Apache-2.0.
