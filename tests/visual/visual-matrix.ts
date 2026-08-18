import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { VisualBackend } from '../../src/release/testModes';
export type VisualScenarioName =
  | 'single-ltr'
  | 'spread-ltr'
  | 'single-rtl'
  | 'fullscreen'
  | 'boundary'
  | 'cancelled-turn'
  | 'reduced-motion'
  | 'static-fallback'
  | 'webgl2'
  | 'webgpu';

export interface VisualProfile {
  mode: 'single' | 'spread';
  direction: 'ltr' | 'rtl';
  reducedMotion: boolean;
  pageTurnDuration: number;
}

export interface VisualScenario {
  name: VisualScenarioName;
  profile: VisualProfile;
  backend: VisualBackend;
}

export interface VisualEvidence {
  scenario: VisualScenarioName;
  viewport: { name: string; width: number; height: number };
  profile: VisualProfile;
  requestedBackend: VisualBackend;
  actualBackend: string;
  status: 'passed' | 'skipped' | 'failed';
  skipReason?: string;
  screenshot?: string;
}

const bindings = {
  next_page: ['ArrowRight', 'PageDown'],
  previous_page: ['ArrowLeft', 'PageUp'],
  toggle_library: ['KeyL'],
  toggle_fullscreen: ['KeyF'],
  toggle_settings: ['KeyS'],
  toggle_spread: ['KeyM'],
  toggle_navigator: ['KeyN'],
  toggle_bookmark: ['KeyB'],
  cancel: ['Escape'],
};

export const visualScenarios: readonly VisualScenario[] = [
  { name: 'single-ltr', profile: { mode: 'single', direction: 'ltr', reducedMotion: false, pageTurnDuration: 420 }, backend: 'auto' },
  { name: 'spread-ltr', profile: { mode: 'spread', direction: 'ltr', reducedMotion: false, pageTurnDuration: 420 }, backend: 'auto' },
  { name: 'single-rtl', profile: { mode: 'single', direction: 'rtl', reducedMotion: false, pageTurnDuration: 420 }, backend: 'auto' },
  { name: 'fullscreen', profile: { mode: 'single', direction: 'ltr', reducedMotion: false, pageTurnDuration: 420 }, backend: 'auto' },
  { name: 'boundary', profile: { mode: 'single', direction: 'ltr', reducedMotion: false, pageTurnDuration: 420 }, backend: 'auto' },
  { name: 'cancelled-turn', profile: { mode: 'single', direction: 'ltr', reducedMotion: false, pageTurnDuration: 420 }, backend: 'auto' },
  { name: 'reduced-motion', profile: { mode: 'single', direction: 'ltr', reducedMotion: true, pageTurnDuration: 120 }, backend: 'auto' },
  { name: 'static-fallback', profile: { mode: 'single', direction: 'ltr', reducedMotion: false, pageTurnDuration: 420 }, backend: 'static' },
  { name: 'webgl2', profile: { mode: 'single', direction: 'ltr', reducedMotion: false, pageTurnDuration: 420 }, backend: 'webgl2' },
  { name: 'webgpu', profile: { mode: 'single', direction: 'ltr', reducedMotion: false, pageTurnDuration: 420 }, backend: 'webgpu' },
];

export const visualViewports = [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'narrow', width: 1000, height: 720 },
] as const;

interface VisualSummary {
  version: 1;
  records: VisualEvidence[];
}

export function visualArtifactDirectory(): string {
  return resolve(process.env.VISUAL_ARTIFACT_DIR ?? 'artifacts/visual');
}

export function visualSummaryPath(): string {
  return join(visualArtifactDirectory(), 'visual-summary.json');
}

export function visualScreenshotPath(viewportName: string, scenarioName: VisualScenarioName): string {
  return join(visualArtifactDirectory(), viewportName, scenarioName + '.png');
}

export async function resetVisualEvidence(): Promise<void> {
  const directory = visualArtifactDirectory();
  await mkdir(directory, { recursive: true });
  const summary: VisualSummary = { version: 1, records: [] };
  await writeFile(visualSummaryPath(), JSON.stringify(summary, null, 2) + '\n', 'utf8');
}

export async function writeVisualEvidence(record: VisualEvidence): Promise<void> {
  const directory = visualArtifactDirectory();
  await mkdir(directory, { recursive: true });
  let summary: VisualSummary = { version: 1, records: [] };
  try {
    const parsed = JSON.parse(await readFile(visualSummaryPath(), 'utf8')) as Partial<VisualSummary>;
    if (parsed.version === 1 && Array.isArray(parsed.records)) {
      summary = { version: 1, records: parsed.records };
    }
  } catch {
    // A missing summary is normal on the first matrix record.
  }
  summary.records.push(record);
  await writeFile(visualSummaryPath(), JSON.stringify(summary, null, 2) + '\n', 'utf8');
}

export function visualProfileStore(profile: VisualProfile) {
  return {
    version: 2,
    activeProfileId: 'visual-matrix',
    profiles: [{
      id: 'visual-matrix',
      version: 1,
      name: 'Visual Matrix',
      mode: profile.mode,
      direction: profile.direction,
      contrast: 'standard',
      reducedMotion: profile.reducedMotion,
      pageTurnDuration: profile.pageTurnDuration,
      layoutZone: 'top',
      zoomMode: 'page',
      zoomScale: 1,
      bindings,
    }],
  };
}
