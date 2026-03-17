---
name: add-effect
description: Add a new DSP effect to the Satie audio engine
---

Add the DSP effect: $ARGUMENTS

Follow these steps:
1. Add the params interface to `src/engine/core/Statement.ts` (follow `ReverbParams` as template)
2. Create the Web Audio node chain in `src/engine/dsp/DSPChain.ts` (follow `createReverb` as template)
3. Wire it into the chain order in `buildDSPChain()` in `DSPChain.ts`
4. Add the parser function in `src/engine/core/SatieParser.ts` (follow `parseReverb` as template)
5. Add the parser case in `parseSingle()` switch
6. Add parser tests in `src/engine/core/__tests__/SatieParser.test.ts`
7. Add DSP tests in `src/engine/dsp/__tests__/DSPChain.test.ts`
8. Run `npm run test` to verify all tests pass
