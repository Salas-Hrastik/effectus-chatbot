const fs = require("fs");
const path = require("path");

const input = path.join(process.cwd(), "data", "baltazar_studies.json");
const output = path.join(process.cwd(), "data", "baltazar_studies_clean.json");

const raw = JSON.parse(fs.readFileSync(input, "utf8"));

const CANONICAL_STUDIES = {
  "primijenjena-ekonomija": {
    titleHr: "Primijenjena ekonomija",
    level: "stručni kratki studij",
    mode: "online",
    location: "online",
  },
  "poslovna-ekonomija-i-financije": {
    titleHr: "Poslovna ekonomija i financije",
    level: "stručni prijediplomski studij",
    mode: "online",
    location: "online",
  },
  "menadzment-uredskog-poslovanja": {
    titleHr: "Menadžment uredskog poslovanja",
    level: "stručni prijediplomski studij",
    mode: "online",
    location: "online",
  },
  "menadzment-u-kulturi-i-kulturnom-turizmu": {
    titleHr: "Menadžment u kulturi i kulturnom turizmu",
    level: "stručni prijediplomski studij",
    mode: "online",
    location: "online",
  },
  "socijalna-i-kulturna-integracija": {
    titleHr: "Socijalna i kulturna integracija",
    level: "stručni prijediplomski studij",
    mode: "online",
    location: "online",
  },
  "menadzment-u-turizmu-i-ugostiteljstvu": {
    titleHr: "Menadžment u turizmu i ugostiteljstvu",
    level: "stručni prijediplomski studij",
    mode: "classical",
    location: "Biograd na Moru",
  },
  "poslovna-ekonomija-i-financije-biograd-n-m": {
    titleHr: "Poslovna ekonomija i financije (Biograd n/M)",
    level: "stručni prijediplomski studij",
    mode: "classical",
    location: "Biograd na Moru",
  },
  "financije-i-investicije-novo": {
    titleHr: "Financije i investicije",
    level: "stručni diplomski studij",
    mode: "online",
    location: "online",
  },
  "projektni-menadzment": {
    titleHr: "Projektni menadžment",
    level: "stručni diplomski studij",
    mode: "online",
    location: "online",
  },
  "komunikacijski-menadzment": {
    titleHr: "Komunikacijski menadžment",
    level: "stručni diplomski studij",
    mode: "online",
    location: "online",
  },
  "menadzment-javnog-sektora": {
    titleHr: "Menadžment javnog sektora",
    level: "stručni diplomski studij",
    mode: "online",
    location: "online",
  },
  "projektni-menadzment-osijek": {
    titleHr: "Projektni menadžment (Osijek)",
    level: "stručni diplomski studij",
    mode: "classical",
    location: "Osijek",
  },
};

function stripLanguagePrefix(url = "") {
  return url.replace("/en/", "/");
}

function slugFromUrl(url = "") {
  const clean = stripLanguagePrefix(url).replace(/\/+$/, "");
  const parts = clean.split("/");
  return parts[parts.length - 1] || "";
}

function dedupeLinks(links = []) {
  const map = new Map();
  for (const link of links) {
    if (!link || !link.url) continue;
    if (!map.has(link.url)) map.set(link.url, link);
  }
  return [...map.values()];
}

const grouped = new Map();

for (const item of raw) {
  if (!item || !item.url) continue;

  const slug = slugFromUrl(item.url);
  const canonical = CANONICAL_STUDIES[slug];

  if (!canonical) continue;

  if (!grouped.has(slug)) {
    grouped.set(slug, {
      slug,
      titleHr: canonical.titleHr,
      canonicalUrl: stripLanguagePrefix(item.url),
      hrUrl: null,
      enUrl: null,
      level: canonical.level,
      mode: canonical.mode,
      location: canonical.location,
      durationYears: null,
      ects: null,
      descriptionHr: "",
      descriptionEn: "",
      relatedLinks: [],
      rawTitles: [],
    });
  }

  const entry = grouped.get(slug);
  const isEnglish = item.url.includes("/en/");

  if (isEnglish) {
    entry.enUrl = item.url;
    if (item.description && !entry.descriptionEn) {
      entry.descriptionEn = item.description;
    }
  } else {
    entry.hrUrl = item.url;
    if (item.description && !entry.descriptionHr) {
      entry.descriptionHr = item.description;
    }
  }

  if (item.durationYears != null && entry.durationYears == null) {
    entry.durationYears = item.durationYears;
  }

  if (item.ects != null && entry.ects == null) {
    entry.ects = item.ects;
  }

  entry.relatedLinks = dedupeLinks([
    ...entry.relatedLinks,
    ...(item.relatedLinks || []),
  ]);

  if (item.title) {
    entry.rawTitles.push(item.title);
  }
}

const clean = Object.keys(CANONICAL_STUDIES)
  .filter((slug) => grouped.has(slug))
  .map((slug) => grouped.get(slug));

fs.writeFileSync(output, JSON.stringify(clean, null, 2), "utf8");

console.log("");
console.log("STUDIJI:", clean.length);
console.log("");

clean.forEach((s) => {
  console.log(
    "-",
    s.titleHr,
    "|",
    s.canonicalUrl,
    "|",
    s.location,
    "|",
    s.mode,
    "|",
    s.level
  );
});

console.log("");
console.log("Saved:", output);
