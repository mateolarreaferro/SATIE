---
title: DSL grammar & syntax
subsystem: dsl
sources:
  - src/engine/core/SatieParser.ts
synced_sha: 5c222ce67863
synced: 2026-05-31
related: [_index.md, properties.md, ../engine/parser.md]
---

# DSL grammar & syntax

## Purpose
The author-facing grammar of a `.satie` script: statements, indented `key value` property blocks, groups, `let` variables, multi-clip lines, comments, and gen blocks.

## Why it exists / responsibilities
Satie scripts are plaintext. `parse()` (src/engine/core/SatieParser.ts:1477) turns that text into a flat `Statement[]`. The grammar is whitespace-significant: a statement owns the lines indented beneath it. There are no equals signs — every property is `key` then a space then its value (or, for flags, just `key`). This page describes what is legal to *write*; for how the parsing pipeline runs internally see [parser](../engine/parser.md).

## Mental model
A script is a sequence of top-level constructs. Statements are the spine; everything indented under a statement modifies it.

```
let LOUD 0.8              <- variable (top-level, substituted everywhere)

gen wind                 <- gen block (defines a clip OR a trajectory)
  prompt howling wind
  duration 8

group ambience           <- group: indented props become defaults for children
  volume LOUD            <- group prop (one indent)
    loop wind every 5    <- child statement (deeper indent)
      move walk          <- statement property (deeper still)
      reverb wet 0.4

oneshot crash            <- top-level statement
  volume 0.5
  visual sphere
```

Indentation defines ownership. A statement's property block is every following line more-indented than the statement line (src/engine/core/SatieParser.ts:1549). A group's children are statements more-indented than the `group` line; a group closes when a line returns to the group's indent or hits `endgroup` (src/engine/core/SatieParser.ts:1528).

## Key types & functions
- **Statement line** — `[N *] (loop|oneshot) <clip> [every <t>|<t1>to<t2>]`. Matched by `StmtRx` (src/engine/core/SatieParser.ts:110) and parsed in `parseSingle()` (src/engine/core/SatieParser.ts:204). `kind` is `loop` or `oneshot`; `<clip>` is a single non-space token; `N *` repeats the statement into N voices; `every` sets the retrigger interval (single value or `1to3` range).
- **Property line** — `<key> [value]`, indented under a statement. Dispatched by the `switch` in `parseSingle()` (src/engine/core/SatieParser.ts:229). Standalone flags `overlap`, `persistent`, `mute`, `solo`, `randomstart`/`random_start`, `loopable` take no value (src/engine/core/SatieParser.ts:220). All others take a value: a number, a `min`to`max` range, or a `fade`/`jump` interpolation. See [properties](./properties.md) for the full per-property catalog.
- **`group` / `endgroup`** — open at src/engine/core/SatieParser.ts:1536, props collected at src/engine/core/SatieParser.ts:1613, merged into children by `flushGroup()` (src/engine/core/SatieParser.ts:941). Group props are written at one indent (not double-indented) and act as defaults/multipliers.
- **`let name value` / bare `name value`** — variables, extracted by `extractAndSubstituteVariables()` (src/engine/core/SatieParser.ts:1125). Must be top-level (zero indent). Names cannot be reserved words (`RESERVED_WORDS`, src/engine/core/SatieParser.ts:1102).
- **Multi-clip `and`** — `oneshot bird and rain and lizard every 5` expands to three statements via `expandMultiClip()` (src/engine/core/SatieParser.ts:1200).
- **`comment` / `endcomment`** — block comments stripped by `stripBlockComments()` (src/engine/core/SatieParser.ts:128) and again in the main loop (src/engine/core/SatieParser.ts:1511). Dash comments (`- ...` full line, or ` - ` inline) stripped by `stripDashComment()` (src/engine/core/SatieParser.ts:149).
- **`gen <name>` blocks** — audio gen via `extractGenBlocks()` (src/engine/core/SatieParser.ts:1280); trajectory gen via `extractTrajectoryGenBlocks()` (src/engine/core/SatieParser.ts:1371).
- **Inline `gen`** — `loop gen <prompt> every 5` rewritten by `preprocessGen()` (src/engine/core/SatieParser.ts:189) / `GenRx` (src/engine/core/SatieParser.ts:108).
- **Entry points** — `parse()` (throws on error), `parseWithWarnings()` (src/engine/core/SatieParser.ts:1469), `tryParse()` (src/engine/core/SatieParser.ts:1685, never throws). Errors are `SatieSyntaxError` (src/engine/core/SatieParser.ts:20).

### Statement syntax
```
loop rain every 5
2 * oneshot bird every 2to6
loop drone
```
`every` accepts a single number or a `2to6` range. The count prefix `N *` clones the statement (for gen statements each clone gets a `_1`, `_2` clip suffix, src/engine/core/SatieParser.ts:1566).

### Property blocks (no equals, space-separated)
```
loop wind every 8
  volume 0.6
  pitch 0.9to1.1
  fade_in 2
  move walk
  reverb wet 0.4 size 0.7
  visual trail
  overlap
```
Property names are snake_case (`fade_in`, `random_start`). Values may be static (`0.6`), ranges (`0.9to1.1`, each voice samples independently), or interpolations (`volume fade 0 1 every 4`). Flag properties (`overlap`) appear alone on the line.

### Groups
```
group rainforest
  volume 0.7
  reverb wet 0.5
    loop rain every 4
    loop birds every 6
      pitch 1.2
```
Group props are written at one indent under `group <name>`; children are indented deeper. In `flushGroup()`, group `volume`/`pitch` *multiply* into each child's own value, group `color`/`move`/`visual`/DSP apply only as defaults when the child lacks its own (src/engine/core/SatieParser.ts:1008). If both group and child have a `fade`/`jump` modulation, the group's is stored as a separate modulator rather than overwriting (src/engine/core/SatieParser.ts:980).

### Variables
```
let LOUD 0.8
QUIET 0.2

loop drone
  volume LOUD
oneshot tap
  volume QUIET
```
Both `let NAME value` and bare `NAME value` (top-level only) define a variable; the bare form is rejected if `NAME` is a reserved word. References are substituted by word boundary everywhere except the clip-name slot of a statement line, which is protected (src/engine/core/SatieParser.ts:1170).

### Multi-clip
```
oneshot bird and rain and lizard every 5
loop gen wind and gen rain every 4
```
Each `and`-separated segment must be a single word (plain clip) or start with `gen ` — otherwise the line is left untouched (src/engine/core/SatieParser.ts:1237). The shared `every` clause and indented property block are copied onto every expanded statement.

### Comments
```
comment
  this whole block is ignored
endcomment

loop rain   - inline dash comment
- full-line dash comment
# @bg #101820   (hash + @ metadata: ignored by parser, no warning)
```
`comment`/`endcomment` fence multi-line comments. A line starting with `-` is dropped; ` - ` (space-dash-space) starts an inline comment **unless** the text after the dash begins with a digit (so `x -5to5` is safe) (src/engine/core/SatieParser.ts:149). `#`/`@` lines are silently ignored.

### Gen blocks
Audio gen — defines a generatable clip referenced by name:
```
gen wind
  prompt howling arctic wind
  duration 8
  influence 0.4
  loopable

loop wind every 6
```
`prompt` is required (src/engine/core/SatieParser.ts:1322); `duration` is clamped 0.5–22 s, `influence` 0–1, `loopable` is a flag.

Trajectory gen — same `gen <name>` header, distinguished by trajectory-only keywords (`smoothing`/`smooth`, `resolution`, `seed`, `ground`, `variation`) (src/engine/core/SatieParser.ts:1379):
```
gen swoop
  prompt fast descending arc
  smoothing 0.3
  resolution 8192

loop bird move swoop
```
A statement's `move <name>` is later matched to a trajectory gen def in `applyTrajGenDef()` (src/engine/core/SatieParser.ts:1645).

Inline gen — prompt lives on the statement line:
```
loop gen distant thunder every 10
```

## Data flow
`parse()` runs ordered pre-passes (src/engine/core/SatieParser.ts:1477): strip dash comments → `expandAndSeparators` → `extractAndSubstituteVariables` → `expandMultiClip` → `extractTrajectoryGenBlocks` → `extractGenBlocks`, then the main statement/group loop, then `applyTrajGenDef`. Callers: the editor calls `parseWithWarnings`; the engine and AI repair path call `tryParse`. Output `Statement[]` is consumed by `SatieEngine`. Field-level meaning of each property lives in [properties](./properties.md); the pipeline mechanics and regex internals are in [parser](../engine/parser.md).

## Invariants & gotchas
- **No equals signs.** Always `key value`. An unknown property emits a "did you mean?" warning via Levenshtein against `KNOWN_PROPERTIES` (src/engine/core/SatieParser.ts:276); it does not throw.
- **Indentation is ownership.** Under-indenting a property detaches it from its statement; over-indenting a child past the group makes it a child rather than a group prop.
- **`and` is overloaded.** `expandAndSeparators` (src/engine/core/SatieParser.ts:1063) only splits ` and <word>` when `<word>` is a property keyword — so `visual trail and sphere` keeps `and` literal (sphere is a visual token, not a property), but `move walk and reverb wet 0.5` splits into two property lines.
- **`every` value is one token.** In multi-clip expansion the `every` clause is matched as `every <single-token>` (src/engine/core/SatieParser.ts:1222), so `every 5` / `every 2to6` work but a spaced value would not be captured.
- **Gen blocks cannot live inside groups** — throws (src/engine/core/SatieParser.ts:1520).
- **Gen `duration` is generation length, not playback length.** For gen statements a property-block `duration` is promoted to `genDuration` and cleared (src/engine/core/SatieParser.ts:1672).
- **Variables are top-level only** and substituted by whole-word match; a variable named like a substring of a clip won't corrupt the clip name (clip slot is protected).
- **`starts_at` is a legacy alias for `start`** (src/engine/core/SatieParser.ts:238); `mode <x>` filter/distortion syntax is the legacy form of the direct `filter lowpass …` form (src/engine/core/SatieParser.ts:886).
- **Duplicate gen names**: last definition wins, with a console warning (src/engine/core/SatieParser.ts:1345).

## Change checklist
When adding or changing grammar:
1. New property → add the `case` in `parseSingle()` switch (src/engine/core/SatieParser.ts:229) and add the name to `KNOWN_PROPERTIES` (src/engine/core/SatieParser.ts:58); add to `PROPERTY_KEYWORDS` (src/engine/core/SatieParser.ts:1050) if it should split on `and`.
2. New standalone flag → add to the `STANDALONE_FLAGS` sets (src/engine/core/SatieParser.ts:220 and 1618).
3. New keyword that must not be a variable name → add to `RESERVED_WORDS` (src/engine/core/SatieParser.ts:1102).
4. Group inheritance → mirror the property in `flushGroup()`'s defaults switch (src/engine/core/SatieParser.ts:1009).
5. Add the field to `Statement.ts`, wire it in `SatieEngine.ts`, add tests in `SatieParser.test.ts`, and update [properties](./properties.md) + the editor's docs/completion.

## Sources
- src/engine/core/SatieParser.ts
