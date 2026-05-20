#!/usr/bin/env bun
// Bump the plugin version in lockstep across every file that carries a
// literal version string:
//   - package.json (npm-style, also read by server.ts at runtime for the
//     MCP server identifier)
//   - .claude-plugin/plugin.json (what Claude Code's marketplace queries on
//     `/plugin update`)
//   - .codex-plugin/plugin.json (the Codex equivalent)
//
// Usage: bun run bump <new-version>
// Example: bun run bump 0.4.0

const newVersion = Bun.argv[2];
if (!newVersion || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(newVersion)) {
  console.error('usage: bun run bump <semver>  (e.g. 0.4.0 or 0.4.0-rc.1)');
  process.exit(1);
}

const targets = [
  'package.json',
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
];
for (const path of targets) {
  const file = Bun.file(path);
  const json = (await file.json()) as { version?: string };
  const prev = json.version ?? '<unset>';
  json.version = newVersion;
  await Bun.write(path, JSON.stringify(json, null, 2) + '\n');
  console.log(`${path}: ${prev} -> ${newVersion}`);
}
