---
paths:
  - "docs/wiki/**"
  - "src/**"
  - "api/**"
---
# Wiki Rules — the natural-language mirror

`docs/wiki/` is the descriptive, plain-English mirror of the codebase + Satie DSL. It is
kept in sync with the code by a commit gate (`scripts/wiki-check.ts`).

- **When you change a source file under `src/**` or `api/**`, update its covering wiki
  page in the SAME commit.** Find the page via its `sources:` frontmatter (or run
  `npm run wiki:gate` — it names the page to edit). A pre-commit hook blocks otherwise.
- **New source file?** Add it to the best-fit page's `sources:` list, or the coverage
  check (`npm run wiki:check`, CI) fails.
- Follow the page contract in `docs/wiki/_conventions.md` (frontmatter + section order).
- Never hand-edit `synced_sha` / `synced` — the hook auto-stamps them.
- Genuinely doc-irrelevant change (rename, formatting)? Put `[skip-wiki]` in the commit
  message. Don't abuse it for behavior changes.
- Keep the wiki **descriptive**; keep prescriptive do/don't rules in `.claude/rules/`.
