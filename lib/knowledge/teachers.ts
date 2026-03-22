// ---------------------------------------------------------------------------
// teachers.ts — Course-teacher map for EFFECTUS veleučilište
// TODO: Populate after scraping https://effectus.com.hr/nastavnici/
// ---------------------------------------------------------------------------

export type CourseTeacherEntry = {
  teachers: string;
  url: string;
};

export type TeacherProfile = {
  name: string;
  email: string | null;
  profile_url: string;
};

type StudyProgramEntry = {
  program: string;
  level: string;
  courses: string[];
};

// TODO: Populate after web crawl
export const COURSE_TEACHER_MAP: Record<string, CourseTeacherEntry> = {};
export const TEACHER_PROFILES: TeacherProfile[] = [];
export const STUDY_PROGRAM_COURSE_MAP: StudyProgramEntry[] = [];

export function isTeacherIntent(question: string): boolean {
  const q = question.toLowerCase();
  const keywords = [
    'nastavnik', 'predavač', 'profesor', 'tko predaje', 'predaje',
    'nastavnici', 'suradnici', 'asistent', 'kolegij',
  ];
  return keywords.some(kw => q.includes(kw));
}

export function findTeachersForCourse(question: string): string | null {
  if (Object.keys(COURSE_TEACHER_MAP).length === 0) return null;

  const q = question.toLowerCase();
  const entries = Object.entries(COURSE_TEACHER_MAP);
  const match = entries.find(([course]) => q.includes(course.toLowerCase()));
  if (!match) return null;

  return `**${match[0]}**: ${match[1].teachers}\n🔗 ${match[1].url}`;
}

export function findStudyProgramTeachers(question: string): string | null {
  return null; // Will be populated after crawl
}

export function findTeacherByName(nameInput: string): string | null {
  if (TEACHER_PROFILES.length === 0) return null;

  const normalizedInput = nameInput.toLowerCase();
  const match = TEACHER_PROFILES.find(t =>
    t.name.toLowerCase().includes(normalizedInput) ||
    normalizedInput.includes(t.name.toLowerCase().split(' ')[1] ?? '')
  );

  if (!match) return null;

  let out = `**${match.name}**`;
  if (match.email) out += `\n📧 ${match.email}`;
  if (match.profile_url) out += `\n🔗 ${match.profile_url}`;
  return out;
}
