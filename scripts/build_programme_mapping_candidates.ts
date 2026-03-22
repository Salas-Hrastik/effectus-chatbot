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

type ProgrammeGroup = {
  programme_group: string;
  normalized_key: string;
  course_count: number;
  courses: Array<{
    course: string;
    ects: string | null;
    year_semester_raw: string | null;
    teacher: string | null;
    coordinator: string | null;
    source_line_index: number | null;
  }>;
};

type AcademicModelV2 = {
  institution?: {
    name?: string;
    generated_at?: string;
    input_sources?: {
      source_map?: string | null;
      courses_file?: string | null;
      faculty_file?: string | null;
    };
  };
  studies?: Array<{
    study: string;
    slug: string;
    language: string[];
    delivery_mode: string[];
    location: string[];
    sources: StudySources;
    courses: unknown[];
  }>;
  faculty_index?: unknown[];
  shared_academic_sources?: string[];
  unassigned_programme_groups?: ProgrammeGroup[];
};

type CandidateRow = {
  programme_group: string;
  normalized_key: string;
  course_count: number;
  candidates: Array<{
    study: string;
    slug: string;
    score: number;
    reasons: string[];
  }>;
};

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");

const SOURCE_MAP_FILE = path.join(DATA_DIR, "baltazar_source_map.normalized.json");
const MODEL_V2_FILE = path.join(DATA_DIR, "baltazar_academic_model.seed.v2.json");
const OUTPUT_FILE = path.join(DATA_DIR, "baltazar_programme_mapping_candidates.json");

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

function tokenize(input: string): string[] {
  return unique(
    normalizeText(input)
      .split(/[^a-z0-9]+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 3)
  );
}

function normalizeProgrammeKey(raw: string): string {
  return normalizeText(raw)
    .replace(/\bundergraduate\b/g, "")
    .replace(/\bgraduate\b/g, "")
    .replace(/\bprofessional\b/g, "")
    .replace(/\bproffesional\b/g, "")
    .replace(/\bstudy\b/g, "")
    .replace(/\bstudies\b/g, "")
    .replace(/\bstudy program\b/g, "")
    .replace(/\bstudy programme\b/g, "")
    .replace(/\bprogramme\b/g, "")
    .replace(/\bprogram\b/g, "")
    .replace(/\bof\b/g, "")
    .replace(/\band\b/g, " ")
    .replace(/\bmanagament\b/g, "management")
    .replace(/\s+/g, " ")
    .trim();
}

function safeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((x) => String(x)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function buildStudyProfile(study: StudyBucket | any) {
  const studyName = normalizeWhitespace((study as any).study || "");
  const slug = normalizeWhitespace((study as any).slug || "");
  const location = safeArray((study as any).location);
  const deliveryMode = safeArray((study as any).delivery_mode);
  const sources = (study as any).sources || {};

  const textParts = [
    studyName,
    slug,
    ...location,
    ...deliveryMode,
    sources.study_page_hr || "",
    sources.study_page_en || "",
    ...safeArray(sources.other_sources),
  ];

  const normalized = normalizeText(textParts.join(" "));
  const tokens = tokenize(normalized);
  const keywords = new Set<string>(tokens);
  const semanticHints: string[] = [];

  if (normalized.includes("ekonom")) {
    keywords.add("economics");
    keywords.add("economy");
    keywords.add("business");
    semanticHints.push("economy/business");
  }
  if (normalized.includes("financ")) {
    keywords.add("finance");
    keywords.add("investment");
    keywords.add("investments");
    semanticHints.push("finance");
  }
  if (normalized.includes("projekt")) {
    keywords.add("project");
    keywords.add("projects");
    keywords.add("management");
    semanticHints.push("project");
  }
  if (normalized.includes("komunik")) {
    keywords.add("communication");
    keywords.add("communications");
    keywords.add("media");
    semanticHints.push("communication");
  }
  if (normalized.includes("turiz")) {
    keywords.add("tourism");
    keywords.add("hospitality");
    keywords.add("travel");
    semanticHints.push("tourism");
  }
  if (normalized.includes("kultur")) {
    keywords.add("culture");
    keywords.add("cultural");
    keywords.add("creative");
    semanticHints.push("culture");
  }
  if (normalized.includes("ured")) {
    keywords.add("office");
    keywords.add("organisation");
    keywords.add("organization");
    semanticHints.push("office");
  }
  if (normalized.includes("javnog")) {
    keywords.add("public");
    keywords.add("sector");
    semanticHints.push("public sector");
  }
  if (normalized.includes("integracija")) {
    keywords.add("integration");
    keywords.add("social");
    keywords.add("cultural");
    semanticHints.push("integration");
  }
  if (normalized.includes("primijenjena")) {
    keywords.add("applied");
    semanticHints.push("applied");
  }
  if (normalized.includes("biograd")) {
    keywords.add("biograd");
    semanticHints.push("biograd");
  }
  if (normalized.includes("osijek")) {
    keywords.add("osijek");
    semanticHints.push("osijek");
  }

  return {
    study: studyName,
    slug,
    keywords: [...keywords],
    semanticHints,
  };
}

function buildProgrammeProfile(group: ProgrammeGroup) {
  const programmeText = normalizeProgrammeKey(group.programme_group || "");
  const courseTitles = group.courses.map((c) => c.course || "").join(" ");
  const teacherText = group.courses
    .map((c) => `${c.teacher || ""} ${c.coordinator || ""}`)
    .join(" ");

  const combined = normalizeText(`${programmeText} ${courseTitles} ${teacherText}`);
  const keywords = new Set<string>(tokenize(combined));
  const semanticHints: string[] = [];

  if (programmeText.includes("business")) {
    keywords.add("business");
    keywords.add("economics");
    keywords.add("management");
    semanticHints.push("business");
  }
  if (programmeText.includes("management")) {
    keywords.add("management");
    semanticHints.push("management");
  }
  if (programmeText.includes("administration")) {
    keywords.add("administration");
    keywords.add("business");
    semanticHints.push("administration");
  }

  const titles = normalizeText(courseTitles);

  if (titles.includes("tourism")) {
    keywords.add("tourism");
    keywords.add("hospitality");
    semanticHints.push("tourism");
  }
  if (titles.includes("creative")) {
    keywords.add("creative");
    keywords.add("culture");
    keywords.add("cultural");
    semanticHints.push("creative/culture");
  }
  if (titles.includes("visual communications") || titles.includes("public relations")) {
    keywords.add("communication");
    keywords.add("communications");
    keywords.add("public");
    keywords.add("relations");
    semanticHints.push("communication");
  }
  if (titles.includes("office management") || titles.includes("e-organisation")) {
    keywords.add("office");
    keywords.add("organisation");
    keywords.add("organization");
    semanticHints.push("office");
  }
  if (titles.includes("project")) {
    keywords.add("project");
    semanticHints.push("project");
  }
  if (titles.includes("finance")) {
    keywords.add("finance");
    semanticHints.push("finance");
  }
  if (titles.includes("informatics")) {
    keywords.add("informatics");
    semanticHints.push("informatics");
  }
  if (titles.includes("sociology") || titles.includes("social corporate responsibility")) {
    keywords.add("social");
    semanticHints.push("social");
  }
  if (titles.includes("cultural and creative tourism")) {
    keywords.add("culture");
    keywords.add("cultural");
    keywords.add("tourism");
    semanticHints.push("culture/tourism");
  }

  return {
    programme_group: group.programme_group,
    normalized_key: group.normalized_key,
    course_count: group.course_count,
    keywords: [...keywords],
    semanticHints,
    course_titles: group.courses.map((c) => c.course),
  };
}

function scoreCandidate(programme: ReturnType<typeof buildProgrammeProfile>, study: ReturnType<typeof buildStudyProfile>) {
  let score = 0;
  const reasons: string[] = [];
  const programmeKeywords = new Set(programme.keywords);
  const studyKeywords = new Set(study.keywords);

  for (const kw of programmeKeywords) {
    if (studyKeywords.has(kw)) {
      score += 6;
      reasons.push(`shared keyword: ${kw}`);
    }
  }

  const pText = programme.normalized_key;
  const sText = normalizeText(`${study.study} ${study.slug}`);

  if (pText.includes("business") && (sText.includes("ekonom") || sText.includes("menadz"))) {
    score += 10;
    reasons.push("business ↔ ekonomija/menadžment");
  }

  if (pText.includes("management") && sText.includes("menadz")) {
    score += 8;
    reasons.push("management ↔ menadžment");
  }

  if (pText.includes("administration") && (sText.includes("ekonom") || sText.includes("menadz"))) {
    score += 5;
    reasons.push("administration ↔ ekonomija/menadžment");
  }

  const joinedHints = programme.semanticHints.join(" | ");

  if (joinedHints.includes("tourism") && sText.includes("turiz")) {
    score += 14;
    reasons.push("tourism signal");
  }

  if (joinedHints.includes("communication") && sText.includes("komunik")) {
    score += 14;
    reasons.push("communication signal");
  }

  if (joinedHints.includes("office") && sText.includes("ured")) {
    score += 14;
    reasons.push("office signal");
  }

  if (joinedHints.includes("finance") && sText.includes("financ")) {
    score += 14;
    reasons.push("finance signal");
  }

  if (joinedHints.includes("project") && sText.includes("projekt")) {
    score += 14;
    reasons.push("project signal");
  }

  if (joinedHints.includes("culture") && sText.includes("kultur")) {
    score += 14;
    reasons.push("culture signal");
  }

  if (joinedHints.includes("public sector") && sText.includes("javnog")) {
    score += 14;
    reasons.push("public-sector signal");
  }

  if (joinedHints.includes("integration") && sText.includes("integr")) {
    score += 14;
    reasons.push("integration signal");
  }

  if (joinedHints.includes("applied") && sText.includes("primijen")) {
    score += 10;
    reasons.push("applied signal");
  }

  if (sText.includes("biograd")) {
    score += 1;
    reasons.push("location variant: Biograd");
  }

  if (sText.includes("osijek")) {
    score += 1;
    reasons.push("location variant: Osijek");
  }

  return {
    score,
    reasons: unique(reasons),
  };
}

function main() {
  const sourceMap = readJsonSafe<{ studies?: StudyBucket[] }>(SOURCE_MAP_FILE, { studies: [] });
  const modelV2 = readJsonSafe<AcademicModelV2>(MODEL_V2_FILE, { studies: [], unassigned_programme_groups: [] });

  const studies = (sourceMap.studies || []).length ? (sourceMap.studies || []) : ((modelV2.studies || []) as any[]);
  const groups = modelV2.unassigned_programme_groups || [];

  if (!studies.length) {
    throw new Error("Nema studija u source map/model datoteci.");
  }

  if (!groups.length) {
    throw new Error("Nema unassigned programme groups u academic_model.seed.v2.json.");
  }

  const studyProfiles = studies.map((s) => buildStudyProfile(s as any));
  const candidateRows: CandidateRow[] = [];

  for (const group of groups) {
    const programmeProfile = buildProgrammeProfile(group);

    const ranked = studyProfiles
      .map((study) => {
        const result = scoreCandidate(programmeProfile, study);
        return {
          study: study.study,
          slug: study.slug,
          score: result.score,
          reasons: result.reasons,
        };
      })
      .sort((a, b) => b.score - a.score || a.study.localeCompare(b.study, "hr"))
      .slice(0, 6);

    candidateRows.push({
      programme_group: group.programme_group,
      normalized_key: group.normalized_key,
      course_count: group.course_count,
      candidates: ranked,
    });
  }

  writeJson(OUTPUT_FILE, {
    generated_at: new Date().toISOString(),
    input_files: {
      source_map: SOURCE_MAP_FILE,
      academic_model_v2: MODEL_V2_FILE,
    },
    candidate_rows: candidateRows,
  });

  console.log("======================================");
  console.log("BALTAZAR PROGRAMME MAPPING CANDIDATES");
  console.log("======================================");
  console.log("Input source map :", SOURCE_MAP_FILE);
  console.log("Input model v2   :", MODEL_V2_FILE);
  console.log("Output           :", OUTPUT_FILE);
  console.log("--------------------------------------");
  console.log("Studies          :", studies.length);
  console.log("Programme groups :", groups.length);
  console.log("--------------------------------------");

  for (const row of candidateRows) {
    console.log(`PROGRAMME GROUP: ${row.programme_group}`);
    console.log(`Normalized key : ${row.normalized_key}`);
    console.log(`Course count   : ${row.course_count}`);
    console.log("Top candidates :");
    row.candidates.forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.study} | score=${c.score}`);
      if (c.reasons.length) {
        console.log(`     reasons: ${c.reasons.join("; ")}`);
      }
    });
    console.log("--------------------------------------");
  }

  console.log("======================================");
  console.log("CANDIDATE BUILD FINISHED");
  console.log("======================================");
}

main();
