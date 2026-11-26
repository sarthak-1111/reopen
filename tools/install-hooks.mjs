#!/usr/bin/env node
// Points git at .githooks/ (pre-commit secret scan). Does nothing outside a git checkout.
import { execFileSync } from 'node:child_process';

try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
} catch {
  // Not a git checkout (e.g. installed from a tarball): nothing to do.
}
