import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const axios = require('axios');
const cheerio = require('cheerio');

const checkUrls = [
  'https://www.bak.hr/studijski-programi',
  'https://www.bak.hr/cjelozivotno-obrazovanje',
];

for (const url of checkUrls) {
  const r = await axios.get(url, {
    headers: {'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'hr'},
    timeout: 10000
  });
  const $ = cheerio.load(r.data);
  const links = new Set();
  $('a').each((_, a) => {
    const href = $(a).attr('href') || '';
    if (href.startsWith('https://www.bak.hr') || href.startsWith('/')) {
      links.add(href.replace('https://www.bak.hr', ''));
    }
  });
  console.log(`\n=== ${url} ===`);
  [...links]
    .filter(l => l.includes(url.split('.hr')[1]))
    .filter(l => l.split('/').length === 3)
    .sort()
    .forEach(l => console.log(' ', l));
}
