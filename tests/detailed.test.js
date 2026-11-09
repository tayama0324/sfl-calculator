import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { playerDistribution, matchDistribution, conditionedOutcomes } from '../site/js/distributions.js';
import { calculate } from '../site/js/engine.js';
import { SCORES, resolveMatch, prepare, migrateData, validate, verifyFractions, remaining, BASE_CASE, boundsOf, formatDifference } from '../site/js/model.js';
import { renderCases, renderComparison } from '../site/js/comparison-ui.js';
const raw=JSON.parse(await readFile(new URL('../site/data/default.json',import.meta.url)));
const data=()=>migrateData(raw);
const input=(mode,matches=[],points=[100,100,100,100,100,100])=>({mode,matches,points,battleDiffs:[0,0,0,0,0,0],roundDiffs:[0,0,0,0,0,0],teamIds:['a','b','c','d','e','f']});
const key=o=>`${o.homeWins},${o.battleDiff},${o.roundDiff}`;
const sum=a=>a.reduce((s,n)=>s+BigInt(n),0n);

test('player distributions equal independently enumerated sequential battle/round outcomes',()=>{
  for(const mode of ['battles','rounds'])for(const target of [2,3]){
    const actual=playerDistribution(target,mode), expected=new Map();
    const max=2*target-1, base=mode==='rounds'?4n:2n;
    const choices=mode==='rounds'?[[1,0,1],[1,0,2],[0,1,-1],[0,1,-2]]:[[1,0,0],[0,1,0]];
    function walk(h,a,r){
      if(h===target||a===target){const k=`${h>a},${h-a},${r}`;expected.set(k,(expected.get(k)??0n)+base**BigInt(max-h-a));return;}
      for(const [dh,da,dr]of choices)walk(h+dh,a+da,r+dr);
    }
    walk(0,0,0);
    assert.equal(actual.denominator,base**BigInt(max));
    assert.deepEqual(new Map(actual.outcomes.map(o=>[key(o),o.weight])),expected);
    assert.equal(sum(actual.outcomes.map(o=>o.weight)),actual.denominator);
  }
});
test('joint distributions project to original point weights; round projection equals battle distribution',()=>{
  const distributions=['battles','rounds'].map(matchDistribution);
  for(const d of distributions){
    assert.equal(sum(d.outcomes.map(o=>o.weight)),d.denominator);
    for(const [h,a,w]of SCORES)assert.equal(sum(d.outcomes.filter(o=>o.homePoints===h&&o.awayPoints===a).map(o=>o.weight))*8n,BigInt(w)*d.denominator);
    for(const o of d.outcomes){
      assert([40,50].includes(o.homePoints+o.awayPoints));
      const reverse=d.outcomes.find(x=>x.homePoints===o.awayPoints&&x.awayPoints===o.homePoints&&x.battleDiff===-o.battleDiff&&x.roundDiff===-o.roundDiff);
      assert.equal(reverse?.weight,o.weight);
    }
  }
  const [battle,round]=distributions;
  for(const b of battle.outcomes)assert.equal(sum(round.outcomes.filter(r=>r.homePoints===b.homePoints&&r.awayPoints===b.awayPoints&&r.battleDiff===b.battleDiff).map(o=>o.weight))*battle.denominator,b.weight*round.denominator);
});
test('40-0 retains battle and round uncertainty; all allowed-score subsets preserve point marginals',()=>{
  for(const mode of ['battles','rounds']){
    const sweep=conditionedOutcomes(mode,['40-0']);
    assert.deepEqual([...new Set(sweep.map(o=>o[3]))].sort((a,b)=>a-b),[3,4,5,6,7]);
    assert(sweep.length>1);
    if(mode==='rounds')assert(new Set(sweep.map(o=>o[4])).size>1);
    for(const scores of [['40-0','30-10','30-20'],['0-40','10-30','20-30'],['30-10']]){
      const rows=conditionedOutcomes(mode,scores),den=sum(rows.map(o=>o[2]));
      const original=SCORES.filter(([h,a])=>scores.includes(`${h}-${a}`));
      for(const [h,a,w]of original)assert.equal(sum(rows.filter(o=>o[0]===h&&o[1]===a).map(o=>o[2]))*BigInt(original.reduce((s,o)=>s+o[2],0)),BigInt(w)*den);
    }
  }
});
test('priority resolution is per match, against all earlier conditions, and fixed scores take precedence',()=>{
  const m={id:'m',homeTeamId:'a',awayTeamId:'b'};
  const winA={targetTeamId:'a',mode:'win'},winB={targetTeamId:'b',mode:'win'};
  let r=resolveMatch(m,{},[winA,winB]);
  assert.deepEqual(r.allowedScores,['40-0','30-10','30-20']);assert.equal(r.audit[1].status,'skipped');
  r=resolveMatch(m,{},[winB,winA]);assert.deepEqual(r.allowedScores,['20-30','10-30','0-40']);
  r=resolveMatch(m,{},[winA,{targetTeamId:'b',mode:'swept'},{targetTeamId:'a',mode:'lose'}]);
  assert.deepEqual(r.allowedScores,['40-0']);assert.equal(r.audit[2].status,'skipped');
  r=resolveMatch(m,{'m':'30-10'},[{targetTeamId:'a',mode:'sweep'},winA]);
  assert.deepEqual(r.allowedScores,['30-10']);assert.equal(r.audit[0].prioritized[0].type,'fixed');assert.equal(r.audit[1].status,'unchanged');
  assert.equal(resolveMatch({id:'x',homeTeamId:'b',awayTeamId:'c'},{},[winA,winB]).audit[0].status,'applied');
  assert.deepEqual(resolveMatch(m,{},[winA,winA]).allowedScores,resolveMatch(m,{},[winA]).allowedScores);
});
test('v1 migration preserves fixed scores and converts its single condition; invalid v2 rejected',()=>{
  const old=structuredClone(raw);
  if(old.schemaVersion===2){old.schemaVersion=1;for(const d of old.divisions){d.scenario={mode:'win',targetTeamId:d.teams[0].id,fixedScores:d.fixedScores};delete d.cases;delete d.fixedScores;delete d.explorationMode;}}
  old.divisions[0].scenario.mode='win';
  const upgraded=migrateData(old);
  assert.equal(upgraded.schemaVersion,4);assert.equal(upgraded.divisions[0].cases[0].conditions[0].mode,'win');assert.deepEqual(validate(upgraded),[]);
  assert.deepEqual(migrateData(upgraded),upgraded);
  for(const mutate of [d=>d.explorationMode='invalid',d=>d.cases[0].conditions.push({targetTeamId:'missing',mode:'win'}),d=>d.cases.push(structuredClone(d.cases[0])),d=>d.cases[0].conditions.push({targetTeamId:d.teams[0].id,mode:'normal'})]){const invalid=data();mutate(invalid.divisions[0]);assert(validate(invalid).length);}
});
test('required unknown current values block only relevant exploration modes',()=>{
  const d=data().divisions[0];d.baseline.standings[0].battleDiff=null;
  assert.doesNotThrow(()=>prepare(d));
  d.explorationMode='battles';assert.throws(()=>prepare(d),/バトル差/);
  d.baseline.standings[0].battleDiff=12;d.baseline.standings[0].roundDiff=null;
  assert.doesNotThrow(()=>prepare(d));d.explorationMode='rounds';assert.throws(()=>prepare(d),/ラウンド差/);
});
test('detailed modes honor lexicographic ranking; complete ties and PO boundary ties remain intervals',()=>{
  for(const mode of ['battles','rounds']){
    const all=calculate(input(mode));assert(verifyFractions(all).ok);
    assert(all.lowerRanks.every(row=>row.every(n=>n==='0')));
    assert(all.upperRanks.every(row=>row.every(n=>n==='1')));
    assert.deepEqual(all.poLower,Array(6).fill('0'));assert.deepEqual(all.poUpper,Array(6).fill('1'));
    const partial=input(mode,[],[100,80,80,80,20,0]),r=calculate(partial);
    assert.deepEqual(r.poLower,['1','0','0','0','0','0']);assert.deepEqual(r.poUpper,['1','1','1','1','0','0']);assert(verifyFractions(r).ok);
    const ranked=input(mode);ranked.battleDiffs=[6,4,2,0,-4,-8];
    const sorted=calculate(ranked);assert(verifyFractions(sorted).ok);
    for(let i=0;i<6;i++)assert.equal(sorted.lowerRanks[i][i],'1');
  }
  const round=input('rounds');round.roundDiffs=[6,4,2,0,-4,-8];
  const r=calculate(round);for(let i=0;i<6;i++)assert.equal(r.lowerRanks[i][i],'1');
  round.mode='battles';assert.equal(calculate(round).unresolved[0],'1');
});

// Deliberately uncompressed independent terminal grouping oracle.
function oracle(source){
  const p=[...source.points],b=[...source.battleDiffs],r=[...source.roundDiffs];
  const lo=Array.from({length:6},()=>Array(6).fill(0n)),hi=structuredClone(lo),pl=Array(6).fill(0n),pu=[...pl],u=[...pl],bt=[...pl];
  function visit(depth,w){
    if(depth<source.matches.length){const m=source.matches[depth];for(const [h,a,weight,db,dr]of m.outcomes){p[m.home]+=h;p[m.away]+=a;b[m.home]+=db;b[m.away]-=db;r[m.home]+=dr;r[m.away]-=dr;visit(depth+1,w*BigInt(weight));p[m.home]-=h;p[m.away]-=a;b[m.home]-=db;b[m.away]+=db;r[m.home]-=dr;r[m.away]+=dr;}return;}
    const compare=(i,j)=>p[j]-p[i]||b[j]-b[i]||(source.mode==='rounds'?r[j]-r[i]:0);
    const order=[0,1,2,3,4,5].sort(compare);
    for(let first=0;first<6;){let end=first+1;while(end<6&&compare(order[first],order[end])===0)end++;
      for(let at=first;at<end;at++){const i=order[at];for(let place=first;place<end;place++){hi[i][place]+=w;if(end===first+1)lo[i][place]+=w;}if(end<=3)pl[i]+=w;if(first<3)pu[i]+=w;if(end-first>1)u[i]+=w;if(first<3&&end>3)bt[i]+=w;}first=end;}
  }
  visit(0,1n);const strings=x=>x.map(String),matrix=x=>x.map(strings);
  return {lowerRanks:matrix(lo),upperRanks:matrix(hi),poLower:strings(pl),poUpper:strings(pu),unresolved:strings(u),borderTies:strings(bt)};
}
test('joint enumeration and proven subtree compression equal independent terminal oracle',()=>{
  for(const mode of ['battles','rounds']){
    const outcomes=conditionedOutcomes(mode,SCORES.map(([h,a])=>`${h}-${a}`));
    const source=input(mode,[{home:0,away:1,outcomes},{home:2,away:3,outcomes}]);
    source.battleDiffs=[2,2,-1,0,-1,-2];source.roundDiffs=[5,4,-3,1,0,-7];
    const actual=calculate(source),expected=oracle(source);
    for(const key of Object.keys(expected))assert.deepEqual(actual[key],expected[key],`${mode}: ${key}`);
    assert(verifyFractions(actual).ok);assert.equal(actual.processed,String(outcomes.length**2));
    source.points=[400,300,200,100,50,0];const compressed=calculate(source);
    assert.equal(compressed.visited,'1');assert.equal(compressed.collapsed,'1');assert(verifyFractions(compressed).ok);
  }
});
test('comparison deltas use exact fractions, with conservative interval subtraction',()=>{
  const r=calculate(input('rounds'));
  assert.equal(formatDifference(r,r,0),'−100ポイント ～ +100ポイント');
  assert.equal(formatDifference(calculate(input('points')),calculate(input('points')),0),'0ポイント');
  assert.deepEqual(boundsOf(calculate(input('points'))).poLower,Array(6).fill('30'));
});
test('subtree ordering bounds preserve exact values across varied multi-match states',()=>{
  let seed=731;
  const rand=n=>{seed=(seed*1664525+1013904223)>>>0;return seed%n;};
  for(const mode of ['battles','rounds'])for(let trial=0;trial<24;trial++){
    const all=conditionedOutcomes(mode,SCORES.map(([h,a])=>`${h}-${a}`));
    const games=Array.from({length:3},(_,i)=>({home:i,away:(i+2)%6,outcomes:Array.from({length:5},()=>all[rand(all.length)])}));
    const source=input(mode,games,Array.from({length:6},()=>rand(12)*10));
    source.battleDiffs=Array.from({length:6},()=>rand(20)-10);source.roundDiffs=Array.from({length:6},()=>rand(30)-15);
    const actual=calculate(source),expected=oracle(source);
    for(const key of Object.keys(expected))assert.deepEqual(actual[key],expected[key],`${mode}/${trial}/${key}`);
    assert(verifyFractions(actual).ok);
  }
});
test('case UI escapes user text and exposes effective conditions and skipped fixed-score conflicts',()=>{
  const d=data().divisions[0];d.cases[0].name='<img src=x onerror=alert(1)>';
  assert(renderCases(d).includes('&lt;img'));assert(!renderCases(d).includes('<img'));
  const mode='rounds',fake=calculate(input(mode));
  const saved={input:{...d,explorationMode:mode},fingerprint:'old',startedAt:'test',entries:[{id:'baseline',name:'基準',definition:BASE_CASE,status:'done',result:{...fake,teamIds:d.teams.map(t=>t.id)},resolution:[],seconds:0}]};
  const html=renderComparison(saved,d);assert(html.includes('変更前'));assert(html.includes('全項目一致（追加戦次第）'));assert(html.includes('PO境界の同点'));assert(html.includes('有効なポイントスコア'));
});
test('comparison display maps result rows by team ID when standings order differs from team order',()=>{
  const d=data().divisions[0],r=calculate({...input('points',[],[60,50,40,30,20,10]),teamIds:d.teams.map(t=>t.id).reverse()});
  const saved={input:d,fingerprint:JSON.stringify(d),startedAt:'test',entries:[{id:'baseline',name:'基準',definition:BASE_CASE,status:'done',result:r,resolution:[],seconds:0}]};
  const first=renderComparison(saved,d).split('<tbody>')[1].split('</tr>')[0];
  assert(first.includes(d.teams[0].shortName));assert(first.includes('>0%</td>'));
});
test('real worker protocol runs all three modes, applies priorities, and reuses equivalent case results',async()=>{
  for(const mode of ['points','battles','rounds']){
    const d=data().divisions[0];d.explorationMode=mode;
    const pending=remaining(d),last=pending.at(-1);
    for(const m of pending.slice(0,-1))d.results[m.id]={homePoints:40,awayPoints:0,homeBattleDiffDelta:7,homeRoundDiffDelta:14};
    d.fixedScores[last.id]='30-10';
    d.cases=[{id:'first',name:'優先順位',conditions:[{targetTeamId:last.homeTeamId,mode:'sweep'},{targetTeamId:last.awayTeamId,mode:'win'}]},{id:'second',name:'同じ有効条件',conditions:[]}];
    const worker=new Worker(new URL('./helpers/worker-harness.js',import.meta.url));
    try{
      const messages=await new Promise((resolve,reject)=>{const items=[];const deadline=setTimeout(()=>reject(new Error('worker timeout')),10000);worker.on('error',error=>{clearTimeout(deadline);reject(error);});worker.on('message',m=>{items.push(m);if(m.type==='error'){clearTimeout(deadline);reject(new Error(m.message));}if(m.type==='comparison-done'){clearTimeout(deadline);resolve(items);}});worker.postMessage({type:'comparison',division:d});});
      const completed=messages.filter(m=>m.type==='case-done');assert.equal(completed.length,3);
      assert(completed.every(m=>verifyFractions(m.result).ok));assert(completed[1].reused);assert(completed[2].reused);
      assert.equal(completed[1].resolution[0].audit[0].status,'skipped');
      assert.equal(completed[1].resolution[0].audit[1].status,'skipped');
    }finally{await worker.terminate();}
  }
});
