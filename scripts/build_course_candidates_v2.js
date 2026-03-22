const fs = require("fs");
const path = require("path");

const INPUT = path.join(process.cwd(), "data", "course_blocks_from_pdf.json");
const OUTPUT = path.join(process.cwd(), "data", "baltazar_course_candidates_v2.json");
const OUTPUT_FACULTY = path.join(process.cwd(), "data", "baltazar_faculty_candidates_v2.json");
const OUTPUT_SUMMARY = path.join(process.cwd(), "data", "baltazar_course_candidates_v2_summary.txt");

if (!fs.existsSync(INPUT)) {
  console.error("Nedostaje:", INPUT);
  process.exit(1);
}

const blocks = JSON.parse(fs.readFileSync(INPUT, "utf8"));

function normalizeText(value = "") {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function parseEcts(text = "") {
  const m = String(text).match(/\b(\d{1,2})\s*ects\b/i);
  return m ? Number(m[1]) : null;
}

function parseSemester(text = "") {
  let m = String(text).match(/\bsemester\b[^0-9]{0,20}(\d{1,2})/i);
  if (m) return Number(m[1]);
  m = String(text).match(/\b(\d{1,2})\s*semester\b/i);
  if (m) return Number(m[1]);
  return null;
}

function parseYear(text = "") {
  let m = String(text).match(/\byear of study\b[^0-9]{0,20}(\d{1,2})/i);
  if (m) return Number(m[1]);
  m = String(text).match(/\b(\d{1,2})\s*year\b/i);
  if (m) return Number(m[1]);
  return null;
}

function cleanTeacherLine(text = "") {
  return String(text)
    .replace(/^.*?(teacher|lecturer)\s*:?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanAssistantLine(text = "") {
  return String(text)
    .replace(/^.*?assistant\s*:?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikePerson(text = "") {
  const s = String(text).trim();
  if (!s || s.length < 5 || s.length > 140) return false;

  const n = normalizeText(s);
  if (
    n.includes("students") ||
    n.includes("teacher") ||
    n.includes("assistant") ||
    n.includes("method of communication") ||
    n.includes("questionnaire") ||
    n.includes("quality") ||
    n.includes("evaluation")
  ) {
    return false;
  }

  return /[A-ZČĆŽŠĐ][a-zčćžšđ]+(?:\s+[A-ZČĆŽŠĐ][a-zčćžšđ]+)+/.test(s);
}

function splitFacultyNames(text = "") {
  const cleaned = String(text)
    .replace(/\b(PhD|MSc|MA|BA|dr\. sc\.|prof\.|doc\.|assistant professor|senior lecturer|lecturer|college professor)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const candidates = cleaned
    .split(/[,;/]| and | & /i)
    .map((x) => x.trim())
    .filter(Boolean);

  return candidates.filter(looksLikePerson);
}

function isBadCourseName(name = "") {
  const n = normalizeText(name);

  const bannedExactOrContains = [
    "course status",
    "course coordinator",
    "course content",
    "course objectives",
    "comments and clarifications",
    "notification of exam results",
    "number of classes",
    "competences that the student acquires after passing the course",
    "quality assurance methods that ensure acquisition of output knowledge skills and competencies",
    "students are also obliged to adhere",
    "selection of implementation approaches",
    "time-bound process",
    "learning outcomes",
    "literature",
    "evaluation in ects",
    "year of study",
    "semester",
  ];

  return bannedExactOrContains.some((bad) => n.includes(bad));
}

function looksLikeRealCourseName(name = "") {
  const s = String(name).trim();
  if (!s || s.length < 4 || s.length > 120) return false;
  if (isBadCourseName(s)) return false;

  const n = normalizeText(s);
  if (
    n.includes("students are") ||
    n.includes("the course covers") ||
    n.includes("oral presentations") ||
    n.includes("method of communication") ||
    n.includes("generic and domain-specific")
  ) {
    return false;
  }

  return /^[A-ZČĆŽŠĐ][A-Za-zČĆŽŠĐčćžšđ0-9 ,()\/\-&]+$/.test(s);
}

const courseCandidates = [];
const facultyCandidates = [];

for (const block of blocks) {
  const courseName = String(block.courseName || "").trim();
  if (!looksLikeRealCourseName(courseName)) continue;

  const ects = parseEcts(block.ectsRaw || "");
  const semester = parseSemester(block.semesterRaw || "");
  const year = parseYear(block.yearRaw || "");

  const teacherRaw = cleanTeacherLine(block.teacherRaw || "");
  const assistantRaw = cleanAssistantLine(block.assistantRaw || "");

  const teacherNames = splitFacultyNames(teacherRaw);
  const assistantNames = splitFacultyNames(assistantRaw);

  const hasAcademicSignal =
    ects !== null ||
    semester !== null ||
    year !== null ||
    teacherNames.length > 0 ||
    assistantNames.length > 0;

  if (!hasAcademicSignal) continue;

  courseCandidates.push({
    course: courseName,
    ects,
    semester,
    year,
    teacherRaw,
    assistantRaw,
    teacherNames,
    assistantNames,
    sourceLineIndex: block.sourceLineIndex ?? null,
  });

  for (const person of teacherNames) {
    facultyCandidates.push({
      name: person,
      role: "teacher",
      course: courseName,
    });
  }

  for (const person of assistantNames) {
    facultyCandidates.push({
      name: person,
      role: "assistant",
      course: courseName,
    });
  }
}

const cleanCourses = uniqBy(
  courseCandidates,
  (x) => normalizeText(x.course)
).sort((a, b) => normalizeText(a.course).localeCompare(normalizeText(b.course), "hr"));

const cleanFaculty = uniqBy(
  facultyCandidates,
  (x) => `${normalizeText(x.name)}__${normalizeText(x.role)}__${normalizeText(x.course)}`
).sort((a, b) => normalizeText(a.name).localeCompare(normalizeText(b.name), "hr"));

fs.writeFileSync(OUTPUT, JSON.stringify(cleanCourses, null, 2), "utf8");
fs.writeFileSync(OUTPUT_FACULTY, JSON.stringify(cleanFaculty, null, 2), "utf8");

const summary = [];
summary.push(`UKUPNO ČISTIH KOLEGIJA: ${cleanCourses.length}`);
summary.push(`UKUPNO KANDIDATA ZA NASTAVNIKE: ${cleanFaculty.length}`);
summary.push("");

summary.push("PRVI KOLEGIJI:");
cleanCourses.slice(0, 30).forEach((c) => {
  summary.push(`- ${c.course} | ECTS=${c.ects ?? "?"} | sem=${c.semester ?? "?"} | god=${c.year ?? "?"}`);
  if (c.teacherNames.length) summary.push(`  teacher: ${c.teacherNames.join("; ")}`);
  if (c.assistantNames.length) summary.push(`  assistant: ${c.assistantNames.join("; ")}`);
});

summary.push("");
summary.push("PRVI NASTAVNICI:");
cleanFaculty.slice(0, 40).forEach((f) => {
  summary.push(`- ${f.name} | ${f.role} | ${f.course}`);
});

fs.writeFileSync(OUTPUT_SUMMARY, summary.join("\n"), "utf8");

console.log("UKUPNO ČISTIH KOLEGIJA:", cleanCourses.length);
console.log("UKUPNO KANDIDATA ZA NASTAVNIKE:", cleanFaculty.length);
console.log("");
console.log("Prvih 20 kolegija:");
cleanCourses.slice(0, 20).forEach((c) => {
  console.log(`- ${c.course} | ECTS=${c.ects ?? "?"} | sem=${c.semester ?? "?"} | god=${c.year ?? "?"}`);
  if (c.teacherNames.length) console.log(`  teacher: ${c.teacherNames.join("; ")}`);
  if (c.assistantNames.length) console.log(`  assistant: ${c.assistantNames.join("; ")}`);
});
console.log("");
console.log("Saved:", OUTPUT);
console.log("Saved:", OUTPUT_FACULTY);
console.log("Saved:", OUTPUT_SUMMARY);
