import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * A release is named by its tag, but the installer is named by the versions
 * baked into the manifests. If they disagree, the published asset does not match
 * the release it is attached to, so the three are checked against each other
 * before anything is built.
 */
export async function collectVersions(root = repositoryRoot) {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const tauriConf = JSON.parse(await readFile(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  const cargoToml = await readFile(join(root, 'src-tauri/Cargo.toml'), 'utf8');
  const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargoToml)?.[1];

  return {
    'package.json': packageJson.version,
    'src-tauri/tauri.conf.json': tauriConf.version,
    'src-tauri/Cargo.toml': cargoVersion,
  };
}

export function disagreements(versions, expected) {
  const entries = Object.entries(versions);
  const mismatched = entries.filter(([, version]) => version !== expected);
  return mismatched.map(([file, version]) => `${file} declares ${version ?? 'nothing'}, expected ${expected}`);
}

export function versionFromTag(tag) {
  const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(String(tag ?? '').trim());
  return match?.[1];
}

async function main() {
  const [tagArgument] = process.argv.slice(2);
  const versions = await collectVersions();
  const expected = tagArgument ? versionFromTag(tagArgument) : versions['package.json'];

  if (tagArgument && !expected) {
    console.error(`Tag ${tagArgument} is not a vMAJOR.MINOR.PATCH release tag.`);
    process.exitCode = 1;
    return;
  }

  const problems = disagreements(versions, expected);
  if (problems.length > 0) {
    console.error('Release versions disagree:\n  ' + problems.join('\n  '));
    process.exitCode = 1;
    return;
  }

  console.log(expected);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
