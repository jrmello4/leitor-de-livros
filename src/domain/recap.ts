import type { Publication } from './types';

export interface RecapSummary {
  title: string;
  series?: string;
  issueNumber?: string;
  pageIndex: number;
  pageCount: number;
  progressPercent: number;
  premise: string;
  currentMilestone: string;
  activeCharacters: string[];
  aiSummary?: string;
}

export function generateLocalRecap(publication: Publication, currentPageIndex: number): RecapSummary {
  const pageIndex = Math.max(0, Math.min(publication.pages.length - 1, currentPageIndex));
  const pageCount = Math.max(1, publication.pages.length);
  const progressPercent = Math.round(((pageIndex + 1) / pageCount) * 100);

  const series = publication.metadata?.series || publication.title;
  const issueNumber = publication.metadata?.number;
  const summary = publication.metadata?.summary?.trim();

  const premise = summary && summary.length > 0
    ? summary
    : `Início da narrativa de "${publication.title}". Acompanhe a trajetória dos personagens ao longo deste volume.`;

  let currentMilestone = '';
  if (progressPercent <= 15) {
    currentMilestone = 'Apresentação e estabelecimento do cenário. Os conflitos iniciais estão sendo introduzidos.';
  } else if (progressPercent <= 40) {
    currentMilestone = 'Desenvolvimento da trama e primeiros embates. A tensão entre os personagens está crescendo.';
  } else if (progressPercent <= 70) {
    currentMilestone = 'Ponto de virada e complicações na narrativa. O clímax do arco está se aproximando.';
  } else if (progressPercent < 100) {
    currentMilestone = 'Reta final do volume. Os eventos cruciais estão se desenrolando rumo à conclusão.';
  } else {
    currentMilestone = 'Volume concluído.';
  }

  let activeCharacters: string[] = [];
  const rawChars = publication.metadata?.characters;
  if (Array.isArray(rawChars)) {
    activeCharacters = rawChars.map((c: string) => c.trim()).filter(Boolean);
  } else if (typeof rawChars === 'string') {
    activeCharacters = (rawChars as string).split(/[,;/]/).map((c: string) => c.trim()).filter(Boolean);
  }

  return {
    title: publication.title,
    series,
    issueNumber,
    pageIndex,
    pageCount,
    progressPercent,
    premise,
    currentMilestone,
    activeCharacters,
  };
}

export async function fetchGeminiRecap(
  publication: Publication,
  currentPageIndex: number,
  apiKey: string,
): Promise<string> {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('API key not provided');
  }

  const recap = generateLocalRecap(publication, currentPageIndex);
  const prompt = `Você é um assistente especialista em HQs e Mangás no leitor de quadrinhos.
O leitor está lendo "${recap.title}" (${recap.series || ''} ${recap.issueNumber ? '#' + recap.issueNumber : ''}).
Ele está EXATAMENTE na página ${recap.pageIndex + 1} de um total de ${recap.pageCount} páginas (${recap.progressPercent}% de progresso).
Sinopse/Premissa conhecida: ${recap.premise}.
Personagens: ${recap.activeCharacters.join(', ')}.

INSTRUÇÕES RIGOROSAS:
1. Faça um resumo curto, imersivo e empolgante (2 a 3 parágrafos) do que aconteceu ATÉ a página ${recap.pageIndex + 1}.
2. NÃO DÊ NENHUM SPOILER das páginas seguintes (${recap.pageIndex + 2} em diante).
3. Responda em português (pt-BR) de forma direta e acolhedora.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey.trim())}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Empty response from Gemini API');
  }

  return text;
}
