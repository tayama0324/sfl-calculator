import {remaining,assumedMatch} from './model.js';
export const COST_THRESHOLDS={notice:100000000n,warning:1000000000000n};
export function costLevel(n){n=BigInt(n);return n>=COST_THRESHOLDS.warning?'warning':n>=COST_THRESHOLDS.notice?'notice':'normal';}
export function exhaustiveCost(d,mode=d.explorationMode,cases=1+d.cases.length){
  if(!['points','battles','rounds'].includes(mode)||!Number.isSafeInteger(cases)||cases<1)throw new Error('計算量の設定が不正です。');
  // Share the exact input filtering and projection used by prepare(), so the
  // estimate matches the progress denominator before subtree compression.
  const stateCounts=remaining(d).map(m=>assumedMatch(d,m,mode).outcomes.length);
  const matches=stateCounts.length,states=stateCounts.every(n=>n===stateCounts[0])?(stateCounts[0]??0):null;
  const perCase=stateCounts.reduce((n,count)=>n*BigInt(count),1n),total=perCase*BigInt(cases);
  return {matches,states,stateCounts,cases,perCase:String(perCase),total:String(total),level:costLevel(total)};
}
export function readableInteger(n){
  const s=String(n);if(s.length<=16)return BigInt(s).toLocaleString();
  return `${s[0]}.${s.slice(1,5)} × 10^${s.length-1}（${s.length}桁）`;
}
export function renderCost(d,{mode=d.explorationMode,cases=1+d.cases.length,conditionSearch=false}={}){
  const c=exhaustiveCost(d,mode,cases);
  const factors=new Map();for(const n of c.stateCounts)factors.set(n,(factors.get(n)??0)+1);
  const formula=[...factors].map(([n,count])=>count===1?String(n):`${n}<sup>${count}</sup>`).join(' × ')||'1';
  return `<div class="cost-estimate ${c.level}" role="note"><b>探索規模の目安：${readableInteger(c.total)}通り</b>${c.level==='normal'?'':`<p class="cost-warning">${c.level==='warning'?'非常に大規模です。現実的な時間で終わらない可能性があります。':'計算に時間がかかる可能性があります。'}</p>`}<details><summary>組合せ数の計算方法</summary><p>残り${c.matches}試合の状態数の積：${formula}${c.cases>1?` × ${c.cases}ケース`:''}</p><code>${c.total}</code><p class="muted">残り日程のスコア・得失点差の仮定を、選択した順位判定に合わせて反映しています。部分木の集約は反映していないため、実際の処理量は減る場合があります。所要時間・演算数の上限ではありません。</p></details>${!conditionSearch&&c.level!=='normal'?'<button id="cost-to-mc" class="tiny-button secondary-button">モンテカルロに切り替える</button>':''}</div>`;
}
