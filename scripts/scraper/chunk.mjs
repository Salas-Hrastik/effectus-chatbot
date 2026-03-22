/**
 * Chunker — splits page sections into overlapping chunks suitable for embeddings.
 * Target: 300–900 chars per chunk. Overlap: ~100 chars (last sentence of prev chunk).
 */

const MIN_CHUNK = 150;
const MAX_CHUNK = 900;
const OVERLAP   = 100;

/**
 * Split a long text into overlapping chunks at sentence boundaries.
 */
function splitText(text) {
  if (text.length <= MAX_CHUNK) return [text];

  const chunks = [];
  // Split on sentence-ending punctuation or newlines
  const sentences = text.split(/(?<=[.!?\n])\s+/);
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).trim().length <= MAX_CHUNK) {
      current = current ? current + ' ' + sentence : sentence;
    } else {
      if (current.length >= MIN_CHUNK) {
        chunks.push(current.trim());
        // Overlap: keep last ~OVERLAP chars as context
        const overlap = current.slice(-OVERLAP);
        current = overlap + ' ' + sentence;
      } else {
        current = current ? current + ' ' + sentence : sentence;
      }
    }
  }
  if (current.trim().length >= MIN_CHUNK) {
    chunks.push(current.trim());
  }
  return chunks.length > 0 ? chunks : [text.slice(0, MAX_CHUNK)];
}

/**
 * Split text that contains "N. semestar:" headers into one chunk per semester.
 * Each chunk preserves the heading context so it's independently retrievable.
 * If a single semester's content exceeds MAX_CHUNK, it's further split by splitText.
 */
function splitBySemesters(headingContext, text) {
  // Match lines like "1. semestar:", "2. semestar:", "Semestar 1:" etc.
  const semesterBoundary = /(?=\n\d+\.\s+semestar:)/gi;
  const parts = text.split(semesterBoundary).filter(p => p.trim().length > 0);

  // If there's only one part (no semester headers found), fall back to normal splitting
  if (parts.length <= 1) return null;

  const result = [];
  for (const part of parts) {
    const full = (headingContext + part).trim();
    if (full.length <= MAX_CHUNK) {
      if (full.length >= MIN_CHUNK) result.push(full);
    } else {
      // Semester chunk too big — further split at sentence boundaries
      result.push(...splitText(full));
    }
  }
  return result.length > 0 ? result : null;
}

/**
 * Convert extracted sections into DB-ready chunks.
 * Each chunk has: content, heading_context (H1/H2 prefix for embedding context)
 */
export function buildChunks(sections, pageTitle) {
  const chunks = [];

  for (const section of sections) {
    // Build a context prefix for embedding (heading hierarchy gives semantic context)
    const headingContext = section.heading
      ? `${section.heading}\n`
      : pageTitle
      ? `${pageTitle}\n`
      : '';

    const fullText = headingContext + section.text;
    // Prefer semantic splitting at "N. semestar:" headers (study program pages)
    const semesterParts = fullText.length > MAX_CHUNK
      ? splitBySemesters(headingContext, section.text)
      : null;
    const parts = semesterParts ?? splitText(fullText);

    for (const part of parts) {
      if (part.trim().length >= MIN_CHUNK) {
        chunks.push({
          content: part.trim(),
          heading: section.heading || pageTitle || '',
        });
      }
    }
  }

  return chunks;
}
