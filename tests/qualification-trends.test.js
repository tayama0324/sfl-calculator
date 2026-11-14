import test from 'node:test';import assert from 'node:assert/strict';
import {calculateTeamSummary} from '../docs/js/team-summary.js';
import {qualificationTrends} from '../docs/js/qualification-trends.js';
import {renderQualificationTrends,renderQualificationTrendBody} from '../docs/js/qualification-trends-ui.js';
const input={mode:'points',teamIds:['a','b','c','d','e','f'],points:[30,0,0,0,0,0],battleDiffs:Array(6).fill(0),roundDiffs:Array(6).fill(0),matches:[{id:'other',home:1,away:2,outcomes:[[40,0,1,4,8],[30,10,2,2,4],[30,20,1,1,2],[20,30,1,-1,-2],[10,30,2,-2,-4],[0,40,1,-4,-8]]}]};
const division={teams:input.teamIds.map(id=>({id,shortName:id})),fixtures:[{id:'other',round:9,homeTeamId:'b',awayTeamId:'c'}]};
test('reverse conditioning uses qualification mass, including fractional point ties',()=>{
 const summary=calculateTeamSummary(input,'a'),copy=JSON.stringify(summary),result=qualificationTrends(summary,division,{goal:0});
 assert.equal(result.status,'ready');assert.equal(result.qualified,'180');assert.equal(result.denominator,'480');
 const row=result.matches[0].scores.find(s=>s.homePoints===30&&s.awayPoints===10);
 assert.equal(row.mass,'120');assert.equal(row.qualifiedMass,'60'); // 1/3 among successes; 1/2 is the inverse conditional.
 assert.equal(BigInt(row.delta)*12n,BigInt(result.matches[0].deltaDenominator));
 assert.equal(result.matches[0].scores.reduce((n,s)=>n+BigInt(s.qualifiedMass),0n),BigInt(result.qualified));
 assert.equal(JSON.stringify(summary),copy);
 const html=renderQualificationTrendBody(summary,division,{goal:0});assert.match(html,/30 – 10<\/th><td>25\.00%<\/td><td>33\.33%<\/td><td>\+8\.33pt/);
});
test('detailed modes include only certain successes and distinguish zero eligible cases from impossibility',()=>{
 const unresolved=calculateTeamSummary({...input,mode:'battles',matches:input.matches.map(m=>({...m,outcomes:m.outcomes.map(o=>[o[0],o[1],o[2],0,0])}))},'a');
 assert.equal(qualificationTrends(unresolved,division,{goal:0}).status,'no-definite-cases');
 assert.match(renderQualificationTrendBody(unresolved,division,{goal:0}),/確定するケースはありません/);
 const impossible=calculateTeamSummary({...input,points:[0,100,100,100,100,100]},'a');assert.equal(qualificationTrends(impossible,division,{goal:2}).status,'impossible');
 const sure=calculateTeamSummary({...input,mode:'rounds',battleDiffs:[10,0,0,0,0,0]},'a'),trends=qualificationTrends(sure,division,{goal:0});assert(trends.definiteOnly);assert.equal(trends.qualified,sure.total.goalLower[0]);assert.match(renderQualificationTrendBody(sure,division,{goal:0}),/1位通過確定時/);
});
test('own fixtures are optional, unchanged distributions sort last, and large weights retain exact comparisons',()=>{
 const summary=calculateTeamSummary(input,'a');summary.matches.unshift({matchId:'neutral',home:3,away:4,scores:[{homePoints:40,awayPoints:0,mass:'240',goalLower:['90','240','240'],goalUpper:['90','240','240']},{homePoints:0,awayPoints:40,mass:'240',goalLower:['90','240','240'],goalUpper:['90','240','240']}]});summary.matches.push({...structuredClone(summary.matches[1]),matchId:'own',home:0,away:1});
 assert.deepEqual(qualificationTrends(summary,division,{goal:0}).matches.map(m=>m.matchId),['other','neutral']);
 assert.deepEqual(qualificationTrends(summary,division,{goal:0,includeOwn:true}).matches.map(m=>m.matchId),['other','own','neutral']);
 const large=structuredClone(summary),scale=2n**100n;large.denominator=String(BigInt(large.denominator)*scale);for(const b of [large.total,...large.matches.flatMap(m=>m.scores)])for(const f of ['mass','goalLower','goalUpper'])b[f]=Array.isArray(b[f])?b[f].map(n=>String(BigInt(n)*scale)):String(BigInt(b[f])*scale);
 const t=qualificationTrends(large,division,{goal:0});assert.deepEqual(t.matches.map(m=>m.matchId),['other','neutral']);assert.equal(BigInt(t.matches[0].distance),BigInt(qualificationTrends(summary,division,{goal:0}).matches[0].distance)*scale*scale);
});
test('empty schedules, only own matches, controls and escaped team names are handled',()=>{
 const own={...input,points:[100,0,0,0,0,0],matches:[{...input.matches[0],home:0,away:1}]},summary=calculateTeamSummary(own,'a');
 assert.equal(qualificationTrends(summary,division).status,'no-other-matches');assert.equal(qualificationTrends(calculateTeamSummary({...own,matches:[]},'a'),division).status,'no-matches');
 const d=structuredClone(division);d.teams[1].shortName='<img onerror=x>';const html=renderQualificationTrends(calculateTeamSummary(input,'a'),d,{goal:0,includeOwn:true});assert(html.includes('&lt;img'));assert(!html.includes('<img'));assert(html.includes('value="0" selected'));assert(html.includes('id="trend-include-own" checked'));assert(!html.includes('id="qualification-trends" open'));
 assert.throws(()=>qualificationTrends(summary,division,{goal:3}));
});
