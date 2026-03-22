const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://www.bak.hr";
const CATALOG_URLS = [
  "https://www.bak.hr/studijski-programi",
  "https://www.bak.hr/en/studijski-programi",
];

const EXCLUDED_PATH_KEYWORDS = [
  "/cjelozivotno",
  "/medunarodna-suradnja",
  "/kontakt",
  "/novosti",
  "/o-nama",
  "/kvaliteta",
  "/upisi",
  "/referada",
  "/knjiznica",
  "/strucna-praksa",
  "/zavrsni-radovi",
  "/oglasi",
  "/oglasna-ploca",
  "/erasmus",
  "/karijerni-centar",
];

const STUDY_HINTS = [
  "ekonom",
  "menadz",
  "menadž",
  "turiz",
  "informat",
  "komunik",
  "financ",
  "integracij",
  "upravlj",
  "projekt",
];

function normalizeText(value = "") {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(rawHref, base = BASE_URL) {
  if (!rawHref) return null;
  try {
    const url = new URL(rawHref, base);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function isLikelyStudyUrl(url) {
  if (!url) return false;
  if (!url.startsWith(BASE_URL)) return false;

  const normalized = normalizeText(url);

  if (
    normalized === normalizeText(`${BASE_URL}/studijski-programi`) ||
    normalized === normalizeText(`${BASE_URL}/en/studijski-programi`)
  ) {
    return false;
  }

  if (!normalized.includes("/studijski-programi/")) return false;

  if (EXCLUDED_PATH_KEYWORDS.some((part) => normalized.includes(part))) {
    return false;
  }

  return STUDY_HINTS.some((hint) => normalized.includes(hint));
}

function inferLanguageFromUrl(url) {
  return url.includes("/en/") ? "en" : "hr";
}

function inferMode(text, url) {
  const hay = normalizeText(`${text} ${url}`);
  if (hay.includes("online")) return "online";
  if (
    hay.includes("biograd") ||
    hay.includes("osijek") ||
    hay.includes("klasicno") ||
    hay.includes("klasično")
  ) {
    return "classical";
  }
  return "unknown";
}

function inferLevel(text) {
  const hay = normalizeText(text);

  if (hay.includes("strucni kratki") || hay.includes("stručni kratki")) {
    return "stručni kratki studij";
  }
  if (
    hay.includes("strucni prijediplomski") ||
    hay.includes("stručni prijediplomski")
  ) {
    return "stručni prijediplomski studij";
  }
  if (hay.includes("strucni diplomski") || hay.includes("stručni diplomski")) {
    return "stručni diplomski studij";
  }
  if (hay.includes("diplomski")) return "diplomski studij";
  if (hay.includes("prijediplomski")) return "prijediplomski studij";

  return "unknown";
}

function inferLocation(text, url) {
  const hay = normalizeText(`${text} ${url}`);
  if (hay.includes("biograd")) return "Biograd na Moru";
  if (hay.includes("osijek")) return "Osijek";
  if (hay.includes("zapresic") || hay.includes("zaprešić")) return "Zaprešić";
  if (hay.includes("online")) return "online";
  return "unknown";
}

function extractDurationAndEcts(text) {
  const compact = text.replace(/\s+/g, " ").trim();

  const durationMatch =
    compact.match(/(\d+)\s+godine?\s*\/\s*(\d+)\s*ects/i) ||
    compact.match(/(\d+)\s+years?\s*\/\s*(\d+)\s*ects/i);

  if (durationMatch) {
    return {
      durationYears: Number(durationMatch[1]),
      ects: Number(durationMatch[2]),
      raw: durationMatch[0],
    };
  }

  const ectsOnly = compact.match(/(\d+)\s*ects/i);
  if (ectsOnly) {
    return {
      durationYears: null,
      ects: Number(ectsOnly[1]),
      raw: ectsOnly[0],
    };
  }

  return {
    durationYears: null,
    ects: null,
    raw: null,
  };
}

async function fetchHtml(url) {
  const response = await axios.get(url, {
    timeout: 30000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      "Accept-Language": "hr-HR,hr;q=0.9,en;q=0.8",
    },
  });

  return response.data;
}

async function collectStudyLinksFromCatalog(catalogUrl) {
  const html = await fetchHtml(catalogUrl);
  const $ = cheerio.load(html);

  const found = new Map();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().replace(/\s+/g, " ").trim();
    const url = normalizeUrl(href, catalogUrl);

    if (!isLikelyStudyUrl(url)) return;

    if (!found.has(url)) {
      found.set(url, {
        url,
        anchorText: text,
        sourceCatalog: catalogUrl,
      });
    }
  });

  return [...found.values()];
}

function uniqueByUrl(items) {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.url)) map.set(item.url, item);
  }
  return [...map.values()];
}

function extractDescription($) {
  const candidates = [];

  $("main p, article p, .entry-content p, .content p, p").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length >= 80 && text.length <= 1200) {
      candidates.push(text);
    }
  });

  return candidates[0] || "";
}

function extractPotentialCourseOrCurriculumLinks($, pageUrl) {
  const links = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().replace(/\s+/g, " ").trim();
    const abs = normalizeUrl(href, pageUrl);

    if (!abs) return;

    const hay = normalizeText(`${text} ${abs}`);

    if (
      hay.includes("kolegij") ||
      hay.includes("predmet") ||
      hay.includes("kurikulum") ||
      hay.includes("izvedbeni plan") ||
      hay.includes("syllabus") ||
      hay.includes("course catalogue") ||
      hay.includes(".pdf")
    ) {
      links.push({
        text,
        url: abs,
      });
    }
  });

  const dedup = new Map();
  for (const link of links) {
    if (!dedup.has(link.url)) dedup.set(link.url, link);
  }
  return [...dedup.values()];
}

async function scrapeStudyPage(studyRef) {
  const html = await fetchHtml(studyRef.url);
  const $ = cheerio.load(html);

  const pageTitle =
    $("h1").first().text().replace(/\s+/g, " ").trim() ||
    $("title").text().replace(/\s+/g, " ").trim() ||
    studyRef.anchorText ||
    "";

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const desc = extractDescription($);
  const duration = extractDurationAndEcts(bodyText);

  const record = {
    title: pageTitle,
    url: studyRef.url,
    language: inferLanguageFromUrl(studyRef.url),
    mode: inferMode(`${pageTitle} ${bodyText}`, studyRef.url),
    level: inferLevel(`${pageTitle} ${bodyText}`),
    location: inferLocation(`${pageTitle} ${bodyText}`, studyRef.url),
    durationYears: duration.durationYears,
    ects: duration.ects,
    durationRaw: duration.raw,
    description: desc,
    anchorText: studyRef.anchorText,
    sourceCatalog: studyRef.sourceCatalog,
    relatedLinks: extractPotentialCourseOrCurriculumLinks($, studyRef.url),
  };

  return record;
}

async function main() {
  console.log("== Baltazar study crawler ==");
  console.log("Collecting study links from catalog pages...");

  let collected = [];

  for (const catalogUrl of CATALOG_URLS) {
    try {
      console.log(`Catalog: ${catalogUrl}`);
      const links = await collectStudyLinksFromCatalog(catalogUrl);
      console.log(`  Found: ${links.length}`);
      collected = collected.concat(links);
    } catch (error) {
      console.error(`  Error reading catalog ${catalogUrl}`);
      console.error(`  ${error.message}`);
    }
  }

  const uniqueStudyLinks = uniqueByUrl(collected);
  console.log(`Total unique study links: ${uniqueStudyLinks.length}`);

  const studies = [];
  const errors = [];

  for (const study of uniqueStudyLinks) {
    try {
      console.log(`Scraping: ${study.url}`);
      const scraped = await scrapeStudyPage(study);
      studies.push(scraped);
    } catch (error) {
      errors.push({
        url: study.url,
        message: error.message,
      });
      console.error(`  Failed: ${study.url}`);
      console.error(`  ${error.message}`);
    }
  }

  const outDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outFile = path.join(outDir, "baltazar_studies.json");
  const errFile = path.join(outDir, "baltazar_studies_errors.json");

  fs.writeFileSync(outFile, JSON.stringify(studies, null, 2), "utf8");
  fs.writeFileSync(errFile, JSON.stringify(errors, null, 2), "utf8");

  console.log("");
  console.log(`Saved studies -> ${outFile}`);
  console.log(`Saved errors  -> ${errFile}`);
  console.log(`Records: ${studies.length}`);
  console.log(`Errors:  ${errors.length}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
