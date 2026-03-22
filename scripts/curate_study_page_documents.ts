import fs from "fs";
import path from "path";

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

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const INPUT_FILE = path.join(DATA_DIR, "baltazar_study_page_documents_hunt.json");
const OUTPUT_FILE = path.join(DATA_DIR, "baltazar_study_page_documents_curated.json");

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

function isPdf(url: string): boolean {
  return /\.pdf($|\?)/i.test(url);
}

function isWeakGeneric(url: string, kind: FoundLink["inferred_kind"]): boolean {
  const u = normalizeText(url);

  if (u.includes("certificate") || u.includes("certifikat") || u.includes("iso-9001") || u.includes("tuv-austria")) {
    return true;
  }

  if (kind === "courses") {
    if (
      u.includes("/cjelozivotno-obrazovanje/") ||
      u.includes("/en/cjelozivotno-obrazovanje/") ||
      u.includes("/upisi") ||
      u === "https://www.bak.hr/" ||
      u === "https://www.bak.hr"
    ) {
      return true;
    }
  }

  if (kind === "other") return true;

  return false;
}

function looksRelevant(link: FoundLink): boolean {
  if (isWeakGeneric(link.url, link.inferred_kind)) return false;

  const u = normalizeText(link.url);
  const a = normalizeText(link.anchor_text);
  const hay = `${u} ${a}`;

  if (link.confidence === "high") return true;

  if (link.inferred_kind === "faculty" && u.includes("/nastavnici-suradnici/")) return true;
  if (link.inferred_kind === "schedule" && hay.includes("raspored")) return true;
  if (link.inferred_kind === "schedule" && hay.includes("schedule")) return true;
  if (link.inferred_kind === "exam_dates" && hay.includes("ispitni rokovi")) return true;
  if (link.inferred_kind === "exam_dates" && hay.includes("exam")) return true;
  if (link.inferred_kind === "practice" && hay.includes("praksa")) return true;
  if (link.inferred_kind === "practice" && hay.includes("practice")) return true;
  if (link.inferred_kind === "final_thesis" && (hay.includes("zavrsni") || hay.includes("thesis"))) return true;
  if (link.inferred_kind === "policy" && (hay.includes("pravilnik") || hay.includes("statut"))) return true;

  if (isPdf(link.url) && !u.includes("certificate") && !u.includes("certifikat")) {
    return true;
  }

  return false;
}

function dedupeByUrl(links: FoundLink[]): FoundLink[] {
  const map = new Map<string, FoundLink>();
  const rank = { high: 3, medium: 2, low: 1 };

  for (const link of links) {
    const existing = map.get(link.url);
    if (!existing) {
      map.set(link.url, link);
      continue;
    }

    if (rank[link.confidence] > rank[existing.confidence]) {
      map.set(link.url, link);
      continue;
    }

    if (rank[link.confidence] === rank[existing.confidence]) {
      map.set(link.url, {
        ...existing,
        anchor_text: existing.anchor_text || link.anchor_text,
        reasons: unique([...(existing.reasons || []), ...(link.reasons || [])]),
      });
    }
  }

  return [...map.values()];
}

function categorizeLinks(links: FoundLink[]) {
  const curated = {
    faculty: [] as string[],
    schedules: [] as string[],
    exam_dates: [] as string[],
    practice: [] as string[],
    final_thesis: [] as string[],
    curriculum: [] as string[],
    course_catalogue: [] as string[],
    courses: [] as string[],
    policy: [] as string[],
    other_relevant: [] as string[],
  };

  for (const link of links) {
    if (!looksRelevant(link)) continue;

    switch (link.inferred_kind) {
      case "faculty":
        curated.faculty.push(link.url);
        break;
      case "schedule":
        curated.schedules.push(link.url);
        break;
      case "exam_dates":
        curated.exam_dates.push(link.url);
        break;
      case "practice":
        curated.practice.push(link.url);
        break;
      case "final_thesis":
        curated.final_thesis.push(link.url);
        break;
      case "curriculum":
        curated.curriculum.push(link.url);
        break;
      case "course_catalogue":
        curated.course_catalogue.push(link.url);
        break;
      case "courses":
        curated.courses.push(link.url);
        break;
      case "policy":
        curated.policy.push(link.url);
        break;
      default:
        curated.other_relevant.push(link.url);
        break;
    }
  }

  return {
    faculty: unique(curated.faculty),
    schedules: unique(curated.schedules),
    exam_dates: unique(curated.exam_dates),
    practice: unique(curated.practice),
    final_thesis: unique(curated.final_thesis),
    curriculum: unique(curated.curriculum),
    course_catalogue: unique(curated.course_catalogue),
    courses: unique(curated.courses),
    policy: unique(curated.policy),
    other_relevant: unique(curated.other_relevant),
  };
}

function countTotals(results: CuratedStudyRow[]) {
  return {
    faculty: results.reduce((n, r) => n + r.curated_links.faculty.length, 0),
    schedules: results.reduce((n, r) => n + r.curated_links.schedules.length, 0),
    exam_dates: results.reduce((n, r) => n + r.curated_links.exam_dates.length, 0),
    practice: results.reduce((n, r) => n + r.curated_links.practice.length, 0),
    final_thesis: results.reduce((n, r) => n + r.curated_links.final_thesis.length, 0),
    curriculum: results.reduce((n, r) => n + r.curated_links.curriculum.length, 0),
    course_catalogue: results.reduce((n, r) => n + r.curated_links.course_catalogue.length, 0),
    courses: results.reduce((n, r) => n + r.curated_links.courses.length, 0),
    policy: results.reduce((n, r) => n + r.curated_links.policy.length, 0),
    other_relevant: results.reduce((n, r) => n + r.curated_links.other_relevant.length, 0),
  };
}

function main() {
  const input = readJsonSafe<HuntOutput>(INPUT_FILE, { results: [] as StudyHuntRow[] });
  const rows = input.results || [];

  if (!rows.length) {
    throw new Error("Nema rezultata u baltazar_study_page_documents_hunt.json.");
  }

  const curatedRows: CuratedStudyRow[] = rows.map((row) => {
    const links = dedupeByUrl(row.found_links || []);
    return {
      study: row.study,
      slug: row.slug,
      checked_pages: unique(row.checked_pages || []),
      curated_links: categorizeLinks(links),
    };
  });

  const totals = countTotals(curatedRows);
  const output: CuratedOutput = {
    generated_at: new Date().toISOString(),
    input_file: INPUT_FILE,
    summary: {
      studies: curatedRows.length,
      total_curated_links:
        totals.faculty +
        totals.schedules +
        totals.exam_dates +
        totals.practice +
        totals.final_thesis +
        totals.curriculum +
        totals.course_catalogue +
        totals.courses +
        totals.policy +
        totals.other_relevant,
      faculty: totals.faculty,
      schedules: totals.schedules,
      exam_dates: totals.exam_dates,
      practice: totals.practice,
      final_thesis: totals.final_thesis,
      curriculum: totals.curriculum,
      course_catalogue: totals.course_catalogue,
      courses: totals.courses,
      policy: totals.policy,
      other_relevant: totals.other_relevant,
    },
    results: curatedRows,
  };

  writeJson(OUTPUT_FILE, output);

  console.log("======================================");
  console.log("BALTAZAR STUDY PAGE DOCUMENT CURATION");
  console.log("======================================");
  console.log("Input :", INPUT_FILE);
  console.log("Output:", OUTPUT_FILE);
  console.log("--------------------------------------");
  console.log("Studies            :", output.summary.studies);
  console.log("Total curated links:", output.summary.total_curated_links);
  console.log("Faculty            :", output.summary.faculty);
  console.log("Schedules          :", output.summary.schedules);
  console.log("Exam dates         :", output.summary.exam_dates);
  console.log("Practice           :", output.summary.practice);
  console.log("Final thesis       :", output.summary.final_thesis);
  console.log("Curriculum         :", output.summary.curriculum);
  console.log("Course catalogue   :", output.summary.course_catalogue);
  console.log("Courses            :", output.summary.courses);
  console.log("Policy             :", output.summary.policy);
  console.log("Other relevant     :", output.summary.other_relevant);
  console.log("--------------------------------------");

  for (const row of curatedRows) {
    const total =
      row.curated_links.faculty.length +
      row.curated_links.schedules.length +
      row.curated_links.exam_dates.length +
      row.curated_links.practice.length +
      row.curated_links.final_thesis.length +
      row.curated_links.curriculum.length +
      row.curated_links.course_catalogue.length +
      row.curated_links.courses.length +
      row.curated_links.policy.length +
      row.curated_links.other_relevant.length;

    console.log(`${row.study}: ${total} kuriranih linkova`);
  }

  console.log("======================================");
  console.log("CURATION FINISHED");
  console.log("======================================");
}

main();
