import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";

type CuratedStudyRow = {
  study: string;
  slug: string;
  checked_pages: string[];
  curated_links: {
    faculty: string[];
    schedules: string[];
    exam_dates: string[];
    practice: string[];
    final_thesis: string[];
    curriculum: string[];
    course_catalogue: string[];
    courses: string[];
    policy: string[];
    other_relevant: string[];
  };
};

type CuratedOutput = {
  generated_at: string;
  input_file: string;
  summary: {
    studies: number;
    total_curated_links: number;
    faculty: number;
    schedules: number;
    exam_dates: number;
    practice: number;
    final_thesis: number;
    curriculum: number;
    course_catalogue: number;
    courses: number;
    policy: number;
    other_relevant: number;
  };
  results: CuratedStudyRow[];
};

type FacultyProfile = {
  name: string;
  slug: string;
  profile_url: string;
  title: string | null;
  email: string | null;
  consultations: string | null;
  phone: string | null;
  related_studies: string[];
  extracted_from_pages: string[];
  raw_summary: string | null;
};

type FacultyOutput = {
  generated_at: string;
  input_file: string;
  summary: {
    total_unique_faculty_urls: number;
    extracted_profiles: number;
    with_email: number;
    with_consultations: number;
    with_phone: number;
  };
  profiles: FacultyProfile[];
};

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const INPUT_FILE = path.join(DATA_DIR, "baltazar_study_page_documents_curated.json");
const OUTPUT_FILE = path.join(DATA_DIR, "baltazar_faculty_profiles.json");

const REQUEST_TIMEOUT_MS = 20000;

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

function slugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || "";
  } catch {
    return "";
  }
}

function decodeSlugToName(slug: string): string {
  if (!slug) return "";
  let s = slug
    .replace(/^dr-sc-/, "")
    .replace(/^mr-sc-/, "")
    .replace(/^prof-dr-sc-/, "")
    .replace(/-docent$/, "")
    .replace(/-visi-predavac$/, "")
    .replace(/-predavac$/, "")
    .replace(/-profesor-visoke-skole$/, "")
    .replace(/-asistent$/, "")
    .replace(/-v-predavac$/, "")
    .replace(/-lecturer$/, "");

  s = s
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return normalizeWhitespace(s);
}

function extractEmails(text: string): string[] {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return unique(matches);
}

function extractPhones(text: string): string[] {
  const matches =
    text.match(/(?:\+?\d[\d\s\/().-]{6,}\d)/g) || [];
  return unique(matches.map((x) => normalizeWhitespace(x)).filter((x) => x.length >= 8));
}

function pickBestTitle(text: string): string | null {
  const lines = text
    .split("\n")
    .map(normalizeWhitespace)
    .filter(Boolean)
    .slice(0, 40);

  const titlePatterns = [
    /docent/i,
    /profesor/i,
    /viši predavač/i,
    /visi predavac/i,
    /predavač/i,
    /predavac/i,
    /assistant professor/i,
    /associate professor/i,
    /full professor/i,
    /lecturer/i,
    /senior lecturer/i,
  ];

  for (const line of lines) {
    if (titlePatterns.some((rx) => rx.test(line))) {
      return line;
    }
  }

  return null;
}

function extractConsultations(text: string): string | null {
  const lines = text
    .split("\n")
    .map(normalizeWhitespace)
    .filter(Boolean);

  const matches: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nline = normalizeText(line);

    if (
      nline.includes("konzult") ||
      nline.includes("consultation") ||
      nline.includes("office hours")
    ) {
      matches.push(line);

      if (i + 1 < lines.length) matches.push(lines[i + 1]);
      if (i + 2 < lines.length) matches.push(lines[i + 2]);
    }
  }

  const cleaned = unique(matches).join(" | ");
  return cleaned || null;
}

function extractRawSummary(text: string): string | null {
  const lines = text
    .split("\n")
    .map(normalizeWhitespace)
    .filter(Boolean)
    .slice(0, 20);

  const trimmed = lines.join(" | ");
  return trimmed || null;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; BaltazarFacultyExtractor/1.0)",
        accept: "text/html,*/*;q=0.8",
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function extractFacultyProfile(url: string, relatedStudies: string[]): Promise<FacultyProfile | null> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("html")) {
    return null;
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  $("script, style, noscript").remove();

  const h1 = normalizeWhitespace($("h1").first().text());
  const titleTag = normalizeWhitespace($("title").first().text());
  const pageText = normalizeWhitespace($("body").text());

  const slug = slugFromUrl(url);
  const fallbackName = decodeSlugToName(slug);

  let name =
    h1 ||
    titleTag.replace(/\s*[-|–].*$/, "").trim() ||
    fallbackName;

  if (!name) {
    name = fallbackName || slug;
  }

  const emails = extractEmails(pageText);
  const phones = extractPhones(pageText);
  const title = pickBestTitle($("body").text());
  const consultations = extractConsultations($("body").text());
  const rawSummary = extractRawSummary($("body").text());

  return {
    name: normalizeWhitespace(name),
    slug,
    profile_url: url,
    title,
    email: emails[0] || null,
    consultations,
    phone: phones[0] || null,
    related_studies: unique(relatedStudies),
    extracted_from_pages: [url],
    raw_summary: rawSummary,
  };
}

function mergeProfiles(profiles: FacultyProfile[]): FacultyProfile[] {
  const map = new Map<string, FacultyProfile>();

  for (const profile of profiles) {
    const key = normalizeText(profile.profile_url || profile.name);
    if (!map.has(key)) {
      map.set(key, {
        ...profile,
        related_studies: unique(profile.related_studies),
        extracted_from_pages: unique(profile.extracted_from_pages),
      });
      continue;
    }

    const existing = map.get(key)!;
    existing.related_studies = unique([
      ...existing.related_studies,
      ...profile.related_studies,
    ]);
    existing.extracted_from_pages = unique([
      ...existing.extracted_from_pages,
      ...profile.extracted_from_pages,
    ]);

    if (!existing.email) existing.email = profile.email;
    if (!existing.phone) existing.phone = profile.phone;
    if (!existing.title) existing.title = profile.title;
    if (!existing.consultations) existing.consultations = profile.consultations;
    if (!existing.raw_summary) existing.raw_summary = profile.raw_summary;
    if (!existing.name || existing.name === existing.slug) existing.name = profile.name;
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "hr"));
}

async function main() {
  const input = readJsonSafe<CuratedOutput>(INPUT_FILE, {
    results: [] as CuratedStudyRow[],
  });

  const rows = input.results || [];
  if (!rows.length) {
    throw new Error("Nema rezultata u baltazar_study_page_documents_curated.json.");
  }

  const facultyUrlMap = new Map<string, string[]>();

  for (const row of rows) {
    for (const url of row.curated_links?.faculty || []) {
      const current = facultyUrlMap.get(url) || [];
      current.push(row.study);
      facultyUrlMap.set(url, unique(current));
    }
  }

  const urls = [...facultyUrlMap.keys()].sort((a, b) => a.localeCompare(b, "hr"));
  const extracted: FacultyProfile[] = [];

  console.log("======================================");
  console.log("BALTAZAR FACULTY PROFILE EXTRACTION");
  console.log("======================================");
  console.log(`Faculty URLs found: ${urls.length}`);
  console.log("--------------------------------------");

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`🔎 [${i + 1}/${urls.length}] ${url}`);

    try {
      const profile = await extractFacultyProfile(url, facultyUrlMap.get(url) || []);
      if (profile) extracted.push(profile);
    } catch (err) {
      console.warn(`⚠️ Ne mogu obraditi: ${url}`);
    }
  }

  const profiles = mergeProfiles(extracted);

  const output: FacultyOutput = {
    generated_at: new Date().toISOString(),
    input_file: INPUT_FILE,
    summary: {
      total_unique_faculty_urls: urls.length,
      extracted_profiles: profiles.length,
      with_email: profiles.filter((p) => !!p.email).length,
      with_consultations: profiles.filter((p) => !!p.consultations).length,
      with_phone: profiles.filter((p) => !!p.phone).length,
    },
    profiles,
  };

  writeJson(OUTPUT_FILE, output);

  console.log("======================================");
  console.log("FACULTY EXTRACTION FINISHED");
  console.log("======================================");
  console.log("Input :", INPUT_FILE);
  console.log("Output:", OUTPUT_FILE);
  console.log("--------------------------------------");
  console.log("Unique faculty URLs :", output.summary.total_unique_faculty_urls);
  console.log("Extracted profiles  :", output.summary.extracted_profiles);
  console.log("With email          :", output.summary.with_email);
  console.log("With consultations  :", output.summary.with_consultations);
  console.log("With phone          :", output.summary.with_phone);
  console.log("--------------------------------------");

  profiles.slice(0, 20).forEach((p, i) => {
    console.log(`${i + 1}. ${p.name}`);
    console.log(`   title: ${p.title || "-"}`);
    console.log(`   email: ${p.email || "-"}`);
    console.log(`   consultations: ${p.consultations || "-"}`);
  });

  console.log("======================================");
}

main().catch((err) => {
  console.error("❌ FACULTY EXTRACTION FAILED");
  console.error(err);
  process.exit(1);
});
