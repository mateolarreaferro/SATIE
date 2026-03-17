---
paths:
  - "src/engine/**"
---
# Engine Development Rules

- NEVER import React or any UI library in engine code. The engine must remain a standalone Web Audio runtime.
- All DSP parameters must support RangeOrValue (static values AND ranges).
- When adding new properties, they must support interpolation via InterpolationData where it makes musical sense.
- Run `npm run test` after any engine changes.
- PannerNode position updates are rate-limited to 30fps — don't bypass this.
- Track state is mutated in-place to minimize GC pressure — don't create new objects in the tick loop.
