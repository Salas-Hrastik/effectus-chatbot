const fs = require("fs");
const path = require("path");

const INPUT = path.join(process.cwd(), "data", "course_catalogue_raw.txt");
const OUTPUT = path.join(process.cwd(), "data", "pdf_pattern_report.txt");

if (!fs.existsSync(INPUT)) {
  console.error("Nedostaje:", INPUT);
  process.exit(1);
}

const raw = fs.readFileSync(INPUT, "utf8");

const lines = raw
  .split(/\r?\n/)
  .map((x) => x.replace(/\s+/g, " ").trim())
  .filter(Boolean);

const patterns = [
  "business economics",
  "applied economics",
  "office management",
  "culture and cultural tourism",
  "social and cultural integration",
  "tourism and hospitality",
  "finance and investments",
  "project management",
  "communication management",
  "public sector management",
  "ects",
  "semester",
  "year of study",
  "holder",
  "lecturer",
  "teacher",
  "assistant",
  "course title",
  "course",
  "literature",
  "learning outcomes"
];

function norm(s = "") {
  return s.toLowerCase();
}

function collectMatches(pattern) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (norm(lines[i]).includes(norm(pattern))) {
      const from = Math.max(0, i - 3);
      const to = Math.min(lines.length - 1, i + 6);
      out.push({
        pattern,
        lineIndex: i,
        context: lines.slice(from, to + 1),
      });
    }
  }
  return out;
}

let report = [];
for (const pattern of patterns) {
  const matches = collectMatches(pattern);
  report.push(`\n==============================`);
  report.push(`PATTERN: ${pattern}`);
  report.push(`MATCHES: ${matches.length}`);
  report.push(`==============================\n`);

  matches.slice(0, 8).forEach((m, idx) => {
    report.push(`--- MATCH ${idx + 1} @ line ${m.lineIndex} ---`);
    m.context.forEach((line, j) => {
      const actualIndex = m.lineIndex - 3 + j;
      report.push(`${actualIndex}: ${line}`);
    });
    report.push("");
  });
}

fs.writeFileSync(OUTPUT, report.join("\n"), "utf8");

console.log("UKUPNO REDAKA:", lines.length);
console.log("Report saved:", OUTPUT);
console.log("");
console.log("Brza statistika:");
for (const pattern of patterns) {
  const count = collectMatches(pattern).length;
  console.log(`- ${pattern}: ${count}`);
}
