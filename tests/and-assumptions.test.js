import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {migrateData,validate,remaining,resolveMatch,prepare,BASE_CASE,boundsOf} from '../site/js/model.js';
import {rulesFor,setMatchRules,mergeMatchRules,clearMatchRules,filterRuleOutcomes} from '../site/js/match-assumptions.js';
import {conditionedOutcomes} from '../site/js/distributions.js';
import {calculate} from '../site/js/engine.js';
import {exhaustiveCost} from '../site/js/exhaustive-cost.js';
import {necessaryMatchRules} from '../site/js/necessary-assumptions.js';
import {runConditionSearch,searchFingerprint} from '../site/js/condition-search.js';
import {createMonteCarlo,checkpointResults} from '../site/js/monte-carlo.js';
const raw=JSON.parse(await readFile(new URL('../site/data/default.json',import.meta.url)));
const rule=(metric,value,operator='gte')=>({id:`${metric}-${operator}-${value}`,metric,value,operator,source:'manual'});
const fresh=()=>migrateData(raw);
function small(){const d=fresh().divisions[0];d.cases=[];for(const m of remaining(d).slice(1))d.results[m.id]={homePoints:40,awayPoints:0,homeBattleDiffDelta:7,homeRoundDiffDelta:14};return d;}
const scores=rows=>rows.map(([h,a])=>`${h}-${a}`);
test('AND rules are order independent, preserve both possible scores and reject contradictions',()=>{
  const resolved=resolveMatch({}, {}, []),rules=[rule('homePoints',30),rule('awayPoints',10)];
  assert.deepEqual(scores(filterRuleOutcomes('points',resolved,rules)),['30-10','30-20']);
  for(const mode of ['points','battles','rounds']){
    assert.deepEqual(filterRuleOutcomes(mode,resolved,rules),filterRuleOutcomes(mode,resolved,[...rules].reverse()));
    assert.throws(()=>filterRuleOutcomes(mode,resolved,[...rules,rule('homePoints',40,'eq')]),/AND/);
  }
  assert.deepEqual(scores(filterRuleOutcomes('points',resolved,[rule('homePoints',20),rule('awayPoints',20)])),['30-20','20-30']);
});
test('v3 fixed score and differences migrate to v4 without changing actual results, and round trip',()=>{
  const data=fresh(),d=data.divisions[0],id=remaining(d)[0].id;data.schemaVersion=3;delete d.matchAssumptions;
  d.fixedScores[id]='30-20';d.fixedDetails={[id]:{battleDiff:1,roundDiff:0}};
  const baseline=structuredClone(d.baseline),results=structuredClone(d.results),migrated=migrateData(data),next=migrated.divisions[0];
  assert.equal(migrated.schemaVersion,4);assert.deepEqual(next.fixedScores,{});assert.equal(next.fixedDetails,undefined);
  assert.equal(rulesFor(next,id).length,4);assert.deepEqual(next.baseline,baseline);assert.deepEqual(next.results,results);
  assert.deepEqual(validate(migrated),[]);assert.deepEqual(migrateData(JSON.parse(JSON.stringify(migrated))),migrated);
});
test('invalid and impossible rules fail validation; merging is deduplicated and clearing removes all forms',()=>{
  const data=fresh(),d=data.divisions[0],id=remaining(d)[0].id,r=rule('homePoints',30);
  setMatchRules(d,id,[r]);mergeMatchRules(d,{[id]:[{...r,source:'necessary'},rule('awayPoints',10)]});
  assert.equal(rulesFor(d,id).length,2);assert.equal(rulesFor(d,id)[0].source,'manual');assert.deepEqual(validate(data),[]);
  for(const bad of [rule('homePoints',25),rule('unknown',0),{...r,source:'unknown'},{...r,value:NaN}]){const copy=structuredClone(data);copy.divisions[0].matchAssumptions[id]=[bad];assert(validate(copy).length);}
  mergeMatchRules(d,{[id]:[rule('homePoints',40,'eq')]});assert(validate(data).some(s=>s.includes('AND')));
  clearMatchRules(d);assert.deepEqual(validate(data),[]);assert.equal(rulesFor(d,id).length,0);
});
test('detailed bounds project original conditional weights into points and battles',()=>{
  const resolved=resolveMatch({}, {}, []),rules=[rule('roundDiff',0),rule('battleDiff',1)];
  const full=conditionedOutcomes('rounds',resolved.allowedScores).filter(([, , ,b,r])=>r>=0&&b>=1);
  for(const mode of ['points','battles']){
    const key=row=>JSON.stringify(mode==='points'?row.slice(0,2):[row[0],row[1],row[3]]),expected=new Map();
    for(const row of full)expected.set(key(row),(expected.get(key(row))??0n)+BigInt(row[2]));
    const actual=filterRuleOutcomes(mode,resolved,rules),totalFull=full.reduce((n,o)=>n+BigInt(o[2]),0n),total=actual.reduce((n,o)=>n+BigInt(o[2]),0n);
    assert.equal(actual.length,expected.size);
    for(const row of actual)assert.equal(BigInt(row[2])*totalFull,expected.get(key(row))*total);
  }
});
test('weighted point ranking agrees with independent detailed-state tally including tied ranks',()=>{
  const rules=[rule('roundDiff',0)],resolved=resolveMatch({}, {}, []),outcomes=filterRuleOutcomes('points',resolved,rules);
  const initial=[40,40,50,60,70,80],input={mode:'points',points:initial,teamIds:['a','b','c','d','e','f'],matches:[{home:0,away:1,outcomes}]};
  const actual=calculate(input),expected=Array.from({length:6},()=>Array(6).fill(0n));let denominator=0n;
  for(const [h,a,w,,r]of conditionedOutcomes('rounds',resolved.allowedScores)){
    if(r<0)continue;const p=[...initial];p[0]+=h;p[1]+=a;denominator+=BigInt(w)*60n;
    for(let i=0;i<6;i++){const higher=p.filter(n=>n>p[i]).length,tie=p.filter(n=>n===p[i]).length;for(let rank=higher;rank<higher+tie;rank++)expected[i][rank]+=BigInt(w)*60n/BigInt(tie);}
  }
  for(let i=0;i<6;i++)for(let j=0;j<6;j++)assert.equal(BigInt(actual.ranks[i][j])*denominator,expected[i][j]*BigInt(actual.denominator));
});
test('rule support is shared by cost, exact and search progress; fingerprints track edits',()=>{
  const d=small(),id=remaining(d)[0].id;setMatchRules(d,id,[rule('homePoints',20),rule('roundDiff',0)]);
  for(const mode of ['points','battles','rounds']){
    d.explorationMode=mode;const cost=exhaustiveCost(d,mode,1),prepared=prepare(d,BASE_CASE),progress=[];
    assert.equal(cost.total,String(prepared.matches[0].outcomes.length));calculate(prepared,p=>progress.push(p));assert(progress.every(p=>p.total===cost.total));
    const config={mode,goal:'all',targetTeamId:'ixa',caseId:'@input'},r=runConditionSearch(d,config);
    assert.equal(r.total,cost.total);const fp=searchFingerprint(d,config),copy=structuredClone(d);clearMatchRules(copy);assert.notEqual(searchFingerprint(copy,config),fp);
  }
});
test('necessary lower bounds transfer without selecting 30-20, and exact scores remain exact',()=>{
  const d=small(),prepared=prepare(d,BASE_CASE),m=prepared.matches[0],id=m.id;
  const result={initial:{teamIds:prepared.teamIds},matches:[{...m,outcomeSet:0}],outcomeSets:[m.outcomes],singleMatchConditions:{analysis:{necessary:[{matchId:id,teamId:prepared.teamIds[m.home],points:30}]}}};
  const additions=necessaryMatchRules(result);mergeMatchRules(d,additions);mergeMatchRules(d,additions);
  assert.equal(rulesFor(d,id).length,1);assert.equal(rulesFor(d,id)[0].source,'necessary');assert.deepEqual(scores(prepare(d,BASE_CASE).matches[0].outcomes),['40-0','30-10','30-20']);
  result.singleMatchConditions.analysis.necessary.push({matchId:id,teamId:prepared.teamIds[m.away],points:20});
  mergeMatchRules(d,necessaryMatchRules(result));assert.deepEqual(scores(prepare(d,BASE_CASE).matches[0].outcomes),['30-20']);
});
test('MC uses weighted projected support, resumes identically, and rejects edited rules',async()=>{
  const d=small(),id=remaining(d)[0].id;d.explorationMode='points';d.calculationMethod='monteCarlo';d.simulation.seed='and-projection';setMatchRules(d,id,[rule('roundDiff',0)]);
  const whole=await createMonteCarlo(d),split=await createMonteCarlo(d);whole.step(10000);split.step(100);
  const resumed=await createMonteCarlo(d,split.checkpoint());resumed.step(9900);assert.deepEqual(resumed.checkpoint(),whole.checkpoint());
  const exact=calculate(prepare(d,BASE_CASE)),mc=checkpointResults(whole.checkpoint())[0],a=boundsOf(exact),b=boundsOf(mc);
  for(let i=0;i<6;i++)for(let j=0;j<6;j++)assert(Math.abs(Number(a.lower[i][j])/Number(exact.denominator)-Number(b.lower[i][j])/Number(mc.denominator))<0.025);
  setMatchRules(d,id,[rule('roundDiff',1)]);await assert.rejects(()=>createMonteCarlo(d,whole.checkpoint()),/追加試行/);
});
