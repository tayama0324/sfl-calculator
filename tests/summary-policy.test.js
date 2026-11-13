import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {migrateData,remaining} from '../docs/js/model.js';import {divisionAutoPlan,shouldAutoSearch,parseSummaryRoute,normalizedTrials,MC_PRESETS,withinAutoLimit} from '../docs/js/summary-policy.js';
const data=migrateData(JSON.parse(await readFile(new URL('../docs/data/default.json',import.meta.url))));
test('division auto always uses points, exact up to 100000 states and fast MC above',()=>{
 const d=structuredClone(data.divisions[1]);d.explorationMode='rounds';d.simulation.trials=3000000;
 assert.deepEqual(divisionAutoPlan(d),{explorationMode:'points',calculationMethod:'monteCarlo',trials:100000});
 for(const m of remaining(d).slice(0,3))d.fixedScores[m.id]='40-0';
 assert.equal(divisionAutoPlan(d).calculationMethod,'exact');assert.equal(d.explorationMode,'rounds');assert.equal(d.simulation.trials,3000000);
});
test('exact 100000 boundary includes assumptions, while 100001 is too large',()=>{
 assert.equal(withinAutoLimit('100000'),true);assert.equal(withinAutoLimit('100001'),false);
 // Each unconditioned points match has six states. 6^6 < 100000 < 6^7.
 const d=structuredClone(data.divisions[1]);for(const m of remaining(d).slice(0,2))d.fixedScores[m.id]='40-0';
 assert.equal(shouldAutoSearch(d,{mode:'points'},null,'new'),false);
 d.fixedScores[remaining(d)[2].id]='40-0';assert.equal(shouldAutoSearch(d,{mode:'points'},null,'new'),true);
 assert.equal(shouldAutoSearch(d,{mode:'points'},{status:'done',fingerprint:'new'},'new'),false);
 assert.equal(shouldAutoSearch(d,{mode:'points'},{status:'done',fingerprint:'old'},'new'),true);
 assert.equal(shouldAutoSearch(d,{mode:'points'},{status:'cancelled',fingerprint:'new'},'new'),true);
});
test('MC tiers are only 100k, 1m and 3m, old custom counts normalize to fast',()=>{
 assert.deepEqual(MC_PRESETS.map(([n])=>n),[100000,1000000,3000000]);for(const n of [100000,1000000,3000000])assert.equal(normalizedTrials(n),n);for(const n of [10000,500,0,Infinity])assert.equal(normalizedTrials(n),100000);
});
test('hierarchy routes validate division and team identities',()=>{
 assert.deepEqual(parseSummaryRoute('',data),{page:'home'});assert.deepEqual(parseSummaryRoute('#division/F',data),{page:'division',divisionId:'F'});assert.deepEqual(parseSummaryRoute('#division/S/team/fav',data),{page:'team',divisionId:'S',teamId:'fav'});
 for(const hash of ['#division/X','#division/F/team/fav','#division/S/team/missing','#division/S/extra'])assert.deepEqual(parseSummaryRoute(hash,data),{page:'home'});
});
