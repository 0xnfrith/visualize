---
name: visualize
description: >-
  Open the visualize board and draw the requested diagram on it. Use when
  the user types /visualize <topic>, asks to "draw this on the canvas",
  "visualize this system", "put X on the board", or wants a diagram rendered
  live alongside the conversation. With nothing selected and no topic it just
  opens the board; with a diagram already selected on the canvas, it refines
  that one in place instead of creating a new one.
disable-model-invocation: true
user-invocable: true
---

# /visualize — paint a diagram on the canvas

The user wants you to draw or refine a diagram on the `visualize` board.
Follow these steps in order. The user may pass a `<topic>` argument; the
surrounding conversation is also part of the context.

## Step 1 — Ensure the board is open AND learn the canvas theme

Call `get_board_url` (no arguments). It returns
`{ url, session_id, port, theme }` where `theme` is `'light'` or `'dark'` —
the operator's current canvas color scheme. **Keep this value**, you'll use
it in Step 4 to pick a contrasting D2 theme.

If the tool is unavailable, the visualize plugin is not active in this
session; tell the user and stop.

Then run:

```bash
open "<url>"
```

`open` is idempotent — calling it when the tab already exists just focuses
it. On Linux substitute `xdg-open`, on Windows `start`. If none work, print
the URL and ask the user to open it manually.

## Step 2 — Decide what to draw

Three modes. Pick one based on the user's prompt and the canvas state:

### A — Just open the board
If the user invoked `/visualize` with no topic and no clear diagramming
intent (e.g., "/visualize" by itself or "where's the canvas?"), stop after
step 1. Don't draw anything.

### B — Refine an existing diagram
Call `get_active_selection`. It returns `{ selected, theme }`. If `selected`
is non-null AND the user's prompt sounds like a refinement of an existing
thing ("denser", "split out X", "add a step for Y", "use ELK", "make it TB",
"clearer labels"), refine the selected diagram in place. Note the returned
`theme` may differ from what you saw earlier — operator may have flipped
themes; re-pick `theme-id` in `vars.d2-config` accordingly.

Take the selected entry's `spec.source`, modify it, and call:
```
draw({ id: <selected.id>, title: <updated title>, spec: { kind: 'd2', source: <new source> } })
```
Position and size are preserved automatically — never pass them on update.

### C — Draw something new
Otherwise: compose new D2 source and call `draw` without an `id`. The
server auto-places it on a grid.

## Step 3 — Pick the right D2 shape

D2 covers most diagram kinds. Pick the one that fits the topic:

- **Flow** (default) — `a -> b: label`. Plain D2. Use for data flow, call
  graphs, dependency graphs, pipelines.
- **Topology / C4** — nested containers via `name: { child1; child2 }`. Mix
  in `shape: person` for actors, `shape: hexagon` for external systems,
  `shape: cylinder` for databases. Connect across container boundaries with
  dotted paths: `outer.inner -> other.thing`.
- **Sequence diagram** — declare `shape: sequence_diagram` at the top, then
  lifelines and messages: `claude -> server: request`. Self-messages work
  (`x -> x: internal step`).
- **ER diagram** — one `shape: sql_table` per table with column rows
  (`+id int {constraint: primary_key}`). FK arrows go column-to-column:
  `posts.author_id -> users.id`.
- **UML class** — `shape: class` with `+field type` for attributes and
  `+method(args) return` for methods. `+` / `-` / `#` for visibility.

D2 does NOT do state diagrams cleanly yet — fork that conversation for
later, don't try to fake it.

## Step 4 — Configure the D2 program via `vars.d2-config`

The `draw` API has NO theme or layout params — everything goes inside the
D2 source via a `vars: { d2-config: {...} }` block at the top. Pick values
based on the `theme` you got from `get_board_url`.

### Required: `theme-id`

Pick a D2 theme that contrasts with the operator's canvas.

| Operator canvas | Good D2 theme IDs |
| --- | --- |
| `dark` | `200` (Dark Mauve), `201` (Dark Flagship Terrastruct) |
| `light` | `0` (Neutral Default), `1` (Neutral Grey), `3` (Flagship Terrastruct), `4` (Cool Classics), `5` (Mixed Berry Blue), `6` (Grape Soda), `7` (Aubergine), `8` (Colorblind Clear), `100`–`105` (Vanilla Nitro Cola, Orange Creamsicle, Shirley Temple, Earth Tones, Everglade Green, Buttered Toast), `300` (Terminal), `301` (Terminal Grayscale), `302` (Origami), `303` (C4) |

Notes:
- D2 also accepts a "light" theme as the only theme — useful if you want a
  bright pastel island on a dark canvas. Just be aware light themes default
  to dark text and look correct against light surroundings.
- Use `8` (Colorblind Clear) when accessibility matters.
- Use `300`/`301` (Terminal / Terminal Grayscale) for retro / monospace
  vibes — these apply caps-lock labels, square borders, and a mono font.

### Required when the structure needs it: `layout-engine`

- `dagre` (D2's default) — fast and clean for acyclic flows, LR pipelines,
  TB lifecycles.
- `elk` — graphs with cycles, feedback edges, back-references, dense
  cross-connections, or anywhere `dagre` would sprawl.
- `tala` — premium engine, only if installed.

Omit for `shape: sequence_diagram`, `shape: class`, `shape: sql_table` —
those pick their own internal layout.

### Optional: `theme-overrides` for fine-tuning

If the chosen theme is close but one color clashes, override individual
slots without writing a whole theme:

```d2
vars: {
  d2-config: {
    theme-id: 200
    theme-overrides: {
      B1: "#2E7D32"
      AB4: "#F44336"
    }
  }
}
```

See [d2lang.com/tour/themes](https://d2lang.com/tour/themes/#customizing-themes)
for the slot map.

### Example: dark canvas, topology diagram

```d2
vars: {
  d2-config: {
    theme-id: 200
    layout-engine: elk
  }
}

direction: right

client -> api: request
api -> db: query
db -> api: rows
api -> client: response
```

### Example: light canvas, sequence diagram

```d2
vars: {
  d2-config: {
    theme-id: 4
  }
}

shape: sequence_diagram
alice -> bob: hello
bob -> alice: hi
```

### Per-shape overrides

When you DO set `style.fill` on an individual shape, also set
`style.font-color` so the text contrasts with your custom fill — the theme
won't auto-pair for explicit colors.

## Step 5 — Call `draw`

**Mode B (refinement)** — same id as the selected entry:
```
draw({
  id: <selected.id>,
  title: <updated title>,
  spec: { kind: 'd2', source: <new D2 source> }
})
```

**Mode C (new)** — omit `id`, let the server assign one:
```
draw({
  title: <short kebab-case label>,
  spec: { kind: 'd2', source: <D2 source> }
})
```

Never pass `position` — auto-placement is the server's job, and the
operator drags to refine.

If `draw` returns `{ ok: false, error: { messages: [{ line, column, text }] } }`,
the D2 source has a syntax issue. Read the error, fix the source, call
again. Common fixes: quote labels containing `{` `}` `<` `>`, escape
parentheses in node names, ensure block braces are closed.

### Note on `kind: 'svg'`

For raw SVG (`spec.kind: 'svg'`) the same rule applies — pick stroke / fill
/ text colors that contrast with the operator's canvas theme from
`get_board_url`. There's no theme system to lean on; the SVG you author is
what renders.

## Step 6 — Focus

After a successful `draw`, call `focus({ id: <returned id> })`. This pans
and zooms the operator's viewport to the new (or updated) diagram so they
see it without scrolling, even if the canvas already had content elsewhere.

## After drawing

Briefly summarize what you drew or changed (2-3 lines max). Do not list
every node — the operator is looking at it. Invite them to:

- Drag the diagram to reposition (no need to ask permission)
- Add tldraw stickies, freehand notes, or arrows around it
- Select a diagram and ask you to refine — that triggers Mode B on the
  next `/visualize` call.
