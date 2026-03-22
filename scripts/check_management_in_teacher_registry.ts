import fs from "fs";
import path from "path";

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

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const INPUT_FILE = path.join(DATA_DIR, "baltazar_teacher_registry.json");

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

function looksLikeManagementMember(t: TeacherRegistryRow): boolean {
  const hay = normalizeText(
    [
      t.name || "",
      t.title || "",
      t.raw_summary || "",
      t.profile_url || "",
    ].join(" ")
  );

  const signals = [
    "uprava",
    "dekan",
    "prodekan",
    "prodekanica",
    "rektor",
    "rector",
    "vice dean",
    "dean",
    "management",
    "management board",
    "predsjednik uprave",
    "clan uprave",
    "član uprave",
    "ravnatelj",
    "direktor",
  ];

  return signals.some((s) => hay.includes(normalizeText(s)));
}

function main() {
  const input = readJsonSafe<TeacherRegistryFile>(INPUT_FILE, { teachers: [] });
  const teachers = input.teachers || [];

  if (!teachers.length) {
    throw new Error("Nema nastavnika u baltazar_teacher_registry.json.");
  }

  const managementMembers = teachers.filter(looksLikeManagementMember);

  console.log("======================================");
  console.log("CHECK MANAGEMENT IN TEACHER REGISTRY");
  console.log("======================================");
  console.log("Input :", INPUT_FILE);
  console.log("--------------------------------------");
  console.log("Total teachers in registry :", teachers.length);
  console.log("Potential management members:", managementMembers.length);
  console.log("--------------------------------------");

  if (!managementMembers.length) {
    console.log("Nijedan član uprave nije automatski prepoznat heuristikom.");
    console.log("To ne mora značiti da ih nema, nego da njihove profilne stranice ne sadrže dovoljno jasne oznake.");
  } else {
    managementMembers.forEach((t, i) => {
      console.log(`${i + 1}. ${t.name}`);
      console.log(`   title: ${t.title || "-"}`);
      console.log(`   email: ${t.email || "-"}`);
      console.log(`   profile: ${t.profile_url || "-"}`);
    });
  }

  console.log("======================================");
  console.log("CHECK FINISHED");
  console.log("======================================");
}

main();
