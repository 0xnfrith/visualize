# visualize

A plugin for Claude Code and Codex that gives the agent a diagram-rendering canvas. The agent generates D2 (or raw SVG, or an image URL); the plugin renders it server-side and pushes the result onto a tldraw surface the operator can pan, zoom, drag, and annotate.

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

If `d2` is missing the server still boots — the first `draw` call surfaces install instructions through the agent as a normal tool error, so no host restart is needed once you install `d2`. If `bun` is missing the MCP server can't spawn at all, which surfaces as `× failed` in the host's plugin list (run `claude --debug mcp` to see the underlying ENOENT in Claude Code).

## Install

**Claude Code:**

```
/plugin install ~/HUB/visualize
```

**Codex:**

```
codex plugin marketplace add nfrith/marketplace
```

Then enable `visualize` from the plugin directory. Or from the marketplace once published.

On Codex the plugin runs with default host settings (`127.0.0.1` for both bind and advertised host). Codex doesn't support the `userConfig` schema Claude Code uses, so container-style overrides aren't exposed yet — set `VISUALIZE_BIND_HOST` / `VISUALIZE_ADVERTISED_HOST` in the MCP server env block manually if you need them.

## What's in here

```
.claude-plugin/plugin.json   Claude Code plugin manifest (with userConfig)
.codex-plugin/plugin.json    Codex plugin manifest
.mcp.json                    Claude Code MCP entry (bridges userConfig to env)
.mcp.codex.json              Codex MCP entry (defaults only)
server.ts                    MCP stdio entry, channel wiring
src/canvas/                  CanvasIndex — in-memory store of rendered diagrams
src/renderers/               d2 (CLI shell-out), svg, image, registry
src/mcp/                     Bun.serve HTTP+WS, tools, channel emitter, protocol
src/web/                     tldraw SPA (canvas surface)
scripts/build-web.ts         Bun.build for the SPA (content-hashed filenames)
```

## License

Apache-2.0.
