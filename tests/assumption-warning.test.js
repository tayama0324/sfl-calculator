import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {migrateData,remaining} from '../docs/js/model.js';
import {renderAssumptionWarning,resultAssumptions} from '../docs/js/assumption-warning.js';
import {runConditionSearch} from '../docs/js/condition-search.js';import {renderSearchResult} from '../docs/js/condition-search-ui.js';
const raw=JSON.parse(await readFile(new URL('../docs/data/default.json',import.meta.url)));
test('warning lists calculation-time score/difference assumptions, escapes names, and excludes normal searches',()=>{
 const d=migrateData(raw).divisions[0],matches=remaining(d);d.fixedScores={[matches[0].id]:'30-20',[matches[1].id]:'40-0'};d.fixedDetails={[matches[0].id]:{battleDiff:1,roundDiff:0}};
 d.teams.find(t=>t.id===matches[0].homeTeamId).shortName='<script>x</script>';
 const saved={input:structuredClone(d),config:{caseId:'@input'}};
 const html=renderAssumptionWarning(saved,{conditions:true,disabled:true});assert(html.includes('仮定2件'));assert(html.includes('30–20'));assert(html.includes('バトル得失 +1'));assert(html.includes('ラウンド得失 0'));assert(html.includes('ほか1件'));assert(!html.includes('<script>'));assert(html.includes('再探索</button>'));assert(html.includes(' disabled'));
 d.fixedScores={};assert.equal(resultAssumptions(saved).length,2);
 assert.equal(renderAssumptionWarning({input:d}),'');assert.equal(renderAssumptionWarning({...saved,config:{caseId:'@normal'}}),'');assert.equal(renderAssumptionWarning(null),'');
});
test('condition notices and input-assumption tags follow saved input after edits',()=>{
 const d=migrateData(raw).divisions[0];d.cases=[];const matches=remaining(d);
 for(const m of matches.slice(1))d.results[m.id]={homePoints:40,awayPoints:0,homeBattleDiffDelta:7,homeRoundDiffDelta:14};
 d.fixedScores={[matches[0].id]:'30-20'};const c={targetTeamId:'fav',goal:'all',mode:'points',caseId:'@input'},r=runConditionSearch(d,c);
 const saved={status:'done',input:structuredClone(d),config:c,result:r,seconds:0,fingerprint:r.fingerprint};
 const html=renderSearchResult(saved,d,c);assert(html.includes('仮定で既に指定した結果も含まれます'));assert(html.includes('入力した仮定が成立する場合に限り'));assert(html.includes('入力済みの仮定'));
 d.fixedScores={};const stale=renderSearchResult(saved,d,c);assert(stale.includes('変更前の入力'));assert(stale.includes('入力済みの仮定'));assert(renderAssumptionWarning(saved).includes('仮定1件'));
 const normal=runConditionSearch(d,c);const fresh=renderSearchResult({...saved,input:d,result:normal,fingerprint:normal.fingerprint},d,c);assert(!fresh.includes('入力済みの仮定'));assert(!fresh.includes('class="assumption-condition-note"'));
});
