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

  it('keeps idle page geometry centered without collapsing the turned sheet into the static DOM plan', () => {
    const plan = buildRenderPlan({
      pages: [pages[0]],
      preloadPages: pages,
      direction: 'ltr',
      mode: 'single',
      reducedMotion: false,
    }, 700, 1000);

    expect(plan[0]).toMatchObject({
      x: 0,
      y: 0,
      width: 700,
      height: 1000,
      shade: 0,
    });
  });

  it('keeps the same full layout regardless of reduced motion because deformation belongs to PageTurnSurface', () => {
    const animated = buildRenderPlan({
      pages: [pages[0]],
      preloadPages: pages,
      direction: 'ltr',
      mode: 'single',
      reducedMotion: false,
    }, 700, 1000);
    const reduced = buildRenderPlan({
      pages: [pages[0]],
      preloadPages: pages,
      direction: 'ltr',
      mode: 'single',
      reducedMotion: true,
    }, 700, 1000);

    expect(animated).toEqual(reduced);
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
