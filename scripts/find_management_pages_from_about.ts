import * as cheerio from "cheerio";

const REQUEST_TIMEOUT_MS = 20000;
const PAGE_URL = "https://www.bak.hr/o-nama/";

function normalizeWhitespace(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

function normalizeText(s: string): string {
  return normalizeWhitespace((s || "").toLowerCase());
}

function safeUrl(input: string, base: string): string | null {
  try {
    const u = new URL(input, base);
    u.hash = "";
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; BaltazarManagementPageFinder/1.0)",
        accept: "text/html,*/*;q=0.8",
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log("======================================");
  console.log("FIND MANAGEMENT PAGES FROM ABOUT");
  console.log("======================================");
  console.log("Source page:", PAGE_URL);
  console.log("--------------------------------------");

  const res = await fetchWithTimeout(PAGE_URL);
  const contentType = (res.headers.get("content-type") || "").toLowerCase();

  console.log("status      :", res.status);
  console.log("final url   :", res.url);
  console.log("content-type:", contentType || "-");

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  if (!contentType.includes("html")) {
    throw new Error("Odgovor nije HTML.");
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const matches: Array<{ text: string; href: string }> = [];

  $("a[href]").each((_, el) => {
    const rawHref = $(el).attr("href") || "";
    const href = safeUrl(rawHref, PAGE_URL);
    const text = normalizeWhitespace($(el).text() || "");

    if (!href || !text) return;

    const t = normalizeText(text);

    if (
      t.includes("menadžment veleučilišta") ||
      t.includes("menadzment veleucilista") ||
      t.includes("dosadašnji dekani") ||
      t.includes("dosadasnji dekani") ||
      t.includes("dekani")
    ) {
      matches.push({ text, href });
    }
  });

  const dedup = new Map<string, { text: string; href: string }>();
  for (const m of matches) {
    const key = `${m.href}|||${m.text}`;
    if (!dedup.has(key)) dedup.set(key, m);
  }

  const results = [...dedup.values()];

  console.log("Matches found:", results.length);
  console.log("--------------------------------------");

  if (!results.length) {
    console.log("Nisu pronađeni ciljani linkovi na stranici.");
  } else {
    results.forEach((m, i) => {
      console.log(`${i + 1}. text=${m.text}`);
      console.log(`   href=${m.href}`);
    });
  }

  console.log("======================================");
  console.log("FINDER FINISHED");
  console.log("======================================");
}

main().catch((err) => {
  console.error("❌ FINDER FAILED");
  console.error(err);
  process.exit(1);
});
