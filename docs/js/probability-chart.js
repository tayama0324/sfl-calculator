import {boundsOf,formatRange} from './model.js';
import {confidenceInterval} from './monte-carlo.js';
export const monteCarloPercent=(n,d)=>`${(Number(n)/Number(d)*100).toFixed(2)}%`;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Scale only the display; all probabilities and statistical intervals come from
// the same counts used by the numerical tables.
export function chartValues(result,i,metric,N=0){
  const b=boundsOf(result),lo=metric==='po'?b.poLower[i]:b.lower[i][Number(metric)],hi=metric==='po'?b.poUpper[i]:b.upper[i][Number(metric)];
  const percent=n=>Number(BigInt(n)*1000000n/BigInt(result.denominator))/10000;
  return {lower:percent(lo),upper:percent(hi),text:N?(BigInt(lo)===BigInt(hi)?monteCarloPercent(lo,result.denominator):`${monteCarloPercent(lo,result.denominator)} ～ ${monteCarloPercent(hi,result.denominator)}`):formatRange(lo,hi,result.denominator),lowerCI:N?confidenceInterval(lo,N):null,upperCI:N?confidenceInterval(hi,N):null};
}
function bar(v,N){
  const ci=(c,label)=>`<span class="chart-ci" style="left:${c.lower*100}%;width:${(c.upper-c.lower)*100}%" aria-hidden="true"></span><span class="chart-marker" style="left:${c.mean*100}%" aria-hidden="true"></span><span class="visually-hidden">${label}の個別95%区間 ${(c.lower*100).toFixed(2)}〜${(c.upper*100).toFixed(2)}%。</span>`;
  return `<div class="chart-track" aria-label="${esc((N?'推定 ':'')+v.text)}"><span class="chart-solid" style="width:${v.lower}%"></span><span class="chart-tie" style="left:${v.lower}%;width:${v.upper-v.lower}%"></span>${N?ci(v.lowerCI,'下限')+(v.lower!==v.upper?ci(v.upperCI,'上限'):''):''}</div><span class="chart-value">${N?'推定 ':''}${v.text}</span>`;
}
export function renderProbabilityChart(d,r,{completed=0}={}){
  const N=completed,teams=d.teams.map(t=>({...t,index:r.teamIds.indexOf(t.id)}));
  const rows=metric=>teams.map(t=>`<div class="chart-row"><b>${esc(t.shortName)}</b>${bar(chartValues(r,t.index,metric,N),N)}</div>`).join('');
  const stacked=r.kind!=='intervals'&&!N;
  const ranks=teams.map(t=>`<div class="chart-rank-team"><b>${esc(t.shortName)}</b>${stacked?`<div class="chart-stack" aria-label="${esc(t.shortName)}の順位内訳">${r.ranks[t.index].map((n,j)=>{const v=chartValues(r,t.index,j);return `<span class="rank-color-${j}" style="width:${v.lower}%" title="${j+1}位 ${v.text}">${v.lower>=8?`${j+1}位`:''}</span>`;}).join('')}</div><div class="chart-rank-values">${r.ranks[t.index].map((n,j)=>`<span><i class="rank-color-${j}"></i>${j+1}位 ${chartValues(r,t.index,j).text}</span>`).join('')}</div>`:Array.from({length:6},(_,j)=>`<div class="chart-row"><span>${j+1}位</span>${bar(chartValues(r,t.index,j,N),N)}</div>`).join('')}</div>`).join('');
  return `<section class="probability-chart" aria-label="順位確率のグラフ"><fieldset class="chart-tabs"><legend class="visually-hidden">表示する確率</legend>${[['po','PO進出確率'],['first','1位通過確率'],['ranks','順位の内訳']].map(([id,label])=>`<label><input type="radio" name="probability-chart" value="${id}" ${id==='po'?'checked':''}><span>${label}</span></label>`).join('')}</fieldset><details class="chart-help"><summary>グラフの読み方</summary><p class="chart-note">横軸はすべて0〜100%です。${N?'棒とマーカーは推定値、細線は各端点の個別95%区間です。未観測でも0%、全試行で観測しても100%とは確定しません。':'棒はモデル上の確率を表します。'} ${r.kind==='intervals'?'斜線は同点の決着による幅です。各順位の上限を足して100%にはできないため、順位別に表示します。':'同ポイントは順位を均等に配分したモデルです。'}</p></details><div class="chart-scale"><span>0%</span><span>50%</span><span>100%</span></div><div class="chart-pane" data-chart-pane="po">${rows('po')}</div><div class="chart-pane" data-chart-pane="first">${rows(0)}</div><div class="chart-pane" data-chart-pane="ranks">${ranks}</div></section>`;
}
