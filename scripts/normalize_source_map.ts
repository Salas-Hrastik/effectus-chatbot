import fs from "fs";
import path from "path";

type StudySources = {
  study_page_hr?: string | null;
  study_page_en?: string | null;
  curriculum_pdfs?: string[];
  course_catalogues?: string[];
  schedules?: string[];
  exam_dates?: string[];
  practice_info?: string[];
  final_thesis_info?: string[];
  faculty_pages?: string[];
  policies?: string[];
  other_sources?: string[];
};

type StudyBucket = {
  study: string;
  slug?: string;
  language?: string[];
  delivery_mode?: string[];
  location?: string[];
  sources: StudySources;
};

type SourceMap = {
  institution?: {
    name?: string;
    sources?: {
      homepage?: string | null;
      admissions?: string | null;
      tuition?: string | null;
      student_services?: string[];
      policies?: string[];
      general_academic_documents?: string[];
    };
  };
  studies?: StudyBucket[];
  faculty_sources?: string[];
  shared_academic_sources?: string[];
  crawl_meta?: {
    generated_at?: string;
    crawled_pages?: number;
    discovered_urls?: number;
    max_pages?: number;
    domain?: string;
  };
};

const ROOT = process.cwd();
const INPUT_FILE = path.join(ROOT, "data", "baltazar_source_map.json");
const OUTPUT_FILE = path.join(ROOT, "data", "baltazar_source_map.normalized.json");

function readJson<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) {
    throw new Error("Datoteka ne postoji: " + filePath);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, data: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function unique(arr: string[] = []): string[] {
  return [...new Set(arr.filter(Boolean))];
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

function safeArray(x: unknown): string[] {
  return Array.isArray(x) ? x.map(String).filter(Boolean) : [];
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => n && haystack.includes(n));
}

function buildStudyPatterns(study: StudyBucket): string[] {
  const base = [
    study.study || "",
    study.slug || "",
    ...(study.location || []),
  ]
    .join(" ")
    .toLowerCase();

  const cleaned = stripAccents(base);
  const words = cleaned
    .split(/[^a-z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4);

  const extras: string[] = [];

  if (cleaned.includes("turiz")) extras.push("turizam", "tourism", "ugostiteljstvo", "hospitality");
  if (cleaned.includes("menadz")) extras.push("management", "menadzment");
  if (cleaned.includes("informat")) extras.push("informatics", "business informatics");
  if (cleaned.includes("financ")) extras.push("finance", "financije", "investicije", "investments");
  if (cleaned.includes("projekt")) extras.push("project", "project-management", "projektni-menadzment");
  if (cleaned.includes("komunik")) extras.push("communication", "komunikacijski");
  if (cleaned.includes("kultur")) extras.push("culture", "cultural", "kulturni");
  if (cleaned.includes("javnog sektora")) extras.push("public sector", "javni sektor");
  if (cleaned.includes("uredskog")) extras.push("office", "office management");
  if (cleaned.includes("biograd")) extras.push("biograd");
  if (cleaned.includes("osijek")) extras.push("osijek");

  return unique([...words, ...extras]);
}

function isPdf(url: string): boolean {
  return /\.pdf($|\?)/i.test(url);
}

function looksSharedAcademic(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u.includes("english-course-catalogue") ||
    u.includes("certificate") ||
    u.includes("certifikat") ||
    u.includes("iso-9001") ||
    u.includes("tuv-austria")
  );
}

function looksWeakGeneric(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u === "https://www.bak.hr/" ||
    u === "https://www.bak.hr" ||
    u === "https://www.bak.hr/upisi" ||
    u === "https://www.bak.hr/en/erasmus/" ||
    u === "https://www.bak.hr/en/erasmus"
  );
}

function sourceBelongsToStudy(url: string, study: StudyBucket): boolean {
  const u = stripAccents(url.toLowerCase());
  const patterns = buildStudyPatterns(study);

  if (study.slug && u.includes(stripAccents(study.slug.toLowerCase()))) {
    return true;
  }

  if (study.sources?.study_page_hr && u === stripAccents((study.sources.study_page_hr || "").toLowerCase())) {
    return true;
  }

  if (study.sources?.study_page_en && u === stripAccents((study.sources.study_page_en || "").toLowerCase())) {
    return true;
  }

  if (includesAny(u, patterns)) return true;

  return false;
}

function cleanStudySourceList(urls: string[], study: StudyBucket): string[] {
  const kept: string[] = [];

  for (const rawUrl of unique(urls)) {
    const url = normalizeWhitespace(rawUrl);
    if (!url) continue;

    if (looksWeakGeneric(url)) continue;

    if (looksSharedAcademic(url)) {
      continue;
    }

    if (!sourceBelongsToStudy(url, study)) {
      continue;
    }

    kept.push(url);
  }

  return unique(kept);
}

function normalizeStudy(study: StudyBucket): StudyBucket {
  const s = study.sources || {};

  const normalized: StudyBucket = {
    ...study,
    slug: study.slug || slugify(study.study || ""),
    language: unique(safeArray(study.language)),
    delivery_mode: unique(safeArray(study.delivery_mode)),
    location: unique(safeArray(study.location)),
    sources: {
      study_page_hr: s.study_page_hr || null,
      study_page_en: s.study_page_en || null,
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

  normalized.sources.curriculum_pdfs = cleanStudySourceList(safeArray(s.curriculum_pdfs), normalized);
  normalized.sources.course_catalogues = cleanStudySourceList(safeArray(s.course_catalogues), normalized);
  normalized.sources.schedules = cleanStudySourceList(safeArray(s.schedules), normalized);
  normalized.sources.exam_dates = cleanStudySourceList(safeArray(s.exam_dates), normalized);
  normalized.sources.practice_info = cleanStudySourceList(safeArray(s.practice_info), normalized);
  normalized.sources.final_thesis_info = cleanStudySourceList(safeArray(s.final_thesis_info), normalized);
  normalized.sources.faculty_pages = cleanStudySourceList(safeArray(s.faculty_pages), normalized);
  normalized.sources.policies = cleanStudySourceList(safeArray(s.policies), normalized);
  normalized.sources.other_sources = cleanStudySourceList(safeArray(s.other_sources), normalized);

  return normalized;
}

function totalStudySources(study: StudyBucket): number {
  const s = study.sources || {};
  let total = 0;

  if (s.study_page_hr) total++;
  if (s.study_page_en) total++;

  total += safeArray(s.curriculum_pdfs).length;
  total += safeArray(s.course_catalogues).length;
  total += safeArray(s.schedules).length;
  total += safeArray(s.exam_dates).length;
  total += safeArray(s.practice_info).length;
  total += safeArray(s.final_thesis_info).length;
  total += safeArray(s.faculty_pages).length;
  total += safeArray(s.policies).length;
  total += safeArray(s.other_sources).length;

  return total;
}

function gatherSharedAcademicSources(sourceMap: SourceMap): string[] {
  const manual = unique(safeArray(sourceMap.shared_academic_sources));
  const inferred = new Set<string>();

  for (const url of manual) inferred.add(url);

  for (const study of sourceMap.studies || []) {
    for (const url of safeArray(study.sources?.course_catalogues)) {
      if (looksSharedAcademic(url) || isPdf(url)) {
        if (url.toLowerCase().includes("english-course-catalogue")) {
          inferred.add(url);
        }
      }
    }

    for (const url of safeArray(study.sources?.other_sources)) {
      if (looksSharedAcademic(url)) inferred.add(url);
    }
  }

  return [...inferred];
}

function main() {
  const data = readJson<SourceMap>(INPUT_FILE);

  const studies = (data.studies || []).map(normalizeStudy);
  const sharedAcademicSources = gatherSharedAcademicSources({
    ...data,
    studies,
  });

  const normalized: SourceMap = {
    ...data,
    studies,
    shared_academic_sources: sharedAcademicSources,
    faculty_sources: unique(safeArray(data.faculty_sources)),
    institution: {
      name: data.institution?.name || "Veleučilište Baltazar Zaprešić",
      sources: {
        homepage: data.institution?.sources?.homepage || "https://www.bak.hr",
        admissions: data.institution?.sources?.admissions || "https://www.bak.hr/upisi",
        tuition:
          data.institution?.sources?.tuition &&
          !data.institution?.sources?.tuition?.includes("/en/erasmus")
            ? data.institution.sources.tuition
            : null,
        student_services: unique(safeArray(data.institution?.sources?.student_services)),
        policies: unique(safeArray(data.institution?.sources?.policies)),
        general_academic_documents: unique(safeArray(data.institution?.sources?.general_academic_documents)),
      },
    },
    crawl_meta: {
      generated_at: new Date().toISOString(),
      crawled_pages: data.crawl_meta?.crawled_pages || 0,
      discovered_urls: data.crawl_meta?.discovered_urls || 0,
      max_pages: data.crawl_meta?.max_pages || 0,
      domain: data.crawl_meta?.domain || "www.bak.hr",
    },
  };

  writeJson(OUTPUT_FILE, normalized);

  console.log("======================================");
  console.log("BALTAZAR SOURCE MAP NORMALIZATION");
  console.log("======================================");
  console.log("Input :", INPUT_FILE);
  console.log("Output:", OUTPUT_FILE);
  console.log("--------------------------------------");
  console.log("STUDIES:", normalized.studies?.length || 0);
  console.log("FACULTY SOURCES:", normalized.faculty_sources?.length || 0);
  console.log("SHARED ACADEMIC SOURCES:", normalized.shared_academic_sources?.length || 0);
  console.log("--------------------------------------");

  for (const study of normalized.studies || []) {
    console.log(`${study.study}: ${totalStudySources(study)} izvora`);
  }

  console.log("======================================");
  console.log("NORMALIZATION FINISHED");
  console.log("======================================");
}

main();
