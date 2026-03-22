import * as cheerio from "cheerio";

const REQUEST_TIMEOUT_MS = 20000;

const URLS = [
  "https://www.bak.hr/o-nama/",
  "https://www.bak.hr/en/o-nama/",
];

function normalizeWhitespace(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

function unique(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean).map(normalizeWhitespace))];
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
        "user-agent": "Mozilla/5.0 (compatible; BaltazarAboutFacultyFinder/1.0)",
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
  console.log("BALTAZAR ABOUT PAGE FACULTY LINK FINDER");
  console.log("======================================");

  for (let i = 0; i < URLS.length; i++) {
    const pageUrl = URLS[i];
    console.log(`\n[${i + 1}/${URLS.length}] ${pageUrl}`);

    try {
      const res = await fetchWithTimeout(pageUrl);
      const contentType = (res.headers.get("content-type") || "").toLowerCase();

      console.log(`status      : ${res.status}`);
      console.log(`final url   : ${res.url}`);
      console.log(`content-type: ${contentType || "-"}`);

      if (!contentType.includes("html")) {
        console.log("Non-HTML response.");
        continue;
      }

      const html = await res.text();
      const $ = cheerio.load(html);

      const facultyLinks: Array<{ href: string; text: string }> = [];

      $("a[href]").each((_, el) => {
        const hrefRaw = $(el).attr("href") || "";
        const href = safeUrl(hrefRaw, pageUrl);
        if (!href) return;

        const text = normalizeWhitespace($(el).text() || "");

        if (href.includes("/nastavnici-suradnici/")) {
          facultyLinks.push({ href, text });
        }
      });

      const uniqueLinks = unique(facultyLinks.map((x) => `${x.href}|||${x.text}`))
        .map((row) => {
          const [href, text] = row.split("|||");
          return { href, text };
        });

      console.log(`faculty links found: ${uniqueLinks.length}`);

      uniqueLinks.forEach((link, idx) => {
        console.log(`${idx + 1}. href=${link.href} | text=${link.text || "-"}`);
      });
    } catch (err) {
      console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("\n======================================");
  console.log("FINDER FINISHED");
  console.log("======================================");
}

main();
