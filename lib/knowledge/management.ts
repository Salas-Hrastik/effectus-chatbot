// ---------------------------------------------------------------------------
// management.ts — Institutional corpus for EFFECTUS veleučilište
// Handles: dekan, prodekan, uprava, tajnica, voditelji studija
// TODO: Populate after scraping https://effectus.com.hr/o-nama/uprava/
// ---------------------------------------------------------------------------

export type ManagementPerson = {
  role: string;
  name: string;
  email?: string;
  phone?: string;
  bio?: string;
  photo?: string;
};

export type PastDean = {
  name: string;
  tenure: string;
  note?: string;
};

export type StudyDirector = {
  studyName: string;
  name: string;
  email?: string;
  url?: string;
};

export type QualityMember = {
  role: string;
  name: string;
};

// TODO: Populate after web crawl
export const CURRENT_MANAGEMENT: ManagementPerson[] = [];
export const UPRAVNO_VIJECE: string[] = [];
export const POVJERENSTVO_KVALITETA: QualityMember[] = [];
export const PAST_DEANS: PastDean[] = [];
export const STUDY_DIRECTORS: StudyDirector[] = [];

const MANAGEMENT_KEYWORDS = [
  'dekan', 'prodekan', 'voditelj', 'uprava', 'ravnatelj', 'predsjednik',
  'tajnik', 'pomoćnik', 'povjerenstvo', 'kvaliteta', 'upravno vijeće',
  'tko vodi', 'rukovodstvo', 'čelnici', 'rektor',
];

export function isManagementIntent(question: string): boolean {
  const q = question.toLowerCase();
  return MANAGEMENT_KEYWORDS.some(kw => q.includes(kw));
}

export function formatDekanAnswer(): string {
  const dekan = CURRENT_MANAGEMENT.find(p =>
    p.role.toLowerCase().includes('dekan') && !p.role.toLowerCase().includes('pro')
  );
  if (!dekan) return _notAvailableMsg('dekan');
  return _formatPerson(dekan);
}

export function formatUpravaAnswer(): string {
  if (CURRENT_MANAGEMENT.length === 0) return _notAvailableMsg('uprava');
  return CURRENT_MANAGEMENT.map(_formatPerson).join('\n\n');
}

export function formatPastDeansAnswer(): string {
  if (PAST_DEANS.length === 0) return _notAvailableMsg('dosadašnji dekani');
  return PAST_DEANS.map(d => `- **${d.name}** (${d.tenure})${d.note ? ' — ' + d.note : ''}`).join('\n');
}

export function formatUpravnoVijeceAnswer(): string {
  if (UPRAVNO_VIJECE.length === 0) return _notAvailableMsg('upravno vijeće');
  return UPRAVNO_VIJECE.join('\n');
}

export function formatPovjerenstvoKvalitetaAnswer(): string {
  if (POVJERENSTVO_KVALITETA.length === 0) return _notAvailableMsg('povjerenstvo za kvalitetu');
  return POVJERENSTVO_KVALITETA.map(m => `- **${m.role}**: ${m.name}`).join('\n');
}

export function formatStudyDirectorAnswer(question: string): string | null {
  if (STUDY_DIRECTORS.length === 0) return null;
  const q = question.toLowerCase();
  const match = STUDY_DIRECTORS.find(sd => q.includes(sd.studyName.toLowerCase()));
  if (!match) return null;
  let out = `**Voditelj studija ${match.studyName}:** ${match.name}`;
  if (match.email) out += `\n📧 ${match.email}`;
  if (match.url) out += `\n🔗 ${match.url}`;
  return out;
}

export function findManagementAnswer(question: string): string | null {
  if (!isManagementIntent(question)) return null;

  // If no management data is loaded, let RAG answer from Supabase
  if (
    CURRENT_MANAGEMENT.length === 0 &&
    STUDY_DIRECTORS.length === 0 &&
    PAST_DEANS.length === 0 &&
    UPRAVNO_VIJECE.length === 0
  ) return null;

  const directorAnswer = formatStudyDirectorAnswer(question);
  if (directorAnswer) return directorAnswer;

  const q = question.toLowerCase();

  if (q.includes('prošl') || q.includes('dosadašnj') || q.includes('bivš')) {
    return formatPastDeansAnswer();
  }
  if (q.includes('upravno vijeće') || q.includes('upravnog vijeća')) {
    return formatUpravnoVijeceAnswer();
  }
  if (q.includes('povjerenstvo') || q.includes('kvalitet')) {
    return formatPovjerenstvoKvalitetaAnswer();
  }
  if (q.includes('dekan') && !q.includes('prodekan')) {
    return formatDekanAnswer();
  }
  return formatUpravaAnswer();
}

function _formatPerson(p: ManagementPerson): string {
  let out = `**${p.role}: ${p.name}**`;
  if (p.email) out += `\n📧 ${p.email}`;
  if (p.phone) out += `\n📞 ${p.phone}`;
  if (p.bio) out += `\n\n${p.bio}`;
  return out;
}

function _notAvailableMsg(topic: string): string {
  return `Za informacije o ${topic} EFFECTUS veleučilišta, molim provjerite izravno na https://effectus.com.hr/o-nama/uprava/ ili pišite na info@effectus.com.hr.`;
}
