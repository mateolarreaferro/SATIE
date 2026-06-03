---
title: Satie DSL — language overview
subsystem: dsl
sources: []
synced_sha: pending
synced: 2026-05-30
related: [grammar.md, properties.md, spatial-movement.md, dsp-effects.md, metadata-comments.md, ../engine/parser.md]
---

# Satie DSL — language overview

## Purpose

Satie is a line-oriented plaintext language for spatial-audio composition: each script
declares sound **voices** that play a clip, sit or move in 3D space, and run through a
fixed DSP chain.

## Why it exists / responsibilities

A composition is just text the user types in the Monaco editor (or that the AI emits). The
DSL is the contract between that text and the runtime: it has to be terse enough to write
by hand, regular enough to parse with regex (no AST grammar), and expressive enough to
cover playback timing, 3D position/trajectories, per-parameter interpolation, DSP effects,
and visual hints. This hub page is the author-facing entry point; the sibling spec pages
break out each concern, and [../engine/parser.md](../engine/parser.md) documents the
*implementation* that turns this text into `Statement[]`.

## Mental model

A script is a list of **statements**, one per logical block. A statement is a header line
plus an indented block of `key value` **properties** (snake_case, space-separated — never
`key = value`). The header names the **kind** (`loop` or `oneshot`), a count, the clip, and
an optional `every` cadence; the indented properties refine that voice.

```
loop rain                  <- header: kind=loop, clip=rain
  volume 0.4               <- property: key value
  move spiral 2 8 0.3      <- spatial movement
  reverb 0.5 0.8 0.4       <- DSP effect
  visual trail             <- visual hint

3 * oneshot bird every 4to9   <- 3 voices, fires every 4–9s
  pos 5 2 -3
  pitch 0.9to1.1
```

Three things compose on every voice:

1. **Playback** — what clip, how loud (`volume`), what pitch, when (`every`, `start`,
   `fade_in`/`fade_out`), how many (`N * kind`).
2. **Position** — a static point (`pos`/`fixed`) or a trajectory (`walk`, `fly`, `spiral`,
   `orbit`, `lorenz`, custom/generated). See [spatial-movement.md](./spatial-movement.md).
3. **DSP** — `filter`, `distortion`, `delay`, `reverb`, `eq`, applied in a fixed chain
   order. See [dsp-effects.md](./dsp-effects.md).

Most numeric properties accept three forms: a single value (`0.4`), a sampled range
(`0.4to0.8`), or an interpolation (`goto`/`gobetween`) — see `RangeOrValue` and
`InterpolationData` in [../engine/statement-model.md](../engine/statement-model.md).

## Key types & functions

The DSL's runtime surface is the parser's public API plus the `Statement` it produces:

- `parse(script)` — text → `Statement[]`, the main entry point.
  `src/engine/core/SatieParser.ts:1477`
- `parseWithWarnings(script)` — same, but also returns non-fatal `ParseWarning[]`.
  `src/engine/core/SatieParser.ts:1469`
- `tryParse(script)` — safe variant returning `{ success, statements, errors }`; used by
  AI verify/repair and live editor validation. `src/engine/core/SatieParser.ts:1685`
- `SatieSyntaxError` — thrown on fatal parse errors. `src/engine/core/SatieParser.ts:20`
- `parseSingle(block)` — parses one header+indented block; the `switch` over property
  keywords lives here. `src/engine/core/SatieParser.ts:204`
- `pathFor(clip)` / `sanitizeForClipName(prompt)` — clip-name → asset-path helpers.
  `src/engine/core/SatieParser.ts:179`, `src/engine/core/SatieParser.ts:173`
- `Statement` — the parsed data class every statement becomes; one field per language
  concept. `src/engine/core/Statement.ts:96`
- `WanderType` — the movement enum (`None`/`Walk`/`Fly`/`Fixed`/`Spiral`/`Orbit`/
  `Lorenz`/`Custom`). `src/engine/core/Statement.ts:27`

The header is matched by `StmtRx` (`kind`, `count`, `clip`, `every`) at
`src/engine/core/SatieParser.ts:110`; `gen` voices use `GenRx` at
`src/engine/core/SatieParser.ts:108`. Property dispatch is the `switch` starting at
`src/engine/core/SatieParser.ts:230` (`volume`, `pitch`, `fade_in`, `every`, `overlap`,
`visual`, `move`, `color`, `background`/`bg`, `reverb`, `delay`, `filter`, `distortion`,
`eq`, …). Movement grammar lives in `parseMove` at
`src/engine/core/SatieParser.ts:325`; visuals in `parseVisual` at
`src/engine/core/SatieParser.ts:301`.

Everything is re-exported from `src/engine/index.ts:1` as the public engine API.

## Data flow

- **Authors in:** the Monaco editor ([SatieEditor.tsx](../../../src/ui/components/SatieEditor.tsx))
  feeds raw text to `tryParse` for live validation; the AI pipeline
  (`lib/aiGenerate.ts`) emits text and runs it through `tryParse`/repair.
- **Parser:** `parse` runs ordered pre-passes (dash-comment strip → `and`-expansion →
  `let` variable substitution → multi-clip expansion → trajectory-gen extraction →
  audio-gen extraction → group expansion) before per-statement parsing. Details on
  [../engine/parser.md](../engine/parser.md).
- **Out to:** the resulting `Statement[]` is consumed by `SatieEngine`
  ([../engine/engine.md](../engine/engine.md)) for track lifecycle/scheduling, by
  `DSPChain` ([../engine/dsp.md](../engine/dsp.md)) for effect nodes, by `Trajectories`
  for movement evaluation, and by `OfflineRenderer` for export. Three.js reads live track
  state for the viewport.

Spec siblings: [grammar.md](./grammar.md) (lexical/structural rules),
[properties.md](./properties.md) (per-property reference),
[spatial-movement.md](./spatial-movement.md) (position + trajectories),
[dsp-effects.md](./dsp-effects.md) (effect syntax + chain order),
[metadata-comments.md](./metadata-comments.md) (comments + `@`-metadata).

## Invariants & gotchas

- **Properties are `key value`, never `key = value`.** Space-separated, snake_case in the
  DSL, camelCase on `Statement`.
- **Two kinds only:** `loop` and `oneshot`. There is no `play`/`sound`/`once` keyword —
  the header regex (`StmtRx`) only accepts `loop|oneshot`.
- **Comments are dash (`-`), not `#`.** A line starting with `-`, or a ` - ` mid-line, is
  stripped (`stripDashComment`, `src/engine/core/SatieParser.ts:149`). `#` and `@` lines
  are tolerated (no "unrecognised line" warning) but only `@bg #hex` is meaningful, and
  that metadata is handled at the save/share layer, not by `parse`. See
  [metadata-comments.md](./metadata-comments.md).
- **Standalone flags take no value:** `overlap`, `persistent`, `mute`, `solo`,
  `randomstart`/`random_start`, `loopable` (`src/engine/core/SatieParser.ts:1618`).
- **Indentation is structural:** indented lines belong to the preceding header. The header
  regex captures the indented block as `(?<block>...)`.
- **Numeric props are polymorphic:** single / `XtoY` range / `goto`+`gobetween`
  interpolation all parse into the same field via `RangeOrValue` / `InterpolationData`.
- **AI-generation rules (system prompt, not parser):** moving voices get `visual trail`;
  static voices get `visual sphere`. The parser does not enforce this. See the AI section
  of `CLAUDE.md` and `lib/aiGenerate.ts`.

## Change checklist

When the language surface changes, follow CLAUDE.md "Adding a new Satie property":

1. Add the field to `Statement` (`src/engine/core/Statement.ts`).
2. Add the `case` to the `switch` in `parseSingle()` (`src/engine/core/SatieParser.ts`).
3. Handle it in `SatieEngine.ts` (track creation or per-frame update).
4. Add parser tests in `SatieParser.test.ts`.
5. Add tokenizer + `PROPERTY_DOCS` + completion entries in `SatieEditor.tsx`.
6. Add it to `DocsPanel.tsx`.
7. Update the relevant DSL spec page **and** [../engine/parser.md](../engine/parser.md)
   in the same commit (wiki freshness gate).

## Sources

This is an overview/hub page (`sources: []`). The canonical implementation pages are
[../engine/parser.md](../engine/parser.md) and
[../engine/statement-model.md](../engine/statement-model.md); the DSL spec is split across
[grammar.md](./grammar.md), [properties.md](./properties.md),
[spatial-movement.md](./spatial-movement.md), [dsp-effects.md](./dsp-effects.md), and
[metadata-comments.md](./metadata-comments.md).
