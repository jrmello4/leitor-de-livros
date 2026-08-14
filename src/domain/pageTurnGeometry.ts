import type { ReadingDirection } from './types';
import type { Vec2 } from './pageTurnTypes';

export interface PageFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  clipLeft?: number;
  clipTop?: number;
  clipRight?: number;
  clipBottom?: number;
}

export interface PageTransform {
  scale: number;
  panX: number;
  panY: number;
}

export function activationBandWidth(pageWidth: number): number {
  return Math.min(72, Math.max(28, pageWidth * 0.08));
}

export function clientToPagePoint(client: Vec2, page: Pick<PageFrame, 'left' | 'top' | 'width' | 'height'>, transform: PageTransform): Vec2 {
  const scale = Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : 1;

  return {
    x: (client.x - page.left - transform.panX) / (page.width * scale),
    y: (client.y - page.top - transform.panY) / (page.height * scale),
  };
}

function visibleBounds(page: PageFrame): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} | undefined {
  const left = Math.max(page.left, page.clipLeft ?? page.left);
  const top = Math.max(page.top, page.clipTop ?? page.top);
  const right = Math.min(page.left + page.width, page.clipRight ?? page.left + page.width);
  const bottom = Math.min(page.top + page.height, page.clipBottom ?? page.top + page.height);

  if (right < left || bottom < top) {
    return undefined;
  }

  return { left, top, right, bottom };
}

export function isVisibleOuterEdgeHit(point: Vec2, page: PageFrame, direction: ReadingDirection): boolean {
  const bounds = visibleBounds(page);
  if (!bounds) {
    return false;
  }

  if (point.y < bounds.top || point.y > bounds.bottom) {
    return false;
  }

  const bandWidth = activationBandWidth(page.width);
  return direction === 'ltr'
    ? point.x >= bounds.right - bandWidth && point.x <= bounds.right
    : point.x >= bounds.left && point.x <= bounds.left + bandWidth;
}

export class VelocityTracker {
  private samples: Array<{ point: Vec2; at: number }> = [];

  push(point: Vec2, at: number): void {
    this.samples.push({ point: { x: point.x, y: point.y }, at });
    this.samples = this.samples.filter((sample) => at - sample.at <= 80).slice(-6);
  }

  velocity(): Vec2 {
    const first = this.samples[0];
    const last = this.samples.at(-1);

    if (!first || !last) {
      return { x: 0, y: 0 };
    }

    const seconds = (last.at - first.at) / 1000;
    if (seconds <= 0) {
      return { x: 0, y: 0 };
    }

    return {
      x: (last.point.x - first.point.x) / seconds,
      y: (last.point.y - first.point.y) / seconds,
    };
  }
}

export function turnDisplacement(start: Vec2, point: Vec2, pageWidth: number, direction: ReadingDirection): number {
  if (!Number.isFinite(pageWidth) || pageWidth <= 0) {
    return 0;
  }

  const signedDelta = direction === 'ltr' ? start.x - point.x : point.x - start.x;
  return signedDelta / pageWidth;
}
