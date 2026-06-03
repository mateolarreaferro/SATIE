---
title: DSL metadata comments
subsystem: dsl
sources:
  - src/engine/core/SatieParser.ts
synced_sha: 5c222ce67863
synced: 2026-05-31
related: [grammar.md]
---

# DSL metadata comments

## Purpose
How a `.satie` script carries non-audio metadata (currently only the viewport background, `@bg #hexcolor`) as a leading comment the parser deliberately skips while the UI reads it.

## Why it exists / responsibilities
Sketches are stored and shared as their raw script text. Some per-sketch UI state — right now just the author's chosen viewport background color — has no audio meaning, so it can't be a real statement or property. Encoding it as a comment lets the value travel inside the script across save / load / share / embed without the engine ever interpreting it. The parser's only job here is to **not error** on these lines; the actual read/write happens in the UI pages.

## Mental model
The script has two readers with opposite jobs:

```
script text
   │
   ├─► parse()  (engine)   — ignores @bg line, emits no Statement, no warning
   │
   └─► UI pages (regex)    — read @bg → viewport color
                           — write @bg on save (prepend), strip on display
```

The metadata line is canonically a **dash comment**, `- @bg #f0eadf`, written as the very first line of the script. A legacy `# @bg #f0eadf` (hash) form is still recognized on read for older sketches. Both are comment syntaxes the parser drops, so the value is invisible to the audio engine.

## Key types & functions
The parser has **no dedicated metadata API** — it only guarantees these lines are silently dropped. Two paths do that:

- `stripDashComment()` — src/engine/core/SatieParser.ts:149. A full-line dash comment (`trimmed.startsWith('-')`, line 152) returns `null`, so `- @bg …` is removed in pre-pass 0 (the `commentStripped` loop, src/engine/core/SatieParser.ts:1480) before any statement parsing.
- The unrecognised-line guard — src/engine/core/SatieParser.ts:1626. The main loop refuses to warn when `body.startsWith('#') || body.startsWith('@')` (line 1627), so a legacy `# @bg …` line (and any bare `#`/`@` line) is skipped quietly instead of producing `Unrecognised line`.

Note: plain `#` lines are *not* stripped in an early pass like dash comments are; they survive into the main loop and are tolerated only by that warning guard. They never become statements because they don't match `StmtStartRx`, `group`, or the group-prop regex.

The read/write surface lives in the UI (outside this page's `sources`, but this is where the contract is honored):
- Read on load: src/ui/pages/Editor.tsx:379 — `/^- @bg (#[0-9a-fA-F]{6})/m`.
- Write on save: src/ui/pages/Editor.tsx:624-629 — strip existing `- @bg` and legacy `# @bg`, then prepend `- @bg <color>` only when the color differs from `DEFAULT_BG` (`#f4f3ee`).
- Public/embed read with legacy fallback: src/ui/pages/SketchView.tsx:142 and src/ui/pages/Embed.tsx:51 — `/^- @bg …/m ?? /^# @bg …/m`.
- Display strip (so viewers don't see the metadata line): src/ui/pages/SketchView.tsx:293-294.

## Data flow
- **In:** raw script text reaches `parse()` (src/engine/core/SatieParser.ts), which strips/ignores the `@bg` line and produces only audio `Statement[]`. See [grammar](./grammar.md) for the rest of the comment forms (`-` line/inline, `comment`/`endcomment` blocks).
- **Out (UI, not engine):** the same text is regex-scanned by `Editor.tsx`, `SketchView.tsx`, and `Embed.tsx` to recover the viewport color; `Editor.tsx` rewrites the line on save. The engine never sees or sets `@bg`.

## Invariants & gotchas
- **The metadata line must be position-0 of the script.** All UI regexes are anchored multiline (`^…/m`) and the write path *prepends* the line; nothing handles an `@bg` comment that isn't the first matching line. Keep it first.
- **Two syntaxes, one canonical.** New writes use the dash form `- @bg #hex`. The hash form `# @bg #hex` is read-only legacy — don't reintroduce it on write. (CLAUDE.md still documents the older `# @bg` form; the code has since moved to `- @bg`.)
- **The parser's tolerance is incidental, not a feature.** `parse()` doesn't know `@bg` exists — it just happens that dash-comment stripping and the `#`/`@` warning guard both swallow it. If you add a *new* `@`-prefixed metadata key, the parser already won't warn on it (line 1627), but you still need UI code to read/write it.
- **Only a 6-hex color is matched.** The regexes require `#[0-9a-fA-F]{6}`; 3-digit hex, `rgb(...)`, or named colors in an `@bg` comment will be ignored by the UI even though the `background` *property* (src/engine/core/SatieParser.ts:757) accepts those richer forms.
- **`DEFAULT_BG` lines are not persisted.** Saving with the default `#f4f3ee` writes *no* `@bg` line, so a sketch with no metadata comment renders the default everywhere.

## Change checklist
When adding or changing a metadata comment:
1. Decide the syntax (`- @key …` dash form preferred) — it will already pass the parser's no-warn guard, but verify against src/engine/core/SatieParser.ts:1627 and the dash-strip at src/engine/core/SatieParser.ts:152.
2. Add the read regex everywhere a sketch is loaded: `Editor.tsx`, `SketchView.tsx`, `Embed.tsx` (and keep a legacy-form `??` fallback if migrating).
3. Add the write path in `Editor.tsx`'s save (strip-then-prepend), guarding against re-adding the default value.
4. Strip the line from any *displayed* script (`SketchView.tsx`).
5. Update [grammar](./grammar.md) if the new comment changes what authors can write.

## Sources
- src/engine/core/SatieParser.ts
