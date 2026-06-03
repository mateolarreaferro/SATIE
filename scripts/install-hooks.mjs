// Point git at the committed .githooks/ dir so the wiki gate runs on commit.
// Runs via the package.json "prepare" script (on npm install/ci). Idempotent and
// non-fatal — if this isn't a git checkout (e.g. tarball install), it no-ops.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

try {
  if (!existsSync('.git')) process.exit(0);
  execSync('git config core.hooksPath .githooks', { stdio: 'ignore' });
} catch {
  // best-effort; never block install
}
