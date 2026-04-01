---
name: tdd-workflow
description: Use this skill when writing new features, fixing bugs, or refactoring code. Enforces test-driven development with comprehensive test coverage using Vitest.
---

# Test-Driven Development Workflow

This skill ensures all code development follows TDD principles with comprehensive test coverage.

## When to Activate

- Writing new features or functionality
- Fixing bugs or issues
- Refactoring existing code
- Adding new DSL properties, effects, or trajectories
- Creating new UI components or hooks

## Core Principles

### 1. Tests BEFORE Code
ALWAYS write tests first, then implement code to make tests pass.

### 2. Coverage Requirements
- All edge cases covered
- Error scenarios tested
- Boundary conditions verified

### 3. Test Types

#### Unit Tests (Vitest)
- Parser functions (`SatieParser.ts`)
- Engine logic (`SatieEngine.ts`, `SatieScheduler.ts`)
- DSP chain construction (`DSPChain.ts`)
- Statement data class
- Utility functions

#### Integration Tests
- Parser → Engine round-trip
- DSP chain with multiple effects
- Trajectory evaluation over time

## TDD Workflow Steps

### Step 1: Write Test Cases
For each feature, create comprehensive test cases:

```typescript
import { describe, it, expect } from 'vitest'
import { SatieParser } from '../SatieParser'

describe('New Property: example_prop', () => {
  it('parses basic value', () => {
    const result = SatieParser.parse('voice myvoice sample.wav\n  example_prop 0.5')
    expect(result[0].exampleProp).toBe(0.5)
  })

  it('parses range value', () => {
    const result = SatieParser.parse('voice myvoice sample.wav\n  example_prop 0.2~0.8')
    expect(result[0].exampleProp).toBeDefined()
    expect(result[0].exampleProp.min).toBe(0.2)
    expect(result[0].exampleProp.max).toBe(0.8)
  })

  it('ignores invalid values', () => {
    const result = SatieParser.parse('voice myvoice sample.wav\n  example_prop invalid')
    expect(result[0].exampleProp).toBeUndefined()
  })
})
```

### Step 2: Run Tests (They Should Fail)
```bash
npm run test
# Tests should fail - we haven't implemented yet
```

### Step 3: Implement Code
Write minimal code to make tests pass.

### Step 4: Run Tests Again
```bash
npm run test
# Tests should now pass
```

### Step 5: Refactor
Improve code quality while keeping tests green:
- Remove duplication
- Improve naming
- Optimize performance

## Testing Patterns for Satie

### Parser Test Pattern
```typescript
describe('SatieParser', () => {
  it('parses property correctly', () => {
    const script = `voice test sample.wav
  property_name value`
    const stmts = SatieParser.parse(script)
    expect(stmts).toHaveLength(1)
    expect(stmts[0].propertyName).toBe(expectedValue)
  })
})
```

### Engine Test Pattern (with AudioContext stub)
```typescript
describe('SatieEngine', () => {
  it('creates track with correct parameters', () => {
    // Minimal AudioContext stub - no full mocks
    const ctx = new OfflineAudioContext(2, 44100, 44100)
    // Test engine behavior
  })
})
```

### Scheduler Test Pattern
```typescript
describe('SatieScheduler', () => {
  it('schedules events in order', () => {
    const scheduler = new SatieScheduler()
    scheduler.add({ time: 2.0, action: 'play' })
    scheduler.add({ time: 1.0, action: 'play' })
    // Verify O(log n) sorted insert
    expect(scheduler.peek().time).toBe(1.0)
  })
})
```

## Test File Organization

Tests live next to the code in `__tests__/` directories:
```
src/engine/core/__tests__/SatieParser.test.ts
src/engine/core/__tests__/SatieEngine.test.ts
src/engine/core/__tests__/SatieScheduler.test.ts
src/engine/dsp/__tests__/DSPChain.test.ts
```

## Common Testing Mistakes to Avoid

### Test User-Visible Behavior, Not Implementation
```typescript
// Bad: testing internal state
expect(engine._tracks.length).toBe(1)

// Good: testing observable behavior
expect(engine.getTracks()).toHaveLength(1)
```

### Independent Tests
```typescript
// Each test sets up its own data
it('parses voice statement', () => {
  const result = SatieParser.parse('voice test sample.wav')
  expect(result).toHaveLength(1)
})
```

## Running Tests

```bash
npm run test         # vitest run (single pass)
npm run test:watch   # vitest (watch mode)
```

**Remember**: Tests are not optional. They are the safety net that enables confident refactoring and rapid development.
