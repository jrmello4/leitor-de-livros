import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Decides whether a smoke run is allowed to gate a release.
 *
 * A run that fails while exercising the app found a real problem and must stop
 * the release. A run that never got that far — the runner could not install,
 * launch or reach the app — proved nothing, and publishing an unverified
 * installer on the strength of "the test did not fail" is worse than not
 * testing at all. Both stop the release by default; only a person can choose to
 * publish from a runner that cannot drive the app.
 */
export const ENVIRONMENT_STAGES = Object.freeze(['discovery', 'installation', 'launch', 'connection']);

export function gateDecision(result, { allowUntestedRunner = false } = {}) {
  if (!result || typeof result !== 'object') {
    return { publish: false, reason: 'No installer smoke result was produced.' };
  }
  if (result.status === 'passed') {
    return { publish: true, reason: 'Installer smoke passed.' };
  }
  const stage = result.stage;
  const failure = result.failure ?? 'unknown failure';
  if (ENVIRONMENT_STAGES.includes(stage)) {
    return allowUntestedRunner
      ? { publish: true, untested: true, reason: `Runner could not drive the app (${stage}: ${failure}). Publishing was explicitly allowed.` }
      : { publish: false, reason: `Runner could not drive the app (${stage}: ${failure}). This proves nothing about the build. Re-run on a runner with a desktop session, or set allow_untested_runner to publish anyway.` };
  }
  return { publish: false, reason: `Installer smoke failed while exercising the app (${stage ?? 'execution'}: ${failure}).` };
}

export async function newestSmokeResult(evidenceRoot) {
  let entries;
  try {
    entries = await readdir(evidenceRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const runs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  for (const run of runs.reverse()) {
    try {
      return JSON.parse(await readFile(join(evidenceRoot, run, 'result.json'), 'utf8'));
    } catch {
      // Try the next most recent run.
    }
  }
  return undefined;
}

async function main() {
  const evidenceRoot = resolve(process.env.SMOKE_EVIDENCE_DIR ?? 'artifacts/installer-smoke');
  const allowUntestedRunner = /^(1|true|yes)$/i.test(String(process.env.ALLOW_UNTESTED_RUNNER ?? ''));
  const decision = gateDecision(await newestSmokeResult(evidenceRoot), { allowUntestedRunner });

  console.log(decision.reason);
  if (decision.untested) {
    console.log('::warning::Publishing an installer that was not verified on this runner.');
  }
  if (!decision.publish) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
