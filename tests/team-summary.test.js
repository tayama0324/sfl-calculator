import test from 'node:test';import assert from 'node:assert/strict';
import {calculateTeamSummary,verifyTeamSummary} from '../docs/js/team-summary.js';
import {calculate} from '../docs/js/engine.js';import {boundsOf} from '../docs/js/model.js';
const base={teamIds:['a','b','c','d','e','f'],points:[60,50,60,40,30,20],battleDiffs:[0,2,-2,0,1,-1],roundDiffs:[0,3,-3,0,2,-2],matches:[{id:'own1',home:0,away:1,outcomes:[[40,0,1,4,8],[30,10,2,2,4],[30,20,1,1,2],[20,30,1,-1,-2],[10,30,2,-2,-4],[0,40,1,-4,-8]]},{id:'others',home:2,away:3,outcomes:[[30,10,2,2,4],[30,20,1,1,2],[10,30,2,-2,-4]]},{id:'own2',home:4,away:0,outcomes:[[40,0,1,4,8],[30,20,1,1,2],[0,40,1,-4,-8]]}]};
function oracle(input){
 const all=[],p=[...input.points],b=[...input.battleDiffs],r=[...input.roundDiffs],scores=[];
 function visit(depth,w){if(depth===input.matches.length){const compare=i=>p[i]-p[0]||(input.mode!=='points'?b[i]-b[0]:0)||(input.mode==='rounds'?r[i]-r[0]:0);const above=p.filter((_,i)=>compare(i)>0).length,ties=p.filter((_,i)=>compare(i)===0).length;all.push({points:p[0],ranks:Array.from({length:ties},(_,i)=>above+i),w,scores:[...scores]});return;}
 const m=input.matches[depth];for(const [h,a,weight,db,dr]of m.outcomes){p[m.home]+=h;p[m.away]+=a;b[m.home]+=db;b[m.away]-=db;r[m.home]+=dr;r[m.away]-=dr;scores.push([h,a]);visit(depth+1,w*BigInt(weight));scores.pop();p[m.home]-=h;p[m.away]-=a;b[m.home]-=db;b[m.away]+=db;r[m.home]-=dr;r[m.away]+=dr;}}
 visit(0,1n);return all;
}
function checkBucket(b,states,mode,ranked=true){
 assert.equal(BigInt(b.mass),states.reduce((n,s)=>n+s.w*60n,0n));
 if(ranked)assert.equal(BigInt(b.patterns),BigInt(states.length));
 for(const cut of [1,2,3]){
 const lo=states.reduce((n,s)=>n+(mode==='points'?s.w*60n/BigInt(s.ranks.length)*BigInt(s.ranks.filter(r=>r<cut).length):s.ranks.every(r=>r<cut)?s.w*60n:0n),0n);
 const hi=mode==='points'?lo:states.reduce((n,s)=>n+(s.ranks.some(r=>r<cut)?s.w*60n:0n),0n);
 assert.equal(BigInt(b.goalLower[cut-1]),lo);assert.equal(BigInt(b.goalUpper[cut-1]),hi);
 }
 if(ranked)for(let rank=0;rank<6;rank++){
 const lo=states.reduce((n,s)=>n+(s.ranks.includes(rank)&&(mode==='points'||s.ranks.length===1)?s.w*60n/BigInt(mode==='points'?s.ranks.length:1):0n),0n);
 const hi=mode==='points'?lo:states.reduce((n,s)=>n+(s.ranks.includes(rank)?s.w*60n:0n),0n);
 assert.equal(BigInt(b.rankLower[rank]),lo);assert.equal(BigInt(b.rankUpper[rank]),hi);
 assert.equal(BigInt(b.rankPatternsLower[rank]),BigInt(states.filter(s=>s.ranks.length===1&&s.ranks[0]===rank).length));assert.equal(BigInt(b.rankPatternsUpper[rank]),BigInt(states.filter(s=>s.ranks.includes(rank)).length));
 }
}
test('weighted ranks, final scores, pattern counts and every match impact agree with independent enumeration',()=>{
 for(const mode of ['points','battles','rounds']){
 const input={...base,mode},states=oracle(input),summary=calculateTeamSummary(input,'a');assert(verifyTeamSummary(summary));
 checkBucket(summary.total,states,mode);
 for(const row of summary.scores)checkBucket(row,states.filter(s=>s.points===row.points),mode);
 summary.matches.forEach((m,i)=>m.scores.forEach(row=>checkBucket(row,states.filter(s=>s.scores[i][0]===row.homePoints&&s.scores[i][1]===row.awayPoints),mode,false)));
 const exact=calculate(input),bounds=boundsOf(exact);for(let i=0;i<6;i++){assert.equal(BigInt(summary.total.rankLower[i])*BigInt(exact.denominator),BigInt(bounds.lower[0][i])*BigInt(summary.denominator));assert.equal(BigInt(summary.total.rankUpper[i])*BigInt(exact.denominator),BigInt(bounds.upper[0][i])*BigInt(summary.denominator));}
 const plain=calculateTeamSummary(input,'a',()=>{},{optimize:false});assert.deepEqual({...summary,visited:0},{...plain,visited:0});
 }
});
test('uniform-rank subtrees retain score distributions and match correlations without visiting leaves',()=>{
 const input={...base,mode:'rounds',points:[350,50,60,40,30,20]},states=oracle(input),result=calculateTeamSummary(input,'a');assert.equal(result.visited,1);assert(verifyTeamSummary(result));checkBucket(result.total,states,input.mode);for(const s of result.scores)checkBucket(s,states.filter(r=>r.points===s.points),input.mode);
 result.matches.forEach((m,i)=>m.scores.forEach(s=>checkBucket(s,states.filter(r=>r.scores[i][0]===s.homePoints&&r.scores[i][1]===s.awayPoints),input.mode,false)));
});
test('BigInt weights, restricted score supports and no remaining matches are exact',()=>{
 for(const mode of ['points','battles','rounds']){
 const input={...base,mode,matches:base.matches.map(m=>({...m,outcomes:m.outcomes.slice(0,2).map(o=>[o[0],o[1],String(BigInt(o[2])*(2n**80n)),o[3],o[4]])}))},states=oracle(input),result=calculateTeamSummary(input,'a');assert(verifyTeamSummary(result));checkBucket(result.total,states,mode);
 const tied=calculateTeamSummary({...input,points:Array(6).fill(10),battleDiffs:Array(6).fill(0),roundDiffs:Array(6).fill(0),matches:[]},'a');assert(verifyTeamSummary(tied));assert.equal(tied.total.patterns,'1');assert.deepEqual(tied.total.rankPatternsLower,Array(6).fill('0'));assert.deepEqual(tied.total.rankPatternsUpper,Array(6).fill('1'));assert.equal(tied.total.goalLower[2],mode==='points'?'30':'0');assert.equal(tied.total.goalUpper[2],mode==='points'?'30':'60');
 }
});
test('summary validation rejects corrupted weighted mass and pattern counts',()=>{
 const r=calculateTeamSummary({...base,mode:'points'},'a');
 for(const change of [r=>r.scores[0].mass='0',r=>r.matches[0].scores[0].goalLower[0]='99999999',r=>r.total.patterns='1',r=>r.scores[0].rankPatternsUpper[0]='99999999']){const copy=structuredClone(r);change(copy);assert(!verifyTeamSummary(copy));}
});
