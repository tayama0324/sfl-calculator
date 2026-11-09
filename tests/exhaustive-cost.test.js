import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {migrateData,remaining,prepare,BASE_CASE} from '../site/js/model.js';
import {exhaustiveCost,renderCost} from '../site/js/exhaustive-cost.js';
import {runConditionSearch} from '../site/js/condition-search.js';
import {calculate} from '../site/js/engine.js';
const raw=JSON.parse(await readFile(new URL('../site/data/default.json',import.meta.url)));
test('cost shares score and detailed assumption filtering with progress in every ranking mode',()=>{
  const d=migrateData(raw).divisions[0];d.cases=[];
  const matches=remaining(d);for(const m of matches.slice(1))d.results[m.id]={homePoints:40,awayPoints:0,homeBattleDiffDelta:7,homeRoundDiffDelta:14};
  const m=matches[0];
  for(const details of [undefined,{battleDiff:null,roundDiff:null},{battleDiff:1,roundDiff:null},{battleDiff:null,roundDiff:0},{battleDiff:1,roundDiff:0}])for(const mode of ['points','battles','rounds']){
    d.explorationMode=mode;d.fixedScores[m.id]='30-20';d.fixedDetails=details?{[m.id]:details}:{};
    const before=JSON.stringify(d),cost=exhaustiveCost(d,mode,1),prepared=prepare(d,BASE_CASE);
    assert.equal(cost.total,String(prepared.matches[0].outcomes.length));
    const progress=[];const result=runConditionSearch(d,{mode,targetTeamId:'ixa',goal:'all',caseId:'@input'},p=>progress.push(p));
    assert.equal(cost.total,result.total);assert(progress.every(p=>p.total===cost.total));
    const exactProgress=[];calculate(prepared,p=>exactProgress.push(p));assert(exactProgress.length);assert(exactProgress.every(p=>p.total===cost.total));
    assert.equal(JSON.stringify(d),before);
  }
});
test('mixed match factors, live assumption removal and no remaining games have correct costs',()=>{
  const d=migrateData(raw).divisions[0];d.cases=[];const m=remaining(d)[0];
  assert.equal(exhaustiveCost(d,'points',1).total,String(6**9));
  d.fixedScores[m.id]='40-0';
  const cost=exhaustiveCost(d,'points',1);assert.equal(cost.total,String(6**8));assert.equal(cost.states,null);assert.equal(cost.stateCounts.filter(n=>n===1).length,1);
  const html=renderCost(d,{mode:'points',cases:1});assert(html.includes('6<sup>8</sup>'));assert(html.includes('仮定を、選択した順位判定に合わせて反映'));assert(!html.includes('仮定や部分木の集約を反映しない'));
  delete d.fixedScores[m.id];assert.equal(exhaustiveCost(d,'points',1).total,String(6**9));
  for(const game of remaining(d))d.results[game.id]={homePoints:40,awayPoints:0,homeBattleDiffDelta:7,homeRoundDiffDelta:14};
  for(const mode of ['points','battles','rounds'])assert.equal(exhaustiveCost(d,mode,1).total,'1');
});
