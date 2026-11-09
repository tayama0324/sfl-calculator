// Conditions are upward-closed regions of per-match points, not a monotonicity
// assumption about rank. A region is safe only if it contains no bad outcome.
export const covers = (points, thresholds) => points.every((p,i)=>p>=thresholds[i]);
const order = (a,b) => a.reduce((n,x,i)=>n || x-b[i],0);
function minimal(vectors) {
  const result=[];
  for(const v of vectors.sort(order)) {
    if(result.some(q=>covers(v,q)))continue;
    for(let i=result.length-1;i>=0;i--)if(covers(result[i],v))result.splice(i,1);
    result.push(v);
  }
  return result;
}
export function analyzeMatchConditions(cells,matchCount) {
  const possible=cells.filter(c=>c.success!==null||c.unresolved!==null);
  const good=cells.filter(c=>c.success!==null);
  const bad=cells.filter(c=>c.failure!==null||c.unresolved!==null);
  const status=!possible.length?'impossible':!bad.length?'certain':!good.length?'possible-not-guaranteed':'conditional';
  if(!possible.length)return {status,necessary:null,necessaryWitnesses:[],sufficient:[]};
  const necessary=Array.from({length:matchCount},(_,i)=>possible.reduce((n,c)=>Math.min(n,c.points[i]),Infinity));
  const necessaryWitnesses=necessary.map((n,i)=>{const c=possible.find(c=>c.points[i]===n);return c.success??c.unresolved;});
  // Only maximal bad vectors need excluding: any threshold that admits a smaller
  // bad vector also admits a dominating one. Avoid enumerating all 5^M thresholds.
  const maximalBad=minimal(bad.map(c=>c.points.map(p=>-p))).map(v=>v.map(p=>-p));
  let candidates=good.length?[Array(matchCount).fill(0)]:[];
  for(const b of maximalBad) {
    const next=[];
    for(const q of candidates) {
      if(!covers(b,q)){next.push(q);continue;}
      for(let i=0;i<matchCount;i++)if(b[i]<40) {
        const higher=[...q];higher[i]=b[i]+10;
        if(good.some(c=>covers(c.points,higher)))next.push(higher);
      }
    }
    candidates=minimal(next);
    if(!candidates.length)break;
  }
  const sufficient=candidates.sort(order).map(thresholds=>({
    thresholds,
    witness:good.find(c=>covers(c.points,thresholds)).success,
    // Weakening any nonzero clause by one step must admit a counterexample.
    counterexamples:thresholds.flatMap((n,i)=>{
      if(!n)return [];
      const weaker=[...thresholds];weaker[i]-=10;
      const c=bad.find(c=>covers(c.points,weaker));
      if(!c)throw new Error('マッチ条件の最小性を確認できません。');
      return [{matchIndex:i,witness:c.failure??c.unresolved}];
    }),
  }));
  return {status,necessary,necessaryWitnesses,sufficient};
}
