---
title: Parser — SatieParser.ts (script text -> Statement[])
subsystem: engine
sources:
  - src/engine/core/SatieParser.ts
synced_sha: 98547660c0db
synced: 2026-06-03
related: [engine.md, statement-model.md, ../dsl/grammar.md]
---

## Purpose

Turns a `.satie` script (plaintext) into an array of `Statement` objects via a sequence of line-level pre-passes plus a regex-driven per-statement parser.

## Why it exists / responsibilities

The parser is the single front door between user/AI-authored script text and the audio engine. It owns:

- **Lexical cleanup** — strip dash comments and `comment`/`endcomment` blocks.
- **Syntactic sugar expansion** — `and` separators, `let`/bare variables, multi-clip `and` fan-out.
- **Block extraction** — trajectory gen blocks and audio gen blocks are lifted out before statement parsing.
- **Group inheritance** — `group`/`endgroup` props flow into children as defaults/multipliers.
- **Per-statement parsing** — the `parseSingle()` regex + property switch builds each `Statement`.
- **Diagnostics** — fatal `SatieSyntaxError` (throws) and non-fatal `ParseWarning` (collected) including "did you mean?" property suggestions.

It is pure (no React, no Web Audio). It only constructs `Statement` data objects; the engine interprets them.

## Mental model

Think of `parse()` as a pipeline of line-array transforms, then a stateful line scanner that emits statements. Each pre-pass takes `string[]` and returns `string[]` (or pulls a map of definitions out to the side):

```
script text
  └─ stripDashComment        (per line; '-' line / ' - ' inline)
  └─ expandAndSeparators     ` and <keyword>` → indented prop lines
  └─ extractAndSubstituteVars `let x v` / bare `x v` → substitute refs
  └─ expandMultiClip         `oneshot a and b` → two statements
  └─ extractTrajectoryGenBlocks  `gen <name>` w/ traj keywords → trajGenDefs
  └─ extractGenBlocks        remaining `gen <name>` → genDefs (audio)
  └─ main scan loop ─────────────────────────────────────────────┐
       comment blocks, group open/close, statement headers,      │
       indented property blocks → parseSingle() → Statement      │
  └─ flushGroup (inheritance) + applyTrajGenDef (post-pass) ──────┘
       → Statement[]
```

Key idea: **structure is decided by indentation and leading keywords on lines; values are decided by regexes inside `parseSingle()` and the `parseX` helpers.** Block comments are stripped twice — once globally inside `parseSingle` on the captured block, and once line-wise in the main loop.

## Key types & functions

Public surface (exported):

- `parse(script): Statement[]` — main entry. Runs all pre-passes then the scan loop. src/engine/core/SatieParser.ts:1477
- `parseWithWarnings(script): ParseResult` — wraps `parse`, returns `{ statements, warnings }`. Preferred for editor integration; resets the module-level warning collector. src/engine/core/SatieParser.ts:1469
- `tryParse(script): { success, statements, errors }` — try/catch wrapper; returns the error message instead of throwing. Used by AI verify/repair. src/engine/core/SatieParser.ts:1685
- `SatieSyntaxError` — Error subclass carrying `propertyName`, `invalidValue`, `sourceLine`, `lineNumber`. src/engine/core/SatieParser.ts:20
- `ParseWarning` / `ParseResult` interfaces. src/engine/core/SatieParser.ts:42, src/engine/core/SatieParser.ts:49
- `sanitizeForClipName(prompt)` — slugifies a gen prompt to a clip name (lowercases, replaces unsafe chars, caps at 30 chars). src/engine/core/SatieParser.ts:173
- `pathFor(clip)` — normalizes a clip path under `Audio/`. src/engine/core/SatieParser.ts:179

Internal core:

- `parseSingle(block): Statement` — matches `StmtRx`, fills `kind`/`clip`/`count`/`every`, then runs the property `switch`. The thing you extend when adding a property. src/engine/core/SatieParser.ts:204
- `StmtRx` — the statement-header + indented-block regex (`loop|oneshot`, clip, optional `every`, block capture). src/engine/core/SatieParser.ts:110
- `PropRx` / inline `propRx` — `^[ \t]*(?<key>\w+)(?:[ \t]+(?<val>...))?` matched globally over the property block. src/engine/core/SatieParser.ts:114, src/engine/core/SatieParser.ts:223
- `STANDALONE_FLAGS` — keys that take no value (`overlap`, `persistent`, `mute`, `solo`, `randomstart`/`random_start`, `loopable`). src/engine/core/SatieParser.ts:220
- `KNOWN_PROPERTIES` + `suggestProperty` (Levenshtein ≤2) — power the unknown-property "did you mean?" warning. src/engine/core/SatieParser.ts:58, src/engine/core/SatieParser.ts:86

Property parsers (one per complex property, all mutate the passed `Statement`):

- `parseEnd` (time + `fade`), src/engine/core/SatieParser.ts:292
- `parseVisual` (`trail`/`sphere`/`cube`/`none` + `size N`), src/engine/core/SatieParser.ts:301
- `parseMove` (largest helper: semantic archetype verbs `static`/`drift`/`dart`/`pass`/… matched first, then legacy comma syntax, `gen`, builtin `spiral`/`orbit`/`lorenz`, custom registry names, flexible `walk`/`fly`/axis syntax, pending custom names), src/engine/core/SatieParser.ts:325
- `parsePlace` / `parseSemanticMove` — the semantic placement/motion layer; resolve `place`/`move` words to `areaMin`/`areaMax` + `wanderType` via `spatial/Placement.ts` (see [spatial-movement](../dsl/spatial-movement.md)). src/engine/core/SatieParser.ts
- `parseColor` (modulation, named-channel, hex, RGB, named) + `parseColorChannel`, src/engine/core/SatieParser.ts:694, src/engine/core/SatieParser.ts:798
- `parseBackground`, src/engine/core/SatieParser.ts:758
- `parseReverb` / `parseDelay` / `parseFilter` / `parseDistortion` / `parseEQ` — all built on `parseDSPParam` (RangeOrValue or InterpolationData per sub-param). src/engine/core/SatieParser.ts:844, src/engine/core/SatieParser.ts:852

Pre-passes & block extraction:

- `stripDashComment` src/engine/core/SatieParser.ts:149, `stripBlockComments` src/engine/core/SatieParser.ts:128
- `expandAndSeparators` (`PROPERTY_KEYWORDS`-gated `and` split) src/engine/core/SatieParser.ts:1063, src/engine/core/SatieParser.ts:1050
- `extractAndSubstituteVariables` (`RESERVED_WORDS`-gated, protects clip names) src/engine/core/SatieParser.ts:1125, src/engine/core/SatieParser.ts:1102
- `expandMultiClip` src/engine/core/SatieParser.ts:1200
- `extractTrajectoryGenBlocks` (differentiated by `TRAJ_KEYWORDS`) src/engine/core/SatieParser.ts:1371
- `extractGenBlocks` (audio gen) src/engine/core/SatieParser.ts:1280
- `flushGroup` (group → child inheritance/multiply) src/engine/core/SatieParser.ts:941
- `preprocessGen` (inline `loop/oneshot gen <prompt>` rewrite) src/engine/core/SatieParser.ts:189
- `applyTrajGenDef` / `promoteGenDuration` / `copyGenPropsFromStatement` (post-pass helpers) src/engine/core/SatieParser.ts:1645, src/engine/core/SatieParser.ts:1672, src/engine/core/SatieParser.ts:1661

## Data flow

In: raw script string. Callers include the editor (live validation via `parseWithWarnings`), the engine when loading a script, and the AI pipeline (`tryParse` inside verify/repair).

Out: `Statement[]`. Each `Statement` is then consumed by [engine](./engine.md) for track creation/scheduling. The shape of a `Statement` is documented in [statement model](./statement-model.md); the user-facing language those statements mirror is in [DSL grammar](../dsl/grammar.md).

Calls out to sibling engine modules:

- `RangeOrValue` — every numeric value/range (`parse`, `single`, `range`, `mul`, `sample`, `Null`, `One`).
- `InterpolationData` — anything with `fade`/`jump` modulation; `ModulationType`, `LoopMode`.
- `Statement`, `GenDefinition`, `TrajectoryGenDefinition`, `WanderType`, and the DSP param interfaces (`ReverbParams`, etc.) from `Statement.ts`.
- `isTrajectoryName` / `isBuiltinTrajectory` from `spatial/Trajectories` — used by `parseMove` to resolve custom-trajectory names against the registry.

## Invariants & gotchas

- **Pre-pass order is load-bearing.** `parse()` runs: dash comments → `and` expansion → variable substitution → multi-clip expansion → trajectory gen extraction → audio gen extraction → scan. Trajectory gen MUST run before audio gen because both match the same `gen <name>` header (`GenBlockRx` == `TrajGenBlockRx`); trajectory blocks are distinguished only by containing one of `TRAJ_KEYWORDS` (`smoothing`/`smooth`/`resolution`/`seed`/`ground`/`variation`). Non-trajectory blocks are pushed back into `remaining` for audio gen to pick up. src/engine/core/SatieParser.ts:1498
- **Two notions of `duration` for gen voices.** For gen statements, `promoteGenDuration` moves a property-block `duration` into `genDuration` (generation length) and clamps to 0.5–22s; playback `duration` is cleared. Audio-gen-block `duration` is clamped the same way in `extractGenBlocks`. Don't assume `s.duration` is playback length on a gen voice. src/engine/core/SatieParser.ts:1672
- **`and` is overloaded.** `expandAndSeparators` only splits `and` when the following word is in `PROPERTY_KEYWORDS` (so `visual trail and sphere` keeps `and` literal). `expandMultiClip` separately fans out `oneshot a and b` into multiple statements, but only if every segment is a single word or starts with `gen ` — otherwise the line is left intact (protects multi-word gen prompts containing "and").
- **Variable substitution protects clip names.** In `extractAndSubstituteVariables`, on statement lines the clip token is sliced out and only the remainder is substituted, so a variable named the same as a clip won't clobber it. Variable names can't be `RESERVED_WORDS`; bare `name value` at top level is treated as a variable definition.
- **`parseMove` has many branches and a fallthrough.** Semantic archetype verbs are matched first (via `isSemanticMotion`); otherwise unrecognized leading words become a *pending* `WanderType.Custom` with `customTrajectoryName` set, which the post-pass `applyTrajGenDef` later binds to a trajectory gen def if one matches. Only the explicit-axis path with no recognizable axes/name throws. Prefer the semantic `place` over raw `walk`/`fly` xyz bounds (the project's "no xyz bounds" script-style memory is now served by `place`).
- **Modulation detection is a substring test.** `hasModulation(v)` just checks for the words `fade` or `jump`. A value containing those triggers the `InterpolationData` path instead of `RangeOrValue`.
- **Warnings use a module-level collector.** `_parseWarnings` is global state reset by `parseWithWarnings`. Calling bare `parse()` does not clear it; only `parseWithWarnings` brackets it. Unknown properties add a warning (with line `-1` from inside `parseSingle`, since the block-relative line isn't known there).
- **Gen blocks are illegal inside groups** — the scan loop throws if a `gen <name>` header appears while a group is open. src/engine/core/SatieParser.ts:1520
- **Group props are defaults, except volume/pitch/color which combine.** `flushGroup` multiplies group volume/pitch into children (sampling per child for unique randoms), nests modulation as a separate `groupVolumeModulation`/`groupPitchModulation` when the child also modulates, and applies everything else only when the child's field is still null.
- **`#`/`@` lines are silently ignored** by the scan loop (no "unrecognised line" warning); `# @bg #hex` metadata is handled elsewhere, not by the parser switch.

## Change checklist

When adding a new property (see also `.claude/rules/parser.md` and the `add-property` skill):

1. Add the field to `Statement` in `Statement.ts` (camelCase; DSL key is snake_case).
2. Add the `case` to the `switch` in `parseSingle()`. src/engine/core/SatieParser.ts:229
3. Add the key to `KNOWN_PROPERTIES` so it isn't flagged as a typo. src/engine/core/SatieParser.ts:58
4. If it takes no value, add it to both `STANDALONE_FLAGS` sets (in `parseSingle` and the group property handler). src/engine/core/SatieParser.ts:220, src/engine/core/SatieParser.ts:1618
5. If it should be `and`-splittable, add it to `PROPERTY_KEYWORDS`. src/engine/core/SatieParser.ts:1050
6. If the name collides with a possible variable, add it to `RESERVED_WORDS`. src/engine/core/SatieParser.ts:1102
7. If it should be inheritable from a `group`, add a `case` in `flushGroup`'s per-property loop. src/engine/core/SatieParser.ts:1009
8. Handle it in `SatieEngine.ts` (track creation or per-frame update).
9. Add parser tests in `SatieParser.test.ts`; update editor tokenizer/docs and `DocsPanel.tsx`.
10. Update [DSL grammar](../dsl/grammar.md) and this page in the same commit (wiki gate).

For a new DSP effect, add a `parseX` built on `parseDSPParam` and a `case` in the switch; for a new trajectory, extend `parseMove`'s branch handling and `WanderType`.

## Sources

- src/engine/core/SatieParser.ts
