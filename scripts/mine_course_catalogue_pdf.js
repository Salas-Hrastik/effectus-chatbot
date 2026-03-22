const fs = require("fs");
const path = require("path");
const axios = require("axios");
const pdfParse = require("pdf-parse");

const SOURCES_PATH = path.join(process.cwd(), "data", "baltazar_academic_sources.json");
const OUT_RAW_TXT = path.join(process.cwd(), "data", "course_catalogue_raw.txt");
const OUT_SIGNAL_JSON = path.join(process.cwd(), "data", "course_catalogue_signal_lines.json");
const OUT_COURSE_CANDIDATES_JSON = path.join(process.cwd(), "data", "course_candidates_from_pdf.json");
const OUT_FACULTY_CANDIDATES_JSON = path.join(process.cwd(), "data", "faculty_candidates_from_pdf.json");
const OUT_PDF_BIN = path.join(process.cwd(), "data", "english_course_catalogue.pdf");

if (!fs.existsSync(SOURCES_PATH)) {
  console.error("Nedostaje:", SOURCES_PATH);
  process.exit(1);
}

const sources = JSON.parse(fs.readFileSync(SOURCES_PATH, "utf8"));

function normalizeText(value = "") {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniq(arr) {
  return [...new Set(arr)];
}

function pickCatalogueUrl() {
  const urls = [];

  for (const study of sources) {
    for (const link of study.sources?.curriculum || []) {
      if (link.url) urls.push(link.url);
    }
    for (const link of study.sources?.pdf_other || []) {
      if (link.url) urls.push(link.url);
    }
  }

  const preferred = urls.find((u) =>
    normalizeText(u).includes("english-course-catalogue.pdf")
  );

  return preferred || urls[0] || null;
}

function lineLooksLikeCourse(line) {
  const clean = line.replace(/\s+/g, " ").trim();
  if (clean.length < 4 || clean.length > 140) return false;

  const n = normalizeText(clean);

  if (/\bects\b/i.test(clean)) return true;
  if (/^\d+\.\s+/.test(clean)) return true;
  if (/^[A-ZČĆŽŠĐ][A-Za-zČĆŽŠĐčćžšđ0-9 ,()\/-]{3,}$/.test(clean) && !n.includes("veleuciliste")) {
    return true;
  }

  return false;
}

function lineLooksLikeFaculty(line) {
  const clean = line.replace(/\s+/g, " ").trim();
  const n = normalizeText(clean);

  if (clean.length < 6 || clean.length > 180) return false;

  return (
    n.includes("prof.") ||
    n.includes("doc.") ||
    n.includes("dr. sc.") ||
    n.includes("phd") ||
    n.includes("assistant") ||
    n.includes("lecturer") ||
    n.includes("predavac") ||
    n.includes("nositelj")
  );
}

async function downloadPdf(url) {
  const res = await axios.get(url, {
    timeout: 30000,
    responseType: "arraybuffer",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      "Accept-Language": "hr-HR,hr;q=0.9,en;q=0.8",
    },
  });

  return Buffer.from(res.data);
}

async function main() {
  const pdfUrl = pickCatalogueUrl();

  if (!pdfUrl) {
    console.error("Nije pronađen PDF katalog u academic sources.");
    process.exit(1);
  }

  console.log("PDF katalog:", pdfUrl);

  const pdfBuffer = await downloadPdf(pdfUrl);
  fs.writeFileSync(OUT_PDF_BIN, pdfBuffer);

  const parsed = await pdfParse(pdfBuffer);
  const rawText = parsed.text || "";

  fs.writeFileSync(OUT_RAW_TXT, rawText, "utf8");

  const rawLines = rawText
    .split(/\r?\n/)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const signalLines = rawLines.filter((line) => {
    const n = normalizeText(line);
    return (
      n.includes("ects") ||
      n.includes("course") ||
      n.includes("subject") ||
      n.includes("module") ||
      n.includes("holder") ||
      n.includes("lecturer") ||
      n.includes("assistant") ||
      n.includes("prof.") ||
      n.includes("doc.") ||
      n.includes("dr. sc.") ||
      n.includes("learning outcomes") ||
      n.includes("literature")
    );
  });

  const courseCandidates = uniq(
    rawLines.filter(lineLooksLikeCourse)
  ).map((line) => ({ line }));

  const facultyCandidates = uniq(
    rawLines.filter(lineLooksLikeFaculty)
  ).map((line) => ({ line }));

  fs.writeFileSync(
    OUT_SIGNAL_JSON,
    JSON.stringify(signalLines, null, 2),
    "utf8"
  );

  fs.writeFileSync(
    OUT_COURSE_CANDIDATES_JSON,
    JSON.stringify(courseCandidates, null, 2),
    "utf8"
  );

  fs.writeFileSync(
    OUT_FACULTY_CANDIDATES_JSON,
    JSON.stringify(facultyCandidates, null, 2),
    "utf8"
  );

  console.log("");
  console.log("PDF pages:", parsed.numpages || "unknown");
  console.log("Ukupno redaka:", rawLines.length);
  console.log("Signalnih redaka:", signalLines.length);
  console.log("Kandidata za kolegije:", courseCandidates.length);
  console.log("Kandidata za nastavnike:", facultyCandidates.length);
  console.log("");
  console.log("Saved:", OUT_PDF_BIN);
  console.log("Saved:", OUT_RAW_TXT);
  console.log("Saved:", OUT_SIGNAL_JSON);
  console.log("Saved:", OUT_COURSE_CANDIDATES_JSON);
  console.log("Saved:", OUT_FACULTY_CANDIDATES_JSON);
}

main().catch((error) => {
  console.error("Greška:", error.message);
  process.exit(1);
});
