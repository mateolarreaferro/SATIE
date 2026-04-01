---
name: e2e-testing
description: Playwright E2E testing patterns, Page Object Model, configuration, CI/CD integration, artifact management, and flaky test strategies.
---

# E2E Testing Patterns

Comprehensive Playwright patterns for building stable, fast, and maintainable E2E test suites.

## When to Activate

- Setting up or extending E2E tests
- Testing critical user flows (editor, playback, sharing)
- Debugging flaky tests
- Configuring CI/CD for E2E tests

## Test File Organization

```
tests/
├── e2e/
│   ├── editor/
│   │   ├── playback.spec.ts
│   │   ├── script-editing.spec.ts
│   │   └── panels.spec.ts
│   ├── sharing/
│   │   ├── sketch-view.spec.ts
│   │   └── gallery.spec.ts
│   └── auth/
│       ├── login.spec.ts
│       └── dashboard.spec.ts
├── fixtures/
│   └── auth.ts
└── playwright.config.ts
```

## Page Object Model (POM)

```typescript
import { Page, Locator } from '@playwright/test'

export class EditorPage {
  readonly page: Page
  readonly monacoEditor: Locator
  readonly playButton: Locator
  readonly stopButton: Locator
  readonly viewport: Locator

  constructor(page: Page) {
    this.page = page
    this.monacoEditor = page.locator('.monaco-editor')
    this.playButton = page.locator('[data-testid="play-btn"]')
    this.stopButton = page.locator('[data-testid="stop-btn"]')
    this.viewport = page.locator('[data-testid="spatial-viewport"]')
  }

  async goto(sketchId?: string) {
    const url = sketchId ? `/editor/${sketchId}` : '/editor'
    await this.page.goto(url)
    await this.page.waitForLoadState('networkidle')
  }

  async typeScript(text: string) {
    await this.monacoEditor.click()
    await this.page.keyboard.type(text)
  }

  async play() {
    await this.playButton.click()
  }

  async stop() {
    await this.stopButton.click()
  }
}
```

## Test Structure

```typescript
import { test, expect } from '@playwright/test'
import { EditorPage } from '../../pages/EditorPage'

test.describe('Editor Playback', () => {
  let editor: EditorPage

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page)
    await editor.goto()
  })

  test('should play and stop a script', async ({ page }) => {
    await editor.typeScript('voice test sine\n  gain 0.5')
    await editor.play()
    await expect(editor.stopButton).toBeVisible()
    await editor.stop()
    await expect(editor.playButton).toBeVisible()
  })
})
```

## Playwright Configuration

```typescript
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
})
```

## Flaky Test Patterns

### Common Causes & Fixes

**Race conditions:**
```typescript
// Bad: assumes element is ready
await page.click('[data-testid="button"]')

// Good: auto-wait locator
await page.locator('[data-testid="button"]').click()
```

**Network timing:**
```typescript
// Bad: arbitrary timeout
await page.waitForTimeout(5000)

// Good: wait for specific condition
await page.waitForResponse(resp => resp.url().includes('/api/sketches'))
```

**AudioContext timing:**
```typescript
// Wait for AudioContext to be running
await page.evaluate(() => {
  return new Promise(resolve => {
    const check = () => {
      if (document.querySelector('[data-state="playing"]')) resolve(true)
      else setTimeout(check, 100)
    }
    check()
  })
})
```

## CI/CD Integration

```yaml
# .github/workflows/e2e.yml
name: E2E Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npx playwright test
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30
```
