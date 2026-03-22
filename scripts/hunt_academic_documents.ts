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
  sources?: StudySources;
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

type HuntDocument = {
  url: string;
  kind:
    | "curriculum"
    | "course_catalogue"
    | "schedule"
    | "exam_dates"
    | "practice"
    | "final_thesis"
    | "faculty"
    | "policy"
    | "general_academic"
    | "other";
  confidence: "high" | "medium" | "low";
  matched_studies: string[];
  reasons: string[];
};

type HuntOutput = {
  generated_at: string;
  input_file: string;
  summary: {
    total_documents: number;
    high_confidence: number;
    medium_confidence: number;
    low_confidence: number;
  };
  by_kind: Record<string, number>;
  documents: HuntDocument[];
};

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const INPUT_FILE = path.join(DATA_DIR, "baltazar_source_map.normalized.json");
const OUTPUT_FILE = path.join(DATA_DIR, "baltazar_academic_documents_hunt.json");

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
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

function normalizeText(s: string): string {
  return stripAccents(normalizeWhitespace((s || "").toLowerCase()));
}

function unique(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean).map((x) => normalizeWhitespace(x)))];
}

function safeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((x) => String(x)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function buildStudyPatterns(study: StudyBucket): string[] {
  const joined = normalizeText(
    [
      study.study || "",
      study.slug || "",
      ...(study.location || []),
      study.sources?.study_page_hr || "",
      study.sources?.study_page_en || "",
    ].join(" ")
  );

  const words = joined
    .split(/[^a-z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4);

  return unique(words);
}

function inferKind(url: string): HuntDocument["kind"] {
  const u = normalizeText(url);

  if (u.includes("english-course-catalogue") || u.includes("course-catalogue")) {
    return "course_catalogue";
  }
  if (u.includes("kurikulum") || u.includes("curriculum") || u.includes("izvedbeni-plan")) {
    return "curriculum";
  }
  if (u.includes("raspored") || u.includes("schedule")) {
    return "schedule";
  }
  if (u.includes("ispit") || u.includes("exam")) {
    return "exam_dates";
  }
  if (u.includes("praksa") || u.includes("practice") || u.includes("internship")) {
    return "practice";
  }
  if (u.includes("zavrsni-rad") || u.includes("završni-rad") || u.includes("thesis")) {
    return "final_thesis";
  }
  if (u.includes("nastavn") || u.includes("faculty") || u.includes("prof") || u.includes("konzult")) {
    return "faculty";
  }
  if (u.includes("pravilnik") || u.includes("statut") || u.includes("policy")) {
    return "policy";
  }
  if (u.endsWith(".pdf") || u.includes("/wp-content/uploads/")) {
    return "general_academic";
  }
  return "other";
}

function inferConfidence(kind: HuntDocument["kind"], url: string, matchedStudies: string[]): HuntDocument["confidence"] {
  const u = normalizeText(url);

  if (
    kind === "curriculum" ||
    kind === "course_catalogue" ||
    kind === "schedule" ||
    kind === "exam_dates"
  ) {
    return "high";
  }

  if (
    kind === "practice" ||
    kind === "final_thesis" ||
    kind === "faculty" ||
    kind === "policy"
  ) {
    return matchedStudies.length > 0 ? "medium" : "low";
  }

  if (kind === "general_academic") {
    if (u.includes("ects") || u.includes("catalogue")) return "medium";
    return "low";
  }

  return matchedStudies.length > 0 ? "medium" : "low";
}

function collectAllUrls(sourceMap: SourceMap): Array<{ url: string; originStudy: string | null; bucket: string }> {
  const out: Array<{ url: string; originStudy: string | null; bucket: string }> = [];

  for (const study of sourceMap.studies || []) {
    const s = study.sources || {};

    const entries: Array<[string, string[]]> = [
      ["study_page_hr", s.study_page_hr ? [s.study_page_hr] : []],
      ["study_page_en", s.study_page_en ? [s.study_page_en] : []],
      ["curriculum_pdfs", safeArray(s.curriculum_pdfs)],
      ["course_catalogues", safeArray(s.course_catalogues)],
      ["schedules", safeArray(s.schedules)],
      ["exam_dates", safeArray(s.exam_dates)],
      ["practice_info", safeArray(s.practice_info)],
      ["final_thesis_info", safeArray(s.final_thesis_info)],
      ["faculty_pages", safeArray(s.faculty_pages)],
      ["policies", safeArray(s.policies)],
      ["other_sources", safeArray(s.other_sources)],
    ];

    for (const [bucket, urls] of entries) {
      for (const url of urls) {
        out.push({
          url,
          originStudy: study.study,
          bucket,
        });
      }
    }
  }

  for (const url of safeArray(sourceMap.shared_academic_sources)) {
    out.push({ url, originStudy: null, bucket: "shared_academic_sources" });
  }

  for (const url of safeArray(sourceMap.faculty_sources)) {
    out.push({ url, originStudy: null, bucket: "faculty_sources" });
  }

  const institutional = sourceMap.institution?.sources;
  if (institutional) {
    const entries: Array<[string, string[]]> = [
      ["homepage", institutional.homepage ? [institutional.homepage] : []],
      ["admissions", institutional.admissions ? [institutional.admissions] : []],
      ["tuition", institutional.tuition ? [institutional.tuition] : []],
      ["student_services", safeArray(institutional.student_services)],
      ["policies", safeArray(institutional.policies)],
      ["general_academic_documents", safeArray(institutional.general_academic_documents)],
    ];

    for (const [bucket, urls] of entries) {
      for (const url of urls) {
        out.push({
          url,
          originStudy: null,
          bucket,
        });
      }
    }
  }

  return out;
}

function main() {
  const sourceMap = readJsonSafe<SourceMap>(INPUT_FILE, {});
  const studies = sourceMap.studies || [];
  const rawUrls = collectAllUrls(sourceMap);

  const grouped = new Map<string, { origins: string[]; buckets: string[] }>();

  for (const row of rawUrls) {
    const url = normalizeWhitespace(row.url);
    if (!url) continue;

    if (!grouped.has(url)) {
      grouped.set(url, { origins: [], buckets: [] });
    }

    const current = grouped.get(url)!;
    if (row.originStudy) current.origins.push(row.originStudy);
    current.buckets.push(row.bucket);
  }

  const documents: HuntDocument[] = [];

  for (const [url, meta] of grouped.entries()) {
    const matchedStudies = new Set<string>(meta.origins);

    for (const study of studies) {
      const patterns = buildStudyPatterns(study);
      const normalizedUrl = normalizeText(url);
      if (patterns.some((p) => normalizedUrl.includes(normalizeText(p)))) {
        matchedStudies.add(study.study);
      }
    }

    const kind = inferKind(url);
    const matched = [...matchedStudies].sort((a, b) => a.localeCompare(b, "hr"));
    const reasons = unique([
      `source buckets: ${unique(meta.buckets).join(", ")}`,
      matched.length ? `matched studies: ${matched.join(", ")}` : "matched studies: none",
      `inferred kind: ${kind}`,
    ]);

    const confidence = inferConfidence(kind, url, matched);

    if (kind !== "other") {
      documents.push({
        url,
        kind,
        confidence,
        matched_studies: matched,
        reasons,
      });
    }
  }

  documents.sort((a, b) => {
    const confRank = { high: 3, medium: 2, low: 1 };
    return (
      confRank[b.confidence] - confRank[a.confidence] ||
      a.kind.localeCompare(b.kind, "hr") ||
      a.url.localeCompare(b.url, "hr")
    );
  });

  const byKind: Record<string, number> = {};
  for (const doc of documents) {
    byKind[doc.kind] = (byKind[doc.kind] || 0) + 1;
  }

  const output: HuntOutput = {
    generated_at: new Date().toISOString(),
    input_file: INPUT_FILE,
    summary: {
      total_documents: documents.length,
      high_confidence: documents.filter((d) => d.confidence === "high").length,
      medium_confidence: documents.filter((d) => d.confidence === "medium").length,
      low_confidence: documents.filter((d) => d.confidence === "low").length,
    },
    by_kind: byKind,
    documents,
  };

  writeJson(OUTPUT_FILE, output);

  console.log("======================================");
  console.log("BALTAZAR ACADEMIC DOCUMENT HUNT");
  console.log("======================================");
  console.log("Input :", INPUT_FILE);
  console.log("Output:", OUTPUT_FILE);
  console.log("--------------------------------------");
  console.log("Total documents :", output.summary.total_documents);
  console.log("High confidence :", output.summary.high_confidence);
  console.log("Medium confidence:", output.summary.medium_confidence);
  console.log("Low confidence  :", output.summary.low_confidence);
  console.log("--------------------------------------");

  const kinds = Object.keys(output.by_kind).sort((a, b) => a.localeCompare(b, "hr"));
  for (const kind of kinds) {
    console.log(`${kind}: ${output.by_kind[kind]}`);
  }

  console.log("--------------------------------------");
  console.log("TOP 20 DOCUMENTS");
  output.documents.slice(0, 20).forEach((doc, i) => {
    console.log(`${i + 1}. [${doc.confidence}] ${doc.kind} -> ${doc.url}`);
    if (doc.matched_studies.length) {
      console.log(`   studies: ${doc.matched_studies.join(" | ")}`);
    }
  });

  console.log("======================================");
  console.log("DOCUMENT HUNT FINISHED");
  console.log("======================================");
}

main();
