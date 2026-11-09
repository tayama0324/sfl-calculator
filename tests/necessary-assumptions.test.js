import {mergeMatchRules} from '../docs/js/match-assumptions.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {necessaryMatchGroups,necessaryAssumptions,necessaryMatchRules} from '../docs/js/necessary-assumptions.js';
import {SCORES,migrateData} from '../docs/js/model.js';
import {runConditionSearch,prepareSearch,verifySearchResult,reconstructExample} from '../docs/js/condition-search.js';
import {renderSearchResult} from '../docs/js/condition-search-ui.js';
import {readFile} from 'node:fs/promises';
function fixture(home,away,scores=SCORES){return {initial:{teamIds:['a','b']},matches:[{id:'m',home:0,away:1,outcomeSet:0}],outcomeSets:[scores],singleMatchConditions:{analysis:{necessary:[...(home?[{matchId:'m',teamId:'a',points:home}]:[]),...(away?[{matchId:'m',teamId:'b',points:away}]:[])]}}};}
test('score contraction only replaces a conjunction with its unique legal outcome',()=>{
  assert.equal(necessaryMatchGroups(fixture(20,20))[0].exact,null);
  assert.equal(necessaryMatchGroups(fixture(30,10))[0].exact,null);
  assert.equal(necessaryMatchGroups(fixture(10,30))[0].exact,null);
  assert.deepEqual(necessaryMatchGroups(fixture(30,20))[0].exact,[30,20]);
  assert.deepEqual(necessaryMatchGroups(fixture(20,30))[0].exact,[20,30]);
  assert.deepEqual(necessaryMatchGroups(fixture(30,10,[[30,10,1]]))[0].exact,[30,10]);
});
test('applying conditions fixes only forced scores and never chooses arbitrary 30-20',()=>{
  assert.deepEqual(necessaryAssumptions(fixture(30,0)),{});
  assert.deepEqual(necessaryAssumptions(fixture(0,30)),{});
  assert.deepEqual(necessaryAssumptions(fixture(20,20)),{});
  assert.deepEqual(necessaryAssumptions(fixture(30,20)),{m:'30-20'});
  assert.deepEqual(necessaryAssumptions(fixture(30,10,[[30,10,1]])),{m:'30-10'});
  assert.deepEqual(necessaryAssumptions(fixture(0,0)),{});
  for(const h of [0,10,20,30,40])for(const a of [0,10,20,30,40]){
    const feasible=SCORES.filter(([x,y])=>x>=h&&y>=a);
    if(!feasible.length){assert.throws(()=>necessaryAssumptions(fixture(h,a)));continue;}
    if(!h&&!a)continue;
    const applied=necessaryAssumptions(fixture(h,a));
    if(feasible.length>1){assert.deepEqual(applied,{});continue;}
    const [x,y]=applied.m.split('-').map(Number);
    assert(x>=h&&y>=a);assert(SCORES.some(([p,q])=>x===p&&y===q));
  }
  const impossible=fixture(0,0);impossible.singleMatchConditions.analysis.necessary=null;assert.throws(()=>necessaryAssumptions(impossible));
});
test('necessary clauses are unabridged, contracted, button-free per clause, and only point mode offers apply',async()=>{
  const data=migrateData(JSON.parse(await readFile(new URL('../docs/data/default.json',import.meta.url))));
  const d=data.divisions[0];d.cases=[];
  for(const m of d.fixtures)if(!d.baseline.includedMatchIds.includes(m.id)&&!d.results[m.id])d.fixedScores[m.id]='30-20';
  const c={mode:'points',goal:'all',targetTeamId:d.teams[0].id,caseId:'@input'},r=runConditionSearch(d,c);
  const saved={status:'done',input:d,config:c,result:r,seconds:0,fingerprint:r.fingerprint};
  const html=renderSearchResult(saved,d,c);
  assert(!html.includes('necessary-matches-'));assert(!html.includes('class="all-match-necessary"><details'));
  assert(html.includes('の結果が <b>30 - 20</b>'));
  const necessary=html.match(/<section class="all-match-necessary">[\s\S]*?<\/section>/g)||[];assert(necessary.length);
  assert(necessary.some(s=>(s.match(/class="match-clause"/g)||[]).length>3));
  assert(necessary.every(s=>!s.includes('data-search-example')));assert(html.includes('data-apply-necessary'));
  const changed=structuredClone(d);changed.fixedScores[Object.keys(changed.fixedScores)[0]]='40-0';
  assert(renderSearchResult(saved,changed,c).includes('disabled title="入力が変更'));
});

test('iXA second-place regression: preserve its unique points case and find a battle-qualified outcome',async()=>{
  const data=migrateData(JSON.parse(await readFile(new URL('../docs/data/default.json',import.meta.url))));
  const d=data.divisions[0];d.cases=[];
  const c={mode:'points',goal:'all',targetTeamId:'ixa',caseId:'@input'};
  // Independent enumeration of the nine matches, with no engine pruning,
  // classifications, marginal summaries or condition-extraction helpers.
  const {prepared}=prepareSearch(d,c),points=[...prepared.points],target=prepared.teamIds.indexOf('ixa'),path=[],possible=[];
  function visit(depth){
    if(depth===prepared.matches.length){if(points.filter(p=>p>points[target]).length<2)possible.push([...path]);return;}
    const m=prepared.matches[depth];
    for(const [h,a]of m.outcomes){points[m.home]+=h;points[m.away]+=a;path.push(`${h}-${a}`);visit(depth+1);path.pop();points[m.home]-=h;points[m.away]-=a;}
  }
  visit(0);assert.equal(possible.length,1);
  const r=runConditionSearch(d,c);assert(verifySearchResult(r));
  const scores=necessaryAssumptions(r.results.second);
  assert.equal(Object.keys(scores).length,9);
  assert.deepEqual(prepared.matches.map(m=>scores[m.id]),possible[0]);
  assert.equal(scores['s-8-cr-sol'],'30-10');assert.equal(scores['s-9-cr-fav'],'30-10');
  const saved={status:'done',input:d,config:c,result:r,seconds:0,fingerprint:r.fingerprint};
  const html=renderSearchResult(saved,d,c);assert(html.includes('第8節 CR vs. SOL の結果が <b>30 - 10</b>'));
  mergeMatchRules(d,necessaryMatchRules(r.results.second));
  const battles=runConditionSearch(d,{...c,mode:'battles'});assert(verifySearchResult(battles));
  const second=battles.results.second;
  assert(second.cells.some(x=>x.success!==null));
  const witness=second.cells.find(x=>x.success!==null).success;
  assert.equal(reconstructExample(second,witness).classification.status,'success');
  const legacy=structuredClone(r);legacy.version=5;
  for(const goal of Object.values(legacy.results)){goal.version=5;for(const m of goal.singleMatchConditions.matches)for(const side of m.sides)if(side.possible)delete side.possible.max;}
  assert(verifySearchResult(legacy));
});
