import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectVersions, disagreements, versionFromTag } from './check-version.mjs';

test('accepts a release tag and rejects anything else', () => {
  assert.equal(versionFromTag('v0.1.0'), '0.1.0');
  assert.equal(versionFromTag('v1.2.3-rc.1'), '1.2.3-rc.1');
  assert.equal(versionFromTag('0.1.0'), undefined);
  assert.equal(versionFromTag('latest'), undefined);
  assert.equal(versionFromTag(''), undefined);
  assert.equal(versionFromTag(undefined), undefined);
});

test('names every manifest that disagrees with the release version', () => {
  const versions = {
    'package.json': '0.1.0',
    'src-tauri/tauri.conf.json': '0.2.0',
    'src-tauri/Cargo.toml': undefined,
  };

  const problems = disagreements(versions, '0.1.0');

  assert.equal(problems.length, 2);
  assert.match(problems.join(' '), /tauri\.conf\.json declares 0\.2\.0/);
  assert.match(problems.join(' '), /Cargo\.toml declares nothing/);
});

test('the manifests in this repository agree with each other', async () => {
  const versions = await collectVersions();
  const expected = versions['package.json'];

  assert.ok(expected, 'package.json must declare a version');
  assert.deepEqual(disagreements(versions, expected), []);
});
