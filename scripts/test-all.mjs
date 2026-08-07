/* Run every test suite. One command, one exit code.
 *
 *   node scripts/test-all.mjs
 *
 * The data audits are a separate step (python tools/dzc/rebuild.py --skip-scan)
 * because they need the source PDFs; these are the JS suites, which run
 * anywhere Node does, plus ruff and pyright over tools/dzc.
 *
 * The Python checks are here rather than in a hook nobody runs. They are
 * SKIPPED, not failed, when uv is not installed: this file is the JS suite's
 * front door and a contributor without a Python toolchain must still be able
 * to run it. A skip prints a "!!" line, so it is never silent.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

const SUITES = [
  ['data layer', 'test-dzc-data.mjs'],
  ['army construction', 'test-dzc-army.mjs'],
  ['share links', 'test-dzc-share.mjs'],
  ['fleet sync', 'test-fleet-sync.mjs'],
  ['house rules', 'test-house-rules.mjs'],
  ['render', 'test-dzc-render.mjs'],
  ['shell', 'test-shell.mjs']
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

/* ruff and pyright over tools/dzc.
 *
 * uv is found the way it is actually installed on this machine — pip install
 * uv puts uv.exe in a user Scripts directory that is not on PATH, so `uv`
 * alone fails while `python -m uv` works. Both are tried before giving up.
 *
 * A finding here is a FAILURE, not a warning. The scanners are where every
 * number in the app comes from, and "the linter is unhappy but the data looks
 * fine" is how a scanner ships a wrong stat card. */
function uvRunner() {
  for (const argv of [['uv'], [process.env.PYTHON || 'python', '-m', 'uv']]) {
    const probe = spawnSync(argv[0], [...argv.slice(1), '--version'], { encoding: 'utf8' });
    if (probe.status === 0) return argv;
  }
  return null;
}

const uv = uvRunner();
if (!uv) {
  warnings.push('uv is not installed — ruff and pyright over tools/dzc did not run '
    + '(pip install uv, then node scripts/test-all.mjs again)');
} else {
  for (const [label, argv] of [
    ['ruff', ['run', 'ruff', 'check', '.']],
    ['pyright', ['run', 'pyright']],
  ]) {
    const r = spawnSync(uv[0], [...uv.slice(1), ...argv],
      { cwd: ROOT, encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    if (r.status !== 0) {
      failed += 1;
      process.stderr.write(out);
      rows.push([label, 0, 1]);
    } else {
      rows.push([label, 1, 0]);
    }
  }
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
