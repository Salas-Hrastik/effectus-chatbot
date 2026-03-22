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

type ManagementMember = {
  name: string;
  cleaned_name: string;
  source_page: string;
  source_context: string;
  matched_in_registry: boolean;
  registry_match_name: string | null;
  registry_profile_url: string | null;
};

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const REGISTRY_FILE = path.join(DATA_DIR, "baltazar_teacher_registry.json");

const REQUEST_TIMEOUT_MS = 20000;

const MANAGEMENT_PAGES = [
  "https://www.bak.hr/o-nama/",
  "https://www.bak.hr/en/o-nama/",
  "https://www.bak.hr/o-nama/zagreb",
  "https://www.bak.hr/o-nama/biograd-na-moru/",
  "https://www.bak.hr/o-nama/osijek/",
];

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

function unique(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean).map(normalizeWhitespace))];
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

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; BaltazarManagementChecker/1.0)",
        accept: "text/html,*/*;q=0.8",
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeManagementContext(text: string): boolean {
  const t = normalizeText(text);
  const signals = [
    "uprava",
    "dekan",
    "prodekan",
    "prodekanica",
    "management board",
    "dean",
    "vice dean",
    "clan uprave",
    "član uprave",
    "ravnatelj",
    "direktor",
  ];
  return signals.some((s) => t.includes(normalizeText(s)));
}

function extractLikelyManagementNames(html: string, pageUrl: string): Array<{ name: string; context: string }> {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();

  const results: Array<{ name: string; context: string }> = [];

  const candidateSelectors = [
    "h1", "h2", "h3", "h4", "p", "li", "strong", "b", ".elementor-heading-title", ".elementor-widget-container"
  ];

  const seen = new Set<string>();

  $(candidateSelectors.join(",")).each((_, el) => {
    const text = normalizeWhitespace($(el).text());
    if (!text) return;
    if (!looksLikeManagementContext(text)) return;

    const context = text;

    const nameRegexes = [
      /([A-ZŠĐČĆŽ][a-zšđčćž]+(?:\s+[A-ZŠĐČĆŽ][a-zšđčćž]+){1,3})/g,
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/g,
    ];

    for (const rx of nameRegexes) {
      const matches = text.match(rx) || [];
      for (const m of matches) {
        const name = normalizeWhitespace(m);
        const cleaned = cleanedPersonName(name);
        if (!cleaned || cleaned.split(" ").length < 2) continue;

        const key = `${cleaned}|${pageUrl}`;
        if (seen.has(key)) continue;
        seen.add(key);

        results.push({
          name,
          context,
        });
      }
    }
  });

  return results;
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

async function main() {
  const registry = readJsonSafe<TeacherRegistryFile>(REGISTRY_FILE, { teachers: [] });
  const teachers = registry.teachers || [];

  if (!teachers.length) {
    throw new Error("Nema nastavnika u baltazar_teacher_registry.json.");
  }

  const indexes = buildRegistryIndexes(teachers);
  const found: ManagementMember[] = [];

  console.log("======================================");
  console.log("CHECK MANAGEMENT MEMBERS VS REGISTRY");
  console.log("======================================");
  console.log("Registry file:", REGISTRY_FILE);
  console.log(`Teachers in registry: ${teachers.length}`);
  console.log("--------------------------------------");

  for (let i = 0; i < MANAGEMENT_PAGES.length; i++) {
    const pageUrl = MANAGEMENT_PAGES[i];
    console.log(`🔎 [${i + 1}/${MANAGEMENT_PAGES.length}] ${pageUrl}`);

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
      const extracted = extractLikelyManagementNames(html, pageUrl);
      console.log(`   extracted candidates: ${extracted.length}`);

      for (const item of extracted) {
        const exact = indexes.byExact.get(normalizeWhitespace(item.name));
        const cleaned = cleanedPersonName(item.name);
        const cleanedMatches = cleaned ? (indexes.byCleaned.get(cleaned) || []) : [];

        let matched: TeacherRegistryRow | null = null;
        if (exact) matched = exact;
        else if (cleanedMatches.length === 1) matched = cleanedMatches[0];

        found.push({
          name: item.name,
          cleaned_name: cleaned,
          source_page: pageUrl,
          source_context: item.context,
          matched_in_registry: !!matched,
          registry_match_name: matched?.name || null,
          registry_profile_url: matched?.profile_url || null,
        });
      }
    } catch (err) {
      console.log(`   ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const dedupedMap = new Map<string, ManagementMember>();
  for (const item of found) {
    const key = `${item.cleaned_name}|${item.source_page}`;
    if (!dedupedMap.has(key)) {
      dedupedMap.set(key, item);
    }
  }

  const deduped = [...dedupedMap.values()].sort((a, b) => a.name.localeCompare(b.name, "hr"));
  const matched = deduped.filter((x) => x.matched_in_registry);
  const unmatched = deduped.filter((x) => !x.matched_in_registry);

  console.log("======================================");
  console.log("RESULTS");
  console.log("======================================");
  console.log(`Potential management members found: ${deduped.length}`);
  console.log(`Matched in registry: ${matched.length}`);
  console.log(`Unmatched in registry: ${unmatched.length}`);
  console.log("--------------------------------------");

  if (matched.length) {
    console.log("MATCHED MEMBERS");
    matched.forEach((m, i) => {
      console.log(`${i + 1}. ${m.name}`);
      console.log(`   registry_match: ${m.registry_match_name || "-"}`);
      console.log(`   profile: ${m.registry_profile_url || "-"}`);
      console.log(`   page: ${m.source_page}`);
    });
    console.log("--------------------------------------");
  }

  if (unmatched.length) {
    console.log("UNMATCHED MEMBERS");
    unmatched.forEach((m, i) => {
      console.log(`${i + 1}. ${m.name}`);
      console.log(`   page: ${m.source_page}`);
      console.log(`   context: ${m.source_context}`);
    });
    console.log("--------------------------------------");
  }

  console.log("CHECK FINISHED");
  console.log("======================================");
}

main().catch((err) => {
  console.error("❌ MANAGEMENT CHECK FAILED");
  console.error(err);
  process.exit(1);
});
