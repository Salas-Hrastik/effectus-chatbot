import fs from "fs";
import path from "path";

type NormalizedFacultyProfile = {
  name: string;
  slug: string;
  profile_url: string;
  cleaned_title: string | null;
  email: string | null;
  consultations: string | null;
  phone: string | null;
  related_studies: string[];
  extracted_from_pages: string[];
  raw_summary: string | null;
};

type FacultyNormalizedFile = {
  generated_at?: string;
  input_file?: string;
  summary?: {
    profiles?: number;
    with_email?: number;
    with_consultations?: number;
    with_phone?: number;
    with_cleaned_title?: number;
  };
  profiles?: NormalizedFacultyProfile[];
};

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
  generated_at: string;
  input_file: string;
  summary: {
    total_teachers: number;
    high_quality: number;
    medium_quality: number;
    low_quality: number;
    with_email: number;
    with_phone: number;
    with_consultations: number;
    with_title: number;
    with_related_studies: number;
  };
  teachers: TeacherRegistryRow[];
};

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const INPUT_FILE = path.join(DATA_DIR, "baltazar_faculty_profiles.normalized.json");
const OUTPUT_FILE = path.join(DATA_DIR, "baltazar_teacher_registry.json");

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

function slugify(input: string): string {
  return normalizeText(input)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function unique(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean).map((x) => normalizeWhitespace(x)))];
}

function cleanEmail(email: string | null): string | null {
  const e = normalizeWhitespace(email || "").toLowerCase();
  if (!e) return null;
  const m = e.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  return m ? m[0] : null;
}

function cleanPhone(phone: string | null): string | null {
  const p = normalizeWhitespace(phone || "");
  if (!p) return null;
  return p.length >= 8 ? p : null;
}

function cleanConsultations(value: string | null): string | null {
  const v = normalizeWhitespace(value || "");
  return v || null;
}

function cleanTitle(value: string | null): string | null {
  const v = normalizeWhitespace(value || "");
  return v || null;
}

function buildTeacherId(name: string, slug: string): string {
  const base = slug || slugify(name);
  return `teacher_${base}`;
}

function computeQuality(row: Omit<TeacherRegistryRow, "data_quality">): TeacherRegistryRow["data_quality"] {
  const hasTitle = !!row.title;
  const hasEmail = !!row.email;
  const hasPhone = !!row.phone;
  const hasConsultations = !!row.consultations;
  const hasRelatedStudies = (row.related_studies || []).length > 0;

  let score = 0;
  if (hasTitle) score += 20;
  if (hasEmail) score += 25;
  if (hasPhone) score += 15;
  if (hasConsultations) score += 25;
  if (hasRelatedStudies) score += 15;

  let label: "high" | "medium" | "low" = "low";
  if (score >= 70) label = "high";
  else if (score >= 40) label = "medium";

  return {
    has_title: hasTitle,
    has_email: hasEmail,
    has_phone: hasPhone,
    has_consultations: hasConsultations,
    has_related_studies: hasRelatedStudies,
    score,
    label,
  };
}

function main() {
  const input = readJsonSafe<FacultyNormalizedFile>(INPUT_FILE, { profiles: [] });
  const profiles = input.profiles || [];

  if (!profiles.length) {
    throw new Error("Nema profila u baltazar_faculty_profiles.normalized.json.");
  }

  const teachers: TeacherRegistryRow[] = profiles
    .map((p) => {
      const base = {
        teacher_id: buildTeacherId(p.name, p.slug),
        name: normalizeWhitespace(p.name),
        slug: normalizeWhitespace(p.slug) || slugify(p.name),
        profile_url: normalizeWhitespace(p.profile_url),
        title: cleanTitle(p.cleaned_title),
        email: cleanEmail(p.email),
        phone: cleanPhone(p.phone),
        consultations: cleanConsultations(p.consultations),
        related_studies: unique(p.related_studies || []),
        extracted_from_pages: unique(p.extracted_from_pages || []),
        raw_summary: normalizeWhitespace(p.raw_summary || "") || null,
      };

      return {
        ...base,
        data_quality: computeQuality(base),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "hr"));

  const output: TeacherRegistryFile = {
    generated_at: new Date().toISOString(),
    input_file: INPUT_FILE,
    summary: {
      total_teachers: teachers.length,
      high_quality: teachers.filter((t) => t.data_quality.label === "high").length,
      medium_quality: teachers.filter((t) => t.data_quality.label === "medium").length,
      low_quality: teachers.filter((t) => t.data_quality.label === "low").length,
      with_email: teachers.filter((t) => !!t.email).length,
      with_phone: teachers.filter((t) => !!t.phone).length,
      with_consultations: teachers.filter((t) => !!t.consultations).length,
      with_title: teachers.filter((t) => !!t.title).length,
      with_related_studies: teachers.filter((t) => t.related_studies.length > 0).length,
    },
    teachers,
  };

  writeJson(OUTPUT_FILE, output);

  console.log("======================================");
  console.log("BALTAZAR TEACHER REGISTRY");
  console.log("======================================");
  console.log("Input :", INPUT_FILE);
  console.log("Output:", OUTPUT_FILE);
  console.log("--------------------------------------");
  console.log("Total teachers      :", output.summary.total_teachers);
  console.log("High quality        :", output.summary.high_quality);
  console.log("Medium quality      :", output.summary.medium_quality);
  console.log("Low quality         :", output.summary.low_quality);
  console.log("With email          :", output.summary.with_email);
  console.log("With phone          :", output.summary.with_phone);
  console.log("With consultations  :", output.summary.with_consultations);
  console.log("With title          :", output.summary.with_title);
  console.log("With related studies:", output.summary.with_related_studies);
  console.log("--------------------------------------");

  output.teachers.slice(0, 20).forEach((t, i) => {
    console.log(`${i + 1}. ${t.name}`);
    console.log(`   id: ${t.teacher_id}`);
    console.log(`   title: ${t.title || "-"}`);
    console.log(`   email: ${t.email || "-"}`);
    console.log(`   phone: ${t.phone || "-"}`);
    console.log(`   quality: ${t.data_quality.label} (${t.data_quality.score})`);
  });

  console.log("======================================");
  console.log("REGISTRY BUILD FINISHED");
  console.log("======================================");
}

main();
