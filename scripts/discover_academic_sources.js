const fs = require("fs");
const path = require("path");

const input = path.join(process.cwd(), "data", "baltazar_studies_clean.json");
const output = path.join(process.cwd(), "data", "baltazar_academic_sources.json");

if (!fs.existsSync(input)) {
  console.error("Nedostaje ulazna datoteka:", input);
  process.exit(1);
}

const studies = JSON.parse(fs.readFileSync(input, "utf8"));

function normalizeText(value = "") {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyLink(link) {
  const hay = normalizeText(`${link.text || ""} ${link.url || ""}`);

  if (
    hay.includes("izvedbeni plan") ||
    hay.includes("curriculum") ||
    hay.includes("kurikulum") ||
    hay.includes("course catalogue") ||
    hay.includes("nastavni plan")
  ) {
    return "curriculum";
  }

  if (
    hay.includes("kolegij") ||
    hay.includes("predmet") ||
    hay.includes("syllabus")
  ) {
    return "course";
  }

  if (
    hay.includes("ispitni rok") ||
    hay.includes("exam schedule") ||
    hay.includes("ispiti")
  ) {
    return "exam_schedule";
  }

  if (
    hay.includes("raspored") ||
    hay.includes("schedule") ||
    hay.includes("nastava")
  ) {
    return "schedule";
  }

  if (
    hay.includes("kontakt") ||
    hay.includes("referada") ||
    hay.includes("email") ||
    hay.includes("e-mail")
  ) {
    return "contact";
  }

  if (hay.includes(".pdf")) {
    return "pdf_other";
  }

  return "other";
}

function dedupeLinks(links = []) {
  const map = new Map();
  for (const link of links) {
    if (!link || !link.url) continue;
    if (!map.has(link.url)) {
      map.set(link.url, link);
    }
  }
  return [...map.values()];
}

const result = studies.map((study) => {
  const links = dedupeLinks(study.relatedLinks || []).map((link) => ({
    text: link.text || "",
    url: link.url,
    type: classifyLink(link),
  }));

  const grouped = {
    curriculum: links.filter((x) => x.type === "curriculum"),
    course: links.filter((x) => x.type === "course"),
    exam_schedule: links.filter((x) => x.type === "exam_schedule"),
    schedule: links.filter((x) => x.type === "schedule"),
    contact: links.filter((x) => x.type === "contact"),
    pdf_other: links.filter((x) => x.type === "pdf_other"),
    other: links.filter((x) => x.type === "other"),
  };

  return {
    study: study.titleHr,
    slug: study.slug,
    canonicalUrl: study.canonicalUrl,
    location: study.location,
    mode: study.mode,
    level: study.level,
    sources: grouped,
    sourceCounts: {
      curriculum: grouped.curriculum.length,
      course: grouped.course.length,
      exam_schedule: grouped.exam_schedule.length,
      schedule: grouped.schedule.length,
      contact: grouped.contact.length,
      pdf_other: grouped.pdf_other.length,
      other: grouped.other.length,
      total: links.length,
    },
  };
});

fs.writeFileSync(output, JSON.stringify(result, null, 2), "utf8");

console.log("");
console.log("AKADEMSKI IZVORI PO STUDIJIMA");
console.log("");

for (const item of result) {
  console.log(
    `- ${item.study} | ukupno linkova: ${item.sourceCounts.total} | curriculum: ${item.sourceCounts.curriculum} | course: ${item.sourceCounts.course} | pdf_other: ${item.sourceCounts.pdf_other}`
  );
}

console.log("");
console.log("Saved:", output);
