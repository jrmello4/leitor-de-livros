import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLatestManifest } from './make-latest-json.mjs';

test('builds a rolling android-latest manifest', () => {
  const manifest = buildLatestManifest({
    version: '0.1.1',
    versionCode: 42,
    apkName: 'tactile-reader-0.1.1-universal.apk',
    repository: 'jrmello4/leitor-de-livros',
    notes: 'main @ abc1234',
  });

  assert.deepEqual(manifest, {
    version: '0.1.1',
    versionCode: 42,
    url: 'https://github.com/jrmello4/leitor-de-livros/releases/download/android-latest/tactile-reader-0.1.1-universal.apk',
    notes: 'main @ abc1234',
  });
});

test('rejects a non-positive versionCode', () => {
  assert.throws(
    () =>
      buildLatestManifest({
        version: '0.1.1',
        versionCode: 0,
        apkName: 'app.apk',
        repository: 'o/r',
        notes: '',
      }),
    /versionCode/,
  );
});

test('rejects a non-apk artifact', () => {
  assert.throws(
    () =>
      buildLatestManifest({
        version: '0.1.1',
        versionCode: 3,
        apkName: 'app.aab',
        repository: 'o/r',
        notes: '',
      }),
    /apkName/,
  );
});
