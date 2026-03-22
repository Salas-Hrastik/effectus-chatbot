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

type CourseRow = {
  course?: string;
  title?: string;
  courseName?: string;
  name?: string;
  ects?: string | number | null;
  studyProgrammeRaw?: string | null;
  yearSemesterRaw?: string | null;
  coordinatorRaw?: string | null;
  instructorRaw?: string | null;
  coordinatorNames?: string[];
  instructorNames?: string[];
  sourceLineIndex?: number | null;
};

type TeacherCourseLink = {
  teacher_name: string;
  matched_faculty_profile: {
    name: string;
    profile_url: string;
    cleaned_title: string | null;
    email: string | null;
    consultations: string | null;
    phone: string | null;
    related_studies: string[];
  } | null;
  match_confidence: "high" | "medium" | "low";
  matched_by: "exact_name" | "normalized_name" | "not_found";
  courses: Array<{
    course: string;
    role: "instructor" | "coordinator";
    ects: string | null;
    study_programme_raw: string | null;
    year_semester_raw: string | null;
    source_line_index: number | null;
  }>;
};

type OutputFile = {
  generated_at: string;
  input_files: {
    faculty_profiles: string;
    courses_file: string;
  };
  summary: {
    unique_teachers_from_courses: number;
    matched_profiles: number;
    unmatched_teachers: number;
    total_course_links: number;
  };
  links: TeacherCourseLink[];
};

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const FACULTY_FILE = path.join(DATA_DIR, "baltazar_faculty_profiles.normalized.json");
const COURSES_FILE = path.join(DATA_DIR, "baltazar_courses_from_general_information.json");
const OUTPUT_FILE = path.join(DATA_DIR, "baltazar_teacher_course_links.json");

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

function safeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((x) => normalizeWhitespace(String(x))).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [normalizeWhitespace(value)];
  return [];
}

function pickCourseName(row: CourseRow): string {
  return normalizeWhitespace(
    row.course ||
      row.title ||
      row.courseName ||
      row.name ||
      ""
  );
}

function normalizePersonName(name: string): string {
  let s = normalizeText(name);

  s = s
    .replace(/\bdr\b/g, " ")
    .replace(/\bsc\b/g, " ")
    .replace(/\bmr\b/g, " ")
    .replace(/\bdocent\b/g, " ")
    .replace(/\bdoc\.\b/g, " ")
    .replace(/\bprofesor\b/g, " ")
    .replace(/\bprof\b/g, " ")
    .replace(/\bvisi predavac\b/g, " ")
    .replace(/\bviši predavač\b/g, " ")
    .replace(/\bpredavac\b/g, " ")
    .replace(/\bpredavač\b/g, " ")
    .replace(/\blecturer\b/g, " ")
    .replace(/\bsenior lecturer\b/g, " ")
    .replace(/\bassistant professor\b/g, " ")
    .replace(/\bassociate professor\b/g, " ")
    .replace(/\bfull professor\b/g, " ")
    .replace(/\bmag\b/g, " ")
    .replace(/\bdipl\b/g, " ")
    .replace(/\buniv\b/g, " ")
    .replace(/\bspec\b/g, " ")
    .replace(/\bbacc\b/g, " ")
    .replace(/\boec\b/g, " ")
    .replace(/\biur\b/g, " ")
    .replace(/\bcomm\b/g, " ")
    .replace(/\bart\b/g, " ")
    .replace(/\bpsych\b/g, " ")
    .replace(/\bmba\b/g, " ")
    .replace(/\bet\b/g, " ")
    .replace(/\bphilol\b/g, " ")
    .replace(/\bcroat\b/g, " ")
    .replace(/\blitt\b/g, " ")
    .replace(/\bcomp\b/g, " ")
    .replace(/\bsocio\b/g, " ")
    .replace(/[.,/()\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return s;
}

function extractTeacherNamesFromCourse(row: CourseRow): Array<{ name: string; role: "instructor" | "coordinator" }> {
  const out: Array<{ name: string; role: "instructor" | "coordinator" }> = [];

  for (const n of safeArray(row.instructorNames)) {
    out.push({ name: n, role: "instructor" });
  }

  for (const n of safeArray(row.coordinatorNames)) {
    out.push({ name: n, role: "coordinator" });
  }

  // fallback ako nema parsed names
  if (!out.length) {
    const instructorRaw = normalizeWhitespace(row.instructorRaw || "");
    const coordinatorRaw = normalizeWhitespace(row.coordinatorRaw || "");

    if (instructorRaw) out.push({ name: instructorRaw, role: "instructor" });
    if (coordinatorRaw) out.push({ name: coordinatorRaw, role: "coordinator" });
  }

  // dedupe by normalized name + role
  const seen = new Set<string>();
  return out.filter((x) => {
    const key = `${normalizePersonName(x.name)}|${x.role}`;
    if (!normalizePersonName(x.name)) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findBestFacultyMatch(
  teacherName: string,
  facultyProfiles: NormalizedFacultyProfile[]
): {
  profile: NormalizedFacultyProfile | null;
  confidence: "high" | "medium" | "low";
  matchedBy: "exact_name" | "normalized_name" | "not_found";
} {
  const exact = facultyProfiles.find(
    (p) => normalizeWhitespace(p.name) === normalizeWhitespace(teacherName)
  );
  if (exact) {
    return {
      profile: exact,
      confidence: "high",
      matchedBy: "exact_name",
    };
  }

  const teacherNorm = normalizePersonName(teacherName);
  const normalizedMatches = facultyProfiles.filter(
    (p) => normalizePersonName(p.name) === teacherNorm
  );

  if (normalizedMatches.length === 1) {
    return {
      profile: normalizedMatches[0],
      confidence: "medium",
      matchedBy: "normalized_name",
    };
  }

  return {
    profile: null,
    confidence: "low",
    matchedBy: "not_found",
  };
}

function main() {
  const facultyFile = readJsonSafe<FacultyNormalizedFile>(FACULTY_FILE, { profiles: [] });
  const facultyProfiles = facultyFile.profiles || [];
  const courseRows = readJsonSafe<CourseRow[]>(COURSES_FILE, []);

  if (!facultyProfiles.length) {
    throw new Error("Nema faculty profila u baltazar_faculty_profiles.normalized.json.");
  }

  if (!courseRows.length) {
    throw new Error("Nema kolegija u baltazar_courses_from_general_information.json.");
  }

  const teacherMap = new Map<string, TeacherCourseLink>();

  for (const row of courseRows) {
    const courseName = pickCourseName(row);
    if (!courseName) continue;

    const teachers = extractTeacherNamesFromCourse(row);

    for (const teacher of teachers) {
      const teacherKey = normalizeWhitespace(teacher.name);
      if (!teacherKey) continue;

      if (!teacherMap.has(teacherKey)) {
        const match = findBestFacultyMatch(teacher.name, facultyProfiles);

        teacherMap.set(teacherKey, {
          teacher_name: teacher.name,
          matched_faculty_profile: match.profile
            ? {
                name: match.profile.name,
                profile_url: match.profile.profile_url,
                cleaned_title: match.profile.cleaned_title,
                email: match.profile.email,
                consultations: match.profile.consultations,
                phone: match.profile.phone,
                related_studies: unique(match.profile.related_studies || []),
              }
            : null,
          match_confidence: match.confidence,
          matched_by: match.matchedBy,
          courses: [],
        });
      }

      const current = teacherMap.get(teacherKey)!;
      current.courses.push({
        course: courseName,
        role: teacher.role,
        ects: row.ects != null && String(row.ects).trim() ? String(row.ects).trim() : null,
        study_programme_raw: normalizeWhitespace(row.studyProgrammeRaw || "") || null,
        year_semester_raw: normalizeWhitespace(row.yearSemesterRaw || "") || null,
        source_line_index: row.sourceLineIndex ?? null,
      });
    }
  }

  const links = [...teacherMap.values()]
    .map((x) => ({
      ...x,
      courses: x.courses.sort((a, b) => {
        const byCourse = a.course.localeCompare(b.course, "hr");
        if (byCourse !== 0) return byCourse;
        return a.role.localeCompare(b.role, "hr");
      }),
    }))
    .sort((a, b) => a.teacher_name.localeCompare(b.teacher_name, "hr"));

  const output: OutputFile = {
    generated_at: new Date().toISOString(),
    input_files: {
      faculty_profiles: FACULTY_FILE,
      courses_file: COURSES_FILE,
    },
    summary: {
      unique_teachers_from_courses: links.length,
      matched_profiles: links.filter((x) => !!x.matched_faculty_profile).length,
      unmatched_teachers: links.filter((x) => !x.matched_faculty_profile).length,
      total_course_links: links.reduce((n, x) => n + x.courses.length, 0),
    },
    links,
  };

  writeJson(OUTPUT_FILE, output);

  console.log("======================================");
  console.log("BALTAZAR TEACHER-COURSE LINKS");
  console.log("======================================");
  console.log("Input faculty :", FACULTY_FILE);
  console.log("Input courses :", COURSES_FILE);
  console.log("Output        :", OUTPUT_FILE);
  console.log("--------------------------------------");
  console.log("Unique teachers from courses :", output.summary.unique_teachers_from_courses);
  console.log("Matched profiles             :", output.summary.matched_profiles);
  console.log("Unmatched teachers           :", output.summary.unmatched_teachers);
  console.log("Total course links           :", output.summary.total_course_links);
  console.log("--------------------------------------");

  output.links.slice(0, 20).forEach((row, i) => {
    console.log(`${i + 1}. ${row.teacher_name}`);
    console.log(`   matched_by: ${row.matched_by}`);
    console.log(`   confidence: ${row.match_confidence}`);
    console.log(`   faculty_profile: ${row.matched_faculty_profile?.profile_url || "-"}`);
    console.log(`   courses: ${row.courses.map((c) => c.course).join(" | ") || "-"}`);
  });

  console.log("======================================");
  console.log("LINK BUILD FINISHED");
  console.log("======================================");
}

main();
