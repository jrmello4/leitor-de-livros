import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const workflowPath = resolve(process.cwd(), '.github/workflows/ci.yml');
const source = await readFile(workflowPath, 'utf8');
const workflow = parse(source);
const jobs = workflow?.jobs ?? {};
const requiredJobs = ['web', 'native', 'visual', 'installer-smoke'];

for (const jobName of requiredJobs) {
  assert.ok(jobs[jobName], 'Missing CI job: ' + jobName);
}

const visualText = JSON.stringify(jobs.visual);
const installerText = JSON.stringify(jobs['installer-smoke']);
assert.match(visualText, /npm run test:visual/, 'Visual job does not run the visual matrix.');
assert.match(installerText, /npm run test:installer-smoke/, 'Installer smoke job does not run the smoke script.');
assert.doesNotMatch(source, /gh release|softprops\/action-gh-release|release-publish|create-release/i, 'CI workflow contains a release publishing action.');

console.log('CI workflow structure is valid: ' + requiredJobs.join(', ') + '.');
