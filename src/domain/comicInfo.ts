import type { ComicMetadata } from './types';

function extractTagValue(xml: string, tagName: string): string | undefined {
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i');
  const match = xml.match(regex);
  if (!match || match[1] === undefined) return undefined;
  const decoded = match[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
  return decoded || undefined;
}

export function parseComicInfoXml(xml: string): ComicMetadata {
  if (!xml || typeof xml !== 'string') {
    return {};
  }

  const metadata: ComicMetadata = {};

  const title = extractTagValue(xml, 'Title');
  if (title) metadata.title = title;

  const series = extractTagValue(xml, 'Series');
  if (series) metadata.series = series;

  const number = extractTagValue(xml, 'Number');
  if (number) metadata.number = number;

  const volume = extractTagValue(xml, 'Volume');
  if (volume) metadata.volume = volume;

  const summary = extractTagValue(xml, 'Summary') || extractTagValue(xml, 'Comments');
  if (summary) metadata.summary = summary;

  const writer = extractTagValue(xml, 'Writer');
  if (writer) metadata.writer = writer;

  const penciller = extractTagValue(xml, 'Penciller');
  if (penciller) metadata.penciller = penciller;

  const inker = extractTagValue(xml, 'Inker');
  if (inker) metadata.inker = inker;

  const colorist = extractTagValue(xml, 'Colorist');
  if (colorist) metadata.colorist = colorist;

  const letterer = extractTagValue(xml, 'Letterer');
  if (letterer) metadata.letterer = letterer;

  const coverArtist = extractTagValue(xml, 'CoverArtist');
  if (coverArtist) metadata.coverArtist = coverArtist;

  const editor = extractTagValue(xml, 'Editor');
  if (editor) metadata.editor = editor;

  const publisher = extractTagValue(xml, 'Publisher');
  if (publisher) metadata.publisher = publisher;

  const genre = extractTagValue(xml, 'Genre');
  if (genre) metadata.genre = genre;

  const yearStr = extractTagValue(xml, 'Year');
  if (yearStr) {
    const year = parseInt(yearStr, 10);
    if (!Number.isNaN(year)) metadata.year = year;
  }

  const monthStr = extractTagValue(xml, 'Month');
  if (monthStr) {
    const month = parseInt(monthStr, 10);
    if (!Number.isNaN(month)) metadata.month = month;
  }

  const countStr = extractTagValue(xml, 'PageCount') || extractTagValue(xml, 'Count');
  if (countStr) {
    const count = parseInt(countStr, 10);
    if (!Number.isNaN(count)) metadata.count = count;
  }

  const charactersStr = extractTagValue(xml, 'Characters');
  if (charactersStr) {
    metadata.characters = charactersStr
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
  }

  const tagsStr = extractTagValue(xml, 'Tags');
  if (tagsStr) {
    metadata.tags = tagsStr
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  return metadata;
}
