// ---------------------------------------------------------------------------
// studies.ts — Study programs for EFFECTUS veleučilište
// TODO: Populate after scraping https://effectus.com.hr/studiji/
// ---------------------------------------------------------------------------

export type StudyLocation = "zagreb";

type TuitionInfo = {
  amount: number;
  currency: "EUR";
};

type StudyInfo = {
  name: string;
  level: string;
  tuition?: TuitionInfo;
  source: string;
  note?: string;
  durationYears?: number;
  ects?: number;
  smjerovi?: string[];
  englishAvailable?: boolean;
};

type CjelozivotnoProgram = {
  name: string;
  duration?: string;
  price?: string;
  url: string;
  category?: string;
};

// TODO: Populate after web crawl
export const STUDY_STRUCTURE: Record<string, StudyInfo> = {
  // 'financije-i-poslovno-pravo': {
  //   name: 'Financije i poslovno pravo',
  //   level: 'Preddiplomski stručni studij',
  //   source: 'https://effectus.com.hr/studiji/financije-i-poslovno-pravo/',
  // },
};

export const CJELOZIVOTNO_PROGRAMS: CjelozivotnoProgram[] = [];

const STUDIES_KEYWORDS = [
  'studij', 'studiranje', 'program', 'prijediplomski', 'diplomski',
  'specijalistički', 'školarina', 'upisati', 'upis', 'uvjeti',
  'ects', 'kolegiji', 'semestar', 'trajanje', 'smjer',
];

const CJELOZIVOTNO_KEYWORDS = [
  'cjeloživotno', 'tečaj', 'program obrazovanja', 'poslovno učilište',
  'usavršavanje', 'certifikat', 'dodatno obrazovanje',
];

export function formatStudyAdmissionsAnswer(question: string): string | null {
  const q = question.toLowerCase();
  const isStudyQ = STUDIES_KEYWORDS.some(kw => q.includes(kw));
  if (!isStudyQ) return null;

  // If STUDY_STRUCTURE is empty, let RAG answer from Supabase instead of returning a generic fallback
  if (Object.keys(STUDY_STRUCTURE).length === 0) {
    return null;
  }

  const programs = Object.values(STUDY_STRUCTURE);
  const list = programs.map(p => `- **${p.name}** (${p.level})`).join('\n');
  return `**Studijski programi EFFECTUS veleučilišta:**\n\n${list}\n\nZa detalje posjetite https://effectus.com.hr/studiji/.`;
}

export function formatStudyLocationAnswer(question: string): string | null {
  return null; // Will be populated after crawl
}

export function formatStudySupportAnswer(question: string): string | null {
  return null; // Will be populated after crawl
}

export function formatExpiredCjelozivotnoAnswer(question: string): string | null {
  return null;
}

export function formatCjelozivotnoAnswer(question: string): string | null {
  const q = question.toLowerCase();
  const isCjelozivotnoQ = CJELOZIVOTNO_KEYWORDS.some(kw => q.includes(kw));
  if (!isCjelozivotnoQ) return null;

  if (CJELOZIVOTNO_PROGRAMS.length === 0) {
    return 'Za informacije o programima cjeloživotnog obrazovanja i Poslovnom učilištu Effectus, posjetite https://effectus.com.hr/cjelozivotno-obrazovanje/ ili https://effectus.com.hr/poslovno-uciliste/.';
  }

  const list = CJELOZIVOTNO_PROGRAMS.map(p => `- **${p.name}**${p.duration ? ' (' + p.duration + ')' : ''} — ${p.url}`).join('\n');
  return `**Programi cjeloživotnog obrazovanja:**\n\n${list}`;
}
