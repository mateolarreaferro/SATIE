---
title: Wiki Conventions — how this wiki works
subsystem: meta
sources: []
synced_sha: n/a
synced: 2026-05-30
related: [00-overview.md]
---

# Wiki Conventions

This wiki (`docs/wiki/`) is a **natural-language mirror of the Satie codebase** — the
intermediate representation for humans. Code says *how*; these pages say *what* and
*why*. When an agent (or a person) changes the code, the paired page is updated in the
**same commit**, so the English description never silently drifts from reality.

This is the fourth doc layer in the repo. Keep them distinct — don't duplicate:

| Layer | Role |
|-------|------|
| `CLAUDE.md` | one-screen architecture map + common tasks |
| `.claude/rules/*.md` | **prescriptive** path-scoped constraints (do/don't) |
| `docs/lessons.md`, `docs/claude-handoff.md` | durable lessons + session state |
| **`docs/wiki/`** | **descriptive** mirror of the code + the Satie DSL spec |

---

## The page contract

Every page has frontmatter the freshness gate reads:

```yaml
---
title: Parser — SatieParser.ts (DSL text → Statement[])
subsystem: engine          # engine | dsl | lib | ui | api | data | meta
sources:                   # repo-relative files/globs this page is canonical for
  - src/engine/core/SatieParser.ts
synced_sha: a1b2c3d4e5f6   # content-hash of sources; auto-stamped on commit
synced: 2026-05-30         # date of last sync; auto-stamped
related: [engine.md, ../dsl/grammar.md]
---
```

- **`sources`** is the spine of the whole system. The gate inverts every page's
  `sources` into a `source-file → page(s)` map. A source file may be claimed by more
  than one page (e.g. `SatieParser.ts` is documented by both `engine/parser.md`, the
  *implementation*, and `dsl/grammar.md`, the *language*). That's fine — see the gate
  rules below. Globs (`**`, `*`) are allowed; a page that owns a whole directory should
  use a glob (e.g. `src/ui/hooks/**`) so new files are covered automatically.
- **`synced_sha` / `synced`** are auto-maintained — never hand-edit them. The pre-commit
  hook stamps them when a page is committed alongside its sources.
- Index/overview pages that document no single file use `sources: []`.

## Body sections (keep this order)

1. **Purpose** — one line. The "what".
2. **Why it exists / responsibilities** — what problem this module owns.
3. **Mental model** — how to think about it; an ASCII diagram when it earns its space.
4. **Key types & functions** — the public surface. Reference code as `path:line` so the
   link is clickable (e.g. `src/engine/core/SatieParser.ts:412`).
5. **Data flow** — who calls into this, what it calls out to. Link neighbor pages.
6. **Invariants & gotchas** — the non-obvious rules. Cross-link `docs/lessons.md` entries.
7. **Change checklist** — what else to touch when this changes (mirror CLAUDE.md's
   "Common Tasks" where relevant).
8. **Sources** — bullet list of the files in `sources`.

Write for a competent engineer who has never seen the file. Be concrete and terse;
prefer the codebase's own terms. No emojis (repo convention).

---

## The freshness gate

`scripts/wiki-check.ts` (run via `tsx`) enforces two things:

### Hard rules (block commit / fail CI)

- **Coverage** (`npm run wiki:check`, CI) — every non-test, non-`.d.ts` file under
  `src/**` and `api/**` must be claimed by ≥1 page's `sources`. A new source file with
  no page fails CI until a page adopts it. Pages whose `sources` point at a deleted file
  also fail.
- **Co-staging** (`pre-commit` → `npm run wiki:gate`) — if you stage a change to a
  source file, **at least one** page that covers it must be staged in the same commit.
  The hook then auto-stamps `synced_sha`/`synced` on those pages.

### Soft rule (reports only)

- **Drift** (`npm run wiki:check`, CI) — a page whose `synced_sha` no longer matches its
  sources is reported as possibly stale. Because co-staging only requires *one* covering
  page, a secondary page (e.g. `dsl/grammar.md` when you edited via `engine/parser.md`)
  surfaces here. Review and re-stage it to clear the flag.

### Escapes

- Put `[skip-wiki]` in the commit message for a genuinely doc-irrelevant change
  (rename, formatting, comment typo).
- `git commit --no-verify` bypasses the hook entirely (last resort).

The hook is installed by `scripts/install-hooks.mjs` via the `prepare` npm script
(`git config core.hooksPath .githooks`). It runs automatically after `npm install`.

---

## Adding or splitting a page

1. Create `docs/wiki/<subsystem>/<name>.md` with the frontmatter above.
2. List the source files in `sources` (and remove them from any page that no longer
   owns them — a file can be multiply-covered, but keep ownership intentional).
3. Add a link from the subsystem's `_index.md` and, for top-level pages, `00-overview.md`.
4. Run `npm run wiki:check` — it must pass (full coverage, no dangling sources).
