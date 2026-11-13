import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {migrateData,current,remaining,validate} from '../docs/js/model.js';import {userSettings,applyUserSettings} from '../docs/js/user-settings.js';import {simulationFingerprint} from '../docs/js/monte-carlo.js';
const raw=JSON.parse(await readFile(new URL('../docs/data/default.json',import.meta.url))),published=migrateData(raw);
const rule={id:'h',metric:'homePoints',operator:'gte',value:30,source:'manual'};
function oldData(){const old=structuredClone(published),f=old.divisions[1];f.baseline.asOf='2026-11-07';f.baseline.includedMatchIds=f.fixtures.filter(m=>m.round<=6).map(m=>m.id);const totals={rid:[180,10,19],g8s:[150,7,7],rej:[140,7,17],dfm:[130,-1,-1],vl:[110,-9,-19],oja:[60,-14,-23]};for(const row of f.baseline.standings){row.played=6;[row.points,row.battleDiff,row.roundDiff]=totals[row.teamId];}return old;}
test('old saved F round 6 data updates to published round 7, retaining only future assumptions',()=>{
 const old=oldData(),f=old.divisions[1];f.matchAssumptions={'f-7-g8s-vl':[rule],'f-8-g8s-rej':[rule]};f.calculationMethod='monteCarlo';f.simulation={seed:'saved',trials:500};old.conditionSearch.F={...old.conditionSearch.F,targetTeamId:'g8s',mode:'battles'};assert.deepEqual(validate(old),[]);
 const before=JSON.stringify(published),loaded=applyUserSettings(published,old),next=loaded.data.divisions[1];assert.equal(loaded.removed,1);assert.deepEqual(next.baseline,published.divisions[1].baseline);assert.equal(remaining(next).length,9);assert(current(next).every(t=>t.played===7));assert.deepEqual(next.matchAssumptions,{'f-8-g8s-rej':[rule]});assert.deepEqual(next.simulation,f.simulation);assert.equal(loaded.data.conditionSearch.F.targetTeamId,'g8s');assert.equal(JSON.stringify(published),before);
});
test('preferences never store standings, teams, full schedule or recorded results',()=>{
 const d=structuredClone(published);d.divisions[0].matchAssumptions[remaining(d.divisions[0])[0].id]=[rule];const saved=userSettings(d);
 for(const division of saved.divisions)for(const field of ['baseline','teams','fixtures','results'])assert(!Object.hasOwn(division,field));
 const next=applyUserSettings(published,JSON.parse(JSON.stringify(saved))).data;
 for(let i=0;i<2;i++)assert.equal(simulationFingerprint({...next.divisions[i],cases:[]}),simulationFingerprint({...d.divisions[i],cases:[]}));
});
test('legacy JSON actual results and roster edits cannot override published tournament data',()=>{
 const old=structuredClone(published),d=old.divisions[0],id=remaining(d)[0].id;d.results[id]={homePoints:40,awayPoints:0,homeBattleDiffDelta:7,homeRoundDiffDelta:14};d.teams[0].name='Edited name';assert.deepEqual(validate(old),[]);
 const next=applyUserSettings(published,old).data;assert.deepEqual(next.divisions[0].results,published.divisions[0].results);assert.deepEqual(next.divisions[0].teams,published.divisions[0].teams);assert.equal(remaining(next.divisions[0]).length,6);
 const preferences=userSettings(old);preferences.divisions[0].baseline=d.baseline;preferences.divisions[0].results=d.results;assert.deepEqual(applyUserSettings(published,preferences).data.divisions[0].results,{});
});
test('same match ID with changed opponents does not silently inherit old assumptions',()=>{
 const old=structuredClone(published),d=old.divisions[0],id=remaining(d)[0].id;d.matchAssumptions[id]=[rule];const saved=userSettings(old);saved.divisions[0].assumptionFixtures[id].homeTeamId='other';const loaded=applyUserSettings(published,saved);assert.equal(loaded.removed,1);assert.deepEqual(loaded.data.divisions[0].matchAssumptions,{});
});
test('v1 settings migrate, another season resets preferences, invalid preferences do not mutate published data',()=>{
 assert.deepEqual(validate(applyUserSettings(published,raw).data),[]);const saved=userSettings(published);saved.season=2025;assert.equal(applyUserSettings(published,saved).seasonChanged,true);
 const invalid=userSettings(published);invalid.divisions[0].explorationMode='invalid';const before=JSON.stringify(published);assert.throws(()=>applyUserSettings(published,invalid));assert.equal(JSON.stringify(published),before);
});
test('S round 8 publication removes completed assumptions and keeps future assumptions',async()=>{
 const oldRaw=structuredClone(raw);oldRaw.divisions[0]=JSON.parse(await readFile(new URL('./fixtures/division-s-round7.json',import.meta.url)));
 const old=migrateData(oldRaw),d=old.divisions[0];d.matchAssumptions={'s-8-fav-ixa':[rule],'s-9-ixa-cr':[rule]};
 const future=remaining(published.divisions[0])[0].id;delete d.matchAssumptions['s-9-ixa-cr'];d.matchAssumptions[future]=[rule];
 const loaded=applyUserSettings(published,userSettings(old)),next=loaded.data.divisions[0];
 assert.equal(loaded.removed,1);assert.deepEqual(Object.keys(next.matchAssumptions),[future]);assert.equal(remaining(next).length,6);
 assert.deepEqual(next.teams.map(t=>t.id),['zet','sol','fav','ibs','cr','ixa']);assert(current(next).every(t=>t.played===8));assert.deepEqual(next.baseline,published.divisions[0].baseline);
});
