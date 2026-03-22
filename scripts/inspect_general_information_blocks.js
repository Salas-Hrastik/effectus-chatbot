const fs = require("fs");
const path = require("path");

const INPUT = path.join(process.cwd(), "data", "course_catalogue_raw.txt");
const OUTPUT = path.join(process.cwd(), "data", "general_information_blocks.txt");

if (!fs.existsSync(INPUT)) {
  console.error("Nedostaje:", INPUT);
  process.exit(1);
}

const raw = fs.readFileSync(INPUT, "utf8");

const lines = raw
  .split(/\r?\n/)
  .map((x) => x.replace(/\s+/g, " ").trim())
  .filter(Boolean);

function norm(s = "") {
  return s.toLowerCase().trim();
}

const anchors = [];
for (let i = 0; i < lines.length; i++) {
  if (norm(lines[i]) === "general information") {
    anchors.push(i);
  }
}

const out = [];
out.push(`UKUPNO GENERAL INFORMATION BLOKOVA: ${anchors.length}`);
out.push("");

anchors.forEach((idx, n) => {
  const from = Math.max(0, idx - 12);
  const to = Math.min(lines.length - 1, idx + 25);

  out.push("==================================================");
  out.push(`BLOCK ${n + 1} @ line ${idx}`);
  out.push("--------------------------------------------------");

  for (let i = from; i <= to; i++) {
    const marker = i === idx ? ">>" : "  ";
    out.push(`${marker} ${i}: ${lines[i]}`);
  }

  out.push("");
});

fs.writeFileSync(OUTPUT, out.join("\n"), "utf8");

console.log("UKUPNO GENERAL INFORMATION BLOKOVA:", anchors.length);
console.log("Saved:", OUTPUT);
console.log("");
console.log("Prvih 5 anchor linija:");
anchors.slice(0, 5).forEach((idx, k) => {
  console.log(`- block ${k + 1} @ line ${idx}`);
});
