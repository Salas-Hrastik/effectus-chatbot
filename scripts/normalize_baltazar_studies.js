const fs = require("fs");
const path = require("path");

function normalizeText(value = "") {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLanguagePrefix(url = "") {
  return url.replace("/en/", "/");
}

function slugFromUrl(url = "") {
  const clean = stripLanguagePrefix(url).replace(/\/+$/, "");
  const parts = clean.split("/");
  return parts[parts.length - 1] || clean;
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

const inputPath = path.join(process.cwd(), "data", "baltazar_studies.json");
const outputPath = path.join(process.cwd(), "data", "baltazar_studies_canonical.json");

if (!fs.existsSync(inputPath)) {
  console.error("Ulazna datoteka ne postoji:", inputPath);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const grouped = new Map();

for (const item of raw) {
  const key = slugFromUrl(item.url);

  if (!grouped.has(key)) {
    grouped.set(key, {
      slug: key,
      canonicalUrl: stripLanguagePrefix(item.url),
      titleHr: "",
      titleEn: "",
      mode: item.mode || "unknown",
      level: item.level || "unknown",
      location: item.location || "unknown",
      durationYears: item.durationYears ?? null,
      ects: item.ects ?? null,
      descriptionHr: "",
      descriptionEn: "",
      relatedLinks: [],
      hrUrl: null,
      enUrl: null,
    });
  }

  const entry = grouped.get(key);
  const lang = item.language === "en" ? "en" : "hr";

  if (lang === "hr") {
    entry.titleHr = item.title || entry.titleHr;
    entry.descriptionHr = item.description || entry.descriptionHr;
    entry.hrUrl = item.url;
  } else {
    entry.titleEn = item.title || entry.titleEn;
    entry.descriptionEn = item.description || entry.descriptionEn;
    entry.enUrl = item.url;
  }

  if (entry.mode === "unknown" && item.mode) entry.mode = item.mode;
  if (entry.level === "unknown" && item.level) entry.level = item.level;
  if (entry.location === "unknown" && item.location) entry.location = item.location;
  if (entry.durationYears == null && item.durationYears != null) entry.durationYears = item.durationYears;
  if (entry.ects == null && item.ects != null) entry.ects = item.ects;

  entry.relatedLinks = dedupeLinks([
    ...entry.relatedLinks,
    ...(item.relatedLinks || []),
  ]);
}

const canonical = [...grouped.values()].sort((a, b) =>
  normalizeText(a.titleHr || a.titleEn).localeCompare(
    normalizeText(b.titleHr || b.titleEn),
    "hr"
  )
);

fs.writeFileSync(outputPath, JSON.stringify(canonical, null, 2), "utf8");

console.log("Saved canonical studies ->", outputPath);
console.log("Canonical records:", canonical.length);

for (const item of canonical) {
  console.log(
    `- ${item.titleHr || item.titleEn} | ${item.location} | ${item.mode} | ${item.level}`
  );
}
