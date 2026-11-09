import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Worker} from 'node:worker_threads';
import {SCORES,migrateData,remaining,prepare} from '../site/js/model.js';
import {conditionedOutcomes,matchDistribution,playerExample} from '../site/js/distributions.js';
import {searchPrepared,runConditionSearch,prepareSearch,analyzeConditions,reconstructExample,verifySearchResult,searchFingerprint} from '../site/js/condition-search.js';
import {defaultSearchConfig} from '../site/js/search-config.js';
import {classifyTarget} from '../site/js/ranking.js';
import {exhaustiveCost,costLevel,renderCost} from '../site/js/exhaustive-cost.js';
import {renderSearchControls,renderSearchResult} from '../site/js/condition-search-ui.js';
const raw=JSON.parse(await readFile(new URL('../site/data/default.json',import.meta.url)));
const data=()=>migrateData(raw);
const scores=SCORES.map(([h,a])=>`${h}-${a}`);
const input=(mode='points',games=[],points=[0,0,35,25,15,5])=>({mode,teamIds:['a','b','c','d','e','f'],points,battleDiffs:[0,0,0,0,0,0],roundDiffs:[0,0,0,0,0,0],matches:games});
const outcomes=mode=>mode==='points'?SCORES:conditionedOutcomes(mode,scores);
const game=(home,away,rows=SCORES)=>({id:`${home}-${away}`,home,away,outcomes:rows});
function flags(r){return r.cells.map(c=>({points:c.points,wins:c.wins,success:c.success!==null,failure:c.failure!==null,unresolved:c.unresolved!==null}));}
function metricNumbers(r){return Object.fromEntries(['points','wins'].map(f=>[f,{necessary:r.analysis[f].necessary,sufficient:r.analysis[f].sufficient}]));}
function oracle(source,target,cutoff){
  const p=[...source.points],b=[...source.battleDiffs],r=[...source.roundDiffs],cells=new Map();
  function visit(depth,points,wins){
    if(depth<source.matches.length){const m=source.matches[depth];for(const [h,a,,db=0,dr=0]of m.outcomes){
      p[m.home]+=h;p[m.away]+=a;b[m.home]+=db;b[m.away]-=db;r[m.home]+=dr;r[m.away]-=dr;
      visit(depth+1,points+(m.home===target?h:m.away===target?a:0),wins+(m.home===target?(h>a?1:0):m.away===target?(a>h?1:0):0));
      p[m.home]-=h;p[m.away]-=a;b[m.home]-=db;b[m.away]+=db;r[m.home]-=dr;r[m.away]+=dr;
    }return;}
    let higher=0,equal=1;
    for(let j=0;j<6;j++)if(j!==target){const diff=p[j]-p[target]||(source.mode==='points'?0:b[j]-b[target])||(source.mode==='rounds'?r[j]-r[target]:0);if(diff>0)higher++;else if(diff===0)equal++;}
    const status=higher>=cutoff?'failure':higher+equal<=cutoff?'success':'unresolved';
    const key=`${points}/${wins}`;if(!cells.has(key))cells.set(key,{points,wins,success:false,failure:false,unresolved:false});cells.get(key)[status]=true;
  }
  visit(0,0,0);return [...cells.values()].sort((a,b)=>a.points-b.points||a.wins-b.wins);
}
test('point and win thresholds examine all outcomes above the threshold, not just exact scores',()=>{
  const source=input('points',[game(0,1)]);
  const po=searchPrepared(source,{targetTeamId:'a',goal:'po'});
  assert.deepEqual(metricNumbers(po),{points:{necessary:30,sufficient:30},wins:{necessary:1,sufficient:1}});assert(verifySearchResult(po));
  const first=searchPrepared(source,{targetTeamId:'a',goal:'first'});
  assert.deepEqual(metricNumbers(first),{points:{necessary:40,sufficient:40},wins:{necessary:1,sufficient:null}});assert(verifySearchResult(first));
});
test('boundary complete ties enter both possible-achievement and non-guaranteed sets',()=>{
  const source=input('rounds',[],[100,80,80,80,20,0]);
  const result=searchPrepared(source,{targetTeamId:'b',goal:'po'});
  assert.equal(result.analysis.status,'possible-not-guaranteed');assert.equal(result.analysis.points.necessary,0);assert.equal(result.analysis.points.sufficient,null);
  assert.equal(result.cells[0].success,null);assert.equal(result.cells[0].failure,null);assert.notEqual(result.cells[0].unresolved,null);
  const e=reconstructExample(result,result.cells[0].unresolved);assert.equal(e.classification.reason,'additional-tiebreak');assert.equal(e.classification.first,2);assert.equal(e.classification.last,4);
});
test('a complete tie entirely within PO spots guarantees PO but does not guarantee first',()=>{
  const source=input('rounds',[],[80,80,80,20,10,0]);
  const po=searchPrepared(source,{targetTeamId:'a',goal:'po'}),first=searchPrepared(source,{targetTeamId:'a',goal:'first'});
  assert.equal(po.analysis.status,'certain');assert.equal(po.analysis.points.sufficient,0);assert.equal(po.analysis.wins.sufficient,0);
  assert.equal(first.analysis.status,'possible-not-guaranteed');
  const fail=searchPrepared(source,{targetTeamId:'f',goal:'po'});assert.equal(fail.analysis.status,'impossible');assert.equal(fail.analysis.points.necessary,null);assert.equal(fail.analysis.points.sufficient,null);
});
test('necessary minimum includes possible ties; impossible sufficient thresholds never displayed',()=>{
  const r=analyzeConditions([{points:50,wins:1,success:null,failure:null,unresolved:0},{points:70,wins:2,success:null,failure:1,unresolved:null},{points:80,wins:1,success:2,failure:null,unresolved:null}]);
  assert.equal(r.points.necessary,50);assert.equal(r.points.sufficient,80);assert.equal(r.wins.sufficient,null);
  const same=analyzeConditions([{points:50,wins:1,success:0,failure:null,unresolved:null},{points:80,wins:1,success:null,failure:1,unresolved:null},{points:80,wins:2,success:2,failure:null,unresolved:null}]);
  assert.equal(same.points.sufficient,null);assert.equal(same.wins.sufficient,2);
});
test('subtree compression preserves all reachable target point/win pairs',()=>{
  for(const mode of ['points','battles','rounds']){
    const rows=outcomes(mode),source=input(mode,[game(0,1,rows),game(0,2,rows)],[400,0,0,0,0,0]);
    const fast=searchPrepared(source,{targetTeamId:'a',goal:'po'}),slow=oracle(source,0,3);
    assert.equal(fast.visited,'1');assert.equal(fast.collapsed,'1');assert.deepEqual(flags(fast),slow);assert(verifySearchResult(fast));
    assert(fast.cells.some(c=>c.points===30&&c.wins===0));assert(fast.cells.some(c=>c.points===30&&c.wins===1));
  }
});
test('full two-match distributions equal independent terminal enumeration including unknown ties',()=>{
  for(const mode of ['points','battles','rounds']){
    const rows=outcomes(mode),source=input(mode,[game(0,1,rows),game(2,3,rows)],[30,30,20,20,10,0]);source.battleDiffs=[0,0,2,-2,0,0];
    for(const goal of ['po','first']){const r=searchPrepared(source,{targetTeamId:'a',goal});assert.deepEqual(flags(r),oracle(source,0,goal==='po'?3:1));assert(verifySearchResult(r));}
  }
});
test('varied multi-match states give identical support with optimization enabled or disabled',()=>{
  let seed=12345;const random=n=>{seed=(seed*1664525+1013904223)>>>0;return seed%n;};
  for(const mode of ['points','battles','rounds'])for(let trial=0;trial<20;trial++){
    const rows=outcomes(mode),source=input(mode,[0,1,2].map(i=>game(i,(i+2)%6,Array.from({length:4},()=>rows[random(rows.length)]))),Array.from({length:6},()=>random(10)*10));
    source.battleDiffs=Array.from({length:6},()=>random(15)-7);source.roundDiffs=Array.from({length:6},()=>random(21)-10);
    const targetTeamId=source.teamIds[random(6)],goal=trial%2?'po':'first';
    const a=searchPrepared(source,{targetTeamId,goal}),b=searchPrepared(source,{targetTeamId,goal,optimize:false});
    assert.deepEqual(flags(a),flags(b));assert.deepEqual(metricNumbers(a),metricNumbers(b));assert(verifySearchResult(a));
  }
});
test('rare positive-weight counterexamples are not pruned as probability zero',()=>{
  const source=input('points',[game(0,1,[[40,0,'1000000000000000000000000000000000000000'],[0,40,'1']])]);
  const r=searchPrepared(source,{targetTeamId:'a',goal:'po'});assert.equal(r.analysis.points.sufficient,10);assert.equal(r.analysis.points.necessary,40);assert.equal(r.cells[0].failure!==null,true);
  // 10 is a valid weakest grid threshold: the only score >=10 is the achievable 40.
});
test('normal search ignores all hypothetical fixed scores and scenarios; selected case uses priority rules',()=>{
  const d=data().divisions[0],c=defaultSearchConfig(d),m=remaining(d).find(m=>[m.homeTeamId,m.awayTeamId].includes(c.targetTeamId));
  d.fixedScores[m.id]=m.homeTeamId===c.targetTeamId?'0-40':'40-0';
  d.cases[0].conditions=[{targetTeamId:c.targetTeamId,mode:'sweep'}];
  const normal=prepareSearch(d,c),conditional=prepareSearch(d,{...c,caseId:d.cases[0].id});
  assert.equal(normal.prepared.matches.find(x=>x.id===m.id).outcomes.length,426);
  assert.equal(conditional.prepared.resolution.find(x=>x.matchId===m.id).audit[0].status,'skipped');
  const old=searchFingerprint(d,c);d.fixedScores={};d.cases[0].name='changed';assert.equal(searchFingerprint(d,c),old);
  const caseConfig={...c,caseId:d.cases[0].id},before=searchFingerprint(d,caseConfig);d.cases[0].name+='x';assert.notEqual(searchFingerprint(d,caseConfig),before);
});
test('missing cumulative differences block the relevant search; normal defaults use rounds and no assumptions',()=>{
  const x=data(),d=x.divisions[0],c=x.conditionSearch.S;assert.equal(c.mode,'rounds');assert.equal(c.caseId,'@normal');
  d.baseline.standings[0].roundDiff=null;assert.throws(()=>prepareSearch(d,c),/ラウンド差/);assert.doesNotThrow(()=>prepareSearch(d,{...c,mode:'battles'}));
  assert.throws(()=>prepareSearch(d,{...c,targetTeamId:'absent'}),/不正/);
});
test('player examples reproduce the exact team score, battle difference and round difference',()=>{
  for(const mode of ['battles','rounds'])for(const o of matchDistribution(mode).outcomes){
    const players=o.example.map(playerExample);let hp=0,ap=0,b=0,r=0;
    players.forEach((p,i)=>{
      assert([p.homeBattles,p.awayBattles].includes(p.target));assert(Math.min(p.homeBattles,p.awayBattles)<p.target);
      const points=i===2?20:10;if(p.homeBattles>p.awayBattles)hp+=points;else ap+=points;b+=p.homeBattles-p.awayBattles;
      if(mode==='rounds'){
        let hw=0,aw=0;for(const [h,a]of p.roundScores){assert((h===2&&a<2)||(a===2&&h<2));assert(hw<p.target&&aw<p.target);if(h>a)hw++;else aw++;r+=h-a;}
        assert.equal(hw,p.homeBattles);assert.equal(aw,p.awayBattles);
      }
    });
    assert.equal(hp,o.homePoints);assert.equal(ap,o.awayPoints);assert.equal(b,o.battleDiff);if(mode==='rounds')assert.equal(r,o.roundDiff);
    if(players.length===4){const first=players.slice(0,3).reduce((s,p,i)=>s+(p.homeBattles>p.awayBattles?(i===2?20:10):0),0);assert.equal(first,20);}
  }
});
test('round search examples are self-contained after JSON roundtrip and reconstruct all recorded classifications',()=>{
  const x=data(),d=x.divisions[0];for(const m of remaining(d).slice(0,-2))d.results[m.id]={homePoints:40,awayPoints:0,homeBattleDiffDelta:7,homeRoundDiffDelta:14};
  const config={...x.conditionSearch.S,targetTeamId:remaining(d)[0].homeTeamId},r=runConditionSearch(d,config),copy=JSON.parse(JSON.stringify(r));
  assert(verifySearchResult(copy));assert.deepEqual(copy.analysis,r.analysis);
  for(const cell of copy.cells)for(const status of ['success','failure','unresolved'])if(cell[status]!==null){const e=reconstructExample(copy,cell[status]);assert.equal(e.classification.status,status);assert.equal(e.points,cell.points);}
  copy.analysis.points.necessary=999;assert.equal(verifySearchResult(copy),false);
});
test('target vs other teams cutoff vector agrees with rank-group classification',()=>{
  for(const cutoff of [1,3]){
    const values={points:[80,100,80,80,20,0],battles:[0,0,0,0,0,0],rounds:[0,0,0,0,0,0]};
    for(let target=0;target<6;target++){
      const others=values.points.filter((_,i)=>i!==target).sort((a,b)=>b-a),boundary=others[cutoff-1];
      const cls=classifyTarget(values,'rounds',target,cutoff);
      assert.equal(cls.status!=='failure',values.points[target]>=boundary);assert.equal(cls.status==='success',values.points[target]>boundary);
    }
  }
});
test('cost reflects assumptions with BigInt across modes and warning boundaries',()=>{
  const x=data(),s=x.divisions[0],f=x.divisions[1];
  assert.equal(exhaustiveCost(s,'points',1).perCase,'10077696');assert.equal(exhaustiveCost(f,'points',1).perCase,'2176782336');
  assert.equal(exhaustiveCost(s,'battles',1).perCase,'101559956668416');assert.equal(exhaustiveCost(s,'rounds',1).perCase,'462047252296310925912576');
  const old=exhaustiveCost(s,'rounds',2);for(const m of remaining(s))s.fixedScores[m.id]='40-0';s.cases[0].conditions=[{targetTeamId:s.teams[0].id,mode:'win'}];assert(BigInt(exhaustiveCost(s,'rounds',2).total)<BigInt(old.total));assert.equal(exhaustiveCost(s,'points',2).total,'2');
  const m=remaining(s)[0];s.results[m.id]={homePoints:40,awayPoints:0,homeBattleDiffDelta:7,homeRoundDiffDelta:14};assert.equal(exhaustiveCost(s,'points',1).matches,8);
  assert.equal(costLevel(99999999n),'normal');assert.equal(costLevel(100000000n),'notice');assert.equal(costLevel(999999999999n),'notice');assert.equal(costLevel(1000000000000n),'warning');
  assert(!renderCost(s,{mode:'rounds',cases:1,conditionSearch:true}).includes('cost-to-mc'));assert(renderCost(f,{mode:'rounds',cases:1}).includes('cost-to-mc'));
});
test('condition UI does not show thresholds for incomplete searches and distinguishes complete ties',()=>{
  const x=data(),d=x.divisions[0],c=x.conditionSearch.S;assert(!renderSearchControls(d,c,null,'').includes('calculation-method'));assert(renderSearchControls(d,c,null,'').includes('1回の探索'));
  const saved={status:'cancelled',input:d,config:c,fingerprint:searchFingerprint(d,c)};
  assert(renderSearchResult(saved,d,c).includes('未完了'));assert(!renderSearchResult(saved,d,c).includes('<th>十分条件</th>'));
  for(const m of remaining(d))d.results[m.id]={homePoints:40,awayPoints:0,homeBattleDiffDelta:7,homeRoundDiffDelta:14};
  d.teams[0].name='<img src=x onerror=1>';const r=runConditionSearch(d,c);
  const html=renderSearchResult({status:'done',input:d,config:c,result:r,seconds:0,fingerprint:r.fingerprint,exampleIndex:0},d,c);
  assert(html.includes('追加タイブレーク戦次第'));assert(html.includes('&lt;img'));assert(!html.includes('<img'));assert(html.includes('必要条件'));
});
test('real worker returns only complete condition results with verified witnesses',async()=>{
  const x=data(),d=x.divisions[0];for(const m of remaining(d).slice(0,-1))d.results[m.id]={homePoints:40,awayPoints:0,homeBattleDiffDelta:7,homeRoundDiffDelta:14};
  const worker=new Worker(new URL('./helpers/worker-harness.js',import.meta.url));
  try{
    const messages=await new Promise((resolve,reject)=>{const all=[],timeout=setTimeout(()=>reject(new Error('worker timeout')),10000);worker.on('error',error=>{clearTimeout(timeout);reject(error);});worker.on('message',m=>{all.push(m);if(m.type==='error'){clearTimeout(timeout);reject(new Error(m.message));}if(m.type==='search-done'){clearTimeout(timeout);resolve(all);}});worker.postMessage({type:'condition-search',division:d,config:x.conditionSearch.S});});
    assert(messages.some(m=>m.type==='search-progress'));const r=messages.at(-1).result;assert(r.complete);assert(verifySearchResult(r));assert.equal(r.processed,r.total);
  }finally{await worker.terminate();}
});

test('combined first and PO search matches independent enumeration with and without pruning',()=>{
  for(const mode of ['points','battles','rounds'])for(let seed=0;seed<12;seed++){
    const rows=outcomes(mode),subset=[rows[seed%rows.length],rows[(seed*7+3)%rows.length],rows[(seed*11+5)%rows.length]];
    const source=input(mode,[game(0,1,subset),game(2,3,subset),game(0,4,subset)],[seed*10,40,60,80,20,0]);
    for(const optimize of [true,false]){
      const both=searchPrepared(source,{targetTeamId:'a',goal:'both',optimize});
      assert(verifySearchResult(both));
      for(const [goal,cutoff]of [['first',1],['po',3]]){
        assert.deepEqual(flags(both.results[goal]),oracle(source,0,cutoff));
        assert.deepEqual(metricNumbers(both.results[goal]),metricNumbers(searchPrepared(source,{targetTeamId:'a',goal,optimize})));
      }
      assert.equal(both.processed,both.total);
    }
  }
});
test('combined boundary ties distinguish guaranteed PO from undecided first and verify exported examples',()=>{
  const source=input('rounds',[],[80,80,80,20,10,0]);
  const both=searchPrepared(source,{targetTeamId:'a',goal:'both'});
  assert.equal(both.results.po.analysis.status,'certain');
  assert.equal(both.results.first.analysis.status,'possible-not-guaranteed');
  assert(verifySearchResult(JSON.parse(JSON.stringify(both))));
  both.results.first.cells[0].success=0;
  assert(!verifySearchResult(both));
});
test('input-based combined search applies fixed differences and ignores stored comparison cases',()=>{
  const x=data(),d=x.divisions[0];
  for(const m of remaining(d))d.results[m.id]={homePoints:40,awayPoints:0,homeBattleDiffDelta:7,homeRoundDiffDelta:14};
  const m=d.fixtures.at(-1);delete d.results[m.id];d.fixedScores={[m.id]:'30-20'};d.fixedDetails={[m.id]:{battleDiff:1,roundDiff:0}};
  d.cases=[{id:'hidden',name:'Hidden',conditions:[{targetTeamId:m.homeTeamId,mode:'swept'}]}];
  const c={targetTeamId:m.homeTeamId,mode:'rounds',goal:'both',caseId:'@input'};
  const both=runConditionSearch(d,c);
  assert(verifySearchResult(both));
  for(const goal of ['first','po']){
    const r=both.results[goal],e=reconstructExample(r,0);
    assert.equal(e.games.length,1);assert.equal(e.games[0].homePoints,30);
    assert.equal(e.games[0].battleDiff,1);assert.equal(e.games[0].roundDiff,0);
  }
  assert(verifySearchResult(JSON.parse(JSON.stringify(both))));
  const changed=structuredClone(d);changed.fixedDetails[m.id].roundDiff=1;
  assert.notEqual(searchFingerprint(d,c),searchFingerprint(changed,c));
  const normal={...c,caseId:'@normal'};assert.equal(searchFingerprint(d,normal),searchFingerprint(changed,normal));
});

test('first, top two and PO share traversal and agree with independent rank-cutoff enumeration',()=>{
  for(const mode of ['points','battles','rounds'])for(let seed=0;seed<8;seed++){
    const rows=outcomes(mode),subset=[rows[seed%rows.length],rows[(seed*7+3)%rows.length],rows[(seed*11+5)%rows.length]];
    const source=input(mode,[game(0,1,subset),game(2,3,subset),game(0,4,subset)],[seed*10,40,60,80,20,0]);
    for(const optimize of [true,false]){
      const all=searchPrepared(source,{targetTeamId:'a',goal:'all',optimize});
      assert(verifySearchResult(JSON.parse(JSON.stringify(all))));
      for(const [goal,cutoff]of [['first',1],['second',2],['po',3]])assert.deepEqual(flags(all.results[goal]),oracle(source,0,cutoff));
    }
  }
  const tied=input('rounds',[],[100,80,80,30,20,0]);
  const all=searchPrepared(tied,{targetTeamId:'b',goal:'all'});
  assert.equal(all.results.first.analysis.status,'impossible');
  assert.equal(all.results.second.analysis.status,'possible-not-guaranteed');
  assert.equal(all.results.po.analysis.status,'certain');
  assert.equal(reconstructExample(all.results.second,0).classification.status,'unresolved');
});
