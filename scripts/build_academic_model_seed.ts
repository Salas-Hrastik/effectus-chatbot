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
  sources: StudySources;
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
  studies?: StudyBucket[];
  faculty_sources?: string[];
  shared_academic_sources?: string[];
  crawl_meta?: {
    generated_at?: string;
    crawled_pages?: number;
    discovered_urls?: number;
    max_pages?: number;
    domain?: string;
  };
};

type CourseRow = {
  course?: string;
  title?: string;
  courseName?: string;
  name?: string;
  ects?: string | number | null;
  semester?: string | number | null;
  teacher?: string | null;
  instructor?: string | null;
  coordinator?: string | null;
  assistant?: string | null;
  literature?: string[] | string | null;
  learning_outcomes?: string[] | string | null;
  study?: string | null;
  study_programme?: string | null;
  programme?: string | null;
};

type FacultyRow = {
  name?: string;
  fullName?: string;
  teacher?: string;
  instructor?: string;
  coordinator?: string;
  consultation?: string | null;
  consultations?: string | null;
  email?: string | null;
  title?: string | null;
};

type AcademicCourse = {
  course: string;
  ects: string | null;
  semester: string | null;
  teacher: string | null;
  assistant: string | null;
  literature: string[];
  learning_outcomes: string[];
  source_hint: string | null;
};

type AcademicStudy = {
  study: string;
  slug: string;
  language: string[];
  delivery_mode: string[];
  location: string[];
  sources: {
    study_page_hr: string | null;
    study_page_en: string | null;
    curriculum_pdfs: string[];
    course_catalogues: string[];
    schedules: string[];
    exam_dates: string[];
    practice_info: string[];
    final_thesis_info: string[];
    faculty_pages: string[];
    policies: string[];
    other_sources: string[];
  };
  courses: AcademicCourse[];
};

type AcademicModel = {
  institution: {
    name: string;
    generated_at: string;
    input_sources: {
      source_map: string;
      courses_file: string | null;
      faculty_file: string | null;
    };
  };
  studies: AcademicStudy[];
  faculty_index: Array<{
    name: string;
    consultation: string | null;
    email: string | null;
    title: string | null;
    related_courses: string[];
  }>;
  shared_academic_sources: string[];
};

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");

const SOURCE_MAP_FILE = path.join(DATA_DIR, "baltazar_source_map.normalized.json");
const COURSES_FILE = path.join(DATA_DIR, "baltazar_courses_from_general_information.json");
const FACULTY_FILE = path.join(DATA_DIR, "baltazar_faculty_from_general_information.json");
const OUTPUT_FILE = path.join(DATA_DIR, "baltazar_academic_model.seed.json");

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
  if (Array.isArray(value)) {
    return value.map((x) => normalizeWhitespace(String(x))).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [normalizeWhitespace(value)];
  }
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

function pickTeacher(row: CourseRow): string | null {
  return normalizeWhitespace(
    row.teacher ||
      row.instructor ||
      row.coordinator ||
      ""
  ) || null;
}

function pickAssistant(row: CourseRow): string | null {
  return normalizeWhitespace(row.assistant || "") || null;
}

function pickStudyNameFromCourse(row: CourseRow): string {
  return normalizeWhitespace(
    row.study ||
      row.study_programme ||
      row.programme ||
      ""
  );
}

function normalizeStudyKey(study: string): string {
  return normalizeText(study)
    .replace(/\(biograd n\/m\)/g, " biograd")
    .replace(/\(osijek\)/g, " osijek")
    .trim();
}

function buildStudyPatterns(study: StudyBucket): string[] {
  const items = [
    study.study || "",
    study.slug || "",
    ...(study.location || []),
  ];

  const joined = normalizeText(items.join(" "));
  const words = joined
    .split(/[^a-z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4);

  const extras: string[] = [];

  if (joined.includes("turiz")) extras.push("turizam", "tourism", "ugostiteljstvo", "hospitality");
  if (joined.includes("menadz")) extras.push("management", "menadzment");
  if (joined.includes("informat")) extras.push("informatics", "business informatics");
  if (joined.includes("financ")) extras.push("finance", "financije", "investicije", "investments");
  if (joined.includes("projekt")) extras.push("project", "project management", "projektni menadzment");
  if (joined.includes("komunik")) extras.push("communication", "komunikacijski");
  if (joined.includes("kultur")) extras.push("culture", "cultural", "kulturni");
  if (joined.includes("javnog sektora")) extras.push("public sector", "javni sektor");
  if (joined.includes("uredskog")) extras.push("office", "office management");
  if (joined.includes("biograd")) extras.push("biograd");
  if (joined.includes("osijek")) extras.push("osijek");

  return unique([...words, ...extras]);
}

function scoreStudyCourseMatch(course: CourseRow, study: StudyBucket): number {
  const explicitStudy = normalizeStudyKey(pickStudyNameFromCourse(course));
  const studyName = normalizeStudyKey(study.study || "");
  const courseTeacher = normalizeText(pickTeacher(course) || "");
  const courseName = normalizeText(pickCourseName(course));

  let score = 0;

  if (explicitStudy && explicitStudy === studyName) score += 100;
  if (explicitStudy && study.slug && explicitStudy.includes(normalizeText(study.slug))) score += 80;

  const patterns = buildStudyPatterns(study);
  for (const p of patterns) {
    if (explicitStudy.includes(normalizeText(p))) score += 8;
  }

  const studyUrls = [
    study.sources?.study_page_hr || "",
    study.sources?.study_page_en || "",
    ...(study.sources?.other_sources || []),
  ]
    .join(" ")
    .toLowerCase();

  for (const p of patterns) {
    if (studyUrls.includes(p)) score += 1;
  }

  if (courseTeacher && studyName.includes("turiz") && /(hospitality|tourism|turizam|ugostiteljstvo)/.test(courseName)) {
    score += 2;
  }

  return score;
}

function findBestStudyForCourse(course: CourseRow, studies: StudyBucket[]): string | null {
  let bestStudy: string | null = null;
  let bestScore = 0;

  for (const study of studies) {
    const score = scoreStudyCourseMatch(course, study);
    if (score > bestScore) {
      bestScore = score;
      bestStudy = study.study;
    }
  }

  return bestScore >= 8 ? bestStudy : null;
}

function normalizeCourse(row: CourseRow): AcademicCourse | null {
  const courseName = pickCourseName(row);
  if (!courseName) return null;

  return {
    course: courseName,
    ects: row.ects != null && String(row.ects).trim() ? String(row.ects).trim() : null,
    semester: row.semester != null && String(row.semester).trim() ? String(row.semester).trim() : null,
    teacher: pickTeacher(row),
    assistant: pickAssistant(row),
    literature: unique(safeArray(row.literature)),
    learning_outcomes: unique(safeArray(row.learning_outcomes)),
    source_hint: pickStudyNameFromCourse(row) || null,
  };
}

function buildFacultyIndex(facultyRows: FacultyRow[], studies: AcademicStudy[]): AcademicModel["faculty_index"] {
  const courseTeacherMap = new Map<string, string[]>();

  for (const study of studies) {
    for (const course of study.courses) {
      const teacher = normalizeWhitespace(course.teacher || "");
      if (!teacher) continue;
      const arr = courseTeacherMap.get(teacher) || [];
      if (!arr.includes(course.course)) arr.push(course.course);
      courseTeacherMap.set(teacher, arr);
    }
  }

  const map = new Map<string, AcademicModel["faculty_index"][number]>();

  for (const row of facultyRows) {
    const name =
      normalizeWhitespace(
        row.name ||
          row.fullName ||
          row.teacher ||
          row.instructor ||
          row.coordinator ||
          ""
      );

    if (!name) continue;

    if (!map.has(name)) {
      map.set(name, {
        name,
        consultation: normalizeWhitespace(
          row.consultation ||
            row.consultations ||
            ""
        ) || null,
        email: normalizeWhitespace(row.email || "") || null,
        title: normalizeWhitespace(row.title || "") || null,
        related_courses: unique(courseTeacherMap.get(name) || []),
      });
    } else {
      const existing = map.get(name)!;
      if (!existing.consultation) {
        existing.consultation =
          normalizeWhitespace(row.consultation || row.consultations || "") || null;
      }
      if (!existing.email) {
        existing.email = normalizeWhitespace(row.email || "") || null;
      }
      if (!existing.title) {
        existing.title = normalizeWhitespace(row.title || "") || null;
      }
      existing.related_courses = unique([
        ...existing.related_courses,
        ...(courseTeacherMap.get(name) || []),
      ]);
    }
  }

  for (const [teacher, relatedCourses] of courseTeacherMap.entries()) {
    if (!map.has(teacher)) {
      map.set(teacher, {
        name: teacher,
        consultation: null,
        email: null,
        title: null,
        related_courses: unique(relatedCourses),
      });
    }
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "hr"));
}

function cloneSources(s: StudySources): AcademicStudy["sources"] {
  return {
    study_page_hr: s.study_page_hr || null,
    study_page_en: s.study_page_en || null,
    curriculum_pdfs: unique(safeArray(s.curriculum_pdfs)),
    course_catalogues: unique(safeArray(s.course_catalogues)),
    schedules: unique(safeArray(s.schedules)),
    exam_dates: unique(safeArray(s.exam_dates)),
    practice_info: unique(safeArray(s.practice_info)),
    final_thesis_info: unique(safeArray(s.final_thesis_info)),
    faculty_pages: unique(safeArray(s.faculty_pages)),
    policies: unique(safeArray(s.policies)),
    other_sources: unique(safeArray(s.other_sources)),
  };
}

function main() {
  const sourceMap = readJsonSafe<SourceMap>(SOURCE_MAP_FILE, {});
  const courseRows = readJsonSafe<CourseRow[]>(COURSES_FILE, []);
  const facultyRows = readJsonSafe<FacultyRow[]>(FACULTY_FILE, []);

  const studies = (sourceMap.studies || []).map((study) => ({
    study: study.study,
    slug: study.slug || "",
    language: unique(safeArray(study.language)),
    delivery_mode: unique(safeArray(study.delivery_mode)),
    location: unique(safeArray(study.location)),
    sources: cloneSources(study.sources || {}),
    courses: [] as AcademicCourse[],
  })) as AcademicStudy[];

  const studyIndex = new Map<string, AcademicStudy>();
  for (const study of studies) {
    studyIndex.set(study.study, study);
  }

  let matchedCourses = 0;
  let unmatchedCourses = 0;

  for (const row of courseRows) {
    const normalized = normalizeCourse(row);
    if (!normalized) continue;

    const bestStudy = findBestStudyForCourse(row, sourceMap.studies || []);
    if (bestStudy && studyIndex.has(bestStudy)) {
      const targetStudy = studyIndex.get(bestStudy)!;
      const exists = targetStudy.courses.some(
        (c) => normalizeText(c.course) === normalizeText(normalized.course)
      );
      if (!exists) {
        targetStudy.courses.push(normalized);
      }
      matchedCourses++;
    } else {
      unmatchedCourses++;
    }
  }

  for (const study of studies) {
    study.courses = study.courses.sort((a, b) => a.course.localeCompare(b.course, "hr"));
  }

  const model: AcademicModel = {
    institution: {
      name: sourceMap.institution?.name || "Veleučilište Baltazar Zaprešić",
      generated_at: new Date().toISOString(),
      input_sources: {
        source_map: SOURCE_MAP_FILE,
        courses_file: fs.existsSync(COURSES_FILE) ? COURSES_FILE : null,
        faculty_file: fs.existsSync(FACULTY_FILE) ? FACULTY_FILE : null,
      },
    },
    studies,
    faculty_index: buildFacultyIndex(facultyRows, studies),
    shared_academic_sources: unique(safeArray(sourceMap.shared_academic_sources)),
  };

  writeJson(OUTPUT_FILE, model);

  console.log("======================================");
  console.log("BALTAZAR ACADEMIC MODEL SEED BUILDER");
  console.log("======================================");
  console.log("Input source map :", SOURCE_MAP_FILE);
  console.log("Input courses    :", fs.existsSync(COURSES_FILE) ? COURSES_FILE : "(ne postoji)");
  console.log("Input faculty    :", fs.existsSync(FACULTY_FILE) ? FACULTY_FILE : "(ne postoji)");
  console.log("Output           :", OUTPUT_FILE);
  console.log("--------------------------------------");
  console.log("Studies in model :", model.studies.length);
  console.log("Faculty in index :", model.faculty_index.length);
  console.log("Shared sources   :", model.shared_academic_sources.length);
  console.log("Matched courses  :", matchedCourses);
  console.log("Unmatched courses:", unmatchedCourses);
  console.log("--------------------------------------");

  for (const study of model.studies) {
    console.log(`${study.study}: ${study.courses.length} kolegija | ${study.sources.course_catalogues.length} catalogue PDF | ${study.sources.curriculum_pdfs.length} curriculum PDF`);
  }

  console.log("======================================");
  console.log("SEED BUILD FINISHED");
  console.log("======================================");
}

main();
