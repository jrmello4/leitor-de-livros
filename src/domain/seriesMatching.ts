import type { Publication } from './types';

export function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

interface TitlePatternMatch {
  prefix: string;
  number: number;
}

export function extractTitlePattern(title: string): TitlePatternMatch | null {
  const pattern = parseIssueTitle(title);
  return pattern ? { prefix: seriesKey(pattern.label), number: pattern.number } : null;
}

function seriesKey(label: string): string {
  return label.normalize('NFC').trim().replace(/[\s_]+/g, ' ').toLowerCase();
}

function parseIssueTitle(title: string): { label: string; number: number } | null {
  // An explicit issue marker wins over dates, scan credits and subtitles after
  // it. Unmarked numbers are only inferred at the end, never from the start of
  // a series name such as "100 Bullets" or "2000 AD".
  const match = title.trim().match(/^(.*?)(?:\s*#\s*|[\s_-]+(?:volume|vol\.?|v|issue|chapter|ch\.?)[\s_-]*)(\d+(?:[.,]\d+)?)(?=$|[\s([_:–—-])/i)
    ?? title.trim().match(/^(.+?)[\s_-]+(\d+(?:[.,]\d+)?)(?:\s*(?:\([^)]*\)|\[[^\]]*\]))*$/);
  if (!match) return null;
  const label = match[1].replace(/[\s_]+/g, ' ').replace(/\s*[-_:–—]\s*$/, '').trim();
  const number = Number(match[2].replace(',', '.'));
  return label && Number.isFinite(number) ? { label, number } : null;
}

export function publicationSeries(publication: Publication): { key: string; label: string; number: number | null } {
  const pattern = parseIssueTitle(publication.title);
  const label = (publication.metadata?.series?.trim() || pattern?.label || publication.title.trim() || 'Sem série')
    .replace(/[\s_]+/g, ' ');
  const explicitNumber = publication.metadata?.number?.trim();
  const parsedNumber = explicitNumber ? Number(explicitNumber.replace(',', '.')) : NaN;
  return {
    key: seriesKey(label),
    label,
    number: Number.isFinite(parsedNumber) && parsedNumber >= 0 ? parsedNumber : pattern?.number ?? null,
  };
}

export function comparePublicationsBySeries(left: Publication, right: Publication): number {
  const a = publicationSeries(left);
  const b = publicationSeries(right);
  const groupOrder = a.key === b.key ? 0 : naturalCompare(a.key, b.key) || a.key.localeCompare(b.key);
  return groupOrder
    || (a.number === b.number ? 0 : a.number === null ? 1 : b.number === null ? -1 : a.number - b.number)
    || naturalCompare(left.title, right.title)
    || naturalCompare(left.id, right.id);
}

export function findNextPublication(
  current: Publication,
  library: Publication[],
): Publication | undefined {
  if (!current || !Array.isArray(library) || library.length <= 1) {
    return undefined;
  }

  // Binge reading must not guess. An alphabetic neighbour can belong to an
  // unrelated series. Use the same identity and issue numbers as the groups.
  const series = publicationSeries(current);
  if (series.number === null) return undefined;
  return library.find((candidate) => {
    if (candidate.id === current.id) return false;
    const next = publicationSeries(candidate);
    return next.key === series.key && next.number === series.number! + 1;
  });
}
