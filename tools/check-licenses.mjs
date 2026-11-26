// Checks the licence of every production dependency (the code that ships to the browser).
// Allowed: MIT, Apache-2.0, BSD-*, 0BSD, and ISC (accepted by the project owner on 2026-11-26
// for packages that Firebase brings in). Warned (permissive, listed for review): other permissive
// licences. Fails on GPL/LGPL/AGPL/MPL/EPL/CDDL/SSPL, unknown or missing licences.
// Usage: node tools/check-licenses.mjs  (exit code 1 on failure)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const ALLOWED = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'ISC']);
const PERMISSIVE_WARN = new Set(['BSD', 'Unlicense', 'CC0-1.0', 'BlueOak-1.0.0', 'Python-2.0', 'Zlib', 'CC-BY-4.0']);
const FORBIDDEN = /\b(A?GPL|LGPL|MPL|EPL|CDDL|SSPL|EUPL|OSL|CPAL)\b/i;

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let listing;
try {
  listing = execFileSync(npm, ['ls', '--omit=dev', '--all', '--parseable'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
} catch (error) {
  // npm ls exits non-zero on extraneous/invalid packages but still prints the tree.
  listing = error.stdout ?? '';
}
const dirs = [...new Set(listing.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))].filter((d) => d !== root && existsSync(join(d, 'package.json')));

function licenceOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => (typeof l === 'string' ? l : l.type)).join(' OR ');
  return undefined;
}

/** Evaluates an SPDX expression: OR takes the best option, AND takes the worst. */
function classify(expression) {
  if (!expression) return 'fail';
  const expr = expression.replace(/[()]/g, ' ').trim();
  if (/\sOR\s/i.test(expr)) {
    const results = expr.split(/\s+OR\s+/i).map(classify);
    return results.includes('ok') ? 'ok' : results.includes('warn') ? 'warn' : 'fail';
  }
  if (/\sAND\s/i.test(expr)) {
    const results = expr.split(/\s+AND\s+/i).map(classify);
    return results.includes('fail') ? 'fail' : results.includes('warn') ? 'warn' : 'ok';
  }
  const id = expr.trim();
  if (FORBIDDEN.test(id)) return 'fail';
  if (ALLOWED.has(id)) return 'ok';
  if (PERMISSIVE_WARN.has(id)) return 'warn';
  return 'fail';
}

const rows = [];
for (const dir of dirs) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const licence = licenceOf(pkg);
  rows.push({ name: pkg.name, version: pkg.version, licence: licence ?? '(none)', result: classify(licence), path: relative(root, dir) });
}
rows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const counts = new Map();
for (const r of rows) counts.set(r.licence, (counts.get(r.licence) ?? 0) + 1);
console.log(`Production dependency licences (${rows.length} packages):`);
for (const [licence, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${licence.padEnd(28)} ${n}`);

const warned = rows.filter((r) => r.result === 'warn');
const failed = rows.filter((r) => r.result === 'fail');
if (warned.length) {
  console.log(`\nWARN: ${warned.length} package(s) with other permissive licences (allowed, listed for review):`);
  for (const r of warned) console.log(`  ${r.name}@${r.version}  ${r.licence}`);
}
if (failed.length) {
  console.log(`\nFAIL: ${failed.length} package(s) with a forbidden, unknown or missing licence:`);
  for (const r of failed) console.log(`  ${r.name}@${r.version}  ${r.licence}  (${r.path})`);
  process.exit(1);
}
console.log('\nOK: no GPL/LGPL/AGPL/MPL or unknown licences in production dependencies.');
