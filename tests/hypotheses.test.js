import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {migrateData,prepare,remaining,current,validate,BASE_CASE,validDifferences} from '../docs/js/model.js';
import {conditionedOutcomes} from '../docs/js/distributions.js';
import {createMonteCarlo} from '../docs/js/monte-carlo.js';
const raw=JSON.parse(await readFile(new URL('../docs/data/default.json',import.meta.url)));
const setup=()=>{const data=migrateData(raw),d=data.divisions[0],m=remaining(d)[0];d.fixedScores={[m.id]:'30-20'};d.fixedDetails={[m.id]:{battleDiff:1,roundDiff:0}};return {data,d,m};};
test('hypothetical differences filter joint outcomes without changing current standings or remaining fixtures',()=>{
  const {data,d,m}=setup(),before=current(d),count=remaining(d).length;
  assert.deepEqual(validate(data),[]);
  d.explorationMode='rounds';const rows=prepare(d,BASE_CASE).matches.find(x=>x.id===m.id).outcomes;
  assert.equal(rows.length,1);assert.deepEqual(rows[0].filter((_,i)=>i!==2),[30,20,1,0]);
  assert.deepEqual(current(d),before);assert.equal(remaining(d).length,count);
  d.fixedDetails[m.id].roundDiff=null;
  const partial=prepare(d,BASE_CASE).matches.find(x=>x.id===m.id).outcomes;
  assert(partial.length>1);assert(partial.every(row=>row[3]===1));
  d.fixedDetails[m.id].battleDiff=null;
  assert.deepEqual(prepare(d,BASE_CASE).matches.find(x=>x.id===m.id).outcomes,conditionedOutcomes('rounds',['30-20']));
});
test('round-only assumptions preserve conditional weights when projected into battle ranking',()=>{
  const {d,m}=setup();d.fixedDetails[m.id]={battleDiff:null,roundDiff:0};d.explorationMode='battles';
  const actual=prepare(d,BASE_CASE).matches.find(x=>x.id===m.id).outcomes;
  const expected=new Map();for(const [h,a,w,b,r]of conditionedOutcomes('rounds',['30-20']))if(r===0)expected.set(b,(expected.get(b)??0n)+BigInt(w));
  assert.deepEqual(new Map(actual.map(([, ,w,b])=>[b,BigInt(w)])),expected);
  assert(actual.every(row=>row[4]===0));
});
test('invalid score/difference combinations and orphaned assumptions are rejected',()=>{
  const {data,d,m}=setup();d.fixedDetails[m.id]={battleDiff:9,roundDiff:60};assert(validate(data).some(e=>e.includes('組み合わせ')));
  d.fixedDetails[m.id]={battleDiff:0.5,roundDiff:null};assert(validate(data).length);
  delete d.fixedScores[m.id];assert(validate(data).some(e=>e.includes('スコアを指定')));
  assert.equal(validDifferences(40,0,-7,-14),false);
});
test('changed hypothetical differences reject checkpoint reuse; unchanged assumptions replay identically',async()=>{
  const {d}=setup();d.cases=[];d.calculationMethod='monteCarlo';d.explorationMode='rounds';d.simulation={trials:100,seed:'hypotheses'};
  const run=await createMonteCarlo(d);run.step(40);const cp=run.checkpoint();
  const continued=await createMonteCarlo(d,JSON.parse(JSON.stringify(cp)));continued.step(60);
  const whole=await createMonteCarlo(d);whole.step(100);assert.deepEqual(continued.checkpoint().records,whole.checkpoint().records);
  Object.values(d.fixedDetails)[0].roundDiff=1;
  await assert.rejects(()=>createMonteCarlo(d,cp),/追加試行/);
});
