import test from 'node:test';import assert from 'node:assert/strict';
import {searchExamples,CONFIRMED_EXAMPLE} from '../docs/js/search-examples.js';
import {searchPrepared,reconstructExample,runConditionSearch} from '../docs/js/condition-search.js';
import {renderSearchResult} from '../docs/js/condition-search-ui.js';
import {readFile} from 'node:fs/promises';import {migrateData,remaining} from '../docs/js/model.js';
const base={mode:'points',teamIds:['a','b','c','d','e','f'],battleDiffs:[0,0,0,0,0,0],roundDiffs:[0,0,0,0,0,0]};
test('example order prefers sufficient and distinguishes a counterexample below necessary points',()=>{
 const r=searchPrepared({...base,points:[0,0,0,0,0,0],matches:[{id:'m',home:0,away:1,outcomes:[[0,40,1],[40,0,1]]}]},{targetTeamId:'a',goal:'first'});
 const e=searchExamples(r);assert.equal(e.length,3);assert.equal(e[0].label,CONFIRMED_EXAMPLE);assert.equal(e[1].label,'必要条件ギリギリで達成する例');assert(e[2].label.startsWith('必要条件に届かない'));
 assert.equal(reconstructExample(r,e[0].id).classification.status,'success');assert.equal(e[0].id,e[1].id);
});
test('unresolved minimum is never labeled achieved, and impossible results have no confirmed example',()=>{
 const r=searchPrepared({...base,points:[100,100,0,0,0,0],matches:[]},{targetTeamId:'a',goal:'first'});
 const e=searchExamples(r);assert.equal(e[0].label,'必要条件ギリギリで達成の可能性が残る例');assert.equal(e[1].label,'必要条件を満たしたけれども未達成または得失次第の例');assert(e.every(x=>reconstructExample(r,x.id).classification.status==='unresolved'));
 const impossible=searchPrepared({...base,points:[0,100,0,0,0,0],matches:[]},{targetTeamId:'a',goal:'first'});assert.deepEqual(searchExamples(impossible).map(x=>x.label),['未達成の例']);
});
test('rendered default equals the first named button and explicit labels survive shared witness IDs',async()=>{
 const data=migrateData(JSON.parse(await readFile(new URL('../docs/data/default.json',import.meta.url))));const d=data.divisions[0];d.cases=[];
 for(const m of remaining(d))d.fixedScores[m.id]='40-0';
 const c={targetTeamId:'fav',mode:'points',goal:'all',caseId:'@input'},r=runConditionSearch(d,c);
 const saved={input:d,config:c,status:'done',result:r,seconds:0,fingerprint:r.fingerprint};
 const html=renderSearchResult(saved,d,c);assert(html.includes('<summary>具体例を見る</summary>'));assert(!html.includes('境界の具体例・保証できない例を見る'));
 const example=searchExamples(r.results.po)[0];assert.equal(example.label,CONFIRMED_EXAMPLE);assert(html.includes(`<h3>${CONFIRMED_EXAMPLE}<small`));
 const clicked='必要条件ギリギリで達成する例';saved.exampleIndices={po:example.id};saved.exampleLabels={po:clicked};
 const selected=renderSearchResult(saved,d,c);assert(selected.includes(`<h3>${clicked}<small`));
 saved.exampleLabels.po='<script>unsafe</script>';assert(!renderSearchResult(saved,d,c).includes('<script>unsafe</script>'));
});
