import test from 'node:test';import assert from 'node:assert/strict';
import {chartValues,renderProbabilityChart} from '../docs/js/probability-chart.js';
import {confidenceInterval} from '../docs/js/monte-carlo.js';
const d={teams:[{id:'a',shortName:'A<test>'}]};
const r={kind:'allocated',denominator:'6000',teamIds:['a'],ranks:[['600','1200','1800','1200','600','600']]};
test('chart maps team rank and PO counts to the same probabilities as tables',()=>{
 assert.equal(chartValues(r,0,'po').lower,60);assert.equal(chartValues(r,0,0).lower,10);
 const html=renderProbabilityChart(d,r);assert(html.includes('chart-stack'));assert(html.includes('A&lt;test&gt;'));assert(!html.includes('A<test>'));
});
test('unresolved ranks use separate intervals, never a misleading 100 percent stack',()=>{
 const intervals={kind:'intervals',denominator:'6000',teamIds:['a'],lowerRanks:[['0','0','0','0','0','0']],upperRanks:[['6000','6000','6000','6000','6000','6000']],poLower:['1200'],poUpper:['4800']};
 const v=chartValues(intervals,0,'po');assert.equal(v.lower,20);assert.equal(v.upper,80);
 const html=renderProbabilityChart(d,intervals);assert(!html.includes('class="chart-stack"'));assert(html.includes('left:20%;width:60%'));assert(html.includes('斜線'));
});
test('MC error bars use the existing confidence function even for zero and all observations',()=>{
 const v=chartValues(r,0,'po',100);assert.deepEqual(v.lowerCI,confidenceInterval('3600',100));
 for(const count of ['0','6000']){const result={...r,ranks:[[count,'0','0','0','0','0']]};const v=chartValues(result,0,0,100);assert(v.lowerCI.upper>v.lowerCI.lower);}
 const html=renderProbabilityChart(d,r,{completed:100});assert(html.includes('chart-ci'));assert(!html.includes('class="chart-stack"'));assert(html.includes('個別95%区間'));
});
