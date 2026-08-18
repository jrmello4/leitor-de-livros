import base from './playwright.config';

export default {
  ...base,
  testDir: './tests/perf',
  outputDir: 'test-results/perf',
  reporter: [['list']],
};
