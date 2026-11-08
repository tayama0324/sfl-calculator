import {escape,renderAudit} from './comparison-ui.js';
import {rankingLabel} from './model.js';
import {SEARCH_GOALS} from './search-config.js';
import {prepareSearch,searchFingerprint,reconstructExample} from './condition-search.js';
import {renderCost} from './exhaustive-cost.js';
export const SEARCH_STATUS={success:'達成確定',failure:'非達成確定',unresolved:'保証できない'};
export function searchNotice(c){
  return `<b>条件探索 · ${rankingLabel(c.mode).replace('全探索','')}</b>　厳密探索専用。同点の均等配分はしません。${c.mode==='rounds'?'完全一致で目標の境界をまたぐ場合は、競技細則による追加タイブレーク戦次第として、可能性は残しますが達成を保証しません。':'未探索の得失点差による不確定性を含む、保守的な条件を求めます。'}`;
}
export function renderSearchControls(d,c,run,lastStatus){
  return `<aside class="panel condition-panel"><div class="section-heading"><div><div class="kicker">02 / CONDITION SEARCH</div><h2>必要条件・十分条件の探索</h2></div></div><div class="condition-body"><label>対象チーム<select id="search-team">${d.teams.map(t=>`<option value="${t.id}" ${c.targetTeamId===t.id?'selected':''}>${escape(t.name)}</option>`).join('')}</select></label><label>目標<select id="search-goal">${Object.entries(SEARCH_GOALS).map(([id,name])=>`<option value="${id}" ${c.goal===id?'selected':''}>${name}</option>`).join('')}</select></label><label>順位判定<select id="search-mode">${['rounds','battles','points'].map(mode=>`<option value="${mode}" ${c.mode===mode?'selected':''}>${rankingLabel(mode).replace('全探索','')}</option>`).join('')}</select></label><label>探索の前提<select id="search-context"><option value="@normal" ${c.caseId==='@normal'?'selected':''}>通常状態（将来の仮定なし）</option>${d.cases.map(x=>`<option value="${x.id}" ${c.caseId===x.id?'selected':''}>指定シナリオ：${escape(x.name)}</option>`).join('')}</select></label><p class="condition-note">対象チームの「残りN点以上」「残りM勝以上」を別々に探索します。通常状態では確率画面の固定スコアも適用しません。</p>${renderCost(d,{mode:c.mode,cases:1,conditionSearch:true})}<div class="run-area"><div class="calc-actions"><button class="primary-button run-button" id="calculate" ${run?'disabled':''}>${run?'計算実行中':'必要・十分条件を探索 →'}</button><button id="cancel" ${run?'':'hidden'} ${run?.stopping?'disabled':''}>中止</button></div><progress id="progress" max="100" value="0" ${run?'':'hidden'} aria-label="条件探索の進捗"></progress><div id="run-status" class="run-status" role="status">${escape(lastStatus||'全探索の完了後に保証できる条件を表示します。')}</div></div></div></aside>`;
}
function exampleButton(id,label){return id===null||id===undefined?'':`<button class="tiny-button secondary-button" data-search-example="${id}">${label}</button>`;}
function thresholdText(a,metric,kind,analysis,currentPoints){
  if(analysis.status==='impossible')return '達成不可能';
  if(analysis.status==='certain')return kind==='sufficient'?'追加0点・0勝でも保証':'前提だけで達成保証';
  const n=a[kind],unit=metric==='points'?'点':'勝';
  if(n===null)return 'この指標だけでは保証不可';
  if(kind==='necessary'&&n===0)return '正の最低条件なし（0以上）';
  return `残り${n}${unit}以上${metric==='points'?`<br><small>最終${currentPoints+n}点以上</small>`:''}`;
}
function reasonText(mode){return mode==='rounds'?'全項目一致・追加タイブレーク戦次第':mode==='battles'?'未探索のラウンド差次第':'未探索のバトル差・ラウンド差次第';}
function renderExample(r,index){
  if(index===null||index===undefined)return '<div class="empty-state"><p>「境界例」「保証できない例」から具体例を確認できます。</p></div>';
  const e=reconstructExample(r,index),d=r.input,team=id=>escape(d.teams.find(t=>t.id===id).shortName),signed=n=>n===null?'未探索・不明':`${n>0?'+':''}${n}`;
  const cls=e.classification;
  return `<section class="search-example"><div class="section-heading"><h3>具体例 #${index+1}：残り${e.points}点・${e.wins}勝</h3><span class="tag ${cls.status==='unresolved'?'stale':''}">${cls.status==='unresolved'?reasonText(r.mode):SEARCH_STATUS[cls.status]}</span></div><p class="result-context">${r.config.caseId==='@normal'?'通常状態（仮定なし）':'指定シナリオ下の例'}。対象チームの順位は${cls.first===cls.last?`${cls.first}位`:`${cls.first}〜${cls.last}位`}。${cls.status==='unresolved'?'敗退確定の反例ではなく、達成を保証できない例です。':''}</p><div class="scroll-table"><table><thead><tr><th>チーム</th><th>最終ポイント</th><th>バトル差</th><th>ラウンド差</th></tr></thead><tbody>${e.standings.map(t=>`<tr><td>${team(t.teamId)}</td><td>${t.points}</td><td>${signed(t.battleDiff)}</td><td>${signed(t.roundDiff)}</td></tr>`).join('')}</tbody></table></div><div class="example-games">${e.games.map(g=>{
    const fixture=d.fixtures.find(m=>m.id===g.matchId);
    return `<details><summary>第${fixture.round}節 ${team(g.homeTeamId)}（H） ${g.homePoints}–${g.awayPoints} ${team(g.awayTeamId)}（A）</summary><p class="muted">ホーム側の増分：バトル差 ${signed(g.battleDiff)}／ラウンド差 ${signed(g.roundDiff)}</p>${g.players?`<div class="scroll-table"><table><thead><tr><th>プレイヤーマッチ</th><th>バトル（H–A）</th><th>各バトルのラウンド（H–A）</th></tr></thead><tbody>${g.players.map((p,i)=>`<tr><td>${['先鋒','中堅','大将','延長'][i]} FT${p.target}</td><td>${p.homeBattles}–${p.awayBattles}</td><td>${p.roundScores?p.roundScores.map(score=>score.join('–')).join(' / '):'未探索'}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">ポイントのみの例です。バトル・ラウンドの結果は指定していません。</p>'}</details>`;
  }).join('')}${e.games.length?'':'<p class="muted">未消化試合なし。現在値だけで判定しています。</p>'}</div></section>`;
}
export function renderSearchResult(saved,d,c){
  if(!saved)return '<div class="empty-state"><div class="empty-symbol" aria-hidden="true">≥</div><p>何点・何勝が必要か、何点・何勝なら保証できるか。</p><small>対象チームと目標を選んで探索を開始してください。</small></div>';
  const stale=saved.fingerprint!==searchFingerprint(d,c);
  const heading=`<div class="result-context">${stale?'<span class="tag stale">変更前の入力による結果</span> ':''}${escape(saved.input.teams.find(t=>t.id===saved.config.targetTeamId).name)} · ${SEARCH_GOALS[saved.config.goal]} · ${rankingLabel(saved.config.mode).replace('全探索','')}<br>${saved.config.caseId==='@normal'?'通常状態（将来の仮定・固定なし）':'指定シナリオ下の条件'}</div>`;
  if(saved.status!=='done')return heading+`<div class="empty-state"><p>${saved.status==='running'?'厳密探索を実行中です。':saved.status==='error'?'探索に失敗しました。':'探索を中止しました。'}</p><small>未完了の探索から必要・十分条件を確定しません。</small></div>`;
  const r=saved.result,a=r.analysis,currentPoints=r.initial.points[r.initial.teamIds.indexOf(r.targetTeamId)];
  const message=a.status==='certain'?'現在の前提では目標達成が確定しています。':a.status==='impossible'?'現在の前提では目標を達成できません。':a.status==='possible-not-guaranteed'?'達成の可能性はありますが、保証できるパターンはありません。':'必要条件と、達成を保証できる十分条件を確認できます。';
  return heading+`<div class="search-summary ${a.status}">${message}<p class="muted">${saved.seconds.toFixed(2)}秒 · ${BigInt(r.processed).toLocaleString()}通りの集約状態を確認 · ${BigInt(r.collapsed).toLocaleString()}部分木を成績の実現可能性を保持して集約</p></div><div class="scroll-table"><table aria-label="必要条件と十分条件"><thead><tr><th>調べる成績</th><th>必要条件</th><th>十分条件</th><th>境界・反例</th></tr></thead><tbody>${['points','wins'].map(metric=>`<tr><td>残り${metric==='points'?'獲得ポイント':'チームマッチ勝利数'}</td><td>${thresholdText(a[metric],metric,'necessary',a,currentPoints)}</td><td>${thresholdText(a[metric],metric,'sufficient',a,currentPoints)}</td><td class="witness-actions">${exampleButton(a[metric].necessaryWitness,'必要条件の境界例')}${exampleButton(a[metric].sufficientWitness,'保証できる例')}${exampleButton(a[metric].counterexample,'保証できない例')}</td></tr>`).join('')}</tbody></table></div><div class="panel-foot">必要条件を満たすだけでは達成するとは限りません。十分条件はその成績以上の全実現可能パターンで保証します。${reasonText(r.mode)}の例は可能性に含めますが、保証には含めません。3項目一致時は競技細則により追加戦を行います。本ツールは追加戦の勝敗を探索しません。</div>${renderExample(r,saved.exampleIndex)}<details><summary>成績別の達成・非達成・未確定パターン</summary><div class="scroll-table"><table><thead><tr><th>残りポイント</th><th>残り勝利数</th><th>達成確定</th><th>非達成確定</th><th>${reasonText(r.mode)}</th></tr></thead><tbody>${r.cells.map(cell=>`<tr><td>${cell.points}点</td><td>${cell.wins}勝</td>${['success','failure','unresolved'].map(state=>`<td>${cell[state]===null?'存在なし':exampleButton(cell[state],'存在する例')}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>${renderAudit(r.input,r.caseDefinition,r.resolution,{normalSearch:r.config.caseId==='@normal'})}`;
}
