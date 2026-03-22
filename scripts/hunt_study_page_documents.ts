import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";

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
  studies?: StudyBucket[];
};

type FoundLink = {
  url: string;
  anchor_text: string;
  source_page: string;
  inferred_kind:
    | "curriculum"
    | "course_catalogue"
    | "courses"
    | "schedule"
    | "exam_dates"
    | "practice"
    | "final_thesis"
    | "faculty"
    | "policy"
    | "study_page"
    | "other";
  confidence: "high" | "medium" | "low";
  reasons: string[];
};

type StudyHuntRow = {
  study: string;
  slug: string;
  checked_pages: string[];
  found_links: FoundLink[];
};

type HuntOutput = {
  generated_at: string;
  input_file: string;
  summary: {
    studies: number;
    checked_pages: number;
    found_links: number;
    high_confidence: number;
    medium_confidence: number;
    low_confidence: number;
  };
  results: StudyHuntRow[];
};

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const INPUT_FILE = path.join(DATA_DIR, "baltazar_source_map.normalized.json");
const OUTPUT_FILE = path.join(DATA_DIR, "baltazar_study_page_documents_hunt.json");

const REQUEST_TIMEOUT_MS = 20000;
const DOMAIN = "www.bak.hr";
const BASE_URL = "https://www.bak.hr";

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

function normalizeText(input: string): string {
  return stripAccents(normalizeWhitespace((input || "").toLowerCase()));
}

function unique(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean).map((x) => normalizeWhitespace(x)))];
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
    return new URL(url).hostname === DOMAIN;
  } catch {
    return false;
  }
}

function isPdfUrl(url: string): boolean {
  return /\.pdf($|\?)/i.test(url);
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; BaltazarStudyHunter/1.0)",
        accept: "text/html,application/pdf;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

function inferKind(url: string, anchorText: string): FoundLink["inferred_kind"] {
  const hay = normalizeText(`${url} ${anchorText}`);

  if (
    hay.includes("kurikulum") ||
    hay.includes("curriculum") ||
    hay.includes("izvedbeni plan") ||
    hay.includes("izvedbeni-plan")
  ) {
    return "curriculum";
  }

  if (
    hay.includes("course catalogue") ||
    hay.includes("course-catalogue") ||
    hay.includes("general information")
  ) {
    return "course_catalogue";
  }

  if (
    hay.includes("kolegiji") ||
    hay.includes("predmeti") ||
    hay.includes("courses") ||
    hay.includes("subjects") ||
    hay.includes("nastavni plan")
  ) {
    return "courses";
  }

  if (
    hay.includes("raspored") ||
    hay.includes("schedule")
  ) {
    return "schedule";
  }

  if (
    hay.includes("ispit") ||
    hay.includes("exam")
  ) {
    return "exam_dates";
  }

  if (
    hay.includes("praksa") ||
    hay.includes("practice") ||
    hay.includes("internship")
  ) {
    return "practice";
  }

  if (
    hay.includes("zavrsni rad") ||
    hay.includes("završni rad") ||
    hay.includes("thesis")
  ) {
    return "final_thesis";
  }

  if (
    hay.includes("nastavnici") ||
    hay.includes("teachers") ||
    hay.includes("faculty") ||
    hay.includes("profesor") ||
    hay.includes("konzultacije")
  ) {
    return "faculty";
  }

  if (
    hay.includes("pravilnik") ||
    hay.includes("statut") ||
    hay.includes("policy")
  ) {
    return "policy";
  }

  if (
    hay.includes("/studijski-programi/") ||
    hay.includes("/en/studijski-programi/")
  ) {
    return "study_page";
  }

  return "other";
}

function inferConfidence(kind: FoundLink["inferred_kind"], url: string, anchorText: string): FoundLink["confidence"] {
  const hay = normalizeText(`${url} ${anchorText}`);

  if (
    kind === "curriculum" ||
    kind === "course_catalogue" ||
    kind === "courses"
  ) {
    return "high";
  }

  if (
    kind === "schedule" ||
    kind === "exam_dates" ||
    kind === "practice" ||
    kind === "final_thesis" ||
    kind === "faculty" ||
    kind === "policy"
  ) {
    return "medium";
  }

  if (isPdfUrl(url) && !hay.includes("certificate") && !hay.includes("certifikat")) {
    return "medium";
  }

  return "low";
}

function extractLinks(html: string, currentUrl: string): Array<{ url: string; anchor_text: string }> {
  const $ = cheerio.load(html);
  const out: Array<{ url: string; anchor_text: string }> = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const abs = safeUrl(href, currentUrl);
    if (!abs) return;
    if (!isInternalUrl(abs)) return;

    const anchorText = normalizeWhitespace($(el).text());
    out.push({
      url: abs,
      anchor_text: anchorText,
    });
  });

  return out;
}

function isInterestingLink(url: string, anchorText: string): boolean {
  const hay = normalizeText(`${url} ${anchorText}`);

  if (
    hay.includes("kurikulum") ||
    hay.includes("curriculum") ||
    hay.includes("izvedbeni plan") ||
    hay.includes("course catalogue") ||
    hay.includes("kolegiji") ||
    hay.includes("predmeti") ||
    hay.includes("courses") ||
    hay.includes("subjects") ||
    hay.includes("nastavni plan") ||
    hay.includes("ects") ||
    hay.includes("raspored") ||
    hay.includes("schedule") ||
    hay.includes("ispit") ||
    hay.includes("exam") ||
    hay.includes("praksa") ||
    hay.includes("practice") ||
    hay.includes("internship") ||
    hay.includes("zavrsni rad") ||
    hay.includes("završni rad") ||
    hay.includes("thesis") ||
    hay.includes("nastavnici") ||
    hay.includes("teachers") ||
    hay.includes("faculty") ||
    hay.includes("konzultacije") ||
    hay.includes("pravilnik") ||
    hay.includes("statut")
  ) {
    return true;
  }

  if (isPdfUrl(url) && !hay.includes("certificate") && !hay.includes("certifikat")) {
    return true;
  }

  return false;
}

function dedupeFoundLinks(links: FoundLink[]): FoundLink[] {
  const map = new Map<string, FoundLink>();

  for (const link of links) {
    const existing = map.get(link.url);
    if (!existing) {
      map.set(link.url, link);
      continue;
    }

    const rank = { high: 3, medium: 2, low: 1 };
    if (rank[link.confidence] > rank[existing.confidence]) {
      map.set(link.url, link);
      continue;
    }

    if (rank[link.confidence] === rank[existing.confidence]) {
      const merged: FoundLink = {
        ...existing,
        anchor_text: existing.anchor_text || link.anchor_text,
        reasons: unique([...existing.reasons, ...link.reasons]),
      };
      map.set(link.url, merged);
    }
  }

  return [...map.values()].sort((a, b) => {
    const rank = { high: 3, medium: 2, low: 1 };
    return (
      rank[b.confidence] - rank[a.confidence] ||
      a.inferred_kind.localeCompare(b.inferred_kind, "hr") ||
      a.url.localeCompare(b.url, "hr")
    );
  });
}

async function huntStudyPage(pageUrl: string): Promise<FoundLink[]> {
  const res = await fetchWithTimeout(pageUrl);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${pageUrl}`);
  }

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("html")) {
    return [];
  }

  const html = await res.text();
  const links = extractLinks(html, pageUrl);
  const found: FoundLink[] = [];

  for (const link of links) {
    if (!isInterestingLink(link.url, link.anchor_text)) continue;

    const kind = inferKind(link.url, link.anchor_text);
    const confidence = inferConfidence(kind, link.url, link.anchor_text);
    const reasons = unique([
      `source page: ${pageUrl}`,
      `anchor: ${link.anchor_text || "(prazno)"}`,
      `kind: ${kind}`,
    ]);

    found.push({
      url: link.url,
      anchor_text: link.anchor_text,
      source_page: pageUrl,
      inferred_kind: kind,
      confidence,
      reasons,
    });
  }

  return dedupeFoundLinks(found);
}

async function main() {
  const sourceMap = readJsonSafe<SourceMap>(INPUT_FILE, { studies: [] });
  const studies = sourceMap.studies || [];

  if (!studies.length) {
    throw new Error("Nema studija u baltazar_source_map.normalized.json.");
  }

  const results: StudyHuntRow[] = [];
  let checkedPagesTotal = 0;

  for (const study of studies) {
    const checkedPages = unique([
      study.sources?.study_page_hr || "",
      study.sources?.study_page_en || "",
    ]).filter(Boolean);

    const collected: FoundLink[] = [];

    console.log(`🔎 STUDIJ: ${study.study}`);

    for (const pageUrl of checkedPages) {
      try {
        console.log(`   → page: ${pageUrl}`);
        const found = await huntStudyPage(pageUrl);
        checkedPagesTotal += 1;
        collected.push(...found);
      } catch (err) {
        console.warn(`   ⚠️ Ne mogu obraditi ${pageUrl}`);
      }
    }

    results.push({
      study: study.study,
      slug: study.slug || "",
      checked_pages: checkedPages,
      found_links: dedupeFoundLinks(collected),
    });
  }

  const allLinks = results.flatMap((r) => r.found_links);
  const output: HuntOutput = {
    generated_at: new Date().toISOString(),
    input_file: INPUT_FILE,
    summary: {
      studies: results.length,
      checked_pages: checkedPagesTotal,
      found_links: allLinks.length,
      high_confidence: allLinks.filter((x) => x.confidence === "high").length,
      medium_confidence: allLinks.filter((x) => x.confidence === "medium").length,
      low_confidence: allLinks.filter((x) => x.confidence === "low").length,
    },
    results,
  };

  writeJson(OUTPUT_FILE, output);

  console.log("======================================");
  console.log("BALTAZAR STUDY PAGE DOCUMENT HUNT");
  console.log("======================================");
  console.log("Input :", INPUT_FILE);
  console.log("Output:", OUTPUT_FILE);
  console.log("--------------------------------------");
  console.log("Studies       :", output.summary.studies);
  console.log("Checked pages :", output.summary.checked_pages);
  console.log("Found links   :", output.summary.found_links);
  console.log("High confidence:", output.summary.high_confidence);
  console.log("Medium confidence:", output.summary.medium_confidence);
  console.log("Low confidence :", output.summary.low_confidence);
  console.log("--------------------------------------");

  for (const row of results) {
    console.log(`${row.study}: ${row.found_links.length} linkova`);
  }

  console.log("--------------------------------------");
  console.log("TOP 30 LINKS");
  allLinks.slice(0, 30).forEach((link, i) => {
    console.log(`${i + 1}. [${link.confidence}] ${link.inferred_kind} -> ${link.url}`);
  });

  console.log("======================================");
  console.log("STUDY PAGE HUNT FINISHED");
  console.log("======================================");
}

main().catch((err) => {
  console.error("❌ STUDY PAGE HUNT FAILED");
  console.error(err);
  process.exit(1);
});
