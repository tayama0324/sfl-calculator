import {renderTeamDistribution,renderMatchImpacts} from './team-summary-ui.js';
import {rulesFor} from './match-assumptions.js';
import {searchExamples,CONFIRMED_EXAMPLE} from './search-examples.js';
import {resultAssumptions} from './assumption-warning.js';
import {necessaryMatchGroups} from './necessary-assumptions.js';
import {escape,renderAudit} from './comparison-ui.js';
import {rankingLabel} from './model.js';
import {SEARCH_GOALS,searchGoals} from './search-config.js';
import {prepareSearch,searchFingerprint,reconstructExample} from './condition-search.js';
import {renderCost} from './exhaustive-cost.js';
export const SEARCH_STATUS={success:'達成確定',failure:'非達成確定',unresolved:'保証できない'};
export function searchNotice(c){
  return `<b>条件探索 · ${rankingLabel(c.mode).replace('全探索','')}</b>　厳密探索専用。同点の均等配分はしません。${c.mode==='rounds'?'完全一致で目標の境界をまたぐ場合は、競技細則による追加タイブレーク戦次第として、可能性は残しますが達成を保証しません。':'未探索の得失点差による不確定性を含む、保守的な条件を求めます。'}`;
}
export function renderSearchControls(d,c,run,lastStatus){
  return `<aside class="panel condition-panel"><div class="section-heading"><div><div class="kicker">03 / CALCULATE</div><h2>必要条件・十分条件の探索</h2><p class="section-intro">1回の探索で、1位通過・2位以内・PO進出を調べます。</p></div></div><div class="condition-body"><label>対象チーム<select id="search-team">${d.teams.map(t=>`<option value="${t.id}" ${c.targetTeamId===t.id?'selected':''}>${escape(t.name)}</option>`).join('')}</select></label><label>順位判定<select id="search-mode">${['rounds','battles','points'].map(mode=>`<option value="${mode}" ${c.mode===mode?'selected':''}>${rankingLabel(mode).replace('全探索','')}</option>`).join('')}</select></label><p class="condition-note">「現在の成績・将来の仮定」で指定した条件を使います。合計の獲得ポイントと、試合ごとの条件を調べます。</p>${renderCost(d,{mode:c.mode,cases:1,conditionSearch:true})}<div class="run-area"><div class="calc-actions"><button class="primary-button run-button" id="calculate" ${run?'disabled':''}>${run?'計算実行中':'サマリーを計算 →'}</button><button id="cancel" ${run?'':'hidden'} ${run?.stopping?'disabled':''}>中止</button></div><progress id="progress" max="100" value="0" ${run?'':'hidden'} aria-label="条件探索の進捗"></progress><div id="run-status" class="run-status" role="status">${escape(lastStatus||'入力した仮定のもとで、3つの目標を探索します。')}</div></div></div></aside>`;
}
function exampleButton(id,label){return id===null||id===undefined?'':`<button class="tiny-button secondary-button" data-search-example="${id}">${label}</button>`;}
function thresholdText(a,metric,kind,analysis,currentPoints){
  if(analysis.status==='impossible')return '達成不可能';
  if(analysis.status==='certain')return kind==='sufficient'?'あと0点で確定':'-';
  const n=a[kind];
  if(n===null)return '他力または得失次第';
  if(kind==='necessary'&&n===0)return '-';
  return `${kind==='necessary'?`あと${n}点以上必須`:`あと${n}点で確定`}<br><small>最終${currentPoints+n}点以上</small>`;
}
function dependentText(mode){return mode==='rounds'?'他力':mode==='battles'?'他力またはラウンド得失次第':'他力または得失次第';}
function sufficientText(r,currentPoints){
  const a=r.analysis,c=r.rankingCondition;
  if(r.mode==='points'||!c)return thresholdText(a.points,'points','sufficient',a,currentPoints);
  if(a.status==='impossible')return '達成不可能';
  if(c.status==='certain')return '追加条件なしで確定';
  if(c.status==='dependent')return dependentText(r.mode);
  const [points,battles,rounds]=c.threshold,signed=n=>`${n>0?'+':''}${n}`;
  return `${points}点（${r.mode==='rounds'?`得失${signed(battles)}/${signed(rounds)}`:`バトル得失${signed(battles)}`}）以上`;
}
function reasonText(mode){return mode==='rounds'?'全項目一致・追加タイブレーク戦次第':mode==='battles'?'未探索のラウンド差次第':'未探索のバトル差・ラウンド差次第';}
function renderExample(r,index,label='具体例'){
  if(index===null||index===undefined)return '<div class="empty-state"><p>表示できる具体例がありません。</p></div>';
  const e=reconstructExample(r,index),d=r.input,team=id=>escape(d.teams.find(t=>t.id===id).shortName),signed=n=>n===null?'未探索・不明':`${n>0?'+':''}${n}`;
  const cls=e.classification;
  return `<section class="search-example"><div class="section-heading"><h3>${escape(label)}<small class="example-heading-detail">具体例 #${index+1} · 残り${e.points}点</small></h3><span class="tag ${cls.status==='unresolved'?'stale':''}">${cls.status==='unresolved'?reasonText(r.mode):SEARCH_STATUS[cls.status]}</span></div><p class="result-context">${r.config.caseId==='@normal'||!resultAssumptions({input:r.input,config:r.config}).length?'仮定なしの例':r.config.caseId==='@input'?'残り日程の仮定を適用した例':'指定シナリオ下の例'}。対象チームの順位は${cls.first===cls.last?`${cls.first}位`:`${cls.first}〜${cls.last}位`}。${cls.status==='unresolved'?'敗退確定の反例ではなく、達成を保証できない例です。':''}</p><div class="scroll-table"><table><thead><tr><th>チーム</th><th>最終ポイント</th><th>バトル差</th><th>ラウンド差</th></tr></thead><tbody>${e.standings.map(t=>`<tr><td>${team(t.teamId)}</td><td>${t.points}</td><td>${signed(t.battleDiff)}</td><td>${signed(t.roundDiff)}</td></tr>`).join('')}</tbody></table></div><div class="example-games">${e.games.map(g=>{
    const fixture=d.fixtures.find(m=>m.id===g.matchId);
    return `<details><summary>第${fixture.round}節 ${team(g.homeTeamId)}（H） ${g.homePoints}–${g.awayPoints} ${team(g.awayTeamId)}（A）</summary><p class="muted">ホーム側の増分：バトル差 ${signed(g.battleDiff)}／ラウンド差 ${signed(g.roundDiff)}</p>${g.players?`<div class="scroll-table"><table><thead><tr><th>プレイヤーマッチ</th><th>バトル（H–A）</th><th>各バトルのラウンド（H–A）</th></tr></thead><tbody>${g.players.map((p,i)=>`<tr><td>${['先鋒','中堅','大将','延長'][i]} FT${p.target}</td><td>${p.homeBattles}–${p.awayBattles}</td><td>${p.roundScores?p.roundScores.map(score=>score.join('–')).join(' / '):'未探索'}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">ポイントのみの例です。バトル・ラウンドの結果は指定していません。</p>'}</details>`;
  }).join('')}${e.games.length?'':'<p class="muted">未消化試合なし。現在値だけで判定しています。</p>'}</div></section>`;
}
export function renderSearchResult(saved,d,c){
  if(['both','all'].includes(c.goal))return renderCombinedSearch(saved,d,c);
  if(!saved)return '<div class="empty-state"><div class="empty-symbol" aria-hidden="true">≥</div><p>何点・何勝が必要か、何点・何勝なら保証できるか。</p><small>対象チームと目標を選んで探索を開始してください。</small></div>';
  const stale=saved.fingerprint!==searchFingerprint(d,c);
  const assumed=resultAssumptions(saved).length>0;
  const heading=`<div class="result-context">${stale?'<span class="tag stale">変更前の入力による結果</span> ':''}${escape(saved.input.teams.find(t=>t.id===saved.config.targetTeamId).name)} · ${SEARCH_GOALS[saved.config.goal]} · ${rankingLabel(saved.config.mode).replace('全探索','')}<br>${saved.config.caseId==='@normal'?'通常状態（将来の仮定・固定なし）':'指定シナリオ下の条件'}</div>`;
  if(saved.status!=='done')return heading+`<div class="empty-state"><p>${saved.status==='running'?'厳密探索を実行中です。':saved.status==='error'?'探索に失敗しました。':'探索を中止しました。'}</p><small>未完了の探索から必要・十分条件を確定しません。</small></div>`;
  const r=saved.result,a=r.analysis,currentPoints=r.initial.points[r.initial.teamIds.indexOf(r.targetTeamId)];
  const examples=searchExamples(r),exampleIndex=saved.exampleIndex??examples[0]?.id,exampleLabel=saved.exampleLabel??examples.find(e=>e.id===exampleIndex)?.label??'具体例';
  const message=a.status==='certain'?'現在の前提では目標達成が確定しています。':a.status==='impossible'?'現在の前提では目標を達成できません。':a.status==='possible-not-guaranteed'?'達成の可能性はありますが、保証できるパターンはありません。':'必要条件と、達成を保証できる十分条件を確認できます。';
  return heading+`<div class="search-summary ${a.status}">${message}<p class="muted">${saved.seconds.toFixed(2)}秒 · ${BigInt(r.processed).toLocaleString()}通りの集約状態を確認 · ${BigInt(r.collapsed).toLocaleString()}部分木を成績の実現可能性を保持して集約</p></div><div class="scroll-table"><table aria-label="必要条件と十分条件"><thead><tr><th>調べる成績</th><th>必要条件</th><th>十分条件</th><th>境界・反例</th></tr></thead><tbody>${['points'].map(metric=>`<tr><td>残り${metric==='points'?'獲得ポイント':'チームマッチ勝利数'}</td><td>${thresholdText(a[metric],metric,'necessary',a,currentPoints)}</td><td>${sufficientText(r,currentPoints)}</td><td class="witness-actions">${examples.map(e=>exampleButton(e.id,escape(e.label))).join('')}</td></tr>`).join('')}</tbody></table></div><div class="panel-foot">必要条件を満たすだけでは達成するとは限りません。十分条件はその成績以上の全実現可能パターンで保証します。${reasonText(r.mode)}の例は可能性に含めますが、保証には含めません。3項目一致時は競技細則により追加戦を行います。本ツールは追加戦の勝敗を探索しません。</div>${renderExample(r,exampleIndex,exampleLabel)}${renderAudit(r.input,r.caseDefinition,r.resolution,{normalSearch:r.config.caseId==='@normal'})}`;
}

function matchClause(r,index,points){
  const id=r.matchConditions.matchIds[index],m=r.input.fixtures.find(m=>m.id===id);
  const name=id=>escape(r.input.teams.find(t=>t.id===id).shortName);
  return `第${m.round}節 ${name(m.homeTeamId)} vs. ${name(m.awayTeamId)} で <b>${name(r.targetTeamId)}が${points}点${points===40?'':'以上'}</b>`;
}
function matchConjunction(r,thresholds){
  const clauses=thresholds.flatMap((n,i)=>n>0?[`<span class="match-clause">${matchClause(r,i,n)}</span>`]:[]);
  return clauses.length?clauses.join('<span class="match-and">かつ</span>'):'追加条件なしで確定';
}
function matchWitness(goal,id,label){return `<button class="tiny-button secondary-button" data-search-goal="${goal}" data-search-example="${id}" data-match-witness>${label}</button>`;}
function renderSingleMatchConditions(r,goal,sufficient){
  if(!r.singleMatchConditions)return '';
  const a={...r.singleMatchConditions.analysis,sufficient};
  if(a.status==='certain')return '<p>追加条件なしで確定</p>';
  if(a.status==='impossible')return '<p>達成不可能</p>';
  if(!a.sufficient.length)return '<p>この形式では十分条件なし</p><small>複数試合を組み合わせた条件が成立する可能性はあります。</small>';
  const name=id=>escape(r.input.teams.find(t=>t.id===id).shortName);
  const candidate=c=>{
    const m=r.input.fixtures.find(m=>m.id===c.matchId),suffix=c.operator==='atLeast'?(c.points===40?'':'以上'):(c.points===0?'':'以下');
    const weaker=c.points+(c.operator==='atLeast'?-10:10),weakerSuffix=c.operator==='atLeast'?'以上':'以下';
    return `<div class="match-option"><span class="match-clause">第${m.round}節 ${name(m.homeTeamId)} vs. ${name(m.awayTeamId)} で <b>${name(c.teamId)}が${c.points}点${suffix}</b></span>${matchWitness(goal,c.witness,CONFIRMED_EXAMPLE)}<details class="match-proof"><summary>条件を緩めた反例</summary><div class="match-counterexample">${name(c.teamId)}が${weaker}点${weakerSuffix}に緩めると保証できません。${matchWitness(goal,c.counterexample,'条件を緩めた例')}</div></details></div>`;
  };
  return `<p class="match-options-note">次のいずれか1つを満たせば確定（${a.sufficient.length}条件）</p>${candidate(a.sufficient[0])}${a.sufficient.length>1?`<details class="single-match-alternatives" id="single-match-alternatives-${goal}"><summary>ほか${a.sufficient.length-1}条件を表示</summary>${a.sufficient.slice(1).map(candidate).join('')}</details>`:''}`;
}
function renderAllMatchNecessary(r,goal,stale){
  const conditions=r.singleMatchConditions.analysis.necessary;
  if(conditions===null)return '達成不可能';
  const name=id=>escape(r.input.teams.find(t=>t.id===id).shortName);
  const clauses=necessaryMatchGroups(r).flatMap(g=>{
    const match=r.matches.find(m=>m.id===g.matchId),rows=r.outcomeSets[match.outcomeSet];
    const tag=predicate=>r.config.caseId!=='@normal'&&rulesFor(r.input,g.matchId).length&&rows.every(predicate)?'<span class="input-assumption-tag">入力済みの仮定</span>':'';
    const m=r.input.fixtures.find(m=>m.id===g.matchId),label=`第${m.round}節 ${name(g.homeTeamId)} vs. ${name(g.awayTeamId)}`;
    if(g.exact)return [`<span class="match-clause">${label} の結果が <b>${g.exact[0]} - ${g.exact[1]}</b>${tag(([h,a])=>h===g.exact[0]&&a===g.exact[1])}</span>`];
    return [[g.homeTeamId,g.home],[g.awayTeamId,g.away]].filter(([,n])=>n>0).map(([id,n])=>`<span class="match-clause">${label} で <b>${name(id)}が${n}点${n===40?'':'以上'}</b>${tag(row=>row[id===g.homeTeamId?0:1]>=n)}</span>`);
  });
  const button=r.mode==='points'?`<button class="tiny-button secondary-button apply-necessary" data-apply-necessary="${goal}" ${stale?'disabled title="入力が変更されています。再探索してください。"':''}>この条件でバトル得失点差を探索する</button>`:'';
  return `<section class="all-match-necessary">${clauses.length?`<p class="match-options-note">全チームの試合が対象・すべて必須</p>${clauses.join('<span class="match-and">かつ</span>')}`:'-'}${button}</section>`;
}
function renderCombinedMatchConditions(r,goal){
  const data=r.combinedMatchConditions,candidates=data.sufficient;
  const name=id=>escape(r.input.teams.find(t=>t.id===id).shortName);
  const candidate=c=>`<div class="match-option">${c.clauses.map(clause=>{
    const m=data.matches[clause.matchIndex],fixture=r.input.fixtures.find(f=>f.id===m.matchId);
    const label=`第${fixture.round}節 ${name(fixture.homeTeamId)} vs. ${name(fixture.awayTeamId)}`;
    const teamName=side=>name(r.initial.teamIds[side===0?m.home:m.away]);
    const range=(side,min,max)=>`${teamName(side)}が${min===max?`${min}点`:min===0?`${max}点以下`:max===40?`${min}点以上`:`${min}〜${max}点`}`;
    if(clause.operator==='exact')return `<span class="match-clause">${label} の結果が <b>${clause.score[0]} - ${clause.score[1]}</b></span>`;
    let text;
    if(clause.operator==='range')text=range(clause.side,clause.min,clause.max);
    else if(clause.operator==='ranges')text=clause.bounds.map(([min,max],side)=>range(side,min,max)).join(' かつ ');
    else {const suffix=clause.operator==='atLeast'?(clause.points===40?'':'以上'):(clause.points===0?'':'以下');text=`${teamName(clause.side)}が${clause.points}点${suffix}`;}
    return `<span class="match-clause">${label} で <b>${text}</b></span>`;
  }).join('<span class="match-and">かつ</span>')}${matchWitness(goal,c.witness,CONFIRMED_EXAMPLE)}</div>`;
  return `<p class="match-options-note">次のいずれか1つを満たせば確定（${candidates.length}条件・最大${data.limit}試合）</p>${candidate(candidates[0])}${candidates.length>1?`<details class="single-match-alternatives" id="single-match-alternatives-${goal}"><summary>ほか${candidates.length-1}条件を表示</summary>${candidates.slice(1).map(candidate).join('')}</details>`:''}`;
}
function renderMatchConditions(r,goal,stale=false){
  if(!r.matchConditions)return '';
  const a=r.matchConditions.analysis;
  const necessary=r.singleMatchConditions?.analysis.necessary!==undefined?renderAllMatchNecessary(r,goal,stale):a.status==='impossible'?'達成不可能':a.status==='certain'||a.necessary.every(n=>n===0)?'-':matchConjunction(r,a.necessary);
  let sufficient;
  if(a.status==='impossible')sufficient='達成不可能';
  else if(!a.sufficient.length)sufficient=r.rankingCondition?.status==='conditional'?'得失込みの十分条件は獲得ポイント欄を参照':dependentText(r.mode);
  else if(a.status==='certain')sufficient='追加条件なしで確定';
  else {
    const candidate=(c,i)=>`<div class="match-option"><p class="match-option-label">${a.sufficient.length>1?`条件${i+1}`:'この条件なら確定'}</p>${matchConjunction(r,c.thresholds)}${matchWitness(goal,c.witness,CONFIRMED_EXAMPLE)}<details class="match-proof"><summary>条件を緩めた反例</summary>${c.counterexamples.map(e=>`<div class="match-counterexample">${matchClause(r,e.matchIndex,c.thresholds[e.matchIndex]-10)}に緩めると保証できません。${matchWitness(goal,e.witness,'条件を緩めた例')}</div>`).join('')}</details></div>`;
    sufficient=`${a.sufficient.length>1?`<p class="match-options-note">${a.sufficient.length}通りのうち、いずれかを満たせば確定</p>`:''}${candidate(a.sufficient[0],0)}${a.sufficient.length>1?`<details class="match-alternatives" id="match-alternatives-${goal}"><summary>ほか${a.sufficient.length-1}通りを表示</summary>${a.sufficient.slice(1).map((c,i)=>candidate(c,i+1)).join('')}</details>`:''}`;
  }
  const combined=r.combinedMatchConditions;
  const otherConditions=(r.singleMatchConditions?.analysis.sufficient??[]).filter(c=>{
    const m=r.input.fixtures.find(m=>m.id===c.matchId);
    return m&&m.homeTeamId!==r.targetTeamId&&m.awayTeamId!==r.targetTeamId;
  });
  const hasOther=combined?.limit?combined.sufficient.length:otherConditions.length;
  if(hasOther&&!['certain','impossible'].includes(a.status))sufficient=`<section class="own-match-conditions"><h4>自力での確定条件</h4>${sufficient}</section><section class="single-match-conditions"><h4>他力での確定条件</h4>${combined?.limit?renderCombinedMatchConditions(r,goal):renderSingleMatchConditions(r,goal,otherConditions)}</section>`;
  return `<tr class="match-condition-row"><th scope="row">マッチ</th><td data-label="必要条件" class="match-condition">${resultAssumptions({input:r.input,config:r.config}).length?'<p class="mobile-assumption-note">入力した仮定が成立する場合の必要条件です。仮定で既に指定した結果も含まれます。</p>':''}${necessary}</td><td data-label="十分条件" class="match-condition po-cell">${resultAssumptions({input:r.input,config:r.config}).length?'<p class="mobile-assumption-note">入力した仮定が成立する場合に限り、達成を保証します。</p>':''}${sufficient}</td></tr>`;
}

function renderCombinedSearch(saved,d,c){
  if(!saved)return '<div class="empty-state"><div class="empty-symbol" aria-hidden="true">≥</div><p>1位・2位以内・PO進出に、あと何点必要か。</p><small>下の計算条件を確認して、探索ボタンを押してください。</small></div>';
  const stale=saved.fingerprint!==searchFingerprint(d,c);
  const assumed=resultAssumptions(saved).length>0;
  const header=`<div class="result-context">${stale?'<span class="tag stale">変更前の入力による結果</span> ':''}${escape(saved.input.teams.find(t=>t.id===saved.config.targetTeamId).name)} · ${rankingLabel(saved.config.mode).replace('全探索','')}${resultAssumptions(saved).length?' <strong class="assumption-badge">残り日程の仮定を適用</strong>':''}</div>`;
  if(saved.status!=='done')return header+`<div class="empty-state"><p>${saved.status==='running'?'各目標の条件を探索中です。':saved.status==='error'?'探索に失敗しました。':'探索を中止しました。'}</p><small>未完了の探索から必要・十分条件を確定しません。</small></div>`;
  return header+renderTeamDistribution(saved.result.teamSummary)+`<div class="goal-results">${['first','second','po'].filter(goal=>searchGoals(saved.config.goal).includes(goal)).map(goal=>{
    const r=saved.result.results[goal],a=r.analysis,initial=r.initial.points[r.initial.teamIds.indexOf(r.targetTeamId)];
    const examples=searchExamples(r),selected=examples[0];
    const exampleIndex=saved.exampleIndices?.[goal]??selected?.id;
    const exampleLabel=saved.exampleLabels?.[goal]??examples.find(e=>e.id===exampleIndex)?.label??'具体例';
    const message=a.status==='certain'?'この前提なら達成が確定':a.status==='impossible'?'この前提では達成不可能':a.status==='possible-not-guaranteed'?'可能性はありますが、達成の保証はできません':'可能性を残す条件と、保証できる条件';
    return `<section class="goal-result"><div class="section-heading"><div><h3>${goal==='first'?'1位通過':goal==='second'?'2位以内':'PO進出（3位以内）'}</h3><p class="section-intro">${message}</p></div></div><div class="scroll-table"><table class="conditions-table" aria-label="${goal==='first'?'1位':goal==='second'?'2位以内':'PO進出'}の必要条件と十分条件"><thead><tr><th>残りの成績</th><th>必要条件${assumed?'<small class="assumption-condition-note">入力した仮定が成立する場合の必要条件です。仮定で既に指定した結果も含まれます。</small>':''}</th><th>十分条件${assumed?'<small class="assumption-condition-note">入力した仮定が成立する場合に限り、達成を保証します。</small>':''}</th></tr></thead><tbody>${['points'].map(metric=>`<tr><th scope="row">獲得ポイント${r.mode!=='points'?'<small>十分条件は得失込み</small>':''}</th><td data-label="必要条件">${thresholdText(a[metric],metric,'necessary',a,initial)}</td><td data-label="十分条件" class="po-cell">${sufficientText(r,initial)}</td></tr>`).join('')}${renderMatchConditions(r,goal,stale)}</tbody></table></div><details id="examples-${goal}"><summary>具体例を見る</summary><div class="example-actions">${examples.map(e=>`<button class="tiny-button" data-search-goal="${goal}" data-search-example="${e.id}">${escape(e.label)}</button>`).join('')}</div>${renderExample(r,exampleIndex,exampleLabel)}</details></section>`;
  }).join('')}</div>${renderMatchImpacts(saved.result.teamSummary,saved.input)}<details id="search-explanation"><summary>条件の読み方・探索の詳細</summary><p class="muted">必要条件を満たしても進出の保証にはなりません。合計ポイントとマッチの行は別々の条件です。マッチの必要条件が「-」でも、合計ポイントの必要条件はあり得ます。十分条件以上なら、入力した仮定のもとですべての結果で目標を達成します。獲得ポイント欄の「他力」は、探索した成績を最大にしても保証できず、他チームの結果または追加タイブレーク戦に依存する意味です。バトルまでの探索では未探索のラウンド得失の影響も残ります。マッチの必要条件は他チーム同士を含む全試合が対象です。達成確定・未確定ケースを合わせた各チームの必要最低点を示し、すべて満たす必要があります。入力した仮定で既に満たす条件も含みます。必要条件の結果表記は、達成確定・未確定ケースの最低点と最高点からスコアが一意に決まる場合です。仮定への反映では、一意スコアと各チームの必要最低点を条件のままANDで追加します。これによりバトル探索に進める達成可能なケースを除外しません。十分条件の「他力での確定条件」は、非達成・未確定ケースをすべて除外するポイントの上下限・範囲・確定スコアの条件です。残り6試合以下は最大3試合、7〜9試合は最大2試合の条件を組み合わせます。10試合以上では単独条件のみを調べます。いずれか1つを満たせば確定します。この方法で条件が見つからないときは他力での確定条件欄を省略します。マッチ欄は点数だけの条件で、得失を指定する条件は含みません。得失の境界値は整数で示し、ちょうどその値が実現しない場合もあります。${reasonText(c.mode)}のパターンは可能性に含め、保証には含めません。</p><p class="muted">${saved.seconds.toFixed(2)}秒 · ${BigInt(saved.result.processed).toLocaleString()}通りを1回の探索で確認。</p>${renderAudit(saved.input,saved.result.results.po.caseDefinition,saved.result.results.po.resolution)}</details>`;
}
