import * as cheerio from "cheerio";

const REQUEST_TIMEOUT_MS = 20000;

const URLS = [
  "https://www.bak.hr/nastavnici-suradnici/",
  "https://www.bak.hr/o-nama/nastavnici-suradnici/",
  "https://www.bak.hr/en/o-nama/",
  "https://www.bak.hr/o-nama/",
];

function normalizeWhitespace(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; BaltazarSeedInspector/1.0)",
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
  console.log("BALTAZAR FACULTY SEED PAGE INSPECTION");
  console.log("======================================");

  for (let i = 0; i < URLS.length; i++) {
    const url = URLS[i];
    console.log(`\n[${i + 1}/${URLS.length}] ${url}`);

    try {
      const res = await fetchWithTimeout(url);
      const contentType = (res.headers.get("content-type") || "").toLowerCase();

      console.log(`status      : ${res.status}`);
      console.log(`final url   : ${res.url}`);
      console.log(`content-type: ${contentType || "-"}`);

      const text = await res.text();
      console.log(`body length : ${text.length}`);

      if (contentType.includes("html")) {
        const $ = cheerio.load(text);
        const title = normalizeWhitespace($("title").first().text());
        const h1 = normalizeWhitespace($("h1").first().text());

        console.log(`title       : ${title || "-"}`);
        console.log(`h1          : ${h1 || "-"}`);

        const links: Array<{ href: string; text: string }> = [];
        $("a[href]").each((_, el) => {
          const href = normalizeWhitespace($(el).attr("href") || "");
          const txt = normalizeWhitespace($(el).text() || "");
          if (href) {
            links.push({ href, text: txt });
          }
        });

        console.log(`links found : ${links.length}`);
        console.log("first 20 links:");
        links.slice(0, 20).forEach((link, idx) => {
          console.log(`  ${idx + 1}. href=${link.href} | text=${link.text || "-"}`);
        });
      } else {
        console.log("Non-HTML response.");
      }
    } catch (err) {
      console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("\n======================================");
  console.log("INSPECTION FINISHED");
  console.log("======================================");
}

main();
