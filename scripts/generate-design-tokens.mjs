import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';

const root = path.resolve(import.meta.dirname, '..');
const designPath = path.join(root, 'DESIGN.md');
const outputPath = path.join(root, 'frontend', 'admin', 'src', 'styles', 'tokens.css');
const source = fs.readFileSync(designPath, 'utf8');
const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!match) throw new Error('DESIGN.md front matter was not found.');
const design = YAML.parse(match[1]);

const kebab = (value) => value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
const lines = ['/* Generated from DESIGN.md. Run npm run design:tokens. */', ':root {'];
for (const [group, values] of Object.entries(design)) {
  if (!values || typeof values !== 'object' || Array.isArray(values) || group === 'components') continue;
  for (const [name, raw] of Object.entries(values)) {
    if (raw && typeof raw === 'object') {
      for (const [property, value] of Object.entries(raw)) {
        lines.push(`  --${kebab(group)}-${kebab(name)}-${kebab(property)}: ${value};`);
      }
    } else if (typeof raw === 'string' || typeof raw === 'number') {
      lines.push(`  --${kebab(group)}-${kebab(name)}: ${raw};`);
    }
  }
}
lines.push('}', '');
const rendered = lines.join('\n').replaceAll(/"\{colors\.([^}]+)\}"/g, 'var(--colors-$1)');

if (process.argv.includes('--check')) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8').replaceAll('\r\n', '\n') : '';
  if (current !== rendered) {
    console.error('Design tokens are out of date. Run npm run design:tokens.');
    process.exitCode = 1;
  } else {
    console.log('Design tokens are current.');
  }
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, rendered, 'utf8');
  console.log(`Wrote ${path.relative(root, outputPath)}.`);
}
