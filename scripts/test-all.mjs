/* Run every test suite. One command, one exit code.
 *
 *   node scripts/test-all.mjs
 *
 * The data audits are a separate step (python tools/dzc/rebuild.py --skip-scan)
 * because they need Python and the source PDFs; these are the JS suites, which
 * run anywhere Node does.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const SUITES = [
  ['data layer', 'test-dzc-data.mjs'],
  ['army construction', 'test-dzc-army.mjs'],
  ['share links', 'test-dzc-share.mjs'],
  ['fleet sync', 'test-fleet-sync.mjs'],
  ['house rules', 'test-house-rules.mjs']
];

let failed = 0;
const rows = [];
// A suite can flag something that is real but not a failure -- a known missing
// asset, a defect in a source PDF. Those lines are marked "!!" and reprinted
// below the table, because a passing suite prints nothing and a warning nobody
// sees is not a warning.
const warnings = [];
for (const [label, file] of SUITES) {
  const r = spawnSync(process.execPath, [path.join(HERE, file)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  const pass = m ? +m[1] : 0;
  const fail = m ? +m[2] : (r.status === 0 ? 0 : 1);
  if (r.status !== 0 || fail) {
    failed += fail || 1;
    process.stderr.write(out);
  }
  out.split('\n').filter(l => l.trimStart().startsWith('!!'))
    .forEach(l => warnings.push(l.trim().replace(/^!!\s*/, '')));
  rows.push([label, pass, fail]);
}

const width = Math.max(...rows.map(r => r[0].length));
console.log('');
rows.forEach(([label, pass, fail]) => {
  console.log(`  ${label.padEnd(width)}  ${String(pass).padStart(3)} passed` +
              (fail ? `, ${fail} FAILED` : ''));
});
if (warnings.length) {
  console.log('');
  warnings.forEach(w => console.log(`  !! ${w}`));
}
const total = rows.reduce((n, r) => n + r[1], 0);
console.log(`\n  ${String(total).padStart(width + 3)} assertions, ${failed ? failed + ' failing' : 'all passing'}\n`);
process.exit(failed ? 1 : 0);
