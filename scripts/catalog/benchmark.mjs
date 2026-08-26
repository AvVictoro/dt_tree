import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { handleCatalogRequest } from '../../server/catalog-service.mjs';

const cases = [
  ['manifest', '/api/catalog/manifest'],
  ['exact mnemonic', '/api/catalog/search?q=OBJCPRM.RU75.RUB.TH.NA.M.DOM.A.AVG.NSA'],
  ['text search', '/api/catalog/search?q=процентные%20ставки'],
  ['facets', '/api/catalog/facets?block=BLOCK_09_FIN_MARKETS'],
  ['hierarchy', '/api/catalog/hierarchy?level=subtheme2&block=BLOCK_01_DOMCLICK&topic=TOPIC_REAL_ESTATE&theme=THEME_REAL_ESTATE_HOUSING&subtheme=SUBTHEME_REAL_ESTATE_HOUSING_PRICES'],
  ['grouped exact member', '/api/catalog/groups?q=OBJCPRM.RU75.RUB.TH.NA.M.DOM.A.AVG.NSA&limit=10'],
];
const results = [];
for (const [name, pathValue] of cases) {
  const times = [];
  for (let iteration = 0; iteration < 30; iteration += 1) {
    const url = new URL(`http://local${pathValue}`);
    const started = performance.now();
    const response = await handleCatalogRequest({ pathname: url.pathname, searchParams: url.searchParams });
    if (response.status !== 200) throw new Error(`${name}: HTTP ${response.status}`);
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  results.push({ name, medianMs: Number(times[14].toFixed(2)), p95Ms: Number(times[28].toFixed(2)), maxMs: Number(times[29].toFixed(2)) });
}
const report = `# Performance report\n\nLocal Node.js API over the bundled real-data fixture; 30 iterations after process start. Production performance depends on PostgreSQL/Neon indexes from \`migrations/001_catalog.sql\` and \`migrations/002_catalog_grouping.sql\`.\n\n| Scenario | Median, ms | P95, ms | Max, ms |\n|---|---:|---:|---:|\n${results.map(item => `| ${item.name} | ${item.medianMs} | ${item.p95Ms} | ${item.maxMs} |`).join('\n')}\n`;
await fs.mkdir(path.join(process.cwd(), 'reports'), { recursive: true });
await fs.writeFile(path.join(process.cwd(), 'PERFORMANCE_REPORT.md'), report);
console.log(report);
