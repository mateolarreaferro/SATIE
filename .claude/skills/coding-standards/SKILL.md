---
name: coding-standards
description: Universal coding standards, best practices, and patterns for TypeScript, React, and Web Audio development in the Satie project.
---

# Coding Standards & Best Practices

Universal coding standards applicable across the Satie project.

## When to Activate

- Starting a new module or component
- Reviewing code for quality and maintainability
- Refactoring existing code
- Enforcing naming or structural consistency
- Onboarding to Satie conventions

## Code Quality Principles

### 1. Readability First
- Self-documenting code preferred over comments
- Consistent formatting (follow existing code style)

### 2. KISS (Keep It Simple)
- Simplest solution that works
- No premature optimization
- Easy to understand > clever code

### 3. DRY (Don't Repeat Yourself)
- Extract common logic into functions
- Create reusable components
- But: three similar lines is better than a premature abstraction

### 4. YAGNI (You Aren't Gonna Need It)
- Don't build features before they're needed
- Start simple, refactor when needed

## TypeScript Standards

### Variable Naming
```typescript
// GOOD: Descriptive names
const trackPosition = { x: 0, y: 1, z: 0 }
const isPlaying = true
const sampleBuffer: AudioBuffer | null = null

// BAD: Unclear names
const pos = { x: 0, y: 1, z: 0 }
const flag = true
const buf = null
```

### Function Naming
```typescript
// GOOD: Verb-noun pattern
async function fetchSampleBuffer(url: string) { }
function calculateTrajectoryPoint(t: number) { }
function isValidStatement(stmt: Statement): boolean { }

// BAD: Unclear or noun-only
async function sample(url: string) { }
function trajectory(t: number) { }
```

### Immutability Pattern
```typescript
// ALWAYS use spread operator for state updates
const updatedTrack = { ...track, position: newPos }
const updatedTracks = [...tracks, newTrack]

// NEVER mutate directly
track.position = newPos  // BAD
tracks.push(newTrack)    // BAD
```

### Error Handling
```typescript
// GOOD: Comprehensive error handling
async function loadSample(url: string) {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    return await audioContext.decodeAudioData(await response.arrayBuffer())
  } catch (error) {
    console.error('Failed to load sample:', error)
    throw new Error('Failed to load audio sample')
  }
}
```

### Async/Await Best Practices
```typescript
// GOOD: Parallel execution when possible
const [buffer1, buffer2, buffer3] = await Promise.all([
  loadSample(url1),
  loadSample(url2),
  loadSample(url3)
])
```

### Type Safety
```typescript
// GOOD: Proper types
interface Track {
  name: string
  position: { x: number; y: number; z: number }
  gain: number
  muted: boolean
}

// BAD: Using 'any'
function processTrack(track: any): any { }
```

## Satie-Specific Conventions

- Properties in Satie syntax are `key value` (space-separated, no equals)
- Property names use snake_case in the DSL (`fade_in`) but camelCase in TypeScript (`fadeIn`)
- Engine (`src/engine/`) has zero React dependencies
- Use inline styles (no CSS modules or styled-components)
- Color palette: background #f4f3ee, text #0a0a0a, accent #1a3a2a, danger #8b0000
- Path aliases: `@engine/*`, `@ui/*`, `@api/*`

## Code Smell Detection

### Long Functions
```typescript
// BAD: Function > 50 lines — split it
// GOOD: Split into smaller functions
function processStatement(stmt: Statement) {
  const validated = validateStatement(stmt)
  const track = createTrack(validated)
  return scheduleTrack(track)
}
```

### Deep Nesting
```typescript
// BAD: 5+ levels of nesting
// GOOD: Early returns
if (!statement) return
if (!statement.sample) return
if (!audioContext) return
// Do something
```

### Magic Numbers
```typescript
// BAD
if (retryCount > 3) { }
setTimeout(callback, 500)

// GOOD
const MAX_RETRIES = 3
const DEBOUNCE_DELAY_MS = 500
```

## Testing Standards

### AAA Pattern
```typescript
test('parses voice statement', () => {
  // Arrange
  const script = 'voice test sample.wav'
  // Act
  const result = SatieParser.parse(script)
  // Assert
  expect(result).toHaveLength(1)
  expect(result[0].name).toBe('test')
})
```

### Descriptive Test Names
```typescript
// GOOD
test('returns empty array when script has no statements', () => { })
test('throws error when sample file not found', () => { })

// BAD
test('works', () => { })
test('test parse', () => { })
```
