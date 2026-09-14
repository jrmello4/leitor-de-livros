import { readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Travas do bundle inicial (bytes, tamanho bruto).
 * Referência 14/09/2026 após o ReaderView lazy: entry ~350KB, CSS ~85KB,
 * JS total ~495KB, maior chunk lazy ~110KB. As travas têm folga de ~8-15%
 * para não quebrar com variação normal de build; derrubá-las exige decisão.
 */
export const BUNDLE_BUDGETS = {
  /** Chunk inicial (index-*.js): o que a biblioteca carrega no cold start. */
  entryJs: 380 * 1024,
  /** Todo o JS (inicial + lazy): teto do app completo. */
  totalJs: 560 * 1024,
  /** Cada chunk lazy isolado (ex.: ReaderView). */
  anyChunkJs: 130 * 1024,
  /** CSS total empacotado. */
  totalCss: 100 * 1024,
};

export function evaluateBundleBudget(files) {
  const js = files.filter((file) => file.name.endsWith('.js'));
  const css = files.filter((file) => file.name.endsWith('.css'));
  const entry = js.find((file) => /(^|\/)index-[^/]*\.js$/.test(file.name));
  const totalJs = js.reduce((sum, file) => sum + file.bytes, 0);
  const totalCss = css.reduce((sum, file) => sum + file.bytes, 0);
  const violations = [];
  if (!entry) {
    violations.push('entry chunk index-*.js not found in dist/assets');
  } else if (entry.bytes > BUNDLE_BUDGETS.entryJs) {
    violations.push(`entry ${entry.name} is ${entry.bytes} bytes, budget is ${BUNDLE_BUDGETS.entryJs}`);
  }
  if (totalJs > BUNDLE_BUDGETS.totalJs) {
    violations.push(`total JS is ${totalJs} bytes, budget is ${BUNDLE_BUDGETS.totalJs}`);
  }
  for (const file of js) {
    if (file !== entry && file.bytes > BUNDLE_BUDGETS.anyChunkJs) {
      violations.push(`lazy chunk ${file.name} is ${file.bytes} bytes, budget is ${BUNDLE_BUDGETS.anyChunkJs}`);
    }
  }
  if (totalCss > BUNDLE_BUDGETS.totalCss) {
    violations.push(`total CSS is ${totalCss} bytes, budget is ${BUNDLE_BUDGETS.totalCss}`);
  }
  return {
    passed: violations.length === 0,
    violations,
    totals: {
      entryJs: entry?.bytes ?? 0,
      totalJs,
      totalCss,
      chunks: js.length,
    },
  };
}

export async function readDistFiles(distDir) {
  const assetsDir = join(distDir, 'assets');
  const entries = await readdir(assetsDir);
  const files = [];
  for (const name of entries) {
    if (!/\.(js|css)$/.test(name)) continue;
    const { size } = await stat(join(assetsDir, name));
    files.push({ name, bytes: size });
  }
  return files;
}

async function main() {
  const distDir = resolve(process.argv[2] ?? join(repositoryRoot, 'dist'));
  let files;
  try {
    files = await readDistFiles(distDir);
  } catch {
    console.error(`dist not found at ${distDir}. Run 'npm run build' first.`);
    process.exitCode = 1;
    return;
  }
  const result = evaluateBundleBudget(files);
  console.log(`entry: ${result.totals.entryJs} B (budget ${BUNDLE_BUDGETS.entryJs})`);
  console.log(`total JS: ${result.totals.totalJs} B in ${result.totals.chunks} chunks (budget ${BUNDLE_BUDGETS.totalJs})`);
  console.log(`total CSS: ${result.totals.totalCss} B (budget ${BUNDLE_BUDGETS.totalCss})`);
  if (!result.passed) {
    for (const violation of result.violations) {
      console.error(`BUDGET VIOLATION: ${violation}`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
