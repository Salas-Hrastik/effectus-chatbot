/**
 * Canonical list of effectus.com.hr pages to index — Croatian content only.
 * NOTE: Effectus uses flat URLs (no /studiji/ subdirectory)
 * Grouped by entity_type for proper metadata tagging.
 */

export const PAGES = [

  // ─── HOMEPAGE & O NAMA ────────────────────────────────────────────────────
  { url: 'https://effectus.com.hr',                                           entity_type: 'opcenito', entity_name: 'EFFECTUS veleučilište' },
  { url: 'https://effectus.com.hr/upoznaj-nas',                               entity_type: 'opcenito', entity_name: 'Upoznaj Effectus' },
  { url: 'https://effectus.com.hr/misija-i-vizija',                           entity_type: 'opcenito', entity_name: 'Misija i vizija' },
  { url: 'https://effectus.com.hr/organizacijska-struktura',                  entity_type: 'opcenito', entity_name: 'Organizacijska struktura' },
  { url: 'https://effectus.com.hr/voditelji-studija',                         entity_type: 'opcenito', entity_name: 'Voditelji studija' },
  { url: 'https://effectus.com.hr/voditelji-studijskih-grupa',                entity_type: 'opcenito', entity_name: 'Voditelji studijskih grupa' },
  { url: 'https://effectus.com.hr/savjet-effectusa',                          entity_type: 'opcenito', entity_name: 'Savjet Effectusa' },
  { url: 'https://effectus.com.hr/strategije',                                entity_type: 'opcenito', entity_name: 'Strategije' },
  { url: 'https://effectus.com.hr/etika',                                     entity_type: 'opcenito', entity_name: 'Etika' },
  { url: 'https://effectus.com.hr/akti-ustanove',                             entity_type: 'opcenito', entity_name: 'Akti ustanove' },

  // ─── UPISI ────────────────────────────────────────────────────────────────
  { url: 'https://effectus.com.hr/otvoreni-upisi',                            entity_type: 'upisi', entity_name: 'Otvoreni upisi' },
  { url: 'https://effectus.com.hr/postupak-upisa-2',                          entity_type: 'upisi', entity_name: 'Postupak upisa' },
  { url: 'https://effectus.com.hr/cijena-skolarine',                          entity_type: 'upisi', entity_name: 'Cijena školarine' },
  { url: 'https://effectus.com.hr/prijemni-ispit',                            entity_type: 'upisi', entity_name: 'Prijemni ispit' },
  { url: 'https://effectus.com.hr/upis-prijelazom-s-drugog-studija',          entity_type: 'upisi', entity_name: 'Upis prijelazom s drugog studija' },
  { url: 'https://effectus.com.hr/ranjive-i-podzastupljene-skupine-studenata', entity_type: 'upisi', entity_name: 'Ranjive i podzastupljene skupine' },

  // ─── STUDIJSKI PROGRAMI — PRIJEDIPLOMSKI ─────────────────────────────────
  { url: 'https://effectus.com.hr/financije-i-poslovno-pravo',                entity_type: 'studij', entity_name: 'Financije i poslovno pravo' },
  { url: 'https://effectus.com.hr/pravo',                                     entity_type: 'studij', entity_name: 'Pravo' },
  { url: 'https://effectus.com.hr/poslovna-ekonomija',                        entity_type: 'studij', entity_name: 'Poslovna ekonomija' },
  { url: 'https://effectus.com.hr/poduzetnistvo-2',                           entity_type: 'studij', entity_name: 'Poduzetništvo' },

  // ─── STUDIJSKI PROGRAMI — DIPLOMSKI ───────────────────────────────────────
  { url: 'https://effectus.com.hr/diplomski-studiji',                         entity_type: 'studij', entity_name: 'Diplomski studiji' },
  { url: 'https://effectus.com.hr/menadzment-financija',                      entity_type: 'studij', entity_name: 'Menadžment financija' },
  { url: 'https://effectus.com.hr/menadzment-u-zdravstvu',                    entity_type: 'studij', entity_name: 'Menadžment u zdravstvu' },
  { url: 'https://effectus.com.hr/menadzment-ljudskih-potencijala-i-znanja',  entity_type: 'studij', entity_name: 'Menadžment ljudskih potencijala i znanja' },
  { url: 'https://effectus.com.hr/analiticki-menadzment',                     entity_type: 'studij', entity_name: 'Analitički menadžment' },
  { url: 'https://effectus.com.hr/bihevioralna-ekonomija',                    entity_type: 'studij', entity_name: 'Bihevioralna ekonomija' },
  { url: 'https://effectus.com.hr/porezi-i-poslovno-pravo',                   entity_type: 'studij', entity_name: 'Porezi i poslovno pravo' },
  { url: 'https://effectus.com.hr/pravo-i-management-nekretnina',             entity_type: 'studij', entity_name: 'Pravo i management nekretnina' },

  // ─── NASTAVNICI ───────────────────────────────────────────────────────────
  { url: 'https://effectus.com.hr/nastavnici-i-suradnici',                    entity_type: 'opcenito', entity_name: 'Nastavnici i suradnici' },

  // ─── STUDENTSKE SLUŽBE ────────────────────────────────────────────────────
  { url: 'https://effectus.com.hr/sluzba-za-podrsku-studentima-i-nastavnicima', entity_type: 'opcenito', entity_name: 'Služba za podršku studentima i nastavnicima' },
  { url: 'https://effectus.com.hr/knjiznica',                                 entity_type: 'opcenito', entity_name: 'Knjižnica' },
  { url: 'https://effectus.com.hr/centar-karijera',                           entity_type: 'opcenito', entity_name: 'Centar karijera' },
  { url: 'https://effectus.com.hr/centar-savjetovanja',                       entity_type: 'opcenito', entity_name: 'Centar savjetovanja' },
  { url: 'https://effectus.com.hr/studentski-zbor',                           entity_type: 'opcenito', entity_name: 'Studentski zbor' },
  { url: 'https://effectus.com.hr/alumni',                                    entity_type: 'opcenito', entity_name: 'Alumni' },
  { url: 'https://effectus.com.hr/akademski-kalendar',                        entity_type: 'opcenito', entity_name: 'Akademski kalendar' },
  { url: 'https://effectus.com.hr/korisnicki-identiteti-u-ldap-imeniku',     entity_type: 'opcenito', entity_name: 'Korisnički identiteti (AAI)' },

  // ─── CJELOŽIVOTNO OBRAZOVANJE ─────────────────────────────────────────────
  { url: 'https://effectus.com.hr/cjelozivotno-obrazovanje',                  entity_type: 'cjelozivotni_program', entity_name: 'Cjeloživotno obrazovanje' },
  { url: 'https://effectus.com.hr/certifikati',                               entity_type: 'cjelozivotni_program', entity_name: 'Certifikati' },
  { url: 'https://effectus.com.hr/mini-mba-doing-business-4-0-db4-executive', entity_type: 'cjelozivotni_program', entity_name: 'Mini MBA — Executive' },
  { url: 'https://effectus.com.hr/mini-mba-doing-business-4-0-db4-management', entity_type: 'cjelozivotni_program', entity_name: 'Mini MBA — Management' },
  { url: 'https://effectus.com.hr/mini-mba-doing-business-4-0-db4-operative', entity_type: 'cjelozivotni_program', entity_name: 'Mini MBA — Operative' },
  { url: 'https://effectus.com.hr/drustveno-odgovorno-poslovanje',            entity_type: 'cjelozivotni_program', entity_name: 'Društveno odgovorno poslovanje' },
  { url: 'https://effectus.com.hr/porezni-a-specijalist-ica-2',              entity_type: 'cjelozivotni_program', entity_name: 'Porezni/a specijalist/ica' },
  { url: 'https://effectus.com.hr/voditelj-ica-nadzora-i-korporativnog-upravljanja-2', entity_type: 'cjelozivotni_program', entity_name: 'Voditelj/ica nadzora i korporativnog upravljanja' },
  { url: 'https://effectus.com.hr/osnove-financijske-pismenosti-i-savjetovanje-potrosaca-u-riziku-prezaduzenosti', entity_type: 'cjelozivotni_program', entity_name: 'Osnove financijske pismenosti' },
  { url: 'https://effectus.com.hr/pravo-i-upravljanje-nekretninama',          entity_type: 'cjelozivotni_program', entity_name: 'Pravo i upravljanje nekretninama' },

  // ─── KONTAKT ──────────────────────────────────────────────────────────────
  { url: 'https://effectus.com.hr/kontakt',                                   entity_type: 'opcenito', entity_name: 'Kontakt' },
];

// Pages to SKIP
export const SKIP_PATTERNS = [
  /\/en\b/,                    // English content
  /\/politika-privatnosti/,    // Privacy policy
  /\/izjava-o-zastiti/,        // Data protection
  /\/novosti\//,               // News items (dynamic)
  /\/media\//,                 // Media files
  /\/wp-admin\//,              // WordPress admin
  /\/wp-json\//,               // WP API
  /\/page\//,                  // Pagination
  /\?/,                        // Query strings
  /\.pdf$/,                    // PDFs
];
