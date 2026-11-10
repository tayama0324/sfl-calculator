import {renderProbabilityChart} from './probability-chart.js';
import {rulesFor,ruleText} from './match-assumptions.js';
import { CONDITION_MODES, EXPLORATION_MODES, rankingLabel, boundsOf, formatPercent, formatRange, formatDifference, verifyFractions, remaining, resolveMatch } from './model.js';
import { renderMonteCarlo } from './monte-carlo-ui.js';
export const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function modeNotice(mode,method='exact') {
  const lead = `<b>${rankingLabel(mode,method)}${method==='monteCarlo'?' · モンテカルロ推定':''}</b>　`;
  if (mode === 'battles') return lead+'各バトルの勝率は50%、独立と仮定します。ポイント→バトル差で比較し、残る同点は順位・PO確率の上下限で表示します。ラウンド差は比較しません。';
  if (mode === 'rounds') return lead+'各ラウンドの勝率は50%、独立と仮定します。ポイント→バトル差→ラウンド差で比較します。完全一致は競技細則に従い追加タイブレーク戦で順位を決めます。本ツールでは追加戦の勝敗を抽選せず、上下限で表示します。';
  return lead+'各プレイヤーマッチの勝率は50%。同ポイントは占有順位に均等配分します。公式のバトル差・ラウンド差による順位は反映しません。';
}
export function renderCases(d) {
  return `<section class="panel result-panel"><div class="section-heading"><div><div class="kicker">02 / COMPARISON CASES</div><h2>シナリオ比較ケース</h2></div><button id="add-case" class="tiny-button">ケースを追加 ＋</button></div><div class="data-note">基準ケースはチーム条件なし。下の日程で指定する固定スコアは、基準を含む全ケースに共通です。固定スコア → 各ケースの条件の順に優先します。</div><div class="case-list">${d.cases.map(c=>`<article class="case-card"><div class="case-heading"><label>ケース名<input id="name-${c.id}" data-case-name="${c.id}" value="${escape(c.name)}" maxlength="80" required></label><button class="tiny-button danger-button" data-delete-case="${c.id}">ケースを削除</button></div>${c.conditions.map((condition,i)=>`<div class="condition-row"><span class="priority-number">${i+1}</span><span>残り全試合で</span><label class="inline-label"><span class="visually-hidden">対象チーム</span><select id="team-${c.id}-${i}" data-condition-team="${c.id}" data-index="${i}">${d.teams.map(t=>`<option value="${t.id}" ${condition.targetTeamId===t.id?'selected':''}>${escape(t.shortName)}</option>`).join('')}</select></label><span>が</span><label class="inline-label"><span class="visually-hidden">達成条件</span><select id="condition-${c.id}-${i}" data-condition-mode="${c.id}" data-index="${i}">${Object.entries(CONDITION_MODES).map(([id,name])=>`<option value="${id}" ${condition.mode===id?'selected':''}>${name}</option>`).join('')}</select></label><div class="condition-actions"><button class="tiny-button" data-move-condition="${c.id}" data-index="${i}" data-direction="-1" ${i===0?'disabled':''} aria-label="条件${i+1}を上へ">↑</button><button class="tiny-button" data-move-condition="${c.id}" data-index="${i}" data-direction="1" ${i===c.conditions.length-1?'disabled':''} aria-label="条件${i+1}を下へ">↓</button><button class="tiny-button secondary-button" data-delete-condition="${c.id}" data-index="${i}">削除</button></div></div>`).join('')}${c.conditions.length?'':'<p class="muted">条件なし。基準ケースと同じ分布になります。</p>'}<button class="tiny-button secondary-button" data-add-condition="${c.id}">条件を追加 ＋</button>${renderAudit(d,c,remaining(d).map(m=>({...m,matchId:m.id,...resolveMatch(m,d.fixedScores,c.conditions)})))}</article>`).join('')}${d.cases.length?'':'<p class="muted">比較ケースなし。基準ケースのみ計算します。</p>'}</div><div class="panel-foot">矛盾した後続条件は、その試合だけスキップします。有効な条件と例外は、計算結果で確認できます。</div></section>`;
}
function conditionDescription(d,definition,normalSearch=false) {
  if (!definition.conditions.length) return normalSearch?'通常状態：将来の仮定・試合別固定を適用しません。':'チーム条件なし（共通の試合別固定は適用）';
  return definition.conditions.map((c,i)=>`${i+1}. 残り全試合で${d.teams.find(t=>t.id===c.targetTeamId).name}が${CONDITION_MODES[c.mode]}`).join(' → ');
}
export function renderAudit(d,definition,resolution,{normalSearch=false}={}) {
  const short = id=>escape(d.teams.find(t=>t.id===id).shortName);
  const matchLabel = m=>`第${m.round}節 ${short(m.homeTeamId)}（H）対${short(m.awayTeamId)}（A）`;
  return `<details class="audit-details"><summary>実際の適用条件・例外を確認</summary><p class="muted">${escape(conditionDescription(d,definition,normalSearch))}</p>${definition.conditions.map((c,i)=>{
    const records=resolution.flatMap(m=>m.audit.filter(a=>a.conditionIndex===i).map(a=>({m,a})));
    const skipped=records.filter(x=>x.a.status==='skipped');
    const applied=records.filter(x=>x.a.status!=='skipped');
    const status=!records.length?'対象試合なし':!applied.length?'適用試合なし':`対象${records.length}試合中${applied.length}試合に適用${skipped.length?'（例外あり）':''}`;
    return `<div class="audit-condition"><b>条件${i+1}：${short(c.targetTeamId)}が${CONDITION_MODES[c.mode]}</b><span class="tag ${skipped.length?'stale':''}">${status}</span>${skipped.map(({m,a})=>`<p class="audit-skip">スキップ：${matchLabel(m)}<br>優先された指定：${a.prioritized.map(p=>p.type==='fixed'?`固定スコア ${escape(p.score)}`:`条件${p.index+1}`).join('、')}</p>`).join('')}</div>`;
  }).join('')}<div class="scroll-table"><table><thead><tr><th>試合</th><th>有効なポイントスコア（H–A）</th><th>適用した仮定（AND）</th></tr></thead><tbody>${resolution.map(m=>`<tr><td>${matchLabel(m)}</td><td>${m.allowedScores.map(escape).join(' / ')}</td><td>${m.rules?.length?m.rules.map(r=>escape(ruleText(r,d.teams.find(t=>t.id===m.homeTeamId).shortName,d.teams.find(t=>t.id===m.awayTeamId).shortName))).join('<br>かつ '):`バトル ${m.fixedDetails?.battleDiff??'未指定'} / ラウンド ${m.fixedDetails?.roundDiff??'未指定'}`}</td></tr>`).join('')}</tbody></table></div><p class="muted">上記の有効スコアの条件下で集計しています。詳細モードでは、同じポイントスコアのバトル差・ラウンド差も探索します。</p></details>`;
}
export function rankTable(d,entry) {
  const r=entry.result,b=boundsOf(r),den=r.denominator;
  return `<div class="scroll-table"><table aria-label="${escape(entry.name)}の順位確率"><thead><tr><th>チーム</th>${[1,2,3,4,5,6].map(n=>`<th>${n}位</th>`).join('')}<th class="po-cell">PO進出</th>${r.kind==='intervals'?`<th>${r.mode==='rounds'?'全項目一致（追加戦次第）':'未探索のラウンド差による同点'}</th><th>PO境界の同点</th>`:''}</tr></thead><tbody>${r.teamIds.map((id,i)=>`<tr><td class="team-name">${escape(d.teams.find(t=>t.id===id).shortName)}</td>${b.lower[i].map((n,j)=>`<td class="probability" title="厳密値：${n} ～ ${b.upper[i][j]} / ${den}">${formatRange(n,b.upper[i][j],den)}</td>`).join('')}<td class="po-cell probability" title="厳密値：${b.poLower[i]} ～ ${b.poUpper[i]} / ${den}">${formatRange(b.poLower[i],b.poUpper[i],den)}</td>${r.kind==='intervals'?`<td>${formatPercent(r.unresolved[i],den)}</td><td>${formatPercent(r.borderTies[i],den)}</td>`:''}</tr>`).join('')}</tbody></table></div>`;
}
export function renderComparison(saved,d) {
  if(saved?.method==='monteCarlo')return renderMonteCarlo(saved,d,{escape,renderAudit});
  if (!saved) return `<div class="empty-state"><div class="empty-symbol" aria-hidden="true">▥</div><p>条件の先にある順位を、ケースごとに比較。</p><small>探索モードと条件を設定して「順位確率を計算」を押してください。</small></div>`;
  const snapshot=saved.input, entries=saved.entries;
  const baseline=entries.find(e=>e.id==='baseline');
  const stale=JSON.stringify(d)!==saved.fingerprint;
  const complete=entries.filter(e=>e.status==='done').length;
  const status={pending:'未計算',running:'計算中',cancelled:'中止',error:'エラー',done:'完了'};
  return `<div class="result-context">${stale?'<span class="tag stale">変更前の入力による結果</span> ':''}${escape(EXPLORATION_MODES[snapshot.explorationMode])} · ${complete}/${entries.length}ケース完了<br>共通固定スコア ${Object.keys(snapshot.fixedScores).length}試合 · ${escape(saved.startedAt)}開始</div>
  <div class="scroll-table"><table class="comparison-table" aria-label="ケース別PO進出確率"><thead><tr><th>チーム</th>${entries.map(e=>`<th>${escape(e.name)}<br><small>${status[e.status]}</small></th>`).join('')}</tr></thead><tbody>${snapshot.teams.map((t,i)=>`<tr><td class="team-name">${escape(t.shortName)}</td>${entries.map(e=>{
    if(e.status!=='done')return `<td class="muted">${status[e.status]}</td>`;
    const b=boundsOf(e.result), resultIndex=e.result.teamIds.indexOf(t.id);
    return `<td class="po-cell">${formatRange(b.poLower[resultIndex],b.poUpper[resultIndex],e.result.denominator)}${e.id!=='baseline'&&baseline.status==='done'?`<div class="comparison-delta">基準差 ${formatDifference(e.result,baseline.result,resultIndex)}</div>`:''}</td>`;
  }).join('')}</tr>`).join('')}</tbody></table></div><div class="panel-foot">PO進出確率を比較。差の単位はパーセントポイント。範囲の差は保守的な上下限です。未完了ケースの部分集計は表示しません。</div>
  ${entries.map(e=>`<details class="case-result" id="result-${e.id}" ${e.id==='baseline'?'open':''}><summary><b>${escape(e.name)}</b> <span class="tag">${status[e.status]}</span></summary>${e.status==='done'?`<div class="result-context">${e.seconds.toFixed(2)}秒 · ${BigInt(e.result.processed).toLocaleString()}通りの集約状態を厳密集計${e.reused?' · 同一条件の結果を再利用':''} · <span class="check-badge">${verifyFractions(e.result).ok?'✓ 検算済み':'検算エラー'}</span></div>${rankTable(snapshot,e)}${renderAudit(snapshot,e.definition,e.resolution)}`:`<p class="muted">${status[e.status]}。完了したケースのみ結果を表示します。</p>`}</details>`).join('')}
  <div class="panel-foot">${snapshot.explorationMode==='points'?'同ポイントの均等配分を含む簡易モデルです。':'残る同点は自動配分しません。上下限は未解決の順序を特定しない保守的な範囲です。各セルの上下限を同時に達成できるとは限りません。'} 表示時だけ丸めます。</div>`;
}

// The simple screen always shows the baseline; legacy comparison rendering and
// saved case definitions remain available for older exports and engine callers.
export function renderProbability(saved,d) {
  if(saved?.method==='monteCarlo')return renderMonteCarlo(saved,d,{escape,renderAudit,simple:true});
  if(!saved)return '<div class="empty-state"><div class="empty-symbol" aria-hidden="true">↗</div><p>ここに、各チームの1位・PO進出の確率が表示されます。</p><small>上の入力を確認して「順位確率を計算」を押してください。</small></div>';
  const entry=saved.entries.find(e=>e.id==='baseline'),stale=JSON.stringify(d)!==saved.fingerprint;
  const heading=`<div class="result-context">${stale?'<span class="tag stale">変更前の入力による結果</span> ':''}${escape(rankingLabel(saved.input.explorationMode))} · 仮定 ${remaining(saved.input).filter(m=>rulesFor(saved.input,m.id).length).length}試合</div>`;
  if(entry.status!=='done')return heading+`<div class="empty-state"><p>${{pending:'計算待ち',running:'計算中です',cancelled:'計算を中止しました',error:'計算に失敗しました'}[entry.status]}</p><small>完了後に確率を表示します。</small></div>`;
  const r=entry.result,b=boundsOf(r);
  return heading+renderProbabilityChart(saved.input,r)+`<details id="probability-table"><summary>数値を表で見る</summary><div class="scroll-table"><table class="outcome-table" aria-label="1位とPO進出の確率"><thead><tr><th>チーム</th><th>1位通過</th><th>PO進出 <small>3位以内</small></th></tr></thead><tbody>${saved.input.teams.map(t=>{const i=r.teamIds.indexOf(t.id);return `<tr><td class="team-name">${escape(t.name)}</td><td>${formatRange(b.lower[i][0],b.upper[i][0],r.denominator)}</td><td class="po-cell">${formatRange(b.poLower[i],b.poUpper[i],r.denominator)}</td></tr>`;}).join('')}</tbody></table></div><p class="result-explanation">${r.kind==='intervals'?'幅のある数値は、同点の決着によって変わる確率の下限〜上限です。':'同ポイントのチームは順位を均等に分けたモデルです。'} 入力した仮定が成立した場合の確率です。</p><details id="rank-details"><summary>1〜6位の内訳・計算の詳細</summary>${rankTable(saved.input,entry)}<p class="muted">${entry.seconds.toFixed(2)}秒 · 検算済み</p>${renderAudit(saved.input,entry.definition,entry.resolution)}</details></details>`;
}
