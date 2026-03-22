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
  studies?: Array<{
    study: string;
    slug?: string;
    language?: string[];
    delivery_mode?: string[];
    location?: string[];
    sources?: StudySources;
  }>;
  faculty_sources?: string[];
  shared_academic_sources?: string[];
};

type StudyPageCurated = {
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
  generated_at?: string;
  input_file?: string;
  summary?: Record<string, unknown>;
  results?: StudyPageCurated[];
};

type ExistingFacultyProfile = {
  name: string;
  slug: string;
  profile_url: string;
  cleaned_title?: string | null;
  email?: string | null;
  consultations?: string | null;
  phone?: string | null;
  related_studies?: string[];
  extracted_from_pages?: string[];
  raw_summary?: string | null;
};

type ExistingFacultyFile = {
  generated_at?: string;
  input_file?: string;
  summary?: Record<string, unknown>;
  profiles?: ExistingFacultyProfile[];
};

type DiscoveryRow = {
  url: string;
  slug: string;
  discovered_from: string[];
  already_in_registry: boolean;
};

type DiscoveryOutput = {
  generated_at: string;
  input_files: {
    source_map: string;
    curated_documents: string;
    existing_registry: string;
  };
  summary: {
    discovered_urls_total: number;
    already_in_registry: number;
    new_vs_registry: number;
  };
  urls: DiscoveryRow[];
  new_urls_vs_registry: string[];
};

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");

const SOURCE_MAP_FILE = path.join(DATA_DIR, "baltazar_source_map.normalized.json");
const CURATED_FILE = path.join(DATA_DIR, "baltazar_study_page_documents_curated.json");
const EXISTING_FILE = path.join(DATA_DIR, "baltazar_faculty_profiles.normalized.json");
const OUTPUT_FILE = path.join(DATA_DIR, "baltazar_all_faculty_profile_urls.json");

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

function unique(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean).map((x) => normalizeWhitespace(x)))];
}

function safeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((x) => normalizeWhitespace(String(x))).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [normalizeWhitespace(value)];
  return [];
}

function isFacultyProfileUrl(url: string): boolean {
  const u = normalizeWhitespace(url).toLowerCase();
  return u.includes("/nastavnici-suradnici/") && !u.endsWith("/nastavnici-suradnici/");
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

function addUrl(
  map: Map<string, { slug: string; discovered_from: string[] }>,
  url: string,
  sourceLabel: string
) {
  const normalized = normalizeWhitespace(url);
  if (!normalized) return;
  if (!isFacultyProfileUrl(normalized)) return;

  if (!map.has(normalized)) {
    map.set(normalized, {
      slug: slugFromUrl(normalized),
      discovered_from: [sourceLabel],
    });
    return;
  }

  const current = map.get(normalized)!;
  current.discovered_from = unique([...current.discovered_from, sourceLabel]);
}

function main() {
  const sourceMap = readJsonSafe<SourceMap>(SOURCE_MAP_FILE, {});
  const curated = readJsonSafe<CuratedOutput>(CURATED_FILE, {});
  const existing = readJsonSafe<ExistingFacultyFile>(EXISTING_FILE, { profiles: [] });

  const discovered = new Map<string, { slug: string; discovered_from: string[] }>();

  for (const url of safeArray(sourceMap.faculty_sources)) {
    addUrl(discovered, url, "source_map.faculty_sources");
  }

  for (const study of sourceMap.studies || []) {
    for (const url of safeArray(study.sources?.faculty_pages)) {
      addUrl(discovered, url, `source_map.study:${study.study}`);
    }
  }

  for (const row of curated.results || []) {
    for (const url of safeArray(row.curated_links?.faculty)) {
      addUrl(discovered, url, `curated.study:${row.study}`);
    }
  }

  const existingUrlSet = new Set(
    (existing.profiles || [])
      .map((p) => normalizeWhitespace(p.profile_url || ""))
      .filter(Boolean)
  );

  const urls: DiscoveryRow[] = [...discovered.entries()]
    .map(([url, meta]) => ({
      url,
      slug: meta.slug,
      discovered_from: unique(meta.discovered_from),
      already_in_registry: existingUrlSet.has(url),
    }))
    .sort((a, b) => a.url.localeCompare(b.url, "hr"));

  const newUrlsVsRegistry = urls
    .filter((x) => !x.already_in_registry)
    .map((x) => x.url);

  const output: DiscoveryOutput = {
    generated_at: new Date().toISOString(),
    input_files: {
      source_map: SOURCE_MAP_FILE,
      curated_documents: CURATED_FILE,
      existing_registry: EXISTING_FILE,
    },
    summary: {
      discovered_urls_total: urls.length,
      already_in_registry: urls.filter((x) => x.already_in_registry).length,
      new_vs_registry: newUrlsVsRegistry.length,
    },
    urls,
    new_urls_vs_registry: newUrlsVsRegistry,
  };

  writeJson(OUTPUT_FILE, output);

  console.log("======================================");
  console.log("BALTAZAR ALL FACULTY PROFILE URL DISCOVERY");
  console.log("======================================");
  console.log("Input source map :", SOURCE_MAP_FILE);
  console.log("Input curated    :", CURATED_FILE);
  console.log("Input registry   :", EXISTING_FILE);
  console.log("Output           :", OUTPUT_FILE);
  console.log("--------------------------------------");
  console.log("Discovered URLs total :", output.summary.discovered_urls_total);
  console.log("Already in registry   :", output.summary.already_in_registry);
  console.log("New vs registry       :", output.summary.new_vs_registry);
  console.log("--------------------------------------");

  output.urls.slice(0, 30).forEach((row, i) => {
    console.log(`${i + 1}. ${row.url}`);
    console.log(`   already_in_registry: ${row.already_in_registry ? "DA" : "NE"}`);
    console.log(`   discovered_from: ${row.discovered_from.join(" | ")}`);
  });

  if (output.new_urls_vs_registry.length) {
    console.log("--------------------------------------");
    console.log("NEW URLS VS REGISTRY");
    output.new_urls_vs_registry.slice(0, 30).forEach((u, i) => {
      console.log(`${i + 1}. ${u}`);
    });
  }

  console.log("======================================");
  console.log("DISCOVERY FINISHED");
  console.log("======================================");
}

main();
