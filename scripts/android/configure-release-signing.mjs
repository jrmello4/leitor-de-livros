import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SIGNING_MARKER = '// android-release-signing';

export function buildKeystoreProperties({ alias, password, storeFile }) {
  if (!alias || !password || !storeFile) {
    throw new Error('keyAlias, password and storeFile are required for keystore.properties.');
  }
  return `keyAlias=${alias}\npassword=${password}\nstoreFile=${storeFile}\n`;
}

export function patchSigningConfig(gradleText) {
  let text = String(gradleText ?? '');
  // The Gradle Kotlin DSL has a `java` extension, so fully qualified
  // java.util/java.io references do not resolve: use plain imports.
  for (const importLine of ['import java.io.FileInputStream', 'import java.util.Properties']) {
    if (!text.includes(importLine)) {
      text = `${importLine}\n${text}`;
    }
  }
  if (text.includes(SIGNING_MARKER)) {
    return { text, changed: false };
  }
  const signing = `${SIGNING_MARKER}\nsigningConfigs {\n    create("release") {\n        val keystorePropertiesFile = rootProject.file("keystore.properties")\n        val keystoreProperties = Properties()\n        if (keystorePropertiesFile.exists()) {\n            keystoreProperties.load(FileInputStream(keystorePropertiesFile))\n        }\n        keyAlias = keystoreProperties["keyAlias"] as String\n        keyPassword = keystoreProperties["password"] as String\n        storeFile = file(keystoreProperties["storeFile"] as String)\n        storePassword = keystoreProperties["password"] as String\n    }\n}\n`;
  if (!text.includes('buildTypes {')) {
    throw new Error('build.gradle.kts does not contain a buildTypes block to patch.');
  }
  text = text.replace('buildTypes {', `${signing}buildTypes {`, 1);
  if (!text.includes('getByName("release") {')) {
    throw new Error('build.gradle.kts does not contain a release build type to sign.');
  }
  text = text.replace(
    'getByName("release") {',
    'getByName("release") {\n        signingConfig = signingConfigs.getByName("release")',
    1,
  );
  return { text, changed: true };
}

export function setVersionCode(gradleText, versionCode) {
  const code = Number(versionCode);
  if (!Number.isInteger(code) || code <= 0) {
    throw new Error(`versionCode must be a positive integer, got ${String(versionCode)}.`);
  }
  const text = String(gradleText ?? '');
  if (/versionCode\s*=\s*\d+/.test(text)) {
    return text.replace(/versionCode\s*=\s*\d+/, `versionCode = ${code}`);
  }
  if (!text.includes('defaultConfig {')) {
    throw new Error('build.gradle.kts has no versionCode or defaultConfig block.');
  }
  return text.replace(
    /(defaultConfig\s*\{)/,
    `$1\n        versionCode = ${code}`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const projectDir = resolve(get('--project-dir') ?? join(repositoryRoot, 'src-tauri/gen/android'));
  const versionCode = get('--version-code') ?? process.env.ANDROID_VERSION_CODE ?? process.env.GITHUB_RUN_NUMBER;
  const alias = process.env.ANDROID_KEY_ALIAS;
  const password = process.env.ANDROID_KEY_PASSWORD;
  const keystoreBase64 = process.env.ANDROID_KEY_BASE64;
  if (!alias || !password || !keystoreBase64) {
    console.error('Missing one of ANDROID_KEY_BASE64, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD secrets.');
    console.error('Follow docs/android-updater.md (Keystore) to create them, then re-run.');
    process.exitCode = 1;
    return;
  }
  if (!versionCode) {
    console.error('Missing --version-code (or ANDROID_VERSION_CODE / GITHUB_RUN_NUMBER).');
    process.exitCode = 1;
    return;
  }
  const gradlePath = join(projectDir, 'app/build.gradle.kts');
  let gradleText;
  try {
    gradleText = await readFile(gradlePath, 'utf8');
  } catch {
    console.error(`Android project not found at ${gradlePath}. Run 'npm run tauri -- android init' first.`);
    process.exitCode = 1;
    return;
  }
  const tempDir = process.env.RUNNER_TEMP || repositoryRoot;
  const keystorePath = join(tempDir, 'release.keystore');
  const { writeFile: writeBinary } = await import('node:fs/promises');
  await writeBinary(keystorePath, Buffer.from(keystoreBase64, 'base64'));
  await writeFile(
    join(projectDir, 'keystore.properties'),
    buildKeystoreProperties({ alias, password, storeFile: keystorePath }),
  );
  const patched = patchSigningConfig(gradleText);
  const versioned = setVersionCode(patched.text, versionCode);
  await writeFile(gradlePath, versioned);
  console.log(`Release signing ${patched.changed ? 'patched' : 'already present'}; versionCode set to ${versionCode}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
