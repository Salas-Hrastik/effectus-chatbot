import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";

type StudyInput = {
  slug?: string;
  titleHr?: string;
  titleEn?: string;
  canonicalUrl?: string;
  hrUrl?: string;
  enUrl?: string;
  level?: string;
  mode?: string;
  location?: string;
  durationYears?: number | null;
  ects?: number | null;
  descriptionHr?: string;
  descriptionEn?: string;
  relatedLinks?: Array<{ text?: string; url?: string }>;
  rawTitles?: string[];
};

type AcademicSourceInput = {
  title?: string;
  url?: string;
  type?: string;
  category?: string;
};

type SourceType =
  | "homepage"
  | "admissions"
  | "tuition"
  | "study_page"
  | "curriculum_pdf"
  | "course_catalogue_pdf"
  | "schedule"
  | "exam_dates"
  | "policy"
  | "student_procedure"
  | "faculty_page"
  | "shared_academic"
  | "other_pdf"
  | "other_html";

type ClassifiedSource = {
  url: string;
  title: string;
  sourceType: SourceType;
  format: "html" | "pdf";
  studyMatch?: string | null;
  studyScore?: number;
  language: "hr" | "en" | "unknown";
  deliveryMode: string[];
  tags: string[];
};

type StudySourceBucket = {
  study: string;
  slug: string;
  language: string[];
  delivery_mode: string[];
  location: string[];
  sources: {
    study_page_hr: string | null;
    study_page_en: string | null;
    curriculum_pdfs: string[];
    course_catalogues: string[];
    schedules: string[];
    exam_dates: string[];
    practice_info: string[];
    final_thesis_info: string[];
    faculty_pages: string[];
    policies: string[];
    other_sources: string[];
  };
};

type SourceMap = {
  institution: {
    name: string;
    sources: {
      homepage: string | null;
      admissions: string | null;
      tuition: string | null;
      student_services: string[];
      policies: string[];
      general_academic_documents: string[];
    };
  };
  studies: StudySourceBucket[];
  faculty_sources: string[];
  shared_academic_sources: string[];
  crawl_meta: {
    generated_at: string;
    crawled_pages: number;
    discovered_urls: number;
    max_pages: number;
    domain: string;
  };
};

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const STUDIES_FILE = path.join(DATA_DIR, "baltazar_studies_clean.json");
const ACADEMIC_SOURCES_FILE = path.join(DATA_DIR, "baltazar_academic_sources.json");
const OUTPUT_FILE = path.join(DATA_DIR, "baltazar_source_map.json");

const DOMAIN = "www.bak.hr";
const BASE_URL = "https://www.bak.hr";
const MAX_PAGES = 260;
const REQUEST_TIMEOUT_MS = 20000;

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch (err) {
    console.warn(`⚠️ Ne mogu učitati JSON: ${filePath}`, err);
    return fallback;
  }
}

function writeJson(filePath: string, data: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function normalizeWhitespace(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

function stripAccents(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function slugify(input: string): string {
  return stripAccents(input)
    .toLowerCase()
    .replace(/&/g, " i ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ensureArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((x) => String(x)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function safeUrl(input: string, base: string = BASE_URL): string | null {
  try {
    const u = new URL(input, base);
    u.hash = "";
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function isInternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === DOMAIN;
  } catch {
    return false;
  }
}

function isPdfUrl(url: string): boolean {
  return /\.pdf($|\?)/i.test(url);
}

function detectLanguage(text: string, url: string): "hr" | "en" | "unknown" {
  const t = `${text} ${url}`.toLowerCase();

  const hrHits = [
    "studij",
    "upisi",
    "školarina",
    "skolarina",
    "veleučilište",
    "veleuciliste",
    "raspored",
    "ispitni rokovi",
    "pravilnik",
    "završni rad",
    "zavrsni rad",
    "stručna praksa",
    "strucna praksa",
    "nastavnik",
    "kolegij",
    "izvedbeni plan",
  ].filter((x) => t.includes(x)).length;

  const enHits = [
    "study programme",
    "course",
    "tuition",
    "admissions",
    "schedule",
    "exam dates",
    "course catalogue",
    "faculty",
    "learning outcomes",
    "general information",
    "ects",
  ].filter((x) => t.includes(x)).length;

  if (enHits > hrHits) return "en";
  if (hrHits > enHits) return "hr";
  if (/\/en\/|english/i.test(url)) return "en";
  return "unknown";
}

function extractTextFromHtml(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  return normalizeWhitespace($("body").text());
}

function getTitleFromHtml(html: string): string {
  const $ = cheerio.load(html);
  const title =
    $("title").first().text() ||
    $("h1").first().text() ||
    $('meta[property="og:title"]').attr("content") ||
    "";
  return normalizeWhitespace(title);
}

function extractLinks(html: string, currentUrl: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const abs = safeUrl(href, currentUrl);
    if (!abs) return;
    if (!isInternalUrl(abs)) return;
    links.add(abs);
  });

  return [...links];
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; BaltazarAcademicBot/2.0)",
        accept: "text/html,application/pdf;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function loadStudies(): StudyInput[] {
  const raw = readJsonSafe<unknown[]>(STUDIES_FILE, []);
  return raw.map((item) => (typeof item === "object" && item ? (item as StudyInput) : {}));
}

function loadAcademicSources(): AcademicSourceInput[] {
  const raw = readJsonSafe<unknown[]>(ACADEMIC_SOURCES_FILE, []);
  return raw.map((item) =>
    typeof item === "object" && item ? (item as AcademicSourceInput) : {}
  );
}

function pickStudyName(s: StudyInput): string {
  return normalizeWhitespace(
    s.titleHr || s.titleEn || s.slug || "Nepoznati studij"
  );
}

function studyLanguages(s: StudyInput): string[] {
  const langs: string[] = [];
  if (s.hrUrl || s.titleHr || s.descriptionHr) langs.push("hr");
  if (s.enUrl || s.titleEn || s.descriptionEn) langs.push("en");
  return [...new Set(langs)];
}

function studyDeliveryModes(s: StudyInput): string[] {
  const raw = (s.mode || "").toLowerCase();
  if (!raw) return [];
  if (raw === "classical") return ["onsite"];
  if (raw === "online") return ["online"];
  return [raw];
}

function studyLocations(s: StudyInput): string[] {
  return ensureArray(s.location);
}

function buildStudyKeywords(s: StudyInput): string[] {
  const pieces = [
    s.titleHr || "",
    s.titleEn || "",
    s.slug || "",
    s.descriptionHr || "",
    s.descriptionEn || "",
  ]
    .join(" ")
    .toLowerCase();

  const cleaned = stripAccents(pieces);
  const words = cleaned
    .split(/[^a-z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4);

  const extras: string[] = [];

  if (cleaned.includes("turiz")) extras.push("turizam", "tourism", "ugostiteljstvo", "hospitality");
  if (cleaned.includes("menadz")) extras.push("management", "menadzment");
  if (cleaned.includes("informat")) extras.push("informatics", "business informatics");
  if (cleaned.includes("financ")) extras.push("finance", "financije");
  if (cleaned.includes("projekt")) extras.push("project", "project management", "projekti");
  if (cleaned.includes("poduzet")) extras.push("entrepreneurship", "poduzetnistvo");

  return [...new Set(words.concat(extras))];
}

function classifySourceType(url: string, title: string, text: string, format: "html" | "pdf"): SourceType {
  const hay = `${url} ${title} ${text}`.toLowerCase();

  if (url === `${BASE_URL}/` || url === BASE_URL) return "homepage";

  if (
    hay.includes("/upisi") ||
    /\badmissions?\b/.test(hay) ||
    /\bupis/i.test(hay)
  ) {
    return "admissions";
  }

  if (
    /\bskolarin|\bškolarin|\btuition\b/.test(hay)
  ) {
    return "tuition";
  }

  if (
    /\braspored\b|\bschedule\b/.test(hay)
  ) {
    return "schedule";
  }

  if (
    /\bispitni rok|\bexam dates\b|\bexams?\b/.test(hay)
  ) {
    return "exam_dates";
  }

  if (
    /\bpravilnik\b|\bregulation\b|\brules?\b|\bstatut\b|\bpolicy\b/.test(hay)
  ) {
    return "policy";
  }

  if (
    /\bstrucna praksa\b|\bstručna praksa\b|\bpractice\b|\binternship\b/.test(hay) ||
    /\bzavrsni rad\b|\bzavršni rad\b|\bfinal thesis\b|\bthesis\b/.test(hay)
  ) {
    return "student_procedure";
  }

  if (
    /\bcourse catalogue\b|\bgeneral information\b|\blearning outcomes\b/.test(hay)
  ) {
    return "course_catalogue_pdf";
  }

  if (
    /\bizvedbeni plan\b|\bcurriculum\b|\bkurikulum\b/.test(hay) &&
    format === "pdf"
  ) {
    return "curriculum_pdf";
  }

  if (
    /\bnastavnici\b|\bteachers\b|\bfaculty\b|\bprofesor\b|\bprof\.?\b|\bpredavac\b|\bpredavač\b|\bconsultation\b|\bkonzultacije\b/.test(hay)
  ) {
    return "faculty_page";
  }

  if (
    (url.includes("/studijski-programi/") || url.includes("/en/studijski-programi/")) &&
    format === "html"
  ) {
    return "study_page";
  }

  if (format === "pdf") return "other_pdf";
  return "other_html";
}

function detectDeliveryMode(text: string, url: string): string[] {
  const hay = `${text} ${url}`.toLowerCase();
  const result = new Set<string>();

  if (/\bonline\b/.test(hay)) result.add("online");
  if (/\bclassical\b|\bonsite\b|\bu biogradu\b|\bu osijeku\b|\bu zapresicu\b|\bu zaprešiću\b/.test(hay)) {
    result.add("onsite");
  }

  return [...result];
}

function scoreStudyMatch(url: string, title: string, text: string, study: StudyInput): number {
  const hay = stripAccents(`${url} ${title} ${text}`.toLowerCase());
  const studyName = stripAccents(pickStudyName(study).toLowerCase());
  const keywords = buildStudyKeywords(study);

  let score = 0;

  if (hay.includes(studyName)) score += 10;

  if (study.slug && hay.includes(stripAccents(study.slug.toLowerCase()))) score += 12;
  if (study.hrUrl && url === study.hrUrl) score += 25;
  if (study.enUrl && url === study.enUrl) score += 25;
  if (study.canonicalUrl && url === study.canonicalUrl) score += 25;

  for (const kw of keywords) {
    if (kw.length < 4) continue;
    if (hay.includes(kw)) score += 2;
  }

  const location = stripAccents((study.location || "").toLowerCase());
  if (location && hay.includes(location)) score += 2;

  return score;
}

function detectBestStudyMatch(
  url: string,
  title: string,
  text: string,
  studies: StudyInput[]
): { study: string | null; score: number } {
  let bestStudy: string | null = null;
  let bestScore = 0;

  for (const s of studies) {
    const score = scoreStudyMatch(url, title, text, s);
    if (score > bestScore) {
      bestScore = score;
      bestStudy = pickStudyName(s);
    }
  }

  if (bestScore < 8) return { study: null, score: bestScore };
  return { study: bestStudy, score: bestScore };
}

function uniquePush(arr: string[], value: string | null | undefined) {
  if (!value) return;
  if (!arr.includes(value)) arr.push(value);
}

function buildEmptyStudyBucket(study: StudyInput): StudySourceBucket {
  const studyName = pickStudyName(study);

  const bucket: StudySourceBucket = {
    study: studyName,
    slug: study.slug || slugify(studyName),
    language: studyLanguages(study),
    delivery_mode: studyDeliveryModes(study),
    location: studyLocations(study),
    sources: {
      study_page_hr: study.hrUrl || study.canonicalUrl || null,
      study_page_en: study.enUrl || null,
      curriculum_pdfs: [],
      course_catalogues: [],
      schedules: [],
      exam_dates: [],
      practice_info: [],
      final_thesis_info: [],
      faculty_pages: [],
      policies: [],
      other_sources: [],
    },
  };

  for (const rel of study.relatedLinks || []) {
    const u = rel?.url ? safeUrl(rel.url) : null;
    if (!u) continue;
    const txt = normalizeWhitespace((rel.text || "") + " " + u).toLowerCase();

    if (/course catalogue|general information/.test(txt)) {
      uniquePush(bucket.sources.course_catalogues, u);
    } else if (/curriculum|kurikulum|izvedbeni plan/.test(txt)) {
      uniquePush(bucket.sources.curriculum_pdfs, u);
    } else {
      uniquePush(bucket.sources.other_sources, u);
    }
  }

  return bucket;
}

function assignSourceToStudyBucket(bucket: StudySourceBucket, src: ClassifiedSource) {
  switch (src.sourceType) {
    case "study_page":
      if (src.language === "en") {
        bucket.sources.study_page_en = bucket.sources.study_page_en || src.url;
      } else {
        bucket.sources.study_page_hr = bucket.sources.study_page_hr || src.url;
      }
      break;
    case "curriculum_pdf":
      uniquePush(bucket.sources.curriculum_pdfs, src.url);
      break;
    case "course_catalogue_pdf":
      uniquePush(bucket.sources.course_catalogues, src.url);
      break;
    case "schedule":
      uniquePush(bucket.sources.schedules, src.url);
      break;
    case "exam_dates":
      uniquePush(bucket.sources.exam_dates, src.url);
      break;
    case "faculty_page":
      uniquePush(bucket.sources.faculty_pages, src.url);
      break;
    case "policy":
      uniquePush(bucket.sources.policies, src.url);
      break;
    case "student_procedure": {
      const hay = `${src.title} ${src.url}`.toLowerCase();
      if (/praksa|practice|internship/.test(hay)) {
        uniquePush(bucket.sources.practice_info, src.url);
      } else if (/zavrsni rad|završni rad|thesis/.test(hay)) {
        uniquePush(bucket.sources.final_thesis_info, src.url);
      } else {
        uniquePush(bucket.sources.other_sources, src.url);
      }
      break;
    }
    default:
      uniquePush(bucket.sources.other_sources, src.url);
      break;
  }
}

function shouldKeepUrl(url: string): boolean {
  if (!isInternalUrl(url)) return false;
  const lower = url.toLowerCase();

  if (
    lower.includes("/wp-content/uploads/") ||
    lower.includes("/studijski-programi") ||
    lower.includes("/en/studijski-programi") ||
    lower.includes("/upisi") ||
    lower.includes("/student") ||
    lower.includes("/nastav") ||
    lower.includes("/faculty") ||
    lower.includes("/prof") ||
    lower.includes("/raspored") ||
    lower.includes("/ispit") ||
    lower.includes("/pravilnik") ||
    lower.includes("/dokument") ||
    lower.includes("/erasmus") ||
    lower.includes("/kontakt") ||
    lower.endsWith(".pdf")
  ) {
    return true;
  }

  return true;
}

async function crawlAndClassify(studies: StudyInput[], seeds: string[]): Promise<{ results: ClassifiedSource[]; crawledCount: number; discoveredCount: number }> {
  const queue: string[] = [];
  const visited = new Set<string>();
  const discovered = new Set<string>();
  const results: ClassifiedSource[] = [];

  for (const seed of seeds) {
    const normalized = safeUrl(seed);
    if (!normalized) continue;
    if (!isInternalUrl(normalized)) continue;
    if (!shouldKeepUrl(normalized)) continue;
    if (!discovered.has(normalized)) {
      discovered.add(normalized);
      queue.push(normalized);
    }
  }

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const currentUrl = queue.shift()!;
    if (visited.has(currentUrl)) continue;
    visited.add(currentUrl);

    console.log(`🔎 [${visited.size}/${MAX_PAGES}] ${currentUrl}`);

    try {
      const res = await fetchWithTimeout(currentUrl);
      if (!res.ok) {
        console.warn(`⚠️ HTTP ${res.status} -> ${currentUrl}`);
        continue;
      }

      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      const pdf = contentType.includes("pdf") || isPdfUrl(currentUrl);

      if (pdf) {
        const title = normalizeWhitespace(path.basename(new URL(currentUrl).pathname));
        const lang = detectLanguage(title, currentUrl);
        const match = detectBestStudyMatch(currentUrl, title, title, studies);
        const srcType = classifySourceType(currentUrl, title, title, "pdf");
        const deliveryMode = detectDeliveryMode(title, currentUrl);

        results.push({
          url: currentUrl,
          title,
          sourceType: srcType,
          format: "pdf",
          studyMatch: match.study,
          studyScore: match.score,
          language: lang,
          deliveryMode,
          tags: [srcType, "pdf"],
        });

        continue;
      }

      const html = await res.text();
      const title = getTitleFromHtml(html) || currentUrl;
      const text = extractTextFromHtml(html).slice(0, 7000);
      const lang = detectLanguage(`${title} ${text}`, currentUrl);
      const match = detectBestStudyMatch(currentUrl, title, text, studies);
      const srcType = classifySourceType(currentUrl, title, text, "html");
      const deliveryMode = detectDeliveryMode(text, currentUrl);

      results.push({
        url: currentUrl,
        title,
        sourceType: srcType,
        format: "html",
        studyMatch: match.study,
        studyScore: match.score,
        language: lang,
        deliveryMode,
        tags: [srcType, "html"],
      });

      const links = extractLinks(html, currentUrl);
      for (const link of links) {
        if (!shouldKeepUrl(link)) continue;
        if (visited.has(link)) continue;
        if (discovered.has(link)) continue;
        discovered.add(link);
        queue.push(link);
      }
    } catch (err) {
      console.warn(`⚠️ Greška pri dohvaćanju ${currentUrl}`, err);
    }
  }

  return {
    results: dedupeClassifiedSources(results),
    crawledCount: visited.size,
    discoveredCount: discovered.size,
  };
}

function dedupeClassifiedSources(items: ClassifiedSource[]): ClassifiedSource[] {
  const map = new Map<string, ClassifiedSource>();

  for (const item of items) {
    const existing = map.get(item.url);
    if (!existing) {
      map.set(item.url, item);
      continue;
    }

    const better =
      scoreSourceRichness(item) >= scoreSourceRichness(existing) ? item : existing;
    map.set(item.url, better);
  }

  return [...map.values()];
}

function scoreSourceRichness(src: ClassifiedSource): number {
  let score = 0;
  if (src.title && src.title !== src.url) score += 2;
  if (src.studyMatch) score += 2;
  if (src.sourceType !== "other_html" && src.sourceType !== "other_pdf") score += 3;
  if (src.language !== "unknown") score += 1;
  return score;
}

function buildSeeds(studies: StudyInput[], academicSources: AcademicSourceInput[]): string[] {
  const seeds = new Set<string>();

  seeds.add(BASE_URL);
  seeds.add(`${BASE_URL}/studijski-programi`);
  seeds.add(`${BASE_URL}/upisi`);

  for (const s of studies) {
    for (const u of [s.canonicalUrl, s.hrUrl, s.enUrl]) {
      const abs = u ? safeUrl(u) : null;
      if (abs && isInternalUrl(abs)) seeds.add(abs);
    }

    for (const rel of s.relatedLinks || []) {
      const abs = rel?.url ? safeUrl(rel.url) : null;
      if (abs && isInternalUrl(abs)) seeds.add(abs);
    }
  }

  for (const src of academicSources) {
    if (src.url) {
      const u = safeUrl(src.url);
      if (u && isInternalUrl(u)) seeds.add(u);
    }
  }

  return [...seeds];
}

function buildSourceMap(
  studies: StudyInput[],
  classifiedSources: ClassifiedSource[],
  crawledCount: number,
  discoveredCount: number
): SourceMap {
  const studyBuckets = studies.map(buildEmptyStudyBucket);

  const sourceMap: SourceMap = {
    institution: {
      name: "Veleučilište Baltazar Zaprešić",
      sources: {
        homepage: BASE_URL,
        admissions: `${BASE_URL}/upisi`,
        tuition: null,
        student_services: [],
        policies: [],
        general_academic_documents: [],
      },
    },
    studies: studyBuckets,
    faculty_sources: [],
    shared_academic_sources: [],
    crawl_meta: {
      generated_at: new Date().toISOString(),
      crawled_pages: crawledCount,
      discovered_urls: discoveredCount,
      max_pages: MAX_PAGES,
      domain: DOMAIN,
    },
  };

  const studyIndex = new Map<string, StudySourceBucket>();
  for (const bucket of studyBuckets) {
    studyIndex.set(bucket.study, bucket);
  }

  for (const src of classifiedSources) {
    if (src.sourceType === "homepage") {
      sourceMap.institution.sources.homepage =
        sourceMap.institution.sources.homepage || src.url;
    }

    if (src.sourceType === "admissions") {
      sourceMap.institution.sources.admissions =
        sourceMap.institution.sources.admissions || src.url;
    }

    if (src.sourceType === "tuition") {
      if (!sourceMap.institution.sources.tuition || sourceMap.institution.sources.tuition === `${BASE_URL}/en/erasmus/`) {
        sourceMap.institution.sources.tuition = src.url;
      }
    }

    if (src.sourceType === "faculty_page") {
      uniquePush(sourceMap.faculty_sources, src.url);
    }

    if (src.sourceType === "policy" && !src.studyMatch) {
      uniquePush(sourceMap.institution.sources.policies, src.url);
    }

    if (
      ["course_catalogue_pdf", "curriculum_pdf", "schedule", "exam_dates", "shared_academic"].includes(src.sourceType) &&
      !src.studyMatch
    ) {
      uniquePush(sourceMap.shared_academic_sources, src.url);
      uniquePush(sourceMap.institution.sources.general_academic_documents, src.url);
    }

    if (src.sourceType === "student_procedure" && !src.studyMatch) {
      uniquePush(sourceMap.institution.sources.student_services, src.url);
    }

    if (src.studyMatch && studyIndex.has(src.studyMatch)) {
      assignSourceToStudyBucket(studyIndex.get(src.studyMatch)!, src);
    } else {
      if (src.sourceType === "policy" || src.sourceType === "student_procedure") {
        uniquePush(sourceMap.institution.sources.student_services, src.url);
      } else if (
        src.sourceType === "course_catalogue_pdf" ||
        src.sourceType === "curriculum_pdf" ||
        src.sourceType === "schedule" ||
        src.sourceType === "exam_dates" ||
        src.sourceType === "other_pdf"
      ) {
        uniquePush(sourceMap.shared_academic_sources, src.url);
      }
    }
  }

  sourceMap.studies = sourceMap.studies.map(cleanStudyBucket);
  sourceMap.faculty_sources = [...new Set(sourceMap.faculty_sources)];
  sourceMap.shared_academic_sources = [...new Set(sourceMap.shared_academic_sources)];
  sourceMap.institution.sources.student_services = [
    ...new Set(sourceMap.institution.sources.student_services),
  ];
  sourceMap.institution.sources.policies = [
    ...new Set(sourceMap.institution.sources.policies),
  ];
  sourceMap.institution.sources.general_academic_documents = [
    ...new Set(sourceMap.institution.sources.general_academic_documents),
  ];

  return sourceMap;
}

function cleanStudyBucket(bucket: StudySourceBucket): StudySourceBucket {
  return {
    ...bucket,
    language: [...new Set(bucket.language)].filter(Boolean),
    delivery_mode: [...new Set(bucket.delivery_mode)].filter(Boolean),
    location: [...new Set(bucket.location)].filter(Boolean),
    sources: {
      study_page_hr: bucket.sources.study_page_hr,
      study_page_en: bucket.sources.study_page_en,
      curriculum_pdfs: [...new Set(bucket.sources.curriculum_pdfs)],
      course_catalogues: [...new Set(bucket.sources.course_catalogues)],
      schedules: [...new Set(bucket.sources.schedules)],
      exam_dates: [...new Set(bucket.sources.exam_dates)],
      practice_info: [...new Set(bucket.sources.practice_info)],
      final_thesis_info: [...new Set(bucket.sources.final_thesis_info)],
      faculty_pages: [...new Set(bucket.sources.faculty_pages)],
      policies: [...new Set(bucket.sources.policies)],
      other_sources: [...new Set(bucket.sources.other_sources)],
    },
  };
}

async function main() {
  console.log("======================================");
  console.log("BALTAZAR SOURCE INVENTORY BUILDER V2");
  console.log("======================================");

  const studies = loadStudies();
  const academicSources = loadAcademicSources();

  if (!studies.length) {
    throw new Error(`Nedostaju studiji u datoteci: ${STUDIES_FILE}`);
  }

  console.log(`📚 Učitano studija: ${studies.length}`);
  console.log(`📄 Učitano dodatnih akademskih izvora: ${academicSources.length}`);

  const seeds = buildSeeds(studies, academicSources);

  console.log(`🌱 Seed URL-ova: ${seeds.length}`);

  const { results, crawledCount, discoveredCount } = await crawlAndClassify(studies, seeds);
  const sourceMap = buildSourceMap(studies, results, crawledCount, discoveredCount);

  writeJson(OUTPUT_FILE, sourceMap);

  console.log("======================================");
  console.log("✅ SOURCE INVENTORY FINISHED");
  console.log(`📁 Output: ${OUTPUT_FILE}`);
  console.log(`📊 Classified sources: ${results.length}`);
  console.log(`📚 Studies in source map: ${sourceMap.studies.length}`);
  console.log(`👨‍🏫 Faculty sources: ${sourceMap.faculty_sources.length}`);
  console.log(`🧠 Shared academic sources: ${sourceMap.shared_academic_sources.length}`);
  console.log("======================================");
}

main().catch((err) => {
  console.error("❌ SOURCE INVENTORY FAILED");
  console.error(err);
  process.exit(1);
});
