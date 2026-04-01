---
name: frontend-patterns
description: Frontend development patterns for React, state management, performance optimization, and UI best practices. Tailored for Satie's Vite + React + Three.js stack.
---

# Frontend Development Patterns

Modern frontend patterns for React and performant user interfaces.

## When to Activate

- Building React components (composition, props, rendering)
- Managing state (useState, useReducer, Context)
- Optimizing performance (memoization, virtualization, code splitting)
- Working with forms (validation, controlled inputs)
- Building accessible, responsive UI patterns
- Integrating Three.js/R3F with React state

## Component Patterns

### Composition Over Inheritance

```typescript
interface CardProps {
  children: React.ReactNode
  variant?: 'default' | 'outlined'
}

export function Card({ children, variant = 'default' }: CardProps) {
  return <div className={`card card-${variant}`}>{children}</div>
}
```

### Compound Components

```typescript
const TabsContext = createContext<TabsContextValue | undefined>(undefined)

export function Tabs({ children, defaultTab }: {
  children: React.ReactNode
  defaultTab: string
}) {
  const [activeTab, setActiveTab] = useState(defaultTab)
  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </TabsContext.Provider>
  )
}
```

## Custom Hooks Patterns

### Debounce Hook
```typescript
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(handler)
  }, [value, delay])
  return debouncedValue
}
```

## Performance Optimization

### Satie-Specific: Engine ↔ UI Boundary

**Critical rule**: Three.js reads `tracksRef` directly in its render loop. Never add React state between the engine and the 3D viewport.

```typescript
// GOOD: Direct ref access in useFrame (no React re-renders)
useFrame(() => {
  const tracks = tracksRef.current
  tracks.forEach(track => {
    mesh.position.set(track.x, track.y, track.z)
  })
})

// BAD: React state for position updates (causes re-renders at 60fps)
const [positions, setPositions] = useState([])
```

### Memoization

```typescript
// useMemo for expensive computations
const sortedTracks = useMemo(() => {
  return tracks.sort((a, b) => a.name.localeCompare(b.name))
}, [tracks])

// useCallback for functions passed to children
const handleSearch = useCallback((query: string) => {
  setSearchQuery(query)
}, [])

// React.memo for pure components
export const TrackItem = React.memo<TrackItemProps>(({ track }) => {
  return <div>{track.name}</div>
})
```

### Code Splitting & Lazy Loading

```typescript
const HeavyPanel = lazy(() => import('./HeavyPanel'))

export function Editor() {
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <HeavyPanel />
    </Suspense>
  )
}
```

### Throttled UI State

Satie uses 8fps throttled snapshots for React rendering:
```typescript
// useSatieEngine provides:
// - engine: ref to SatieEngine instance
// - uiState: throttled snapshot at 8fps for React
// - tracksRef: direct ref for Three.js (no React)
```

## State Management

### Context + Reducer for Complex State
```typescript
type Action =
  | { type: 'SET_PLAYING'; payload: boolean }
  | { type: 'SET_SCRIPT'; payload: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_PLAYING':
      return { ...state, playing: action.payload }
    case 'SET_SCRIPT':
      return { ...state, script: action.payload }
    default:
      return state
  }
}
```

## Satie UI Conventions

- Use inline styles (no CSS modules or styled-components)
- Color palette: background #f4f3ee, text #0a0a0a, accent #1a3a2a, danger #8b0000
- Panels use the `Panel` wrapper component for draggable/resizable behavior
- Monaco editor for script editing (not textarea)

## Error Boundary Pattern

```typescript
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return <div>Something went wrong: {this.state.error?.message}</div>
    }
    return this.props.children
  }
}
```

## Accessibility Patterns

### Keyboard Navigation
```typescript
const handleKeyDown = (e: React.KeyboardEvent) => {
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); moveDown(); break
    case 'ArrowUp': e.preventDefault(); moveUp(); break
    case 'Enter': e.preventDefault(); select(); break
    case 'Escape': close(); break
  }
}
```

### Focus Management
```typescript
useEffect(() => {
  if (isOpen) {
    previousFocusRef.current = document.activeElement as HTMLElement
    modalRef.current?.focus()
  } else {
    previousFocusRef.current?.focus()
  }
}, [isOpen])
```
