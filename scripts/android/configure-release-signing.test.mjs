import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildKeystoreProperties,
  patchSigningConfig,
  setVersionCode,
} from './configure-release-signing.mjs';

const SAMPLE_GRADLE = `import org.gradle.api.tasks.testing.Test
android {
    defaultConfig {
        applicationId = "com.example"
    }
    buildTypes {
        getByName("release") {
            isMinifyEnabled = true
        }
    }
}
`;

describe('configure-release-signing', () => {
  it('builds keystore.properties without leaking secrets to stdout', () => {
    const text = buildKeystoreProperties({ alias: 'alias', password: 'pw', storeFile: '/tmp/ks' });
    assert.match(text, /keyAlias=alias/);
    assert.match(text, /storeFile=\/tmp\/ks/);
  });

  it('rejects empty signing inputs', () => {
    assert.throws(() => buildKeystoreProperties({ alias: '', password: 'pw', storeFile: '/tmp/ks' }));
  });

  it('patches the Gradle signing config exactly once', () => {
    const first = patchSigningConfig(SAMPLE_GRADLE);
    assert.equal(first.changed, true);
    assert.match(first.text, /android-release-signing/);
    assert.match(first.text, /import java\.io\.FileInputStream/);
    assert.match(first.text, /import java\.util\.Properties/);
    assert.match(first.text, /signingConfig = signingConfigs\.getByName\("release"\)/);
    const second = patchSigningConfig(first.text);
    assert.equal(second.changed, false);
    assert.equal(second.text, first.text);
  });

  it('sets a monotonic positive versionCode', () => {
    const withCode = setVersionCode('versionCode = 41', 42);
    assert.match(withCode, /versionCode = 42/);
    const inserted = setVersionCode(SAMPLE_GRADLE, 7);
    assert.match(inserted, /versionCode = 7/);
    assert.throws(() => setVersionCode(SAMPLE_GRADLE, 0));
    assert.throws(() => setVersionCode(SAMPLE_GRADLE, 'abc'));
  });
});
