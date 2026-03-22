import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';

type SourcesFile = {
  urls: string[];
};

type OutputDocument = {
  url: string;
  title: string;
  content: string;
};

const SOURCES_PATH =
  process.env.SOURCES_INPUT_PATH ||
  path.join(process.cwd(), 'tenants', 'baltazar', 'sources.json');

const OUTPUT_PATH =
  process.env.DOCUMENTS_OUTPUT_PATH ||
  path.join(process.cwd(), 'data', 'documents.json');

function normalizeWhitespace(input: string): string {
  return input
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function normalizeText(input: string): string {
  return normalizeWhitespace(input)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isGarbageLine(line: string): boolean {
  const raw = line.trim();
  const n = normalizeText(raw);

  if (!n) return true;
  if (raw.length <= 1) return true;

  const exactBad = new Set([
    'idi na sadrzaj',
    'search',
    'search button',
    'o nama',
    'novosti',
    'kvaliteta',
    'pravne stranice',
    'upravljajte pristankom',
    'korisne poveznice',
    'cesta pitanja',
    'česta pitanja',
    'upisi',
    'referada',
    'knjiznica',
    'knjižnica',
    'studomat',
    'isvu studomat',
    'ponuda poslova',
    'strucna praksa',
    'stručna praksa',
    'zavrsni radovi',
    'završni radovi',
    'raspored nastave',
    'ispitni rokovi',
    'studijski kalendar',
    'partneri veleucilista',
    'partneri veleučilišta',
    'misija i vizija',
    'dokumenti',
    'prijavi se!',
    'pravila privatnosti',
    'copyright © 2023 veleuciliste baltazar zapresic',
    'copyright © 2023 veleučilište baltazar zaprešić',
    'zapresic',
    'zaprešić',
    'zagreb',
    'biograd na moru',
    'osijek',
  ]);

  if (exactBad.has(n)) return true;

  const badPatterns = [
    /^copyright\b/,
    /^sustav baltazar\b/,
    /^isvu\b/,
    /^constructor\b/,
    /^uniapp\b/,
    /^turnitin\b/,
    /^upravljajte pristankom\b/,
    /^da bismo pruzili najbolje iskustvo\b/,
    /^da bismo pružili najbolje iskustvo\b/,
    /^koristimo tehnologije poput kolacica\b/,
    /^koristimo tehnologije poput kolačića\b/,
    /^prihvati\b/,
    /^odbij\b/,
    /^postavke\b/,
    /^ogl(.*?)na ploca\b/,
    /^oglasna ploca\b/,
    /^oglasna ploča\b/,
    /^odlazna mobilnost\b/,
    /^mobilnost\b/,
    /^erasmus\b/,
    /^ured za medunarodnu suradnju\b/,
    /^ured za međunarodnu suradnju\b/,
    /^studijski programi\b$/,
    /^strucni prijediplomski studiji\b$/,
    /^stručni prijediplomski studiji\b$/,
    /^strucni diplomski studiji\b$/,
    /^stručni diplomski studiji\b$/,
    /^online studiranje\b$/,
    /^medunarodna suradnja\b$/,
    /^međunarodna suradnja\b$/,
  ];

  if (badPatterns.some((p) => p.test(n))) return true;

  if (n.split(' ').length <= 2) {
    if (!/\b(ects|cijena|uvjeti|trajanje|termini|kontakt|opis|sadrzaj|sadržaj)\b/.test(n)) {
      return true;
    }
  }

  return false;
}

function cleanLines(text: string): string {
  const lines = normalizeWhitespace(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const cleaned: string[] = [];
  let previous = '';

  for (const line of lines) {
    if (isGarbageLine(line)) continue;

    const compact = normalizeWhitespace(line);
    if (!compact) continue;

    if (normalizeText(compact) === normalizeText(previous)) continue;

    cleaned.push(compact);
    previous = compact;
  }

  return cleaned.join('\n');
}

function removeNoise($: cheerio.CheerioAPI) {
  const selectorsToRemove = [
    'script',
    'style',
    'noscript',
    'iframe',
    'svg',
    'canvas',
    'form',
    'button',
    'input',
    'select',
    'textarea',
    'nav',
    'header',
    'footer',
    '.header',
    '.footer',
    '.site-header',
    '.site-footer',
    '.main-navigation',
    '.menu',
    '.menus',
    '.navbar',
    '.navigation',
    '.breadcrumbs',
    '.breadcrumb',
    '.cookie',
    '.cookies',
    '.cookie-notice',
    '.cookie-banner',
    '.gdpr',
    '.search-form',
    '.search',
    '.sidebar',
    '.widget',
    '.related',
    '.share',
    '.social',
    '.social-links',
    '.modal',
    '.popup',
    '.newsletter',
    '.hero-buttons',
    '.elementor-location-header',
    '.elementor-location-footer',
  ];

  for (const sel of selectorsToRemove) {
    $(sel).remove();
  }

  $('a').each((_, el) => {
    const text = $(el).text().trim();
    const n = normalizeText(text);
    if (
      !text ||
      text.length < 2 ||
      /^(procitaj vise|pročitaj više|vise|više|detaljnije|kliknite|saznaj vise|saznaj više)$/i.test(n)
    ) {
      $(el).remove();
    }
  });
}

function getBestRoot($: cheerio.CheerioAPI) {
  const selectors = [
    'main article',
    'main .entry-content',
    'main .page-content',
    'main .post-content',
    'main .content',
    'article',
    '.entry-content',
    '.page-content',
    '.post-content',
    '#content',
    'main',
  ];

  let bestNode: cheerio.Cheerio<any> | null = null;
  let bestScore = 0;

  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const node = $(el);
      const text = normalizeWhitespace(node.text());
      const score = text.length;

      if (score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    });

    if (bestScore > 500) break;
  }

  return bestNode || $('body');
}

function extractStructuredContent($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>): string {
  const parts: string[] = [];

  const pushText = (value: string) => {
    const cleaned = normalizeWhitespace(value);
    if (!cleaned) return;
    parts.push(cleaned);
  };

  const headingSelectors = 'h1, h2, h3, h4';
  const textSelectors = 'p, li, div, section';

  root.find(`${headingSelectors}, ${textSelectors}`).each((_, el) => {
    const tag = el.tagName?.toLowerCase() || '';
    const text = normalizeWhitespace($(el).text());

    if (!text) return;
    if (text.length < 2) return;

    if (/^(header|footer|nav)$/i.test(tag)) return;

    const n = normalizeText(text);

    if (
      n.includes('pravila privatnosti') ||
      n.includes('upravljajte pristankom') ||
      n.includes('da bismo pruzili najbolje iskustvo') ||
      n.includes('da bismo pružili najbolje iskustvo')
    ) {
      return;
    }

    if (/^h[1-4]$/.test(tag)) {
      pushText(text);
      return;
    }

    if (tag === 'li') {
      pushText(`- ${text}`);
      return;
    }

    pushText(text);
  });

  return cleanLines(parts.join('\n'));
}

function extractMainContent(html: string): { title: string; content: string } {
  const $ = cheerio.load(html);

  removeNoise($);

  const title =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('h1').first().text().trim() ||
    $('title').first().text().trim() ||
    'Bez naslova';

  const root = getBestRoot($);

  let content = extractStructuredContent($, root);

  if (!content || content.length < 200) {
    content = cleanLines(normalizeWhitespace(root.text()));
  }

  if (!content || content.length < 200) {
    content = cleanLines(normalizeWhitespace($('body').text()));
  }

  return {
    title: normalizeWhitespace(title),
    content: normalizeWhitespace(content),
  };
}

async function fetchUrl(url: string): Promise<OutputDocument | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BaltazarBot/2.0; +https://www.bak.hr/)',
        'Accept-Language': 'hr,en;q=0.9',
      },
    });

    if (!response.ok) {
      console.error(`Preskačem ${url} — HTTP ${response.status}`);
      return null;
    }

    const html = await response.text();
    const { title, content } = extractMainContent(html);

    if (!content || content.length < 120) {
      console.error(`Preskačem ${url} — premalo sadržaja nakon čišćenja`);
      return null;
    }

    return { url, title, content };
  } catch (error) {
    console.error(`Greška pri dohvaćanju ${url}:`, error);
    return null;
  }
}

async function main() {
  if (!fs.existsSync(SOURCES_PATH)) {
    throw new Error(`Ne postoji sources file: ${SOURCES_PATH}`);
  }

  const raw = fs.readFileSync(SOURCES_PATH, 'utf8');
  const parsed = JSON.parse(raw) as SourcesFile;

  if (!parsed.urls || !Array.isArray(parsed.urls) || !parsed.urls.length) {
    throw new Error('sources.json nema valjano polje "urls".');
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });

  const documents: OutputDocument[] = [];

  console.log(`Ukupno URL-ova: ${parsed.urls.length}`);

  for (const url of parsed.urls) {
    console.log(`Dohvaćam: ${url}`);
    const doc = await fetchUrl(url);

    if (doc) {
      documents.push(doc);
      console.log(`Spremljeno: ${doc.title} | duljina: ${doc.content.length}`);
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(documents, null, 2), 'utf8');

  console.log(`\nGotovo. Spremljeno dokumenata: ${documents.length}`);
  console.log(`Izlaz: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('Greška u fetch-baltazar-docs.ts:', err);
  process.exit(1);
});
