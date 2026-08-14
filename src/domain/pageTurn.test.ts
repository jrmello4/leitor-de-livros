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

it('rejects a stale texture generation and keeps only the latest queued turn', () => {
  const controller = new PageTurnController({ navigate: vi.fn() });
  const first = controller.request('forward', false);
  controller.request('backward', false);
  controller.request('forward', false);
  controller.texturesReady(first + 1);
  expect(controller.snapshot().phase).toBe('preparing');
  controller.cancel('publication-change');
  expect(controller.snapshot()).toMatchObject({ phase: 'preparing', direction: 'forward' });
});
