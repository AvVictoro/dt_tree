import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const root = process.cwd();
const fixture = JSON.parse(gunzipSync(await fs.readFile(path.join(root, 'catalog/data/catalog-data.json.gz'))).toString('utf8'));
const exactMnemonic = 'OBJCPRM.RU75.RUB.TH.NA.M.DOM.A.AVG.NSA';
const checks = [];
const check = (name, passed, details) => checks.push({ name, passed: Boolean(passed), details });

check('control_total_indicators', fixture.manifest.totals.indicators === 1_606_756, fixture.manifest.totals.indicators);
check('block_count', fixture.blocks.length === 15, fixture.blocks.length);
check('every_block_represented', fixture.blocks.every(block => block.availableSeries > 0), Object.fromEntries(fixture.blocks.map(block => [block.alias, block.availableSeries])));
check('series_ids_unique', new Set(fixture.indicators.map(item => item.seriesId)).size === fixture.indicators.length, fixture.indicators.length);
check('mnemonics_unique', new Set(fixture.indicators.map(item => item.mnemonic)).size === fixture.indicators.length, fixture.indicators.length);
check('exact_mnemonic', fixture.indicators.some(item => item.mnemonic === exactMnemonic), exactMnemonic);
check('taxonomy4_complete', fixture.indicators.every(item => item.taxonomy4?.topic?.alias && item.taxonomy4?.theme?.alias && item.taxonomy4?.subtheme?.alias && item.taxonomy4?.subtheme2?.alias), fixture.indicators.length);
check('taxonomy3_complete', fixture.indicators.every(item => {
  const path = fixture.taxonomy3Paths?.[item.taxonomy3PathId];
  return path?.topic?.alias && path?.theme?.alias && path?.subtheme?.alias;
}), Object.keys(fixture.taxonomy3Paths || {}).length);
check('no_synthetic_observations', fixture.indicators.every(item => item.availability?.hasTimeSeries === false && item.availability?.observationCount === 0), fixture.indicators.length);
const nameVariants = new Map();
for (const item of fixture.indicators) {
  const variants = nameVariants.get(item.name) || new Set();
  variants.add(`${item.geography?.code}|${item.frequency?.code}|${item.unit?.code}`);
  nameVariants.set(item.name, variants);
}
check('same_name_variants', [...nameVariants.values()].some(variants => variants.size > 1), [...nameVariants.values()].filter(variants => variants.size > 1).length);

const report = {
  generatedAt: new Date().toISOString(),
  mode: 'file',
  status: checks.every(item => item.passed) ? 'PASS_FILE' : 'FAIL',
  controlIndicators: fixture.manifest.totals.indicators,
  queryableIndicators: fixture.indicators.length,
  fullDataReady: false,
  fixtureIndicators: fixture.indicators.length,
  checks,
};
await fs.mkdir(path.join(root, 'reports'), { recursive: true });
await fs.writeFile(path.join(root, 'reports/catalog-validation.json'), JSON.stringify(report, null, 2));
await fs.writeFile(path.join(root, 'reports/catalog-validation.md'), `# Catalog validation\n\nStatus: **${report.status}**\n\n- Mode: \`${report.mode}\`\n- Control indicators: **${report.controlIndicators.toLocaleString('ru-RU')}**\n- Queryable indicators: **${report.queryableIndicators.toLocaleString('ru-RU')}**\n- Full data ready: **${report.fullDataReady}**\n\n${checks.map(item => `- ${item.passed ? 'PASS' : 'FAIL'} — ${item.name}: \`${JSON.stringify(item.details)}\``).join('\n')}\n`);
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'PASS_FILE') process.exitCode = 1;
