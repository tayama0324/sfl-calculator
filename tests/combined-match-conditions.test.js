import test from 'node:test';import assert from 'node:assert/strict';
import {combinationLimit} from '../docs/js/combined-match-conditions.js';
import {searchPrepared,verifySearchResult} from '../docs/js/condition-search.js';
const input={teamIds:['a','b','c','d','e','f'],points:[70,60,50,40,30,20],battleDiffs:[0,1,-1,2,-2,0],roundDiffs:[0,2,-2,4,-4,0],matches:[{id:'own',home:0,away:1},{id:'others1',home:2,away:3},{id:'others2',home:4,away:5}].map(m=>({...m,outcomes:[[40,0,1,4,8],[30,10,2,2,4],[30,20,1,1,2],[20,30,1,-1,-2],[10,30,2,-2,-4],[0,40,1,-4,-8]]}))};
function oracle(source,cutoff){
 const states=[],path=[],p=[...source.points],b=[...source.battleDiffs],r=[...source.roundDiffs];
 function visit(depth){if(depth===source.matches.length){let above=0,equal=0;for(let i=0;i<6;i++){const cmp=p[i]-p[0]||(source.mode!=='points'?b[i]-b[0]:0)||(source.mode==='rounds'?r[i]-r[0]:0);if(cmp>0)above++;if(cmp===0)equal++;}states.push({path:[...path],good:above+equal<=cutoff});return;}
 const m=source.matches[depth];for(let i=0;i<m.outcomes.length;i++){const [h,a,,db,dr]=m.outcomes[i];path.push(i);p[m.home]+=h;p[m.away]+=a;b[m.home]+=db;b[m.away]-=db;r[m.home]+=dr;r[m.away]-=dr;visit(depth+1);path.pop();p[m.home]-=h;p[m.away]-=a;b[m.home]-=db;b[m.away]+=db;r[m.home]-=dr;r[m.away]+=dr;}}
 visit(0);return states;
}
const admits=(state,clauses)=>clauses.every(c=>c.mask&(1<<state.path[c.matchIndex]));
test('limits use 3 matches for the last round, 2 up to nine matches, none beyond',()=>{
 for(const [m,n]of [[0,3],[3,3],[4,2],[6,2],[9,2],[10,0],[12,0]])assert.equal(combinationLimit(m),n);
});
test('joint tables and guarantees match independent exhaustive enumeration in every ranking mode',()=>{
 let multiple=0;
 for(const mode of ['points','battles','rounds']){
 const source={...input,mode};const result=searchPrepared(source,{targetTeamId:'a',goal:'all'});
 assert(verifySearchResult(result));
 for(const [goal,cutoff]of [['first',1],['second',2],['po',3]]){
 const data=result.results[goal].combinedMatchConditions,states=oracle(source,cutoff);
 for(const table of data.tables)for(let cell=0;cell<table.good.length;cell++){
 const matching=states.filter(s=>table.indices.reduce((n,i)=>n*6+s.path[i],0)===cell);
 assert.equal(table.good[cell]!==null,matching.some(s=>s.good));assert.equal(table.bad[cell]!==null,matching.some(s=>!s.good));
 }
 for(const c of data.sufficient){const matching=states.filter(s=>admits(s,c.clauses));assert(matching.length);assert(matching.every(s=>s.good));assert(c.clauses.some(c=>c.matchIndex>0));if(c.clauses.length>1)multiple++;
 for(let i=0;i<c.clauses.length;i++)assert(states.some(s=>!s.good&&admits(s,c.clauses.filter((_,j)=>i!==j))));
 }
 }
 const plain=searchPrepared(source,{targetTeamId:'a',goal:'all',optimize:false});
 for(const goal of ['first','second','po'])assert.deepEqual(result.results[goal].combinedMatchConditions.sufficient.map(c=>c.clauses),plain.results[goal].combinedMatchConditions.sufficient.map(c=>c.clauses));
 const broken=structuredClone(result);broken.results.first.combinedMatchConditions.tables[0].good=[];assert(!verifySearchResult(broken));
 }
 assert(multiple>0);
});
test('collapsed subtrees project supported score combinations, including fixed assumptions and duplicate detailed scores',()=>{
 const source={...input,mode:'rounds',points:[300,60,50,40,30,20],matches:input.matches.map((m,i)=>({...m,outcomes:i===0?[[30,20,1,1,2],[30,20,1,2,3]]:m.outcomes.slice(0,2)}))};
 const result=searchPrepared(source,{targetTeamId:'a',goal:'all'});assert(verifySearchResult(result));
 for(const r of Object.values(result.results)){assert(BigInt(r.collapsed)>0n);assert.equal(r.combinedMatchConditions.matches[0].scores.length,1);assert.deepEqual(r.combinedMatchConditions.sufficient,[]);for(const t of r.combinedMatchConditions.tables){assert(t.good.every(id=>id!==null));assert(t.bad.every(id=>id===null));}}
});
test('the last round finds a genuine three-match guarantee which no two clauses can guarantee',()=>{
 const source={...input,mode:'points',points:[50,50,60,40,60,40]};
 const result=searchPrepared(source,{targetTeamId:'a',goal:'first'}),states=oracle(source,1);
 assert(verifySearchResult(result));const candidate=result.combinedMatchConditions.sufficient.find(c=>c.clauses.length===3);assert(candidate);
 assert(states.filter(s=>admits(s,candidate.clauses)).every(s=>s.good));
 for(let i=0;i<3;i++)assert(states.some(s=>!s.good&&admits(s,candidate.clauses.filter((_,j)=>i!==j))));
});

test('score ranges enumerate every distinct rectangle on every supported score subset',async()=>{
 const {scoreConditionOptions}=await import('../docs/js/combined-match-conditions.js');
 const full=input.matches[0].outcomes.map(o=>o.slice(0,2));
 assert.equal(scoreConditionOptions({scores:full},false).length,10);
 assert.equal(scoreConditionOptions({scores:full},true).length,20);
 for(let subset=1;subset<64;subset++){
   const scores=full.filter((_,i)=>subset&(1<<i)),all=(1<<scores.length)-1,expected=new Set();
   for(let a=0;a<=40;a+=10)for(let b=a;b<=40;b+=10)for(let c=0;c<=40;c+=10)for(let d=c;d<=40;d+=10){
     const mask=scores.reduce((v,s,i)=>v|(s[0]>=a&&s[0]<=b&&s[1]>=c&&s[1]<=d?1<<i:0),0);if(mask&&mask!==all)expected.add(mask);
   }
   const options=scoreConditionOptions({scores},true);assert.deepEqual(new Set(options.map(o=>o.mask)),expected);assert.equal(options.length,expected.size);
   for(const o of options){const mask=scores.reduce((v,s,i)=>{
     const yes=o.operator==='exact'?s[0]===o.score[0]&&s[1]===o.score[1]:o.operator==='range'?s[o.side]>=o.min&&s[o.side]<=o.max:o.operator==='ranges'?s.every((n,j)=>n>=o.bounds[j][0]&&n<=o.bounds[j][1]):o.operator==='atLeast'?s[o.side]>=o.points:s[o.side]<=o.points;
     return v|(yes?1<<i:0);
   },0);assert.equal(mask,o.mask);}
 }
});
test('exact scores and bounded ranges find guarantees missed by one-sided bounds',async()=>{
 const {analyzeCombinedConditions}=await import('../docs/js/combined-match-conditions.js');
 const scores=input.matches[0].outcomes.map(o=>o.slice(0,2));
 for(const goodIndices of [[2],[1,2],[1,2,3],[2,3]]){
   const table={indices:[0],good:scores.map((_,i)=>goodIndices.includes(i)?i:null),bad:scores.map((_,i)=>goodIndices.includes(i)?null:i)};
   const legacy={limit:2,matches:[{matchId:'others',home:1,away:2,scores}],tables:[table]};
   assert.deepEqual(analyzeCombinedConditions(legacy,0),[]);
   const result=analyzeCombinedConditions({...legacy,format:'score-ranges'},0);assert.equal(result.length,1);
   assert.equal(result[0].clauses[0].mask,goodIndices.reduce((n,i)=>n|1<<i,0));
   if(goodIndices.length===1)assert.deepEqual(result[0].clauses[0].score,[30,20]);
   else assert.equal(result[0].clauses[0].operator,goodIndices[0]===2?'ranges':'range');
 }
});
test('older joint results retain their one-sided interpretation and new format is validated',async()=>{
 const {analyzeCombinedConditions}=await import('../docs/js/combined-match-conditions.js');
 const result=searchPrepared({...input,mode:'points'},{targetTeamId:'a',goal:'first'});
 const old=structuredClone(result);old.version=7;delete old.combinedMatchConditions.format;old.combinedMatchConditions.sufficient=old.analysis.status==='conditional'?analyzeCombinedConditions(old.combinedMatchConditions,0):[];assert(verifySearchResult(old));
 const broken=structuredClone(result);broken.combinedMatchConditions.format='unknown';assert(!verifySearchResult(broken));
});
