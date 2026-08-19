import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPreparedPageImage } from './PageTurnSurface';
import { analyzePageFlow } from '../../services/flowAnalysis';

/**
 * In the packaged app the page images come from the asset protocol, which is a
 * different origin from the app document. An image fetched without a CORS
 * request decodes origin-tainted: uploading it with `texImage2D` throws and the
 * physical page turn dies, while `getImageData` throws and panel guidance
 * silently degrades. Neither shows up in a same-origin browser test.
 */
function stubImage() {
  const instances: { crossOrigin: string | null; src: string }[] = [];
  class FakeImage {
    crossOrigin: string | null = null;
    decoding = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 8;
    naturalHeight = 8;
    complete = false;
    #src = '';

    get src() {
      return this.#src;
    }

    set src(value: string) {
      this.#src = value;
      instances.push({ crossOrigin: this.crossOrigin, src: value });
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', FakeImage);
  return instances;
}

describe('page images are requested with CORS', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for a page-turn texture as a cross-origin request', async () => {
    const instances = stubImage();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));

    await loadPreparedPageImage({ src: 'asset://page-1.png', width: 8, height: 8 });

    expect(instances).toHaveLength(1);
    expect(
      instances[0].crossOrigin,
      'crossOrigin must be set before src, or the request is not a CORS request',
    ).toBe('anonymous');
  });

  it('asks for a flow-analysis page as a cross-origin request', async () => {
    const instances = stubImage();

    await analyzePageFlow(
      { id: 'page-1', index: 0, name: 'Page 1', src: 'asset://page-1.png', width: 8, height: 8 },
      'ltr',
    );

    expect(instances).toHaveLength(1);
    expect(instances[0].crossOrigin).toBe('anonymous');
  });
});
