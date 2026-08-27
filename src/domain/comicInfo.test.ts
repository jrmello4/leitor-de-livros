import { describe, expect, it } from 'vitest';
import { parseComicInfoXml } from './comicInfo';

describe('parseComicInfoXml', () => {
  it('handles empty or malformed input safely', () => {
    expect(parseComicInfoXml('')).toEqual({});
    expect(parseComicInfoXml(null as unknown as string)).toEqual({});
    expect(parseComicInfoXml('not xml at all')).toEqual({});
  });

  it('parses standard ComicInfo.xml tags correctly', () => {
    const xml = `<?xml version="1.0"?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>The Court of Owls</Title>
  <Series>Batman</Series>
  <Number>1</Number>
  <Volume>2011</Volume>
  <Summary>Following a series of brutal murders, Batman unravels a conspiracy spanning centuries in Gotham City.</Summary>
  <Year>2011</Year>
  <Month>9</Month>
  <Writer>Scott Snyder</Writer>
  <Penciller>Greg Capullo</Penciller>
  <Inker>Jonathan Glapion</Inker>
  <Colorist>FCO Plascencia</Colorist>
  <Letterer>Richard Starkings</Letterer>
  <CoverArtist>Greg Capullo</CoverArtist>
  <Editor>Mike Marts</Editor>
  <Publisher>DC Comics</Publisher>
  <Genre>Superhero, Detective</Genre>
  <PageCount>32</PageCount>
  <Characters>Bruce Wayne, Dick Grayson, Talon</Characters>
  <Tags>Batman, New 52, Court of Owls</Tags>
</ComicInfo>`;

    const metadata = parseComicInfoXml(xml);
    expect(metadata.title).toBe('The Court of Owls');
    expect(metadata.series).toBe('Batman');
    expect(metadata.number).toBe('1');
    expect(metadata.volume).toBe('2011');
    expect(metadata.year).toBe(2011);
    expect(metadata.month).toBe(9);
    expect(metadata.writer).toBe('Scott Snyder');
    expect(metadata.penciller).toBe('Greg Capullo');
    expect(metadata.inker).toBe('Jonathan Glapion');
    expect(metadata.colorist).toBe('FCO Plascencia');
    expect(metadata.publisher).toBe('DC Comics');
    expect(metadata.count).toBe(32);
    expect(metadata.characters).toEqual(['Bruce Wayne', 'Dick Grayson', 'Talon']);
    expect(metadata.tags).toEqual(['Batman', 'New 52', 'Court of Owls']);
  });

  it('decodes XML entities in text fields', () => {
    const xml = `<ComicInfo>
      <Title>Batman &amp; Robin &lt;Year One&gt;</Title>
      <Summary>A &quot;dark&quot; &amp; gritty story with O&apos;Neil</Summary>
    </ComicInfo>`;

    const metadata = parseComicInfoXml(xml);
    expect(metadata.title).toBe('Batman & Robin <Year One>');
    expect(metadata.summary).toBe('A "dark" & gritty story with O\'Neil');
  });
});
