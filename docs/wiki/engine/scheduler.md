---
title: Scheduler & Clock
subsystem: engine
sources:
  - src/engine/core/SatieScheduler.ts
  - src/engine/core/SatieDSPClock.ts
synced_sha: 7638f14216ac
synced: 2026-05-31
related: [engine.md]
---

# Scheduler & Clock

## Purpose

Sample-accurate event timing for the engine: a monotonic clock built on
`AudioContext.currentTime` plus a sorted timeline that fires queued audio events when
their scheduled sample is due.

## Why it exists / responsibilities

The engine drives playback, stops, fades, and loops at specific future times. Two small
classes own that timing so the rest of the engine doesn't poll wall-clock or scan every
track each frame:

- **`SatieDSPClock`** — the single source of truth for "what time is it" in both seconds
  and samples, anchored to an `AudioContext`. It replaces the C# port's
  `AudioSettings.dspTime`.
- **`SatieScheduler`** — a priority queue (kept as a sorted array) of `SatieAudioEvent`s.
  It hands the engine each event whose `scheduledSample` has passed, and lets the engine
  cancel a track's pending events on the fly.

The design goal is O(1) access to the next-due event instead of iterating the whole
event set every tick.

## Mental model

Think of one timeline sorted earliest-first. The clock advances; each tick the scheduler
pops everything off the front whose time has arrived and runs its callback.

```
clock.currentSample ─┐
                     ▼
timeline:  [ e0 ][ e1 ][ e2 ][ e3 ] ...   (sorted by scheduledSample asc)
            <= now  <= now   > now
            \____ consumed ___/  splice(0, consumed)   ← fired this tick
```

Inserts land via binary search (so the array stays sorted); consumes always come off the
front. The clock itself is just `ctx.currentTime - startTime`, so "now" is whatever the
Web Audio hardware clock says, scaled to samples by `sampleRate`.

## Key types & functions

**Clock** — `src/engine/core/SatieDSPClock.ts`

- `new SatieDSPClock(ctx)` (`src/engine/core/SatieDSPClock.ts:10`) — wraps an
  `AudioContext`. No time elapses until `start()`.
- `currentTime` (`:14`) — seconds since `start()`; `0` before started.
- `currentSample` (`:18`) — `floor(currentTime * sampleRate)`. The scheduler's notion of
  "now".
- `absoluteTime` (`:22`) — raw `ctx.currentTime` (un-offset), for scheduling native Web
  Audio params.
- `sampleRate` (`:26`) — from the context.
- `start()` (`:30`) — sets `startTime = ctx.currentTime`, flips `started = true`.
- `reset()` (`:35`) — re-anchors `startTime` to now (note: does **not** clear `started`).
- `secondsToSamples(s)` / `samplesToSeconds(n)` (`:39`, `:43`) — conversions.
- `getScheduledTime(offset)` (`:47`) — `absoluteTime + offset`, an absolute future time
  for native node scheduling.

**Scheduler** — `src/engine/core/SatieScheduler.ts`

- `AudioEventType` enum (`src/engine/core/SatieScheduler.ts:10`) — `Play`, `Stop`,
  `SetVolume`, `SetPitch`, `Callback`.
- `SatieAudioEvent` interface (`:18`) — `scheduledSample`, `type`, `trackKey`, optional
  `floatValue` / `stringValue` / `onExecute` / `debugLabel`. The scheduler only acts on
  `scheduledSample` and `onExecute`; the other fields are payload for callers.
- `new SatieScheduler(clock)` (`:35`) — holds a private sorted `timeline` array.
- `schedule(evt)` (`:46`) — binary-search insert by `scheduledSample` (O(log n) search +
  array splice). Increments `totalScheduled`.
- `scheduleAt(evt, timeSeconds)` (`:60`) — sets `evt.scheduledSample` from an absolute
  clock time, then `schedule`s.
- `scheduleAfter(evt, offsetSeconds)` (`:65`) — schedules relative to `currentSample`.
- `cancelTrackEvents(trackKey)` (`:70`) — in-place compaction removing all events for one
  track (no allocation).
- `cancelAll()` (`:81`) — empties the timeline.
- `process()` (`:85`) — the per-tick drain: consume from the front while
  `scheduledSample <= currentSample`, run each `onExecute` (errors caught and logged),
  then `splice(0, consumed)`.
- `reset()` (`:108`) — clears the timeline and both counters.
- Getters: `eventCount` (`:39`), `totalScheduled` / `totalProcessed` (`:43`) — diagnostics.

## Data flow

Both are owned by the engine, not the UI.

- `SatieEngine` constructs them once: `this.clock = new SatieDSPClock(this.ctx)` then
  `this.scheduler = new SatieScheduler(this.clock)` (`src/engine/core/SatieEngine.ts:181`).
- On playback start the engine calls `clock.start()` + `scheduler.reset()`
  (`SatieEngine.ts:415`, `:508`) and queues events with
  `scheduler.schedule({ scheduledSample: clock.currentSample + clock.secondsToSamples(...) , ... })`
  — used for clip starts, end-of-clip stops, loop re-triggers, and fade-out completion
  (`SatieEngine.ts:519`, `:726`, `:736`, `:852`, `:1133`).
- The engine's tick loop calls `scheduler.process()` (`SatieEngine.ts:567`) each frame to
  fire whatever is due.
- When a track is stopped/replaced the engine calls
  `scheduler.cancelTrackEvents(key)` (`SatieEngine.ts:1110`) so stale events don't fire.

Neither class touches React or Web Audio nodes directly — the clock only reads
`ctx.currentTime` / `ctx.sampleRate`, and the scheduler only runs caller-supplied
`onExecute` callbacks. See the [engine](./engine.md) page for the surrounding runtime.

## Invariants & gotchas

- **Timeline stays sorted ascending.** Every insert goes through `schedule`'s binary
  search; don't push onto `timeline` directly. `process()` relies on this to stop draining
  at the first not-yet-due event.
- **Insert is a stable upper-bound.** The search uses `<=` (`SatieScheduler.ts:54`), so a
  new event lands *after* existing events with the same `scheduledSample` — same-sample
  events fire in insertion order.
- **`process()` swallows callback errors.** A throwing `onExecute` is caught and logged
  (`:96`); the drain continues and `totalProcessed` is incremented before the catch only on
  success. One bad event won't stall the timeline.
- **Clock returns 0 until `start()`.** `currentTime` / `currentSample` are 0 while
  `started` is false; scheduling relative to `currentSample` before `start()` anchors at
  sample 0.
- **`clock.reset()` keeps `started = true`** and only re-anchors `startTime`. To fully
  re-zero a stopped clock, call `start()` again.
- **Sample math is floored.** `secondsToSamples` and `currentSample` both `Math.floor`,
  so event timing is quantized to whole samples (sub-sample offsets are dropped).
- **Cancel is by `trackKey`.** `cancelTrackEvents` matches the `trackKey` field on every
  event; events scheduled without a meaningful `trackKey` can't be selectively cancelled.

## Change checklist

- Adding a new event kind: extend `AudioEventType`
  (`src/engine/core/SatieScheduler.ts:10`) and have the engine populate `onExecute`; the
  scheduler needs no other change since it only runs `onExecute`.
- Changing time anchoring (e.g. offline render vs. live): adjust `SatieDSPClock`, not the
  scheduler — the scheduler reads `clock.currentSample` exclusively.
- Touching insert/consume logic: keep the sorted invariant and update unit tests in
  `src/engine/core/__tests__/` (run `npm run test`).
- Any source edit here must update this wiki page in the same commit (wiki freshness
  gate).

## Sources

- `src/engine/core/SatieScheduler.ts`
- `src/engine/core/SatieDSPClock.ts`
