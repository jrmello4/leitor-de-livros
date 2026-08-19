import type { PageTurnScene } from '../../domain/pageTurnScene';
import type { PageDescriptor } from '../../domain/types';

export interface TextureRequest {
  src: string;
  width: number;
  height: number;
  longestSide: number;
}

export interface TextureViewport {
  width: number;
  height: number;
  dpr: number;
  backendMaxLongestSide?: number;
}

export interface TextureLoader<T> {
  load(request: TextureRequest): Promise<T>;
  dispose(handle: T): void;
}

export interface PreparedPageImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  bytes: number;
}

export interface PreparedPageTurnTextures<T> {
  bySource: Map<string, T>;
  count: number;
  bytes: number;
}

export type TexturePreparation<T> =
  | { kind: 'ready'; generation: number; textures: PreparedPageTurnTextures<T>; waitedMs: number }
  | { kind: 'slow'; generation: number; waitedMs: number }
  | { kind: 'stale'; generation: number }
  | { kind: 'error'; generation: number; message: string };

interface PageTurnTextureCacheOptions<T> {
  load: TextureLoader<T>['load'];
  dispose?: TextureLoader<T>['dispose'];
  now?: () => number;
  maxEntries?: number;
  maxLongestSide?: number;
  slowReadyMs?: number;
}

interface CachedTextureEntry<T> {
  src: string;
  handle: T;
  width: number;
  height: number;
  longestSide: number;
  bytes: number;
}

interface PendingTextureEntry<T> {
  request: TextureRequest;
  promise: Promise<CachedTextureEntry<T>>;
}

interface PreparationRecord<T> {
  generation: number;
  signature: string;
  startedAt: number;
  readyPromise: Promise<Exclude<TexturePreparation<T>, { kind: 'slow' }>>;
  slowPublished: boolean;
  settled?: Exclude<TexturePreparation<T>, { kind: 'slow' }>;
}

const DEFAULT_MAX_ENTRIES = 6;
const DEFAULT_MAX_LONGEST_SIDE = 4096;
const DEFAULT_SLOW_READY_MS = 150;

export class PageTurnTextureCache<T> {
  private readonly loadTexture: TextureLoader<T>['load'];
  private readonly disposeTexture: TextureLoader<T>['dispose'];
  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly maxLongestSide: number;
  private readonly slowReadyMs: number;
  private readonly cache = new Map<string, CachedTextureEntry<T>>();
  private readonly pending = new Map<string, PendingTextureEntry<T>>();
  private readonly generationClaims = new Map<number, Set<string>>();
  private readonly preparations = new Map<number, PreparationRecord<T>>();
  private readonly releasedGenerations = new Set<number>();
  private latestGeneration = 0;
  private disposed = false;

  constructor(options: PageTurnTextureCacheOptions<T>) {
    this.loadTexture = options.load;
    this.disposeTexture = options.dispose ?? (() => undefined);
    this.now = options.now ?? Date.now;
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.maxLongestSide = Math.max(1, options.maxLongestSide ?? DEFAULT_MAX_LONGEST_SIDE);
    this.slowReadyMs = Math.max(0, options.slowReadyMs ?? DEFAULT_SLOW_READY_MS);
  }

  async prepare(
    scene: PageTurnScene,
    generation: number,
    viewport: TextureViewport,
  ): Promise<TexturePreparation<T>> {
    if (this.disposed) {
      return { kind: 'stale', generation };
    }

    if (generation > this.latestGeneration) {
      this.releaseOlderGenerations(generation);
      this.latestGeneration = generation;
    }

    // Releasing a generation only retires the work that was in flight for it.
    // The surface effect can be torn down and re-run for the same turn, and
    // asking to prepare it again means the turn is live once more: keeping it
    // retired forever would answer every retry with `stale` and strand the
    // reader on the current page.
    if (generation >= this.latestGeneration) {
      this.releasedGenerations.delete(generation);
    }

    if (this.isGenerationStale(generation)) {
      return { kind: 'stale', generation };
    }

    const pages = uniquePages(scene);
    const requests = pages.map((page) => requestForPage(page, viewport, this.resolveLongestSideLimit(viewport)));
    const signature = `${scene.generationKey}|${viewport.width}x${viewport.height}@${viewport.dpr}|${viewport.backendMaxLongestSide ?? 'none'}`;
    const existing = this.preparations.get(generation);

    if (!existing || existing.signature !== signature) {
      this.generationClaims.set(generation, new Set(requests.map((request) => request.src)));
      const record = this.createPreparationRecord(generation, signature, requests);
      this.preparations.set(generation, record);
      return this.resolvePreparation(record);
    }

    return this.resolvePreparation(existing);
  }

  releaseGeneration(generation: number): void {
    this.releasedGenerations.add(generation);
    this.generationClaims.delete(generation);
    this.preparations.delete(generation);
    this.pruneCache();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.generationClaims.clear();
    this.preparations.clear();
    this.releasedGenerations.clear();
    this.pending.clear();

    for (const entry of this.cache.values()) {
      this.disposeTexture(entry.handle);
    }

    this.cache.clear();
  }

  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  private createPreparationRecord(
    generation: number,
    signature: string,
    requests: TextureRequest[],
  ): PreparationRecord<T> {
    const startedAt = this.now();
    const readyPromise = Promise.all(requests.map((request) => this.resolveTexture(request)))
      .then((entries) => {
        if (this.isGenerationStale(generation)) {
          return { kind: 'stale', generation } as const;
        }

        const bySource = new Map(entries.map((entry) => [entry.src, entry.handle]));
        return {
          kind: 'ready',
          generation,
          textures: {
            bySource,
            count: bySource.size,
            bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
          },
          waitedMs: this.now() - startedAt,
        } as const;
      })
      .catch((error: unknown) => {
        if (this.isGenerationStale(generation)) {
          return { kind: 'stale', generation } as const;
        }

        return {
          kind: 'error',
          generation,
          message: errorMessage(error),
        } as const;
      });

    const record: PreparationRecord<T> = {
      generation,
      signature,
      startedAt,
      readyPromise,
      slowPublished: false,
    };

    void readyPromise.then((result) => {
      record.settled = result;
      if (result.kind !== 'ready') {
        this.preparations.delete(generation);
      }
    });

    return record;
  }

  private async resolvePreparation(record: PreparationRecord<T>): Promise<TexturePreparation<T>> {
    if (record.settled) {
      return record.settled;
    }

    const waitedMs = this.now() - record.startedAt;
    if (waitedMs >= this.slowReadyMs) {
      if (record.slowPublished) {
        return record.readyPromise;
      }

      record.slowPublished = true;
      return {
        kind: 'slow',
        generation: record.generation,
        waitedMs,
      };
    }

    return new Promise<TexturePreparation<T>>((resolve) => {
      const timer = setTimeout(() => {
        record.slowPublished = true;
        resolve({
          kind: 'slow',
          generation: record.generation,
          waitedMs: this.now() - record.startedAt,
        });
      }, this.slowReadyMs - waitedMs);

      void record.readyPromise.then((result) => {
        clearTimeout(timer);
        resolve(result);
      });
    });
  }

  private async resolveTexture(request: TextureRequest): Promise<CachedTextureEntry<T>> {
    const cached = this.cache.get(request.src);
    if (cached && satisfies(cached, request)) {
      this.touch(request.src, cached);
      return cached;
    }

    if (cached) {
      this.cache.delete(request.src);
      this.disposeTexture(cached.handle);
    }

    const pending = this.pending.get(request.src);
    if (pending && satisfies(pending.request, request)) {
      return pending.promise;
    }

    let pendingEntry!: PendingTextureEntry<T>;
    pendingEntry = {
      request,
      promise: this.loadTexture(request)
        .then((handle) => this.finalizePending(request, pendingEntry, handle))
        .catch((error: unknown) => {
          if (this.pending.get(request.src) === pendingEntry) {
            this.pending.delete(request.src);
          }
          throw error;
        }),
    };

    this.pending.set(request.src, pendingEntry);
    return pendingEntry.promise;
  }

  private finalizePending(
    request: TextureRequest,
    pendingEntry: PendingTextureEntry<T>,
    handle: T,
  ): CachedTextureEntry<T> {
    const entry: CachedTextureEntry<T> = {
      src: request.src,
      handle,
      width: request.width,
      height: request.height,
      longestSide: request.longestSide,
      bytes: request.width * request.height * 4,
    };
    const isCurrentPending = this.pending.get(request.src) === pendingEntry;

    if (!isCurrentPending || this.disposed || !this.isSourceClaimed(request.src)) {
      this.disposeTexture(handle);
      return entry;
    }

    this.pending.delete(request.src);
    this.touch(request.src, entry);
    this.pruneCache();
    return entry;
  }

  private touch(src: string, entry: CachedTextureEntry<T>): void {
    this.cache.delete(src);
    this.cache.set(src, entry);
  }

  private pruneCache(): void {
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (!oldest) {
        return;
      }

      if (this.isSourceClaimed(oldest)) {
        this.touch(oldest, this.cache.get(oldest)!);
        continue;
      }

      const entry = this.cache.get(oldest);
      if (!entry) {
        continue;
      }

      this.cache.delete(oldest);
      this.disposeTexture(entry.handle);
    }
  }

  private releaseOlderGenerations(nextGeneration: number): void {
    for (const generation of this.generationClaims.keys()) {
      if (generation < nextGeneration) {
        this.releaseGeneration(generation);
      }
    }
  }

  private isGenerationStale(generation: number): boolean {
    return this.disposed || this.releasedGenerations.has(generation) || generation < this.latestGeneration;
  }

  private isSourceClaimed(src: string): boolean {
    for (const claims of this.generationClaims.values()) {
      if (claims.has(src)) {
        return true;
      }
    }

    return false;
  }

  private resolveLongestSideLimit(viewport: TextureViewport): number {
    if (viewport.backendMaxLongestSide && viewport.backendMaxLongestSide > 0) {
      return Math.min(this.maxLongestSide, viewport.backendMaxLongestSide);
    }

    return this.maxLongestSide;
  }
}

function uniquePages(scene: PageTurnScene): PageDescriptor[] {
  const ordered = [
    scene.turningFront,
    scene.turningVerso,
    scene.under,
    ...scene.stationary,
    ...scene.committed,
  ].filter((page): page is PageDescriptor => Boolean(page));
  const bySource = new Map<string, PageDescriptor>();

  for (const page of ordered) {
    if (!bySource.has(page.src)) {
      bySource.set(page.src, page);
    }
  }

  return Array.from(bySource.values());
}

function requestForPage(page: PageDescriptor, viewport: TextureViewport, maxLongestSide: number): TextureRequest {
  const sourceWidth = Math.max(1, Math.round(page.width || 1));
  const sourceHeight = Math.max(1, Math.round(page.height || 1));
  const viewportWidth = Math.max(1, Math.round(viewport.width * Math.max(viewport.dpr, 1)));
  const viewportHeight = Math.max(1, Math.round(viewport.height * Math.max(viewport.dpr, 1)));
  const fitScale = Math.min(viewportWidth / sourceWidth, viewportHeight / sourceHeight, 1);
  let width = Math.max(1, Math.round(sourceWidth * fitScale));
  let height = Math.max(1, Math.round(sourceHeight * fitScale));
  let longestSide = Math.max(width, height);

  if (longestSide > maxLongestSide) {
    const capScale = maxLongestSide / longestSide;
    width = Math.max(1, Math.round(width * capScale));
    height = Math.max(1, Math.round(height * capScale));
    longestSide = Math.max(width, height);
  }

  return {
    src: page.src,
    width,
    height,
    longestSide,
  };
}

function satisfies(
  candidate: Pick<CachedTextureEntry<unknown>, 'width' | 'height' | 'longestSide'>,
  request: TextureRequest,
): boolean {
  return candidate.width >= request.width
    && candidate.height >= request.height
    && candidate.longestSide >= request.longestSide;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
