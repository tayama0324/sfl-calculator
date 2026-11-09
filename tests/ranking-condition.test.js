import test from 'node:test';
import assert from 'node:assert/strict';
import {searchPrepared,verifySearchResult} from '../site/js/condition-search.js';
import {analyzeRankingCondition} from '../site/js/ranking-condition.js';
import {renderSearchResult} from '../site/js/condition-search-ui.js';
const cmp=(a,b)=>a.reduce((n,v,i)=>n||v-b[i],0);
function enumerate(input,target,cutoff){
  const initial=input.points.map((p,i)=>[p,input.battleDiffs[i],input.roundDiffs[i]].slice(0,input.mode==='rounds'?3:2));
  const standings=structuredClone(initial),states=[];
  function visit(depth){
    if(depth===input.matches.length){
      const above=standings.filter(t=>cmp(t,standings[target])>0).length;
      const tied=standings.filter(t=>cmp(t,standings[target])===0).length;
      states.push({values:standings[target].map((v,i)=>v-initial[target][i]),safe:above+tied<=cutoff});return;
    }
    const m=input.matches[depth];
    for(const [h,a,,b,r] of m.outcomes){
      const delta=[[h,b,r],[a,-b,-r]];
      for(const [k,id] of [m.home,m.away].entries())standings[id]=standings[id].map((v,i)=>v+delta[k][i]);
      visit(depth+1);
      for(const [k,id] of [m.home,m.away].entries())standings[id]=standings[id].map((v,i)=>v-delta[k][i]);
    }
  }
  visit(0);return states.sort((a,b)=>cmp(a.values,b.values));
}
test('ranking boundaries match independent enumeration with compressed subtrees, all goals, and home/away signs',()=>{
  for(const mode of ['battles','rounds'])for(let seed=0;seed<20;seed++){
    const outcomes=[[0,40,'1',-7,-14],[20,30,'1',1,2],[30,20,'1',1,-2],[30,10,'1',3,5],[40,0,'1',7,14]];
    const input={mode,teamIds:['a','b','c','d','e','f'],points:[seed*10,60,80,40,20,100],battleDiffs:[-5,2,0,3,4,-4],roundDiffs:[-8,4,0,6,8,-10],matches:[[0,1],[2,3],[4,0]].map(([home,away],i)=>({id:`m${i}`,home,away,outcomes}))};
    for(const optimize of [true,false]){
      const r=searchPrepared(input,{targetTeamId:'a',goal:'all',optimize});assert(verifySearchResult(r));
      for(const [goal,cutoff] of [['first',1],['second',2],['po',3]]){
        const c=r.results[goal].rankingCondition,states=enumerate(input,0,cutoff),bad=states.filter(s=>!s.safe);
        assert.deepEqual(c.maximum.values,states.at(-1).values);
        assert.deepEqual(c.maximumNotGuaranteed?.values??null,bad.at(-1)?.values??null);
        if(c.status==='conditional'){
          const accepted=states.filter(s=>cmp(s.values,c.threshold)>=0);assert(accepted.length);assert(accepted.every(s=>s.safe));
          const weaker=[...c.threshold];weaker[weaker.length-1]--;assert(states.some(s=>cmp(s.values,weaker)>=0&&!s.safe));
        }else assert.equal(c.status,bad.length?'dependent':'certain');
      }
    }
  }
});
test('strict lexicographic boundary includes negative differences and leaves complete ties unguaranteed',()=>{
  assert.deepEqual(analyzeRankingCondition({values:[40,-5,-10],witness:1},{values:[30,3,-2],witness:0}).threshold,[30,3,-1]);
  assert.deepEqual(analyzeRankingCondition({values:[40,-5],witness:1},{values:[30,3],witness:0}).threshold,[30,4]);
  for(const [points,status]of [[[100,0,0,0,0,0],'certain'],[[0,100,100,100,100,100],'dependent'],[[100,100,0,0,0,0],'dependent']]){
    const r=searchPrepared({mode:'rounds',teamIds:['a','b','c','d','e','f'],points,battleDiffs:Array(6).fill(0),roundDiffs:Array(6).fill(0),matches:[]},{targetTeamId:'a',goal:'first'});
    assert.equal(r.rankingCondition.status,status);assert(verifySearchResult(r));
    const corrupt=structuredClone(r);corrupt.rankingCondition.maximum.values[2]++;assert(!verifySearchResult(corrupt));
    const legacy=structuredClone(r);legacy.version=2;delete legacy.rankingCondition;assert(verifySearchResult(legacy));
  }
});
test('rendered conditions share columns, use exact 40 points, and distinguish detailed ranking modes',()=>{
  for(const mode of ['battles','rounds']){
    const input={mode,teamIds:['a','b','c','d','e','f'],points:[0,0,0,0,0,0],battleDiffs:Array(6).fill(0),roundDiffs:Array(6).fill(0),matches:[{id:'m',home:0,away:1,outcomes:[[0,40,'1',-7,-14],[40,0,'1',7,14]]}]};
    const results=searchPrepared(input,{targetTeamId:'a',goal:'all'});
    const d={teams:input.teamIds.map(id=>({id,name:id,shortName:id})),fixtures:[{id:'m',round:1,homeTeamId:'a',awayTeamId:'b'}],fixedScores:{},cases:[]};
    const config={mode,goal:'all',targetTeamId:'a',caseId:'@input'};
    for(const [goal,r]of Object.entries(results.results)){r.input=d;r.config={...config,goal};}
    const saved={status:'done',input:d,config,result:results,seconds:0,exampleIndices:{first:null,second:null,po:null}};
    // Avoid rendering representative games: only the display contract is under test here.
    saved.exampleIndices={first:undefined,second:undefined,po:undefined};
    for(const r of Object.values(results.results)){r.outcomeExamples=r.outcomeSets.map(s=>s.map(()=>null));r.resolution=[];r.caseDefinition={id:'baseline',conditions:[]};}
    const html=renderSearchResult(saved,d,config);
    assert.equal((html.match(/class="conditions-table"/g)||[]).length,3);
    assert.equal((html.match(/data-label="十分条件"/g)||[]).length,6);
    assert(html.includes('の結果が <b>40 - 0</b>'));assert(!html.includes('40点以上</b>'));
    assert(html.includes(mode==='rounds'?'得失-7/-13':'バトル得失-6'));
    for(const r of Object.values(results.results))r.rankingCondition=analyzeRankingCondition({values:[40,7,14],witness:0},{values:[40,7,14],witness:0});
    const dependent=renderSearchResult(saved,d,config);
    assert(dependent.includes(mode==='rounds'?'>他力</td>':'>他力またはラウンド得失次第</td>'));
    if(mode==='rounds')assert(!dependent.includes('他力または得失次第'));

  }
});
