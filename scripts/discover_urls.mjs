import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const axios = require('axios');
const cheerio = require('cheerio');

async function getLinks(url, pathPrefix) {
  const r = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'hr' },
    timeout: 12000
  });
  const $ = cheerio.load(r.data);
  const links = new Set();
  $('a[href]').each((_, a) => {
    const h = $(a).attr('href') || '';
    const full = h.startsWith('http') ? h : 'https://www.bak.hr' + h;
    if (full.includes(pathPrefix) && !full.includes('/en/')) {
      links.add(full.replace(/\/$/, ''));
    }
  });
  return [...links].sort();
}

console.log('\n=== STUDIJSKI PROGRAMI ===');
const studiji = await getLinks('https://www.bak.hr/studijski-programi', 'bak.hr/studijski-programi/');
studiji.forEach(l => console.log(' ', l));

console.log('\n=== CJELOŽIVOTNO OBRAZOVANJE ===');
const czo = await getLinks('https://www.bak.hr/cjelozivotno-obrazovanje', 'bak.hr/cjelozivotno-obrazovanje/');
czo.forEach(l => console.log(' ', l));
