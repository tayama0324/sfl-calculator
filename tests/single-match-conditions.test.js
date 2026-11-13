import test from 'node:test';
import assert from 'node:assert/strict';
import {searchPrepared,verifySearchResult,reconstructExample,runConditionSearch} from '../docs/js/condition-search.js';
import {analyzeSingleMatchConditions} from '../docs/js/single-match-conditions.js';
import {renderSearchResult} from '../docs/js/condition-search-ui.js';
import {readFile} from 'node:fs/promises';
import {migrateData} from '../docs/js/model.js';
const base={teamIds:['a','b','c','d','e','f'],battleDiffs:[0,0,0,0,0,0],roundDiffs:[0,0,0,0,0,0]};
const cmp=(a,b)=>a.reduce((n,v,i)=>n||v-b[i],0);
function oracle(input,cutoff){
  const dims=input.mode==='points'?1:input.mode==='battles'?2:3;
  const standings=input.points.map((p,i)=>[p,input.battleDiffs[i],input.roundDiffs[i]].slice(0,dims)),scores=[],states=[];
  function visit(depth){
    if(depth===input.matches.length){
      const above=standings.filter(t=>cmp(t,standings[0])>0).length,tied=standings.filter(t=>cmp(t,standings[0])===0).length;
      states.push({safe:above+tied<=cutoff,possible:above<cutoff,scores:structuredClone(scores)});return;
    }
    const m=input.matches[depth];
    for(const [h,a,,b=0,r=0]of m.outcomes){
      const deltas=[[h,b,r],[a,-b,-r]];scores.push([h,a]);
      for(const [side,id]of [m.home,m.away].entries())standings[id]=standings[id].map((v,i)=>v+deltas[side][i]);
      visit(depth+1);scores.pop();
      for(const [side,id]of [m.home,m.away].entries())standings[id]=standings[id].map((v,i)=>v-deltas[side][i]);
    }
  }
  visit(0);return states;
}
test('single-match bounds equal independent enumeration for every match/side, mode, goal, and subtree optimization',()=>{
  const outcomes=[[0,40,'1',-7,-14],[10,30,'1',-3,-6],[20,30,'1',1,-2],[30,20,'1',-1,2],[40,0,'1',7,14]];
  for(const mode of ['points','battles','rounds'])for(let seed=0;seed<12;seed++){
    const input={...base,mode,points:[seed*10,30,60,90,0,10],matches:[[0,1],[2,3],[4,0]].map(([home,away],i)=>({id:`g${i}`,home,away,outcomes:i===2&&seed%2?[outcomes[3]]:outcomes}))};
    for(const optimize of [true,false]){
      const result=searchPrepared(input,{targetTeamId:'a',goal:'all',optimize});assert(verifySearchResult(result));
      for(const [goal,cutoff]of [['first',1],['second',2],['po',3]]){
        const r=result.results[goal],single=r.singleMatchConditions,states=oracle(input,cutoff);
        single.matches.forEach((m,mi)=>m.sides.forEach((b,side)=>{
          for(const [key,safe]of [['success',true],['notGuaranteed',false]]){
            const selected=states.filter(s=>s.safe===safe).map(s=>s.scores[mi][side]);
            if(!selected.length)assert.equal(b[key],null);
            else{assert.equal(b[key].min.points,Math.min(...selected));assert.equal(b[key].max.points,Math.max(...selected));}
          }
          const possible=states.filter(s=>s.possible).map(s=>s.scores[mi][side]);
          const necessary=single.analysis.necessary?.find(c=>c.matchId===m.matchId&&c.teamId===b.teamId);
          if(!possible.length){assert.equal(b.possible,null);assert.equal(single.analysis.necessary,null);}
          else {
            const minimum=Math.min(...possible);assert.equal(b.possible.min.points,minimum);assert.equal(b.possible.max.points,Math.max(...possible));
            assert.equal(necessary?.points??0,minimum);
            if(necessary)assert.notEqual(reconstructExample(r,necessary.witness).classification.status,'failure');
          }
          for(const operator of ['atLeast','atMost']){
            const thresholds=[0,10,20,30,40].filter(p=>{
              const selected=states.filter(s=>operator==='atLeast'?s.scores[mi][side]>=p:s.scores[mi][side]<=p);
              return selected.length&&selected.every(s=>s.safe);
            });
            const candidate=single.analysis.sufficient.find(c=>c.matchId===m.matchId&&c.teamId===b.teamId&&c.operator===operator);
            if(r.analysis.status==='certain'){assert(!candidate);continue;}
            if(!thresholds.length)assert(!candidate);
            else assert.equal(candidate.points,operator==='atLeast'?thresholds[0]:thresholds.at(-1));
          }
        }));
        for(const c of single.analysis.sufficient){
          assert.equal(reconstructExample(r,c.witness).classification.status,'success');
          assert.notEqual(reconstructExample(r,c.counterexample).classification.status,'success');
        }
      }
    }
  }
});
test('other-team-only matches supply upper and lower conditions with unresolved ties excluded',()=>{
  const input={...base,mode:'points',points:[30,0,20,0,0,0],matches:[{id:'others',home:1,away:2,outcomes:[[0,40,'1'],[20,20,'1'],[30,10,'1'],[40,0,'1']]}]};
  const r=searchPrepared(input,{targetTeamId:'a',goal:'second'});assert(verifySearchResult(r));
  const c=r.singleMatchConditions.analysis.sufficient;
  assert(c.some(x=>x.teamId==='c'&&x.operator==='atLeast'));assert(c.some(x=>x.teamId==='b'&&x.operator==='atMost'));
  const corrupt=structuredClone(r);corrupt.singleMatchConditions.matches[0].sides[0].notGuaranteed.min.points+=10;assert(!verifySearchResult(corrupt));
  const corruptThreshold=structuredClone(r);corruptThreshold.singleMatchConditions.analysis.sufficient[0].points+=10;assert(!verifySearchResult(corruptThreshold));
  const legacy=structuredClone(r);legacy.version=3;delete legacy.singleMatchConditions;assert(verifySearchResult(legacy));
});
test('marginal bounds deliberately do not claim to find conjunction-only guarantees',()=>{
  const extent={min:{points:0,witness:0},max:{points:40,witness:1}};
  const matches=[{matchId:'x',sides:[{teamId:'a',success:extent,notGuaranteed:extent}]}];
  assert.deepEqual(analyzeSingleMatchConditions(matches,'conditional').sufficient,[]);
  for(const [points,status]of [[[100,0,0,0,0,0],'certain'],[[0,100,100,100,100,100],'impossible'],[[100,100,0,0,0,0],'possible-not-guaranteed']]){
    const r=searchPrepared({...base,mode:'rounds',points,matches:[]},{targetTeamId:'a',goal:'first'});
    assert(verifySearchResult(r));assert.equal(r.singleMatchConditions.analysis.status,status);assert.deepEqual(r.singleMatchConditions.analysis.sufficient,[]);
  }
});
test('real input exports new conditions, keeps own conjunctions, and explains empty marginal results',async()=>{
  const data=migrateData(JSON.parse(await readFile(new URL('../docs/data/default.json',import.meta.url))));
  const d=data.divisions[0];d.cases=[];
  // Keep a small real fixture with fixed scores, including an extension score.
  for(const m of d.fixtures)if(!d.baseline.includedMatchIds.includes(m.id)&&!d.results[m.id])d.fixedScores[m.id]='30-20';
  const c={targetTeamId:d.teams[0].id,mode:'points',goal:'all',caseId:'@input'},r=runConditionSearch(d,c);
  assert(verifySearchResult(JSON.parse(JSON.stringify(r))));
  const html=renderSearchResult({status:'done',input:d,config:c,result:r,seconds:0,fingerprint:r.fingerprint},d,c);
  assert(!html.includes('この形式では十分条件なし'));
  assert(!html.includes('必要条件の境界例</button></div>'));
  assert(html.includes('他力での確定条件欄を省略'));
});

test('other-team necessary minima include unresolved cases and v4 exports stay verifiable',()=>{
  const input={...base,mode:'points',points:[40,0,20,0,0,0],matches:[{id:'others',home:1,away:2,outcomes:[[0,40,'1'],[20,30,'1'],[30,10,'1'],[40,0,'1']]}]};
  const r=searchPrepared(input,{targetTeamId:'a',goal:'first'});assert(verifySearchResult(r));
  const single=r.singleMatchConditions;
  assert.deepEqual(single.analysis.necessary.map(c=>[c.teamId,c.points]),[['b',30]]);
  // Team c can score zero in an unresolved case, so success-only minima (10)
  // would incorrectly exclude a possible achievement.
  assert.equal(single.matches[0].sides[1].success.min.points,10);
  assert.equal(single.matches[0].sides[1].possible.min.points,0);
  const corrupt=structuredClone(r);corrupt.singleMatchConditions.matches[0].sides[1].possible.min.points=10;assert(!verifySearchResult(corrupt));
  const corruptCondition=structuredClone(r);corruptCondition.singleMatchConditions.analysis.necessary[0].points=40;assert(!verifySearchResult(corruptCondition));
  const legacy=structuredClone(r);legacy.version=4;delete legacy.singleMatchConditions.analysis.necessary;
  for(const m of legacy.singleMatchConditions.matches)for(const side of m.sides)delete side.possible;
  assert(verifySearchResult(legacy));
});

test('round 8 ZETA hides own fixtures from other-team guarantees, including opponent score bounds',async()=>{
 const data=migrateData(JSON.parse(await readFile(new URL('../docs/data/default.json',import.meta.url))));
 const d=data.divisions[0];d.cases=[];
 const c={targetTeamId:'zet',mode:'points',goal:'all',caseId:'@input'},r=runConditionSearch(d,c);
 // Legacy single-match rendering remains filtered when no joint tables exist.
 for(const result of Object.values(r.results))delete result.combinedMatchConditions;
 const render=result=>renderSearchResult({status:'done',input:d,config:c,result,seconds:0,fingerprint:result.fingerprint},d,c);
 const before=JSON.stringify(r),html=render(r);
 assert.equal(r.results.po.singleMatchConditions.analysis.sufficient.length,4);
 for(const block of html.matchAll(/<section class="single-match-conditions">([\s\S]*?)<\/section>/g))assert(!/第9節 ZETA vs\. SOL|第10節 FAV vs\. ZETA/.test(block[1]));
 assert.equal(JSON.stringify(r),before); // Rendering must retain engine evidence.
 assert(html.includes('ZETAが40点'));
 assert(!html.includes('<section class="single-match-conditions">'));
 assert(!html.includes('<h4>自力での確定条件</h4>'));
 // A candidate referring to a match between two other teams remains visible.
 const mixed=structuredClone(r),first=mixed.results.po;
 const candidate=first.singleMatchConditions.analysis.sufficient[0];assert(candidate);
 const other=d.fixtures.find(m=>m.round===9&&m.homeTeamId!=='zet'&&m.awayTeamId!=='zet');
 first.singleMatchConditions.analysis.sufficient.push({...candidate,matchId:other.id,teamId:other.homeTeamId});
 const mixedHtml=render(mixed);assert(mixedHtml.includes('<h4>他力での確定条件</h4>'));assert(mixedHtml.includes('次のいずれか1つを満たせば確定（1条件）'));assert(mixedHtml.includes('<h4>自力での確定条件</h4>'));
});
