#!/usr/bin/env node
// Refuses commits that contain secrets or local config. Scans the files given on the command
// line, or the staged files when run from the git pre-commit hook, or all tracked files.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const RULES = [
  { name: 'Google API key', pattern: /AIza[0-9A-Za-z_\-]{35}/ },
  { name: 'App Check debug token assignment', pattern: /FIREBASE_APPCHECK_DEBUG_TOKEN\s*=\s*['"][0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}['"]/ },
  { name: 'debug token in env file', pattern: /VITE_APPCHECK_DEBUG_TOKEN\s*=\s*[0-9a-fA-F]{8}-/ },
  { name: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'service account JSON', pattern: /"type"\s*:\s*"service_account"/ },
  { name: 'OAuth token', pattern: /\bgh[opsu]_[0-9A-Za-z]{36}\b|\bya29\.[0-9A-Za-z_\-]{20,}/ },
];
const FORBIDDEN_FILES = [/(^|\/)\.env(\.[^/]*)?$/, /firebase-debug.*\.log$/, /\.debug-token/];
const ALLOWED_FILES = [/(^|\/)\.env\.example$/];

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);

let files = process.argv.slice(2);
if (files.length === 0) {
  try {
    files = process.env.GIT_INDEX_FILE || process.argv.includes('--staged') ? git(['diff', '--cached', '--name-only', '--diff-filter=ACM']) : git(['ls-files']);
  } catch {
    console.error('secret-scan: not a git repository and no files given');
    process.exit(0);
  }
}

const problems = [];
for (const file of files) {
  const path = file.replace(/\\/g, '/');
  if (FORBIDDEN_FILES.some((rule) => rule.test(path)) && !ALLOWED_FILES.some((rule) => rule.test(path))) {
    problems.push(`${path}: local config/secret file must not be committed`);
    continue;
  }
  if (!existsSync(file)) continue;
  const buffer = readFileSync(file);
  if (buffer.includes(0)) continue; // binary sample files
  const text = buffer.toString('utf8');
  for (const rule of RULES) {
    if (rule.pattern.test(text)) problems.push(`${path}: ${rule.name}`);
  }
}

if (problems.length > 0) {
  console.error('secret-scan: refusing, found:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`secret-scan: ${files.length} file(s) clean`);
