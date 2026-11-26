#!/usr/bin/env node
// Runs the Playwright suite against the hosted demo (no local build or server).
// Usage: npm run test:e2e:hosted [-- <playwright args>]; override the URL with E2E_BASE_URL.
import { spawnSync } from 'node:child_process';

const env = { ...process.env, E2E_BASE_URL: process.env.E2E_BASE_URL || 'https://reopen-751ea.web.app' };
console.log(`e2e against ${env.E2E_BASE_URL}`);
const result = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
