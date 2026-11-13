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
  const [icon,label]={normal:['🟢','小規模'],notice:['🟠','大規模'],warning:['🔴','超大規模']}[c.level];
  return `<p class="cost-estimate ${c.level}" role="note"><span title="${label}" aria-label="${label}">${icon}</span> ${readableInteger(c.total)}通り${!conditionSearch&&c.level==='warning'&&d.calculationMethod!=='monteCarlo'?'<span class="cost-suggestion"> — モンテカルロの利用をおすすめします。</span>':''}</p>`;
}
