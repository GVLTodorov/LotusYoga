// AC-43: initial JS (entry chunk + its static imports) must be <= 150 KB gzipped.
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const LIMIT = 150 * 1024;
const html = readFileSync('dist/index.html', 'utf8');
const seen = new Set();
let total = 0;

function add(f) {
  if (seen.has(f) || !existsSync(`dist/${f}`)) return;
  seen.add(f);
  const code = readFileSync(`dist/${f}`, 'utf8');
  total += gzipSync(code).length;
  // static imports only (dynamic import() calls are lazy chunks)
  for (const m of code.matchAll(/(?:^|[;}\s])(?:import|export)\s*[^'"`;()]*?from\s*["']\.\/([^"']+\.js)["']/g)) add(`assets/${m[1]}`);
  for (const m of code.matchAll(/(?:^|[;}\s])import\s*["']\.\/([^"']+\.js)["']/g)) add(`assets/${m[1]}`);
}

for (const m of html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)) add(m[1]);
console.log(`Initial JS: ${(total / 1024).toFixed(1)} KB gzipped (limit 150 KB), ${seen.size} file(s)`);
if (total > LIMIT) {
  console.error('Bundle too large');
  process.exit(1);
}
