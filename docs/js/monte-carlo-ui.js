import {renderProbabilityChart} from './probability-chart.js';
import { BASE_CASE, prepare, rankingLabel, formatPercent, verifyFractions } from './model.js';
import { checkpointResults, confidenceInterval, simulationFingerprint } from './monte-carlo.js';
const pct=n=>`${n!==0&&Math.abs(n*100)<.0001?(n*100).toExponential(4):(n*100).toFixed(4)}%`;
const delta=n=>`${n>0?'+':n<0?'−':''}${pct(Math.abs(n)).replace(/%$/,'')}ポイント`;
export function estimateText(n,N) {
  const value=BigInt(n),den=BigInt(N)*60n;
  if(!N)return '未試行';
  if(value===0n)return `観測なし／${N.toLocaleString()}試行`;
  if(value===den)return `全${N.toLocaleString()}試行で観測`;
  return `推定 ${formatPercent(value,den)}`;
}
function intervalText(n,N,difference=false) {
  const c=confidenceInterval(n,N,{difference});
  if(!c)return '未試行';
  const f=difference?delta:pct;
  return `${f(c.lower)} ～ ${f(c.upper)}`;
}
function cell(lower,upper,N) {
  const single=lower===upper;
  return `<div class="mc-estimate">${single?estimateText(lower,N):`<span class="muted">同点による範囲</span><br>${estimateText(lower,N)} ～ ${estimateText(upper,N)}`}</div><div class="confidence">${single?'個別95%区間':'下限の個別95%区間'}：${intervalText(lower,N)}${single?'':`<br>上限の個別95%区間：${intervalText(upper,N)}`}</div>`;
}
function differenceCell(record,N) {
  const den=Number(BigInt(N)*60n),lo=record.deltaLower,hi=record.deltaUpper;
  return i=>{
    const same=lo[i]===hi[i];
    return `<div class="comparison-delta">基準差 ${same?delta(Number(BigInt(lo[i]))/den):`${delta(Number(BigInt(lo[i]))/den)} ～ ${delta(Number(BigInt(hi[i]))/den)}`}</div><div class="confidence">${same?'差の個別95%区間':'差の下限の個別95%区間'}：${intervalText(lo[i],N,true)}${same?'':`<br>差の上限の個別95%区間：${intervalText(hi[i],N,true)}`}</div>`;
  };
}
export function renderMonteCarlo(saved,d,{escape,renderAudit,simple=false}) {
  const cp=saved.checkpoint,snapshot=saved.input;
  const stale=simulationFingerprint(d)!==cp.fingerprint,N=cp.completed;
  const header=`<div class="result-context">${stale?'<span class="tag stale">変更前の入力による結果</span> ':''}<span class="tag">モンテカルロ推定</span> ${escape(rankingLabel(snapshot.explorationMode,'monteCarlo'))} · ${N.toLocaleString()}試行<br>シード <code class="seed-display">${escape(snapshot.simulation.seed)}</code> · ${escape(saved.status==='running'?'実行中':saved.status==='stopped'?'中止・途中結果を保持':saved.status==='restored'?'チェックポイントから復元':saved.status==='error'?'異常停止・最後の受領済み集計':'指定試行数に到達')}</div>`;
  if(!N)return header+'<div class="empty-state"><p>完了した試行はまだありません。</p><small>全ケースが揃った試行から結果を表示します。</small></div>';
  if(simple)return renderSimpleMonteCarlo(saved,d,{escape,renderAudit},header);
  const definitions=[BASE_CASE,...snapshot.cases],results=checkpointResults(cp),teamIds=results[0].teamIds;
  const summary=`<div class="scroll-table"><table class="comparison-table mc-table" aria-label="モンテカルロによるPO進出確率"><thead><tr><th>チーム</th>${definitions.map(c=>`<th>${escape(c.name)}<br><small>推定PO進出確率</small></th>`).join('')}</tr></thead><tbody>${snapshot.teams.map(t=>{
    const i=teamIds.indexOf(t.id);
    return `<tr><td class="team-name">${escape(t.shortName)}</td>${cp.records.map((r,index)=>`<td>${cell(r.poLower[i],r.poUpper[i],N)}${index?differenceCell(r,N)(i):''}</td>`).join('')}</tr>`;
  }).join('')}</tbody></table></div>`;
  const ranks=definitions.map((definition,index)=>{
    const record=cp.records[index],result=results[index],resolution=saved.resolutions?.[index]??prepare(snapshot,definition).resolution;
    return `<details class="case-result" id="result-${definition.id}" ${index===0?'open':''}><summary><b>${escape(definition.name)}</b> <span class="tag">${N.toLocaleString()}試行時点</span></summary><div class="result-context"><span class="check-badge">${verifyFractions(result).ok?'✓ 集計の保存則を検算済み':'検算エラー'}</span></div><div class="scroll-table"><table class="mc-table" aria-label="${escape(definition.name)}の順位推定"><thead><tr><th>チーム</th>${[1,2,3,4,5,6].map(n=>`<th>${n}位</th>`).join('')}<th>PO進出</th>${snapshot.explorationMode==='points'?'':`<th>${snapshot.explorationMode==='rounds'?'全項目一致（追加戦次第）':'未探索のラウンド差による同点'}</th><th>PO境界の同点</th>`}</tr></thead><tbody>${teamIds.map((id,i)=>`<tr><td class="team-name">${escape(snapshot.teams.find(t=>t.id===id).shortName)}</td>${Array.from({length:6},(_,j)=>`<td>${cell(record.lowerRanks[i*6+j],record.upperRanks[i*6+j],N)}</td>`).join('')}<td>${cell(record.poLower[i],record.poUpper[i],N)}</td>${snapshot.explorationMode==='points'?'':`<td>${cell(record.unresolved[i],record.unresolved[i],N)}</td><td>${cell(record.borderTies[i],record.borderTies[i],N)}</td>`}</tr>`).join('')}</tbody></table></div>${renderAudit(snapshot,definition,resolution)}</details>`;
  }).join('');
  return header+summary+`<div class="panel-foot">同点による範囲と、有限試行による統計的な区間は別のものです。95%区間は反復確認・中止・追加試行に対応する保守的な区間で、各指標・各端点ごとの保証です。全チーム・全ケースを同時に95%保証するものではありません。未観測は確率0、全試行での観測は確率1を確定しません。</div>`+ranks;
}

function renderSimpleMonteCarlo(saved,d,{escape,renderAudit},header){
  const cp=saved.checkpoint,N=cp.completed,r=cp.records[0],snapshot=cp.division;
  const result=checkpointResults(cp)[0],ids=result.teamIds;
  return header+renderProbabilityChart(snapshot,result,{completed:N})+`<details id="probability-table"><summary>数値を表で見る</summary><div class="scroll-table"><table class="outcome-table mc-summary" aria-label="1位とPO進出の推定確率"><thead><tr><th>チーム</th><th>1位通過</th><th>PO進出 <small>3位以内</small></th></tr></thead><tbody>${snapshot.teams.map(t=>{const i=ids.indexOf(t.id);return `<tr><td class="team-name">${escape(t.shortName)}</td><td>${cell(r.lowerRanks[i*6],r.upperRanks[i*6],N)}</td><td>${cell(r.poLower[i],r.poUpper[i],N)}</td></tr>`;}).join('')}</tbody></table></div><p class="result-explanation">同点による幅と、試行数による推定誤差（個別95%区間）を分けて表示しています。観測なしでも確率0%とは限りません。</p><details id="rank-details"><summary>1〜6位の内訳・推定の詳細</summary><div class="scroll-table"><table class="mc-table"><thead><tr><th>チーム</th>${[1,2,3,4,5,6].map(n=>`<th>${n}位</th>`).join('')}</tr></thead><tbody>${ids.map((id,i)=>`<tr><td class="team-name">${escape(snapshot.teams.find(t=>t.id===id).shortName)}</td>${Array.from({length:6},(_,j)=>`<td>${cell(r.lowerRanks[i*6+j],r.upperRanks[i*6+j],N)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="muted">95%区間は途中確認・中止・追加試行に対応する保守的な区間です。全チーム・全指標を同時に保証するものではありません。全試行での観測も確率100%の保証ではありません。</p>${renderAudit(snapshot,BASE_CASE,saved.resolutions?.[0]??prepare(snapshot,BASE_CASE).resolution)}</details></details>`;
}
