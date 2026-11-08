import {matchDistribution} from './distributions.js';
import {remaining} from './model.js';
export const COST_THRESHOLDS={notice:100000000n,warning:1000000000000n};
export function costLevel(n){n=BigInt(n);return n>=COST_THRESHOLDS.warning?'warning':n>=COST_THRESHOLDS.notice?'notice':'normal';}
export function exhaustiveCost(d,mode=d.explorationMode,cases=1+d.cases.length){
  if(!['points','battles','rounds'].includes(mode)||!Number.isSafeInteger(cases)||cases<1)throw new Error('計算量の設定が不正です。');
  const matches=remaining(d).length,states=mode==='points'?6:matchDistribution(mode).outcomes.length;
  const perCase=BigInt(states)**BigInt(matches),total=perCase*BigInt(cases);
  return {matches,states,cases,perCase:String(perCase),total:String(total),level:costLevel(total)};
}
export function readableInteger(n){
  const s=String(n);if(s.length<=16)return BigInt(s).toLocaleString();
  return `${s[0]}.${s.slice(1,5)} × 10^${s.length-1}（${s.length}桁）`;
}
export function renderCost(d,{mode=d.explorationMode,cases=1+d.cases.length,conditionSearch=false}={}){
  const c=exhaustiveCost(d,mode,cases);
  return `<div class="cost-estimate ${c.level}" role="note"><b>条件未適用の参考組合せ数</b><p>${c.matches}試合 × 1試合${c.states}状態<br>1ケース：${readableInteger(c.perCase)}<br>${c.cases}ケースの合計上限：${readableInteger(c.total)}</p><details><summary>完全な整数を表示</summary><code>${c.total}</code></details>${c.level==='normal'?'':`<p class="cost-warning">${c.level==='warning'?'非常に大規模です。現実的な時間で終わらない可能性があります。':'計算に時間がかかる可能性があります。'}</p>`}<p class="muted">シナリオ・試合別固定・結果再利用・部分木集約を反映しない参考値です。実際の処理量は減る場合があります。所要時間・演算数の上限ではありません。</p>${!conditionSearch&&c.level!=='normal'?'<button id="cost-to-mc" class="tiny-button secondary-button">モンテカルロに切り替える</button>':''}</div>`;
}
