import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";

type TeacherRegistryRow = {
  teacher_id: string;
  name: string;
  slug: string;
  profile_url: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  consultations: string | null;
  related_studies: string[];
  extracted_from_pages: string[];
  raw_summary: string | null;
  data_quality: {
    has_title: boolean;
    has_email: boolean;
    has_phone: boolean;
    has_consultations: boolean;
    has_related_studies: boolean;
    score: number;
    label: "high" | "medium" | "low";
  };
};

type TeacherRegistryFile = {
  generated_at?: string;
  input_file?: string;
  summary?: Record<string, unknown>;
  teachers?: TeacherRegistryRow[];
};

type ExtractedPerson = {
  name: string;
  cleaned_name: string;
  source_page: string;
  source_text: string;
  matched_in_registry: boolean;
  registry_match_name: string | null;
  registry_profile_url: string | null;
};

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const REGISTRY_FILE = path.join(DATA_DIR, "baltazar_teacher_registry.json");

const TARGET_PAGES = [
  "https://www.bak.hr/o-nama/menadzment-veleucilista/",
  "https://www.bak.hr/o-nama/dosadasnji-dekani/",
];

const REQUEST_TIMEOUT_MS = 20000;

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
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

function cleanedPersonName(name: string): string {
  let s = normalizeText(name);

  const patterns = [
    /\bdoc\b/g,
    /\bdocent\b/g,
    /\bdr\b/g,
    /\bsc\b/g,
    /\bmr\b/g,
    /\bprofesor\b/g,
    /\bprof\b/g,
    /\bredoviti\b/g,
    /\bizvanredni\b/g,
    /\bvisi\b/g,
    /\bviši\b/g,
    /\bpredavac\b/g,
    /\bpredavač\b/g,
    /\bassistant\b/g,
    /\bassociate\b/g,
    /\bfull\b/g,
    /\bsenior\b/g,
    /\blecturer\b/g,
    /\bmag\b/g,
    /\bdipl\b/g,
    /\buniv\b/g,
    /\bspec\b/g,
    /\bstruc\b/g,
    /\bstruč\b/g,
    /\bstud\b/g,
    /\bbacc\b/g,
    /\boec\b/g,
    /\biur\b/g,
    /\bcomm\b/g,
    /\bart\b/g,
    /\bpsych\b/g,
    /\bmba\b/g,
    /\bphilol\b/g,
    /\bcroat\b/g,
    /\blitt\b/g,
    /\bcomp\b/g,
    /\bsocio\b/g,
    /\bet\b/g,
    /\bpred\b/g
  ];

  for (const rx of patterns) {
    s = s.replace(rx, " ");
  }

  s = s.replace(/[.,/()\-]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function buildRegistryIndexes(teachers: TeacherRegistryRow[]) {
  const byExact = new Map<string, TeacherRegistryRow>();
  const byCleaned = new Map<string, TeacherRegistryRow[]>();

  for (const t of teachers) {
    byExact.set(normalizeWhitespace(t.name), t);

    const cleaned = cleanedPersonName(t.name);
    if (cleaned) {
      const arr = byCleaned.get(cleaned) || [];
      arr.push(t);
      byCleaned.set(cleaned, arr);
    }
  }

  return { byExact, byCleaned };
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; BaltazarManagementNameExtractor/1.0)",
        accept: "text/html,*/*;q=0.8",
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

function extractNameCandidatesFromTextBlock(text: string): string[] {
  const cleaned = normalizeWhitespace(text);
  if (!cleaned) return [];

  const patterns = [
    /\b[A-ZŠĐČĆŽ][a-zšđčćž]+(?:\s+[A-ZŠĐČĆŽ][a-zšđčćž]+){1,3}\b/g,
    /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g,
  ];

  const out: string[] = [];
  for (const rx of patterns) {
    const matches = cleaned.match(rx) || [];
    for (const m of matches) {
      const n = normalizeWhitespace(m);
      const c = cleanedPersonName(n);
      if (!c || c.split(" ").length < 2) continue;

      const banned = [
        "veleuciliste baltazar",
        "baltazar zapresic",
        "upravno vijece",
        "gospodarski savjet",
        "dosadasnji dekani",
        "menadzment veleucilista",
        "polytechnic council",
        "governing board",
      ];
      if (banned.some((b) => c.includes(b))) continue;

      out.push(n);
    }
  }

  return [...new Set(out)];
}

function extractPeopleFromHtml(html: string, pageUrl: string): Array<{ name: string; source_text: string }> {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();

  const results: Array<{ name: string; source_text: string }> = [];
  const seen = new Set<string>();

  const selectors = [
    "h1", "h2", "h3", "h4", "p", "li", "strong", "b",
    ".elementor-widget-container", ".elementor-heading-title"
  ];

  $(selectors.join(",")).each((_, el) => {
    const text = normalizeWhitespace($(el).text());
    if (!text) return;
    if (text.length < 5) return;

    const names = extractNameCandidatesFromTextBlock(text);
    for (const name of names) {
      const key = `${cleanedPersonName(name)}|${pageUrl}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        name,
        source_text: text,
      });
    }
  });

  return results;
}

async function main() {
  const registry = readJsonSafe<TeacherRegistryFile>(REGISTRY_FILE, { teachers: [] });
  const teachers = registry.teachers || [];

  if (!teachers.length) {
    throw new Error("Nema nastavnika u baltazar_teacher_registry.json.");
  }

  const indexes = buildRegistryIndexes(teachers);
  const found: ExtractedPerson[] = [];

  console.log("======================================");
  console.log("EXTRACT MANAGEMENT NAMES AND CHECK REGISTRY");
  console.log("======================================");
  console.log("Registry file:", REGISTRY_FILE);
  console.log(`Teachers in registry: ${teachers.length}`);
  console.log("--------------------------------------");

  for (let i = 0; i < TARGET_PAGES.length; i++) {
    const pageUrl = TARGET_PAGES[i];
    console.log(`🔎 [${i + 1}/${TARGET_PAGES.length}] ${pageUrl}`);

    try {
      const res = await fetchWithTimeout(pageUrl);
      if (!res.ok) {
        console.log(`   HTTP ${res.status}`);
        continue;
      }

      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      if (!contentType.includes("html")) {
        console.log("   non-html");
        continue;
      }

      const html = await res.text();
      const people = extractPeopleFromHtml(html, pageUrl);
      console.log(`   extracted person candidates: ${people.length}`);

      for (const person of people) {
        const exact = indexes.byExact.get(normalizeWhitespace(person.name));
        const cleaned = cleanedPersonName(person.name);
        const cleanedMatches = cleaned ? (indexes.byCleaned.get(cleaned) || []) : [];

        let matched: TeacherRegistryRow | null = null;
        if (exact) matched = exact;
        else if (cleanedMatches.length === 1) matched = cleanedMatches[0];

        found.push({
          name: person.name,
          cleaned_name: cleaned,
          source_page: pageUrl,
          source_text: person.source_text,
          matched_in_registry: !!matched,
          registry_match_name: matched?.name || null,
          registry_profile_url: matched?.profile_url || null,
        });
      }
    } catch (err) {
      console.log(`   ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const dedupMap = new Map<string, ExtractedPerson>();
  for (const item of found) {
    const key = `${item.cleaned_name}|${item.source_page}`;
    if (!dedupMap.has(key)) dedupMap.set(key, item);
  }

  const deduped = [...dedupMap.values()].sort((a, b) => a.name.localeCompare(b.name, "hr"));
  const matched = deduped.filter((x) => x.matched_in_registry);
  const unmatched = deduped.filter((x) => !x.matched_in_registry);

  console.log("======================================");
  console.log("RESULTS");
  console.log("======================================");
  console.log(`Potential persons found: ${deduped.length}`);
  console.log(`Matched in registry: ${matched.length}`);
  console.log(`Unmatched in registry: ${unmatched.length}`);
  console.log("--------------------------------------");

  if (matched.length) {
    console.log("MATCHED PERSONS");
    matched.forEach((m, i) => {
      console.log(`${i + 1}. ${m.name}`);
      console.log(`   registry_match: ${m.registry_match_name || "-"}`);
      console.log(`   profile: ${m.registry_profile_url || "-"}`);
      console.log(`   page: ${m.source_page}`);
    });
    console.log("--------------------------------------");
  }

  if (unmatched.length) {
    console.log("UNMATCHED PERSONS");
    unmatched.forEach((m, i) => {
      console.log(`${i + 1}. ${m.name}`);
      console.log(`   page: ${m.source_page}`);
      console.log(`   source_text: ${m.source_text}`);
    });
    console.log("--------------------------------------");
  }

  console.log("CHECK FINISHED");
  console.log("======================================");
}

main().catch((err) => {
  console.error("❌ EXTRACTION FAILED");
  console.error(err);
  process.exit(1);
});
