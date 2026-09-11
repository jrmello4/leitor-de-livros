import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function buildLatestManifest({ version, versionCode, apkName, repository, notes }) {
  const cleanVersion = String(version ?? '').trim();
  if (!cleanVersion) {
    throw new Error('A version is required to build the update manifest.');
  }
  const code = Number(versionCode);
  if (!Number.isInteger(code) || code <= 0) {
    throw new Error(`versionCode must be a positive integer, got ${String(versionCode)}.`);
  }
  if (!/\.apk$/.test(String(apkName ?? ''))) {
    throw new Error(`apkName must be an .apk file, got ${String(apkName)}.`);
  }
  if (!/^[^/]+\/[^/]+$/.test(String(repository ?? ''))) {
    throw new Error(`repository must look like owner/repo, got ${String(repository)}.`);
  }
  return {
    version: cleanVersion,
    versionCode: code,
    url: `https://github.com/${repository}/releases/download/android-latest/${apkName}`,
    notes: String(notes ?? ''),
  };
}

async function main() {
  const [, , apkName, versionCodeArg, notesArg] = process.argv;
  if (!apkName) {
    console.error('Usage: node make-latest-json.mjs <apkName> [versionCode] [notes] [--out <path>]');
    process.exitCode = 1;
    return;
  }
  const outFlag = process.argv.indexOf('--out');
  const outPath = outFlag >= 0 ? process.argv[outFlag + 1] : 'latest.json';
  if (outFlag >= 0 && !outPath) {
    console.error('Missing value for --out.');
    process.exitCode = 1;
    return;
  }
  const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
  const versionCode = versionCodeArg ?? process.env.ANDROID_VERSION_CODE;
  const manifest = buildLatestManifest({
    version: packageJson.version,
    versionCode,
    apkName,
    repository: process.env.GITHUB_REPOSITORY ?? 'jrmello4/leitor-de-livros',
    notes: notesArg ?? process.env.RELEASE_NOTES ?? '',
  });
  await writeFile(resolve(process.cwd(), outPath), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${outPath} for v${manifest.version} (code ${manifest.versionCode}).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
