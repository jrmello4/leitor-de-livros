import { describe, expect, it } from 'vitest';
import type { PageDescriptor } from '../domain/types';
import { backendCandidates, buildRenderPlan, PAGE_TURN_LUMINANCE_BOUNDS } from './contracts';
import { adaptRenderQuality, FrameTelemetry } from './telemetry';

const pages: PageDescriptor[] = [
  { id: 'one', index: 0, name: 'one.png', src: 'one', width: 700, height: 1000 },
  { id: 'two', index: 1, name: 'two.png', src: 'two', width: 700, height: 1000 },
];

describe('reader renderer contracts', () => {
  it('selects GPU backends in order and always keeps a static route', () => {
    expect(backendCandidates(true, true)).toEqual(['webgpu', 'webgl2', 'static']);
    expect(backendCandidates(false, true)).toEqual(['webgl2', 'static']);
    expect(backendCandidates(false, false)).toEqual(['static']);
  });

  it('keeps page geometry centered and folds from the reading edge', () => {
    const ltr = buildRenderPlan({
      pages: [pages[0]],
      preloadPages: pages,
      turningPageId: 'one',
      direction: 'ltr',
      mode: 'single',
      turnProgress: 0.5,
      reducedMotion: false,
    }, 700, 1000);
    const rtl = buildRenderPlan({
      pages: [pages[0]],
      preloadPages: pages,
      turningPageId: 'one',
      direction: 'rtl',
      mode: 'single',
      turnProgress: 0.5,
      reducedMotion: false,
    }, 700, 1000);

    expect(ltr[0].width).toBeLessThan(700);
    expect(ltr[0].x).toBeGreaterThan(rtl[0].x);
    expect(ltr[0].shade).toBe(0.5);
  });

  it('reduces quality before it accepts a sustained low frame rate', () => {
    const telemetry = new FrameTelemetry(4);
    telemetry.record(0);
    telemetry.record(25);
    telemetry.record(50);
    telemetry.record(75);
    const snapshot = telemetry.record(100);

    expect(snapshot?.fps).toBe(40);
    expect(adaptRenderQuality('rich', snapshot?.fps ?? 60)).toBe('balanced');
    expect(adaptRenderQuality('balanced', 40)).toBe('essential');
    expect(adaptRenderQuality('essential', 60)).toBe('balanced');
  });

  it('exports the approved physical page-turn luminance bounds', () => {
    expect(PAGE_TURN_LUMINANCE_BOUNDS).toEqual({ minimum: 0.72, maximum: 1.08 });
  });

});
