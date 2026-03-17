---
name: add-property
description: Add a new property to the Satie DSL (parser + engine + tests)
---

Add the Satie DSL property: $ARGUMENTS

Follow these steps:
1. Add the field to the `Statement` class in `src/engine/core/Statement.ts`
2. Add the parsing case to the `switch` in `parseSingle()` in `src/engine/core/SatieParser.ts`
3. Handle the property in `src/engine/core/SatieEngine.ts` (track creation or per-frame update as appropriate)
4. Add parser tests in `src/engine/core/__tests__/SatieParser.test.ts`
5. Run `npm run test` to verify all tests pass
