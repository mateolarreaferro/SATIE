---
name: verification-loop
description: A comprehensive verification system for Claude Code sessions. Run after completing features, before PRs, or after refactoring to ensure quality gates pass.
---

# Verification Loop

A comprehensive verification system for Claude Code sessions.

## When to Use

Invoke this skill:
- After completing a feature or significant code change
- Before creating a PR
- When you want to ensure quality gates pass
- After refactoring

## Verification Phases

### Phase 1: Build Verification
```bash
npm run build 2>&1 | tail -20
```

If build fails, STOP and fix before continuing.

### Phase 2: Type Check
```bash
npx tsc --noEmit 2>&1 | head -30
```

Report all type errors. Fix critical ones before continuing.

### Phase 3: Test Suite
```bash
npm run test 2>&1 | tail -50
```

Report:
- Total tests: X
- Passed: X
- Failed: X

### Phase 4: Security Scan
```bash
# Check for hardcoded secrets
grep -rn "sk-" --include="*.ts" --include="*.tsx" src/ 2>/dev/null | head -10
grep -rn "api_key" --include="*.ts" --include="*.tsx" src/ 2>/dev/null | head -10

# Check for console.log in engine code
grep -rn "console.log" --include="*.ts" src/engine/ 2>/dev/null | head -10
```

### Phase 5: Diff Review
```bash
git diff --stat
git diff HEAD~1 --name-only
```

Review each changed file for:
- Unintended changes
- Missing error handling
- Potential edge cases
- Performance regressions (especially in engine/spatial code)

## Output Format

After running all phases, produce a verification report:

```
VERIFICATION REPORT
==================

Build:     [PASS/FAIL]
Types:     [PASS/FAIL] (X errors)
Tests:     [PASS/FAIL] (X/Y passed)
Security:  [PASS/FAIL] (X issues)
Diff:      [X files changed]

Overall:   [READY/NOT READY] for PR

Issues to Fix:
1. ...
2. ...
```

## Satie-Specific Checks

- **Engine purity**: Verify no React imports in `src/engine/`
- **Performance**: Check that spatial updates aren't adding React state between engine and Three.js viewport
- **Parser consistency**: Verify new properties are added to Statement.ts, SatieParser.ts, and tests
- **DSP chain order**: Source → Gain → Filter → Distortion → Delay → Reverb → EQ → Panner
