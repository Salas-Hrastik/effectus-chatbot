import fs from "fs";
import path from "path";

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

type NormalizedFacultyOutput = {
  generated_at: string;
  input_file: string;
  summary: {
    profiles: number;
    with_email: number;
    with_consultations: number;
    with_phone: number;
    with_cleaned_title: number;
  };
  profiles: NormalizedFacultyProfile[];
};

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const INPUT_FILE = path.join(DATA_DIR, "baltazar_faculty_profiles.json");
const OUTPUT_FILE = path.join(DATA_DIR, "baltazar_faculty_profiles.normalized.json");

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

function cleanEmail(email: string | null): string | null {
  const e = normalizeWhitespace(email || "").toLowerCase();
  if (!e) return null;
  const m = e.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  return m ? m[0] : null;
}

function cleanPhone(phone: string | null): string | null {
  const p = normalizeWhitespace(phone || "");
  if (!p) return null;
  if (p.length < 8) return null;
  return p;
}

function looksLikeBiography(text: string): boolean {
  const t = normalizeText(text);
  if (!t) return false;

  const bioSignals = [
    "podijeli s drugima",
    "trenutno je",
    "obnasao je",
    "obnašao je",
    "radio je",
    "radi kao",
    "predaje na raznim",
    "osnivac je",
    "osnivač je",
    "pridruzuje se",
    "pridružuje se",
    "karijer",
    "biograf",
  ];

  return bioSignals.some((x) => t.includes(x));
}

function cleanConsultations(value: string | null): string | null {
  const raw = normalizeWhitespace(value || "");
  if (!raw) return null;

  if (looksLikeBiography(raw)) return null;

  const parts = raw
    .split("|")
    .map((x) => normalizeWhitespace(x))
    .filter(Boolean);

  const kept = parts.filter((part) => {
    const t = normalizeText(part);

    const positive =
      t.includes("konzult") ||
      t.includes("consultation") ||
      t.includes("office hours") ||
      t.includes("ponedjeljak") ||
      t.includes("utorak") ||
      t.includes("srijeda") ||
      t.includes("cetvrtak") ||
      t.includes("četvrtak") ||
      t.includes("petak") ||
      t.includes("subota") ||
      t.includes("nedjelja") ||
      t.includes("monday") ||
      t.includes("tuesday") ||
      t.includes("wednesday") ||
      t.includes("thursday") ||
      t.includes("friday") ||
      t.includes("saturday") ||
      t.includes("sunday") ||
      /\b\d{1,2}[:.]\d{2}\b/.test(part);

    const negative =
      t.includes("podijeli s drugima") ||
      t.includes("prijediplomski studiji") ||
      t.includes("diplomski studiji") ||
      t.includes("bio") ||
      t.includes("biograf") ||
      t.includes("karijer") ||
      t.includes("trenutno je") ||
      t.includes("radio je") ||
      t.includes("obnasao je") ||
      t.includes("obnašao je");

    return positive && !negative;
  });

  const cleaned = unique(kept).join(" | ");
  return cleaned || null;
}

function cleanTitle(profile: FacultyProfile): string | null {
  const candidates = [
    profile.title || "",
    profile.name || "",
    profile.raw_summary || "",
  ]
    .map(normalizeWhitespace)
    .filter(Boolean);

  const titlePatterns = [
    /redoviti profesor/i,
    /izvanredni profesor/i,
    /docent/i,
    /profesor visoke skole/i,
    /profesor visoke škole/i,
    /viši predavač/i,
    /visi predavac/i,
    /predavač/i,
    /predavac/i,
    /assistant professor/i,
    /associate professor/i,
    /full professor/i,
    /senior lecturer/i,
    /lecturer/i,
    /prof\.\s*struc\.\s*stud\./i,
    /prof\.\s*struč\.\s*stud\./i,
    /v\.\s*pred\./i,
  ];

  for (const candidate of candidates) {
    for (const rx of titlePatterns) {
      const m = candidate.match(rx);
      if (m) {
        return normalizeWhitespace(m[0]);
      }
    }
  }

  return null;
}

function cleanName(name: string): string {
  return normalizeWhitespace(name)
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
}

function main() {
  const input = readJsonSafe<FacultyOutput>(INPUT_FILE, {
    profiles: [] as FacultyProfile[],
  });

  const profiles = input.profiles || [];
  if (!profiles.length) {
    throw new Error("Nema profila u baltazar_faculty_profiles.json.");
  }

  const normalized: NormalizedFacultyProfile[] = profiles.map((p) => ({
    name: cleanName(p.name),
    slug: p.slug,
    profile_url: p.profile_url,
    cleaned_title: cleanTitle(p),
    email: cleanEmail(p.email),
    consultations: cleanConsultations(p.consultations),
    phone: cleanPhone(p.phone),
    related_studies: unique(p.related_studies || []),
    extracted_from_pages: unique(p.extracted_from_pages || []),
    raw_summary: normalizeWhitespace(p.raw_summary || "") || null,
  }));

  normalized.sort((a, b) => a.name.localeCompare(b.name, "hr"));

  const output: NormalizedFacultyOutput = {
    generated_at: new Date().toISOString(),
    input_file: INPUT_FILE,
    summary: {
      profiles: normalized.length,
      with_email: normalized.filter((p) => !!p.email).length,
      with_consultations: normalized.filter((p) => !!p.consultations).length,
      with_phone: normalized.filter((p) => !!p.phone).length,
      with_cleaned_title: normalized.filter((p) => !!p.cleaned_title).length,
    },
    profiles: normalized,
  };

  writeJson(OUTPUT_FILE, output);

  console.log("======================================");
  console.log("BALTAZAR FACULTY PROFILE NORMALIZATION");
  console.log("======================================");
  console.log("Input :", INPUT_FILE);
  console.log("Output:", OUTPUT_FILE);
  console.log("--------------------------------------");
  console.log("Profiles          :", output.summary.profiles);
  console.log("With email        :", output.summary.with_email);
  console.log("With consultations:", output.summary.with_consultations);
  console.log("With phone        :", output.summary.with_phone);
  console.log("With cleaned title:", output.summary.with_cleaned_title);
  console.log("--------------------------------------");

  output.profiles.slice(0, 20).forEach((p, i) => {
    console.log(`${i + 1}. ${p.name}`);
    console.log(`   cleaned_title: ${p.cleaned_title || "-"}`);
    console.log(`   email: ${p.email || "-"}`);
    console.log(`   consultations: ${p.consultations || "-"}`);
  });

  console.log("======================================");
  console.log("NORMALIZATION FINISHED");
  console.log("======================================");
}

main();
