import type { PageDescriptor, Publication } from '../domain/types';

function svgPage(title: string, pageNumber: string, variant: number): string {
  const palettes = [
    ['#13272c', '#e6c08b', '#c56f4b'],
    ['#1c2030', '#f0d9b5', '#789b9d'],
    ['#2a1e24', '#f1cf91', '#d77953'],
    ['#10252b', '#ead9bc', '#b89562'],
  ];
  const [ink, paper, accent] = palettes[variant % palettes.length];
  const panelA = variant % 2 === 0 ? '#d1744e' : '#6f9798';
  const panelB = variant % 2 === 0 ? '#769a96' : '#c37552';
  const encoded = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1700" viewBox="0 0 1200 1700">
      <rect width="1200" height="1700" fill="${paper}"/>
      <rect x="38" y="38" width="1124" height="1624" fill="none" stroke="${ink}" stroke-width="14"/>
      <path d="M90 220 H1110" stroke="${accent}" stroke-width="22"/>
      <text x="90" y="150" fill="${ink}" font-family="Georgia, serif" font-size="54" font-weight="700" letter-spacing="4">TACTILE / STUDY ${pageNumber}</text>
      <text x="90" y="305" fill="${ink}" font-family="Georgia, serif" font-size="116" font-weight="700">${title}</text>
      <text x="94" y="378" fill="${ink}" opacity=".76" font-family="Arial, sans-serif" font-size="26" letter-spacing="7">A SMALL WEATHER OF PAPER AND LIGHT</text>
      <rect x="90" y="470" width="1020" height="480" fill="${ink}"/>
      <circle cx="865" cy="705" r="185" fill="${panelA}"/>
      <path d="M160 850 C310 560 560 610 700 820 C820 1000 990 940 1090 770" fill="none" stroke="${paper}" stroke-width="32"/>
      <path d="M180 590 L340 530 L420 815 L260 870 Z" fill="${panelB}" opacity=".9"/>
      <text x="140" y="1060" fill="${ink}" font-family="Georgia, serif" font-size="60" font-weight="700">THE QUIET HOUR</text>
      <text x="140" y="1125" fill="${ink}" font-family="Arial, sans-serif" font-size="28">The page keeps its own weather.</text>
      <line x1="140" y1="1220" x2="1060" y2="1220" stroke="${ink}" stroke-width="6"/>
      <text x="140" y="1305" fill="${ink}" font-family="Arial, sans-serif" font-size="24" letter-spacing="2">PAPER ATELIER / FIELD NOTE / ${pageNumber}</text>
      <text x="140" y="1435" fill="${accent}" font-family="Georgia, serif" font-size="82" font-weight="700">TURN SLOWLY.</text>
      <text x="140" y="1510" fill="${ink}" opacity=".7" font-family="Arial, sans-serif" font-size="24">A license-free visual study bundled with the prototype.</text>
    </svg>
  `);
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

export function createDemoPublication(): Publication {
  const pages: PageDescriptor[] = Array.from({ length: 4 }, (_, index) => ({
    id: `demo-page-${index + 1}`,
    index,
    name: `paper-study-${String(index + 1).padStart(2, '0')}.svg`,
    src: svgPage(index === 0 ? 'NOCTURNE' : 'MARGIN', String(index + 1).padStart(2, '0'), index),
    width: 1200,
    height: 1700,
  }));

  return {
    pageCount: pages.length,
    coverSrc: pages[0]?.src ?? '',
    currentPageId: pages[0]?.id,
    id: 'demo-paper-study',
    title: 'The Quiet Hour',
    sourceLabel: 'Built-in paper study',
    format: 'demo',
    pages,
    coverPageId: pages[0].id,
    currentPage: 0,
    progress: 0.25,
    direction: 'ltr',
    addedAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
    isFavorite: false,
  };
}
