import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PATCHES = [
  {
    packagePath: 'manager-pwa/node_modules/@supabase/storage-js/package.json',
    packageVersion: '2.108.0',
    path: 'manager-pwa/node_modules/@supabase/storage-js/dist/index.d.mts',
    upstreamSha256: '7679DAD9CEF1D02F8B7AD3018E3C569117FBC80467C5DF8D424C6A5B9A7411EF',
    patchedSha256: 'E8B45FD2DE62BF35E48AA85FBB17374B6CAE0C3D72444B258FFC958D506CF86F',
    changes: [
      { from: ' | Buffer', to: ' | ArrayBufferView', count: 2 },
      { from: ' | NodeJS.ReadableStream', to: '', count: 2 },
    ],
  },
  {
    packagePath: 'manager-pwa/node_modules/@supabase/phoenix/package.json',
    packageVersion: '0.4.2',
    path: 'manager-pwa/node_modules/@supabase/phoenix/priv/static/types/longpoll.d.ts',
    upstreamSha256: '32FA9041AAABB45BEE59A19CE54537C18018AD43513D1598C1525C9EDB62F3FE',
    patchedSha256: '8A5DE279D4999370DAE97D453F4E7FBE5E03BFE17AACFD1B9D7FC2321D863E6D',
    changes: [
      { from: 'NodeJS.Timeout | null', to: 'ReturnType<typeof setTimeout> | null', count: 1 },
    ],
  },
];

function hash(text) {
  return createHash('sha256').update(text).digest('hex').toUpperCase();
}

function occurrences(text, fragment) {
  return text.split(fragment).length - 1;
}

function patchedText(original, changes, label) {
  let result = original;
  for (const { from, to, count } of changes) {
    const actual = occurrences(result, from);
    if (actual !== count) throw new Error(`${label}: expected ${count} instances of ${JSON.stringify(from)}, found ${actual}`);
    result = result.replaceAll(from, to);
  }
  return result;
}

function verifyPatched(text, changes, label) {
  for (const { from, to } of changes) {
    if (occurrences(text, from) !== 0 || occurrences(text, to) === 0) {
      throw new Error(`${label}: declaration is neither the captured upstream file nor the expected browser-compatible patch`);
    }
  }
}

export function applyManagerBrowserSdkTypePatches(repositoryRoot) {
  const applied = [];
  for (const patch of PATCHES) {
    const packageFile = resolve(repositoryRoot, patch.packagePath);
    const packageInfo = JSON.parse(readFileSync(packageFile, 'utf8'));
    if (packageInfo.version !== patch.packageVersion) {
      throw new Error(`${patch.packagePath}: installed ${packageInfo.version}; patch basis is exactly ${patch.packageVersion}`);
    }
    const target = resolve(repositoryRoot, patch.path);
    const current = readFileSync(target, 'utf8');
    const currentHash = hash(current);
    if (currentHash === patch.upstreamSha256) {
      const next = patchedText(current, patch.changes, patch.path);
      if (hash(next) !== patch.patchedSha256) throw new Error(`${patch.path}: patch output hash does not match the recorded declaration correction`);
      writeFileSync(target, next);
      verifyPatched(next, patch.changes, patch.path);
      applied.push(patch.path);
    } else {
      if (currentHash !== patch.patchedSha256) throw new Error(`${patch.path}: declaration SHA-256 ${currentHash} is neither the captured upstream file nor the recorded patched file`);
      verifyPatched(current, patch.changes, patch.path);
      applied.push(`${patch.path} (already patched)`);
    }
  }
  return applied;
}

export function assertPatchSensitivity(repositoryRoot) {
  const storage = PATCHES[0];
  const packageInfo = JSON.parse(readFileSync(resolve(repositoryRoot, storage.packagePath), 'utf8'));
  if (packageInfo.version !== storage.packageVersion) throw new Error('sensitivity fixture package version mismatch');
  const pristine = readFileSync(resolve(repositoryRoot, storage.path), 'utf8');
  const weakened = pristine.replace(' | ArrayBufferView', ' | Buffer');
  let rejected = false;
  try {
    verifyPatched(weakened, storage.changes, 'sensitivity probe');
  } catch (error) {
    rejected = error instanceof Error && error.message.includes('neither the captured upstream file nor the expected browser-compatible patch');
  }
  if (!rejected) throw new Error('patch sensitivity failed to reject a declaration with the browser correction removed');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const applied = applyManagerBrowserSdkTypePatches(process.cwd());
  assertPatchSensitivity(process.cwd());
  console.log(`[manager-browser-sdk-type-patch] verified ${applied.join('; ')}`);
}
