/**
 * HTML cleaner optimised for bak.hr (Elementor page builder).
 *
 * Strategy:
 *  1. Extract Elementor FAQ toggles → "Pitanje:\n...\nOdgovor:\n..." format
 *  2. Extract Elementor text-editor blocks for body copy
 *  3. Extract Elementor heading widgets for section context
 *  4. Fall back to generic cheerio extraction for non-Elementor pages
 */
import * as cheerio from 'cheerio';

// Noise text patterns — filter these out of any extracted line
const NOISE = [
  /^(Idi na sadržaj|Skip to content)$/i,
  /^Prijavi se[!.]?$/i,
  /^(OVDJE|HERE|Više|Saznaj više|Pročitaj više)\.?$/i,
  /^(Zaprešić|Zagreb|Biograd na Moru?|Osijek)$/i,  // location selector
  /^Veleučilište Baltazar(?: Zaprešić)?$/i,          // branding repeats
  /^Upiši Baltazar$/i,
  /^PRIJAVE I UPISI DETALJI$/i,
  /^Share\b/i,
  /^(rights?|copyright|©)$/i,
  /^(ECTS|ects)\.?$/,
  /^\d+\/\d+$/,    // pagination
  /^[→←►◄»«•]{1,3}$/,
  /^\s*$/,
];

function isNoise(text) {
  return NOISE.some(p => p.test(text.trim()));
}

function cleanText(text) {
  return text
    .replace(/\n{3,}/g, '\n\n')  // collapse excess newlines
    .replace(/[ \t]{2,}/g, ' ')  // collapse spaces/tabs
    .trim();
}

function listItems($, el) {
  const items = [];
  $(el).find('> li').each((_, li) => {
    // Recurse into nested lists if needed
    const nested = $(li).find('ul, ol');
    if (nested.length) {
      const parentText = $(li).clone().find('ul, ol').remove().end().text().trim();
      if (parentText) items.push(`• ${parentText}`);
      nested.each((_, sub) => {
        listItems($, sub).forEach(t => items.push('  ' + t));
      });
    } else {
      const t = $(li).text().replace(/\s+/g, ' ').trim();
      if (t.length > 2 && !isNoise(t)) items.push(`• ${t}`);
    }
  });
  return items;
}

/**
 * Extract from Elementor toggle (FAQ accordion) widget.
 * Returns array of { heading, text } sections — one per Q&A pair.
 */
function extractElementorToggles($) {
  const sections = [];
  $('.elementor-toggle-item').each((_, item) => {
    const q = $(item).find('.elementor-toggle-title').text().trim();
    const $content = $(item).find('.elementor-tab-content');

    if (!q || $content.length === 0) return;

    // Extract answer as clean text, preserving list structure
    const lines = [];
    $content.contents().each(function extractContent() {
      const tag = (this.tagName || '').toLowerCase();
      if (['ul', 'ol'].includes(tag)) {
        listItems($, this).forEach(l => lines.push(l));
      } else if (['p', 'div', 'span'].includes(tag)) {
        const t = $(this).text().replace(/\s+/g, ' ').trim();
        if (t && !isNoise(t)) lines.push(t);
      } else if (this.type === 'text') {
        const t = (this.data || '').trim();
        if (t && !isNoise(t)) lines.push(t);
      }
    });

    // Fallback: just get all text if lines are empty
    if (lines.length === 0) {
      const t = $content.text().replace(/\s+/g, ' ').trim();
      if (t) lines.push(t);
    }

    const answerText = lines
      .filter(l => !isNoise(l))
      .join('\n')
      .trim();

    if (answerText.length > 20) {
      sections.push({
        heading: q,
        level: 3,
        text: `Pitanje: ${q}\n\n${answerText}`,
      });
    }
  });
  return sections;
}

/**
 * Extract Elementor Nested Tabs (e-n-tabs) widget — used on study program pages.
 * Each panel = one academic year; inside each panel, APL shortcode lists subjects
 * per semester with the lecturers.
 * Returns array of { heading, text } sections.
 */
function extractNTabs($) {
  const sections = [];

  $('.elementor-widget-n-tabs').each((_, widget) => {
    const allLines = [];

    // Each direct child of e-n-tabs-content = one tab/year panel
    $(widget).find('.e-n-tabs-content > .elementor-element').each((_, panel) => {
      // Each .apl_show_predmeti block = one semester
      $(panel).find('.apl_show_predmeti').each((_, semBlock) => {
        const semName = $(semBlock).find('.apl_predmeti_semestar').text().trim();
        if (semName) {
          if (allLines.length > 0) allLines.push('');
          allLines.push(`${semName}:`);
        }
        // Each subject row
        $(semBlock).find('.apl-predmeti-container').each((_, subj) => {
          const title = $(subj).find('.apl-predmeti-accordion-title').text().trim();
          const profs = $(subj).find('.apl-accordion-desc-prof')
            .text().replace(/\s+/g, ' ').trim();
          if (title) {
            allLines.push(`• ${title}${profs ? ' — ' + profs : ''}`);
          }
        });
      });
    });

    if (allLines.length > 0) {
      const text = allLines.join('\n').trim();
      if (text.length >= 80) {
        sections.push({ heading: 'Kolegiji i nastavnici', level: 2, text });
      }
    }
  });

  return sections;
}

/**
 * Extract from Elementor heading + text-editor widgets (regular content pages).
 * Groups content under the most recent heading widget.
 */
function extractElementorContent($) {
  const sections = [];
  let currentHeading = '';
  let currentLevel  = 0;
  let currentLines  = [];

  function flush() {
    const raw = currentLines.filter(l => !isNoise(l));
    if (raw.length === 0) { currentLines = []; return; }

    // Pair consecutive DIV-heading label/value lines:
    // "Studij" + "Projektni menadžment" → "Studij: Projektni menadžment"
    const paired = [];
    let i = 0;
    while (i < raw.length) {
      const cur  = raw[i];
      const next = raw[i + 1];
      // Already a key:value line
      if (cur.includes(':')) {
        paired.push(cur);
        i++;
      }
      // Short label (< 45 chars, no special chars) followed by a value
      else if (next && cur.length < 45 && !/[,;•]/.test(cur) &&
               !cur.startsWith('•') && !next.startsWith('•')) {
        paired.push(`${cur}: ${next}`);
        i += 2;
      } else {
        paired.push(cur);
        i++;
      }
    }

    const text = paired.join('\n').trim();
    if (text.length >= 80) {
      sections.push({ heading: currentHeading, level: currentLevel, text });
    }
    currentLines = [];
  }

  // Iterate all Elementor widgets in DOM order
  $('[class*="elementor-widget"]').each((_, widget) => {
    const $w = $(widget);
    const cls = $w.attr('class') || '';

    // Heading widget — can be structural (H1/H2/H3) or label/value info DIV/SPAN
    if (cls.includes('elementor-widget-heading')) {
      const $tagged = $w.find('h1,h2,h3,h4,h5').first();
      const $div    = $w.find('.elementor-heading-title').first();
      const headingText = ($tagged.text() || $div.text()).trim();
      if (!headingText || headingText.length <= 2 || isNoise(headingText)) return;

      const tagName = ($tagged.prop('tagName') || 'DIV').toUpperCase();

      // Real structural headings: H1/H2/H3 tags only
      if (['H1','H2','H3'].includes(tagName)) {
        // Skip noise structural headings (sharing widgets, etc.)
        if (/podijeli s drugima|share this|kratke informacije|kolegiji i profesori|ishodi učenja|detaljni opis|program izvanrednog|nastavni plan/i.test(headingText)) return;
        flush();
        currentHeading = headingText;
        currentLevel   = parseInt(tagName[1]);
        return;
      }

      // DIV/SPAN headings are label/value pairs on study program pages
      // OR standalone key-value lines ("Studij: X", "Trajanje: Y")
      // Collect them as content lines — they'll be paired during flush
      if (!isNoise(headingText) && headingText.length < 150) {
        currentLines.push(headingText);
      }
      return;
    }

    // Text-editor widget
    if (cls.includes('elementor-widget-text-editor')) {
      const $editor = $w.find('.elementor-widget-container');
      $editor.children().each((_, child) => {
        const tag = (child.tagName || '').toLowerCase();
        if (['ul', 'ol'].includes(tag)) {
          listItems($, child).forEach(l => currentLines.push(l));
        } else if (tag === 'table') {
          $(child).find('tr').each((_, tr) => {
            const cells = [];
            $(tr).find('th, td').each((_, td) => {
              const t = $(td).text().trim().replace(/\s+/g, ' ');
              if (t) cells.push(t);
            });
            if (cells.length) currentLines.push(cells.join(' | '));
          });
        } else {
          const t = $(child).text().replace(/\s+/g, ' ').trim();
          if (t.length > 3 && !isNoise(t)) currentLines.push(t);
        }
      });
      return;
    }

    // Icon-list widget (useful for feature lists, prerequisites, etc.)
    if (cls.includes('elementor-widget-icon-list')) {
      $w.find('.elementor-icon-list-text').each((_, li) => {
        const t = $(li).text().replace(/\s+/g, ' ').trim();
        if (t && !isNoise(t)) currentLines.push(`• ${t}`);
      });
      return;
    }

    // Theme post-content widget — renders WordPress post/page body (h2/h3/p/ul)
    // Used on study program pages for the "Zašto [studij]?" description section.
    if (cls.includes('elementor-widget-theme-post-content')) {
      const $container = $w.find('.elementor-widget-container').first();
      $container.children().each((_, child) => {
        const tag = (child.tagName || '').toLowerCase();
        if (['h2', 'h3', 'h4'].includes(tag)) {
          flush();
          const t = $(child).text().trim();
          if (t.length > 2 && !isNoise(t)) {
            currentHeading = t;
            currentLevel   = parseInt(tag[1]);
          }
        } else if (['ul', 'ol'].includes(tag)) {
          listItems($, child).forEach(l => currentLines.push(l));
        } else {
          const t = $(child).text().replace(/\s+/g, ' ').trim();
          if (t.length > 3 && !isNoise(t)) currentLines.push(t);
        }
      });
      return;
    }
  });

  flush();
  return sections;
}

/**
 * Generic fallback for non-Elementor pages.
 */
function extractGeneric($) {
  const REMOVE = [
    'script','style','noscript','nav','header','footer',
    '.nav','.navbar','.menu','.breadcrumb','.sidebar',
    '.cookie','.social','.pagination','.wp-block-cover__background',
  ];
  REMOVE.forEach(sel => { try { $(sel).remove(); } catch {} });

  const sections = [];
  let heading = '';
  let level   = 0;
  let lines   = [];

  function flush() {
    const text = lines.filter(l => !isNoise(l)).join('\n').trim();
    if (text.length >= 80) sections.push({ heading, level, text });
    lines = [];
  }

  $('body *').each((_, el) => {
    const tag = (el.tagName || '').toLowerCase();
    if (['h1','h2','h3','h4'].includes(tag)) {
      flush();
      const t = cheerio.load(el).text().trim();
      if (t.length > 2) { heading = t; level = parseInt(tag[1]); }
    } else if (tag === 'p') {
      const t = cheerio.load(el).text().replace(/\s+/g,' ').trim();
      if (t && !isNoise(t)) lines.push(t);
    } else if (['ul','ol'].includes(tag)) {
      const $ = cheerio.load(el);
      $('li').each((_,li) => {
        const t = $(li).text().replace(/\s+/g,' ').trim();
        if (t && !isNoise(t)) lines.push(`• ${t}`);
      });
    }
  });
  flush();
  return sections;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function extractSections(html, _pageUrl) {
  const $ = cheerio.load(html);

  const isElementor = html.includes('elementor');

  if (isElementor) {
    // SCOPE to main content container only — ignore header/footer/nav elementor regions
    // bak.hr uses data-elementor-type="single-post" or "page" for content
    const $content =
      $('[data-elementor-type="single-post"]').first() ||
      $('[data-elementor-type="page"]').first();

    // Remove header/footer Elementor regions globally to avoid their widgets polluting extraction
    $('[data-elementor-type="header"]').remove();
    $('[data-elementor-type="footer"]').remove();

    // First pass: FAQ toggles (Q&A sections)
    const toggleSections  = extractElementorToggles($);
    // Second pass: Nested Tabs (study program semester/kolegiji tables)
    const tabSections     = extractNTabs($);
    // Third pass: regular content (headings + text-editors + theme-post-content)
    const contentSections = extractElementorContent($);

    // Deduplicate: content sections may duplicate toggle content
    const allSections = [...toggleSections, ...tabSections, ...contentSections];
    // Remove duplicate headings
    const seen = new Set();
    return allSections.filter(s => {
      const key = s.heading.slice(0, 30);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return extractGeneric($);
}

export function extractTitle(html) {
  const $ = cheerio.load(html);
  return (
    $('h1').first().text().trim() ||
    $('title').text().trim().replace(/\s*[|\-–].*/,'').trim() ||
    ''
  );
}
