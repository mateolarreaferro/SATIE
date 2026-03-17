---
paths:
  - "src/ui/**"
---
# UI Development Rules

- Use inline styles (the project does not use CSS modules or styled-components).
- Color palette: background #f4f3ee, text #0a0a0a, accent #1a3a2a, danger #8b0000.
- Fonts: Inter for UI text, SF Mono/Consolas for code.
- Three.js reads tracksRef directly in useFrame — NEVER add React state between the engine and the 3D viewport.
- New panels should use the Panel wrapper component from src/ui/components/Panel.tsx.
- All UI components that interact with audio must handle the "user gesture required" constraint for AudioContext.
