import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {analyzeMatchConditions} from '../docs/js/match-conditions.js';
import {searchPrepared,runConditionSearch,reconstructExample,verifySearchResult} from '../docs/js/condition-search.js';
import {SCORES,migrateData,remaining} from '../docs/js/model.js';
import {conditionedOutcomes} from '../docs/js/distributions.js';
import {renderSearchResult} from '../docs/js/condition-search-ui.js';
const scores=SCORES.map(([h,a])=>`${h}-${a}`);
const source=(mode,games,points=[0,10,40,60,80,100])=>({mode,teamIds:['a','b','c','d','e','f'],points,battleDiffs:[0,0,0,0,0,0],roundDiffs:[0,0,0,0,0,0],matches:games});
const flags=cells=>cells.map(c=>({points:c.points,success:c.success!==null,failure:c.failure!==null,unresolved:c.unresolved!==null}));
const cmp=(a,b)=>a.reduce((n,p,i)=>n||p-b[i],0);
function grid(n){if(!n)return [[]];return grid(n-1).flatMap(v=>[0,10,20,30,40].map(p=>[...v,p]));}
// Enumerate all threshold vectors independently of the frontier algorithm.
function brute(cells,n){
  const satisfies=(p,q)=>p.every((v,i)=>v>=q[i]);
  const safe=grid(n).filter(q=>{const selected=cells.filter(c=>satisfies(c.points,q));return selected.length&&selected.every(c=>c.failure===null&&c.unresolved===null);});
  return safe.filter(q=>!safe.some(p=>p!==q&&p.every((v,i)=>v<=q[i]))).sort(cmp);
}
function matchOracle(input,target,cutoff){
  const p=[...input.points],b=[...input.battleDiffs],r=[...input.roundDiffs],vector=[],cells=new Map();
  function visit(depth){
    if(depth===input.matches.length){
      let above=0,equal=1;
      for(let i=0;i<6;i++)if(i!==target){const d=p[i]-p[target]||(input.mode!=='points'?b[i]-b[target]:0)||(input.mode==='rounds'?r[i]-r[target]:0);if(d>0)above++;else if(!d)equal++;}
      const state=above>=cutoff?'failure':above+equal<=cutoff?'success':'unresolved',key=vector.join(',');
      if(!cells.has(key))cells.set(key,{points:[...vector],success:false,failure:false,unresolved:false});cells.get(key)[state]=true;return;
    }
    const m=input.matches[depth],own=m.home===target||m.away===target;
    for(const [h,a,,db=0,dr=0]of m.outcomes){
      p[m.home]+=h;p[m.away]+=a;b[m.home]+=db;b[m.away]-=db;r[m.home]+=dr;r[m.away]-=dr;if(own)vector.push(m.home===target?h:a);
      visit(depth+1);if(own)vector.pop();p[m.home]-=h;p[m.away]-=a;b[m.home]-=db;b[m.away]+=db;r[m.home]-=dr;r[m.away]+=dr;
    }
  }
  visit(0);return [...cells.values()].sort((a,b)=>cmp(a.points,b.points));
}
test('minimal match conjunctions equal all-threshold enumeration, including sparse and non-monotonic supports',()=>{
  for(const n of [0,1,2,3,4])for(let seed=0;seed<5;seed++){
    const cells=grid(n).filter((p,i)=>seed===0||i%5!==seed).map((p,i)=>{
      const good=p.some(v=>v>=30)||(n===0&&seed%2===0),bad=p.every(v=>v<30)||(seed===3&&p.every(v=>v===40));
      return {points:p,success:good?i:null,failure:bad?i:null,unresolved:!good&&!bad?i:null};
    });
    if(!cells.length)continue;
    const a=analyzeMatchConditions(cells,n);assert.deepEqual(a.sufficient.map(c=>c.thresholds),brute(cells,n));
    for(const c of a.sufficient){assert(cells.some(x=>x.success===c.witness&&x.points.every((p,i)=>p>=c.thresholds[i])));for(const counter of c.counterexamples){const q=[...c.thresholds];q[counter.matchIndex]-=10;assert(cells.some(x=>(x.failure===counter.witness||x.unresolved===counter.witness)&&x.points.every((p,i)=>p>=q[i])));}}
  }
  const sparse=[{points:[0],success:null,failure:0,unresolved:null},{points:[40],success:1,failure:null,unresolved:null}];
  const a=analyzeMatchConditions(sparse,1);assert.deepEqual(a.necessary,[40]);assert.deepEqual(a.sufficient[0].thresholds,[10]);
});
test('match support matches independent full enumeration in every ranking mode and goal, home and away',()=>{
  for(const mode of ['points','battles','rounds'])for(let seed=0;seed<10;seed++){
    const rows=mode==='points'?SCORES:conditionedOutcomes(mode,scores),subset=[rows[seed%rows.length],rows[(seed*3+2)%rows.length],rows[(seed*11+5)%rows.length]];
    const games=[[0,1],[2,3],[4,0]].map(([home,away],i)=>({id:`g${i}`,home,away,outcomes:subset}));
    const input=source(mode,games,[seed*10,40,60,80,20,0]);
    for(const optimize of [false,true]){
      const result=searchPrepared(input,{targetTeamId:'a',goal:'all',optimize});assert(verifySearchResult(result));
      for(const [goal,cutoff]of [['first',1],['second',2],['po',3]]){
        const mc=result.results[goal].matchConditions;
        assert.deepEqual(mc.matchIds,['g0','g2']);assert.deepEqual(flags(mc.cells),matchOracle(input,0,cutoff));
        assert.deepEqual(mc.analysis.sufficient.map(c=>c.thresholds),brute(mc.cells,2));
        const possible=mc.cells.filter(c=>c.success!==null||c.unresolved!==null);
        assert.deepEqual(mc.analysis.necessary,possible.length?[0,1].map(i=>Math.min(...possible.map(c=>c.points[i]))):null);
      }
    }
  }
});
test('compressed certain subtrees retain distinct match allocations with the same total points',()=>{
  const input=source('points',[{id:'home',home:0,away:1,outcomes:SCORES},{id:'away',home:2,away:0,outcomes:SCORES}],[1000,0,0,0,0,0]);
  const r=searchPrepared(input,{targetTeamId:'a',goal:'first'});
  assert(BigInt(r.collapsed)>0n);assert.equal(r.matchConditions.cells.length,25);
  assert(r.matchConditions.cells.some(c=>c.points.join(',')==='0,40'));assert(r.matchConditions.cells.some(c=>c.points.join(',')==='40,0'));
  assert.deepEqual(r.matchConditions.analysis.sufficient[0].thresholds,[0,0]);assert(verifySearchResult(r));
});
test('no remaining matches, impossible goals, unresolved ties and unobservable score guarantees stay distinct',()=>{
  for(const [points,status]of [[[100,0,0,0,0,0],'certain'],[[0,100,100,100,100,100],'impossible'],[[100,100,0,0,0,0],'possible-not-guaranteed']]){
    const r=searchPrepared(source('rounds',[],points),{targetTeamId:'a',goal:'first'});assert.equal(r.matchConditions.analysis.status,status);assert(verifySearchResult(r));
    assert.equal(r.matchConditions.analysis.sufficient.length,status==='certain'?1:0);
  }
  const cells=[{points:[30],success:0,failure:null,unresolved:null},{points:[40],success:null,failure:null,unresolved:1}];
  assert.deepEqual(analyzeMatchConditions(cells,1).sufficient,[]);
});
test('exported match witnesses replay, corrupt vectors are rejected, and legacy results remain verifiable',async()=>{
  const data=migrateData(JSON.parse(await readFile(new URL('../docs/data/default.json',import.meta.url))));const d=data.divisions[0];
  for(const m of remaining(d).slice(0,-2))d.results[m.id]={homePoints:40,awayPoints:0,homeBattleDiffDelta:7,homeRoundDiffDelta:14};
  const own=remaining(d)[0];d.fixedScores[own.id]='30-20';d.fixedDetails={[own.id]:{battleDiff:null,roundDiff:0}};d.cases=[];
  const c={targetTeamId:own.awayTeamId,goal:'all',mode:'battles',caseId:'@input'};
  const r=runConditionSearch(d,c);assert(verifySearchResult(JSON.parse(JSON.stringify(r))));
  for(const x of Object.values(r.results))for(const candidate of x.matchConditions.analysis.sufficient){const e=reconstructExample(x,candidate.witness);assert.equal(e.classification.status,'success');}
  const corrupt=structuredClone(r);corrupt.results.po.matchConditions.cells[0].points[0]=10;assert(!verifySearchResult(corrupt));
  const legacy=structuredClone(r.results.po);legacy.version=1;delete legacy.matchConditions;assert(verifySearchResult(legacy));
  const saved={status:'done',input:d,config:c,result:r,seconds:0,fingerprint:r.fingerprint,exampleIndices:{}};
  const html=renderSearchResult(saved,d,c);assert(html.includes('マッチ'));assert(!renderSearchResult({...saved,status:'cancelled'},d,c).includes('match-condition-row'));
});
