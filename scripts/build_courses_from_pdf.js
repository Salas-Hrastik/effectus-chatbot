const fs = require("fs");
const path = require("path");

const INPUT_RAW = path.join(process.cwd(), "data", "course_catalogue_raw.txt");
const OUTPUT_JSON = path.join(process.cwd(), "data", "baltazar_courses_structured.json");
const OUTPUT_DEBUG = path.join(process.cwd(), "data", "baltazar_courses_structured_debug.json");

if (!fs.existsSync(INPUT_RAW)) {
  console.error("Nedostaje datoteka:", INPUT_RAW);
  process.exit(1);
}

const raw = fs.readFileSync(INPUT_RAW, "utf8");

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

const KNOWN_STUDIES = [
  "Primijenjena ekonomija",
  "Poslovna ekonomija i financije",
  "Menadžment uredskog poslovanja",
  "Menadžment u kulturi i kulturnom turizmu",
  "Socijalna i kulturna integracija",
  "Menadžment u turizmu i ugostiteljstvu",
  "Poslovna ekonomija i financije (Biograd n/M)",
  "Financije i investicije",
  "Projektni menadžment",
  "Komunikacijski menadžment",
  "Menadžment javnog sektora",
  "Projektni menadžment (Osijek)",
];

const lines = raw
  .split(/\r?\n/)
  .map((x) => x.replace(/\s+/g, " ").trim())
  .filter(Boolean);

function detectStudy(line) {
  const n = normalizeText(line);

  for (const study of KNOWN_STUDIES) {
    if (n.includes(normalizeText(study))) {
      return study;
    }
  }

  return null;
}

function looksLikeCourseTitle(line) {
  const clean = line.trim();
  const n = normalizeText(clean);

  if (clean.length < 4 || clean.length > 120) return false;

  const banned = [
    "learning outcomes",
    "literature",
    "assessment",
    "grading",
    "holder",
    "lecturer",
    "assistant",
    "semester",
    "year of study",
    "ects",
    "course catalogue",
    "veleuciliste",
    "baltazar",
    "zapresic",
    "biograd",
    "osijek",
    "online",
  ];

  if (banned.some((b) => n.includes(b))) return false;

  const hasMostlyLetters = /^[A-ZČĆŽŠĐ][A-Za-zČĆŽŠĐčćžšđ0-9 ,()\/\-&]+$/.test(clean);
  const noColon = !clean.includes(":");
  const notTooNumeric = (clean.match(/\d/g) || []).length <= 6;

  return hasMostlyLetters && noColon && notTooNumeric;
}

function findNearbyEcts(idx) {
  for (let i = idx; i <= Math.min(idx + 8, lines.length - 1); i++) {
    const m = lines[i].match(/\b(\d{1,2})\s*ECTS\b/i);
    if (m) return Number(m[1]);
  }
  return null;
}

function findNearbySemester(idx) {
  for (let i = idx; i <= Math.min(idx + 8, lines.length - 1); i++) {
    const line = lines[i];
    let m = line.match(/\bsemester\b[^0-9]{0,10}(\d{1,2})/i);
    if (m) return Number(m[1]);
    m = line.match(/\b(\d{1,2})\s*semester\b/i);
    if (m) return Number(m[1]);
  }
  return null;
}

function findNearbyYear(idx) {
  for (let i = idx; i <= Math.min(idx + 8, lines.length - 1); i++) {
    const line = lines[i];
    let m = line.match(/\byear of study\b[^0-9]{0,10}(\d{1,2})/i);
    if (m) return Number(m[1]);
    m = line.match(/\b(\d{1,2})\s*year\b/i);
    if (m) return Number(m[1]);
  }
  return null;
}

function findNearbyHolder(idx) {
  for (let i = idx; i <= Math.min(idx + 12, lines.length - 1); i++) {
    const line = lines[i];
    const n = normalizeText(line);

    if (
      n.includes("holder") ||
      n.includes("lecturer") ||
      n.includes("teacher") ||
      n.includes("nositelj")
    ) {
      return line;
    }
  }
  return "";
}

function findNearbyLiterature(idx) {
  const out = [];
  for (let i = idx; i <= Math.min(idx + 20, lines.length - 1); i++) {
    const line = lines[i];
    const n = normalizeText(line);

    if (
      n.includes("literature") ||
      n.includes("recommended literature") ||
      n.includes("mandatory literature")
    ) {
      out.push(line);
      for (let j = i + 1; j <= Math.min(i + 5, lines.length - 1); j++) {
        const next = lines[j];
        if (next.length > 10 && next.length < 220) {
          out.push(next);
        }
      }
      break;
    }
  }
  return out;
}

let currentStudy = null;
const candidates = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  const detectedStudy = detectStudy(line);
  if (detectedStudy) {
    currentStudy = detectedStudy;
    continue;
  }

  if (!currentStudy) continue;
  if (!looksLikeCourseTitle(line)) continue;

  const ects = findNearbyEcts(i);
  const semester = findNearbySemester(i);
  const year = findNearbyYear(i);
  const holder = findNearbyHolder(i);
  const literature = findNearbyLiterature(i);

  if (ects === null && semester === null && year === null && !holder && literature.length === 0) {
    continue;
  }

  candidates.push({
    study: currentStudy,
    course: line,
    ects,
    semester,
    year,
    holderRaw: holder,
    literatureRaw: literature,
    sourceLineIndex: i,
  });
}

const cleaned = uniqBy(
  candidates.filter((c) => c.course && c.study),
  (c) => `${normalizeText(c.study)}__${normalizeText(c.course)}`
).sort((a, b) => {
  const s = normalizeText(a.study).localeCompare(normalizeText(b.study), "hr");
  if (s !== 0) return s;
  return normalizeText(a.course).localeCompare(normalizeText(b.course), "hr");
});

fs.writeFileSync(OUTPUT_JSON, JSON.stringify(cleaned, null, 2), "utf8");
fs.writeFileSync(
  OUTPUT_DEBUG,
  JSON.stringify(
    {
      totalLines: lines.length,
      totalCandidatesBeforeDedup: candidates.length,
      totalCoursesAfterDedup: cleaned.length,
      sample: cleaned.slice(0, 30),
    },
    null,
    2
  ),
  "utf8"
);

console.log("");
console.log("UKUPNO REDAKA:", lines.length);
console.log("KANDIDATA PRIJE DEDUP:", candidates.length);
console.log("KOLEGIJA NAKON DEDUP:", cleaned.length);
console.log("");

for (const item of cleaned.slice(0, 20)) {
  console.log(`- ${item.study} | ${item.course} | ECTS=${item.ects ?? "?"} | sem=${item.semester ?? "?"} | god=${item.year ?? "?"}`);
}

console.log("");
console.log("Saved:", OUTPUT_JSON);
console.log("Saved:", OUTPUT_DEBUG);
