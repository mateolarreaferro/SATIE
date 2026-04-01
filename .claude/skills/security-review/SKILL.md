---
name: security-review
description: Use this skill when adding authentication, handling user input, working with secrets, creating API endpoints, or implementing payment/sensitive features. Provides comprehensive security checklist and patterns.
---

# Security Review

Ensures all code follows security best practices and identifies potential vulnerabilities.

## When to Activate

- Implementing authentication or authorization
- Handling user input or file uploads
- Working with secrets or credentials
- Storing or transmitting sensitive data
- Integrating third-party APIs (ElevenLabs, Anthropic, OpenAI, Gemini)
- Modifying Supabase queries or RLS policies

## Security Checklist

### 1. Secrets Management

#### NEVER Do This
```typescript
const apiKey = "sk-proj-xxxxx"  // Hardcoded secret
```

#### ALWAYS Do This
```typescript
// Client-side: user-provided keys from localStorage
const apiKey = localStorage.getItem('satie-anthropic-key')

// Server-side: environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
```

#### Verification Steps
- [ ] No hardcoded API keys, tokens, or passwords
- [ ] User API keys stored in localStorage only (never committed)
- [ ] Supabase keys in `.env` and `.env` is in `.gitignore`
- [ ] No secrets in git history

### 2. Input Validation

#### Satie Script Input
The parser handles arbitrary user input. Ensure:
- [ ] No eval() or Function() on user script content
- [ ] Regex patterns have reasonable backtracking limits
- [ ] Large scripts don't cause parser hangs

#### File Upload Validation (Samples)
```typescript
// Size check
const maxSize = 10 * 1024 * 1024 // 10MB for audio
if (file.size > maxSize) throw new Error('File too large')

// Type check
const allowedTypes = ['audio/wav', 'audio/mp3', 'audio/ogg', 'audio/mpeg']
if (!allowedTypes.includes(file.type)) throw new Error('Invalid audio type')
```

### 3. SQL Injection Prevention

#### ALWAYS Use Supabase Query Builder
```typescript
// Safe - parameterized via Supabase
const { data } = await supabase
  .from('sketches')
  .select('*')
  .eq('user_id', userId)
```

- [ ] No raw SQL string concatenation
- [ ] Supabase queries use proper filters
- [ ] Row Level Security enabled on all tables

### 4. XSS Prevention

- [ ] No `dangerouslySetInnerHTML` with user content
- [ ] React's built-in XSS protection used (JSX auto-escapes)
- [ ] Script content rendered in Monaco editor (sandboxed), not as HTML
- [ ] User-provided sketch names/descriptions escaped

### 5. API Key Security

Satie stores user API keys in localStorage:
- [ ] Keys never sent to Supabase or logged
- [ ] Keys cleared on explicit user action
- [ ] No keys exposed in URL parameters
- [ ] Keys not included in sketch sharing/export

### 6. Supabase Security

- [ ] RLS policies on sketches table (users access own sketches only)
- [ ] Public sketches explicitly flagged (`is_public = true`)
- [ ] Storage buckets have proper access policies
- [ ] Anon key has minimal permissions

### 7. Audio/WebAudio Security

- [ ] AudioContext created only on user gesture
- [ ] Master limiter prevents audio clipping/damage
- [ ] No unconstrained oscillator frequencies
- [ ] Sample URLs validated before fetch

### 8. Sensitive Data Exposure

#### Logging
```typescript
// WRONG: Logging API keys
console.log('Provider key:', apiKey)

// CORRECT: Log without sensitive data
console.log('Provider configured:', !!apiKey)
```

- [ ] No API keys in console.log
- [ ] Error messages generic for users
- [ ] No stack traces exposed in production

## Pre-Deployment Checklist

- [ ] **Secrets**: No hardcoded keys, all in env vars or localStorage
- [ ] **Input**: Parser handles malformed input gracefully
- [ ] **XSS**: No unescaped user content in DOM
- [ ] **Auth**: Supabase RLS enabled
- [ ] **Storage**: Audio uploads validated (size, type)
- [ ] **API Keys**: Never transmitted to backend or shared
- [ ] **HTTPS**: Enforced in production
- [ ] **Dependencies**: `npm audit` clean
