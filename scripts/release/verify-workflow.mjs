import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const ciPath = resolve(process.cwd(), '.github/workflows/ci.yml');
const ciSource = await readFile(ciPath, 'utf8');
const ciWorkflow = parse(ciSource);
const jobs = ciWorkflow?.jobs ?? {};
const requiredJobs = ['web', 'native', 'visual'];

for (const jobName of requiredJobs) {
  assert.ok(jobs[jobName], 'Missing CI job: ' + jobName);
}

const visualText = JSON.stringify(jobs.visual);
const webText = JSON.stringify(jobs.web);
assert.match(visualText, /npm run test:visual/, 'Visual job does not run the visual matrix.');
assert.match(webText, /npm run test:performance-contract/, 'Normal PR CI does not run the performance contract.');
assert.ok(!/installer-smoke|nsis|tauri:build/.test(ciSource), 'CI must not build a Windows installer.');
assert.doesNotMatch(ciSource, /gh release|softprops\/action-gh-release|release-publish|create-release/i, 'CI workflow contains a release publishing action.');

console.log('CI workflow structure is valid: ' + requiredJobs.join(', ') + '.');

// Rolling Android release: every push to main builds a signed APK and refreshes
// the `android-latest` release that the in-app updater reads.
const releasePath = resolve(process.cwd(), '.github/workflows/release-android.yml');
const releaseSource = await readFile(releasePath, 'utf8');
const releaseWorkflow = parse(releaseSource);

const triggers = releaseWorkflow?.on ?? releaseWorkflow?.[true];
const branches = triggers?.push?.branches ?? [];
assert.ok(branches.includes('main'), 'Release workflow must run on pushes to main.');
assert.equal(releaseWorkflow?.permissions?.contents, 'write', 'Release workflow needs contents:write to publish the APK.');
assert.match(releaseSource, /tauri -- android build --apk/, 'Release workflow must build Android APKs.');
assert.match(releaseSource, /configure-release-signing\.mjs/, 'Release workflow must use the versioned signing script.');
assert.match(releaseSource, /ANDROID_KEY_BASE64/, 'Release workflow must read the keystore from secrets.');
assert.match(releaseSource, /android-latest/, 'Release workflow must publish the rolling android-latest release.');
assert.match(releaseSource, /latest\.json/, 'Release workflow must publish the update manifest.');
assert.match(releaseSource, /versionCode|version-code|ANDROID_VERSION_CODE/, 'Release workflow must bump the Android versionCode per build.');
assert.match(releaseSource, /apksigner.*verify/, 'Release workflow must verify the APK signature.');

const signingScript = await readFile(resolve(process.cwd(), 'scripts/android/configure-release-signing.mjs'), 'utf8');
assert.match(signingScript, /android-release-signing/, 'Signing script must carry the Gradle marker.');
assert.match(signingScript, /import java\.io\.FileInputStream/, 'Signing script must import FileInputStream (the Gradle Kotlin DSL shadows the java package).');
assert.match(signingScript, /versionCode/, 'Signing script must manage versionCode.');

const updaterSource = await readFile(resolve(process.cwd(), 'src/services/updater.ts'), 'utf8');
assert.match(
  updaterSource,
  /releases\/download\/android-latest\/latest\.json/,
  'The in-app updater must point at the rolling android-latest manifest.',
);
assert.match(updaterSource, /shouldOfferUpdate/, 'The updater must compare versionCodes for same-version rolling builds.');

console.log('Android release workflow structure is valid.');
