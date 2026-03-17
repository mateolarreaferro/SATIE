---
paths:
  - "src/engine/core/SatieParser.ts"
  - "src/engine/core/__tests__/SatieParser.test.ts"
---
# Parser Rules

- SatieParser.ts is ~1500 lines of regex-based parsing. When adding new properties:
  1. Add the case to the switch in parseSingle()
  2. Property names use snake_case in the DSL but camelCase in TypeScript
  3. Always add corresponding test cases in SatieParser.test.ts
- Satie DSL properties are `key value` (space-separated, no equals signs)
- Standalone flags (overlap, persistent, mute, solo, randomstart, loopable) take no value
