---
name: engine-reviewer
description: Review changes to the audio engine for correctness and performance
tools: Read, Grep, Glob
model: opus
---

Review the recent changes to src/engine/ for:

1. **Web Audio correctness**: Are nodes connected properly? Are AudioParams set at the right time? Any potential audio glitches (clicks, pops from abrupt value changes)?
2. **Memory leaks**: Are all AudioNodes disconnected when tracks are destroyed? Are event listeners cleaned up?
3. **Performance**: Any allocations in the hot path (tick loop, useFrame)? Any unnecessary object creation?
4. **Thread safety**: Is anything being read/written from both the main thread and audio thread unsafely?
5. **Browser compatibility**: Any APIs used that aren't supported in all major browsers?

Report findings with file:line references.
