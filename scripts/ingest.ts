import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Pool } from 'pg';
import OpenAI from 'openai';

type RawDocument = {
  url: string;
  title?: string | null;
  content?: string | null;
  text?: string | null;
  html?: string | null;
  content_group?: string | null;
};

type ContentGroup =
  | 'upisi'
  | 'online_studiranje'
  | 'prijediplomski_studiji'
  | 'diplomski_studiji'
  | 'specijalisticki_studiji'
  | 'studijski_programi'
  | 'cjelozivotno_obrazovanje'
  | 'kolegiji'
  | 'nastavnici'
  | 'opcenito';

type EntityType =
  | 'studijski_program'
  | 'cjelozivotni_program'
  | 'kolegij'
  | 'nastavnik'
  | 'upisi'
  | 'online_studij'
  | 'opcenito';

type SectionType =
  | 'opis'
  | 'uvjeti'
  | 'trajanje'
  | 'cijena'
  | 'kontakt'
  | 'termini'
  | 'sadrzaj'
  | 'ishodi'
  | 'izvedba'
  | 'nositelj'
  | 'upis'
  | 'ects'
  | 'ostalo';

type EnrichedChunk = {
  chunk_index: number;
  content: string;
  content_group: ContentGroup;
  entity_type: EntityType;
  entity_name: string | null;
  section_type: SectionType;
  parent_entity_type: string | null;
  parent_entity_name: string | null;
};

const DATABASE_URL = process.env.DATABASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TENANT_ID = process.env.TENANT_ID || 'effectus';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const INPUT_PATH = process.env.INGEST_INPUT_PATH || path.join(process.cwd(), 'data', 'documents.json');
const DEBUG = process.env.DEBUG_INGEST === 'true';

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL nije postavljen.');
}
if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY nije postavljen.');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

function log(...args: unknown[]) {
  if (DEBUG) console.log(...args);
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEntityName(name: string): string {
  return normalizeText(name)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanEntityDisplayName(name: string): string {
  let value = cleanText(name || '');

  value = value
    .replace(/\s+-\s+EFFECTUS veleučilište\s*$/i, '')
    .replace(/\s+-\s+EFFECTUS veleuciliste\s*$/i, '')
    .replace(/\s*\|\s*EFFECTUS veleučilište\s*$/i, '')
    .replace(/\s*\|\s*EFFECTUS veleuciliste\s*$/i, '')
    .trim();

  return value;
}

function isNoiseContent(text: string): boolean {
  const n = normalizeText(text);

  const patterns = [
    /pravila privatnosti/,
    /upravljajte pristankom/,
    /da bismo pruzili najbolje iskustvo/,
    /da bismo pružili najbolje iskustvo/,
    /koristimo tehnologije poput kolacica/,
    /koristimo tehnologije poput kolačića/,
    /tehnicko skladistenje ili pristup/,
    /tehničko skladištenje ili pristup/,
    /anonimne statisticke svrhe/,
    /anonimne statističke svrhe/,
    /kreiranje korisnickih profila za slanje reklama/,
    /kreiranje korisničkih profila za slanje reklama/,
    /pracenje korisnika na web stranici/,
    /praćenje korisnika na web stranici/,
    /search button/,
  ];

  return patterns.some((p) => p.test(n));
}

// Ukloni GDPR/cookie consent boilerplate koji web scraper ubaci u sadržaj
function stripBoilerplate(input: string): string {
  let text = input;

  // 1) Cookie consent banner — sve iza ove fraze je nevažno
  const cookieMarkers = [
    'Da bismo pružili najbolje iskustvo, koristimo tehnologije',
    'Da bismo pruzili najbolje iskustvo, koristimo tehnologije',
    'koristimo tehnologije poput kolačića za čuvanje i/ili pristup',
    'koristimo tehnologije poput kolacica za cuvanje i/ili pristup',
  ];
  for (const marker of cookieMarkers) {
    const idx = text.indexOf(marker);
    if (idx !== -1) { text = text.slice(0, idx); break; }
  }

  // 2) Navigacijska traka effectus.com.hr — pojavljuje se na svakoj stranici
  //    Sadržaj počinje NAKON zadnjeg poznatog nav end markera.
  const navEndMarkers = [
    'Upute za online nastavu',          // HR
    'Instructions and tips for using the online exam system', // EN
    'Instructions and tips for using the online', // EN kraći
    'English Course Catalogue',         // alternativni završetak nav-a
  ];
  let navEndIdx = -1;
  let navEndLen = 0;
  for (const marker of navEndMarkers) {
    let searchFrom = 0;
    let lastFound = -1;
    while (true) {
      const idx = text.indexOf(marker, searchFrom);
      if (idx === -1) break;
      lastFound = idx;
      searchFrom = idx + 1;
    }
    if (lastFound !== -1 && lastFound > navEndIdx) {
      navEndIdx = lastFound;
      navEndLen = marker.length;
    }
  }
  if (navEndIdx !== -1) {
    const afterNav = text.slice(navEndIdx + navEndLen).trim();
    if (afterNav.length > 80) text = afterNav;
  }

  // 3) Footer — od IBAN oznake do kraja
  const footerMarkers = [
    'Veleučilište s pravom javnosti EFFECTUS veleučilište — footer —',
    'EFFECTUS veleučilište — footer —',
  ];
  for (const marker of footerMarkers) {
    const idx = text.indexOf(marker);
    if (idx !== -1) { text = text.slice(0, idx).trim(); break; }
  }

  return text;
}

function cleanText(input: string): string {
  return stripBoilerplate(input || '')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hashContent(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function trimForEmbedding(input: string, maxChars = 12000): string {
  const cleaned = cleanText(input);
  if (cleaned.length <= maxChars) return cleaned;

  let cut = cleaned.lastIndexOf(' ', maxChars);
  if (cut < Math.floor(maxChars * 0.7)) cut = maxChars;

  return cleaned.slice(0, cut).trim();
}

function detectContentGroup(url: string, title: string, text: string): ContentGroup {
  const u = normalizeText(url);
  const t = normalizeText(`${title}
${text}`);

  // 1) Najprije URL-specifična pravila (s ili bez trailing slash)
  if (/\/cjelozivotno(-obrazovanje)?/.test(u)) {
    return 'cjelozivotno_obrazovanje';
  }

  if (/\/online-studiranje/.test(u)) {
    return 'online_studiranje';
  }

  if (/\/upisi/.test(u)) {
    return 'upisi';
  }

  if (/\/studijski-programi/.test(u)) {
    return 'studijski_programi';
  }

  if (/\/prijediplomski/.test(u)) {
    return 'prijediplomski_studiji';
  }

  if (/\/diplomski/.test(u)) {
    return 'diplomski_studiji';
  }

  if (/\/specijalisticki/.test(u)) {
    return 'specijalisticki_studiji';
  }

  // 2) Zatim sadržajna pravila
  if (
    /cjelozivotno obrazovanje|cjeloživotno obrazovanje|program usavrsavanja|program osposobljavanja|tecaj|tečaj/.test(t)
  ) {
    return 'cjelozivotno_obrazovanje';
  }

  if (/online studiranje|online studij/.test(t)) {
    return 'online_studiranje';
  }

  if (/prijediplomski/.test(t)) {
    return 'prijediplomski_studiji';
  }

  if (/diplomski/.test(t)) {
    return 'diplomski_studiji';
  }

  if (/specijalisticki|specijalistički/.test(t)) {
    return 'specijalisticki_studiji';
  }

  if (/kolegij|ects|silabus|nositelj kolegija|ishodi ucenja|ishodi učenja/.test(t)) {
    return 'kolegiji';
  }

  if (/nastavnici|predavac|predavač|prof\.?|doc\.?/.test(t)) {
    return 'nastavnici';
  }

  if (/studijski program|studijski programi|studij/.test(t)) {
    return 'studijski_programi';
  }

  if (/upisi|upis|prijava|rokovi upisa/.test(t)) {
    return 'upisi';
  }

  return 'opcenito';
}

function extractSlugName(url: string): string | null {
  const cleanUrl = url.replace(/\/+$/, '');
  const parts = cleanUrl.split('/').filter(Boolean);
  const slug = parts[parts.length - 1];
  if (!slug) return null;

  const value = slug
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!value) return null;

  const specialMap: Record<string, string> = {
    'turisticki vodic': 'Turistički vodič',
    'voditelj poslova u turistickoj agenciji priprema za polaganje strucnog ispita':
      'Voditelj poslova u turističkoj agenciji - Priprema za polaganje stručnog ispita',
  };

  const normalized = normalizeText(value);
  if (specialMap[normalized]) return specialMap[normalized];

  return value
    .split(' ')
    .map((w) => w ? w[0].toUpperCase() + w.slice(1) : w)
    .join(' ');
}

function detectEntityType(contentGroup: ContentGroup, heading: string, text: string): EntityType {
  const h = normalizeText(heading);
  const full = normalizeText(`${heading}\n${text}`);

  if (contentGroup === 'cjelozivotno_obrazovanje') return 'cjelozivotni_program';
  if (contentGroup === 'upisi') return 'upisi';
  if (contentGroup === 'online_studiranje') return 'online_studij';
  if (
    contentGroup === 'prijediplomski_studiji' ||
    contentGroup === 'diplomski_studiji' ||
    contentGroup === 'specijalisticki_studiji' ||
    contentGroup === 'studijski_programi'
  ) {
    return 'studijski_program';
  }

  if (/\bkolegij\b|\bects\b|\bsilabus\b|\bnositelj kolegija\b/.test(full)) return 'kolegij';
  if (/\bnastavnik\b|\bpredavac\b|\bpredavač\b|\bprof\.?\b|\bdoc\.?\b/.test(full)) return 'nastavnik';
  if (/\bupisi\b|\bupis\b|\bprijava\b/.test(full)) return 'upisi';
  if (/\bonline studij\b|\bonline studiranje\b/.test(full)) return 'online_studij';
  if (/\bstudijski program\b|\bstudij\b/.test(h) || /\bprijediplomski\b|\bdiplomski\b/.test(full)) return 'studijski_program';

  return 'opcenito';
}

function classifySectionType(input: {
  heading?: string;
  content: string;
  entityType?: EntityType;
}): SectionType {
  const heading = normalizeText(input.heading || '');
  const content = normalizeText(input.content || '');
  const text = `${heading}\n${content}`;

  // Kolegij chunk koji počinje s "Naziv predmeta" → uvijek 'opis' (sadrži opis + nastavnika)
  if (/naziv predmeta\s+\w/.test(content)) return 'opis';

  if (/\b(uvjeti upisa|uvjeti|preduvjeti|tko moze upisati|tko može upisati|pravo upisa)\b/.test(heading)) return 'uvjeti';
  if (/\b(trajanje|broj sati|fond sati|satnica|ukupno trajanje)\b/.test(heading)) return 'trajanje';
  if (/\b(cijena|skolarina|školarina|iznos|kotizacija|participacija)\b/.test(heading)) return 'cijena';
  if (/\b(kontakt|informacije|upiti|javiti se|telefon|e-mail|email)\b/.test(heading)) return 'kontakt';
  if (/\b(termini|rokovi|rok|pocetak|početak|datum odrzavanja|datum održavanja|dinamika)\b/.test(heading)) return 'termini';
  if (/\b(sadrzaj|sadržaj|moduli|predmeti|teme)\b/.test(heading)) return 'sadrzaj';
  if (/\b(ishodi|ishodi ucenja|ishodi učenja)\b/.test(heading)) return 'ishodi';
  if (/\b(izvedba|nacin izvedbe|način izvedbe|oblik nastave)\b/.test(heading)) return 'izvedba';
  if (/\b(nositelj|izvodac|izvođač|nastavnik|predavac|predavač)\b/.test(heading)) return 'nositelj';
  if (/\b(ects)\b/.test(heading)) return 'ects';
  if (/\b(upis|upisi|prijava|prijave)\b/.test(heading)) return 'upis';
  if (/\b(opis|o programu|o studiju|ciljevi|svrha|sto cete nauciti|što ćete naučiti)\b/.test(heading)) return 'opis';

  if (/\b(cijena|skolarina|školarina|kotizacija|participacija|€|eur|pdv|popust|jednokratno placanje|jednokratno plaćanje|u cijenu je ukljuceno|u cijenu je uključeno)\b/.test(text)) return 'cijena';
  if (/\b(traje|trajanje|sati|satnica|tjedana|mjeseci|semestra|godine)\b/.test(text)) return 'trajanje';
  if (/\b(uvjet|uvjeti|preduvjet|pristupnik|zavrsen|završen|sss|vss|všs|diploma)\b/.test(text)) return 'uvjeti';
  // Email nastavnika u kolegijima NE smije biti "kontakt" — provjeri da nije nastavnički kontakt
  const hasEmailInContent = /\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i.test(input.content);
  const isKolegijNastavnikEmail = hasEmailInContent &&
    /nastavnici\s+i\s+suradnici|nositelj|predavač|predavac/i.test(input.content);
  if (!isKolegijNastavnikEmail && (hasEmailInContent || /\b(telefon|mob|tel)\b/.test(text))) return 'kontakt';
  if (/\b(rok|rokovi|termin|termini|pocinje|počinje|pocetak|početak|datum)\b/.test(text)) return 'termini';
  if (/\b(predmet|predmeti|sadrzaj|sadržaj|moduli|nastavne cjeline)\b/.test(text)) return 'sadrzaj';
  if (/\b(ishodi ucenja|ishodi učenja|student ce moci|student će moći)\b/.test(text)) return 'ishodi';
  if (/\b(ects)\b/.test(text)) return 'ects';
  if (/\b(nositelj|predavac|predavač|izvodi|nastavnik)\b/.test(text)) return 'nositelj';
  if (/\b(upis|upisi|prijava|prijave)\b/.test(text)) return 'upis';

  return 'opis';
}

function splitByHeadings(text: string): Array<{ heading: string; body: string }> {
  const lines = cleanText(text).split('\n').map((l) => l.trim());
  const sections: Array<{ heading: string; body: string }> = [];

  let currentHeading = 'Uvod';
  let currentBody: string[] = [];

  const isLikelyHeading = (line: string) => {
    const n = normalizeText(line);
    if (!n) return false;
    if (line.length > 120) return false;
    if (/^[A-ZČĆŽŠĐ0-9\s:/().-]+$/.test(line) && line.length < 90) return true;
    if (/^(Opis|Uvjeti|Trajanje|Cijena|Kontakt|Termini|Sadržaj|Ishodi|ECTS|Nositelj|Upis)\b/i.test(line)) return true;
    if (/^\d+(\.\d+)?\s+/.test(line) && line.length < 90) return true;
    return false;
  };

  for (const line of lines) {
    if (!line) continue;

    if (isLikelyHeading(line)) {
      if (currentBody.length) {
        sections.push({
          heading: currentHeading,
          body: currentBody.join('\n').trim(),
        });
      }
      currentHeading = line;
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }

  if (currentBody.length) {
    sections.push({
      heading: currentHeading,
      body: currentBody.join('\n').trim(),
    });
  }

  return sections.filter((s) => s.body.trim());
}

function chunkLongText(text: string, maxChars = 1200): string[] {
  const cleaned = cleanText(text);
  if (!cleaned) return [];
  if (cleaned.length <= maxChars) return [cleaned];

  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  const pushChunk = (value: string) => {
    const v = cleanText(value);
    if (v) chunks.push(v);
  };

  const splitHard = (value: string) => {
    const hardParts: string[] = [];
    let rest = value.trim();

    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf(' ', maxChars);
      if (cut < Math.floor(maxChars * 0.6)) cut = maxChars;
      hardParts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }

    if (rest) hardParts.push(rest);
    return hardParts;
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      if (current) {
        pushChunk(current);
        current = '';
      }

      const forced = splitHard(paragraph);
      for (const part of forced) pushChunk(part);
      continue;
    }

    if (!current) {
      current = paragraph;
      continue;
    }

    const candidate = `${current}

${paragraph}`;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      pushChunk(current);
      current = paragraph;
    }
  }

  if (current) pushChunk(current);

  return chunks;
}

function extractEntityName(url: string, title: string, heading: string, body: string, contentGroup: ContentGroup, entityType: EntityType): string | null {
  const candidates = [
    heading,
    title,
    ...body.split('\n').slice(0, 5),
  ].map((s) => cleanText(s)).filter(Boolean);

  const normalizedTitle = normalizeText(title);
  const normalizedHeading = normalizeText(heading);
  const normalizedBody = normalizeText(body);

  if (entityType === 'cjelozivotni_program') {
    const slugName = extractSlugName(url);
    if (slugName && normalizeText(slugName) !== 'cjelozivotno obrazovanje') {
      return cleanEntityDisplayName(slugName);
    }

    for (const c of candidates) {
      const n = normalizeText(c);
      if (
        /\b(turisticki vodic|turistički vodič|voditelj poslovnice|voditelj poslova u turistickoj agenciji|voditelj poslova u turističkoj agenciji|dadilja|web dizajn|racunovodstvo|računovodstvo)\b/.test(n)
      ) {
        return cleanEntityDisplayName(c);
      }
      if (c.length >= 4 && c.length <= 160 && !/\b(cijena|kontakt|uvjeti|trajanje|termini|opis|upisi)\b/i.test(c)) {
        if (!/\bcjelozivotno obrazovanje\b|\bcjeloživotno obrazovanje\b/i.test(c)) {
          return cleanEntityDisplayName(c);
        }
      }
    }
  }

  if (entityType === 'studijski_program') {
    const studyPatterns = [
      /specijalisticki diplomski strucni studij\s+([^\n.]+)/i,
      /specijalistički diplomski stručni studij\s+([^\n.]+)/i,
      /strucni diplomski studij\s+([^\n.]+)/i,
      /stručni diplomski studij\s+([^\n.]+)/i,
      /strucni prijediplomski studij\s+([^\n.]+)/i,
      /stručni prijediplomski studij\s+([^\n.]+)/i,
      /studijski program\s+([^\n.]+)/i,
    ];

    for (const pattern of studyPatterns) {
      const matchHeading = heading.match(pattern);
      if (matchHeading?.[1]) return cleanEntityDisplayName(cleanText(matchHeading[1]));
      const matchTitle = title.match(pattern);
      if (matchTitle?.[1]) return cleanEntityDisplayName(cleanText(matchTitle[1]));
      const matchBody = body.match(pattern);
      if (matchBody?.[1]) return cleanEntityDisplayName(cleanText(matchBody[1]));
    }

    for (const c of candidates) {
      const n = normalizeText(c);
      if (
        /\b(marketing|menadzment|menadžment|projektni menadzment|projektni menadžment|financije|informatika|komunikacije)\b/.test(n)
      ) {
        if (c.length <= 140) return c;
      }
    }

    if (contentGroup === 'prijediplomski_studiji') return cleanEntityDisplayName(title || heading || '');
    if (contentGroup === 'diplomski_studiji') return cleanEntityDisplayName(title || heading || '');
    if (contentGroup === 'specijalisticki_studiji') return cleanEntityDisplayName(title || heading || '');
  }

  if (entityType === 'kolegij') {
    // Nakon nav-strippinga sadržaj počinje s "Naziv predmeta [IME] Nastavni plan:..."
    const fullText = `${heading}\n${body}`;
    const nazovMatch = fullText.match(
      /Naziv predmeta\s+(.+?)(?:\s+Nastavni plan|\s+Podijelite|\s+Cilj predmeta|\s*\n|$)/i
    );
    if (nazovMatch?.[1]) {
      const name = nazovMatch[1].trim();
      if (name.length >= 3 && name.length <= 120) return cleanEntityDisplayName(name);
    }
    // Fallback: iz URL-a (npr. /predmeti/digitalni-marketing → Digitalni marketing)
    const slugName = extractSlugName(url);
    if (slugName && !/(predmet|kolegij)$/.test(normalizeText(slugName))) {
      return cleanEntityDisplayName(slugName);
    }
    // Fallback: naslovi bez generičnih pojmova
    const lines = [heading, ...body.split('\n').slice(0, 10)];
    for (const line of lines) {
      const t = cleanText(line);
      if (!t) continue;
      if (t.length < 3 || t.length > 120) continue;
      if (/\b(uvod|ects|nositelj|ishodi|sadrzaj|sadržaj|izvedba|opis|nastavni plan)\b/i.test(t)) continue;
      if (/^[A-ZČĆŽŠĐ][A-Za-zČĆŽŠĐčćžšđ0-9\s()./-]+$/.test(t)) return cleanEntityDisplayName(t);
    }
  }

  if (entityType === 'nastavnik') {
    const personPattern = /\b([A-ZČĆŽŠĐ][a-zčćžšđ]+(?:\s+[A-ZČĆŽŠĐ][a-zčćžšđ]+){1,2})\b/;
    const inHeading = heading.match(personPattern);
    if (inHeading?.[1]) return cleanEntityDisplayName(inHeading[1]);
    const inTitle = title.match(personPattern);
    if (inTitle?.[1]) return cleanEntityDisplayName(inTitle[1]);
    const inBody = body.match(personPattern);
    if (inBody?.[1]) return cleanEntityDisplayName(inBody[1]);
  }

  if (entityType === 'upisi') return 'Upisi';
  if (entityType === 'online_studij') return 'Online studiranje';

  if (normalizedHeading && normalizedHeading !== 'uvod') return cleanEntityDisplayName(cleanText(heading));
  if (normalizedTitle) return cleanEntityDisplayName(cleanText(title));
  if (normalizedBody) return cleanEntityDisplayName(cleanText(body.split('\n')[0]));

  return null;
}

function extractParentEntity(input: {
  title: string;
  contentGroup: ContentGroup;
  entityType: EntityType;
  entityName: string | null;
}): { parent_entity_type: string | null; parent_entity_name: string | null } {
  const title = cleanText(input.title);

  if (input.entityType === 'kolegij') {
    if (title) {
      return {
        parent_entity_type: 'studijski_program',
        parent_entity_name: title,
      };
    }
  }

  if (input.entityType === 'studijski_program') {
    if (input.contentGroup === 'prijediplomski_studiji') {
      return { parent_entity_type: 'razina_studija', parent_entity_name: 'Prijediplomski studij' };
    }
    if (input.contentGroup === 'diplomski_studiji') {
      return { parent_entity_type: 'razina_studija', parent_entity_name: 'Diplomski studij' };
    }
    if (input.contentGroup === 'specijalisticki_studiji') {
      return { parent_entity_type: 'razina_studija', parent_entity_name: 'Specijalistički studij' };
    }
  }

  if (input.entityType === 'cjelozivotni_program') {
    return {
      parent_entity_type: 'podrucje',
      parent_entity_name: 'Cjeloživotno obrazovanje',
    };
  }

  return {
    parent_entity_type: null,
    parent_entity_name: null,
  };
}

function buildChunksForDocument(doc: RawDocument): EnrichedChunk[] {
  const title = cleanText(doc.title || '');
  const rawText = cleanText(doc.content || doc.text || '');
  const contentGroup = detectContentGroup(doc.url, title, rawText);
  const sections = splitByHeadings(rawText);

  const chunks: EnrichedChunk[] = [];
  let chunkIndex = 0;
  const seen = new Set<string>();

  const pushChunk = (chunk: Omit<EnrichedChunk, 'chunk_index'>) => {
    const cleanedContent = cleanText(chunk.content);
    if (!cleanedContent) return;
    if (isNoiseContent(cleanedContent)) return;

    const dedupeKey = [
      chunk.entity_type || '',
      chunk.entity_name || '',
      chunk.section_type || '',
      normalizeText(cleanedContent),
    ].join('||');

    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    chunks.push({
      chunk_index: chunkIndex++,
      ...chunk,
      content: cleanedContent,
      entity_name: chunk.entity_name ? cleanEntityDisplayName(chunk.entity_name) : null,
    });
  };

  for (const section of sections) {
    const heading = cleanText(section.heading || '');
    const body = cleanText(section.body || '');
    if (!body) continue;
    if (isNoiseContent(body)) continue;

    const entityType = detectEntityType(contentGroup, heading || title, body);
    const entityName = extractEntityName(doc.url, title, heading, body, contentGroup, entityType);
    const sectionType = classifySectionType({
      heading,
      content: body,
      entityType,
    });

    const parent = extractParentEntity({
      title,
      contentGroup,
      entityType,
      entityName,
    });

    const subChunks = chunkLongText(body, 1200);

    for (const subChunk of subChunks) {
      pushChunk({
        content: subChunk,
        content_group: contentGroup,
        entity_type: entityType,
        entity_name: entityName,
        section_type: sectionType,
        parent_entity_type: parent.parent_entity_type,
        parent_entity_name: parent.parent_entity_name,
      });
    }
  }

  if (!chunks.length && rawText && !isNoiseContent(rawText)) {
    const entityType = detectEntityType(contentGroup, title, rawText);
    const entityName = extractEntityName(doc.url, title, title, rawText, contentGroup, entityType);
    const sectionType = classifySectionType({
      heading: title,
      content: rawText,
      entityType,
    });
    const parent = extractParentEntity({
      title,
      contentGroup,
      entityType,
      entityName,
    });

    const subChunks = chunkLongText(rawText, 1200);
    for (const subChunk of subChunks) {
      pushChunk({
        content: subChunk,
        content_group: contentGroup,
        entity_type: entityType,
        entity_name: entityName,
        section_type: sectionType,
        parent_entity_type: parent.parent_entity_type,
        parent_entity_name: parent.parent_entity_name,
      });
    }
  }

  return chunks;
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const safeTexts = texts.map((t) => trimForEmbedding(t));

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: safeTexts,
  });

  return response.data.map((d) => d.embedding);
}

async function ensureSchema() {
  await pool.query(`
    alter table if exists documents
      add column if not exists content_group text,
      add column if not exists content_hash text
  `);

  await pool.query(`
    alter table if exists document_chunks
      add column if not exists content_group text,
      add column if not exists entity_type text,
      add column if not exists entity_name text,
      add column if not exists section_type text,
      add column if not exists parent_entity_type text,
      add column if not exists parent_entity_name text
  `);
}

async function upsertDocument(doc: RawDocument, contentGroup: ContentGroup, contentHash: string): Promise<number> {
  const text = cleanText(doc.content || doc.text || '');

  const existing = await pool.query(
    `
    select id
    from documents
    where tenant_id = $1 and source_url = $2
    limit 1
    `,
    [TENANT_ID, doc.url]
  );

  if (existing.rows.length) {
    const id = existing.rows[0].id;

    await pool.query(
      `
      update documents
      set
        title = $1,
        content = $2,
        content_group = $3,
        content_hash = $4
      where id = $5
      `,
      [doc.title || null, text, contentGroup, contentHash, id]
    );

    return id;
  }

  const inserted = await pool.query(
    `
    insert into documents (
      tenant_id,
      source_url,
      title,
      section,
      page,
      content,
      content_hash,
      embedding,
      created_at,
      content_group,
      entity_type,
      entity_name,
      section_type,
      parent_entity_type,
      parent_entity_name
    )
    values (
      $1, $2, $3,
      null, null,
      $4, $5, null,
      now(),
      $6, null, null, null, null, null
    )
    on conflict (tenant_id, content_hash) do update
      set source_url = excluded.source_url
    returning id
    `,
    [TENANT_ID, doc.url, doc.title || null, text, contentHash, contentGroup]
  );

  return inserted.rows[0].id;
}

async function deleteOldChunks(documentId: number) {
  await pool.query(`delete from document_chunks where document_id = $1`, [documentId]);
}

async function insertChunks(documentId: number, url: string, title: string | null, chunks: EnrichedChunk[]) {
  const batchSize = 50;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const embeddings = await embedTexts(batch.map((c) => c.content));

    const values: any[] = [];
    const rowsSql: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const c = batch[j];
      const embedding = embeddings[j];

      const base = values.length;
      values.push(
        documentId,
        TENANT_ID,
        url,
        title,
        c.chunk_index,
        c.content,
        `[${embedding.join(',')}]`,
        c.content_group,
        c.entity_type,
        c.entity_name,
        c.section_type,
        c.parent_entity_type,
        c.parent_entity_name
      );

      rowsSql.push(
        `(
          $${base + 1},
          $${base + 2},
          $${base + 3},
          $${base + 4},
          $${base + 5},
          $${base + 6},
          $${base + 7}::vector,
          $${base + 8},
          $${base + 9},
          $${base + 10},
          $${base + 11},
          $${base + 12},
          $${base + 13},
          now()
        )`
      );
    }

    await pool.query(
      `
      insert into document_chunks (
        document_id,
        tenant_id,
        url,
        title,
        chunk_index,
        content,
        embedding,
        content_group,
        entity_type,
        entity_name,
        section_type,
        parent_entity_type,
        parent_entity_name,
        created_at
      )
      values ${rowsSql.join(',\n')}
      `,
      values
    );
  }
}

async function readDocuments(): Promise<RawDocument[]> {
  if (!fs.existsSync(INPUT_PATH)) {
    throw new Error(`Ulazna datoteka ne postoji: ${INPUT_PATH}`);
  }

  const raw = fs.readFileSync(INPUT_PATH, 'utf8');
  const parsed = JSON.parse(raw);

  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.documents)) return parsed.documents;

  throw new Error('Očekujem niz dokumenata ili objekt s poljem documents.');
}

async function main() {
  console.log(`INGEST_INPUT_PATH: ${INPUT_PATH}`);
  console.log(`TENANT_ID: ${TENANT_ID}`);
  console.log(`EMBEDDING_MODEL: ${EMBEDDING_MODEL}`);

  await ensureSchema();

  const docs = await readDocuments();
  console.log(`Dokumenata za ingest: ${docs.length}`);

  for (const doc of docs) {
    const text = cleanText(doc.content || doc.text || '');
    if (!doc.url || !text) {
      console.log(`Preskačem dokument bez URL-a ili sadržaja: ${doc.url || '(bez url)'}`);
      continue;
    }

    const title = cleanText(doc.title || '');
    const contentGroup = detectContentGroup(doc.url, title, text);
    const contentHash = hashContent(text);

    const documentId = await upsertDocument(doc, contentGroup, contentHash);
    await deleteOldChunks(documentId);

    const chunks = buildChunksForDocument(doc);

    if (DEBUG) {
      console.log('\n--------------------------------------------------');
      console.log(`URL: ${doc.url}`);
      console.log(`TITLE: ${title}`);
      console.log(`CONTENT_GROUP: ${contentGroup}`);
      console.log(`CHUNKS: ${chunks.length}`);
      for (const c of chunks.slice(0, 10)) {
        console.log({
          chunk_index: c.chunk_index,
          entity_type: c.entity_type,
          entity_name: c.entity_name,
          section_type: c.section_type,
          parent_entity_type: c.parent_entity_type,
          parent_entity_name: c.parent_entity_name,
          preview: c.content.slice(0, 160),
        });
      }
    }

    await insertChunks(documentId, doc.url, title || null, chunks);
    console.log(`Ingestirano: ${doc.url} | chunkova: ${chunks.length}`);
  }

  console.log('Ingest završen.');
}

main()
  .catch((err) => {
    console.error('Greška u ingest.ts:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
