const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

const input = path.join(process.cwd(), "data", "baltazar_academic_sources.json");
const output = path.join(process.cwd(), "data", "baltazar_course_source_report.json");

if (!fs.existsSync(input)) {
  console.error("Nedostaje ulazna datoteka:", input);
  process.exit(1);
}

const studies = JSON.parse(fs.readFileSync(input, "utf8"));

async function fetchUrl(url) {
  try {
    const res = await axios.get(url, {
      timeout: 25000,
      responseType: "arraybuffer",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
        "Accept-Language": "hr-HR,hr;q=0.9,en;q=0.8",
      },
      validateStatus: (s) => s >= 200 && s < 400,
    });

    const contentType = String(res.headers["content-type"] || "").toLowerCase();
    const buffer = Buffer.from(res.data);

    return {
      ok: true,
      contentType,
      buffer,
      finalUrl: res.request?.res?.responseUrl || url,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
    };
  }
}

function summarizeHtml(buffer) {
  const html = buffer.toString("utf8");
  const $ = cheerio.load(html);

  const title =
    $("h1").first().text().replace(/\s+/g, " ").trim() ||
    $("title").text().replace(/\s+/g, " ").trim() ||
    "";

  const text = $("body").text().replace(/\s+/g, " ").trim();

  return {
    detectedType: "html",
    title,
    preview: text.slice(0, 1200),
  };
}

function summarizePdf(buffer) {
  const text = buffer.toString("latin1").replace(/\s+/g, " ").trim();

  return {
    detectedType: "pdf",
    title: "",
    preview: text.slice(0, 1200),
  };
}

async function inspectLink(link) {
  const fetched = await fetchUrl(link.url);

  if (!fetched.ok) {
    return {
      text: link.text || "",
      url: link.url,
      type: link.type || "unknown",
      ok: false,
      error: fetched.error,
    };
  }

  const isPdf =
    fetched.contentType.includes("pdf") ||
    fetched.finalUrl.toLowerCase().endsWith(".pdf") ||
    link.url.toLowerCase().endsWith(".pdf");

  const summary = isPdf
    ? summarizePdf(fetched.buffer)
    : summarizeHtml(fetched.buffer);

  return {
    text: link.text || "",
    url: link.url,
    finalUrl: fetched.finalUrl,
    type: link.type || "unknown",
    ok: true,
    contentType: fetched.contentType,
    ...summary,
  };
}

async function main() {
  const report = [];

  for (const study of studies) {
    console.log("Inspecting:", study.study);

    const candidateLinks = [
      ...(study.sources.curriculum || []),
      ...(study.sources.course || []),
      ...(study.sources.pdf_other || []),
    ];

    const inspected = [];

    for (const link of candidateLinks) {
      inspected.push(await inspectLink(link));
    }

    report.push({
      study: study.study,
      slug: study.slug,
      canonicalUrl: study.canonicalUrl,
      inspected,
    });
  }

  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");

  console.log("");
  console.log("SOURCE INSPECTION SUMMARY");
  console.log("");

  for (const item of report) {
    const okCount = item.inspected.filter((x) => x.ok).length;
    console.log(`- ${item.study} | inspected: ${item.inspected.length} | ok: ${okCount}`);
    for (const src of item.inspected.slice(0, 3)) {
      console.log(`  • [${src.type}] ${src.url}`);
      if (src.ok) {
        console.log(`    type=${src.detectedType} contentType=${src.contentType}`);
        console.log(`    preview=${(src.preview || "").slice(0, 180)}`);
      } else {
        console.log(`    ERROR=${src.error}`);
      }
    }
  }

  console.log("");
  console.log("Saved:", output);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
