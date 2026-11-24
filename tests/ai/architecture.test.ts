import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const srcDir = join(root, 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(srcDir).map((path) => ({ path: relative(root, path).replace(/\\/g, '/'), text: readFileSync(path, 'utf8') }));
const filesMatching = (pattern: RegExp): string[] => files.filter((f) => pattern.test(f.text)).map((f) => f.path).sort();

describe('architecture: the cloud gate is the only way to the cloud', () => {
  it('models are created only in the two model factories', () => {
    expect(filesMatching(/getGenerativeModel\s*\(/)).toEqual(['src/ai/cloud-model.ts', 'src/ai/models.ts']);
    expect(filesMatching(/\.generateContent\s*\(/)).toEqual(['src/ai/cloud-model.ts', 'src/ai/models.ts']);
  });

  it('cloud inference mode appears only in the cloud model factory', () => {
    expect(filesMatching(/ONLY_IN_CLOUD/)).toEqual(['src/ai/cloud-model.ts']);
  });

  it('no PREFER_* mode anywhere (they would silently fall back between device and cloud)', () => {
    expect(filesMatching(/PREFER_ON_DEVICE|PREFER_IN_CLOUD/)).toEqual([]);
  });

  it('the cloud model factory is imported only by the composition root, which hands it to the gate', () => {
    expect(filesMatching(/from ['"][^'"]*cloud-model['"]/)).toEqual(['src/ai/index.ts']);
    const index = files.find((f) => f.path === 'src/ai/index.ts')!.text;
    const uses = index.match(/createCloudGenerate\(/g) ?? [];
    expect(uses).toHaveLength(1);
    expect(index).toMatch(/createCloudGate\(\{[\s\S]*cloudGenerate:[^\n]*createCloudGenerate\(/);
  });

  it('only the Firebase init module imports firebase/app-check, and no UI code imports firebase/ai', () => {
    expect(filesMatching(/from ['"]firebase\/app-check['"]/)).toEqual(['src/firebase/init.ts']);
    expect(files.filter((f) => f.path.startsWith('src/ui/') && /from ['"]firebase\//.test(f.text)).map((f) => f.path)).toEqual([]);
  });
});
