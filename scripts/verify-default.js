import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { prepare, verifyFractions, formatPercent } from '../site/js/model.js';
import { calculate } from '../site/js/engine.js';
const data = JSON.parse(await readFile(new URL('../site/data/default.json', import.meta.url)));
const reports = [];
for (const d of data.divisions) {
  const started = performance.now(); let last = started;
  console.log(`Division ${d.id}: exact enumeration starting`);
  const result = calculate(prepare(d), p => {
    if (performance.now() - last > 15000) {
      console.log(`Division ${d.id}: ${p.processed}/${p.total} (${((performance.now()-started)/1000).toFixed(1)}s)`);
      last = performance.now();
    }
  });
  const checks = verifyFractions(result);
  if (!checks.ok) throw new Error(`Division ${d.id}: conservation failed`);
  const seconds = (performance.now() - started) / 1000;
  reports.push({ divisionId: d.id, seconds, checks, result });
  console.log(`Division ${d.id}: ${seconds.toFixed(2)}s, ${result.processed} paths, all conservation checks passed`);
  result.ranks.forEach((row, i) => console.log(`${d.teams[i].shortName}: PO ${formatPercent(row.slice(0,3).reduce((s,n)=>s+BigInt(n),0n),result.denominator)}`));
}
await mkdir(new URL('../test-results', import.meta.url), { recursive:true });
await writeFile(new URL('../test-results/default-verification.json', import.meta.url),JSON.stringify(reports,null,2));
