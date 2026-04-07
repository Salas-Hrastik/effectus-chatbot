// ---------------------------------------------------------------------------
// referada.ts — Student services for EFFECTUS veleučilište
// TODO: Populate after scraping https://effectus.com.hr/studentske-sluzbe/
// ---------------------------------------------------------------------------

// TODO: Populate with actual Effectus referada working hours
export const REFERADA_RADNO_VRIJEME: Record<string, Record<string, string>> = {
  // 'Zagreb': {
  //   'Ponedjeljak – Petak': '9:00 – 17:00',
  // },
};

// TODO: Populate with actual contacts
export const REFERADA_KONTAKTI: Record<string, { email?: string; phone?: string; address?: string }> = {};

// TODO: Populate after crawl
export const ZAVRSNI_RADOVI_INFO = {
  info: '',
  contact: '',
  forms: [] as string[],
};

export const ISPITNI_ROKOVI_INFO = {
  info: 'Ispitni rokovi dostupni su u studentskom portalu ili na web stranici veleučilišta.',
  url: 'https://effectus.com.hr/studentske-sluzbe/ispitni-rokovi/',
};

export const ZAMOLBE_INFO = {
  info: '',
  price: '',
};

export const KNJIZNICA_INFO = {
  director: '',
  email: '',
  hours: '',
  url: 'https://effectus.com.hr/studentske-sluzbe/knjiznica/',
};

const REFERADA_KEYWORDS = [
  'referada', 'studentska služba', 'studentski servis', 'radno vrijeme',
  'završni rad', 'diplomski rad', 'ispitni rok', 'zamolba', 'potvrda',
  'knjižnica', 'biblioteka', 'karijerni centar', 'savjetovalište',
];

export function isReferadaIntent(question: string): boolean {
  const q = question.toLowerCase();
  return REFERADA_KEYWORDS.some(kw => q.includes(kw));
}

export function formatReferadaAnswer(question: string): string | null {
  if (!isReferadaIntent(question)) return null;

  const q = question.toLowerCase();

  if (q.includes('knjižnica') || q.includes('biblioteka')) {
    if (KNJIZNICA_INFO.email) {
      return `**Knjižnica EFFECTUS veleučilišta**\n📧 ${KNJIZNICA_INFO.email}\n🔗 ${KNJIZNICA_INFO.url}`;
    }
    // No data — let RAG answer
    return null;
  }

  if (q.includes('završni') || q.includes('diplomski rad')) {
    if (ZAVRSNI_RADOVI_INFO.info) return ZAVRSNI_RADOVI_INFO.info;
    return null;
  }

  if (q.includes('ispitni rok') || q.includes('rokovi ispita')) {
    if (ISPITNI_ROKOVI_INFO.info) return `${ISPITNI_ROKOVI_INFO.info}\n🔗 ${ISPITNI_ROKOVI_INFO.url}`;
    return null;
  }

  if (q.includes('radno vrijeme') || q.includes('referada')) {
    if (Object.keys(REFERADA_RADNO_VRIJEME).length > 0) {
      return Object.entries(REFERADA_RADNO_VRIJEME)
        .map(([loc, hours]) => `**${loc}**\n` + Object.entries(hours).map(([day, time]) => `  ${day}: ${time}`).join('\n'))
        .join('\n\n');
    }
    return null;
  }

  // No hardcoded data available — let RAG answer
  return null;
}
