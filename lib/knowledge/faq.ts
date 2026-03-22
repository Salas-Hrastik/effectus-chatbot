// ---------------------------------------------------------------------------
// lib/knowledge/faq.ts
// Najčešća pitanja studenata — EFFECTUS veleučilište
// TODO: Populate after scraping https://effectus.com.hr/upisi/cesta-pitanja/
// ---------------------------------------------------------------------------

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

interface FAQEntry {
  keywords: string[];
  requires?: string;
  answer: string;
  source?: string;
}

// TODO: Populate with Effectus-specific FAQ entries after crawl
const FAQ_ENTRIES: FAQEntry[] = [];

export function findFAQAnswer(question: string): string | null {
  if (FAQ_ENTRIES.length === 0) return null;

  const normalized = normalizeText(question);

  for (const entry of FAQ_ENTRIES) {
    const matchCount = entry.keywords.filter(kw => normalized.includes(normalizeText(kw))).length;
    if (matchCount < 2) continue;
    if (entry.requires && !normalized.includes(normalizeText(entry.requires))) continue;
    return entry.answer;
  }

  return null;
}

export function isFAQIntent(question: string): boolean {
  return findFAQAnswer(question) !== null;
}
