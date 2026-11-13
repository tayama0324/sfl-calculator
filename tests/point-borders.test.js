import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate} from '../docs/js/engine.js';
function oracle(input){
  const totals=[...input.points],first=[],third=[];
  function visit(depth){
    if(depth===input.matches.length){const ordered=[...totals].sort((a,b)=>b-a);first.push(ordered[0]);third.push(ordered[2]);return;}
    const m=input.matches[depth];for(const [h,a]of m.outcomes){totals[m.home]+=h;totals[m.away]+=a;visit(depth+1);totals[m.home]-=h;totals[m.away]-=a;}
  }
  visit(0);return {first:{min:Math.min(...first),max:Math.max(...first)},playoff:{min:Math.min(...third),max:Math.max(...third)}};
}
const base={teamIds:['a','b','c','d','e','f'],points:[100,90,80,70,60,50],battleDiffs:[0,1,-1,2,-2,0],roundDiffs:[0,2,-2,3,-3,0],matches:[{home:0,away:5,outcomes:[[40,0,1,4,8],[0,40,2,-4,-8]]},{home:1,away:2,outcomes:[[30,20,1,1,2],[10,30,2,-2,-4]]},{home:3,away:4,outcomes:[[30,10,2,2,4],[0,40,1,-4,-8]]}]};
test('point borders agree with independent enumeration across points, weighted points, battles and rounds',()=>{
  for(const mode of ['points','battles','rounds'])for(const weighted of [false,true]){
    const input=structuredClone({...base,mode});if(weighted)for(const m of input.matches)for(const o of m.outcomes)o[2]='17';
    assert.deepEqual(calculate(input).pointBorders,oracle(input));
  }
});
test('collapsed detailed subtrees retain attainable point extrema without enumerating their leaves',()=>{
  const input={...base,mode:'battles',points:[350,270,190,110,40,0]};
  const result=calculate(input);assert(BigInt(result.collapsed)>0n);assert.deepEqual(result.pointBorders,oracle(input));
});
test('no remaining matches and tied ranks have a single point border',()=>{
  for(const mode of ['points','battles','rounds']){
    const input={...base,mode,points:[100,100,100,100,50,50],matches:[]};
    assert.deepEqual(calculate(input).pointBorders,{first:{min:100,max:100},playoff:{min:100,max:100}});
  }
});
