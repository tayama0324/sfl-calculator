import {pointBorders,recordPointBorder} from './point-borders.js';
// Exact weighted enumeration. Float64 is used only as a bounded integer buffer.
// Each path has weight <= 2^30. A buffer of 32768 paths contains at most
// 32768 * 2^30 * 60 = 2^51 units in any cell, below the exact integer limit 2^53.
// Each buffer is then added to a BigInt accumulator. No floating-point probability
// arithmetic is involved in counting paths or distributing ties.
import { calculateDetailed } from './detailed-engine.js?v=point-borders-1';
export function calculate(input, onProgress = () => {}) {
  if (input.mode && input.mode !== 'points') return calculateDetailed(input, onProgress);
  if(input.matches.some(m=>m.outcomes.some(([, ,w])=>![1,2].includes(w))))return calculateWeightedPoints(input,onProgress);
  return calculatePoints(input, onProgress);
}
function calculatePoints(input, onProgress = () => {}) {
  const { points: starting, matches, teamIds } = input;
  if (starting.length !== 6 || matches.length > 30 || starting.some(p => !Number.isSafeInteger(p) || p < 0 || p > 400)) throw new Error('計算入力が不正です。');
  for (const m of matches) {
    if (!Number.isInteger(m.home) || m.home < 0 || m.home >= 6 || !Number.isInteger(m.away) || m.away < 0 || m.away >= 6 || m.home === m.away || !m.outcomes.length || m.outcomes.some(([h, a, w]) => ![1, 2].includes(w) || !Number.isInteger(h) || !Number.isInteger(a))) throw new Error('試合候補が不正です。');
  }
  const points = [...starting], borders=pointBorders();
  const buffer = new Float64Array(36);
  const ranks = Array(36).fill(0n);
  const greater = new Int8Array(6);
  const ties = new Int8Array(6);
  let buffered = 0, processed = 0n;
  const total = matches.reduce((s, m) => s * BigInt(m.outcomes.length), 1n);
  const denominator = matches.reduce((s, m) => s * BigInt(m.outcomes.reduce((n, o) => n + o[2], 0)), 1n) * 60n;
  let lastReport = performance.now();
  function flush() {
    for (let i = 0; i < 36; i++) { ranks[i] += BigInt(buffer[i]); buffer[i] = 0; }
    processed += BigInt(buffered);
    buffered = 0;
    if (performance.now() - lastReport >= 250) {
      onProgress({ processed: processed.toString(), total: total.toString() });
      lastReport = performance.now();
    }
  }
  function visit(depth, weight) {
    if (depth < matches.length) {
      const m = matches[depth];
      for (const [h, a, w] of m.outcomes) {
        points[m.home] += h; points[m.away] += a;
        visit(depth + 1, weight * w);
        points[m.home] -= h; points[m.away] -= a;
      }
      return;
    }
    greater.fill(0); ties.fill(1);
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
      if (points[i] > points[j]) greater[j]++;
      else if (points[i] < points[j]) greater[i]++;
      else { ties[i]++; ties[j]++; }
    }
    for (let i = 0; i < 6; i++) {
      recordPointBorder(borders,greater[i],greater[i]+ties[i]-1,points[i]);
      const share = weight * (60 / ties[i]);
      for (let rank = greater[i]; rank < greater[i] + ties[i]; rank++) buffer[i * 6 + rank] += share;
    }
    if (++buffered === 32768) flush();
  }
  visit(0, 1);
  flush();
  onProgress({ processed: processed.toString(), total: total.toString() });
  return {
    kind: 'allocated', mode: 'points', pointBorders:borders,
    teamIds, denominator: denominator.toString(), processed: processed.toString(),
    ranks: Array.from({ length: 6 }, (_, t) => ranks.slice(t * 6, t * 6 + 6).map(String)),
  };
}

function calculateWeightedPoints(input,onProgress){
  const borders=pointBorders();
  const {matches,teamIds}=input,points=[...input.points],ranks=Array(36).fill(0n);
  if(points.length!==6||points.some(p=>!Number.isSafeInteger(p)||p<0||p>400)||matches.length>30)throw new Error('計算入力が不正です。');
  for(const m of matches)if(!Number.isInteger(m.home)||!Number.isInteger(m.away)||m.home<0||m.home>5||m.away<0||m.away>5||m.home===m.away||!m.outcomes.length||m.outcomes.some(([h,a,w])=>!Number.isInteger(h)||!Number.isInteger(a)||BigInt(w)<=0n))throw new Error('試合候補が不正です。');
  const total=matches.reduce((n,m)=>n*BigInt(m.outcomes.length),1n),denominator=matches.reduce((n,m)=>n*m.outcomes.reduce((s,o)=>s+BigInt(o[2]),0n),1n)*60n;
  let processed=0n,last=performance.now();
  function visit(depth,weight){
    if(depth<matches.length){const m=matches[depth];for(const [h,a,w]of m.outcomes){points[m.home]+=h;points[m.away]+=a;visit(depth+1,weight*BigInt(w));points[m.home]-=h;points[m.away]-=a;}return;}
    for(let i=0;i<6;i++){let higher=0,tied=0;for(const p of points){if(p>points[i])higher++;else if(p===points[i])tied++;}recordPointBorder(borders,higher,higher+tied-1,points[i]);for(let r=higher;r<higher+tied;r++)ranks[i*6+r]+=weight*(60n/BigInt(tied));}
    processed++;if(performance.now()-last>250){onProgress({processed:String(processed),total:String(total)});last=performance.now();}
  }
  onProgress({processed:'0',total:String(total)});visit(0,1n);onProgress({processed:String(processed),total:String(total)});
  return {kind:'allocated',mode:'points',pointBorders:borders,teamIds,denominator:String(denominator),processed:String(processed),ranks:Array.from({length:6},(_,i)=>ranks.slice(i*6,i*6+6).map(String))};
}
