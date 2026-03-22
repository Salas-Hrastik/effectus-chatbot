export function cleanContent(input: string): string {
  if (!input) return "";

  let text = input;

  // 1) normalizacija line breakova
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 2) uklanjanje HTML ostataka ako se potkradu
  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<[^>]+>/g, " ");

  // 3) dekodiranje osnovnih HTML entiteta
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

  // 4) trim svake linije
  let lines = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim());

  // 5) uklanjanje očitog šuma
  lines = lines.filter((line) => {
    if (!line) return true;
    if (line.length <= 2) return false;

    const lower = line.toLowerCase();

    const noisePatterns = [
      "facebook",
      "instagram",
      "linkedin",
      "youtube",
      "cookie",
      "pravila privatnosti",
      "uvjeti korištenja",
      "sva prava pridržana",
      "skip to content",
      "open menu",
      "zatvori",
      "kontakt",
    ];

    if (noisePatterns.includes(lower)) return false;

    return true;
  });

  // 6) uklanjanje uzastopnih duplikata linija
  const deduped: string[] = [];
  for (const line of lines) {
    const prev = deduped[deduped.length - 1];
    if (prev === line) continue;
    deduped.push(line);
  }

  text = deduped.join("\n");

  // 7) sređivanje praznih redova
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

type ChunkOptions = {
  targetSize?: number;
  overlap?: number;
  minChunkSize?: number;
};

export function chunkContent(
  input: string,
  options: ChunkOptions = {}
): string[] {
  const targetSize = options.targetSize ?? 900;
  const overlap = options.overlap ?? 150;
  const minChunkSize = options.minChunkSize ?? 250;

  const text = cleanContent(input);
  if (!text) return [];

  const paragraphs = text
    .split(/\n\s*\n/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  function pushChunk(chunk: string) {
    const normalized = chunk.trim();
    if (!normalized) return;

    if (normalized.length < minChunkSize && chunks.length > 0) {
      chunks[chunks.length - 1] =
        `${chunks[chunks.length - 1]}\n\n${normalized}`.trim();
      return;
    }

    chunks.push(normalized);
  }

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;

    if (candidate.length <= targetSize) {
      current = candidate;
      continue;
    }

    if (current) {
      pushChunk(current);

      const overlapText =
        current.length > overlap
          ? current.slice(current.length - overlap)
          : current;

      const withOverlap = `${overlapText}\n\n${paragraph}`.trim();

      if (withOverlap.length <= targetSize) {
        current = withOverlap;
        continue;
      }
    }

    if (paragraph.length > targetSize) {
      const sentences = paragraph.match(/[^.!?]+[.!?]+|\S.+$/g) ?? [paragraph];
      let sentenceBuffer = "";

      for (const sentence of sentences) {
        const cleanedSentence = sentence.trim();
        if (!cleanedSentence) continue;

        const sentenceCandidate = sentenceBuffer
          ? `${sentenceBuffer} ${cleanedSentence}`.trim()
          : cleanedSentence;

        if (sentenceCandidate.length <= targetSize) {
          sentenceBuffer = sentenceCandidate;
          continue;
        }

        if (sentenceBuffer) {
          pushChunk(sentenceBuffer);
        }

        if (cleanedSentence.length > targetSize) {
          let start = 0;
          while (start < cleanedSentence.length) {
            const end = start + targetSize;
            const piece = cleanedSentence.slice(start, end).trim();
            pushChunk(piece);
            start += Math.max(1, targetSize - overlap);
          }
          sentenceBuffer = "";
        } else {
          sentenceBuffer = cleanedSentence;
        }
      }

      current = sentenceBuffer;
      continue;
    }

    current = paragraph;
  }

  if (current) {
    pushChunk(current);
  }

  return chunks;
}
