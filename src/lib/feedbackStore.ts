/**
 * RLHF feedback store — IndexedDB persistence for human feedback on AI generations.
 * Stores prompt/output pairs with explicit ratings (thumbs up/down) and implicit
 * signals (user edits, undo, regeneration). Top-rated examples are injected into
 * future system prompts as few-shot examples; anti-patterns are used as negative examples.
 */

import type { AITarget } from '../ui/components/AIPanel';

const DB_NAME = 'satie-feedback';
const DB_VERSION = 1;
const STORE_NAME = 'feedback';

export interface StoredFeedback {
  id: string;
  prompt: string;
  output: string;
  target: AITarget;

  // Explicit feedback
  rating: number; // -1 (thumbs down), 0 (no rating), 1 (thumbs up)

  // Implicit feedback signals
  userEditedOutput: string | null; // Script state after user edits (null = no edits)
  editDistance: number; // 0–1 ratio (0 = identical, 1 = completely different)
  wasUndone: boolean;
  wasRegenerated: boolean;

  // Context
  timestamp: number;

  // Computed preference score
  score: number;
}

// ── Scoring ─────────────────────────────────────────────────

export function computeScore(entry: StoredFeedback): number {
  const explicit = entry.rating * 0.5;
  const edit = (1.0 - entry.editDistance) * 0.3;
  const undo = (entry.wasUndone || entry.wasRegenerated) ? -0.2 : 0;
  const ageMs = Date.now() - entry.timestamp;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const recency = 0.1 * Math.max(0, 1 - ageDays / 30);
  return explicit + edit + undo + recency;
}

// ── Edit distance (Levenshtein ratio) ───────────────────────

export function editDistanceRatio(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return 1;
  if (!b.length) return 1;

  // Use line-level diff for efficiency on large scripts
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const m = aLines.length;
  const n = bLines.length;

  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = aLines[i - 1] === bLines[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n] / Math.max(m, n);
}

// ── IndexedDB ───────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('score', 'score', { unique: false });
        store.createIndex('target', 'target', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Save a new feedback entry. */
export async function saveFeedback(entry: StoredFeedback): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Non-fatal
  }
}

/** Update specific fields of an existing feedback entry. */
export async function updateFeedback(id: string, partial: Partial<StoredFeedback>): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        const existing = req.result as StoredFeedback | undefined;
        if (existing) {
          const updated = { ...existing, ...partial };
          updated.score = computeScore(updated);
          store.put(updated);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Non-fatal
  }
}

/** Get top-scored feedback entries for a target type. */
export async function getTopExamples(target: AITarget, limit: number = 3): Promise<StoredFeedback[]> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = (req.result as StoredFeedback[])
          .filter(f => f.target === target && f.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
        resolve(all);
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/** Get negatively-rated feedback entries (anti-patterns). */
export async function getAntiPatterns(target: AITarget, limit: number = 2): Promise<StoredFeedback[]> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = (req.result as StoredFeedback[])
          .filter(f => f.target === target && f.rating === -1)
          .sort((a, b) => a.score - b.score)
          .slice(0, limit);
        resolve(all);
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/** Create a fresh feedback entry with default values. */
export function createFeedbackEntry(
  prompt: string,
  output: string,
  target: AITarget,
): StoredFeedback {
  const entry: StoredFeedback = {
    id: crypto.randomUUID(),
    prompt,
    output,
    target,
    rating: 0,
    userEditedOutput: null,
    editDistance: 0,
    wasUndone: false,
    wasRegenerated: false,
    timestamp: Date.now(),
    score: 0,
  };
  entry.score = computeScore(entry);
  return entry;
}
