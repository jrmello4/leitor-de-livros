import type { Publication } from './types';

export function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

interface TitlePatternMatch {
  prefix: string;
  number: number;
}

export function extractTitlePattern(title: string): TitlePatternMatch | null {
  // Matches patterns like:
  // "Batman #01", "Batman - 01", "Batman Vol. 2", "Batman v02", "Batman ch 15", "Batman Issue 4", "Batman 03"
  const regex = /^(.*?)[\s_-]*(?:#|vol\.?|volume|v|issue|ch\.?|chapter)?[\s_-]*(\d+)(?:\s*\([^)]*\))?$/i;
  const match = title.trim().match(regex);
  if (!match || !match[1] || !match[2]) {
    return null;
  }
  const prefix = match[1].trim().toLowerCase().replace(/[\s_]+/g, ' ').replace(/\s*[-_:]\s*$/, '').trim();
  const number = parseInt(match[2], 10);
  if (Number.isNaN(number)) {
    return null;
  }
  return { prefix, number };
}

export function findNextPublication(
  current: Publication,
  library: Publication[],
): Publication | undefined {
  if (!current || !Array.isArray(library) || library.length <= 1) {
    return undefined;
  }

  const candidates = library.filter((p) => p.id !== current.id);

  // Strategy 1: Explicit ComicInfo.xml metadata matching
  if (current.metadata?.series && current.metadata?.number) {
    const currentNum = parseFloat(current.metadata.number);
    if (!Number.isNaN(currentNum)) {
      const nextByMeta = candidates.find((p) => {
        if (!p.metadata?.series || !p.metadata?.number) return false;
        const sameSeries = p.metadata.series.trim().toLowerCase() === current.metadata!.series!.trim().toLowerCase();
        const pNum = parseFloat(p.metadata.number);
        return sameSeries && pNum === currentNum + 1;
      });
      if (nextByMeta) {
        return nextByMeta;
      }
    }
  }

  // Strategy 2: Pattern-based title matching ("Batman #01" -> "Batman #02")
  const currentPattern = extractTitlePattern(current.title);
  if (currentPattern) {
    const nextByPattern = candidates.find((p) => {
      const pPattern = extractTitlePattern(p.title);
      if (!pPattern) return false;
      return pPattern.prefix === currentPattern.prefix && pPattern.number === currentPattern.number + 1;
    });
    if (nextByPattern) {
      return nextByPattern;
    }
  }

  // Strategy 3: Fallback to natural alphabetical successor in the full library
  const naturallySorted = [...library].sort((a, b) => naturalCompare(a.title, b.title));
  const currentIndex = naturallySorted.findIndex((p) => p.id === current.id);
  if (currentIndex >= 0 && currentIndex < naturallySorted.length - 1) {
    return naturallySorted[currentIndex + 1];
  }

  return undefined;
}
