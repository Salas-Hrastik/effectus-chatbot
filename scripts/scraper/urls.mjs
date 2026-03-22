/**
 * Canonical list of bak.hr pages to index — Croatian content only.
 * Grouped by entity_type for proper metadata tagging.
 * Skip all /en/ URLs — English content pollutes HR-language RAG.
 */

export const PAGES = [

  // ─── UPISI ────────────────────────────────────────────────────────────────
  { url: 'https://www.bak.hr/upisi',                                            entity_type: 'upisi', entity_name: 'Upisi' },
  { url: 'https://www.bak.hr/upisi/cesta-pitanja',                              entity_type: 'upisi', entity_name: 'Upisi — Česta pitanja' },
  { url: 'https://www.bak.hr/upisi/postupak-i-termini-upisa',                   entity_type: 'upisi', entity_name: 'Postupak i termini upisa' },
  { url: 'https://www.bak.hr/upisi/postupak-i-termini-upisa/online-studiranje-upisi-na-strucne-prijediplomske-studije', entity_type: 'upisi', entity_name: 'Upisi — prijediplomski online' },
  { url: 'https://www.bak.hr/upisi/postupak-i-termini-upisa/online-studiranje-upisi-na-strucne-diplomske-studije',     entity_type: 'upisi', entity_name: 'Upisi — diplomski online' },
  { url: 'https://www.bak.hr/upisi/postupak-i-termini-upisa/online-studiranje-upisi-na-strucni-kratki-studij',         entity_type: 'upisi', entity_name: 'Upisi — kratki studij online' },
  { url: 'https://www.bak.hr/upisi/skolarina-i-pogodnosti',                     entity_type: 'upisi', entity_name: 'Školarina i pogodnosti' },
  { url: 'https://www.bak.hr/upisi/upisni-centri',                              entity_type: 'upisi', entity_name: 'Upisni centri' },
  { url: 'https://www.bak.hr/upisi/procedura-upisa',                            entity_type: 'upisi', entity_name: 'Procedura upisa' },

  // ─── STUDIJSKI PROGRAMI — KRATKI ─────────────────────────────────────────
  { url: 'https://www.bak.hr/studijski-programi/primijenjena-ekonomija',         entity_type: 'studij', entity_name: 'Primijenjena ekonomija' },

  // ─── STUDIJSKI PROGRAMI — PRIJEDIPLOMSKI ─────────────────────────────────
  { url: 'https://www.bak.hr/studijski-programi',                                entity_type: 'studij', entity_name: 'Studijski programi' },
  { url: 'https://www.bak.hr/studijski-programi/poslovna-ekonomija-i-financije', entity_type: 'studij', entity_name: 'Poslovna ekonomija i financije' },
  { url: 'https://www.bak.hr/studijski-programi/menadzment-uredskog-poslovanja', entity_type: 'studij', entity_name: 'Menadžment uredskog poslovanja' },
  { url: 'https://www.bak.hr/studijski-programi/menadzment-u-kulturi-i-kulturnom-turizmu', entity_type: 'studij', entity_name: 'Menadžment u kulturi i kulturnom turizmu' },
  { url: 'https://www.bak.hr/studijski-programi/informacijske-tehnologije',      entity_type: 'studij', entity_name: 'Informacijske tehnologije' },
  { url: 'https://www.bak.hr/studijski-programi/socijalna-i-kulturna-integracija', entity_type: 'studij', entity_name: 'Socijalna i kulturna integracija' },
  { url: 'https://www.bak.hr/studijski-programi/menadzment-u-turizmu-i-ugostiteljstvu', entity_type: 'studij', entity_name: 'Menadžment u turizmu i ugostiteljstvu' },
  { url: 'https://www.bak.hr/studijski-programi/poslovna-ekonomija-i-financije-biograd-n-m', entity_type: 'studij', entity_name: 'Poslovna ekonomija i financije (Biograd)' },

  // ─── STUDIJSKI PROGRAMI — DIPLOMSKI ───────────────────────────────────────
  { url: 'https://www.bak.hr/studijski-programi/financije-i-investicije-novo',   entity_type: 'studij', entity_name: 'Financije i investicije' },
  { url: 'https://www.bak.hr/studijski-programi/primijenjene-informacijske-tehnologije', entity_type: 'studij', entity_name: 'Primijenjene informacijske tehnologije' },
  { url: 'https://www.bak.hr/studijski-programi/projektni-menadzment',           entity_type: 'studij', entity_name: 'Projektni menadžment' },
  { url: 'https://www.bak.hr/studijski-programi/projektni-menadzment-osijek',    entity_type: 'studij', entity_name: 'Projektni menadžment (Osijek)' },
  { url: 'https://www.bak.hr/studijski-programi/komunikacijski-menadzment',      entity_type: 'studij', entity_name: 'Komunikacijski menadžment' },
  { url: 'https://www.bak.hr/studijski-programi/menadzment-javnog-sektora',      entity_type: 'studij', entity_name: 'Menadžment javnog sektora' },

  // ─── ONLINE STUDIRANJE ────────────────────────────────────────────────────
  { url: 'https://www.bak.hr/online-studiranje',                                 entity_type: 'online_studij', entity_name: 'Online studiranje' },
  { url: 'https://www.bak.hr/online-studiranje/o-online-studiranju',             entity_type: 'online_studij', entity_name: 'O online studiranju' },
  { url: 'https://www.bak.hr/online-studiranje/cesta-pitanja',                   entity_type: 'online_studij', entity_name: 'Online studiranje — Česta pitanja' },

  // ─── CJELOŽIVOTNO OBRAZOVANJE ─────────────────────────────────────────────
  { url: 'https://www.bak.hr/cjelozivotno-obrazovanje',                          entity_type: 'cjelozivotni_program', entity_name: 'Cjeloživotno obrazovanje' },
  { url: 'https://www.bak.hr/cjelozivotno-obrazovanje/o-cjelozivotnom-obrazovanju-i-ucenju', entity_type: 'cjelozivotni_program', entity_name: 'O cjeloživotnom obrazovanju' },
  { url: 'https://www.bak.hr/cjelozivotno-obrazovanje/turisticki-vodic',         entity_type: 'cjelozivotni_program', entity_name: 'Turistički vodič' },
  { url: 'https://www.bak.hr/cjelozivotno-obrazovanje/voditelj-poslova-u-turistickoj-agenciji-priprema-za-polaganje-strucnog-ispita', entity_type: 'cjelozivotni_program', entity_name: 'Voditelj poslova u turističkoj agenciji' },
  { url: 'https://www.bak.hr/cjelozivotno-obrazovanje/upravljanje-i-procjena-vrijednosti-nekretnina', entity_type: 'cjelozivotni_program', entity_name: 'Upravljanje i procjena vrijednosti nekretnina' },
  { url: 'https://www.bak.hr/cjelozivotno-obrazovanje/akademija-projektnog-menadzmenta-baltazar', entity_type: 'cjelozivotni_program', entity_name: 'Akademija projektnog menadžmenta' },
  { url: 'https://www.bak.hr/cjelozivotno-obrazovanje/interpretacija-bastine-za-razvoj-turistickog-proizvoda', entity_type: 'cjelozivotni_program', entity_name: 'Interpretacija baštine za razvoj turističkog proizvoda' },
  { url: 'https://www.bak.hr/cjelozivotno-obrazovanje/hrvatski-jezik-i-kultura-za-strance', entity_type: 'cjelozivotni_program', entity_name: 'Hrvatski jezik i kultura za strance' },
  { url: 'https://www.bak.hr/cjelozivotno-obrazovanje/upravljanje-eu-projektima', entity_type: 'cjelozivotni_program', entity_name: 'Upravljanje EU projektima' },
  { url: 'https://www.bak.hr/cjelozivotno-obrazovanje/suvremeni-trendovi-u-gastronomiji', entity_type: 'cjelozivotni_program', entity_name: 'Suvremeni trendovi u gastronomiji' },
  { url: 'https://www.bak.hr/cjelozivotno-obrazovanje/osnove-racunovodstva-za-pocetnike-korak-po-korak-do-financijske-pismenosti', entity_type: 'cjelozivotni_program', entity_name: 'Osnove računovodstva za početnike' },
  { url: 'https://www.bak.hr/cjelozivotno-obrazovanje/web-dizajn-u-wordpressu',  entity_type: 'cjelozivotni_program', entity_name: 'Web-dizajn u WordPressu' },
  { url: 'https://www.bak.hr/cjelozivotno-obrazovanje/specijalist-ica-za-digitalni-marketing-vaucer', entity_type: 'cjelozivotni_program', entity_name: 'Specijalist za digitalni marketing' },

  // ─── O NAMA ───────────────────────────────────────────────────────────────
  { url: 'https://www.bak.hr/o-nama',                                            entity_type: 'opcenito', entity_name: 'O Veleučilištu Baltazar' },
  { url: 'https://www.bak.hr/o-nama/menadzment-veleucilista',                    entity_type: 'opcenito', entity_name: 'Menadžment Veleučilišta' },
  // { url: 'https://www.bak.hr/o-nama/o-baltazaru', entity_type: 'opcenito' },  // 404
  { url: 'https://www.bak.hr/o-nama/misija-vizija-vrijednosti',                  entity_type: 'opcenito', entity_name: 'Misija, vizija i vrijednosti' },
  { url: 'https://www.bak.hr/o-nama/kvaliteta',                                  entity_type: 'opcenito', entity_name: 'Kvaliteta' },
  { url: 'https://www.bak.hr/o-nama/dokumenti',                                  entity_type: 'opcenito', entity_name: 'Dokumenti' },

  // ─── OPĆE FAQ ─────────────────────────────────────────────────────────────
  // /cesta-pitanja redirects to /medunarodna-suradnja/cesta-pitanja (empty page)
  // Use specific FAQ pages instead: /upisi/cesta-pitanja and /online-studiranje/cesta-pitanja

  // ─── MEĐUNARODNA SURADNJA ─────────────────────────────────────────────────
  { url: 'https://www.bak.hr/medunarodna-suradnja',                              entity_type: 'opcenito', entity_name: 'Međunarodna suradnja' },
  { url: 'https://www.bak.hr/medunarodna-suradnja/erasmus-study',                entity_type: 'opcenito', entity_name: 'Erasmus+ studij' },
  { url: 'https://www.bak.hr/medunarodna-suradnja/erasmus-studentska-praksa',    entity_type: 'opcenito', entity_name: 'Erasmus+ studentska praksa' },
  { url: 'https://www.bak.hr/medunarodna-suradnja/odlazna-studentska-mobilnost', entity_type: 'opcenito', entity_name: 'Odlazna studentska mobilnost' },

  // ─── KONTAKT ──────────────────────────────────────────────────────────────
  { url: 'https://www.bak.hr/kontakt',                                           entity_type: 'opcenito', entity_name: 'Kontakt' },
];

// Pages to SKIP even if discovered via crawl
export const SKIP_PATTERNS = [
  /\/en\//,                  // English content
  /\/pravila-privatnosti/,   // Privacy policy
  /\/uvjeti-koristenja/,     // Terms of use
  /\/odrziva-istina/,        // Blog posts
  /\/novosti\//,             // News items
  /\/media\//,               // Media files
];
