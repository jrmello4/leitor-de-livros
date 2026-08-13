import { describe, expect, it } from 'vitest';
import { createPageSelectionCoordinator, selectLatestPage } from './pageSelection';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('race-safe page selection', () => {
  it('commits only the newest page when preparation resolves out of order', async () => {
    const coordinator = createPageSelectionCoordinator();
    const first = deferred<string>();
    const second = deferred<string>();
    const committed: string[] = [];

    const olderSelection = selectLatestPage(
      coordinator,
      'publication-1',
      1,
      () => first.promise,
      (page) => { committed.push(page); },
    );
    const newerSelection = selectLatestPage(
      coordinator,
      'publication-1',
      2,
      () => second.promise,
      (page) => { committed.push(page); },
    );

    second.resolve('page-3');
    expect(await newerSelection).toBe(true);
    first.resolve('page-2');
    expect(await olderSelection).toBe(false);
    expect(committed).toEqual(['page-3']);
  });

  it('invalidates an in-flight selection when the reader changes publication', async () => {
    const coordinator = createPageSelectionCoordinator();
    const preparation = deferred<string>();
    const committed: string[] = [];

    const selection = selectLatestPage(
      coordinator,
      'publication-1',
      4,
      () => preparation.promise,
      (page) => { committed.push(page); },
    );

    coordinator.cancel();
    preparation.resolve('page-5');

    expect(await selection).toBe(false);
    expect(committed).toEqual([]);
  });

  it('waits for an asynchronous commit before completing the selection', async () => {
    const coordinator = createPageSelectionCoordinator();
    const commit = deferred<void>();
    let completed = false;

    const selection = selectLatestPage(
      coordinator,
      'publication-1',
      1,
      async () => 'page-2',
      async () => {
        await commit.promise;
        completed = true;
      },
    );

    await Promise.resolve();
    expect(completed).toBe(false);
    commit.resolve();
    expect(await selection).toBe(true);
    expect(completed).toBe(true);
  });
});
