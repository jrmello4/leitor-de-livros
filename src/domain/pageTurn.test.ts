import { describe, expect, it, vi } from 'vitest';
import { PageTurnController, releaseOutcome } from './pageTurn';

describe('releaseOutcome', () => {
  it.each([
    [0.45, 0, 'commit'],
    [0.12, 0.65, 'commit'],
    [0.119, 2, 'cancel'],
    [0.449, 0.649, 'cancel'],
  ] as const)('uses displacement=%s and velocity=%s', (displacement, velocity, expected) => {
    expect(releaseOutcome(displacement, velocity)).toBe(expected);
  });
});

it('navigates once only after committed settling finishes', () => {
  const navigate = vi.fn();
  const controller = new PageTurnController({ navigate });
  const generation = controller.request('forward', false);
  controller.texturesReady(generation);
  controller.beginPointer(generation, 7, { x: 1, y: 0.5 }, 0);
  controller.movePointer(7, { x: 0.4, y: 0.5 }, 16);
  controller.releasePointer(7, 20);
  expect(navigate).not.toHaveBeenCalled();
  controller.finishSettle(generation);
  controller.finishSettle(generation);
  expect(navigate).toHaveBeenCalledTimes(1);
});

it('emits prepare and release-pointer through the controller effect path', () => {
  const effects: string[] = [];
  const controller = new PageTurnController({
    effect: (effect) => effects.push(effect.type),
    navigate: vi.fn(),
  });

  const generation = controller.request('forward', false);
  controller.texturesReady(generation);
  controller.beginPointer(generation, 7, { x: 1, y: 0.5 }, 0);
  controller.movePointer(7, { x: 0.4, y: 0.5 }, 16);
  controller.releasePointer(7, 20);

  expect(effects).toContain('prepare');
  expect(effects).toContain('release-pointer');
});

it('cancels a fast motion away from the destination and commits a signed fling toward it', () => {
  const awayNavigate = vi.fn();
  const away = new PageTurnController({ effect: vi.fn(), navigate: awayNavigate });
  const awayGeneration = away.request('forward', false);
  away.texturesReady(awayGeneration);
  away.beginPointer(awayGeneration, 1, { x: 0.2, y: 0.5 }, 0);
  away.movePointer(1, { x: 0.74, y: 0.5 }, 10);
  away.releasePointer(1, 20);
  away.finishSettle(awayGeneration);
  expect(awayNavigate).not.toHaveBeenCalled();

  const flingNavigate = vi.fn();
  const fling = new PageTurnController({ effect: vi.fn(), navigate: flingNavigate });
  const flingGeneration = fling.request('forward', false);
  fling.texturesReady(flingGeneration);
  fling.beginPointer(flingGeneration, 2, { x: 0.9, y: 0.5 }, 0);
  fling.movePointer(2, { x: 0.76, y: 0.5 }, 100);
  fling.releasePointer(2, 200);
  fling.finishSettle(flingGeneration);
  expect(flingNavigate).toHaveBeenCalledTimes(1);
});

it('rejects a stale texture generation and counts the turns asked for while one runs', () => {
  const navigate = vi.fn();
  const controller = new PageTurnController({ navigate });
  const first = controller.request('forward', false);
  controller.request('forward', false);
  controller.request('forward', false);
  controller.texturesReady(first + 1);
  expect(controller.snapshot().phase).toBe('preparing');

  controller.cancel('publication-change');

  // Two turns were asked for while the first ran. One of them takes its page at
  // once and the other animates, so no request is lost.
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(controller.snapshot()).toMatchObject({ phase: 'preparing', direction: 'forward' });
});

it('lets a turn back cancel the turn forward a reader just asked for', () => {
  const navigate = vi.fn();
  const controller = new PageTurnController({ navigate });
  controller.request('forward', false);
  controller.request('forward', false);
  controller.request('backward', false);

  controller.cancel('publication-change');

  expect(navigate).not.toHaveBeenCalled();
  expect(controller.snapshot().phase).toBe('idle');
});
