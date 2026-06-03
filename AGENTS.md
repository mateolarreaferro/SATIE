# AGENTS.md — instructions for AI coding agents

Cross-tool agent guide (Cursor, Codex, Aider, Zed, Jules, and any agent that reads
`AGENTS.md`). Claude Code reads `CLAUDE.md` and `.claude/rules/`; the full project guide
lives in **`CLAUDE.md`** — read it.

## The one rule you must not skip: keep the wiki in sync

`docs/wiki/` is a **natural-language mirror of the codebase + the Satie DSL** — the
human-readable description of what every part of the system does. It only stays useful if
it never drifts from the code.

**When you change any file under `src/**` or `api/**`, update its covering wiki page in the
SAME commit.**

- Each wiki page lists the source files it documents in its `sources:` frontmatter. To
  find the page for a file you touched, run `npm run wiki:gate` — it names the exact page
  to edit — or search `docs/wiki/**` for the file path in a `sources:` block.
- **New source file?** Add it to the best-fit page's `sources:`, or `npm run wiki:check`
  (and CI) will fail with "no wiki page".
- Follow the page template + frontmatter contract in `docs/wiki/_conventions.md`.
- Never hand-edit `synced_sha` / `synced` — a pre-commit hook stamps them automatically.
- Genuinely doc-irrelevant change (pure rename, formatting, comment typo)? Put
  `[skip-wiki]` in the commit message. Do not abuse it for behavior changes.

This is enforced: a pre-commit hook (`npm run wiki:gate`) blocks a commit that changes a
source file without touching its wiki page, and CI runs `npm run wiki:check` (coverage is
a hard fail). The hook is the backstop — update the page proactively as you edit, so you
are never surprised at commit time.

Start at `docs/wiki/00-overview.md`; the contract is `docs/wiki/_conventions.md`.

## Other essentials (see CLAUDE.md for detail)

- `npm run build` (tsc + vite), `npm run test` (258 tests, Vitest), `npm run wiki:check`.
- Engine (`src/engine/`) is pure Web Audio — never import React there.
- UI uses inline styles + theme tokens (`useTheme()`), never hardcoded hex. No emojis.
- Satie DSL: `key value` (no `=`), snake_case in the language, camelCase in TypeScript.
