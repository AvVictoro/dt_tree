import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'catalog/config/label-overrides.json'), 'utf8'));

export function displayBlockName(alias, sourceName) {
  return config.blocks?.[alias] || sourceName || alias;
}
