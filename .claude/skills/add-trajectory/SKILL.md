---
name: add-trajectory
description: Add a new built-in trajectory type for spatial movement
---

Add the trajectory type: $ARGUMENTS

Follow these steps:
1. Add the enum value to `WanderType` in `src/engine/core/Statement.ts`
2. Add the evaluation function in `src/engine/spatial/Trajectories.ts` (analytical for simple math, LUT for complex/chaotic)
3. Register it in the `TRAJECTORY_REGISTRY` and `BUILTIN_NAMES` in `Trajectories.ts`
4. Add the parser case in `parseMove()` in `src/engine/core/SatieParser.ts`
5. The engine handles trajectory evaluation generically via `Trajectories.evaluate()` — no engine changes needed
6. Add parser tests in `src/engine/core/__tests__/SatieParser.test.ts`
7. Run `npm run test` to verify all tests pass
