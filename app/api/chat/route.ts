import { NextRequest } from 'next/server';
import { SYSTEM_PROMPT } from '@/lib/prompt';
import { streamChat } from '@/lib/llm/provider';
import { isQuestionUsable } from '@/lib/rag/guardrails';
import { pool } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import type { ChatMessage } from '@/lib/types';
import { formatStudyAdmissionsAnswer, formatStudyLocationAnswer, formatStudySupportAnswer, formatCjelozivotnoAnswer, formatExpiredCjelozivotnoAnswer, STUDY_STRUCTURE } from "@/lib/knowledge/studies";
import { findTeachersForCourse, findTeacherByName, isTeacherIntent, findStudyProgramTeachers } from "@/lib/knowledge/teachers";
import { findManagementAnswer, isManagementIntent, CURRENT_MANAGEMENT } from "@/lib/knowledge/management";
import { formatReferadaAnswer, isReferadaIntent } from "@/lib/knowledge/referada";
import { findFAQAnswer, isFAQIntent } from "@/lib/knowledge/faq";

export const runtime = 'nodejs';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEBUG_RAG = process.env.DEBUG_RAG === 'true';

const RAG_CONFIG = {
  embeddingModel: 'text-embedding-3-small',
  minSimilarity: 0.28,
  minGoodChunks: 1,
  semanticCandidatePool: 24,
  maxKeywordChunks: 8,
  maxFinalChunks: 10,
  exactEntitySectionLimit: 8,
  exactEntityLimit: 10,
} as const;

type RetrievedChunk = {
  id: number;
  document_id: number;
  tenant_id: string;
  url: string | null;
  title: string | null;
  chunk_index: number;
  content: string;
  similarity: number;
  content_group: string | null;
  entity_type: string | null;
  entity_name: string | null;
  section_type: string | null;
  parent_entity_type: string | null;
  parent_entity_name: string | null;
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

type FactIntent =
  | 'trajanje'
  | 'uvjeti'
  | 'cijena'
  | 'kontakt'
  | 'termini'
  | 'sadrzaj'
  | 'opis'
  | 'ishodi'
  | 'izvedba'
  | 'nositelj'
  | 'ects'
  | 'popis_cjelozivotnih'
  | 'popis_studijskih'
  | null;

type ClarificationKind =
  | 'cijena'
  | 'trajanje'
  | 'uvjeti'
  | 'termini'
  | 'upis'
  | null;

type ResolvedQuery = {
  contentGroup: ContentGroup;
  requestedSectionType: SectionType | null;
  preferredUrl: string | null;
  resolvedEntityName: string | null;
  isFollowUp: boolean;
  retrievalQuery: string;
};

const STRICT_FALLBACK =
  'Ne mogu pouzdano odgovoriti na temelju dostupnih javnih izvora.';

const PLAIN_TEXT_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
} as const;

const NO_CACHE_HEADERS = {
  ...PLAIN_TEXT_HEADERS,
  'Cache-Control': 'no-store',
} as const;

// ---------------------------------------------------------------------------
// Osnovne pomoćne funkcije
// ---------------------------------------------------------------------------

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanInline(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function splitIntoSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function shortPreview(text: string, max = 180): string {
  const compact = cleanInline(text);
  return compact.length <= max ? compact : `${compact.slice(0, max)}...`;
}

function logChunks(label: string, chunks: RetrievedChunk[]): void {
  if (!DEBUG_RAG) return;
  console.log(`\n=== ${label} (${chunks.length}) ===`);
  chunks.forEach((chunk, index) => {
    console.log(
      [
        `#${index + 1}`,
        `id=${chunk.id}`,
        `doc=${chunk.document_id}`,
        `group=${chunk.content_group ?? 'N/A'}`,
        `entity=${chunk.entity_type ?? 'N/A'}`,
        `entity_name=${chunk.entity_name ?? 'N/A'}`,
        `section=${chunk.section_type ?? 'N/A'}`,
        `chunk=${chunk.chunk_index}`,
        `sim=${typeof chunk.similarity === 'number' ? chunk.similarity.toFixed(4) : 'N/A'}`,
        `url=${chunk.url ?? 'N/A'}`,
        `preview=${shortPreview(chunk.content)}`,
      ].join(' | ')
    );
  });
}

function dedupeChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Set<number>();
  const result: RetrievedChunk[] = [];
  for (const chunk of chunks) {
    if (seen.has(chunk.id)) continue;
    seen.add(chunk.id);
    result.push(chunk);
  }
  return result;
}

function dedupeSources(chunks: RetrievedChunk[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const chunk of chunks) {
    const url = chunk.url?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function shouldForceFallback(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return (
    normalized === STRICT_FALLBACK.toLowerCase() ||
    normalized.startsWith(STRICT_FALLBACK.toLowerCase())
  );
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

async function getQueryEmbedding(input: string): Promise<number[]> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY nije postavljen u .env.local');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: RAG_CONFIG.embeddingModel,
      input,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Greška pri embeddings pozivu: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const embedding = data?.data?.[0]?.embedding;

  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Query embedding nije vraćen u očekivanom formatu.');
  }

  return embedding;
}

function toVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}

// ---------------------------------------------------------------------------
// Povijest razgovora
// ---------------------------------------------------------------------------

function getRecentConversation(messages: ChatMessage[], limit = 8): ChatMessage[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-limit);
}

function getPreviousUserMessage(messages: ChatMessage[]): ChatMessage | undefined {
  const users = messages.filter((m) => m.role === 'user' && m.content?.trim());
  return users.length >= 2 ? users[users.length - 2] : undefined;
}

function extractSourceUrlsFromText(text: string): string[] {
  if (!text) return [];
  return (text.match(/Izvor:\s*(https?:\/\/\S+)/gi) ?? [])
    .map((m) => m.replace(/^Izvor:\s*/i, '').trim())
    .filter(Boolean);
}

function getLastValidAssistantSourceUrl(messages: ChatMessage[]): string | null {
  const assistants = [...messages]
    .reverse()
    .filter((m) => m.role === 'assistant' && m.content?.trim());

  for (const msg of assistants) {
    if (msg.content.includes(STRICT_FALLBACK)) continue;
    const urls = extractSourceUrlsFromText(msg.content);
    if (urls.length) return urls[0];
  }

  return null;
}

function extractPreviousAssistantEntityName(messages: ChatMessage[]): string | null {
  const assistants = [...messages]
    .reverse()
    .filter((m) => m.role === 'assistant' && m.content?.trim());

  for (const msg of assistants) {
    if (msg.content.includes(STRICT_FALLBACK)) continue;
    const patterns = [
      /(?:program|studij|kolegij)\s+([A-ZČĆŽŠĐ][^\n:.]{2,120})/i,
      /([A-ZČĆŽŠĐ][A-Za-zČĆŽŠĐčćžšđ0-9\s().\-\/]{3,120})\n\nIzvor:/,
    ];

    for (const pattern of patterns) {
      const match = msg.content.match(pattern);
      if (match?.[1]) return cleanInline(match[1]);
    }
  }

  return null;
}

function lastAssistantAskedForProgram(messages: ChatMessage[]): boolean {
  // Check ONLY the most recent assistant message to avoid carrying over stale context
  // from earlier clarification rounds in a long conversation.
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant' && m.content?.trim());
  if (!lastAssistant) return false;
  const t = normalizeText(lastAssistant.content);
  return (
    t.includes('mislite li na prijediplomski studij') ||
    t.includes('mozete navesti i konkretan program') ||
    t.includes('možete navesti i konkretan program') ||
    t.includes('zanima li vas upis na prijediplomski studij')
  );
}

// Returns true when the MOST RECENT assistant message was the teacher/course clarification.
// IMPORTANT: checks only the last message — not the whole history — so the teacher context
// does not persist across unrelated turns in a long conversation.
function lastAssistantAskedForCourse(messages: ChatMessage[]): boolean {
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant' && m.content?.trim());
  if (!lastAssistant) return false;
  const t = normalizeText(lastAssistant.content);
  return (
    t.includes('nastavnici i suradnici predaju na vise studija') ||
    t.includes('za koji studij ili kolegij') ||
    t.includes('koji vas konkretno zanima')
  );
}

/**
 * Extract the teacher name from the last assistant message.
 * Handles two formats:
 *  1. Profile answer: first line is "**prof. dr. sc. Drago Ružić**" (may start with title)
 *  2. Teacher list: "👤 **Drago Ružić** [PHOTO:...]" lines
 */
function extractLastMentionedTeacher(messages: ChatMessage[]): string | null {
  const lastAssist = [...messages].reverse().find((m) => m.role === 'assistant' && m.content?.trim());
  if (!lastAssist) return null;

  // Try patterns in priority order:
  //  1. 👤 avatar → first teacher in a list ("👤 **Ime Prezime** [PHOTO:...]")
  //  2. Line-start bold → teacher profile first line ("**prof. dr. sc. Ime Prezime**")
  const candidates = [
    lastAssist.content.match(/👤\s+\*\*([^*\n]{5,70})\*\*/),
    lastAssist.content.match(/^\*\*([^*\n]{5,70})\*\*/m),
  ];

  for (const m of candidates) {
    if (!m) continue;
    const raw = m[1].replace(/\[PHOTO:[^\]]+\]/g, '').trim();
    // Must have at least one uppercase Croatian/Latin letter (name part), a space, no digits
    if (/[A-ZŠĐŽČĆ]/.test(raw) && /\s/.test(raw) && !/\d/.test(raw) && raw.length >= 5) {
      return raw;
    }
  }
  return null;
}

/**
 * Strip academic titles from a teacher name string and return a clean surname
 * suitable for an ILIKE content search in Supabase.
 * e.g. "dr. sc. Drago Ružić, pred." → "Ružić"
 */
function teacherSurnameToken(nameStr: string): string {
  const tokens = teacherNameTokens(nameStr);
  return tokens[tokens.length - 1] ?? nameStr;
}

/**
 * Strip academic titles from a teacher name and return ALL significant name tokens
 * (first name + last name, etc.).  Used to build multi-column ILIKE conditions so
 * that surnames shared by two teachers (e.g. "Ružić") don't cross-contaminate results.
 * e.g. "izv. prof. dr. sc. Drago Ružić" → ["Drago", "Ružić"]
 *      "dr. sc. Alisa Bilal Zorić"       → ["Alisa", "Bilal", "Zorić"]
 */
function teacherNameTokens(nameStr: string): string[] {
  const clean = nameStr
    .replace(/\*\*/g, '')
    .replace(/\b(dr|mr|mag|univ|spec|prof|dipl|bacc|oec|sc|ing|doc|izv|pred|red|vs|v|nasl|socio|strud|stud)\b\.?\s*/gi, '')
    .replace(/,.*$/, '')
    .trim();
  return clean.split(/\s+/).filter(p => p.length >= 2);
}

/**
 * Fetch the effectus.com.hr WordPress featured-image URL for a teacher profile page.
 * Uses a process-level cache (Map) so repeated lookups for the same teacher
 * within a server process don't hit the WP API twice.
 * Returns null on any error or if no featured image exists.
 */
const _photoCache = new Map<string, string | null>();

async function fetchTeacherPhotoUrl(profileUrl: string): Promise<string | null> {
  if (_photoCache.has(profileUrl)) return _photoCache.get(profileUrl) ?? null;

  try {
    const slugMatch = profileUrl.match(/nastavnici\/([^/]+)\/?$/);
    if (!slugMatch) { _photoCache.set(profileUrl, null); return null; }
    const slug = slugMatch[1];

    const wpUrl =
      `https://effectus.com.hr/wp-json/wp/v2/nastavnici` +
      `?slug=${encodeURIComponent(slug)}&_embed&_fields=id,slug,_embedded`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(wpUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'EffectusBot/1.0' },
      });
      if (!res.ok) { _photoCache.set(profileUrl, null); return null; }
      const data = await res.json();
      const photo: string | null =
        data[0]?._embedded?.['wp:featuredmedia']?.[0]?.source_url ?? null;
      _photoCache.set(profileUrl, photo);
      return photo;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    _photoCache.set(profileUrl, null);
    return null;
  }
}

/**
 * Returns the teacher's full name if the current question is a follow-up
 * asking about what else that teacher teaches on other study programs.
 */
function isTeacherFollowUp(question: string, messages: ChatMessage[]): string | null {
  const q = normalizeText(question);
  const isFollowUp =
    q.includes('sto jos') || q.includes('jos predaje') ||
    q.includes('na kojim studijima') || q.includes('na kojim smjerovima') ||
    q.includes('na drugim studijima') || q.includes('na ostalim studijima') ||
    q.includes('sve predaje') || q.includes('predaje jos') ||
    q.includes('na svim studijima') || q.includes('koji jos predaje') ||
    // "A što je sa drugim kolegijima?" / "ostalim kolegijima?"
    q.includes('drugim kolegij') || q.includes('ostalim kolegij') ||
    q.includes('koje kolegije') || q.includes('koje jos predaje') ||
    q.includes('sto je sa') || q.includes('a sto predaje') ||
    // "još predaje" / "još uči" variants
    q.includes('jos uci') || q.includes('sto sve predaje') ||
    // Bare "kolegiji?" follow-up (short, context-dependent)
    (q.trim() === 'kolegiji' || q.trim() === 'koji kolegiji' || q.trim() === 'koji kolegiji?');
  if (!isFollowUp) return null;
  return extractLastMentionedTeacher(messages);
}

// ---------------------------------------------------------------------------
// Context resolver: "na tom studiju" / "za taj studij" follow-up handler
// ---------------------------------------------------------------------------

/**
 * Detects queries with relative references ("na tom studiju", "za taj studij")
 * that refer to the study program mentioned in the previous assistant message.
 * Extracts the program name and calls findStudyProgramTeachers with it.
 */
function resolveStudyProgramContext(question: string, messages: ChatMessage[]): string | null {
  const q = normalizeText(question);

  // Match queries that use pronouns to reference a previously-mentioned study program
  const isContextQuery =
    q.includes('na tom studiju') || q.includes('za taj studij') ||
    q.includes('na ovom studiju') || q.includes('za ovaj studij') ||
    q.includes('na tom smjeru') || q.includes('na ovom smjeru') ||
    /\bkolegiji.*\btom\b/.test(q) || /\bpredaju.*\btom\b/.test(q) ||
    /\buvjeti.*\btaj\b/.test(q) || /\bupis.*\btaj\b/.test(q);

  if (!isContextQuery) return null;

  // Extract the study program name from the last assistant message.
  // findStudyProgramTeachers produces: "Nastavnici na studiju **Program Name** (Location):"
  const lastAssist = [...messages].reverse().find(m => m.role === 'assistant' && m.content?.trim());
  if (!lastAssist) return null;

  const nameMatch = lastAssist.content.match(/na studiju \*\*([^*()\n]+)\*\*/i);
  if (!nameMatch) return null;

  const programName = nameMatch[1].trim();
  // Re-run the program teacher lookup with the resolved canonical name
  return findStudyProgramTeachers(programName);
}

// ---------------------------------------------------------------------------
// Opći upiti i potpitanja
// ---------------------------------------------------------------------------

function findSpecificProgramMention(normalizedQuestion: string): boolean {
  const patterns = [
    /\bturisticki vodic\b|\bturistički vodič\b/,
    /\bturisticki vodici\b|\bturistički vodiči\b/,
    /\bvoditelj poslova u turistickoj agenciji\b|\bvoditelj poslova u turističkoj agenciji\b/,
    /\bonline studij\b|\bonline studiranje\b/,
    /\bprijediplomski studij\b/,
    /\bdiplomski studij\b/,
    /\bcjelozivotni program\b|\bcjeloživotni program\b/,
  ];
  return patterns.some((p) => p.test(normalizedQuestion));
}

function shouldForceClarification(question: string): string | null {
  const q = normalizeText(question);

  // Never trigger clarification for contact/info questions — they have specific handlers
  const isContactQuestion = /\bkontakt\b|\bkontakti\b|\btelefon\b|\bemail\b|\be-mail\b|\bkome se javiti\b/.test(q);
  if (isContactQuestion) return null;

  const mentionsEffectus = /\beffectus\b|\beffectusu\b/.test(q);
  const mentionsStudy = /\bstudij\b|\bstudija\b|\bgodina studija\b|\bprogram\b|\bprograma\b/.test(q);

  const asksPrice =
    /\bcijena\b|\bskolarina\b|\bškolarina\b|\bkoliko kosta\b|\bkoliko košta\b/.test(q);

  const asksDuration =
    /\bkoliko traje\b|\btrajanje\b|\btrajanje studija\b|\bkoliko godina\b|\bgodina studija\b/.test(q);

  const asksAdmissions =
    /\buvjeti\b|\bupis\b|\bupisi\b|\buvjeti za upis\b/.test(q);

  const asksDates =
    /\btermini\b|\brokovi\b|\btermini upisa\b|\brokovi upisa\b/.test(q);

  if (
    asksPrice &&
    (mentionsStudy || mentionsEffectus || /^(cijena|skolarina|školarina)$/.test(q)) &&
    !findSpecificProgramMention(q)
  ) {
    return 'Rado. Mislite li na prijediplomski studij, diplomski studij, online studij ili cjeloživotni program? Možete navesti i konkretan program.';
  }

  if (
    asksDuration &&
    (mentionsStudy || mentionsEffectus || /^(trajanje|koliko traje)$/.test(q)) &&
    !findSpecificProgramMention(q)
  ) {
    return 'Naravno. Zanima li vas trajanje prijediplomskog studija, diplomskog studija, online studija ili cjeloživotnog programa? Možete navesti i konkretan program.';
  }

  if (
    asksAdmissions &&
    (mentionsStudy || mentionsEffectus || q === 'uvjeti za upis' || q === 'uvjeti') &&
    !findSpecificProgramMention(q)
  ) {
    return 'Naravno. Zanima li vas upis na prijediplomski studij, diplomski studij, online studij ili cjeloživotni program?';
  }

  if (
    asksDates &&
    (mentionsStudy || mentionsEffectus || q === 'termini upisa' || q === 'termini') &&
    !findSpecificProgramMention(q)
  ) {
    return 'Naravno. Mislite li na termine upisa za prijediplomski studij, diplomski studij, online studij ili neki konkretan program?';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Klasifikacija pitanja
// ---------------------------------------------------------------------------

function detectRequestedSectionType(question: string): SectionType | null {
  const q = normalizeText(question);

  if (/\bkontakt\b|\bkome se javiti\b|\btelefon\b|\bemail\b|\be-mail\b/.test(q)) return 'kontakt';
  if (/\btermin\b|\btermini\b|\bpocetak\b|\bpočetak\b|\bkada pocinje\b|\bkada počinje\b|\brok\b|\brokovi\b/.test(q)) return 'termini';
  if (/\bcijena\b|\bkoliko kosta\b|\bkoliko košta\b|\biznosi\b|\bskolarina\b|\bškolarina\b/.test(q)) return 'cijena';
  if (/\bkoliko traje\b|\btraje\b|\btrajanje\b|\bbroj sati\b|\bsatnica\b|\bgodina studija\b|\bkoliko godina\b/.test(q)) return 'trajanje';
  if (/\bkoji su uvjeti\b|\buvjeti\b|\buvjet\b|\bpreduvjeti\b/.test(q)) return 'uvjeti';
  if (/\bpredmeti\b|\bsadrzaj\b|\bsadržaj\b|\bmoduli\b|\bsto se uci\b|\bšto se uči\b/.test(q)) return 'sadrzaj';
  if (/\bishodi\b|\bishodi ucenja\b|\bishodi učenja\b/.test(q)) return 'ishodi';
  if (/\bizvedba\b|\bnacin izvedbe\b|\bnačin izvedbe\b/.test(q)) return 'izvedba';
  if (/\bnositelj\b|\btko izvodi\b|\btko ga izvodi\b|\btko predaje\b/.test(q)) return 'nositelj';
  if (/\bects\b|\bkoliki ects\b|\bkoliko ects\b/.test(q)) return 'ects';
  if (/\bupis\b|\bprijava\b/.test(q)) return 'upis';
  if (/\bopis\b|\bo cemu je rijec\b|\bo čemu je riječ\b/.test(q)) return 'opis';

  return null;
}

function detectFactIntent(question: string): FactIntent {
  const q = normalizeText(question);

  if (
    /\bkoje programe cjelozivotnog obrazovanja\b/.test(q) ||
    /\bkoji su programi cjelozivotnog obrazovanja\b/.test(q) ||
    /\bpopis programa cjelozivotnog obrazovanja\b/.test(q)
  ) return 'popis_cjelozivotnih';

  if (
    /\bkoji studijski programi\b/.test(q) ||
    /\bkoji su studijski programi\b/.test(q) ||
    /\bpopis studijskih programa\b/.test(q)
  ) return 'popis_studijskih';

  const section = detectRequestedSectionType(question);
  if (!section) return null;
  return section as FactIntent;
}

function isFactSeekingQuestion(question: string): boolean {
  return detectFactIntent(question) !== null;
}

function isFollowUpQuestion(question: string): boolean {
  const q = normalizeText(question).trim();
  const followUpPatterns = [
    // Croatian connectives at start
    /^a\b/,           // "a što je..."
    /^i\b/,           // "i kako..."
    /^pa\b/,          // "pa što..."
    /^ali\b/,         // "ali..."
    /^ok\b/,          // "ok, a..."
    /^dobro\b/,       // "dobro, a..."
    /^hvala\b/,       // "hvala, a..."
    /^super\b/,       // "super, a..."
    /^jasno\b/,       // "jasno, a..."
    /^razumijem\b/,   // "razumijem, a..."
    /^zanimljivo\b/,  // "zanimljivo..."
    // Explicit continuation phrases
    /recite mi vise/, /recite mi jos/, /recite jos/,
    /vise informacij/, /vise o tome/, /vise o njemu/, /vise o njoj/,
    /jos nesto/, /jos pitanje/, /jos jedan/, /jos jedno/,
    /sto jos/, /nesto jos/, /a jos/,
    /mozete li objasniti/, /mozete objasniti/, /moze objasniti/,
    /zanima me vise/, /zanima me jos/,
    /mozete li reci vise/, /recite vise/,
    /detaljnije/, /detaljno/,
    // Reference to previous topic with pronouns
    /\b(tome|njemu|njoj|njima|ovome|onome|tim|ovim|onim)\b/,
    // "A što je sa..." patterns
    /^a sto je s/,
    /^a kako je s/,
    /^sto je s cijenom\b/,
    /^a cijena\b/,
    /^a uvjeti\b/,
    /^a kontakt\b/,
    /^a termini\b/,
    // Common short follow-up questions
    /^koliko traje\b/,
    /^kolika je cijena\b/,
    /^koji su uvjeti\b/,
    /^koji su termini\b/,
    /^ima li kontakt\b/,
    /^koliko ects\b/,
    /^tko izvodi\b/,
    /^koji su ishodi\b/,
    /^ima li online\b/,
    /^postoji li online\b/,
    // Semester / year / schedule follow-ups
    /^na kojoj godini\b/,      // "Na kojoj godini se predaje?"
    /^u kojem semestru\b/,     // "U kojem semestru?"
    /^koji semestar\b/,        // "Koji semestar?"
    /^koja godina\b/,          // "Koja godina studija?"
    /^na kojoj razini\b/,      // "Na kojoj razini studija?"
    /^koliko ects\b/,          // "Koliko ECTS bodova?"
    /^koliko bodov/,           // "Koliko bodova?"
    /^koji je semestar\b/,
    /^koja je godina\b/,
    /^je li obavezan\b/,       // "Je li obavezan predmet?"
    /^je li izborni\b/,
    /^koji tip predmeta\b/,
    /^da li je obavezan\b/,
    /^da li je izborni\b/,
    // Generic attribute follow-ups (used without subject = implicit reference)
    /^kakav je\b/,
    /^koji je cilj\b/,
    /^sto je cilj\b/,
    /^koji su ishodi ucenja\b/,
    /^ima li preduvjeta\b/,
    /^koji su preduvjeti\b/,
    /^tocno je\b/,             // "Točno je?"
    /^je li tocno\b/,          // "Je li točno?"
    /^provjeri\b/,             // "Provjeri..."
  ];
  return followUpPatterns.some((p) => p.test(q));
}

// ---------------------------------------------------------------------------
// Klasifikacija domene
// ---------------------------------------------------------------------------

function classifyContentGroup(question: string): ContentGroup {
  const q = normalizeText(question);

  if (/\bcjelozivot/.test(q) || /\bobrazovanj/.test(q) || /\btecaj/.test(q) || /\bturistick/.test(q) || /\bvodic/.test(q)) {
    return 'cjelozivotno_obrazovanje';
  }

  if (/\bonline/.test(q)) return 'online_studiranje';
  if (/\bprijediplomski\b/.test(q)) return 'prijediplomski_studiji';
  if (/\bdiplomski\b/.test(q)) return 'diplomski_studiji';
  if (/\bspecijalisticki\b|\bspecijalistički\b/.test(q)) return 'specijalisticki_studiji';
  if (/\bkolegij\b|\bects\b|\bnositelj\b|\bishodi\b/.test(q)) return 'kolegiji';
  if (/\bnastavnik\b|\bpredavac\b|\bpredavač\b/.test(q)) return 'nastavnici';
  if (/\bstudijsk/.test(q) || /\bprogram/.test(q) || /\bstudij\b/.test(q)) return 'studijski_programi';
  if (/\bupis/.test(q) || /\bskolarin/.test(q) || /\brok/.test(q) || /\bprijav/.test(q) || /\bprocedur/.test(q) || /\bdokumentacij/.test(q)) {
    return 'upisi';
  }

  return 'opcenito';
}

function mapUrlToGroup(url: string | null): ContentGroup | null {
  if (!url) return null;
  const lower = url.toLowerCase();

  if (lower.includes('/cjelozivotno-obrazovanje/')) return 'cjelozivotno_obrazovanje';
  if (lower.includes('/online-studiranje/')) return 'online_studiranje';
  if (lower.includes('/upisi/')) return 'upisi';
  if (lower.includes('/studijski-programi/') || lower.includes('/predmeti/')) return 'studijski_programi';
  if (lower.includes('/prijediplomski')) return 'prijediplomski_studiji';
  if (lower.includes('/diplomski')) return 'diplomski_studiji';
  if (lower.includes('/specijalisticki')) return 'specijalisticki_studiji';
  if (lower.includes('/nastavnici')) return 'nastavnici';

  return 'opcenito';
}

function resolveContentGroup(messages: ChatMessage[], latestQuestion: string): ContentGroup {
  const direct = classifyContentGroup(latestQuestion);
  if (!isFollowUpQuestion(latestQuestion)) return direct;

  const sourceGroup = mapUrlToGroup(getLastValidAssistantSourceUrl(messages));
  if (sourceGroup && sourceGroup !== 'opcenito') return sourceGroup;

  return direct;
}

/**
 * Extracts key named entities (bold names, study programs) from an assistant message
 * to use as retrieval context for follow-up questions.
 * E.g. "**prof. dr. sc. Drago Ružić**\n...kolegiji..." → "Drago Ružić"
 */
function extractAssistantEntityContext(assistantContent: string): string {
  // Search first 15 lines for named entities
  const lines = assistantContent.split('\n').slice(0, 15);
  const entities: string[] = [];

  for (const line of lines) {
    // 1. Bold names/titles: **Name Surname** (optionally with [PHOTO:...])
    const boldMatches = line.matchAll(/\*\*([^*\n]{4,70})\*\*/g);
    for (const m of boldMatches) {
      const raw = m[1].replace(/\[PHOTO:[^\]]+\]/g, '').trim();
      // Only keep proper names (has uppercase letter + space, no markdown artifacts)
      if (/[A-ZŠĐŽČĆ]/.test(raw) && /\s/.test(raw) && !/^\d/.test(raw) && raw.length >= 4) {
        entities.push(raw);
      }
    }
    // 2. Match "studij **Program**" or "Nastavnici na studiju **Program**"
    const studijMatch = line.match(/studij[u\s]+\*\*([^*()\n]{4,60})\*\*/i);
    if (studijMatch) entities.push(studijMatch[1].trim());

    // 3. Match quoted course names: "Kolegij **"Course name"**" or bold-quoted "**"...**"
    const quotedBoldMatch = line.matchAll(/\*\*[""„]([^""\n]{3,60})[""]\*\*/g);
    for (const m of quotedBoldMatch) {
      entities.push(m[1].trim());
    }

    // 4. Match "Kolegij X" pattern in plain text (bot confirming a course)
    const kolegijMatch = line.match(/[Kk]olegij\s+[""„]?([A-ZŠĐŽČĆ][a-zšđžčćA-ZŠĐŽČĆ\s]{3,50})[""„]?/);
    if (kolegijMatch) entities.push(kolegijMatch[1].trim());
  }

  // Also look at previous user message embedded in confirmation — extract course name
  // e.g. user said "Provjeri: Počela turizma — Kristian Šustar" → extract "Počela turizma"
  const dashMatch = assistantContent.match(/[""„]([A-ZŠĐŽČĆ][a-zšđžčćA-ZŠĐŽČĆ\s]{3,50})[""„]/);
  if (dashMatch) entities.push(dashMatch[1].trim());

  // Deduplicate, take first 3 (most salient entities)
  const unique = Array.from(new Set(entities)).slice(0, 3);
  return unique.join(' ');
}

function buildContextualRetrievalQuery(messages: ChatMessage[], latestQuestion: string): string {
  const followUp = isFollowUpQuestion(latestQuestion);
  const previousUser = getPreviousUserMessage(messages);

  // When the bot just asked for clarification ("Zanima li vas prijediplomski studij,
  // diplomski studij...?") and the user answers with a study type, combine the
  // previous user question with the new answer to preserve the original intent.
  // E.g.: "Koji su uvjeti upisa?" + "prijediplomski studij" → combined retrieval query.
  if (!followUp && lastAssistantAskedForProgram(messages) && previousUser?.content) {
    return `${previousUser.content} ${latestQuestion}`;
  }

  if (!followUp) return latestQuestion;

  // For follow-up questions: build a context-enriched retrieval query by combining:
  // 1. Key named entities from the last assistant response (teacher name, study program)
  // 2. Previous user question
  // 3. Current question
  const lastAssist = [...messages].reverse().find(m => m.role === 'assistant' && m.content?.trim());
  const assistCtx = lastAssist ? extractAssistantEntityContext(lastAssist.content) : '';

  const parts: string[] = [];
  if (assistCtx) parts.push(assistCtx);
  if (previousUser?.content && previousUser.content !== latestQuestion) {
    parts.push(previousUser.content);
  }
  parts.push(latestQuestion);

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Entity resolution
// ---------------------------------------------------------------------------

function normalizeEntityText(t: string): string {
  return normalizeText(t)
    .replace(/[?!.:,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEntityQuery(input: string): string {
  let q = normalizeEntityText(input);

  const aliasMap: Array<[RegExp, string]> = [
    [/\bturisticki vodici\b|\bturistički vodiči\b/, 'turisticki vodic'],
    [/\bturisticki vodic\b|\bturistički vodič\b/, 'turisticki vodic'],
    [/\bvodič\b|\bvodic\b/, 'turisticki vodic'],
    [/\bvoditelji poslova u turistickoj agenciji\b|\bvoditelji poslova u turističkoj agenciji\b/, 'voditelj poslova u turistickoj agenciji'],
    [/\bvoditelj poslova u turistickoj agenciji\b|\bvoditelj poslova u turističkoj agenciji\b/, 'voditelj poslova u turistickoj agenciji'],
    [/\bturisticka agencija\b|\bturistička agencija\b/, 'voditelj poslova u turistickoj agenciji'],
  ];

  for (const [pattern, replacement] of aliasMap) {
    q = q.replace(pattern, replacement);
  }

  return q;
}

async function getKnownEntityNames(contentGroup: ContentGroup): Promise<string[]> {
  const values: Array<string> = [getTenantId()];
  let groupClause = '';

  if (contentGroup !== 'opcenito') {
    values.push(contentGroup);
    groupClause = `and content_group = $2`;
  }

  const result = await pool.query(
    `
    select distinct entity_name
    from document_chunks
    where tenant_id = $1
      ${groupClause}
      and entity_name is not null
      and length(trim(entity_name)) > 1
    order by entity_name asc
    `,
    values
  );

  return result.rows
    .map((r: { entity_name: string | null }) => r.entity_name?.trim())
    .filter(Boolean) as string[];
}

// Strips academic title prefixes/suffixes from a normalized entity name so that
// "dr sc socio ivana lackovic prof struc stud" → "ivana lackovic"
// This enables person entity resolution when the DB stores full titled names.
//
// Built from actual nastavnici DB entity_name patterns — covers all title abbreviations
// and full-word qualifiers used in Croatian/regional academic naming conventions.
const TITLE_WORDS = new Set([
  // Standard abbreviated titles (before and after name)
  'dr','sc','doc','izv','red','prof','mr','mag','pred','vs','v',
  'univ','struc','stud','spec','socio','nasl','dipl','ing',
  // Full-word qualifiers that appear after names
  'predavac',          // predavač
  'visi',              // viši (e.g. "viši predavač")
  'viseg',             // višeg
  'visoke',            // "profesor visoke škole"
  'skole',             // škole
  'profesor',          // "redoviti profesor", "profesor visoke škole"
  'redoviti',          // "redoviti profesor"
  'docent',            // "dr. sc. X, docent"
  // Degree field abbreviations (post-name qualifiers)
  'oec',               // oeconomiae
  'mba',               // Master of Business Administration
  'bacc',              // baccalaureus
  'comm',              // communicationis
  'art',               // artium
  'prav',              // pravnik
  'iur',               // iuris
  'psych',             // psychology
  'phon',              // phonetics
  'angl',              // anglistica
  'croat',             // croatistica
  'human',             // humanistički (dr. sc. human.)
  'educ',              // educationis
  'philol',            // philologiae
  'germ',              // germanistika
  'litt',              // litterarum
  'comp',              // comparativum
  'techn',             // technicae
  'grad',              // građ. (građevinarstvo abbreviation)
  'rel',               // relations
  'publ',              // public
  'pec',               // spec. pec.
]);

function stripTitleWords(normalized: string): string {
  return normalized.split(/\s+/).filter(w => !TITLE_WORDS.has(w) && w.length > 0).join(' ');
}

function findEntityNameLoosely(question: string, entityNames: string[]): string | null {
  const normalizedQuestion = normalizeEntityQuery(question);
  const sorted = [...entityNames].sort((a, b) => b.length - a.length);

  // Academic title strip — words ≥4 chars from stripped candidate that appear in question
  const qWords = new Set(normalizedQuestion.split(/\s+/).filter(w => w.length >= 4));

  for (const candidate of sorted) {
    const normalizedCandidate = normalizeEntityQuery(candidate);

    // Exact substring checks (fast path)
    if (normalizedQuestion.includes(normalizedCandidate)) return candidate;
    const short = normalizedCandidate.split(' - ')[0];
    if (normalizedQuestion.includes(short)) return candidate;
    if (normalizedCandidate.includes(normalizedQuestion)) return candidate;

    // Title-stripped match — handles "dr. sc. Ivana Lacković, prof. struč. stud."
    // entity names where user just types "Ivana Lacković".
    // Threshold: min(strippedWords.length, 2) — for 3-part names (Ksenija Vanjorek Stojaković)
    // matching 2 of 3 words is sufficient so partial name queries still work.
    const stripped = stripTitleWords(normalizedCandidate);
    const strippedWords = stripped.split(/\s+/).filter(w => w.length >= 4);
    if (strippedWords.length >= 2) {
      const matchCount = strippedWords.filter(w => qWords.has(w)).length;
      const threshold = Math.min(strippedWords.length, 2);
      if (matchCount >= threshold) return candidate;
    }
  }

  return null;
}

function findEntityNameInQuestion(question: string, entityNames: string[]): string | null {
  const direct = findEntityNameLoosely(question, entityNames);
  if (direct) return direct;

  const normalizedQuestion = normalizeText(question);
  const sorted = [...entityNames].sort((a, b) => b.length - a.length);

  for (const candidate of sorted) {
    if (normalizedQuestion.includes(normalizeText(candidate))) {
      return candidate;
    }
  }

  return null;
}


function answerStudyLocationQuestion(question: string): string | null {
  const q = normalizeText(question);

  const isStudyQuestion =
    q.includes('studij') ||
    q.includes('studira') ||
    q.includes('studirati') ||
    q.includes('program') ||
    q.includes('upis') ||
    q.includes('upisat') ||
    q.includes('sto se moze') ||
    q.includes('što se može');

  if (!isStudyQuestion) return null;

  if (q.includes('biograd')) {
    const studies = STUDY_STRUCTURE.biograd.classicalStudies
      .map((s) => `• ${s.name} (${s.level})`)
      .join('\n');

    return `U dislociranom studijskom centru EFFECTUS veleučilišta u Biogradu na Moru izvode se sljedeći klasični studiji:\n\n${studies}\n\n${STUDY_STRUCTURE.biograd.note}`;
  }

  if (q.includes('osijek')) {
    const studies = STUDY_STRUCTURE.osijek.classicalStudies
      .map((s) => `• ${s.name} (${s.level})`)
      .join('\n');

    return `U dislociranom studijskom centru EFFECTUS veleučilišta u Osijeku izvodi se:\n\n${studies}\n\n${STUDY_STRUCTURE.osijek.note}`;
  }

  if (q.includes('zapresic') || q.includes('zaprešić')) {
    const studies = STUDY_STRUCTURE.zapresic.onlineStudies
      .map((s) => `• ${s}`)
      .join('\n');

    return `Zaprešić je sjedište EFFECTUS veleučilišta.\n\n${STUDY_STRUCTURE.zapresic.classicalNote}\n\nU Zaprešiću se organiziraju osobito online studiji:\n\n${studies}`;
  }

  return null;
}


function hardInterceptAdmissionsQuestion(question: string): string | null {
  const q = normalizeText(question);

  const asksAdmissions =
    q.includes('uvjeti upisa') ||
    q.includes('koji su uvjeti upisa') ||
    q.includes('upis') ||
    q.includes('procedura upisa') ||
    q.includes('postupak upisa') ||
    q.includes('skolarina') ||
    q.includes('školarina');

  if (!asksAdmissions) return null;

  if (q.includes('biograd')) {
    return [
      "U Biogradu na Moru klasično se izvode samo **dva stručna prijediplomska studija**:",
      "• Poslovna ekonomija i financije",
      "• Menadžment u turizmu i ugostiteljstvu",
      "",
      "Zato se za Biograd ne postavlja pitanje o diplomskom studiju, jer se ondje klasično izvode samo prijediplomski programi.",
      "",
      "Za točne uvjete upisa, potrebnu dokumentaciju, rokove i školarinu potrebno je pratiti službenu stranicu upisa EFFECTUS veleučilišta.",
      "",
      "Mogu vam pomoći i s:",
      "1️⃣ Kolika je školarina na EFFECTUS veleučilištu?",
      "2️⃣ Koliko traje studij u Biogradu na Moru?",
      "3️⃣ Kako izgleda procedura upisa?",
      "4️⃣ Kako izgleda online studiranje na Effectusu?",
      "",
      `🔹 Izvor: ${STUDY_STRUCTURE.admissions.generalSource}`,
    ].join('\n');
  }

  if (q.includes('osijek')) {
    return [
      "U Osijeku se klasično izvodi samo **jedan stručni diplomski studij**:",
      "• Projektni menadžment",
      "",
      "Osijek je također upisno mjesto za online studije EFFECTUS veleučilišta.",
      "",
      "Za točne uvjete upisa, potrebnu dokumentaciju, rokove i školarinu potrebno je pratiti službenu stranicu upisa EFFECTUS veleučilišta.",
      "",
      "Mogu vam pomoći i s:",
      "1️⃣ Kolika je školarina na EFFECTUS veleučilištu?",
      "2️⃣ Kako izgleda procedura upisa?",
      "3️⃣ Kako izgleda online studiranje na Effectusu?",
      "4️⃣ Koji studiji postoje u Osijeku?",
      "",
      `🔹 Izvor: ${STUDY_STRUCTURE.admissions.generalSource}`,
    ].join('\n');
  }

  if (q.includes('skolarina') || q.includes('školarina')) {
    return [
      "Godišnje školarine na EFFECTUS veleučilištu za ak. god. 2026./2027.:",
      "",
      "**Stručni kratki studij (online):**",
      "• Primijenjena ekonomija — **2.760,00 EUR**",
      "",
      "**Stručni prijediplomski studiji:**",
      "• Poslovanje i upravljanje (svi smjerovi) — **3.000,00 EUR**",
      "• Informacijske tehnologije — **3.300,00 EUR**",
      "• Menadžment u turizmu i ugostiteljstvu (Biograd n/M) — **3.000,00 EUR**",
      "• Socijalna i kulturna integracija — **3.000,00 EUR**",
      "",
      "**Stručni diplomski studiji:**",
      "• Primijenjene IT, Financije, Projektni menadžment,",
      "  Komunikacijski menadžment, Menadžment javnog sektora — **3.600,00 EUR**",
      "",
      "Jednokratni troškovi: prijava **100,00 EUR** + upis **100,00 EUR**.",
      "Popusti: 5% jednokratno plaćanje · 5% obiteljski · 10% za nastavak diplomskog.",
      "",
      "Mogu vam pomoći i s:",
      "1️⃣ Kako izgleda procedura upisa?",
      "2️⃣ Koji studiji postoje u Biogradu na Moru?",
      "3️⃣ Koji studiji postoje u Osijeku?",
      "4️⃣ Kako izgleda online studiranje na Effectusu?",
      "",
      `🔹 Izvor: ${STUDY_STRUCTURE.admissions.tuitionSource}`,
    ].join('\n');
  }

  // BiH / inozemstvo — return null so FAQ handler takes over with specific BiH info.
  // Include all Croatian declined forms (genitives, adjective forms etc.)
  // BiH / inozemstvo / strani — return null so FAQ handler takes over.
  // "stran" stem covers all Croatian declensions: strani, strana, strane, stranih, stranom, stranog
  // "inozemn" covers: inozemni, inozeman, inozemnog, inozemnih, inozemne, inozemnom
  const isBiHQuery =
    q.includes('bosna') || q.includes('bosne') || q.includes('bosni') ||
    q.includes('hercegovina') || q.includes('hercegovine') || q.includes('hercegovini') ||
    q.includes('bih') || q.includes('inozemstvo') || q.includes('iz inozemstva') ||
    q.includes('inozemn') ||   // inozemni, inozeman, inozemnog, inozemnih, inozemne...
    q.includes('strani') || q.includes('strane') || q.includes('stranih') ||
    q.includes('stranog') || q.includes('stranom') ||
    q.includes('strani gradanin') || q.includes('inozemni gradanin') ||
    q.includes('gradanin bosn') || q.includes('novi travnik');
  if (isBiHQuery) return null;

  if (q.includes('procedura upisa') || q.includes('postupak upisa') || q.includes('kako se upisati') ||
      q.includes('kako izgleda upis') || q.includes('kako izgleda procedura') || (q.includes('kako') && q.includes('upisati'))) {
    return [
      "**Procedura upisa — EFFECTUS veleučilište Zaprešić**",
      "",
      "**KORAK 1 — Potvrda namjere upisa**",
      "Nakon što Veleučilište potvrdi da ste ispunili uvjete, elektronički putem dobivate Obavijest o prihvaćanju te trebate potvrditi namjeru upisa.",
      "",
      "**KORAK 2 — Pristupni podaci**",
      "U roku od 2 radna dana od potvrde, SMS-om dobivate korisničko ime i lozinku za AAI sustav.",
      "Lozinku mijenjate na: https://login.aaiedu.hr/promjenazaporke *(min. 8 znakova, 2 znamenke + 2 slova)*",
      "",
      "**KORAK 3 — Pristup digitalnoj referadi**",
      "Prijavite se na https://effectus.com.hr i odaberite **UPIS STUDENATA**.",
      "",
      "**KORAK 4 — Ovjera upisne dokumentacije / Ugovor**",
      "Preuzmite i potvrdite Ugovor klikom na *Ovjeri upisnu dokumentaciju*.",
      "",
      "**KORAK 5 — Učitavanje slike**",
      "Učitajte fotografiju za e-indeks/studentsku iskaznicu putem opcije *Učitavanje dokumentacije*.",
      "",
      "**KORAK 6 — Upisni list i Izjava o suglasnosti o plaćanju**",
      "Preuzmite, popunite i potpišite odgovarajući Upisni list za svoj studij te Izjavu o suglasnosti.",
      "",
      "**KORAK 7 — Učitavanje upisne dokumentacije (PDF)**",
      "Sve dokumente učitajte u PDF formatu klikom na *Učitaj dokument* za svaki pojedini dokument.",
      "",
      "**KORAK 8 — Zaprimanje podataka za plaćanje školarine**",
      "U roku od 2 radna dana na e-mail dobivate račun s podacima za plaćanje školarine.",
      "",
      "**KORAK 9 — Potvrda o uspješnom upisu**",
      "Slanjem podataka za plaćanje Veleučilište potvrđuje uspješan upis.",
      "Krajem rujna dobivate poziv za uvodno predavanje. Akademska godina počinje **6. listopada**.",
      "",
      "📧 Sva pitanja: info@effectus.com.hr",
      "",
      `🔹 Izvor: ${STUDY_STRUCTURE.admissions.procedureSource}`,
    ].join('\n');
  }

  return null;
}

async function resolveQuestion(messages: ChatMessage[], latestQuestion: string): Promise<ResolvedQuery> {
  const isFollowUp = isFollowUpQuestion(latestQuestion);
  const preferredUrl = isFollowUp ? getLastValidAssistantSourceUrl(messages) : null;
  let contentGroup = resolveContentGroup(messages, latestQuestion);
  let requestedSectionType = detectRequestedSectionType(latestQuestion);
  const retrievalQuery = buildContextualRetrievalQuery(messages, latestQuestion);

  // When the bot asked for study-type clarification (e.g. "Zanima li vas prijediplomski
  // studij, diplomski studij...?") and the user answered with just a study type (no
  // explicit intent keywords), inherit the section type and content group from the
  // previous user message so the answer stays on topic (e.g. uvjeti upisa).
  if (!requestedSectionType && lastAssistantAskedForProgram(messages)) {
    const previousUser = getPreviousUserMessage(messages);
    if (previousUser?.content) {
      const prevSection = detectRequestedSectionType(previousUser.content);
      if (prevSection) requestedSectionType = prevSection;

      const prevGroup = classifyContentGroup(previousUser.content);
      if (prevGroup === 'upisi') contentGroup = 'upisi';
    }
  }

  const entityNames = await getKnownEntityNames(contentGroup);
  const explicitEntityName = findEntityNameInQuestion(latestQuestion, entityNames);

  let resolvedEntityName = explicitEntityName;

  if (!resolvedEntityName && lastAssistantAskedForProgram(messages)) {
    resolvedEntityName = findEntityNameLoosely(latestQuestion, entityNames);
  }

  if (!resolvedEntityName && isFollowUp) {
    const previousUser = getPreviousUserMessage(messages);
    if (previousUser?.content) {
      resolvedEntityName = findEntityNameInQuestion(previousUser.content, entityNames);
    }
  }

  if (!resolvedEntityName && isFollowUp) {
    const previousAssistantEntity = extractPreviousAssistantEntityName(messages);
    if (previousAssistantEntity) {
      const exact = entityNames.find(
        (name) => normalizeText(name) === normalizeText(previousAssistantEntity)
      );
      if (exact) resolvedEntityName = exact;
    }
  }

  return {
    contentGroup,
    requestedSectionType,
    preferredUrl,
    resolvedEntityName,
    isFollowUp,
    retrievalQuery,
  };
}

// ---------------------------------------------------------------------------
// Retrieval helpers
// ---------------------------------------------------------------------------

/**
 * The scraper stores all study program chunks under 'studijski_programi'.
 * classifyContentGroup() returns fine-grained values ('prijediplomski_studiji',
 * 'diplomski_studiji', etc.) that don't exist in the DB.
 * This normalizer maps them to the actual DB value so retrieval queries work.
 */
function normalizeContentGroupForRetrieval(cg: ContentGroup): ContentGroup {
  if (
    cg === 'prijediplomski_studiji' ||
    cg === 'diplomski_studiji' ||
    cg === 'specijalisticki_studiji' ||
    cg === 'kolegiji' ||
    cg === 'nastavnici'
  ) {
    return 'studijski_programi';
  }
  return cg;
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

async function retrieveExactEntitySectionChunks(
  entityName: string,
  sectionType: SectionType,
  contentGroup: ContentGroup
): Promise<RetrievedChunk[]> {
  const cg = normalizeContentGroupForRetrieval(contentGroup);
  const values: Array<string | number> = [getTenantId(), entityName, sectionType];
  let groupClause = '';

  if (cg !== 'opcenito') {
    values.push(cg);
    groupClause = `and content_group = $4`;
  }

  values.push(RAG_CONFIG.exactEntitySectionLimit);
  const limitParam = values.length;

  const result = await pool.query(
    `
    select
      id, document_id, tenant_id, url, title, chunk_index, content,
      0.95 as similarity, content_group, entity_type, entity_name,
      section_type, parent_entity_type, parent_entity_name
    from document_chunks
    where tenant_id = $1
      and entity_name = $2
      and section_type = $3
      ${groupClause}
    order by chunk_index asc
    limit $${limitParam}
    `,
    values
  );

  return result.rows.map((row: RetrievedChunk) => ({
    ...row,
    similarity: Number(row.similarity),
  }));
}

async function retrieveExactEntityChunks(
  entityName: string,
  requestedSectionType: SectionType | null,
  contentGroup: ContentGroup
): Promise<RetrievedChunk[]> {
  const cg = normalizeContentGroupForRetrieval(contentGroup);
  const values: Array<string | number> = [getTenantId(), entityName];
  let groupClause = '';

  if (cg !== 'opcenito') {
    values.push(cg);
    groupClause = `and content_group = $3`;
  }

  const sectionOrderSql = requestedSectionType
    ? `case when section_type = '${requestedSectionType}' then 0 else 1 end,`
    : '';

  values.push(RAG_CONFIG.exactEntityLimit);
  const limitParam = values.length;

  const result = await pool.query(
    `
    select
      id, document_id, tenant_id, url, title, chunk_index, content,
      0.85 as similarity, content_group, entity_type, entity_name,
      section_type, parent_entity_type, parent_entity_name
    from document_chunks
    where tenant_id = $1
      and entity_name = $2
      ${groupClause}
    order by ${sectionOrderSql} chunk_index asc
    limit $${limitParam}
    `,
    values
  );

  return result.rows.map((row: RetrievedChunk) => ({
    ...row,
    similarity: Number(row.similarity),
  }));
}

async function retrievePreferredUrlChunks(
  preferredUrl: string,
  contentGroup: ContentGroup
): Promise<RetrievedChunk[]> {
  const cg = normalizeContentGroupForRetrieval(contentGroup);
  const values: Array<string | number> = [getTenantId(), preferredUrl];
  let groupClause = '';

  if (cg !== 'opcenito') {
    values.push(cg);
    groupClause = `and content_group = $3`;
  }

  values.push(6);
  const limitParam = values.length;

  const result = await pool.query(
    `
    select
      id, document_id, tenant_id, url, title, chunk_index, content,
      0.60 as similarity, content_group, entity_type, entity_name,
      section_type, parent_entity_type, parent_entity_name
    from document_chunks
    where tenant_id = $1
      and url = $2
      ${groupClause}
    order by chunk_index asc
    limit $${limitParam}
    `,
    values
  );

  return result.rows.map((row: RetrievedChunk) => ({
    ...row,
    similarity: Number(row.similarity),
  }));
}

async function retrieveSemanticChunks(
  question: string,
  contentGroup: ContentGroup,
  preferredUrl: string | null,
  matchCount = RAG_CONFIG.semanticCandidatePool
): Promise<RetrievedChunk[]> {
  const queryEmbedding = await getQueryEmbedding(question);
  const vectorLiteral = toVectorLiteral(queryEmbedding);

  const cg = normalizeContentGroupForRetrieval(contentGroup);
  const params: Array<string | number> = [vectorLiteral, getTenantId(), matchCount];
  const whereClauses: string[] = [];

  if (cg !== 'opcenito') {
    params.push(cg);
    whereClauses.push(`content_group = $${params.length}`);
  }

  if (preferredUrl) {
    params.push(preferredUrl);
    whereClauses.push(`url = $${params.length}`);
  }

  const whereSql = whereClauses.length ? `where ${whereClauses.join(' and ')}` : '';

  const result = await pool.query(
    `
    select *
    from (
      select
        id, document_id, tenant_id, url, title, chunk_index, content,
        similarity, content_group, entity_type, entity_name, section_type,
        parent_entity_type, parent_entity_name
      from match_document_chunks($1::vector, $2::text, $3::int)
    ) ranked
    ${whereSql}
    `,
    params
  );

  return result.rows;
}

function extractKeywordHints(question: string): string[] {
  const q = normalizeText(question);
  const keywords = new Set<string>();

  const keywordMap: Array<{ test: RegExp; add: string[] }> = [
    { test: /\bskolarin/, add: ['školarina', 'skolarina', 'cijena'] },
    { test: /\bupis/, add: ['upisi', 'upis', 'prijava'] },
    { test: /\brok/, add: ['rok', 'rokovi', 'termini'] },
    { test: /\bprijav/, add: ['prijava', 'prijave'] },
    { test: /\bonline\b/, add: ['online', 'online studiranje'] },
    { test: /\bstudij/, add: ['studij', 'studija', 'studiranje'] },
    { test: /\bcijen/, add: ['cijena', 'cijene', 'eur'] },
    { test: /\biznos/, add: ['iznos', 'iznosi', 'eur'] },
    { test: /\bpopust/, add: ['popust', 'pogodnosti'] },
    { test: /\bcjelozivot/, add: ['cjeloživotno', 'cjelozivotno', 'obrazovanje'] },
    { test: /\btecaj/, add: ['tečaj', 'tecaj'] },
    { test: /\bturistick/, add: ['turistički', 'turisticki'] },
    { test: /\bvodic/, add: ['vodič', 'vodic'] },
    { test: /\btraj/, add: ['trajanje', 'traje', 'školskih sati', 'skolskih sati'] },
    { test: /\buvjet/, add: ['uvjeti', 'uvjet', 'preduvjeti'] },
    { test: /\bkontakt/, add: ['kontakt', 'telefon', 'email'] },
    { test: /\btermin/, add: ['termin', 'termini', 'početak', 'pocetak'] },
    { test: /\bpredmet/, add: ['predmet', 'predmeti', 'sadržaj', 'sadrzaj'] },
    { test: /\bishod/, add: ['ishodi', 'ishodi učenja', 'ishodi ucenja'] },
    { test: /\bects\b/, add: ['ects'] },
    { test: /\bnositelj|\bizvodi|\bpredavac|\bpredavač/, add: ['nositelj', 'izvodi'] },
    { test: /\bkolegij/, add: ['kolegij', 'kolegiji', 'semestar'] },
    // Ordinal semester numbers → numeric form used in scraped content ("1. semestar:")
    { test: /\bprvom\s+semestru|\bprvi\s+semestar|\b1\.\s*semestar/, add: ['1. semestar'] },
    { test: /\bdrugom\s+semestru|\bdruga\s+semestar|\b2\.\s*semestar/, add: ['2. semestar'] },
    { test: /\btrec[eé]m\s+semestru|\btrec[eé]\s+semestar|\b3\.\s*semestar/, add: ['3. semestar'] },
    { test: /\bcetvrto[mg]\s+semestru|\bcetvrt[oi]\s+semestar|\b4\.\s*semestar/, add: ['4. semestar'] },
    { test: /\bpeto[mg]\s+semestru|\bpet[oi]\s+semestar|\b5\.\s*semestar/, add: ['5. semestar'] },
    { test: /\bsesto[mg]\s+semestru|\bsest[oi]\s+semestar|\b6\.\s*semestar/, add: ['6. semestar'] },
    { test: /\bsemestar\b/, add: ['semestar'] },
  ];

  for (const rule of keywordMap) {
    if (rule.test.test(q)) {
      for (const word of rule.add) keywords.add(word);
    }
  }

  return Array.from(keywords);
}

async function retrieveKeywordChunks(
  question: string,
  contentGroup: ContentGroup,
  preferredUrl: string | null,
  limit = RAG_CONFIG.maxKeywordChunks
): Promise<RetrievedChunk[]> {
  const keywords = extractKeywordHints(question);
  if (!keywords.length) return [];

  const conditions: string[] = [];
  const values: Array<string | number> = [getTenantId()];
  let paramIndex = 2;

  for (const keyword of keywords) {
    conditions.push(
      `(content ilike $${paramIndex} or coalesce(entity_name,'') ilike $${paramIndex} or coalesce(section_type,'') ilike $${paramIndex})`
    );
    values.push(`%${keyword}%`);
    paramIndex++;
  }

  const cgKw = normalizeContentGroupForRetrieval(contentGroup);
  let groupClause = '';
  if (cgKw !== 'opcenito') {
    groupClause = `and content_group = $${paramIndex}`;
    values.push(cgKw);
    paramIndex++;
  }

  let urlClause = '';
  if (preferredUrl) {
    urlClause = `and url = $${paramIndex}`;
    values.push(preferredUrl);
    paramIndex++;
  }

  values.push(limit);

  const result = await pool.query(
    `
    select
      id, document_id, tenant_id, url, title, chunk_index, content,
      0.29 as similarity, content_group, entity_type, entity_name,
      section_type, parent_entity_type, parent_entity_name
    from document_chunks
    where tenant_id = $1
      ${groupClause}
      ${urlClause}
      and (${conditions.join(' or ')})
    order by document_id asc, chunk_index asc
    limit $${paramIndex}
    `,
    values
  );

  return result.rows.map((row: RetrievedChunk) => ({
    ...row,
    similarity: Number(row.similarity),
  }));
}

/**
 * Query ALL study-program chunks that mention a specific teacher.
 * Accepts an array of name tokens (first + last name) and requires ALL of them
 * to appear in the content — this prevents surname collisions where two teachers
 * share the same family name (e.g. "Ivan Ružić" vs "Drago Ružić").
 * Falls back to surname-only if only one token is provided.
 * Returns chunks sorted by program (entity_name).
 */
async function retrieveStudyProgramChunksForTeacher(
  tokens: string | string[],
  limit = 20
): Promise<RetrievedChunk[]> {
  const tokenArr = (Array.isArray(tokens) ? tokens : [tokens]).filter(t => t && t.length >= 3);
  if (tokenArr.length === 0) return [];
  // Build one ILIKE condition per token — all must match (AND)
  const conditions = tokenArr.map((_, i) => `content ILIKE $${i + 2}`).join(' AND ');
  const params: (string | number)[] = [
    getTenantId(),
    ...tokenArr.map(t => `%${t}%`),
    limit,
  ];
  const result = await pool.query(
    `SELECT id, document_id, tenant_id, url, title, chunk_index, content,
       0.8 AS similarity, content_group, entity_type, entity_name,
       section_type, parent_entity_type, parent_entity_name
     FROM document_chunks
     WHERE tenant_id = $1
       AND content_group = 'studijski_programi'
       AND ${conditions}
     ORDER BY entity_name ASC, chunk_index ASC
     LIMIT $${tokenArr.length + 2}`,
    params
  );
  return result.rows.map((row: RetrievedChunk) => ({
    ...row,
    similarity: Number(row.similarity),
  }));
}

/**
 * DB-based teacher lookup for teachers NOT in the static TEACHER_PROFILES list.
 *
 * Strategy:
 *  1. Extract the teacher's surname from the user query.
 *  2. Search nastavnici-suradnici page URLs for that surname (ASCII slug — no diacritics
 *     needed, works even when the user omits ć/š/ž etc.).
 *  3. Use the entity_name returned from step 2 (which has proper Croatian diacritics) to
 *     search predmeti chunk content for courses that mention this teacher.
 *
 * Returns a formatted answer (profile + courses) or null if no teacher found.
 */
async function findTeacherByNameFromDB(nameInput: string): Promise<string | null> {
  // Strip punctuation to avoid '?' or '.' contaminating the last token
  const cleanInput = nameInput.replace(/[.,!?;:'"()]/g, ' ').replace(/\s+/g, ' ').trim();
  const rawSurname = teacherSurnameToken(cleanInput);
  if (!rawSurname || rawSurname.length < 3) return null;

  // Normalize to ASCII for URL slug search (effectus.com.hr URLs are always ASCII)
  const normSurname = normalizeText(rawSurname);
  if (normSurname.length < 3) return null;

  // 1. Find the teacher's profile page from nastavnici-suradnici URLs
  const profileResult = await pool.query(
    `SELECT DISTINCT entity_name, url
     FROM document_chunks
     WHERE tenant_id = $1
       AND url ILIKE $2
       AND entity_name IS NOT NULL
     ORDER BY url
     LIMIT 3`,
    [getTenantId(), `%nastavnici-suradnici%${normSurname}%`]
  );
  if (profileResult.rows.length === 0) return null;

  const profileRow = profileResult.rows[0];
  const teacherFullName: string = profileRow.entity_name;
  const profileUrl: string = profileRow.url;

  // 2. Derive the surname WITH diacritics from the DB entity_name for accurate content search
  const dbSurname = teacherSurnameToken(teacherFullName);

  // 3. Find courses from /predmeti/ chunks whose content mentions this teacher's surname
  const coursesResult = await pool.query(
    `SELECT DISTINCT entity_name, url
     FROM document_chunks
     WHERE tenant_id = $1
       AND url ILIKE '%/predmeti/%'
       AND content ILIKE $2
       AND entity_name IS NOT NULL
     ORDER BY entity_name
     LIMIT 30`,
    [getTenantId(), `%${dbSurname}%`]
  );

  const courses = coursesResult.rows.map((r: { entity_name: string; url: string }) => ({
    name: r.entity_name as string,
    url: r.url as string,
  }));

  // Fetch real photo from effectus.com.hr WordPress API (process-level cached)
  const photo = await fetchTeacherPhotoUrl(profileUrl);

  const nameLine = photo
    ? `👤 **${teacherFullName}** [PHOTO:${photo}]`
    : `👤 **${teacherFullName}**`;
  const lines: string[] = [nameLine];
  lines.push(`🔗 Profil: ${profileUrl}`);

  if (courses.length > 0) {
    lines.push('');
    lines.push('Predaje sljedeće kolegije:');
    courses.forEach(c => lines.push(`• ${c.name}`));
  }

  // Also enrich with study programs (reuses the same logic as applyTeacherProfileEnrichment)
  // Pass ALL name tokens (first + last) to avoid false matches when two teachers share a surname
  const programChunks = await retrieveStudyProgramChunksForTeacher(teacherNameTokens(teacherFullName), 20);
  const isCleanProgramName = (name: string) =>
    !/(izvedbeni|plan nastave|nastavni plan|\d{4}\.\s*[-–]\s*\d{4})/i.test(name) &&
    name.length < 80;
  const programNames = Array.from(new Set(
    programChunks
      .filter(c => c.url?.includes('/studijski-programi/'))
      .map(c => c.entity_name?.trim())
      .filter((n): n is string => Boolean(n) && isCleanProgramName(n as string))
  ));
  if (programNames.length > 0) {
    const studijLabel = programNames.length === 1 ? 'studiju' : 'studijima';
    lines.push('');
    lines.push(`**Predaje na ${studijLabel}:** ${programNames.join(', ')}`);
  }

  lines.push('');
  lines.push('Mogu vam pomoći i s:');
  lines.push('1. Koji studiji postoje na Effectusu?');
  lines.push('2. Koji su nastavnici na studiju Informacijske tehnologije?');
  lines.push('3. Tko je dekan EFFECTUS veleučilišta?');
  lines.push('');
  lines.push(`🔹 Izvor: ${profileUrl}`);

  return lines.join('\n');
}

function filterRelevantChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  return chunks.filter(
    (chunk) =>
      typeof chunk.similarity === 'number' &&
      !Number.isNaN(chunk.similarity) &&
      chunk.similarity >= RAG_CONFIG.minSimilarity &&
      chunk.content?.trim() &&
      !/suglasnost s ovim tehnologijama/i.test(chunk.content) &&
      !/tehnicko skladistenje ili pristup/i.test(normalizeText(chunk.content)) &&
      !/pravila privatnosti/i.test(normalizeText(chunk.content))
  );
}

function getSectionPriority(chunk: RetrievedChunk, requestedSectionType: SectionType | null): number {
  if (requestedSectionType && chunk.section_type === requestedSectionType) return 3;

  const section = chunk.section_type ?? '';
  if (
    section === 'cijena' ||
    section === 'trajanje' ||
    section === 'uvjeti' ||
    section === 'kontakt' ||
    section === 'termini' ||
    section === 'sadrzaj' ||
    section === 'ishodi' ||
    section === 'izvedba' ||
    section === 'nositelj' ||
    section === 'ects'
  ) return 2;

  if (section === 'opis') return 1;
  return 0;
}

function getUrlPriority(
  chunk: RetrievedChunk,
  contentGroup: ContentGroup,
  requestedSectionType: SectionType | null
): number {
  const url = (chunk.url || '').toLowerCase();
  if (!url) return 0;

  if (contentGroup === 'upisi') {
    if (requestedSectionType === 'cijena') {
      if (url.includes('/upisi/skolarina-i-pogodnosti/')) return 6;
      if (url.includes('/upisi/procedura-upisa/')) return 4;
      if (url.includes('/upisi/postupak-i-termini-upisa/')) return 3;
      if (url.includes('/upisi/o-upisu-na-effectusu/')) return 2;
      if (url.includes('/upisi/cesta-pitanja/')) return 1;
    }

    if (requestedSectionType === 'termini') {
      if (url.includes('/upisi/postupak-i-termini-upisa/')) return 6;
      if (url.includes('/upisi/procedura-upisa/')) return 4;
      if (url.includes('/upisi/o-upisu-na-effectusu/')) return 2;
      if (url.includes('/upisi/cesta-pitanja/')) return 1;
    }

    if (requestedSectionType === 'uvjeti' || requestedSectionType === 'upis') {
      // cesta-pitanja is the FAQ page with ACTUAL admission conditions — highest priority
      if (url.includes('/upisi/cesta-pitanja/')) return 8;
      if (url.includes('/upisi/procedura-upisa/')) return 5;
      if (url.includes('/upisi/o-upisu-na-effectusu/')) return 4;
      if (url.includes('/upisi/postupak-i-termini-upisa/')) return 3;
    }

    if (url.includes('/upisi/procedura-upisa/')) return 5;
    if (url.includes('/upisi/postupak-i-termini-upisa/')) return 4;
    if (url.includes('/upisi/skolarina-i-pogodnosti/')) return 4;
    if (url.includes('/upisi/o-upisu-na-effectusu/')) return 3;
    if (url.includes('/upisi/cesta-pitanja/')) return 1;
  }

  if (contentGroup === 'cjelozivotno_obrazovanje') {
    if (chunk.entity_name && normalizeText(url).includes(normalizeText(chunk.entity_name).replace(/\s+/g, '-'))) {
      return 5;
    }
    if (url.includes('/cjelozivotno-obrazovanje/')) return 3;
  }

  if (contentGroup === 'online_studiranje') {
    if (url.includes('/online-studiranje/o-online-studiranju/')) return 5;
    if (url.includes('/online-studiranje/')) return 3;
  }

  return 0;
}


async function retrieveChunksByExactUrls(
  urls: string[],
  limitPerUrl = 4
): Promise<RetrievedChunk[]> {
  const normalizedUrls = [...new Set(urls.map((u) => u.toLowerCase()))];
  if (!normalizedUrls.length) return [];

  const query = `
    WITH ranked AS (
      SELECT
        id,
        document_id,
        title,
        url,
        content,
        content_group,
        entity_type,
        entity_name,
        section_type,
        chunk_index,
        ROW_NUMBER() OVER (PARTITION BY LOWER(url) ORDER BY chunk_index ASC) AS rn
      FROM document_chunks
      WHERE tenant_id = $1
        AND LOWER(url) = ANY($2::text[])
    )
    SELECT
      id,
      document_id,
      title,
      url,
      content,
      content_group,
      entity_type,
      entity_name,
      section_type,
      chunk_index
    FROM ranked
    WHERE rn <= $3
    ORDER BY array_position($2::text[], LOWER(url)), chunk_index ASC
  `;

  const { rows } = await pool.query(query, [
    getTenantId(),
    normalizedUrls,
    limitPerUrl,
  ]);

  return rows.map((row: any, index: number) => ({
    id: row.id,
    document_id: row.document_id,
    title: row.title,
    url: row.url,
    content: row.content,
    content_group: row.content_group,
    entity_type: row.entity_type,
    entity_name: row.entity_name,
    section_type: row.section_type,
    chunk_index: row.chunk_index,
    similarity: 1 - index * 0.0001,
    tenant_id: row.tenant_id ?? null,
    parent_entity_type: row.parent_entity_type ?? null,
    parent_entity_name: row.parent_entity_name ?? null,
  }));
}


function detectStudyLocation(question: string): string | null {
  const q = normalizeText(question);

  if (/biograd/.test(q)) return 'biograd';
  if (/osijek/.test(q)) return 'osijek';
  if (/zapresic|zaprešić/.test(q)) return 'zapresic';

  return null;
}

async function retrieveStudyUrlsByLocation(location: string): Promise<string[]> {
  const baseWhere = `
    tenant_id = $1
    AND (
      content_group IN ('studijski_programi', 'study_programs')
      OR entity_type IN ('studij', 'study_program')
    )
    AND LOWER(url) LIKE '%/studijski-programi/%'
    AND NOT LOWER(url) IN (
      'https://effectus.com.hr/studijski-programi',
      'https://effectus.com.hr/hr/studijski-programi',
      'https://effectus.com.hr/en/studijski-programi'
    )
  `;

  let query = '';
  let values: Array<string> = [getTenantId()];

  if (location === 'biograd') {
    query = `
      SELECT DISTINCT url
      FROM document_chunks
      WHERE ${baseWhere}
        AND (
          LOWER(url) LIKE '%biograd%'
          OR LOWER(title) LIKE '%biograd%'
          OR LOWER(entity_name) LIKE '%biograd%'
        )
      ORDER BY url
    `;
  } else if (location === 'osijek') {
    query = `
      SELECT DISTINCT url
      FROM document_chunks
      WHERE ${baseWhere}
        AND (
          LOWER(url) LIKE '%osijek%'
          OR LOWER(title) LIKE '%osijek%'
          OR LOWER(entity_name) LIKE '%osijek%'
        )
      ORDER BY url
    `;
  } else if (location === 'zapresic') {
    query = `
      SELECT DISTINCT url
      FROM document_chunks
      WHERE ${baseWhere}
        AND LOWER(url) NOT LIKE '%biograd%'
        AND LOWER(url) NOT LIKE '%osijek%'
        AND LOWER(title) NOT LIKE '%biograd%'
        AND LOWER(title) NOT LIKE '%osijek%'
        AND LOWER(entity_name) NOT LIKE '%biograd%'
        AND LOWER(entity_name) NOT LIKE '%osijek%'
      ORDER BY url
    `;
  } else {
    return [];
  }

  const { rows } = await pool.query(query, values);
  return rows.map((row: any) => row.url).filter(Boolean);
}

function mergeChunks(
  exactEntitySectionChunks: RetrievedChunk[],
  exactEntityChunks: RetrievedChunk[],
  preferredUrlChunks: RetrievedChunk[],
  semanticChunks: RetrievedChunk[],
  keywordChunks: RetrievedChunk[],
  requestedSectionType: SectionType | null,
  contentGroup: ContentGroup
): RetrievedChunk[] {
  // exactEntityChunks i exactEntitySectionChunks moraju UVIJEK biti u finalnom setu —
  // daj im visoki similarity kako ne bi bili izbačeni sortiranjem
  const boostedExact = [
    ...exactEntitySectionChunks.map((c) => ({ ...c, similarity: Math.max(c.similarity, 0.92) })),
    ...exactEntityChunks.map((c) => ({ ...c, similarity: Math.max(c.similarity, 0.88) })),
  ];

  const merged = dedupeChunks([
    ...boostedExact,
    ...preferredUrlChunks,
    ...semanticChunks,
    ...keywordChunks,
  ]);

  const hasStudyProgramCandidates = merged.some((chunk) => {
    const url = (chunk.url || '').toLowerCase();
    const entityType = normalizeText(chunk.entity_type || '');
    const chunkContentGroup = normalizeText(chunk.content_group || '');

    return (
      url.includes('/studijski-programi/') &&
      (
        entityType === 'studij' ||
        entityType === 'study_program' ||
        chunkContentGroup === 'studijski_programi' ||
        chunkContentGroup === 'study_programs'
      )
    );
  });

  const shouldPreferStudyPrograms =
    contentGroup === 'studijski_programi' || hasStudyProgramCandidates;

  const filtered = shouldPreferStudyPrograms
    ? merged.filter((chunk) => {
        const url = (chunk.url || '').toLowerCase();
        const title = normalizeText(chunk.title || '');
        const entityType = normalizeText(chunk.entity_type || '');
        const chunkContentGroup = normalizeText(chunk.content_group || '');

        const isStudyProgramUrl = url.includes('/studijski-programi/');
        const isStudyProgramIndex = /\/studijski-programi\/?$/.test(url);

        const isNewsLike =
          url.includes('/novosti') ||
          url.includes('/vijesti') ||
          url.includes('/obavijesti') ||
          url.includes('/blog/') ||
          /\?p=\d+/.test(url) ||
          /održano|odrzano|uvodno predavanje|predavanje|natječaj|natjecaj|konferencij|gostujuće predavanje|gostujuce predavanje|diplomski rad|završni i diplomski radovi|zavrsni i diplomski radovi/.test(title);

        const hasStudySignals =
          entityType === 'studij' ||
          entityType === 'study_program' ||
          chunkContentGroup === 'studijski_programi' ||
          chunkContentGroup === 'study_programs';

        return isStudyProgramUrl && !isStudyProgramIndex && hasStudySignals && !isNewsLike;
      })
    : merged;

  const getStudyPriority = (chunk: RetrievedChunk): number => {
    const url = (chunk.url || '').toLowerCase();
    const title = normalizeText(chunk.title || '');
    const entityType = normalizeText(chunk.entity_type || '');
    const chunkContentGroup = normalizeText(chunk.content_group || '');
    const entityName = normalizeText(chunk.entity_name || '');
    const content = normalizeText(chunk.content || '');

    let score = 0;

    if (url.includes('/studijski-programi/')) score += 100;
    if (entityType === 'studij' || entityType === 'study_program') score += 40;
    if (chunkContentGroup === 'studijski_programi' || chunkContentGroup === 'study_programs') score += 30;

    if (
      /biograd/.test(url) ||
      /biograd/.test(title) ||
      /biograd/.test(entityName) ||
      /biograd/.test(content)
    ) {
      score += 50;
    }

    if (/turizmu i ugostiteljstvu|turizmu-i-ugostiteljstvu/.test(title + ' ' + entityName + ' ' + url + ' ' + content)) {
      score += 20;
    }

    if (/poslovna ekonomija i financije/.test(title + ' ' + entityName + ' ' + url + ' ' + content)) {
      score += 15;
    }

    return score;
  };

  const sorted = filtered
    .sort((a, b) => {
      if (shouldPreferStudyPrograms) {
        const studyDiff = getStudyPriority(b) - getStudyPriority(a);
        if (studyDiff !== 0) return studyDiff;
      }

      const sectionDiff =
        getSectionPriority(b, requestedSectionType) -
        getSectionPriority(a, requestedSectionType);
      if (sectionDiff !== 0) return sectionDiff;

      const urlDiff =
        getUrlPriority(b, contentGroup, requestedSectionType) -
        getUrlPriority(a, contentGroup, requestedSectionType);
      if (urlDiff !== 0) return urlDiff;

      return b.similarity - a.similarity;
    })
    .slice(0, RAG_CONFIG.maxFinalChunks);

  // Garantiraj da exactEntityChunks uvijek budu u finalnom setu
  // (mogu biti izbačeni zbog section priority sortiranja)
  if (exactEntityChunks.length > 0) {
    const missingExact = exactEntityChunks.filter((c) => !sorted.some((s) => s.id === c.id));
    if (missingExact.length > 0) {
      const combined = [...missingExact, ...sorted];
      return dedupeChunks(combined).slice(0, RAG_CONFIG.maxFinalChunks);
    }
  }

  return sorted;
}

function isStrictEntitySection(sectionType: SectionType | null): boolean {
  return (
    sectionType === 'cijena' ||
    sectionType === 'trajanje' ||
    sectionType === 'uvjeti' ||
    sectionType === 'kontakt' ||
    sectionType === 'termini' ||
    sectionType === 'sadrzaj' ||
    sectionType === 'ishodi' ||
    sectionType === 'izvedba' ||
    sectionType === 'nositelj' ||
    sectionType === 'ects'
  );
}

function lockChunksToResolvedEntity(
  chunks: RetrievedChunk[],
  resolvedEntityName: string | null,
  preferredUrl: string | null
): RetrievedChunk[] {
  if (!resolvedEntityName) return chunks;

  const sameEntity = chunks.filter((c) => c.entity_name === resolvedEntityName);
  if (sameEntity.length) return sameEntity;

  if (preferredUrl) {
    const sameUrl = chunks.filter((c) => c.url === preferredUrl);
    if (sameUrl.length) return sameUrl;
  }

  return [];
}

// ---------------------------------------------------------------------------
// Fact-first
// ---------------------------------------------------------------------------

function findDominantEntityName(chunks: RetrievedChunk[]): string | null {
  const counter = new Map<string, number>();
  for (const chunk of chunks) {
    const name = chunk.entity_name?.trim();
    if (!name) continue;
    counter.set(name, (counter.get(name) ?? 0) + 1);
  }
  const sorted = Array.from(counter.entries()).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? null;
}

function filterByResolvedEntity(
  chunks: RetrievedChunk[],
  preferredUrl: string | null,
  resolvedEntityName: string | null
): RetrievedChunk[] {
  const byUrl = preferredUrl ? chunks.filter((c) => c.url === preferredUrl) : [];
  const base = byUrl.length ? byUrl : chunks;

  if (resolvedEntityName) {
    const sameResolvedEntity = base.filter((c) => c.entity_name === resolvedEntityName);
    if (sameResolvedEntity.length) return sameResolvedEntity;
  }

  const dominantEntity = findDominantEntityName(base);
  if (!dominantEntity) return base;

  const sameEntity = base.filter((c) => c.entity_name === dominantEntity);
  return sameEntity.length ? sameEntity : base;
}

const SECTION_FALLBACK_PATTERNS: Partial<Record<SectionType, RegExp>> = {
  sadrzaj: /predmet|predmeti|sadrzaj programa|sadržaj programa|moduli|školskih sati|skolskih sati/i,
  termini: /početak|pocetak|termin|rok|veljača|veljaca|siječanj|sijecanj|listopad|studeni|prosinac/i,
  kontakt: /@|kontaktirajte|telefon|mob|tel/i,
  cijena: /€|eur|pdv|cijena|iznosi|popust|jednokratno placanje|jednokratno plaćanje|u cijenu je ukljuceno|u cijenu je uključeno/i,
  trajanje: /u trajanju|trajanje|školskih sati|skolskih sati|godina studija/i,
  uvjeti: /uvjeti|najmanje završena|najmanje zavrsena|državljanstvo|drzavljanstvo|poslovna sposobnost/i,
  ishodi: /ishodi ucenja|ishodi učenja|student ce moci|student će moći/i,
  izvedba: /izvedba|nacin izvedbe|način izvedbe|oblik nastave/i,
  nositelj: /nositelj|izvodi|predavac|predavač|nastavnik/i,
  ects: /\bects\b/i,
};

function pickSectionChunks(
  chunks: RetrievedChunk[],
  sectionType: SectionType,
  preferredUrl: string | null,
  resolvedEntityName: string | null
): RetrievedChunk[] {
  const base = filterByResolvedEntity(chunks, preferredUrl, resolvedEntityName);

  const exact = base.filter((c) => c.section_type === sectionType);
  if (exact.length) return exact;

  if (sectionType === 'opis') {
    const fallbackOpis = base.filter((c) => c.section_type === 'opis');
    if (fallbackOpis.length) return fallbackOpis;
  } else {
    const pattern = SECTION_FALLBACK_PATTERNS[sectionType];
    if (pattern) {
      const fallback = base.filter((c) => pattern.test(c.content));
      if (fallback.length) return fallback;
    }
  }

  return base;
}

/**
 * Split a dense single-line string that has multiple "Subject – Name, title" entries
 * concatenated without newlines, e.g. "SubjectA – NameASubjectB – NameB...".
 * Splits at boundaries where lowercase/punct is followed by uppercase+lowercase.
 */
/**
 * Insert spaces at CamelCase-without-space boundaries in the teacher/name portion
 * of an entry (i.e. the part after " – ").
 * "dr. sc. NinoslavGregurić-Bajza" → "dr. sc. Ninoslav Gregurić-Bajza"
 * Already-spaced names are untouched.
 */
function fixConcatenatedTeacherName(entry: string): string {
  const emDashIdx = entry.indexOf(' – ');
  if (emDashIdx < 0) return entry;
  const subject = entry.slice(0, emDashIdx);
  const teacher = entry.slice(emDashIdx + 3);
  // Insert a space wherever a lowercase char is directly followed by an uppercase char
  // (no space between them) — handles "NinoslavGregurić" → "Ninoslav Gregurić"
  const fixedTeacher = teacher.replace(
    /(?<=[a-zšđčćžàáâãäåèéêëìíîïòóôõöùúûü])(?=[A-ZŠĐŽČĆ][a-zšđčćž])/g,
    ' '
  );
  return `${subject} – ${fixedTeacher}`;
}

function splitDenseTeacherLine(line: string): string[] {
  if (line.length < 80) return [line];

  // Step 1 – split at zero-width boundaries where entries are concatenated without space.
  // E.g. "BajzaGospodarski" splits; "Ninoslav Gregurić" does NOT (space prevents match).
  const raw = line.split(
    /(?<=[a-zšđčćžàáâãäåèéêëìíîïòóôõöùúûü.,)\]]{2,})(?=[A-ZŠĐŽČĆ][a-zšđčćž])/g
  );

  // Step 2 – merge surname fragments back into the preceding entry.
  // A fragment is a "surname-only" piece: either it has no em-dash at all,
  // or the text before its first em-dash has no spaces (= a bare word, not a subject phrase).
  const merged: string[] = [];
  for (const part of raw) {
    const p = part.trim();
    if (!p || p.length < 2) continue;
    const dashIdx = p.indexOf(' – ');
    const hasDash = dashIdx >= 0;
    const prefixBeforeDash = hasDash ? p.slice(0, dashIdx) : '';
    // It's a surname fragment if: no em-dash, OR the prefix before the dash is a single word
    const isSurnameFragment = !hasDash || !prefixBeforeDash.includes(' ');
    if (merged.length > 0 && isSurnameFragment) {
      // Append back to restore the full name (e.g. "Ninoslav" + "Gregurić-Bajza")
      merged[merged.length - 1] += p;
    } else {
      merged.push(p);
    }
  }

  return merged.filter(p => p.length > 2);
}

/**
 * Extract the "Predavači" (teachers/lecturers) section from a dense cjeloživotno chunk.
 * Returns list of "Subject – Name, title" entries.
 */
function extractPredavaciFromChunk(content: string): string[] {
  // Find start of lecturer section
  const markerIdx = content.search(/Predavač[i]?[\s\S]{0,200}?(?=\w+ –|\w+ -)/i);
  if (markerIdx === -1) return [];

  // Get text from "Predavači" marker to end (or until Cijena / Termini / etc.)
  const slice = content.slice(markerIdx);
  const endIdx = slice.search(/\bCijen[ae]\b|\bTermini\b|\bPrijavi se\b|\bKontakt\b/i);
  const rawSection = endIdx > 0 ? slice.slice(0, endIdx) : slice;

  // Strip the leading "Predavači" / "Predavač:" label so it doesn't pollute the first entry
  const teacherSection = rawSection.replace(/^Predavač[i]?\s*:?\s*/i, '');

  // Split by newline first, then handle dense single-line blobs
  const rawLines = teacherSection.split('\n').map(l => l.trim()).filter(Boolean);
  const allParts: string[] = [];
  for (const line of rawLines) {
    if (line.includes(' – ') || line.includes(' - ')) {
      const parts = splitDenseTeacherLine(line);
      allParts.push(...parts);
    }
  }

  // Keep only genuine teacher entries (must contain em-dash), fix concatenated names
  return allParts
    .filter(p => (p.includes(' – ') || p.includes(' - ')) && p.length > 8)
    .map(fixConcatenatedTeacherName)   // "NinoslavGregurić-Bajza" → "Ninoslav Gregurić-Bajza"
    .slice(0, 30);
}

function formatBulletListFromChunk(chunk: RetrievedChunk, intro: string): string | null {
  const rawContent = chunk.content;

  // Special case: "nositelj" on cjeloživotno / seminar content with "Predavači" section
  if (
    intro.toLowerCase().includes('nositelj') &&
    (rawContent.includes('Predavači') || rawContent.includes('predavači'))
  ) {
    const teachers = extractPredavaciFromChunk(rawContent);
    if (teachers.length > 0) {
      const entityLabel = chunk.entity_name ? `**${chunk.entity_name}**` : 'ovaj program';
      const formatted = teachers.map(t => `• ${t}`).join('\n');
      return `**Predavači na programu ${entityLabel}:**\n\n${formatted}\n\n🔹 Izvor: ${chunk.url}`;
    }
  }

  const lines = rawContent
    .split(/\n+/)
    .flatMap(l => {
      const clean = cleanInline(l);
      // Expand dense lines (long single lines with multiple " – " separators)
      if (clean.length > 150 && clean.includes(' – ')) {
        return splitDenseTeacherLine(clean);
      }
      return [clean];
    })
    .filter(Boolean);

  const filtered = lines.filter((line) => {
    const n = normalizeText(line);
    if (!n || line.length < 3) return false;
    if (chunk.entity_name && normalizeText(chunk.entity_name) === n) return false;
    return true;
  });

  const unique = Array.from(new Set(filtered));
  if (!unique.length) return null;

  const formatted = unique.map((line) => `• ${line}`).join('\n');
  // Use cleaner intro prefix
  const cleanIntro = intro
    .replace(/Nositelj ili izvođač koji je naveden u izvoru je:/i, 'Nastavnici i suradnici:')
    .replace(/koji su navedeni u izvoru su:/gi, '')
    .replace(/koji je naveden u izvoru je:/gi, '')
    .trim();
  return `${cleanIntro}\n${formatted}\n\n🔹 Izvor: ${chunk.url}`;
}

function extractFactFirstAnswer(
  question: string,
  chunks: RetrievedChunk[],
  resolved: ResolvedQuery
): string | null {
  const intent = detectFactIntent(question);
  if (!intent) return null;

  const base = filterByResolvedEntity(
    chunks,
    resolved.preferredUrl,
    resolved.resolvedEntityName
  );

  if (intent === 'trajanje') {
    const sectionPool = pickSectionChunks(base, 'trajanje', resolved.preferredUrl, resolved.resolvedEntityName);
    const durationPatterns = [
      /Seminar je u trajanju od[^.]+[.]/i,
      /Program je u trajanju od[^.]+[.]/i,
      /Pripreme su u trajanju od[^.]+[.]/i,
      /u trajanju od[^.]+[.]/i,
      /\b\d+\s+godin\w+/i,
    ];

    for (const chunk of sectionPool) {
      const text = cleanInline(chunk.content);
      for (const pattern of durationPatterns) {
        const match = text.match(pattern);
        if (match) return `${match[0].trim()}\n\nIzvor: ${chunk.url}`;
      }
    }
    return STRICT_FALLBACK;
  }

  if (intent === 'uvjeti') {
    // When no specific program entity is resolved (general "uvjeti upisa" question),
    // context has already been restricted to /upisi/cesta-pitanja FAQ chunks
    // by the POST handler. Return null so the LLM formats the FAQ content correctly
    // (fact-first formatBulletListFromChunk doesn't handle prose FAQ text well).
    // preferredUrl guard removed — previous answer URL may be navigation sidebar
    if (!resolved.resolvedEntityName) {
      const hasFaqContent = chunks.some(c => c.url?.includes('/upisi/cesta-pitanja'));
      if (hasFaqContent) return null;
    }

    const sectionPool = pickSectionChunks(base, 'uvjeti', resolved.preferredUrl, resolved.resolvedEntityName);
    for (const chunk of sectionPool) {
      const maybe = formatBulletListFromChunk(chunk, 'Uvjeti koji su navedeni u izvoru su:');
      if (maybe) return maybe;
    }
    return STRICT_FALLBACK;
  }

  if (intent === 'cijena') {
    const exactPriceChunks = base.filter(
      (c) =>
        c.section_type === 'cijena' ||
        /€|eur|pdv|cijena|iznosi|popust|jednokratno plaćanje|jednokratno placanje|u cijenu je uključeno|u cijenu je ukljuceno/i.test(c.content)
    );

    for (const chunk of exactPriceChunks) {
      const sentences = splitIntoSentences(chunk.content);
      const matches = sentences.filter((s) =>
        /€|eur|pdv|cijena|iznosi|popust|jednokratno plaćanje|jednokratno placanje|u cijenu je uključeno|u cijenu je ukljuceno/i.test(s)
      );

      if (matches.length) return `${matches.join(' ')}\n\nIzvor: ${chunk.url}`;

      const maybe = formatBulletListFromChunk(chunk, 'Cijena i pogodnosti koje su navedene u izvoru su:');
      if (maybe) return maybe;
    }
    return STRICT_FALLBACK;
  }

  if (intent === 'kontakt') {
    const sectionPool = pickSectionChunks(base, 'kontakt', resolved.preferredUrl, resolved.resolvedEntityName);
    for (const chunk of sectionPool) {
      const text = cleanInline(chunk.content);
      const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      const phoneMatch = text.match(/(?:\+?\d[\d\s/.-]{5,}\d)/);

      if (emailMatch || phoneMatch) {
        const parts: string[] = [];
        if (emailMatch) parts.push(`E-mail: ${emailMatch[0]}`);
        if (phoneMatch) parts.push(`Telefon: ${phoneMatch[0].trim()}`);
        return `${parts.join('\n')}\n\nIzvor: ${chunk.url}`;
      }

      const maybe = formatBulletListFromChunk(chunk, 'Kontakt podaci koji su navedeni u izvoru su:');
      if (maybe) return maybe;
    }
    return STRICT_FALLBACK;
  }

  if (intent === 'termini') {
    const sectionPool = pickSectionChunks(base, 'termini', resolved.preferredUrl, resolved.resolvedEntityName);
    for (const chunk of sectionPool) {
      const sentences = splitIntoSentences(cleanInline(chunk.content));
      const matches = sentences.filter((s) =>
        /početak|pocetak|termin|rok|veljača|veljaca|siječanj|sijecanj|listopad|studeni|prosinac/i.test(s)
      );
      if (matches.length) return `${matches.join(' ')}\n\nIzvor: ${chunk.url}`;

      const maybe = formatBulletListFromChunk(chunk, 'Termini ili informacije o održavanju koje su navedene u izvoru su:');
      if (maybe) return maybe;
    }
    return STRICT_FALLBACK;
  }

  if (intent === 'sadrzaj') {
    const sectionPool = pickSectionChunks(base, 'sadrzaj', resolved.preferredUrl, resolved.resolvedEntityName);
    for (const chunk of sectionPool) {
      const maybe = formatBulletListFromChunk(chunk, 'Sadržaj koji je naveden u izvoru je:');
      if (maybe) return maybe;
    }
    return STRICT_FALLBACK;
  }

  if (intent === 'ishodi') {
    const sectionPool = pickSectionChunks(base, 'ishodi', resolved.preferredUrl, resolved.resolvedEntityName);
    for (const chunk of sectionPool) {
      const maybe = formatBulletListFromChunk(chunk, 'Ishodi koji su navedeni u izvoru su:');
      if (maybe) return maybe;
    }
    return STRICT_FALLBACK;
  }

  if (intent === 'izvedba') {
    const sectionPool = pickSectionChunks(base, 'izvedba', resolved.preferredUrl, resolved.resolvedEntityName);
    for (const chunk of sectionPool) {
      const sentences = splitIntoSentences(chunk.content);
      if (sentences.length) return `${sentences.slice(0, 2).join(' ')}\n\nIzvor: ${chunk.url}`;
    }
    return STRICT_FALLBACK;
  }

  if (intent === 'nositelj') {
    const sectionPool = pickSectionChunks(base, 'nositelj', resolved.preferredUrl, resolved.resolvedEntityName);
    const entityLabel = resolved.resolvedEntityName ?? '';

    // 1. Cjeloživotni program s "Predavači" sekcijom (dense concatenated teacher list)
    const allPool = base.length ? base : chunks;
    for (const chunk of allPool) {
      if (chunk.content.includes('Predavači') || chunk.content.includes('predavači')) {
        const teachers = extractPredavaciFromChunk(chunk.content);
        if (teachers.length > 0) {
          const name = entityLabel || chunk.entity_name || 'ovaj program';
          const formatted = teachers.map(t => `• ${t}`).join('\n');
          return `**Predavači na programu ${name}:**\n\n${formatted}\n\n🔹 Izvor: ${chunk.url}`;
        }
      }
    }

    // 2. Kolegij s "Nastavnici i suradnici" patternom
    for (const chunk of allPool) {
      const match = chunk.content.match(/Nastavnici\s+i\s+suradnici\s+(.+?)(?:\s*$)/i);
      if (match?.[1]) {
        const teacherClean = match[1].trim()
          .replace(/\s+[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '')
          .trim();
        if (teacherClean.length > 3) {
          const name = entityLabel || chunk.entity_name || 'ovaj kolegij';
          return `**Nastavnici koji predaju ${name}:**\n\n${teacherClean}\n\n🔹 Izvor: ${chunk.url}`;
        }
      }
    }

    // 3. Fallback: nositelj section chunks
    for (const chunk of sectionPool) {
      const maybe = formatBulletListFromChunk(chunk, `Nastavnici za ${entityLabel || 'ovaj kolegij'}:`);
      if (maybe) return maybe;
    }
    return STRICT_FALLBACK;
  }

  if (intent === 'ects') {
    const sectionPool = pickSectionChunks(base, 'ects', resolved.preferredUrl, resolved.resolvedEntityName);
    for (const chunk of sectionPool) {
      const match = cleanInline(chunk.content).match(/\b\d+\s*ECTS\b/i);
      if (match) return `${match[0]}\n\nIzvor: ${chunk.url}`;

      const maybe = formatBulletListFromChunk(chunk, 'ECTS podaci koji su navedeni u izvoru su:');
      if (maybe) return maybe;
    }
    return STRICT_FALLBACK;
  }

  if (intent === 'opis') {
    const sectionPool = pickSectionChunks(base, 'opis', resolved.preferredUrl, resolved.resolvedEntityName);
    for (const chunk of sectionPool) {
      const sentences = splitIntoSentences(chunk.content);
      if (sentences.length) return `${sentences.slice(0, 2).join(' ')}\n\nIzvor: ${chunk.url}`;
    }
    return STRICT_FALLBACK;
  }

  if (intent === 'popis_cjelozivotnih') {
    // Use STUDY_STRUCTURE directly — Supabase entity_names lack diacritics and
    // may include page-section titles rather than actual programme names.
    const programs = STUDY_STRUCTURE.cjelozivotno.programs;
    if (programs.length) {
      const list = programs.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
      const sourceUrl = STUDY_STRUCTURE.cjelozivotno.overviewSource;
      return `Programi cjeloživotnog obrazovanja koje nudi EFFECTUS veleučilište:\n\n${list}\n\nViše informacija: ${sourceUrl}`;
    }
  }

  if (intent === 'popis_studijskih') {
    // Try to build the list from RAG entity names (entity_type = 'studij').
    // Filter to Croatian-URL chunks to avoid old English-version scrapes.
    const studyChunks = chunks.filter(
      (c) =>
        c.entity_type === 'studij' &&
        c.entity_name &&
        c.url &&
        !c.url.includes('/en/')
    );
    const names = Array.from(
      new Set(studyChunks.map((c) => c.entity_name?.trim()).filter(Boolean) as string[])
    );

    if (names.length >= 4) {
      const sourceUrl =
        studyChunks.find((c) => c.url?.includes('/studijski-programi') && !c.url.includes('/en/'))?.url ??
        'https://effectus.com.hr/studijski-programi';
      return `Studijski programi EFFECTUS veleučilišta:\n\n${names.map(n => `• ${n}`).join('\n')}\n\nMogu vam pomoći i s:\n1. Koji su uvjeti upisa na EFFECTUS veleučilište?\n2. Kolika je školarina za pojedini studij?\n3. Kako izgleda online studiranje?\n\n🔹 Izvor: ${sourceUrl}`;
    }

    // Fallback: use structured STUDY_STRUCTURE if RAG doesn't return enough programs.
    const structuredAnswer = formatStudySupportAnswer(question);
    if (structuredAnswer) return structuredAnswer;

    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// LLM context
// ---------------------------------------------------------------------------

function buildStrictContext(chunks: RetrievedChunk[]): string {
  if (!chunks.length) return '';

  return chunks
    .map((chunk, index) =>
      [
        `[IZVOR ${index + 1}]`,
        `URL: ${chunk.url ?? 'Nije naveden'}`,
        `NASLOV: ${chunk.title ?? 'Bez naslova'}`,
        `CONTENT_GROUP: ${chunk.content_group ?? 'N/A'}`,
        `ENTITY_TYPE: ${chunk.entity_type ?? 'N/A'}`,
        `ENTITY_NAME: ${chunk.entity_name ?? 'N/A'}`,
        `SECTION_TYPE: ${chunk.section_type ?? 'N/A'}`,
        `CHUNK_INDEX: ${chunk.chunk_index}`,
        `TEKST: ${chunk.content}`,
      ].join('\n')
    )
    .join('\n\n');
}

function buildSystemPrompt(
  question: string,
  resolved: ResolvedQuery,
  context: string,
  sourceUrls: string[]
): string {
  const factSeeking = isFactSeekingQuestion(question);

  const answerInstruction = [
    factSeeking
      ? 'Pitanje traži konkretnu informaciju — navedi je jasno i direktno iz izvora.'
      : 'Sintetiziraj informacije iz izvora u prirodan, čitljiv odgovor.',
    'Koristi samo činjenice iz priloženih izvora — ne dodavaj vlastita nagađanja.',
    'Ako izvor ima djelomičan odgovor, reci što znaš i predloži gdje pronaći više.',
    resolved.preferredUrl
      ? `Korisnik pita o temi iz: ${resolved.preferredUrl} — ostani na toj temi ako je relevantno.`
      : '',
    resolved.resolvedEntityName
      ? `Govorimo o: "${resolved.resolvedEntityName}"`
      : '',
    resolved.requestedSectionType
      ? `Fokus odgovora: ${resolved.requestedSectionType}`
      : '',
    `Ako izvori ne sadrže dovoljno informacija, odgovori: "${STRICT_FALLBACK}"`,
  ].filter(Boolean).join('\n');

  const conversationInstruction = [
    resolved.isFollowUp
      ? 'Nastavljamo prethodni razgovor — zadrži kontekst i ne ponavljaj uvod.'
      : '',
    `Domena: ${resolved.contentGroup}.`,
    'Razlikuj: studijski programi (prijediplomski/diplomski), online studij, cjeloživotno obrazovanje, upisi.',
  ].filter(Boolean).join('\n');

  return [
    SYSTEM_PROMPT,
    '',
    '## Upute za ovaj odgovor',
    answerInstruction,
    '',
    conversationInstruction,
    '',
    '## Format odgovora',
    'Na kraju odgovora dodaj:',
    '🔹 Izvor: <točan URL>',
    '(Ako koristiš više izvora, svaki URL u zasebnom retku.)',
    '',
    'Nakon izvora dodaj 3 prijedloga daljnjih pitanja:',
    'Mogu vam pomoći i s:',
    '1. [prijedlog 1]',
    '2. [prijedlog 2]',
    '3. [prijedlog 3]',
    'Prijedlozi trebaju biti konkretni i logični nastavci razgovora (Vi forma).',
    '',
    'IZVORI:',
    context,
    '',
    'DOSTUPNI URL-OVI KOJE SMIJEŠ NAVESTI KAO IZVOR:',
    sourceUrls.length ? sourceUrls.join('\n') : 'Nema dostupnih URL-ova.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Contextual suggestion generator
// Always appended to every answer so users have 3 clickable follow-up questions.
// ---------------------------------------------------------------------------

type SuggestionTopic = 'management' | 'referada' | 'studies' | 'teacher' | 'erasmus' | 'international' | 'general';

function appendSuggestions(answer: string, question: string, topic: SuggestionTopic, askedQuestions: string[] = []): string {
  const q = question.toLowerCase();
  let s1: string, s2: string, s3: string;

  if (topic === 'management') {
    // NOTE: check 'prodekan' BEFORE 'dekan' — "prodekan" contains "dekan" as substring
    if (q.includes('dosadašnj') || q.includes('bivš') || q.includes('prethodni')) {
      [s1, s2, s3] = [
        'Tko je trenutni dekan EFFECTUS veleučilišta?',
        'Tko su prodekani Effectusa?',
        'Koji studiji postoje na Effectusu?',
      ];
    } else if (q.includes('prodekan')) {
      [s1, s2, s3] = [
        'Tko je dekan EFFECTUS veleučilišta?',
        'Tko su pomoćnici dekana?',
        'Tko su voditelji studija?',
      ];
    } else if (q.includes('dekan')) {
      [s1, s2, s3] = [
        'Tko su prodekani EFFECTUS veleučilišta?',
        'Koji su bili dosadašnji dekani Effectusa?',
        'Tko su voditelji studija?',
      ];
    } else if (q.includes('voditel')) {
      [s1, s2, s3] = [
        'Tko je dekan EFFECTUS veleučilišta?',
        'Koji studiji postoje na Effectusu?',
        'Koji online studiji postoje?',
      ];
    } else if (q.includes('uprav')) {
      [s1, s2, s3] = [
        'Tko je dekan EFFECTUS veleučilišta?',
        'Tko su prodekani?',
        'Tko su voditelji studija?',
      ];
    } else {
      [s1, s2, s3] = [
        'Tko je dekan EFFECTUS veleučilišta?',
        'Tko su voditelji studija?',
        'Koji studiji postoje na Effectusu?',
      ];
    }
  } else if (topic === 'referada') {
    if (q.includes('radno vrijeme') || q.includes('kada radi') || q.includes('otvoren')) {
      [s1, s2, s3] = [
        'Koji su kontakti studentske referade?',
        'Kako predati studentsku zamolbu?',
        'Koji su ispitni rokovi?',
      ];
    } else if (q.includes('završni') || q.includes('diplomski rad') || q.includes('obran')) {
      [s1, s2, s3] = [
        'Koji obrasci su potrebni za obranu rada?',
        'Tko je kontakt za organizaciju obrana?',
        'Kada radi studentska referada?',
      ];
    } else if (q.includes('zamolb') || q.includes('prigovor') || q.includes('žalb')) {
      [s1, s2, s3] = [
        'Koliko košta podnošenje zamolbe?',
        'Kada radi studentska referada?',
        'Koji su kontakti referade?',
      ];
    } else if (q.includes('knjižnic') || q.includes('knjiznic')) {
      [s1, s2, s3] = [
        'Kada radi studentska referada?',
        'Koji su kontakti studentske referade?',
        'Kako naručiti knjige ako studiram u Osijeku ili Biogradu?',
      ];
    } else if (q.includes('ispitni rok') || q.includes('termini ispita')) {
      [s1, s2, s3] = [
        'Gdje se nalaze ispitni rokovi?',
        'Kada radi studentska referada?',
        'Koji su kontakti referade?',
      ];
    } else {
      [s1, s2, s3] = [
        'Kada radi studentska referada?',
        'Koji su kontakti referade u Osijeku i Biogradu?',
        'Kako predati završni rad?',
      ];
    }
  } else if (topic === 'studies') {
    if (q.includes('online') || q.includes('kratki') || q.includes('daljinsk')) {
      [s1, s2, s3] = [
        'Koji su uvjeti upisa na online studij?',
        'Kolika je školarina za online studij?',
        'Koji studiji postoje na Effectusu?',
      ];
    } else if (q.includes('diplomski')) {
      [s1, s2, s3] = [
        'Koji su uvjeti upisa na diplomski studij?',
        'Postoji li online diplomski studij?',
        'Kolika je školarina?',
      ];
    } else if (q.includes('uvjeti') || q.includes('upis')) {
      [s1, s2, s3] = [
        'Koji studiji postoje na Effectusu?',
        'Kolika je školarina?',
        'Koji su rokovi upisa?',
      ];
    } else {
      [s1, s2, s3] = [
        'Koji studiji postoje na Effectusu?',
        'Koji online studiji postoje?',
        'Koji su uvjeti upisa?',
      ];
    }
  } else if (topic === 'teacher') {
    [s1, s2, s3] = [
      'Koji kolegiji se predaju na tom studiju?',
      'Koji su uvjeti upisa za taj studij?',
      'Postoji li online verzija studija?',
    ];
  } else if (topic === 'erasmus') {
    if (q.includes('semestar') || q.includes('termin') || q.includes('prijava') || q.includes('nominacij') || q.includes('apply')) {
      [s1, s2, s3] = [
        'Što je Erasmus+ program?',
        'Kakva je studentska mobilnost u svrhu prakse?',
        'Koji studiji postoje na Effectusu?',
      ];
    } else if (q.includes('osoblje') || q.includes('nastavni') || q.includes('staff') || q.includes('podučavanj') || q.includes('osposobljav')) {
      [s1, s2, s3] = [
        'Što je akademska mobilnost?',
        'Koji su termini Erasmus+ semestra?',
        'Koji studiji postoje na Effectusu?',
      ];
    } else if (q.includes('studenti') || q.includes('studentska') || q.includes('praksa') || q.includes('studij inozemstvo')) {
      [s1, s2, s3] = [
        'Koji su termini Erasmus+ semestra i kako se prijaviti?',
        'Kakva je Erasmus+ mobilnost osoblja?',
        'Koji studiji postoje na Effectusu?',
      ];
    } else {
      // Generic Erasmus question
      [s1, s2, s3] = [
        'Koji su termini Erasmus+ semestra i kako se prijaviti?',
        'Kakva je studentska Erasmus+ mobilnost?',
        'Koji studiji postoje na Effectusu?',
      ];
    }
  } else if (topic === 'international') {
    if (q.includes('mobilnost') || q.includes('razmjena')) {
      [s1, s2, s3] = [
        'Što je Erasmus+ program?',
        'Koji su termini Erasmus+ semestra?',
        'Koji studiji postoje na Effectusu?',
      ];
    } else if (q.includes('partner') || q.includes('suradnja')) {
      [s1, s2, s3] = [
        'Što je akademska mobilnost?',
        'Što je Erasmus+ program?',
        'Koji studiji postoje na Effectusu?',
      ];
    } else {
      [s1, s2, s3] = [
        'Što je Erasmus+ program na Effectusu?',
        'Što je akademska mobilnost?',
        'Koji studiji postoje na Effectusu?',
      ];
    }
  } else {
    [s1, s2, s3] = [
      'Koji studiji postoje na Effectusu?',
      'Kada radi studentska referada?',
      'Tko je dekan EFFECTUS veleučilišta?',
    ];
  }

  // Filter out suggestions that are too similar to what was just answered.
  // Two questions are "too similar" when they share 2+ significant words (len ≥ 5)
  // after normalization — e.g. "Koji su rokovi upisa?" after answering about rokovi.
  function sigWords(text: string): Set<string> {
    return new Set(
      normalizeText(text).split(/\s+/).filter(w => w.length >= 5)
    );
  }
  function isTooSimilar(suggestion: string): boolean {
    const sWords = sigWords(suggestion);
    // Check against current question
    const qWords = sigWords(question);
    let overlap = 0;
    for (const w of sWords) { if (qWords.has(w)) overlap++; }
    if (overlap >= 2) return true;
    // Check against all previously asked questions in this conversation
    for (const prev of askedQuestions) {
      const pWords = sigWords(prev);
      let poverlap = 0;
      for (const w of sWords) { if (pWords.has(w)) poverlap++; }
      if (poverlap >= 2) return true;
    }
    return false;
  }

  const candidates = [s1, s2, s3].filter(s => !isTooSimilar(s));
  if (candidates.length === 0) return answer; // all suggestions were too similar — skip block
  const numbered = candidates.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return `${answer}\n\nMogu vam pomoći i s:\n${numbered}`;
}

// ---------------------------------------------------------------------------
// Management person → LLM stream helper
// ---------------------------------------------------------------------------

/**
 * For person-specific management questions (dekan, prodekan, specific named person),
 * generates a rich LLM response using the management card + nastavnici DB bio as context.
 * Returns null if the answer is a list/generic (should still be returned directly).
 */
async function streamManagementPersonAnswer(
  managementCard: string,
  question: string,
  recentConversation: ChatMessage[]
): Promise<string | null> {
  // Only enrich personal cards (they contain 📧 or 📞)
  if (!managementCard.includes('📧') && !managementCard.includes('📞')) return null;

  // Extract person name — first bold segment
  const nameMatch = managementCard.match(/\*\*([^*\n]{4,80})\*\*/);
  if (!nameMatch) return null;
  const personName = nameMatch[1].replace(/\[PHOTO:[^\]]+\]/g, '').trim();

  // Normalise for DB lookup
  const normName = normalizeText(personName);
  const nameParts = normName
    .replace(/\b(prof|dr|sc|doc|izv|red|mr|mag|oec|pred|vs|v)\b\.?/g, '')
    .trim().split(/\s+/).filter(p => p.length >= 3);

  let nastavnikBio = '';
  if (nameParts.length >= 2) {
    try {
      const tenantId = getTenantId();
      const nameConditions = nameParts.map((_, i) => `content ILIKE $${i + 2}`).join(' AND ');
      const params: (string | number)[] = [tenantId, ...nameParts.map(p => `%${p}%`)];
      const result = await pool.query(
        `SELECT content FROM document_chunks
         WHERE tenant_id = $1 AND entity_type = 'nastavnik'
         AND ${nameConditions}
         ORDER BY chunk_index
         LIMIT 4`,
        params
      );
      nastavnikBio = result.rows.map((r: { content: string }) => r.content).join('\n\n');
    } catch { /* ignore DB errors */ }
  }

  // Build combined context for LLM
  const contextParts = [`=== Profil iz sustava upravljanja ===\n${managementCard}`];
  if (nastavnikBio) {
    contextParts.push(`=== Životopis (nastavnički profil) ===\n${nastavnikBio}`);
  }
  const combinedContext = contextParts.join('\n\n');

  const personSystemPrompt = `${SYSTEM_PROMPT}

IZVORI:
${combinedContext}

Uputa: Na temelju svih gore navedenih izvora, napiši OPŠIRAN i DETALJAN odgovor o osobi "${personName}".
OBAVEZNO uključi SVE dostupne informacije u ovom redoslijedu:
1. Puno ime i akademska titula
2. Trenutna uloga/funkcija na veleučilištu (s datumom imenovanja ako je dostupno)
3. Kontakt podaci (e-mail, telefon)
4. Obrazovanje i akademski put
5. Iskustvo na EFFECTUS veleučilištu (od kada, prethodne funkcije)
6. Istraživačka i nastavna područja
7. Kolegiji koje predaje
8. Ostale aktivnosti, projekti, međunarodna suradnja
Odgovor mora biti OPŠIRAN — piši u rečenicama s kontekstom, ne samo suhe natuknice. Korisnik želi zaista upoznati ovu osobu.`;

  const completionMessages: ChatMessage[] = [
    { role: 'system', content: personSystemPrompt },
    ...recentConversation.slice(0, -1),
    { role: 'user', content: question },
  ];

  const stream = await streamChat(completionMessages);
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    fullText += decoder.decode(value, { stream: true });
  }
  fullText += decoder.decode();
  return fullText || null;
}

// ---------------------------------------------------------------------------
// Teacher profile enrichment helper
// ---------------------------------------------------------------------------

/**
 * Given a raw findTeacherByName() answer, enriches it with:
 * 1. Institutional management role + bio + photo (if person is in CURRENT_MANAGEMENT)
 * 2. Study program names from the Supabase scraped predmeti data
 */
async function applyTeacherProfileEnrichment(rawAnswer: string): Promise<string> {
  let enriched = rawAnswer;
  const nameMatch = rawAnswer.match(/^\*\*([^*\n]{5,70})\*\*/m);
  if (!nameMatch) return enriched;

  const fullName = nameMatch[1];

  // ── Fetch real photo from effectus.com.hr WordPress API ────────────────────────────
  // Profile URL is embedded in the raw answer as "🔗 Profil: URL" or "🔹 Izvor: URL"
  const profileUrlMatch = enriched.match(/(?:🔗\s*Profil|🔹\s*Izvor):\s*(https?:\/\/[^\s\n]+nastavnici-suradnici[^\s\n]*)/i);
  if (profileUrlMatch) {
    const photo = await fetchTeacherPhotoUrl(profileUrlMatch[1]);
    // Rewrite the first **Name** line → 👤 **Name** [PHOTO:url]  (if photo found)
    // or just   👤 **Name**  (so the avatar always appears)
    enriched = enriched.replace(
      /^(\*\*[^*\n]+\*\*)$/m,
      photo ? `👤 $1 [PHOTO:${photo}]` : `👤 $1`
    );
  }
  const normFullName = normalizeText(fullName);

  // Inject management role / bio / photo when person is in CURRENT_MANAGEMENT.
  // IMPORTANT: strip dots before title-removal so "dr. sc." → "dr sc" matches the regex.
  // Then require ALL remaining name tokens to appear in the query name —
  // this prevents "Ivan Ružić" matching "Drago Ružić" just because both share "ruzic".
  const stripTitles = (s: string) =>
    s.replace(/\./g, ' ')
     .replace(/\b(izv|red|prof|doc|dr|sc|mr|mag|oec|pred|vs|v|univ|struc|spec|socio|nasl)\b/g, '')
     .replace(/\s+/g, ' ')
     .trim();
  const normFullNameClean = stripTitles(normFullName);
  const mgmtPerson = CURRENT_MANAGEMENT.find(p => {
    const normP = stripTitles(normalizeText(p.name));
    const parts = normP.split(/\s+/).filter(w => w.length >= 3);
    // ALL name parts must match — prevents sharing a surname from triggering a false positive
    return parts.length > 0 && parts.every(part => normFullNameClean.includes(part));
  });
  if (mgmtPerson) {
    // Photo must appear on the "👤 **Name**" line so ChatWindow can render it as an image.
    // Never put [PHOTO:url] on its own line — the frontend only parses it on 👤 lines.
    if (mgmtPerson.photo) {
      if (/^👤\s*\*\*/m.test(enriched)) {
        // 👤 line already exists — replace any existing photo or append one
        enriched = enriched.replace(
          /^(👤\s*\*\*[^*\n]+\*\*)(\s*\[PHOTO:[^\]]*\])?/m,
          `$1 [PHOTO:${mgmtPerson.photo}]`
        );
      } else {
        // No 👤 line yet — prefix the first bold name line and add photo
        enriched = enriched.replace(
          /^(\*\*[^*\n]+\*\*)$/m,
          `👤 $1 [PHOTO:${mgmtPerson.photo}]`
        );
      }
    }
    const bioLine = mgmtPerson.bio ? `\nℹ️ ${mgmtPerson.bio}` : '';
    const mgmtSection = `\n📋 **Uloga:** ${mgmtPerson.role}${bioLine}`;
    const firstNewline = enriched.indexOf('\n');
    enriched = firstNewline >= 0
      ? enriched.slice(0, firstNewline) + mgmtSection + enriched.slice(firstNewline)
      : enriched + mgmtSection;
  }

  // Enrich with study program names from the predmeti/studijski_programi Supabase data.
  // Filter out raw scraped document titles (e.g. "Izvedbeni plan nastave za 2025.-2026. – ...")
  // and keep only clean study program names.
  // Pass ALL name tokens to prevent surname collisions (e.g. "Drago Ružić" vs "Ivan Ružić").
  const programChunks = await retrieveStudyProgramChunksForTeacher(teacherNameTokens(fullName), 20);

  // Only use chunks from /studijski-programi/ pages — their entity_name is the
  // study program name (e.g. "Informacijske tehnologije").
  // Chunks from /predmeti/ pages have the course name as entity_name
  // (e.g. "Građa računala", "Diplomski rad (PIT)") — those are course names,
  // not study programs, and must be excluded.
  const isCleanProgramName = (name: string) =>
    !/(izvedbeni|plan nastave|nastavni plan|\d{4}\.\s*[-–]\s*\d{4}|stručni prijediplomski studij\s+\w|stručni diplomski studij\s+\w)/i.test(name) &&
    name.length < 80;
  const programNames = Array.from(new Set(
    programChunks
      .filter(c => c.url?.includes('/studijski-programi/'))
      .map(c => c.entity_name?.trim())
      .filter((n): n is string => Boolean(n) && isCleanProgramName(n as string))
  ));
  if (programNames.length > 0) {
    const studijLabel = programNames.length === 1 ? 'studiju' : 'studijima';
    const programSection = `\n\n**Predaje na ${studijLabel}:** ${programNames.join(', ')}`;
    const insertPoint = enriched.indexOf('\n\nMogu vam pomoći');
    enriched = insertPoint >= 0
      ? enriched.slice(0, insertPoint) + programSection + enriched.slice(insertPoint)
      : enriched + programSection;
  }

  return enriched;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages = (body.messages ?? []) as ChatMessage[];
    const userMessage = [...messages].reverse().find((m) => m.role === 'user');

    if (!userMessage?.content) {
      return new Response('Nedostaje korisnički upit.', { status: 400, headers: PLAIN_TEXT_HEADERS });
    }

    if (!isQuestionUsable(userMessage.content)) {
      return new Response('Molim postavite malo konkretnije pitanje.', { status: 400, headers: PLAIN_TEXT_HEADERS });
    }

    // Collect all previous user questions (excluding the current one) so that
    // appendSuggestions can avoid repeating already-asked questions.
    const askedQuestions = messages
      .filter((m) => m.role === 'user' && m.content?.trim() && m !== userMessage)
      .map((m) => m.content);

    // Recent conversation needed early for management person enrichment via LLM
    const recentConversation = getRecentConversation(messages, 8);

    // ── Meta/greeting intercept ───────────────────────────────────────────────
    // Vague questions like "o čemu možemo razgovarati", "što možeš", etc.
    // Return a fixed welcome with proper clickable suggestion questions.
    const isMetaGreeting = /^(o čemu|o cemu|sto mozes|što možeš|kako možeš|kako mozes|što znaš|sto znas|pomozi mi|kako ti možeš|kako ti mozes|čemu možeš|cemu mozes|s čime možeš|s cime mozes|što sve možeš|sto sve mozes|kako funkcioniraš|kako funkcioniras|predstavi se|uvod)/i.test(userMessage.content.trim());
    if (isMetaGreeting) {
      return new Response([
        'Zdravo! Ja sam Effy, informativni asistent EFFECTUS veleučilišta. 😊',
        '',
        'Mogu vam pomoći s pitanjima o upisu, studijskim programima, školarini, nastavnicima, online studiranju i cjeloživotnom obrazovanju.',
        '',
        'Mogu vam pomoći i s:',
        '1. Koji studijski programi postoje na Effectusu?',
        '2. Kolika je školarina?',
        '3. Koji su rokovi upisa?',
      ].join('\n'), { status: 200, headers: PLAIN_TEXT_HEADERS });
    }

    if (!OPENAI_API_KEY) {
      return new Response('OPENAI_API_KEY nije postavljen u .env.local', { status: 500, headers: PLAIN_TEXT_HEADERS });
    }

    // Quick-tab prompts that must go through RAG instead of hardcoded handlers.
    // "Koji studijski programi postoje?" is intentionally excluded — it uses the
    // fast-path below which already returns accurate data from STUDY_STRUCTURE.
    // Quick-tab prompts that bypass hardcoded formatters and go straight to RAG.
    // NOTE: 'Kolika je školarina?' is intentionally excluded — formatStudyAdmissionsAnswer
    // returns accurate, well-formatted tuition data from STUDY_STRUCTURE. The RAG
    // returns raw scraped FAQ chunks (no line-breaks, no actual amounts).
    const QUICK_TAB_PROMPTS = [
      'Kako izgleda procedura upisa?',
      'Postoji li online studij?',
      // 'Koji su rokovi upisa?' intentionally removed — handled by fast-path below
      // to avoid serving compressed scraped text with navigation headers from RAG.
    ];
    const isQuickTabPrompt = QUICK_TAB_PROMPTS.some(
      p => p.toLowerCase() === userMessage.content.trim().toLowerCase()
    );

    // ── FAST-PATH: "Koji studijski programi postoje?" ────────────────────────
    // Caught here before any RAG or intent chain to guarantee a structured answer.
    // Uses the same regex as detectFactIntent('popis_studijskih').
    // NOTE: skipped for quick-tab prompts so they always go through RAG.
    if (
      !isQuickTabPrompt &&
      (/\bkoji studijski programi\b/i.test(userMessage.content) ||
      /\bkoji su studijski programi\b/i.test(userMessage.content) ||
      /\bpopis studijskih programa\b/i.test(userMessage.content) ||
      /\bsvi studijski programi\b/i.test(userMessage.content))
    ) {
      const short = STUDY_STRUCTURE.zapresic.shortOnlineStudies;
      const ug = STUDY_STRUCTURE.zapresic.undergraduateOnlineStudies;
      const grad = STUDY_STRUCTURE.zapresic.graduateOnlineStudies;
      const biogradStudies = STUDY_STRUCTURE.biograd.classicalStudies;
      const osijekStudies = STUDY_STRUCTURE.osijek.classicalStudies;
      const catalogAnswer = [
        '**Studijski programi EFFECTUS veleučilišta Zaprešić:**',
        '',
        '📍 **Klasična nastava — Biograd na Moru** (stručni prijediplomski, 3 god / 180 ECTS)',
        ...biogradStudies.map(s => `• ${s.name}`),
        '',
        '📍 **Klasična nastava — Osijek** (stručni diplomski, 2 god / 120 ECTS)',
        ...osijekStudies.map(s => `• ${s.name}`),
        '',
        '🌐 **Online — Stručni kratki studij** (2 god / 120 ECTS — bez državne mature)',
        ...short.map(s => `• ${s.name}${s.note ? ` — ${s.note}` : ''}`),
        '',
        '🌐 **Online — Stručni prijediplomski studiji** (3 god / 180 ECTS)',
        ...ug.map(s => `• ${s.name}${s.note ? ` — ${s.note}` : ''}`),
        '',
        '🌐 **Online — Stručni diplomski studiji** (2 god / 120 ECTS)',
        ...grad.map(s => `• ${s.name}${s.note ? ` — ${s.note}` : ''}`),
        '',
        'Svi online studiji izvode se bez potrebe za fizičkom prisutnošću.',
        '',
        'Mogu vam pomoći i s:',
        '1. Koji su uvjeti upisa na EFFECTUS veleučilište?',
        '2. Kolika je školarina za pojedini studij?',
        '3. Kako izgleda online studiranje?',
        '',
        `🔹 Izvor: ${STUDY_STRUCTURE.zapresic.source}`,
      ].join('\n');
      return new Response(catalogAnswer, { status: 200, headers: PLAIN_TEXT_HEADERS });
    }

    // ── FAST-PATH: "Koje programe cjeloživotnog obrazovanja nudite?" ──────────
    // Uses STUDY_STRUCTURE.cjelozivotno.programs — Supabase entity_names lack
    // diacritics so we always serve the curated list from the knowledge base.
    if (
      !isQuickTabPrompt &&
      (/\bkoje programe cjelozivotnog obrazovanja\b/i.test(userMessage.content) ||
       /\bcjelozivotno obrazovanje\b.*\bprograme\b/i.test(userMessage.content) ||
       /\bpopis.*cjelozivotno\b/i.test(userMessage.content) ||
       /\bprograme cjelozivotnog\b/i.test(userMessage.content))
    ) {
      const programs = STUDY_STRUCTURE.cjelozivotno.programs;
      const list = programs.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
      const czoAnswer = [
        '**Programi cjeloživotnog obrazovanja EFFECTUS veleučilišta:**',
        '',
        list,
        '',
        `🔹 Više informacija: ${STUDY_STRUCTURE.cjelozivotno.overviewSource}`,
      ].join('\n');
      return new Response(czoAnswer, { status: 200, headers: PLAIN_TEXT_HEADERS });
    }

    // ── FAST-PATH: rokovi upisa / akademska godina ───────────────────────────
    // RAG returns compressed scraped page text with broken link-text ("OVDJE").
    // Effectus has own enrollment rounds regardless of AZVO's 2 roka for prijediplomski.
    {
      const q_rokovi = normalizeText(userMessage.content);
      const isRokoviQuery =
        /\brokovi upisa\b|\brokovi za upis\b|\bupisni rokovi\b|\bkoji su rokovi\b/i.test(userMessage.content) ||
        /\bkada pocinje\b|\bkad pocinje\b|\bkada krece\b|\bkad krece\b|\bpocetak ak\b|\bpocetak akadem|\bnova akademska god/i.test(q_rokovi) ||
        /\bkada pocinje nova\b|\bkad je upis\b|\bkada je upis\b|\btermini upisa\b/i.test(q_rokovi) ||
        userMessage.content.trim().toLowerCase() === 'koji su rokovi upisa?';

      if (isRokoviQuery) {
        const rokoviAnswer = [
          '**Upisni rokovi — EFFECTUS veleučilište Zaprešić (ak. god. 2026./2027.):**',
          '',
          'EFFECTUS veleučilište provodi upise u **4 upisna roka** kontinuirano kroz godinu:',
          '',
          '**1. upisni rok**',
          '• Primanje prijava: 9. 2. – 15. 7. 2026.',
          '• Upisi: 20. – 23. 7. 2026.',
          '',
          '**2. upisni rok**',
          '• Primanje prijava: 24. 8. – 18. 9. 2026.',
          '• Upisi: 21. – 24. 9. 2026.',
          '',
          '**3. upisni rok**',
          '• Primanje prijava: 28. 9. – 11. 12. 2026.',
          '• Upisi: 14. – 17. 12. 2026.',
          '',
          '**4. upisni rok**',
          '• Primanje prijava: 18. 12. 2026. – 29. 1. 2027.',
          '• Upisi: 1. – 26. 2. 2027.',
          '',
          '⚠ Kandidati koji upisuju prijediplomski studij putem državne mature moraju pratiti i rokove definirane od strane AZVO-a na **studij.hr**.',
          '',
          'Upis je moguć do ispunjenja upisnih kvota, a najkasnije do kraja zimskog semestra.',
          '',
          'Mogu vam pomoći i s:',
          '1. Koji su uvjeti upisa?',
          '2. Kako izgleda procedura upisa?',
          '3. Kolika je školarina?',
          '',
          `🔹 Izvor: https://effectus.com.hr/upisi/postupak-i-termini-upisa`,
        ].join('\n');
        return new Response(rokoviAnswer, { status: 200, headers: PLAIN_TEXT_HEADERS });
      }
    }

    // ── FAST-PATH: uvjeti upisa — specific study type handlers + general menu ──────
    {
      const qUvjeti = normalizeText(userMessage.content);
      const isUvjetiQuery =
        (qUvjeti.includes('uvjeti') || qUvjeti.includes('pravo upisa')) &&
        (qUvjeti.includes('upis') || qUvjeti.includes('upisat') || qUvjeti.includes('uvjeti upisa'));

      if (isUvjetiQuery) {
        const hasKratki = /kratki|kratk/i.test(qUvjeti);
        const hasPrijediplomski = /prijediplomski|preddiplomski/i.test(qUvjeti);
        const hasDiplomski = !hasPrijediplomski && /\bdiplomski\b/i.test(qUvjeti);
        const hasCzo = /cjelozivotno|cjeloživotno|czo|obrazovanj/i.test(qUvjeti);

        if (hasKratki) {
          return new Response([
            '**Uvjeti upisa na Stručni kratki studij** (Primijenjena ekonomija):',
            '',
            'Pravo upisa imaju:',
            '• kandidati koji su završili četverogodišnju srednju školu u HR i položili državnu maturu,',
            '• kandidati koji su završili četverogodišnju srednju školu u HR bez državne mature (izuzev gimnazija),',
            '• kandidati koji su završili četverogodišnju srednju školu u HR prije 2010. i nisu polagali maturu,',
            '• kandidati koji su završili trogodišnju srednju školu u RH,',
            '• kandidati koji su završili srednju školu u inozemstvu (uz priznavnje strane kvalifikacije),',
            '• prijelaznici s drugog visokog učilišta.',
            '',
            '⚠ Stručni kratki studij **ne zahtijeva državnu maturu** — upis je dostupan i kandidatima iz trogodišnje srednje škole.',
            '',
            '🔹 Izvor: https://effectus.com.hr/upisi/cesta-pitanja',
          ].join('\n'), { status: 200, headers: PLAIN_TEXT_HEADERS });
        }

        if (hasPrijediplomski) {
          return new Response([
            '**Uvjeti upisa na Stručni prijediplomski studij:**',
            '',
            'Pravo upisa imaju:',
            '• kandidati koji su završili četverogodišnju srednju školu u HR i položili državnu maturu,',
            '• kandidati koji su završili četverogodišnju srednju školu u HR prije 2010. bez državne mature,',
            '• kandidati koji su završili srednju školu u inozemstvu (uz priznavnje strane kvalifikacije),',
            '• kandidati koji su završili odgovarajući stručni kratki studij u HR ili izvan nje,',
            '• prijelaznici s drugog visokog učilišta.',
            '',
            'Mogu vam pomoći i s:',
            '1. Koji su rokovi upisa?',
            '2. Kolika je školarina?',
            '3. Kako izgleda procedura upisa?',
            '',
            '🔹 Izvor: https://effectus.com.hr/upisi/cesta-pitanja',
          ].join('\n'), { status: 200, headers: PLAIN_TEXT_HEADERS });
        }

        if (hasDiplomski) {
          return new Response([
            '**Uvjeti upisa na Stručni diplomski studij:**',
            '',
            'Pravo upisa imaju kandidati koji imaju:',
            '• završen stručni ili sveučilišni preddiplomski studij s najmanje **180 ECTS** bodova, ili',
            '• završen preddiplomski studij s najmanje **150 ECTS** bodova uz obvezu polaganja razlikovnih ispita, ili',
            '• stečenu višu/visoku stručnu spremu izjednačenu s nazivom „prvostupnik/prvostupnica", ili',
            '• završen diplomski sveučilišni studij.',
            '',
            'Mogu vam pomoći i s:',
            '1. Koji su rokovi upisa?',
            '2. Kolika je školarina?',
            '3. Koji diplomski studiji postoje?',
            '',
            '🔹 Izvor: https://effectus.com.hr/upisi/cesta-pitanja',
          ].join('\n'), { status: 200, headers: PLAIN_TEXT_HEADERS });
        }

        if (hasCzo) {
          return new Response([
            '**Uvjeti upisa na programe Cjeloživotnog obrazovanja (CŽO):**',
            '',
            'Uvjeti se razlikuju ovisno o programu. Većina programa je otvorena za sve zainteresirane polaznike bez posebnih preduvjeta.',
            'Posebni uvjeti (ako postoje) navedeni su u opisu svakog pojedinog programa.',
            '',
            'Za popis svih CŽO programa i njihovih uvjeta posjetite:',
            '• https://effectus.com.hr/cjelozivotno-obrazovanje',
            '',
            'Mogu vam pomoći i s:',
            '1. Koji programi cjeloživotnog obrazovanja postoje?',
            '2. Kolika je cijena CŽO programa?',
            '3. Koji su uvjeti upisa na studije?',
            '',
            '🔹 Izvor: https://effectus.com.hr/cjelozivotno-obrazovanje',
          ].join('\n'), { status: 200, headers: PLAIN_TEXT_HEADERS });
        }

        // General "Koji su uvjeti upisa?" — no specific type → show 4 clickable options
        // instead of a wall of text with all conditions mixed together.
        return new Response([
          'Za koji tip studija tražite uvjete upisa?',
          '',
          'Mogu vam pomoći i s:',
          '1. Uvjeti upisa za stručni kratki studij',
          '2. Uvjeti upisa za prijediplomski studij',
          '3. Uvjeti upisa za diplomski studij',
          '4. Uvjeti upisa za cjeloživotno obrazovanje',
        ].join('\n'), { status: 200, headers: PLAIN_TEXT_HEADERS });
      }
    }

    // Teacher intent: caught either by explicit teacher keywords OR as follow-up answer
    // to the bot's own clarification ("Koji vas kolegij zanima?"). This prevents "marketing"
    // typed as a follow-up answer from falling through to RAG and returning STRICT_FALLBACK.
    // "Postoji li online verzija studija?" as follow-up after a classical-only program listing.
    // If the last answer was about an offline-only program (e.g. MTU Biograd), give specific answer.
    if (/postoji li online|online verzija studij|ima li online/i.test(userMessage.content)) {
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && m.content?.trim());
      if (lastAssistant?.content) {
        const { STUDY_PROGRAM_COURSE_MAP: SPCM } = await import('@/lib/knowledge/teachers');
        for (const prog of SPCM) {
          if (!prog.isOnline && lastAssistant.content.includes(prog.name)) {
            return new Response(
              `Studij **${prog.name}** izvodi se isključivo klasično (u učionici) u ${prog.location.replace(' (klasično)', '')}.\n\nOnline verzija ovog studija ne postoji.\n\nAko vas zanima online studiranje, EFFECTUS veleučilište nudi sljedeće online programe:\n• Poslovna ekonomija i financije\n• Informacijske tehnologije\n• Menadžment javnog sektora\n• Komunikacijski menadžment\n• i drugi\n\nMogu vam pomoći i s:\n1. Koji online studiji postoje na Effectusu?\n2. Kolika je školarina?\n3. Koji su uvjeti upisa?\n\n🔹 Izvor: https://effectus.com.hr/studijski-programi`,
              { status: 200, headers: PLAIN_TEXT_HEADERS }
            );
          }
        }
      }
    }

    // ── Teacher follow-up: "Što još predaje na drugim studijima?" ────────────
    // Catches vague follow-ups AFTER a teacher profile was shown in the previous turn.
    // Extracts the teacher's surname, queries Supabase studijski_programi chunks,
    // and builds a cross-program course breakdown.
    {
      const followUpTeacherName = isTeacherFollowUp(userMessage.content, messages);
      if (followUpTeacherName) {
        const followUpTokens = teacherNameTokens(followUpTeacherName);
        const followUpSurname = teacherSurnameToken(followUpTeacherName);
        const programChunks = await retrieveStudyProgramChunksForTeacher(followUpTokens, 25);
        if (programChunks.length > 0) {
          const byProgram = new Map<string, string[]>();
          for (const chunk of programChunks) {
            const rawProg = chunk.entity_name?.trim() || '';
            // Skip raw document titles (scraped page names instead of clean program names)
            if (!rawProg || /(izvedbeni|plan nastave|\d{4}\.\s*[-–]\s*\d{4})/i.test(rawProg)) continue;
            const prog = rawProg;
            if (!byProgram.has(prog)) byProgram.set(prog, []);
            // Extract only bullet lines that mention this teacher's surname
            const relevant = chunk.content
              .split('\n')
              .filter(l => l.includes(followUpSurname))
              .map(l => l.trim())
              .filter(l => l.startsWith('•') && l.length > 5);
            if (relevant.length > 0) byProgram.get(prog)!.push(...relevant);
          }
          // Remove programs where no teacher-specific lines were found
          for (const [k, v] of byProgram) { if (v.length === 0) byProgram.delete(k); }

          if (byProgram.size > 0) {
            const cleanName = followUpTeacherName.replace(/\*\*/g, '').replace(/,.*$/, '').trim();
            const lines: string[] = [
              `**${cleanName}** predaje na sljedećim studijima EFFECTUS veleučilišta:`,
              '',
            ];
            for (const [prog, courseLines] of byProgram) {
              lines.push(`**${prog}**`);
              courseLines.forEach(l => lines.push(l));
              lines.push('');
            }
            lines.push(`Izvor: https://effectus.com.hr/studijski-programi`);
            return new Response(lines.join('\n'), { status: 200, headers: PLAIN_TEXT_HEADERS });
          }
        }
        // No Supabase data → fall through to normal RAG (rare edge case)
      }
    }

    // ── Context resolver: "na tom studiju" / "za taj studij" ────────────────
    // When the user clicks a suggestion button that uses relative pronouns,
    // resolve the study program from the previous assistant message and answer.
    const studyProgramContextAnswer = resolveStudyProgramContext(userMessage.content, messages);
    if (studyProgramContextAnswer) {
      return new Response(studyProgramContextAnswer, { status: 200, headers: PLAIN_TEXT_HEADERS });
    }

    // ── Location queries: "što se studira u Biogradu / Osijeku / Zaprešiću" ──
    const locationAnswer = answerStudyLocationQuestion(userMessage.content);
    if (locationAnswer) {
      return new Response(
        appendSuggestions(locationAnswer, userMessage.content, 'studies', askedQuestions),
        { status: 200, headers: PLAIN_TEXT_HEADERS }
      );
    }

    // ── Admissions + location: "upis u Biogradu", "uvjeti upisa u Osijeku" ──
    const admissionsLocationAnswer = hardInterceptAdmissionsQuestion(userMessage.content);
    if (admissionsLocationAnswer) {
      return new Response(admissionsLocationAnswer, { status: 200, headers: PLAIN_TEXT_HEADERS });
    }

    // ── General context resolver: vague follow-ups referencing previous answer ─
    // When user says "recite mi više", "možete objasniti?", "a što s tim?" etc.,
    // extract the key entity from the previous assistant message and re-route.
    {
      const qNormCtx = normalizeText(userMessage.content);
      const isVagueFollowUp =
        isFollowUpQuestion(userMessage.content) &&
        userMessage.content.trim().split(/\s+/).length <= 8 &&
        !isTeacherIntent(userMessage.content) &&
        !isManagementIntent(userMessage.content) &&
        !isFAQIntent(userMessage.content);

      if (isVagueFollowUp) {
        const lastAssist = [...messages].reverse().find(m => m.role === 'assistant' && m.content?.trim());
        if (lastAssist) {
          // Try: was previous answer about a specific teacher?
          const prevTeacherName = extractLastMentionedTeacher(messages);
          if (prevTeacherName) {
            // Re-issue teacher profile lookup enriched with new question context
            const contextualQuery = `${prevTeacherName} ${userMessage.content}`;
            const reAnswer = findTeacherByName(contextualQuery) ?? findTeacherByName(prevTeacherName);
            if (reAnswer) {
              const enriched = await applyTeacherProfileEnrichment(reAnswer);
              return new Response(enriched, { status: 200, headers: PLAIN_TEXT_HEADERS });
            }
          }
          // Try: was previous answer about a specific management person?
          const assistCtx = extractAssistantEntityContext(lastAssist.content);
          if (assistCtx && isManagementIntent(assistCtx)) {
            const mgmtCtxAnswer = findManagementAnswer(assistCtx);
            if (mgmtCtxAnswer) {
              return new Response(
                appendSuggestions(mgmtCtxAnswer, userMessage.content, 'management', askedQuestions),
                { status: 200, headers: PLAIN_TEXT_HEADERS }
              );
            }
          }
          // Otherwise fall through to RAG — conversation history gives LLM the context
        }
      }
    }

    // ── Bare person name lookup ──────────────────────────────────────────────
    // Catches queries like "Ivana Lacković" or "Drago Ružić" (no "tko je" prefix),
    // and also "Što predaje X?" / "Tko je X?" patterns.
    // findTeacherByName uses static TEACHER_PROFILES; DB fallback covers missing teachers.
    {
      const barePersonAnswer = findTeacherByName(userMessage.content);
      if (barePersonAnswer) {
        const enriched = await applyTeacherProfileEnrichment(barePersonAnswer);
        return new Response(enriched, { status: 200, headers: PLAIN_TEXT_HEADERS });
      }
      // DB fallback: teacher exists in Supabase but is not in the static TEACHER_PROFILES list
      const qBare = normalizeText(userMessage.content);
      const isPersonLikeQuery =
        qBare.includes('tko je') || qBare.includes('ko je') ||
        qBare.includes('sto predaje') || qBare.includes('sto uci') ||
        qBare.includes('reci mi o') || qBare.includes('recite mi o') ||
        qBare.includes('nesto o') || qBare.includes('koji je') ||
        qBare.includes('koji kolegij') ||
        // Bare short query that starts with a capital letter — likely a name
        (userMessage.content.trim().split(/\s+/).length <= 4 &&
         /^[A-ZŠĐŽČĆ]/.test(userMessage.content.trim()) &&
         !qBare.includes('studij') && !qBare.includes('program') &&
         !qBare.includes('skolarin') && !qBare.includes('upis'));
      if (isPersonLikeQuery) {
        const dbAnswer = await findTeacherByNameFromDB(userMessage.content);
        if (dbAnswer) {
          return new Response(dbAnswer, { status: 200, headers: PLAIN_TEXT_HEADERS });
        }
      }
    }

    // ── Study program course/teacher listing ─────────────────────────────────
    // Catches both "koji kolegiji na studiju X?" and "koji profesori predaju
    // na smjeru X?" — both route to findStudyProgramTeachers which returns
    // ALL courses+teachers for that program (avoids RAG partial retrieval).
    {
      const qNormProg = normalizeText(userMessage.content);
      const isCoursesForProgramQuery =
        (qNormProg.includes('koji kolegij') || qNormProg.includes('koje kolegij') ||
         qNormProg.includes('kolegiji na studij') || qNormProg.includes('predmeti na studij') ||
         qNormProg.includes('koji su predmet') || qNormProg.includes('koji predmet') ||
         qNormProg.includes('nastavni plan') || qNormProg.includes('plan i program') ||
         qNormProg.includes('koje predmete') || qNormProg.includes('koji su kolegij')) &&
        (qNormProg.includes('studij') || qNormProg.includes('smjer') || qNormProg.includes('program'));

      // "koji profesori/nastavnici predaju na studiju/smjeru X?"
      const isTeachersForProgramQuery =
        (qNormProg.includes('nastavnik') || qNormProg.includes('nastavnic') ||
         qNormProg.includes('profesor') || qNormProg.includes('predavac') ||
         qNormProg.includes('nabroji') || qNormProg.includes('nabrojit') ||
         qNormProg.includes('tko predaje') || qNormProg.includes('ko predaje') ||
         qNormProg.includes('koji predaju') || qNormProg.includes('koji predaje')) &&
        (qNormProg.includes('studij') || qNormProg.includes('smjer') || qNormProg.includes('program'));

      if (isCoursesForProgramQuery || isTeachersForProgramQuery) {
        const programCoursesAnswer = findStudyProgramTeachers(userMessage.content);
        if (programCoursesAnswer) {
          return new Response(programCoursesAnswer, { status: 200, headers: PLAIN_TEXT_HEADERS });
        }
        // No match in STUDY_PROGRAM_COURSE_MAP — fall through to RAG
      }
    }

    if (isTeacherIntent(userMessage.content) || lastAssistantAskedForCourse(messages)) {
      // If the question mentions a specific study program + professor/teacher, route to
      // findStudyProgramTeachers (full list) rather than showing the clarification menu.
      // This handles "koji profesori predaju na studiju X?" which triggers isTeacherIntent
      // (contains "profesor") but is really a program-level query, not a single person query.
      {
        const qInner = normalizeText(userMessage.content);
        const looksLikeProgramTeachersQuery =
          (qInner.includes('studij') || qInner.includes('smjer') || qInner.includes('program')) &&
          (qInner.includes('tko predaje') || qInner.includes('ko predaje') ||
           qInner.includes('koji predaju') || qInner.includes('koji predaje') ||
           qInner.includes('nabroji') || qInner.includes('nabrojit') ||
           qInner.includes('nastavnik') || qInner.includes('nastavnic') ||
           qInner.includes('profesor'));
        if (looksLikeProgramTeachersQuery) {
          const progAnswer = findStudyProgramTeachers(userMessage.content);
          if (progAnswer) return new Response(progAnswer, { status: 200, headers: PLAIN_TEXT_HEADERS });
        }
      }

      const teacherAnswer = findTeachersForCourse(userMessage.content);
      if (teacherAnswer) {
        // Study program answers already embed context-aware suggestions — don't append more.
        // Single-course answers don't include suggestions so appendSuggestions adds them.
        const finalAnswer = teacherAnswer.includes('Mogu vam pomoći i s:')
          ? teacherAnswer
          : appendSuggestions(teacherAnswer, userMessage.content, 'teacher', askedQuestions);
        return new Response(finalAnswer, { status: 200, headers: PLAIN_TEXT_HEADERS });
      }
      // Try reverse lookup: maybe the user typed a teacher's name directly ("tko je X", etc.)
      const teacherProfileAnswer = findTeacherByName(userMessage.content);
      if (teacherProfileAnswer) {
        const enriched = await applyTeacherProfileEnrichment(teacherProfileAnswer);
        return new Response(enriched, { status: 200, headers: PLAIN_TEXT_HEADERS });
      }

      // DB fallback: teacher is not in static TEACHER_PROFILES but may be in Supabase
      {
        const dbTeacherAnswer = await findTeacherByNameFromDB(userMessage.content);
        if (dbTeacherAnswer) {
          return new Response(dbTeacherAnswer, { status: 200, headers: PLAIN_TEXT_HEADERS });
        }
      }

      // No course, no teacher profile — try management (study directors, etc.)
      // This catches "tko je Bajza", "tko je Ninoslav", etc. where the person is in
      // STUDY_DIRECTORS but not in TEACHER_PROFILES.
      if (isManagementIntent(userMessage.content)) {
        const mgmtFallback = findManagementAnswer(userMessage.content);
        if (mgmtFallback) {
          const llmPersonAnswer = await streamManagementPersonAnswer(
            mgmtFallback,
            userMessage.content,
            recentConversation
          );
          if (llmPersonAnswer) {
            return new Response(llmPersonAnswer, { status: 200, headers: PLAIN_TEXT_HEADERS });
          }
          return new Response(
            appendSuggestions(mgmtFallback, userMessage.content, 'management', askedQuestions),
            { status: 200, headers: PLAIN_TEXT_HEADERS }
          );
        }
      }

      // No course, no program, no matching teacher name.
      // If the question already names a specific known study program → skip clarification
      // and fall through to RAG which has full course/teacher data from predmeti scrape.
      {
        const allStudyNames = [
          ...STUDY_STRUCTURE.zapresic.undergraduateOnlineStudies.map(s => s.name),
          ...STUDY_STRUCTURE.zapresic.graduateOnlineStudies.map(s => s.name),
          ...STUDY_STRUCTURE.zapresic.shortOnlineStudies.map(s => s.name),
          ...STUDY_STRUCTURE.biograd.classicalStudies.map(s => s.name),
        ];
        const uniqueNames = Array.from(new Set(allStudyNames));
        const qNorm = normalizeText(userMessage.content);

        // If question already contains a specific program name → let RAG answer it
        const namedProgram = uniqueNames.find(name => {
          const n = normalizeText(name);
          // Match all words ≥4 chars from the program name
          const words = n.split(/\s+/).filter(w => w.length >= 4 && !['studij','online','klasicno'].includes(w));
          return words.length > 0 && words.every(w => qNorm.includes(w));
        });
        if (namedProgram) {
          // Fall through to RAG — do nothing here, execution continues past this if-block
        } else {

        // If the query looks like a specific named-person lookup ("tko je X", "ko je X",
        // or a 2-3 word bare name) let RAG try — nastavnici DB may have the bio even if
        // the person is not in our hardcoded TEACHER_PROFILES list.
        const qNormFallback = normalizeText(userMessage.content);
        const isSpecificPersonQuery =
          qNormFallback.includes('tko je') ||
          qNormFallback.includes('ko je') ||
          qNormFallback.includes('reci mi o') ||
          qNormFallback.includes('recite mi o') ||
          qNormFallback.includes('nesto o') ||
          // bare 2-3 word query that looks like "Ime Prezime" (no verb/question words)
          (userMessage.content.trim().split(/\s+/).length <= 3 &&
           /^[A-ZŠĐŽČĆ]/.test(userMessage.content.trim()));

        if (isSpecificPersonQuery) {
          // Skip clarification — fall through to RAG which has nastavnici scraped bios
        } else {

        // Truly vague question (no name, no program) — show clarification with study list
        const teacherClarification = [
          'Nastavnici EFFECTUS veleučilišta predaju na raznim studijima i kolegijima. Odaberite što vas zanima:',
          '',
          '• Za nastavnike na **određenom studiju** — kliknite na studij ispod',
          '• Za nastavnike koji predaju **određeni kolegij** — upišite npr. „Tko predaje Marketing?"',
          '• Za **konkretnog nastavnika** — upišite njegovo ime i prezime',
          '',
          'Mogu vam pomoći i s:',
          ...uniqueNames.map((name, i) => `${i + 1}. Koji su nastavnici na studiju ${name}?`),
        ].join('\n');

          return new Response(teacherClarification, { status: 200, headers: PLAIN_TEXT_HEADERS });
        }
        }
      }
    }

    // Management intent: dekan, prodekan, uprava, dosadašnji dekani, voditelji studija
    if (isManagementIntent(userMessage.content)) {
      const managementAnswer = findManagementAnswer(userMessage.content);
      if (managementAnswer) {
        // For personal profiles (card has 📧/📞), enrich via LLM with nastavnici DB bio
        const llmPersonAnswer = await streamManagementPersonAnswer(
          managementAnswer,
          userMessage.content,
          recentConversation
        );
        if (llmPersonAnswer) {
          return new Response(llmPersonAnswer, { status: 200, headers: PLAIN_TEXT_HEADERS });
        }
        // Fallback: generic list/management answers returned directly
        return new Response(
          appendSuggestions(managementAnswer, userMessage.content, 'management', askedQuestions),
          { status: 200, headers: PLAIN_TEXT_HEADERS }
        );
      }
    }

    // FAQ knowledge base — najčešća pitanja studenata (akademska godina, ispiti,
    // stručna praksa, zdravstveno osiguranje, apsolventska godina, zamolbe itd.)
    if (isFAQIntent(userMessage.content)) {
      const faqAnswer = findFAQAnswer(userMessage.content);
      if (faqAnswer) {
        const faqQ = normalizeText(userMessage.content);
        const faqTopic: SuggestionTopic =
          faqQ.includes('erasmus') ? 'erasmus'
          : (faqQ.includes('medunarod') || faqQ.includes('mobilnost') || faqQ.includes('razmjena') || faqQ.includes('suradnj')) ? 'international'
          : 'general';
        return new Response(
          appendSuggestions(faqAnswer, userMessage.content, faqTopic, askedQuestions),
          { status: 200, headers: PLAIN_TEXT_HEADERS }
        );
      }
    }

    // Referada intent: radno vrijeme, završni radovi, ispitni rokovi, zamolbe
    if (isReferadaIntent(userMessage.content)) {
      const referadaAnswer = formatReferadaAnswer(userMessage.content);
      if (referadaAnswer) {
        return new Response(
          appendSuggestions(referadaAnswer, userMessage.content, 'referada', askedQuestions),
          { status: 200, headers: PLAIN_TEXT_HEADERS }
        );
      }
    }

    // Quick-tab prompts bypass hardcoded study formatters — they use the RAG pipeline.
    const studyAnswer = isQuickTabPrompt
      ? null
      : (formatStudyAdmissionsAnswer(userMessage.content) ??
         formatCjelozivotnoAnswer(userMessage.content) ??
         formatStudyLocationAnswer(userMessage.content) ??
         formatStudySupportAnswer(userMessage.content));

    if (studyAnswer) {
      // Guard: some studies.ts formatters already embed a "Mogu vam pomoći" block.
      // Only append if not present to avoid duplicate suggestion blocks.
      const withSuggestions = studyAnswer.includes('Mogu vam pomoći')
        ? studyAnswer
        : appendSuggestions(studyAnswer, userMessage.content, 'studies', askedQuestions);
      return new Response(withSuggestions, {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    // ── Expired cjeloživotno program intercept ───────────────────────────────
    // When a user asks about a specific program whose last known cycle has ended,
    // return a "cycle ended" message instead of letting RAG serve stale dated content.
    // This fires even when the question has no "tečaj/cjeloživotno" keyword (e.g.
    // user clicked "Osnove računovodstva za početnike" from the suggestion list).
    {
      const expiredAnswer = formatExpiredCjelozivotnoAnswer(userMessage.content);
      if (expiredAnswer) {
        return new Response(expiredAnswer, { status: 200, headers: PLAIN_TEXT_HEADERS });
      }
    }

    // Quick-tab prompts skip clarification — they go straight to RAG.
    const forcedClarification = !isQuickTabPrompt && shouldForceClarification(userMessage.content);
    if (forcedClarification) {
      return new Response(forcedClarification, {
        status: 200,
        headers: NO_CACHE_HEADERS,
      });
    }

    const resolved = await resolveQuestion(messages, userMessage.content);
    const keywordHints = extractKeywordHints(resolved.retrievalQuery);
    const factSeeking = isFactSeekingQuestion(userMessage.content);

    if (DEBUG_RAG) {
      console.log('\n==================================================');
      console.log(`PITANJE: ${userMessage.content}`);
      console.log(`FOLLOW_UP: ${resolved.isFollowUp}`);
      console.log(`FACT_SEEKING: ${factSeeking}`);
      console.log(`REQUESTED_SECTION_TYPE: ${resolved.requestedSectionType ?? '(nema)'}`);
      console.log(`CONTENT_GROUP: ${resolved.contentGroup}`);
      console.log(`PREFERRED_URL: ${resolved.preferredUrl ?? '(nema)'}`);
      console.log(`RESOLVED_ENTITY_NAME: ${resolved.resolvedEntityName ?? '(nema)'}`);
      console.log(`KEYWORD_HINTS: ${keywordHints.length ? keywordHints.join(', ') : '(nema)'}`);
      console.log(`RETRIEVAL_QUERY: ${resolved.retrievalQuery}`);
      console.log(`MIN_SIMILARITY: ${RAG_CONFIG.minSimilarity}`);
    }

    let exactEntitySectionChunks: RetrievedChunk[] = [];
    let exactEntityChunks: RetrievedChunk[] = [];
    let preferredUrlChunks: RetrievedChunk[] = [];

    if (resolved.resolvedEntityName && resolved.requestedSectionType) {
      exactEntitySectionChunks = await retrieveExactEntitySectionChunks(
        resolved.resolvedEntityName,
        resolved.requestedSectionType,
        resolved.contentGroup
      );
    }

    if (resolved.resolvedEntityName) {
      exactEntityChunks = await retrieveExactEntityChunks(
        resolved.resolvedEntityName,
        resolved.requestedSectionType,
        resolved.contentGroup
      );
    }

    if (resolved.preferredUrl) {
      preferredUrlChunks = await retrievePreferredUrlChunks(
        resolved.preferredUrl,
        resolved.contentGroup
      );
    }

    // For "uvjeti upisa" questions, force-include FAQ chunks from /upisi/cesta-pitanja/.
    // Semantic retrieval often matches navigation sidebar chunks instead of actual FAQ content
    // because the sidebar contains "Uvjeti upisa" as a menu item with high cosine similarity.
    // Force-include FAQ chunks from /upisi/cesta-pitanja for all "uvjeti upisa" questions
    // regardless of preferredUrl — the preferredUrl may be a navigation sidebar page
    // (e.g. effectus.com.hr/upisi) from a previous answer, which contains no actual conditions.
    // cesta-pitanja is the only page with the actual FAQ admission conditions text.
    let forcedUvjetiChunks: RetrievedChunk[] = [];
    if (
      resolved.contentGroup === 'upisi' &&
      (resolved.requestedSectionType === 'uvjeti' || resolved.requestedSectionType === 'upis') &&
      !resolved.resolvedEntityName
    ) {
      forcedUvjetiChunks = await retrieveChunksByExactUrls(
        ['https://effectus.com.hr/upisi/cesta-pitanja'],
        5
      );
    }

    // Force-retrieve Erasmus+ page chunks for any Erasmus-related question.
    // The semantic search often misses relevant content for follow-up Erasmus queries
    // ("Kako se prijaviti?", "Koji je proces odabira?") because those specific terms
    // don't have high cosine similarity to the scraped Erasmus page chunks.
    const normalizedUserQuestion = normalizeText(userMessage.content);
    const isErasmusQuery = /erasmus|međunarodna razmjena|medunarodni program|studij u inozemstvu|mobilnost studenata/i.test(userMessage.content);
    let forcedErasmusChunks: RetrievedChunk[] = [];
    if (isErasmusQuery) {
      forcedErasmusChunks = await retrieveChunksByExactUrls(
        [
          'https://effectus.com.hr/medunarodna-suradnja/erasmus-study',
          'https://effectus.com.hr/medunarodna-suradnja/erasmus-teach',
          'https://effectus.com.hr/medunarodna-suradnja',
        ],
        4
      );
    }
    const isStudyQuestion =
      /studij|studiji|studirati|program|programi|prijediplomski|diplomski/.test(normalizedUserQuestion);

    const detectedStudyLocation = detectStudyLocation(userMessage.content);

    const forcedStudyUrls =
      isStudyQuestion && detectedStudyLocation
        ? await retrieveStudyUrlsByLocation(detectedStudyLocation)
        : [];

    const forcedStudyChunks =
      forcedStudyUrls.length > 0
        ? await retrieveChunksByExactUrls(forcedStudyUrls)
        : [];

    let [rawSemanticChunks, keywordChunks] = await Promise.all([
      retrieveSemanticChunks(
        resolved.retrievalQuery,
        resolved.contentGroup,
        resolved.preferredUrl,
        RAG_CONFIG.semanticCandidatePool
      ),
      retrieveKeywordChunks(
        resolved.retrievalQuery,
        resolved.contentGroup,
        resolved.preferredUrl,
        RAG_CONFIG.maxKeywordChunks
      ),
    ]);

    if (!rawSemanticChunks.length && resolved.preferredUrl) {
      rawSemanticChunks = await retrieveSemanticChunks(
        resolved.retrievalQuery,
        resolved.contentGroup,
        null,
        RAG_CONFIG.semanticCandidatePool
      );
    }

    if (!keywordChunks.length && resolved.preferredUrl) {
      keywordChunks = await retrieveKeywordChunks(
        resolved.retrievalQuery,
        resolved.contentGroup,
        null,
        RAG_CONFIG.maxKeywordChunks
      );
    }

    const semanticChunks = filterRelevantChunks(rawSemanticChunks);

    const mergedChunks = mergeChunks(
      // Forced chunks (uvjeti FAQ + erasmus pages) are prepended so they get
      // boosted similarity (0.92) and always appear in the final context set.
      [...exactEntitySectionChunks, ...forcedUvjetiChunks, ...forcedErasmusChunks],
      exactEntityChunks,
      preferredUrlChunks,
      semanticChunks,
      keywordChunks,
      resolved.requestedSectionType,
      resolved.contentGroup
    );

    const chunks =
      forcedStudyChunks.length > 0
        ? forcedStudyChunks
        : mergedChunks;

    logChunks('EXACT ENTITY + SECTION', exactEntitySectionChunks);
    logChunks('EXACT ENTITY', exactEntityChunks);
    logChunks('PREFERRED URL', preferredUrlChunks);
    logChunks('RAW SEMANTIC CHUNKS', rawSemanticChunks);
    logChunks('FILTERED SEMANTIC CHUNKS', semanticChunks);
    logChunks('KEYWORD CHUNKS', keywordChunks);
    logChunks('FINAL CHUNKS', chunks);

    if (chunks.length < RAG_CONFIG.minGoodChunks) {
      if (DEBUG_RAG) console.log('ODLUKA: STRICT_FALLBACK (nema dovoljno dobrih chunkova)');
      // For quick-tab prompts, try structured fallback before strict fallback.
      if (isQuickTabPrompt) {
        const fallback =
          formatStudyAdmissionsAnswer(userMessage.content) ??
          formatCjelozivotnoAnswer(userMessage.content) ??
          formatStudySupportAnswer(userMessage.content);
        if (fallback) return new Response(fallback, { status: 200, headers: PLAIN_TEXT_HEADERS });
      }
      return new Response(STRICT_FALLBACK, { status: 200, headers: PLAIN_TEXT_HEADERS });
    }

    let answerChunks = chunks;

    // For general "uvjeti upisa" questions (no specific program/entity), restrict the
    // context to only /upisi/cesta-pitanja FAQ chunks. This prevents navigation sidebar
    // chunks (which semantically match "uvjeti upisa" navigation links) from polluting
    // the context and causing incorrect or irrelevant answers.
    // For general "uvjeti upisa" questions restrict context to FAQ content only.
    // preferredUrl guard is intentionally removed — the previous answer's URL may be
    // the navigation sidebar page (effectus.com.hr/upisi) which contains no actual conditions.
    if (
      resolved.contentGroup === 'upisi' &&
      resolved.requestedSectionType === 'uvjeti' &&
      !resolved.resolvedEntityName
    ) {
      const faqOnly = answerChunks.filter(c => c.url?.includes('/upisi/cesta-pitanja'));
      if (faqOnly.length >= 1) {
        if (DEBUG_RAG) console.log(`UVJETI_FAQ_LOCK: ${faqOnly.length} chunk(ova) iz /upisi/cesta-pitanja`);
        answerChunks = faqOnly;
      }
    }

    if (resolved.resolvedEntityName && isStrictEntitySection(resolved.requestedSectionType)) {
      const locked = lockChunksToResolvedEntity(
        chunks,
        resolved.resolvedEntityName,
        resolved.preferredUrl
      );

      if (DEBUG_RAG) {
        console.log(`ENTITY_LOCK_ACTIVE: ${resolved.resolvedEntityName}`);
        console.log(`ENTITY_LOCKED_CHUNKS: ${locked.length}`);
      }

      answerChunks = locked;

      if (!answerChunks.length) {
        if (DEBUG_RAG) console.log('ODLUKA: STRICT_FALLBACK (entity lock nema odgovarajućih chunkova)');
        return new Response(STRICT_FALLBACK, { status: 200, headers: NO_CACHE_HEADERS });
      }
    }

    const factFirstAnswer = extractFactFirstAnswer(
      userMessage.content,
      answerChunks,
      resolved
    );

    if (factFirstAnswer) {
      if (DEBUG_RAG) console.log(`FACT_FIRST_ODGOVOR: ${factFirstAnswer}`);
      return new Response(factFirstAnswer, { status: 200, headers: NO_CACHE_HEADERS });
    }

    if (resolved.resolvedEntityName && isStrictEntitySection(resolved.requestedSectionType)) {
      const hasMatchingSection = answerChunks.some(
        (c) =>
          c.entity_name === resolved.resolvedEntityName &&
          (
            c.section_type === resolved.requestedSectionType ||
            (
              resolved.requestedSectionType === 'cijena' &&
              /€|eur|pdv|cijena|iznosi|popust|jednokratno plaćanje|jednokratno placanje|u cijenu je uključeno|u cijenu je ukljuceno/i.test(c.content)
            ) ||
            (
              resolved.requestedSectionType === 'trajanje' &&
              /traje|trajanje|u trajanju|školskih sati|skolskih sati|godina studija/i.test(c.content)
            ) ||
            (
              resolved.requestedSectionType === 'uvjeti' &&
              /uvjeti|najmanje srednja|državljanstvo|poslovna sposobnost|preduvjeti/i.test(c.content)
            ) ||
            (
              resolved.requestedSectionType === 'kontakt' &&
              /@|telefon|kontakt/i.test(c.content)
            ) ||
            (
              resolved.requestedSectionType === 'termini' &&
              /početak|pocetak|termin|rok|veljača|veljaca|siječanj|sijecanj/i.test(c.content)
            )
          )
      );

      if (!hasMatchingSection) {
        if (DEBUG_RAG) console.log('ODLUKA: STRICT_FALLBACK (entity lock nema matching sekciju)');
        return new Response(STRICT_FALLBACK, { status: 200, headers: NO_CACHE_HEADERS });
      }
    }

    const context = buildStrictContext(answerChunks);
    const sourceUrls = dedupeSources(answerChunks);
    const systemPrompt = buildSystemPrompt(
      userMessage.content,
      resolved,
      context,
      sourceUrls
    );

    const conversationHistoryForModel = recentConversation.slice(0, -1);
    const completionMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...conversationHistoryForModel,
      { role: 'user', content: userMessage.content },
    ];

    const stream = await streamChat(completionMessages);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
    }
    fullText += decoder.decode();

    if (DEBUG_RAG) console.log(`MODEL_ODGOVOR: ${fullText}`);

    if (shouldForceFallback(fullText)) {
      if (DEBUG_RAG) console.log('ODLUKA: FORCE_STRICT_FALLBACK (model je vratio fallback)');
      return new Response(STRICT_FALLBACK, { status: 200, headers: NO_CACHE_HEADERS });
    }

    // Determine topic-aware suggestions for this question.
    const ragQ = normalizeText(userMessage.content);
    const ragTopic: SuggestionTopic =
      ragQ.includes('erasmus') ? 'erasmus'
      : (ragQ.includes('medunarod') || ragQ.includes('mobilnost') || ragQ.includes('razmjena student') || ragQ.includes('suradnj')) ? 'international'
      : 'general';

    // For topic-specific questions (erasmus, international) always replace
    // Claude's generic suggestions with our context-aware ones. For general
    // questions fall back to Claude's own suggestions if present.
    // Strip using a flexible regex to catch \n and \n\n variants.
    const stripSuggestions = (text: string) => {
      const idx = text.search(/\n+Mogu vam pomoći/);
      return idx >= 0 ? text.slice(0, idx) : text;
    };
    let finalText: string;
    if (ragTopic !== 'general') {
      finalText = appendSuggestions(stripSuggestions(fullText), userMessage.content, ragTopic, askedQuestions);
    } else {
      const hasSuggestions = fullText.includes('Mogu vam pomoći');
      finalText = hasSuggestions
        ? fullText
        : appendSuggestions(fullText, userMessage.content, ragTopic, askedQuestions);
    }

    return new Response(finalText, { status: 200, headers: NO_CACHE_HEADERS });
  } catch (error) {
    console.error('Greška u /api/chat:', error);
    return new Response(STRICT_FALLBACK, { status: 500, headers: PLAIN_TEXT_HEADERS });
  }
}
