import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const workflowPath = resolve(process.cwd(), '.github/workflows/ci.yml');
const source = await readFile(workflowPath, 'utf8');
const workflow = parse(source);
const jobs = workflow?.jobs ?? {};
const requiredJobs = ['web', 'native', 'visual', 'installer-smoke', 'performance'];

for (const jobName of requiredJobs) {
  assert.ok(jobs[jobName], 'Missing CI job: ' + jobName);
}

const visualText = JSON.stringify(jobs.visual);
const webText = JSON.stringify(jobs.web);
const installerText = JSON.stringify(jobs['installer-smoke']);
const performanceText = JSON.stringify(jobs.performance);
assert.match(visualText, /npm run test:visual/, 'Visual job does not run the visual matrix.');
assert.match(webText, /npm run test:installed-app-harness/, 'Normal PR CI does not run the installed-app harness contract.');
assert.match(webText, /npm run test:performance-contract/, 'Normal PR CI does not run the performance contract.');
assert.match(installerText, /npm run test:installer-smoke/, 'Installer smoke job does not run the smoke script.');
assert.match(performanceText, /npm run test:performance/, 'Performance job does not run the performance script.');
assert.ok(workflow?.on?.workflow_dispatch?.inputs?.performance_gpu_class, 'Performance workflow input is missing.');
assert.doesNotMatch(source, /gh release|softprops\/action-gh-release|release-publish|create-release/i, 'CI workflow contains a release publishing action.');

console.log('CI workflow structure is valid: ' + requiredJobs.join(', ') + '.');

// The release workflow is what puts an installer in a reader's hands, so the
// properties that make that download trustworthy are asserted too.
const releasePath = resolve(process.cwd(), '.github/workflows/release.yml');
const releaseSource = await readFile(releasePath, 'utf8');
const release = parse(releaseSource);
const releaseJob = release?.jobs?.windows;

assert.ok(releaseJob, 'Release workflow is missing the windows job.');
assert.deepEqual(release?.on?.push?.tags, ['v*'], 'Release workflow does not trigger on version tags.');
assert.equal(release?.permissions?.contents, 'write', 'Release workflow cannot publish without contents: write.');

const releaseJobText = JSON.stringify(releaseJob);
assert.match(releaseJobText, /check-version\.mjs/, 'Release does not check the tag against the manifests.');
assert.match(releaseJobText, /npm run test:installer-smoke/, 'Release does not gate on the installer smoke test.');
assert.match(releaseJobText, /npm run tauri:build/, 'Release does not build the installer.');
assert.match(releaseJobText, /sha256sum/, 'Release does not publish a checksum beside the installer.');
assert.match(releaseJobText, /softprops\/action-gh-release/, 'Release does not publish a GitHub release.');

const smokeIndex = releaseJob.steps.findIndex((step) => /test:installer-smoke/.test(JSON.stringify(step)));
const buildIndex = releaseJob.steps.findIndex((step) => /tauri:build/.test(JSON.stringify(step)));
const publishIndex = releaseJob.steps.findIndex((step) => /action-gh-release/.test(JSON.stringify(step)));
assert.ok(smokeIndex >= 0 && buildIndex > smokeIndex, 'Release builds before it proves the app installs.');
assert.ok(publishIndex > buildIndex, 'Release publishes before it builds.');

console.log('Release workflow structure is valid: tag check, smoke gate, build, checksum, publish.');
