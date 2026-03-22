import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";

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

type ExistingFacultyFile = {
  generated_at?: string;
  input_file?: string;
  summary?: {
    profiles?: number;
    with_email?: number;
    with_consultations?: number;
    with_phone?: number;
    with_cleaned_title?: number;
  };
  profiles?: FacultyProfile[];
};

type HarvestedFacultyLink = {
  url: string;
  anchor_text: string;
  source_page: string;
  slug: string;
};

type FullFacultyDirectoryOutput = {
  generated_at: string;
  seeds: string[];
  summary: {
    checked_pages: number;
    harvested_profile_links: number;
    unique_harvested_profiles: number;
    existing_profiles: number;
    new_profiles_not_in_existing_file: number;
  };
  checked_pages: string[];
  harvested_profiles: Array<{
    url: string;
    slug: string;
    anchor_text: string;
    source_pages: string[];
    already_in_existing_file: boolean;
  }>;
  missing_profiles_vs_existing: string[];
};

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const EXISTING_FILE = path.join(DATA_DIR, "baltazar_faculty_profiles.normalized.json");
const OUTPUT_FILE = path.join(DATA_DIR, "baltazar_full_faculty_directory_hunt.json");

const REQUEST_TIMEOUT_MS = 20000;
const BASE_URL = "https://www.bak.hr";
const DOMAIN = "www.bak.hr";

const SEEDS = [
  "https://www.bak.hr/nastavnici-suradnici/",
  "https://www.bak.hr/o-nama/nastavnici-suradnici/",
  "https://www.bak.hr/en/o-nama/",
  "https://www.bak.hr/o-nama/",
];

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

function normalizeText(s: string): string {
  return normalizeWhitespace((s || "").toLowerCase());
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

function slugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || "";
  } catch {
    return "";
  }
}

function isFacultyProfileUrl(url: string): boolean {
  const u = normalizeText(url);
  return u.includes("/nastavnici-suradnici/") && !u.endsWith("/nastavnici-suradnici/");
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; BaltazarFacultyDirectoryHunter/1.0)",
        accept: "text/html,*/*;q=0.8",
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
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

    out.push({
      url: abs,
      anchor_text: normalizeWhitespace($(el).text()),
    });
  });

  return out;
}

async function harvestFromPage(url: string): Promise<HarvestedFacultyLink[]> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("html")) return [];

  const html = await res.text();
  const links = extractLinks(html, url);

  const harvested: HarvestedFacultyLink[] = [];

  for (const link of links) {
    if (!isFacultyProfileUrl(link.url)) continue;

    harvested.push({
      url: link.url,
      anchor_text: link.anchor_text,
      source_page: url,
      slug: slugFromUrl(link.url),
    });
  }

  return harvested;
}

function mainMerge(harvested: HarvestedFacultyLink[], existingProfiles: FacultyProfile[]) {
  const existingUrlSet = new Set(
    (existingProfiles || [])
      .map((p) => normalizeWhitespace(p.profile_url || ""))
      .filter(Boolean)
  );

  const map = new Map<string, { url: string; slug: string; anchor_text: string; source_pages: string[] }>();

  for (const row of harvested) {
    const key = normalizeWhitespace(row.url);
    if (!map.has(key)) {
      map.set(key, {
        url: row.url,
        slug: row.slug,
        anchor_text: row.anchor_text,
        source_pages: [row.source_page],
      });
      continue;
    }

    const existing = map.get(key)!;
    existing.source_pages = unique([...existing.source_pages, row.source_page]);
    if (!existing.anchor_text && row.anchor_text) {
      existing.anchor_text = row.anchor_text;
    }
  }

  const harvestedProfiles = [...map.values()]
    .sort((a, b) => a.url.localeCompare(b.url, "hr"))
    .map((row) => ({
      ...row,
      already_in_existing_file: existingUrlSet.has(row.url),
    }));

  const missingProfilesVsExisting = harvestedProfiles
    .filter((p) => !p.already_in_existing_file)
    .map((p) => p.url);

  return {
    harvestedProfiles,
    missingProfilesVsExisting,
  };
}

async function main() {
  const existing = readJsonSafe<ExistingFacultyFile>(EXISTING_FILE, { profiles: [] });
  const existingProfiles = existing.profiles || [];

  const checkedPages: string[] = [];
  const harvested: HarvestedFacultyLink[] = [];

  console.log("======================================");
  console.log("BALTAZAR FULL FACULTY DIRECTORY HUNT");
  console.log("======================================");
  console.log(`Existing normalized profiles: ${existingProfiles.length}`);
  console.log("--------------------------------------");

  for (let i = 0; i < SEEDS.length; i++) {
    const seed = SEEDS[i];
    console.log(`🔎 [${i + 1}/${SEEDS.length}] ${seed}`);
    checkedPages.push(seed);

    try {
      const found = await harvestFromPage(seed);
      harvested.push(...found);
      console.log(`   found profile links: ${found.length}`);
    } catch (err) {
      console.warn(`   ⚠️ Ne mogu obraditi: ${seed}`);
    }
  }

  const merged = mainMerge(harvested, existingProfiles);

  const output: FullFacultyDirectoryOutput = {
    generated_at: new Date().toISOString(),
    seeds: SEEDS,
    summary: {
      checked_pages: checkedPages.length,
      harvested_profile_links: harvested.length,
      unique_harvested_profiles: merged.harvestedProfiles.length,
      existing_profiles: existingProfiles.length,
      new_profiles_not_in_existing_file: merged.missingProfilesVsExisting.length,
    },
    checked_pages: checkedPages,
    harvested_profiles: merged.harvestedProfiles,
    missing_profiles_vs_existing: merged.missingProfilesVsExisting,
  };

  writeJson(OUTPUT_FILE, output);

  console.log("======================================");
  console.log("DIRECTORY HUNT FINISHED");
  console.log("======================================");
  console.log("Input existing :", EXISTING_FILE);
  console.log("Output         :", OUTPUT_FILE);
  console.log("--------------------------------------");
  console.log("Checked pages              :", output.summary.checked_pages);
  console.log("Harvested profile links    :", output.summary.harvested_profile_links);
  console.log("Unique harvested profiles  :", output.summary.unique_harvested_profiles);
  console.log("Existing normalized file   :", output.summary.existing_profiles);
  console.log("New profiles not in existing:", output.summary.new_profiles_not_in_existing_file);
  console.log("--------------------------------------");

  output.harvested_profiles.slice(0, 30).forEach((p, i) => {
    console.log(`${i + 1}. ${p.url}`);
    console.log(`   already_in_existing_file: ${p.already_in_existing_file ? "DA" : "NE"}`);
    console.log(`   source_pages: ${p.source_pages.join(" | ")}`);
  });

  if (output.missing_profiles_vs_existing.length) {
    console.log("--------------------------------------");
    console.log("MISSING PROFILES VS EXISTING");
    output.missing_profiles_vs_existing.slice(0, 30).forEach((u, i) => {
      console.log(`${i + 1}. ${u}`);
    });
  }

  console.log("======================================");
}

main().catch((err) => {
  console.error("❌ FULL FACULTY DIRECTORY HUNT FAILED");
  console.error(err);
  process.exit(1);
});
