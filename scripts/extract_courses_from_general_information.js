const fs = require("fs");
const path = require("path");

const INPUT = path.join(process.cwd(), "data", "course_catalogue_raw.txt");
const OUTPUT = path.join(process.cwd(), "data", "baltazar_courses_from_general_information.json");
const OUTPUT_FACULTY = path.join(process.cwd(), "data", "baltazar_faculty_from_general_information.json");
const OUTPUT_SUMMARY = path.join(process.cwd(), "data", "baltazar_courses_from_general_information_summary.txt");

if (!fs.existsSync(INPUT)) {
  console.error("Nedostaje:", INPUT);
  process.exit(1);
}

const raw = fs.readFileSync(INPUT, "utf8");

const lines = raw
  .split(/\r?\n/)
  .map((x) => x.replace(/\s+/g, " ").trim())
  .filter(Boolean);

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

function isGeneralInformation(line) {
  return normalizeText(line) === "general information";
}

function looksLikeCourseName(line) {
  const s = String(line || "").trim();
  const n = normalizeText(s);

  if (!s || s.length < 4 || s.length > 140) return false;

  const banned = [
    "general information",
    "course coordinator",
    "course instructor",
    "study programme",
    "course status",
    "year of study",
    "semester",
    "ects",
    "number of classes",
    "course description",
    "learning outcomes",
    "comments and clarifications",
    "notification of exam results",
    "method of communication",
    "quality assurance",
    "literature",
    "oral exam",
    "none.",
  ];

  if (banned.some((b) => n.includes(b))) return false;

  if (/^\d+$/.test(s)) return false;
  if (s.includes("@")) return false;
  if (s.includes(":")) return false;

  return /^[A-ZČĆŽŠĐ][A-Za-zČĆŽŠĐčćžšđ0-9 ,()\/\-&]+$/.test(s);
}

function getLine(i) {
  if (i < 0 || i >= lines.length) return "";
  return lines[i];
}

function findCourseName(anchorIndex) {
  for (let i = anchorIndex - 1; i >= Math.max(0, anchorIndex - 8); i--) {
    const line = getLine(i);
    if (looksLikeCourseName(line)) {
      return { name: line, index: i };
    }
  }
  return { name: "", index: -1 };
}

function collectFieldValue(anchorIndex, fieldLabel, maxLookahead = 8) {
  const labelNorm = normalizeText(fieldLabel);

  for (let i = anchorIndex; i <= Math.min(lines.length - 1, anchorIndex + maxLookahead); i++) {
    const current = getLine(i);
    const next = getLine(i + 1);
    const currentNorm = normalizeText(current);

    if (currentNorm === labelNorm) {
      return next || "";
    }

    if (currentNorm.startsWith(labelNorm + " ")) {
      return current.slice(fieldLabel.length).trim();
    }
  }

  return "";
}

function collectYearSemester(anchorIndex) {
  for (let i = anchorIndex; i <= Math.min(lines.length - 1, anchorIndex + 12); i++) {
    const currentNorm = normalizeText(getLine(i));
    if (
      currentNorm.includes("year of study") ||
      currentNorm === "semester" ||
      currentNorm.includes("year of study, semester")
    ) {
      const l1 = getLine(i + 1);
      const l2 = getLine(i + 2);
      return [l1, l2].filter(Boolean).join(" ").trim();
    }
  }
  return "";
}

function collectEcts(anchorIndex) {
  for (let i = anchorIndex; i <= Math.min(lines.length - 1, anchorIndex + 14); i++) {
    const line = getLine(i);
    const m = line.match(/\bECTS\b.*?(\d{1,2})/i) || line.match(/\b(\d{1,2})\b/);
    const n = normalizeText(line);

    if (n.includes("ects coefficient of student workload")) {
      const sameLine = line.match(/(\d{1,2})\s*$/);
      if (sameLine) return Number(sameLine[1]);

      const next = getLine(i + 1);
      const nextMatch = next.match(/\b(\d{1,2})\b/);
      if (nextMatch) return Number(nextMatch[1]);
    }

    if (n === "ects coefficient of student workload" && m) {
      return Number(m[1]);
    }
  }
  return null;
}

function extractNames(text = "") {
  const cleaned = String(text)
    .replace(/\b(PhD|MSc|MA|BA|mag\. oec\.|dr\. sc\.|prof\.|doc\.|lecturer|assistant professor|senior lecturer|college professor)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const parts = cleaned
    .split(/[,;/]| and | & /i)
    .map((x) => x.trim())
    .filter(Boolean);

  return parts.filter((p) =>
    /^[A-ZČĆŽŠĐ][a-zčćžšđ]+(?:\s+[A-ZČĆŽŠĐ][a-zčćžšđ]+)+$/.test(p)
  );
}

const courses = [];
const faculty = [];

for (let i = 0; i < lines.length; i++) {
  if (!isGeneralInformation(lines[i])) continue;

  const courseInfo = findCourseName(i);
  if (!courseInfo.name) continue;

  const coordinatorRaw = collectFieldValue(i, "Course coordinator", 8);
  const instructorRaw = collectFieldValue(i, "Course instructor", 8);
  const studyProgrammeRaw = collectFieldValue(i, "Study programme", 8);
  const yearSemesterRaw = collectYearSemester(i);
  const ects = collectEcts(i);

  const coordinatorNames = extractNames(coordinatorRaw);
  const instructorNames = extractNames(instructorRaw);

  const record = {
    course: courseInfo.name,
    studyProgrammeRaw,
    yearSemesterRaw,
    ects,
    coordinatorRaw,
    instructorRaw,
    coordinatorNames,
    instructorNames,
    sourceLineIndex: i,
  };

  courses.push(record);

  coordinatorNames.forEach((name) => {
    faculty.push({
      name,
      role: "coordinator",
      course: courseInfo.name,
    });
  });

  instructorNames.forEach((name) => {
    faculty.push({
      name,
      role: "instructor",
      course: courseInfo.name,
    });
  });
}

const cleanCourses = uniqBy(
  courses,
  (x) => normalizeText(x.course)
).sort((a, b) => normalizeText(a.course).localeCompare(normalizeText(b.course), "hr"));

const cleanFaculty = uniqBy(
  faculty,
  (x) => `${normalizeText(x.name)}__${normalizeText(x.role)}__${normalizeText(x.course)}`
).sort((a, b) => normalizeText(a.name).localeCompare(normalizeText(b.name), "hr"));

fs.writeFileSync(OUTPUT, JSON.stringify(cleanCourses, null, 2), "utf8");
fs.writeFileSync(OUTPUT_FACULTY, JSON.stringify(cleanFaculty, null, 2), "utf8");

const summary = [];
summary.push(`UKUPNO KOLEGIJA: ${cleanCourses.length}`);
summary.push(`UKUPNO NASTAVNIKA: ${cleanFaculty.length}`);
summary.push("");

cleanCourses.slice(0, 30).forEach((c) => {
  summary.push(`- ${c.course} | ECTS=${c.ects ?? "?"}`);
  summary.push(`  studyProgrammeRaw: ${c.studyProgrammeRaw || "-"}`);
  summary.push(`  yearSemesterRaw: ${c.yearSemesterRaw || "-"}`);
  summary.push(`  coordinatorRaw: ${c.coordinatorRaw || "-"}`);
  summary.push(`  instructorRaw: ${c.instructorRaw || "-"}`);
});

summary.push("");
cleanFaculty.slice(0, 40).forEach((f) => {
  summary.push(`- ${f.name} | ${f.role} | ${f.course}`);
});

fs.writeFileSync(OUTPUT_SUMMARY, summary.join("\n"), "utf8");

console.log("UKUPNO KOLEGIJA:", cleanCourses.length);
console.log("UKUPNO NASTAVNIKA:", cleanFaculty.length);
console.log("");
console.log("Prvih 20 kolegija:");
cleanCourses.slice(0, 20).forEach((c) => {
  console.log(`- ${c.course} | ECTS=${c.ects ?? "?"}`);
  console.log(`  coordinator: ${c.coordinatorRaw || "-"}`);
  console.log(`  instructor: ${c.instructorRaw || "-"}`);
});
console.log("");
console.log("Saved:", OUTPUT);
console.log("Saved:", OUTPUT_FACULTY);
console.log("Saved:", OUTPUT_SUMMARY);
