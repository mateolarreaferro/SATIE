#!/usr/bin/env tsx
/**
 * wiki-check.ts — the freshness gate for the Satie wiki (docs/wiki/).
 *
 * The wiki is a natural-language mirror of the code. Each page declares, in its
 * frontmatter, the source files it is the canonical documentation for:
 *
 *   ---
 *   sources:
 *     - src/engine/core/SatieParser.ts
 *   synced_sha: <hash of those files at last sync>
 *   ---
 *
 * From the union of every page's `sources` we build a `source file -> page(s)` map.
 * Three modes use that map:
 *
 *   --coverage   every required source file under src/** and api/** is claimed by
 *                >=1 page; no page points at a deleted file. (hard fail)
 *   --staged     for each staged source file, its covering page(s) must also be
 *                staged. Auto-stamps synced_sha/synced on co-staged pages.
 *                Escape: `[skip-wiki]` in commit msg, or `git commit --no-verify`.
 *   --drift      report pages whose sources changed since synced_sha. (reporting)
 *
 * Pure Node built-ins — no dependencies beyond tsx to run TypeScript.
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// ---------------------------------------------------------------------------
// Repo layout
// ---------------------------------------------------------------------------

const ROOT = (() => {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
})();

const WIKI_DIR = join(ROOT, 'docs', 'wiki');

/** Roots whose files must be covered by a wiki page. */
const COVERED_ROOTS = ['src', 'api'];

/** A file under a covered root is *required* to be covered unless excluded. */
function isExcludedFromCoverage(relPath: string): boolean {
  if (relPath.endsWith('.d.ts')) return true;
  if (/(^|\/)__tests__(\/|$)/.test(relPath)) return true;
  if (/\.test\.[cm]?tsx?$/.test(relPath)) return true;
  // only document source modules
  return !/\.[cm]?tsx?$/.test(relPath);
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Minimal glob -> RegExp supporting `**`, `*`, `?`. Paths are repo-relative POSIX. */
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**` -> any path segment depth; consume an optional following slash
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') re += '[^/]';
    else if ('.+^${}()|[]\\'.includes(c)) re += '\\' + c;
    else if (c === '/') re += '/';
    else re += c;
  }
  return new RegExp('^' + re + '$');
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

interface Page {
  file: string;          // absolute path
  rel: string;           // repo-relative
  sources: string[];     // repo-relative globs
  syncedSha?: string;
  raw: string;
}

/** Tiny YAML-subset frontmatter parser (key: value, list items, inline arrays). */
function parseFrontmatter(raw: string): Record<string, string | string[]> {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string | string[]> = {};
  let key: string | null = null;
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key) {
      (out[key] as string[]).push(stripQuotes(item[1].trim()));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    key = kv[1];
    const val = kv[2].trim();
    if (val === '') out[key] = []; // list follows on next lines
    else if (val.startsWith('[') && val.endsWith(']')) {
      out[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => stripQuotes(s.trim()))
        .filter(Boolean);
    } else out[key] = stripQuotes(val);
  }
  return out;
}

function stripQuotes(s: string): string {
  return s.replace(/^['"]|['"]$/g, '');
}

function loadPages(): Page[] {
  if (!existsSync(WIKI_DIR)) return [];
  const pages: Page[] = [];
  for (const file of walk(WIKI_DIR)) {
    if (!file.endsWith('.md')) continue;
    const raw = readFileSync(file, 'utf8');
    const fm = parseFrontmatter(raw);
    const sources = Array.isArray(fm.sources) ? fm.sources : fm.sources ? [fm.sources] : [];
    pages.push({
      file,
      rel: relative(ROOT, file).replaceAll('\\', '/'),
      sources: sources.map((s) => s.replaceAll('\\', '/')),
      syncedSha: typeof fm.synced_sha === 'string' ? fm.synced_sha : undefined,
      raw,
    });
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Mapping & hashing
// ---------------------------------------------------------------------------

/** All repo-relative source files under the covered roots. */
function allSourceFiles(): string[] {
  const files: string[] = [];
  for (const root of COVERED_ROOTS) {
    for (const abs of walk(join(ROOT, root))) {
      files.push(relative(ROOT, abs).replaceAll('\\', '/'));
    }
  }
  return files;
}

/** Expand one glob against the real filesystem (from its static prefix dir). */
function expandGlob(glob: string): string[] {
  const abs = join(ROOT, glob);
  if (existsSync(abs) && statSync(abs).isFile()) return [glob];
  const staticParts: string[] = [];
  for (const part of glob.split('/')) {
    if (part.includes('*') || part.includes('?')) break;
    staticParts.push(part);
  }
  const baseAbs = join(ROOT, staticParts.join('/'));
  if (!existsSync(baseAbs)) return [];
  const re = globToRegExp(glob);
  return walk(baseAbs)
    .map((f) => relative(ROOT, f).replaceAll('\\', '/'))
    .filter((f) => re.test(f));
}

/** Resolve a page's `sources` globs against the real tree -> repo-relative files. */
function resolveSources(globs: string[]): { matched: string[]; dangling: string[] } {
  const matched = new Set<string>();
  const dangling: string[] = [];
  for (const g of globs) {
    const hits = expandGlob(g);
    if (hits.length === 0) dangling.push(g);
    else hits.forEach((h) => matched.add(h));
  }
  return { matched: [...matched], dangling };
}

function hashFiles(relFiles: string[]): string {
  const h = createHash('sha256');
  for (const f of [...relFiles].sort()) {
    h.update(f);
    h.update('\0');
    h.update(existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f)) : Buffer.from('<missing>'));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function red(s: string) { return `\x1b[31m${s}\x1b[0m`; }
function yellow(s: string) { return `\x1b[33m${s}\x1b[0m`; }
function green(s: string) { return `\x1b[32m${s}\x1b[0m`; }

function modeCoverage(pages: Page[]): boolean {
  const universe = allSourceFiles();
  const covered = new Set<string>();
  const dangling: { page: string; glob: string }[] = [];

  for (const p of pages) {
    const { matched, dangling: d } = resolveSources(p.sources);
    matched.forEach((f) => covered.add(f));
    d.forEach((g) => dangling.push({ page: p.rel, glob: g }));
  }

  const required = universe.filter((f) => !isExcludedFromCoverage(f));
  const uncovered = required.filter((f) => !covered.has(f));

  let ok = true;
  if (uncovered.length) {
    ok = false;
    console.error(red(`\n✗ ${uncovered.length} source file(s) have no wiki page:`));
    uncovered.forEach((f) => console.error(`    ${f}`));
    console.error(yellow('  → add each to the `sources:` of the best-fit docs/wiki page.'));
  }
  if (dangling.length) {
    ok = false;
    console.error(red(`\n✗ ${dangling.length} wiki source(s) match no file (deleted/renamed?):`));
    dangling.forEach((d) => console.error(`    ${d.page}: ${d.glob}`));
  }
  if (ok) console.log(green(`✓ coverage: all ${required.length} source files are documented.`));
  return ok;
}

/** Bootstrap helper: stamp synced_sha/synced on every page from current sources. */
function modeStamp(pages: Page[]): boolean {
  let n = 0;
  for (const p of pages) {
    if (p.sources.length === 0) continue;
    const { matched } = resolveSources(p.sources);
    if (matched.length === 0) continue;
    stampPage(p, hashFiles(matched));
    n++;
  }
  console.log(green(`✓ stamped ${n} page(s).`));
  return true;
}

function modeDrift(pages: Page[]): boolean {
  const drifted: string[] = [];
  for (const p of pages) {
    if (p.sources.length === 0) continue;
    const { matched } = resolveSources(p.sources);
    if (matched.length === 0) continue;
    const current = hashFiles(matched);
    if (p.syncedSha && p.syncedSha !== current) drifted.push(p.rel);
  }
  if (drifted.length) {
    console.error(yellow(`\n⚠ ${drifted.length} wiki page(s) may be stale (source changed since synced_sha):`));
    drifted.forEach((f) => console.error(`    ${f}`));
    console.error(yellow('  → review against the code, then re-stage (synced_sha auto-updates on commit).'));
  } else {
    console.log(green('✓ drift: no page is behind its sources.'));
  }
  return true; // drift is reporting-only
}

function gitStaged(): string[] {
  return execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8', cwd: ROOT })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function commitMessage(): string {
  const f = join(ROOT, '.git', 'COMMIT_EDITMSG');
  try { return existsSync(f) ? readFileSync(f, 'utf8') : ''; } catch { return ''; }
}

function stampPage(p: Page, sha: string): void {
  const today = new Date().toISOString().slice(0, 10);
  let raw = p.raw;
  raw = /^(---\n[\s\S]*?\bsynced_sha:).*$/m.test(raw)
    ? raw.replace(/^(---\n[\s\S]*?\bsynced_sha:).*$/m, `$1 ${sha}`)
    : raw.replace(/^(---\n)/, `$1synced_sha: ${sha}\n`);
  raw = /^(---\n[\s\S]*?\bsynced:).*$/m.test(raw)
    ? raw.replace(/^(---\n[\s\S]*?\bsynced:).*$/m, `$1 ${today}`)
    : raw.replace(/^(---\nsynced_sha: .*\n)/, `$1synced: ${today}\n`);
  if (raw !== p.raw) {
    writeFileSync(p.file, raw);
    execSync(`git add ${JSON.stringify(p.rel)}`, { cwd: ROOT });
  }
}

function modeStaged(pages: Page[]): boolean {
  if (/\[skip-wiki\]/i.test(commitMessage())) {
    console.log(yellow('wiki gate skipped ([skip-wiki]).'));
    return true;
  }

  const staged = new Set(gitStaged());
  const stagedSources = [...staged].filter(
    (f) => COVERED_ROOTS.some((r) => f === r || f.startsWith(r + '/')) && !isExcludedFromCoverage(f),
  );
  if (stagedSources.length === 0) return true;

  // Build source -> covering pages
  const cover = new Map<string, Page[]>();
  for (const p of pages) {
    const { matched } = resolveSources(p.sources);
    for (const f of matched) {
      if (!cover.has(f)) cover.set(f, []);
      cover.get(f)!.push(p);
    }
  }

  const missing: { src: string; pages: string[] }[] = [];
  const pagesToStamp = new Set<Page>();

  for (const src of stagedSources) {
    const covering = cover.get(src) ?? [];
    if (covering.length === 0) {
      missing.push({ src, pages: ['(no page covers this file — add it to a docs/wiki page\'s `sources:`)'] });
      continue;
    }
    const coStaged = covering.filter((p) => staged.has(p.rel));
    if (coStaged.length === 0) {
      missing.push({ src, pages: covering.map((p) => p.rel) });
    } else {
      coStaged.forEach((p) => pagesToStamp.add(p));
    }
  }

  if (missing.length) {
    console.error(red('\n✗ wiki gate: source changed without its documentation.\n'));
    for (const m of missing) {
      console.error(`  ${yellow(m.src)}`);
      console.error(`    update: ${m.pages.join('  |  ')}`);
    }
    console.error(
      '\n  Edit the page(s) above to reflect this change and `git add` them.\n' +
      '  Escapes: put [skip-wiki] in the commit message, or `git commit --no-verify`.\n',
    );
    return false;
  }

  // All covered & co-staged — refresh synced_sha on the touched pages.
  for (const p of pagesToStamp) {
    const { matched } = resolveSources(p.sources);
    stampPage(p, hashFiles(matched));
  }
  console.log(green(`✓ wiki gate: ${stagedSources.length} source change(s) documented.`));
  return true;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const pages = loadPages();
  if (pages.length === 0) {
    console.error(yellow('No wiki pages found under docs/wiki/ — nothing to check.'));
  }

  let ok = true;
  if (args.includes('--stamp')) ok = modeStamp(pages) && ok;
  if (args.includes('--staged')) ok = modeStaged(pages) && ok;
  if (args.includes('--coverage')) ok = modeCoverage(pages) && ok;
  if (args.includes('--drift')) ok = modeDrift(pages) && ok;
  if (!args.some((a) => a.startsWith('--'))) {
    ok = modeCoverage(pages) && ok;
    modeDrift(pages);
  }
  process.exit(ok ? 0 : 1);
}

main();
