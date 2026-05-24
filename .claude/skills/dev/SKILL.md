---
name: dev
description: Orchestrate a dev → test loop for the visualize plugin inside a worktree. Operator passes a plan; the skill delegates implementation to the `dev` subagent, bumps the plugin version, then spawns a headless `tester` subagent that opens the canvas in Chrome and verifies an acceptance criterion. Reports a one-line PASS/FAIL.
---

# /dev — visualize plugin dev loop (v0)

You are the **orchestrator**. Coordinate the `dev` and `tester` subagents (defined in `.claude/agents/dev.md` and `.claude/agents/tester.md`) against the current worktree. **Do not implement the change yourself.** Delegate, then report.

Hardcoded for the `visualize` plugin in this repo: `bun run bump <ver>` and `bun run build:web` must work.

## Input

`$ARGUMENTS` is the plan — free-form text describing what to build. If empty, ask the operator for one and stop.

## Steps

### 1. Pre-flight

- If `pwd` is not under `.claude/worktrees/`, call `EnterWorktree` to create one. All subsequent steps run there.
- Read `.claude-plugin/plugin.json`. Capture `BASE_VERSION` — strip any trailing `-dev.*` suffix so repeated runs don't compound suffixes.
- Capture `WT_SLUG = $(basename "$PWD")`.
- Use TaskCreate for the four phases (Dev, Bump+Build, Test, Report) so the operator sees progress.

### 2. Dev phase

Invoke the `dev` subagent via the Agent tool:

```
Agent({
  subagent_type: "dev",
  description: "implement plan in worktree",
  prompt: "<the plan from $ARGUMENTS, verbatim>"
})
```

The dev subagent's contract (defined in `.claude/agents/dev.md`) returns three lines:

    CHANGED_FILES: ...
    SUMMARY: ...
    ACCEPTANCE: ...

Parse all three. If parsing fails or the agent reports it couldn't do the work, stop and report.

### 3. Bump + build

```bash
NEW_VERSION="${BASE_VERSION}-dev.${WT_SLUG}.$(date +%s)"
bun run bump "$NEW_VERSION" && bun run build:web
```

If either fails, stop and report.

### 4. Test phase

Spawn the tester headlessly so it loads the worktree's plugin fresh via `--plugin-dir`:

```bash
claude --bg --agent tester --plugin-dir . --permission-mode bypassPermissions "ACCEPTANCE: <ACCEPTANCE line from dev>
VERSION: $NEW_VERSION"
```

Parse the job id from the `backgrounded · <id>` line (strip ANSI: `sed -E 's/\x1b\[[0-9;]*m//g'`).

Poll `~/.claude/jobs/<id>/state.json` every 5 seconds, up to 5 minutes. Wait for `state` ∈ {`done`, `failed`, `needs_input`}. Read `.output.result` (fall back to `.detail`).

### 5. Report + cleanup

`claude rm <id>` (unless the test timed out — leave the job for inspection).

Print a markdown summary to the operator:

| Field | Value |
|---|---|
| Worktree | `<cwd>` |
| Version | `<NEW_VERSION>` |
| Changed files | `<CHANGED_FILES>` |
| Dev summary | `<SUMMARY>` |
| Acceptance | `<ACCEPTANCE>` |
| Test verdict | `<the PASS/FAIL line>` |

End with `result: <verdict line>` on its own line.

Do NOT exit the worktree — operator may want to iterate or merge.

## Failure modes (v0 — no auto-retry)

- Dev subagent fails or doesn't return the 3-line contract: report and stop.
- Build/bump fails: report and stop.
- Test agent times out (>5 min): report `INCONCLUSIVE - test agent timed out`, leave the job, don't `claude rm`.
- Test agent reports FAIL: surface the verdict. Operator decides next.

## Notes

- `--plugin-dir .` takes precedence over inherited `.claude/settings.local.json` (verified 3-for-3). No file-shuffling needed.
- Chrome is shared across all sessions on this machine. Parallel `/dev` invocations will race on Chrome tabs — serialize for now.
- The version badge top-right of the canvas is the load-bearing fingerprint that proves the worktree's plugin loaded. Don't remove it from `scripts/build-web.ts`.
