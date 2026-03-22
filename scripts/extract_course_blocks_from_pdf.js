const fs = require("fs");
const path = require("path");

const INPUT = path.join(process.cwd(), "data", "course_catalogue_raw.txt");
const OUTPUT_BLOCKS = path.join(process.cwd(), "data", "course_blocks_from_pdf.json");
const OUTPUT_SUMMARY = path.join(process.cwd(), "data", "course_blocks_summary.txt");

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

function isAnchorLine(line) {
  const n = normalizeText(line);
  return (
    n.includes("ects") ||
    n.includes("semester") ||
    n.includes("year of study") ||
    n.includes("teacher") ||
    n.includes("lecturer") ||
    n.includes("assistant") ||
    n.includes("learning outcomes")
  );
}

function looksLikeCourseName(line) {
  const clean = line.trim();
  const n = normalizeText(clean);

  if (clean.length < 4 || clean.length > 140) return false;

  const banned = [
    "ects",
    "semester",
    "year of study",
    "teacher",
    "lecturer",
    "assistant",
    "learning outcomes",
    "literature",
    "compulsory literature",
    "recommended literature",
    "assessment",
    "grading",
    "outcomes",
    "baltazar",
    "veleuciliste",
    "zapresic",
    "osijek",
    "biograd",
    "online",
    "page",
  ];

  if (banned.some((b) => n.includes(b))) return false;

  const okShape =
    /^[A-ZČĆŽŠĐ][A-Za-zČĆŽŠĐčćžšđ0-9 ,()\/\-&]+$/.test(clean) &&
    !clean.includes(":");

  return okShape;
}

function extractField(block, fieldNames) {
  for (const line of block) {
    const n = normalizeText(line);
    for (const field of fieldNames) {
      if (n.includes(field)) {
        return line;
      }
    }
  }
  return "";
}

function findNearestCourseName(lines, anchorIndex) {
  for (let i = anchorIndex - 1; i >= Math.max(0, anchorIndex - 8); i--) {
    if (looksLikeCourseName(lines[i])) {
      return { name: lines[i], index: i };
    }
  }
  return { name: "", index: -1 };
}

function uniqBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

const rawBlocks = [];

for (let i = 0; i < lines.length; i++) {
  if (!isAnchorLine(lines[i])) continue;

  const courseInfo = findNearestCourseName(lines, i);
  const from = Math.max(0, courseInfo.index !== -1 ? courseInfo.index : i - 3);
  const to = Math.min(lines.length - 1, i + 12);

  const block = lines.slice(from, to + 1);

  rawBlocks.push({
    anchorIndex: i,
    courseName: courseInfo.name,
    courseNameLineIndex: courseInfo.index,
    ectsRaw: extractField(block, ["ects"]),
    semesterRaw: extractField(block, ["semester"]),
    yearRaw: extractField(block, ["year of study"]),
    teacherRaw: extractField(block, ["teacher", "lecturer"]),
    assistantRaw: extractField(block, ["assistant"]),
    learningOutcomesRaw: extractField(block, ["learning outcomes"]),
    block,
  });
}

const blocks = uniqBy(
  rawBlocks.filter((b) => b.courseName),
  (b) => normalizeText(b.courseName)
);

fs.writeFileSync(OUTPUT_BLOCKS, JSON.stringify(blocks, null, 2), "utf8");

const summary = [];
summary.push(`UKUPNO BLOKOVA PRIJE DEDUP: ${rawBlocks.length}`);
summary.push(`UKUPNO BLOKOVA NAKON DEDUP: ${blocks.length}`);
summary.push("");

blocks.slice(0, 40).forEach((b, idx) => {
  summary.push(`=== BLOK ${idx + 1} ===`);
  summary.push(`courseName: ${b.courseName}`);
  summary.push(`ectsRaw: ${b.ectsRaw}`);
  summary.push(`semesterRaw: ${b.semesterRaw}`);
  summary.push(`yearRaw: ${b.yearRaw}`);
  summary.push(`teacherRaw: ${b.teacherRaw}`);
  summary.push(`assistantRaw: ${b.assistantRaw}`);
  summary.push(`learningOutcomesRaw: ${b.learningOutcomesRaw}`);
  summary.push("block:");
  b.block.forEach((line) => summary.push(`  ${line}`));
  summary.push("");
});

fs.writeFileSync(OUTPUT_SUMMARY, summary.join("\n"), "utf8");

console.log("UKUPNO BLOKOVA PRIJE DEDUP:", rawBlocks.length);
console.log("UKUPNO BLOKOVA NAKON DEDUP:", blocks.length);
console.log("");
console.log("Prvih 15 blokova:");
blocks.slice(0, 15).forEach((b) => {
  console.log(`- ${b.courseName}`);
  console.log(`  ECTS: ${b.ectsRaw || "-"}`);
  console.log(`  Semester: ${b.semesterRaw || "-"}`);
  console.log(`  Teacher: ${b.teacherRaw || "-"}`);
  console.log(`  Assistant: ${b.assistantRaw || "-"}`);
});
console.log("");
console.log("Saved:", OUTPUT_BLOCKS);
console.log("Saved:", OUTPUT_SUMMARY);
