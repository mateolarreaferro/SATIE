# GitHub Copilot instructions

Full project guide: `CLAUDE.md` / `AGENTS.md`. The most important standing rule:

## Keep the wiki in sync with the code

`docs/wiki/` is a natural-language mirror of the codebase + the Satie DSL. Each page
declares the source files it documents in its `sources:` frontmatter.

**When you change any file under `src/**` or `api/**`, update its covering `docs/wiki/`
page in the same change.**

- Find the page with `npm run wiki:gate` (it names the page) or by searching `docs/wiki/**`
  for the file path in a `sources:` block.
- A new source file must be added to some page's `sources:`, or `npm run wiki:check` (CI)
  fails with "no wiki page".
- Follow `docs/wiki/_conventions.md`. Never hand-edit `synced_sha`/`synced`.
- Pure rename/formatting only? Use `[skip-wiki]` in the commit message.

A pre-commit hook (`npm run wiki:gate`) and CI (`npm run wiki:check`) enforce this.

## Other essentials

- `src/engine/` is a pure Web Audio runtime — never import React there.
- UI uses inline styles + theme tokens (`useTheme()`), never hardcoded hex. No emojis.
- Run `npm run build` and `npm run test` (Vitest) before finishing.
