import {divisionAutoPlan,shouldAutoSearch,parseSummaryRoute,MC_PRESETS,normalizedTrials} from './summary-policy.js';
import {divisionSelection,summaryLayout,linkSummaryTeams,simplifyResultPresentation} from './summary-layout.js';
import {userSettings,applyUserSettings} from './user-settings.js';
import {clearStoredCheckpoints,restoreMatchingCheckpoint} from './checkpoint-storage.js';
import {compactLayout} from './compact-layout.js';
import {rulesFor,setMatchRules,mergeMatchRules,clearMatchRules,ruleErrors,ruleText,exactRuleScore,ASSUMPTION_METRICS,ASSUMPTION_OPERATORS,filterRuleOutcomes} from './match-assumptions.js';
import {resultAssumptions,renderAssumptionWarning} from './assumption-warning.js';
import {necessaryMatchRules} from './necessary-assumptions.js';
import { SCORES, EXPLORATION_MODES, CALCULATION_METHODS, rankingLabel, prepare, scoreKey, remaining, current, validate, verifyFractions, migrateData, BASE_CASE,resolveMatch } from './model.js';
import { escape, modeNotice, renderProbability } from './comparison-ui.js';
import { simulationFingerprint, validateCheckpoint, emptyCheckpoint } from './monte-carlo.js';
import { newSeed } from './random.js';
import {prepareSearch,searchFingerprint,verifySearchResult} from './condition-search.js';
import {renderSearchControls,renderSearchResult,searchNotice} from './condition-search-ui.js';
import {renderCost} from './exhaustive-cost.js';
import {defaultSearchConfig,searchConfigErrors} from './search-config.js';

const $ = s => document.querySelector(s);
const STORE = 'sfl-rank-probability:v4';
const teamColors = ['#c0adff', '#ff9355', '#ffd270', '#91cdb0', '#eb7c87', '#7cb9e7'];
const signed = n => n === null ? '不明' : `${n > 0 ? '+' : ''}${n}`;
let defaults, data, active = 'S', storageStatus = 'このブラウザに自動保存', editingMatch = null;
let draftRules=[];
let chartView='po';
let page='home',navigationVersion=0;
let run = null, lastRunStatus = '', timer, feature='probability';
const searchResults=new Map();
const searchConfig=()=>({...data.conditionSearch[active],goal:'all',caseId:'@input'});
const results = new Map();
const division = () => data.divisions.find(d => d.id === active);
// Keep legacy comparison cases in settings, but do not apply hidden conditions.
const inputDivision = () => ({...division(),cases:[]});
const fingerprint = d => JSON.stringify(d);
const team = (d, id) => d.teams.find(t => t.id === id);
const notice = (text, error = false) => {
  $('#message').textContent = text; $('#message').classList.toggle('error', error); $('#message').hidden = !text;
  if ($('#result-dialog').open) { $('#dialog-error').textContent = error ? text : ''; $('#dialog-error').hidden = !error; }
};
function persist() {
  try { localStorage.setItem(STORE, JSON.stringify(userSettings(data)));
    for(const version of [1,2,3])localStorage.removeItem(`sfl-rank-probability:v${version}`);
    storageStatus = '計算設定と将来の仮定をこのブラウザに保存済み。成績・日程は配信データを使用。'; }
  catch { storageStatus = '保存できません。JSONを書き出してください。'; }
}
function clearSavedResults(ids){
  try{clearStoredCheckpoints(localStorage,ids);}
  catch{notice('保存済みの計算結果を削除できませんでした。ブラウザの保存設定を確認してください。',true);}
}
function change(mutator, renderPage = true) {
  const next = structuredClone(data);
  mutator(next.divisions.find(d => d.id === active), next);
  for(const d of next.divisions)if(next.conditionSearch?.[d.id]&&next.conditionSearch[d.id].caseId!=='@normal'&&!d.cases.some(c=>c.id===next.conditionSearch[d.id].caseId))next.conditionSearch[d.id].caseId='@normal';
  const errors = validate(next);
  if (errors.length) { notice(errors.join('\n'), true); return false; }
  const changed=next.divisions.filter(d=>simulationFingerprint({...d,cases:[]})!==simulationFingerprint({...data.divisions.find(old=>old.id===d.id),cases:[]})).map(d=>d.id);
  data = next;
  persist(); notice('');
  clearSavedResults(changed);
  if (renderPage) render();
  else renderOutput();
  return true;
}
function scoreOptions(selected = '', placeholder = '指定なし · 通常の確率分布') {
  return `<option value="">${placeholder}</option>` + SCORES.map(([h, a]) => `<option value="${scoreKey(h, a)}" ${selected === scoreKey(h, a) ? 'selected' : ''}>${h} – ${a}${h + a === 50 ? '（延長）' : ''}</option>`).join('');
}
function currentSavedResult(){return (feature==='conditions'?searchResults:results).get(active);}
function renderResult(d) {
  const saved=currentSavedResult();
  return renderAssumptionWarning(saved,{disabled:!!run,conditions:feature==='conditions'})+(feature==='conditions'?renderSearchResult(saved,d,searchConfig()):renderProbability(saved,{...d,cases:[]}));
}
function bindExampleButtons(){
  simplifyResultPresentation(document);
  if($('#switch-to-exact'))$('#switch-to-exact').onclick=()=>{
    if(run)return;
    change(d=>{d.calculationMethod='exact';});
    $('#calculation-controls').scrollIntoView({behavior:'smooth',block:'start'});
  };
  if(page==='division')linkSummaryTeams($('#result-content'),division());
  const selected=document.querySelector(`input[name="probability-chart"][value="${chartView}"]`);if(selected)selected.checked=true;
  document.querySelectorAll('input[name="probability-chart"]').forEach(el=>el.onchange=()=>{chartView=el.value;});
  document.querySelectorAll('[data-clear-assumptions-rerun]').forEach(button=>button.onclick=()=>{
    if(run)return;
    if(change(d=>{clearMatchRules(d);})){
      if(feature==='conditions')startConditionSearch();else startCalculation(false);
    }
  });
  document.querySelectorAll('[data-apply-necessary]').forEach(button=>button.onclick=()=>{
    const saved=searchResults.get(active);
    if(run||saved?.status!=='done')return;
    if(saved.fingerprint!==searchFingerprint(inputDivision(),searchConfig()))return notice('入力が変更されています。必要条件を再探索してください。',true);
    try{
      const r=saved.result.results[button.dataset.applyNecessary];
      const additions=necessaryMatchRules(r);
      if(change((d,next)=>{
        mergeMatchRules(d,additions);
        d.explorationMode='battles';
        next.conditionSearch[active].mode='battles';
      })){
        notice('必要条件を既存の仮定にANDで追加し、バトル探索へ切り替えました。点数の上下限は条件のまま引き継いでいます。探索ボタンで計算できます。');
        $('#search-mode')?.scrollIntoView({block:'center'});
      }
    }catch(error){notice(error.message,true);}
  });
  document.querySelectorAll('[data-search-example]').forEach(button=>button.onclick=()=>{
    const saved=searchResults.get(active);if(saved?.status!=='done')return;
    const goal=button.dataset.searchGoal,showMatch=button.hasAttribute('data-match-witness');
    if(saved.result.kind==='sfl-condition-search-results'){
      saved.exampleIndices??={};saved.exampleIndices[goal]=Number(button.dataset.searchExample);
      saved.exampleLabels??={};saved.exampleLabels[goal]=button.textContent.trim();
    }else {saved.exampleIndex=Number(button.dataset.searchExample);saved.exampleLabel=button.textContent.trim();}
    renderOutput();
    if(showMatch){const details=document.getElementById(`examples-${goal}`);details.open=true;details.scrollIntoView({block:'nearest'});}
  });
}
function renderOutput() {
  const target=$('#result-content');
  if (!target) return;
  const open=[...target.querySelectorAll('details[open]')].map(el=>el.id).filter(Boolean);
  target.innerHTML=renderResult(division());
  target.closest('.result-panel').classList.toggle('has-assumptions',resultAssumptions(currentSavedResult()).length>0);
  updateResumeAvailability();bindExampleButtons();
  for (const id of open) target.querySelector(`#${CSS.escape(id)}`)?.setAttribute('open','');
}
function renderFixture(d, m) {
  const rules=rulesFor(d,m.id),fixed=exactRuleScore(rules);
  return `<article class="fixture ${rules.length?'assumed':''}"><div class="fixture-top"><span>${escape(m.scheduledAt || '日付未設定')}</span><span class="tag">${rules.length?`条件${rules.length}件`:'未指定'}</span></div><div class="fixture-teams"><span><small>H</small>${escape(team(d,m.homeTeamId).shortName)}</span><span class="versus">対</span><span><small>A</small>${escape(team(d,m.awayTeamId).shortName)}</span></div><label class="sr-label"><span>仮定スコア（H – A）</span><select data-fixed="${escape(m.id)}" aria-label="第${m.round}節 ${escape(team(d,m.homeTeamId).name)} 対 ${escape(team(d,m.awayTeamId).name)} の仮定">${!fixed&&rules.length?'<option value="@rules" selected>条件で指定</option>':''}${scoreOptions(fixed??(rules.length?'@rules':''),'未指定（すべての結果を探索）')}</select></label>${rules.length?`<p class="fixture-differences">${rules.map(r=>escape(ruleText(r,team(d,m.homeTeamId).shortName,team(d,m.awayTeamId).shortName))).join('<br>かつ ')}<br><small>すべてANDで適用</small></p>`:''}<div class="fixture-actions"><button class="tiny-button secondary-button" data-result="${escape(m.id)}">詳細を入力</button></div></article>`;
}
function renderSchedule(d,editable) {
  const rounds=[...new Set(editable.map(m=>m.round))],assumed=editable.filter(m=>rulesFor(d,m.id).length).length;
  return `<details class="schedule-panel" id="schedule"><summary>残り日程・将来の仮定 <span class="schedule-count">${editable.length}試合${assumed?` · 仮定${assumed}試合・条件${editable.reduce((n,m)=>n+rulesFor(d,m.id).length,0)}件を適用中`:''}</span></summary><div class="section-heading"><p class="section-intro">「この試合がこの結果なら」を指定できます。空欄の試合はすべての結果を探索します。</p><button class="tiny-button secondary-button" id="clear-fixed">仮定を解除</button></div><p class="input-note">「詳細を入力」でポイントの上下限や得失点差も指定できます。仮定は現在の累計を変えず、両方の探索に反映されます。</p>${rounds.map((r,i)=>`<details class="schedule-round" id="round-${d.id}-${r}" ${i===0?'open':''}><summary>第${r}節 <span>${editable.filter(m=>m.round===r).length}試合${editable.some(m=>m.round===r&&rulesFor(d,m.id).length)?' · 仮定あり':''}</span></summary><div class="fixtures">${editable.filter(m=>m.round===r).map(m=>renderFixture(d,m)).join('')}</div></details>`).join('')}${editable.length?'':'<p class="input-note">残り試合はありません。</p>'}</details>`;
}
function enterSummary(){
  if(run)stopRun('画面を移動したため計算を停止しました。');
  $('#result-dialog').close();
  const route=parseSummaryRoute(location.hash,data),version=++navigationVersion;
  page=route.page;lastRunStatus='';
  if(page!=='home'){
    active=route.divisionId;feature=page==='team'?'conditions':'probability';
    if(page==='team'){
      data.conditionSearch[active].targetTeamId=route.teamId;
      const saved=searchResults.get(active);
      if(saved?.fingerprint!==searchFingerprint(inputDivision(),searchConfig()))searchResults.delete(active);
      persist();
    }else results.delete(active);
  }
  render();window.scrollTo(0,0);
  if(page==='home')return;
  queueMicrotask(()=>{
    if(version!==navigationVersion||run)return;
    if(page==='division')startCalculation(false,true);
    else if(shouldAutoSearch(inputDivision(),searchConfig(),searchResults.get(active),searchFingerprint(inputDivision(),searchConfig())))startConditionSearch();
  });
}
window.addEventListener('hashchange',()=>{if(data)enterSummary();});
function normalizePresetSettings(){for(const d of data.divisions)d.simulation.trials=normalizedTrials(d.simulation.trials);}
function render() {
  document.body.dataset.page=page;
  if(page==='home'){$('#app').innerHTML=divisionSelection(data);return;}
  const openDetails=[...document.querySelectorAll('#app details[id][open]')].map(el=>el.id);
  const closedDetails=[...document.querySelectorAll('#app details[id]:not([open])')].map(el=>el.id);
  const focused = document.activeElement;
  const focusId = focused?.id;
  const focusFixed = focused?.dataset?.fixed;
  const d = division(), rows = current(d), pending = remaining(d);
  const c=searchConfig(),visibleMode=feature==='conditions'?c.mode:d.explorationMode;
  $('.model-notice p').innerHTML = feature==='conditions'?searchNotice(c):modeNotice(d.explorationMode,d.calculationMethod);
  const included = new Set(d.baseline.includedMatchIds);
  const editable = pending;
  const sorted = rows.toSorted((a, b) => b.points - a.points);
  $('#app').innerHTML = `
  <nav class="feature-nav" aria-label="機能"><button data-feature="probability" aria-pressed="${feature==='probability'}" class="${feature==='probability'?'selected':''}">順位確率</button><button data-feature="conditions" aria-pressed="${feature==='conditions'}" class="${feature==='conditions'?'selected':''}">必要・十分条件の探索</button></nav>
  <div class="division-nav"><div class="tabs" role="tablist" aria-label="ディビジョン"><button role="tab" aria-selected="${active === 'S'}" class="tab ${active === 'S' ? 'active' : ''}" data-division="S">Division <span>S</span></button><button role="tab" aria-selected="${active === 'F'}" class="tab ${active === 'F' ? 'active' : ''}" data-division="F">Division <span>F</span></button></div><span class="baseline-date">基準日 ${escape(d.baseline.asOf)}<br>日程：二次資料参照・公式未照合</span></div>
  <div class="stats"><div class="stat"><span class="label">REMAINING / 残り試合</span><strong>${pending.length}<small>/ 30試合</small></strong></div><div class="stat"><span class="label">PLAYOFF SPOTS / 進出枠</span><strong>3<small>/ 6チーム</small></strong></div><div class="stat"><span class="label">METHOD / 計算方法</span><strong style="font-size:19px">${feature==='conditions'?'条件探索':d.calculationMethod==='monteCarlo'?'推定':'厳密集計'}<small>${visibleMode === 'points' ? 'ポイント' : visibleMode === 'battles' ? 'バトル' : 'ラウンド'}</small></strong></div></div>
  <div class="layout">
    <section class="panel team-status-panel"><div class="section-heading"><div><h2>現在のチーム状況</h2><p class="section-intro">計算の出発点となる累計です。</p></div><span class="tag">ポイント順</span></div><div class="scroll-table"><table aria-label="現在の順位表"><thead><tr><th>チーム</th><th>消化</th><th>ポイント</th><th>バトル差</th><th>ラウンド差</th></tr></thead><tbody>${sorted.map(t => `<tr><td class="team-name"><span class="team-code" style="--team-color:${teamColors[d.teams.findIndex(x => x.id === t.teamId)]}"></span>${escape(team(d, t.teamId).name)}</td><td class="muted">${t.played}/10</td><td class="points">${t.points}</td><td class="muted">${signed(t.battleDiff)}</td><td class="muted">${signed(t.roundDiff)}</td></tr>`).join('')}</tbody></table></div><div class="panel-foot">同ポイントの行の表示順は順位を意味しません。比較に使用する得失点差は探索モードで決まります。</div>
    <details><summary>基準に含まれる過去の試合（${included.size}試合）</summary><p class="muted">基準日までの結果は現在の累計に含まれています。日程は二次資料参照・公式未照合です。</p><div class="scroll-table"><table><thead><tr><th>節</th><th>ホーム</th><th>アウェイ</th></tr></thead><tbody>${d.fixtures.filter(m=>included.has(m.id)).map(m=>`<tr><td>第${m.round}節</td><td>${escape(team(d,m.homeTeamId).name)}</td><td>${escape(team(d,m.awayTeamId).name)}</td></tr>`).join('')}</tbody></table></div></details>${renderSchedule(d,editable)}</section>
    ${feature==='probability'?`<aside class="panel condition-panel"><div class="section-heading"><div><div class="kicker">03 / CALCULATE</div><h2>計算方式・順位判定</h2><p class="section-intro">上の入力をもとに、各チームの1位・PO進出の確率を求めます。</p></div></div><div class="condition-body"><label>計算方式<select id="calculation-method">${Object.entries(CALCULATION_METHODS).map(([id,name])=>`<option value="${id}" ${d.calculationMethod===id?'selected':''}>${name}</option>`).join('')}</select></label><label>順位判定<select id="exploration-mode">${Object.entries(EXPLORATION_MODES).map(([id,name])=>`<option value="${id}" ${d.explorationMode===id?'selected':''}>${rankingLabel(id,d.calculationMethod)}</option>`).join('')}</select></label>${renderSimulationSettings(d)}${renderCost({...d,cases:[]})}<p class="condition-note">詳細モードは各バトル／ラウンドの勝率50%・独立を仮定します。計算時間に上限はありません。${d.calculationMethod==='monteCarlo'?'試行回数を増やすと、推定の統計的な幅が小さくなります。':'モードによっては非常に多くの状態を探索します。'}</p><div class="run-area"><div class="calc-actions"><button class="primary-button run-button" id="calculate" ${run?'disabled':''}>${run?'計算実行中':'順位確率を計算'} <span aria-hidden="true">→</span></button><button id="cancel" ${run?'':'hidden'} ${run?.stopping?'disabled':''}>${run?.stopping?'停止待ち':'中止'}</button></div><progress id="progress" max="100" value="0" ${run?'':'hidden'} aria-label="計算の進捗"></progress><div id="run-status" class="run-status" role="status">${escape(lastRunStatus || '入力した仮定のもとで計算します')}</div></div></div></aside>`:renderSearchControls(d,c,run,lastRunStatus)}
    <section class="panel result-panel ${resultAssumptions(currentSavedResult()).length?'has-assumptions':''}"><div class="section-heading"><div><div class="kicker">04 / RESULTS</div><h2>${feature==='conditions'?'1位・2位以内・PO進出に必要な成績':'1位・PO進出の確率'}</h2><p class="section-intro">${feature==='conditions'?'必要条件は可能性を残す最低成績、十分条件は達成を保証する成績です。':'入力した仮定のもとで、どこまで進めるかを読み取れます。'}</p></div><div class="result-toolbar"><span class="tag">${feature==='conditions'?'厳密条件探索':escape(rankingLabel(results.get(d.id)?.input.explorationMode ?? d.explorationMode,results.get(d.id)?.input.calculationMethod ?? d.calculationMethod))}</span>${(feature==='conditions'?searchResults.has(d.id):results.has(d.id)) ? '<button class="tiny-button secondary-button" id="export-result">結果JSON ↗</button>' : ''}</div></div><div id="result-content">${renderResult(d)}</div></section>
  </div>
  <section class="panel"><div class="data-tools"><div><h3>計算設定・仮定の保存と読み込み</h3><p class="storage-status">${escape(storageStatus)}</p></div><div class="data-tools-buttons"><button class="tiny-button" id="export">設定JSONを書き出す ↗</button><button class="tiny-button" id="import">JSONを読み込む</button><input id="import-file" type="file" accept=".json,application/json" hidden><button class="tiny-button secondary-button" id="reset">初期データに戻す</button></div></div><details><summary>計算モデルと精度について</summary><p class="muted">40–0 / 30–10 / 30–20 / 20–30 / 10–30 / 0–40 の重みは1 / 2 / 1 / 1 / 2 / 1です。6通りは等確率ではありません。条件で残った候補を正規化します。厳密方式は全組み合わせを整数の重みで集計し、モンテカルロは同じ分布から抽選して寄与を集計します。ポイントモードは同ポイントを均等配分し、詳細モードは未解決同点を上下限で表示します。入力した仮定はすべてANDで適用します。計算時間の上限は設けていません。厳密計算はタブを閉じると停止します。モンテカルロは中止・完了時のチェックポイント、または書き出したJSONから追加試行できます。詳細モードではバトル／ラウンドの勝率も50%・独立と仮定し、延長を含む整合した試合結果を集計します。未解決同点とPO境界の同点の確率、厳密な分数、計算時の入力、スキップ理由は結果JSONから保存できます。</p></details></section>`;
  compactLayout($('#app'),{feature,assumptions:pending.filter(m=>rulesFor(d,m.id).length).length,baseline:d.baseline.asOf,remaining:pending.length,method:feature==='conditions'||d.calculationMethod==='exact'?'厳密計算':`モンテカルロ ${d.simulation.trials.toLocaleString()}試行`});
  summaryLayout($('#app'),{page,d,targetId:c.targetTeamId});
  for(const id of openDetails)document.getElementById(id)?.setAttribute('open','');
  for(const id of closedDetails)document.getElementById(id)?.removeAttribute('open');
  bind(); bindExampleButtons(); updateRunStatus(); updateResumeAvailability();
  if (focusId && $(`#${CSS.escape(focusId)}`)) $(`#${CSS.escape(focusId)}`).focus({ preventScroll: true });
  else if (focusFixed) $(`[data-fixed="${CSS.escape(focusFixed)}"]`)?.focus({ preventScroll: true });
}
function renderSimulationSettings(d) {
  if(d.calculationMethod!=='monteCarlo')return '';
  return `<div class="simulation-settings"><label>計算精度<select id="mc-preset">${MC_PRESETS.map(([n,label])=>`<option value="${n}" ${normalizedTrials(d.simulation.trials)===n?'selected':''}>${label}</option>`).join('')}</select></label></div>`;
}
function canResume(d) {
  const saved=results.get(d.id);
  return !run&&d.calculationMethod==='monteCarlo'&&saved?.method==='monteCarlo'&&saved.checkpoint.fingerprint===simulationFingerprint({...d,cases:[]});
}
function updateResumeAvailability(){if($('#extend'))$('#extend').disabled=!canResume(division());}
function updateRunStatus() {
  if (!run || !$('#run-status')) return;
  const seconds=(performance.now()-run.started)/1000,p=run.progress;
  if(run.kind==='search'){const p=run.progress;$('#run-status').textContent=`Division ${run.divisionId} · 条件探索 · ${seconds.toFixed(1)}秒${p?` · ${BigInt(p.processed).toLocaleString()} / ${BigInt(p.total).toLocaleString()}状態`:''}`;$('#progress').value=p?Number(BigInt(p.processed)*100000n/BigInt(p.total))/1000:0;return;}
  const bundle=results.get(run.divisionId);
  if(run.kind==='monteCarlo'){ $('#run-status').textContent=`Division ${run.divisionId} · モンテカルロ · ${seconds.toFixed(1)}秒 · ${p?BigInt(p.processed).toLocaleString():0} / ${run.goal.toLocaleString()}試行${run.stopping?' · 停止待ち':''}`;$('#progress').value=p?Number(p.processed)/run.goal*100:0;return; }
  const entry=bundle.entries.find(e=>e.id===run.caseId);
  $('#run-status').textContent=`Division ${run.divisionId} · ${entry?.name ?? '準備中'} · ${seconds.toFixed(1)}秒${p?` · ${BigInt(p.processed).toLocaleString()} / ${BigInt(p.total).toLocaleString()}状態`:''}`;
  $('#progress').value=p?Number(BigInt(p.processed)*100000n/BigInt(p.total))/1000:0;
}
function stopRun(message, failed=false) {
  if(run?.kind==='monteCarlo'){
    const saved=results.get(run.divisionId);
    if(saved.status==='running')saved.status=failed?'error':'stopped';
  }
  if(run?.kind==='search'){const saved=searchResults.get(run.divisionId);if(saved.status==='running')saved.status=failed?'error':'cancelled';}
  if (run?.kind!=='monteCarlo'&&run?.kind!=='search'&&run) for (const entry of results.get(run.divisionId).entries) if (entry.status!=='done') entry.status=failed?'error':'cancelled';
  run?.worker.terminate(); run=null;
  clearInterval(timer); lastRunStatus=message;
  $('#calculate').disabled=false;$('#calculate').innerHTML=feature==='conditions'?'必要・十分条件を探索 →':'順位確率を計算 →';
  $('#cancel').hidden=true;$('#cancel').disabled=false;$('#cancel').textContent='中止';$('#progress').hidden=true;$('#run-status').textContent=message;
  renderOutput();
}
function startCalculation(additional=false,automatic=false) {
  if (run) return;
  const errors=validate(data);
  if (errors.length) return notice(errors.join('\n'),true);
  let snapshot;
  if(automatic){
    snapshot=structuredClone(inputDivision());const plan=divisionAutoPlan(snapshot);
    snapshot.explorationMode=plan.explorationMode;snapshot.calculationMethod=plan.calculationMethod;snapshot.simulation.trials=plan.trials;
    if(snapshot.calculationMethod==='monteCarlo'&&!snapshot.simulation.seed)snapshot.simulation.seed=newSeed();
  }else{
    if(division().calculationMethod==='monteCarlo'&&!division().simulation.seed)change(d=>{d.simulation.seed=newSeed();},false);
    snapshot=structuredClone(inputDivision());snapshot.simulation.trials=normalizedTrials(snapshot.simulation.trials);
  }
  const fields=snapshot.explorationMode==='rounds'?['battleDiff','roundDiff']:snapshot.explorationMode==='battles'?['battleDiff']:[];
  const missing=current(snapshot).flatMap(t=>fields.filter(f=>t[f]===null).map(f=>`${team(snapshot,t.teamId).name}：${f==='battleDiff'?'バトル差':'ラウンド差'}`));
  if (missing.length) return notice(`現在の集計値を補完してください。${missing.join('、')}`,true);
  if(snapshot.calculationMethod==='monteCarlo'){startMonteCarlo(snapshot,additional,automatic);return;}
  let worker;
  try { worker=new Worker(new URL('./worker.js?v=score-ranges-1',import.meta.url),{type:'module'}); }
  catch { return notice('計算用Workerを起動できません。HTTP(S)でページを開いてください。',true); }
  clearSavedResults([snapshot.id]);
  results.set(snapshot.id,{fingerprint:fingerprint(snapshot),input:snapshot,viewFingerprint:fingerprint(inputDivision()),automatic,startedAt:new Date().toLocaleString('ja-JP'),entries:[BASE_CASE,...snapshot.cases].map(definition=>({id:definition.id,name:definition.name,definition,status:'pending'}))});
  run={kind:'exact',worker,divisionId:snapshot.id,started:performance.now(),caseId:null,progress:null};
  notice('');render();timer=setInterval(updateRunStatus,250);
  worker.onmessage=({data:message})=>{
    if (!run||run.worker!==worker) return;
    const bundle=results.get(snapshot.id), entry=bundle.entries.find(e=>e.id===message.caseId);
    if (message.type==='case-start') { run.caseId=message.caseId;run.progress=null;entry.status='running';renderOutput();updateRunStatus(); }
    if (message.type==='progress') { run.progress=message;updateRunStatus(); }
    if (message.type==='error') { stopRun('計算に失敗しました',true);notice(message.message,true); }
    if (message.type==='case-done') {
      if (!verifyFractions(message.result).ok) { stopRun('検算エラー',true);notice('確率の検算に失敗したため、このケースの結果を表示しません。',true);return; }
      Object.assign(entry,{status:'done',result:message.result,resolution:message.resolution,modelVersion:message.modelVersion,reused:message.reused,seconds:message.seconds});renderOutput();
    }
    if (message.type==='comparison-done') { const seconds=(performance.now()-run.started)/1000;stopRun(`Division ${snapshot.id} · 計算完了 ${seconds.toFixed(2)}秒`); }
  };
  worker.onerror=event=>{if(run?.worker!==worker)return;event.preventDefault();stopRun('計算用Workerでエラー',true);notice('計算用Workerが停止しました。HTTP(S)で開いているか確認してください。',true);};
  worker.postMessage({type:'comparison',division:snapshot});
}
function startConditionSearch(){
  if(run)return;
  const errors=validate(data);if(errors.length)return notice(errors.join('\n'),true);
  const snapshot=structuredClone(inputDivision()),config=structuredClone(searchConfig());
  try{prepareSearch(snapshot,config);}catch(error){notice(error.message,true);return;}
  let worker;try{worker=new Worker(new URL('./worker.js?v=score-ranges-1',import.meta.url),{type:'module'});}catch{notice('探索用Workerを起動できません。',true);return;}
  const saved={status:'running',input:snapshot,config,fingerprint:searchFingerprint(snapshot,config),result:null,exampleIndex:null};
  searchResults.set(snapshot.id,saved);run={kind:'search',worker,divisionId:snapshot.id,started:performance.now(),progress:null};
  notice('');render();timer=setInterval(updateRunStatus,250);
  worker.onmessage=({data:message})=>{
    if(!run||run.worker!==worker)return;
    if(message.type==='search-progress'){run.progress=message;saved.progress=message;updateRunStatus();}
    if(message.type==='error'){stopRun('条件探索に失敗しました。',true);notice(message.message,true);return;}
    if(message.type==='search-done'){
      if(!verifySearchResult(message.result)||message.result.fingerprint!==saved.fingerprint){stopRun('条件探索の集計検証に失敗しました。',true);notice('結果が入力・代表例と一致しないため表示しません。',true);return;}
      saved.status='done';saved.result=message.result;saved.seconds=(performance.now()-run.started)/1000;
      saved.exampleIndices={};
      saved.exampleLabels={}; // Rendering selects the first available named example.
      stopRun(`条件探索が完了しました · ${saved.seconds.toFixed(2)}秒`);
    }
  };
  worker.onerror=event=>{if(run?.worker!==worker)return;event.preventDefault();stopRun('探索用Workerが停止しました。未完了の保証は表示しません。',true);};
  worker.postMessage({type:'condition-search',division:snapshot,config});
}
function requestStop(){
  if(!run)return;
  if(run.kind==='monteCarlo'){run.stopping=true;$('#cancel').disabled=true;$('#cancel').textContent='停止待ち';run.worker.postMessage({type:'mc-cancel'});updateRunStatus();}
  else stopRun(run.kind==='search'?'条件探索を中止しました。最終的な必要・十分条件は表示しません。':'計算を中止しました。部分集計は表示しません。');
}
function monteCarloBundle(cp,status='restored') {
  return {method:'monteCarlo',input:structuredClone(cp.division),checkpoint:cp,status,startedAt:new Date().toLocaleString('ja-JP'),resolutions:[BASE_CASE,...cp.division.cases].map(c=>prepare(cp.division,c).resolution)};
}
function saveMonteCarlo(cp) {
  const current=data.divisions.find(d=>d.id===cp.division.id);
  // A worker may finish after the user has edited its input. Keep its result
  // visible as stale, but never restore it as the current result on reload.
  if(!current||cp.fingerprint!==simulationFingerprint({...current,cases:[]}))return false;
  try {localStorage.setItem(`sfl-mc:last-${cp.division.id}`,JSON.stringify(cp));return true;}
  catch {notice('モンテカルロ結果をブラウザに保存できません。結果JSONを書き出してください。集計値は画面に保持しています。',true);return false;}
}
function startMonteCarlo(snapshot,additional,automatic=false){
  let cp;
  try {
    if(additional&&!canResume(snapshot))throw new Error('入力・条件・シードが変わっているため追加試行できません。');
    cp=additional?results.get(snapshot.id).checkpoint:emptyCheckpoint(snapshot);
    validateCheckpoint(cp);
    if(!Number.isSafeInteger(cp.completed+snapshot.simulation.trials))throw new Error('総試行数が上限を超えます。');
  }catch(error){notice(error.message,true);return;}
  let worker;
  try{worker=new Worker(new URL('./worker.js?v=score-ranges-1',import.meta.url),{type:'module'});}catch{notice('計算用Workerを起動できません。',true);return;}
  if(!additional)clearSavedResults([snapshot.id]);
  const bundle=monteCarloBundle(cp,'running');bundle.input=snapshot;bundle.viewFingerprint=fingerprint(inputDivision());bundle.automatic=automatic;results.set(snapshot.id,bundle);
  run={kind:'monteCarlo',worker,divisionId:snapshot.id,started:performance.now(),goal:cp.completed+snapshot.simulation.trials,progress:{processed:String(cp.completed)},stopping:false};
  notice('');render();timer=setInterval(updateRunStatus,250);
  worker.onmessage=({data:message})=>{
    if(!run||run.worker!==worker)return;
    if(message.type==='error'){stopRun('計算に失敗しました。最後に受領した集計を保持します。',true);notice(message.message,true);return;}
    if(message.type==='mc-progress'||message.type==='mc-done'){
      try{
        validateCheckpoint(message.checkpoint);
        if(message.checkpoint.fingerprint!==simulationFingerprint(snapshot)||message.checkpoint.completed<bundle.checkpoint.completed||message.checkpoint.completed>run.goal)throw new Error('受領した集計と実行条件が一致しません。');
      }catch(error){stopRun('集計の検証に失敗しました。',true);notice(error.message,true);return;}
      bundle.checkpoint=message.checkpoint;
      run.progress={processed:String(message.checkpoint.completed)};
      if(message.type==='mc-done')bundle.status=message.stopped?'stopped':'complete';
      renderOutput();updateRunStatus();
      if(message.type==='mc-done'){
        saveMonteCarlo(message.checkpoint);
        stopRun(`${message.stopped?'中止・途中結果を保持':'計算完了'} · ${message.checkpoint.completed.toLocaleString()}試行`);
      }
    }
  };
  worker.onerror=event=>{if(run?.worker!==worker)return;event.preventDefault();stopRun('Workerが停止しました。最後の受領済み集計を保持します。',true);notice('Workerが停止しました。結果JSONから追加試行できます。',true);};
  worker.postMessage({type:'mc-start',division:snapshot,trials:snapshot.simulation.trials,checkpoint:additional?cp:null});
}
function importCheckpoint(cp){
  try{
    validateCheckpoint(cp);
    const next=structuredClone(data),index=next.divisions.findIndex(d=>d.id===cp.division.id);
    next.divisions[index]=structuredClone(cp.division);
    if(searchConfigErrors(cp.division,next.conditionSearch[cp.division.id]).length)next.conditionSearch[cp.division.id]=defaultSearchConfig(cp.division);
    const errors=validate(next);if(errors.length)throw new Error(errors.join('\n'));
    const latest=applyUserSettings(defaults,next).data;
    if(cp.fingerprint!==simulationFingerprint({...latest.divisions[index],cases:[]}))throw new Error('この計算結果は現在配信されている成績・日程と一致しないため復元できません。最新データで再計算してください。');
    if(run)stopRun('データ変更のため計算を停止しました。最後の受領済み集計を保持します。');
    data=latest;normalizePresetSettings();active=cp.division.id;page='division';history.replaceState(null,'',`#division/${active}`);feature='probability';results.set(active,monteCarloBundle(cp));persist();const stored=saveMonteCarlo(cp);render();notice(stored?'チェックポイントの計算結果を復元しました。':'チェックポイントは復元しましたが、ブラウザに保存できません。結果JSONで保存してください。',!stored);return true;
  }catch(error){notice(error.message,true);return false;}
}
function download(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function settingsNotice(loaded){
  return loaded.seasonChanged?'大会年度が変わったため、配信データの初期設定を使用します。':`成績・日程は配信データを使用し、計算設定と将来の仮定を読み込みました。${loaded.removed?`終了済み・対戦変更の${loaded.removed}試合の仮定を除外しました。`:''}`;
}
function replaceData(value) {
  if(value?.kind==='sfl-monte-carlo-checkpoint')return importCheckpoint(value);
  let migrated;
  try { migrated=applyUserSettings(defaults,value); } catch(error) { notice(error.message,true);return false; }
  if (run) stopRun('データ変更のため計算を中止しました');
  data=migrated.data;normalizePresetSettings();const route=parseSummaryRoute(location.hash,data);if(route.page==='team')data.conditionSearch[route.divisionId].targetTeamId=route.teamId;results.clear();searchResults.clear();persist();render();notice(settingsNotice(migrated));clearSavedResults(['S','F']);return true;
}
function openResult(id) {
  if(!remaining(division()).some(m=>m.id===id))return;
  editingMatch = id;
  $('#dialog-error').hidden = true;
  const d = division(), m = d.fixtures.find(m => m.id === id);
  $('#match-title').textContent = `第${m.round}節：${team(d,m.homeTeamId).name}（H） vs ${team(d,m.awayTeamId).name}（A）`;
  draftRules=structuredClone(rulesFor(d,id));
  $('#delete-result').hidden=!draftRules.length;
  renderRuleEditor();
  $('#result-dialog').showModal();
}
function bind() {

  for(const [id,key]of [['search-team','targetTeamId'],['search-mode','mode']])if($(`#${id}`))$(`#${id}`).onchange=event=>change((d,next)=>{next.conditionSearch[active][key]=event.target.value;});
  if($('#cost-to-mc'))$('#cost-to-mc').onclick=()=>change(d=>{d.calculationMethod='monteCarlo';if(!d.simulation.seed)d.simulation.seed=newSeed();});

  if($('#calculation-method'))$('#calculation-method').onchange=e=>change(d=>{d.calculationMethod=e.target.value;if(e.target.value==='monteCarlo'&&!d.simulation.seed)d.simulation.seed=newSeed();});
  if($('#mc-preset'))$('#mc-preset').onchange=e=>change(d=>{d.simulation.trials=normalizedTrials(Number(e.target.value));});
  if($('#extend'))$('#extend').onclick=()=>startCalculation(true);
  if($('#exploration-mode'))$('#exploration-mode').onchange=e=>change(d=>{d.explorationMode=e.target.value;});
  if($('#add-case'))$('#add-case').onclick=()=>change(d=>{d.cases.push({id:`case-${crypto.randomUUID()}`,name:`ケース${d.cases.length+1}`,conditions:[]});});
  const findCase=(d,id)=>d.cases.find(c=>c.id===id);
  document.querySelectorAll('[data-case-name]').forEach(el=>el.onchange=()=>change(d=>{findCase(d,el.dataset.caseName).name=el.value;},false));
  document.querySelectorAll('[data-delete-case]').forEach(el=>el.onclick=()=>change(d=>{d.cases=d.cases.filter(c=>c.id!==el.dataset.deleteCase);}));
  document.querySelectorAll('[data-add-condition]').forEach(el=>el.onclick=()=>change(d=>{findCase(d,el.dataset.addCondition).conditions.push({targetTeamId:d.teams[0].id,mode:'win'});}));
  document.querySelectorAll('[data-condition-team]').forEach(el=>el.onchange=()=>change(d=>{findCase(d,el.dataset.conditionTeam).conditions[Number(el.dataset.index)].targetTeamId=el.value;}));
  document.querySelectorAll('[data-condition-mode]').forEach(el=>el.onchange=()=>change(d=>{findCase(d,el.dataset.conditionMode).conditions[Number(el.dataset.index)].mode=el.value;}));
  document.querySelectorAll('[data-delete-condition]').forEach(el=>el.onclick=()=>change(d=>{findCase(d,el.dataset.deleteCondition).conditions.splice(Number(el.dataset.index),1);}));
  document.querySelectorAll('[data-move-condition]').forEach(el=>el.onclick=()=>change(d=>{const list=findCase(d,el.dataset.moveCondition).conditions,i=Number(el.dataset.index),j=i+Number(el.dataset.direction);[list[i],list[j]]=[list[j],list[i]];}));
  document.querySelectorAll('[data-fixed]').forEach(select=>select.onchange=()=>{
    const id=select.dataset.fixed;
    if(select.value==='@rules')return;
    if(!select.value){change(d=>setMatchRules(d,id,[]));return;}
    const [home,away]=select.value.split('-').map(Number);
    const additions=[['homePoints',home],['awayPoints',away]].map(([metric,value])=>({id:crypto.randomUUID(),metric,operator:'eq',value,source:'manual'}));
    if(!change(d=>mergeMatchRules(d,{[id]:additions})))select.value=exactRuleScore(rulesFor(division(),id))??(rulesFor(division(),id).length?'@rules':'');
  });
  document.querySelectorAll('[data-result]').forEach(b => b.onclick = () => openResult(b.dataset.result));
  $('#calculate').onclick = ()=>{
    if(feature==='conditions')startConditionSearch();else startCalculation(false);
    if(run)document.querySelector('.result-panel').scrollIntoView({behavior:'smooth',block:'start'});
  };
  $('#cancel').onclick = requestStop;
  $('#clear-fixed').onclick = () => change(d => { clearMatchRules(d); });
  $('#export').onclick = () => download('sfl-2026-settings.json', userSettings(data));
  if($('#export-result'))$('#export-result').onclick=()=>{if(feature==='conditions'){const saved=searchResults.get(active);download(`sfl-2026-${active}-conditions.json`,saved.status==='done'?saved.result:{kind:'sfl-condition-search-incomplete',complete:false,input:saved.input,config:saved.config,status:saved.status,progress:saved.progress});}else download(`sfl-2026-division-${active}-result.json`,results.get(active).method==='monteCarlo'?results.get(active).checkpoint:results.get(active));};
  $('#import').onclick = () => $('#import-file').click();
  $('#import-file').onchange = async event => {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) return notice('JSONは2MB以下にしてください。', true);
    try { replaceData(JSON.parse(await file.text())); }
    catch { notice('JSONとして読み込めませんでした。元のデータは保持しています。', true); }
  };

  $('#reset').onclick = () => { if (confirm('両ディビジョンの計算設定・将来の仮定・保存済み計算結果を初期化しますか？必要なら先にJSONを書き出してください。')) replaceData(defaults); };
}
function renderRuleEditor(){
  const d=division(),m=d.fixtures.find(m=>m.id===editingMatch),names={...ASSUMPTION_METRICS,homePoints:`${team(d,m.homeTeamId).shortName}（H）の獲得ポイント`,awayPoints:`${team(d,m.awayTeamId).shortName}（A）の獲得ポイント`};
  $('#rule-editor').innerHTML=draftRules.map((r,i)=>`<div class="assumption-rule">${i?'<span class="rule-and">かつ</span>':''}<label>対象・指標<select data-rule-field="metric" data-rule-index="${i}">${Object.entries(names).map(([key,name])=>`<option value="${key}" ${key===r.metric?'selected':''}>${escape(name)}</option>`).join('')}</select></label><label>条件<select data-rule-field="operator" data-rule-index="${i}">${Object.entries(ASSUMPTION_OPERATORS).map(([key,name])=>`<option value="${key}" ${key===r.operator?'selected':''}>${name}</option>`).join('')}</select></label><label>値<input data-rule-field="value" data-rule-index="${i}" type="number" required step="${r.metric.endsWith('Points')?10:1}" min="${r.metric.endsWith('Points')?0:r.metric==='battleDiff'?-9:-60}" max="${r.metric.endsWith('Points')?40:r.metric==='battleDiff'?9:60}" value="${r.value}"></label><button type="button" class="tiny-button secondary-button" data-remove-rule="${i}">削除</button>${r.source==='necessary'?'<small class="rule-source">必要条件から追加</small>':''}</div>`).join('')||'<p class="muted">条件なし：すべての結果を探索します。</p>';
  document.querySelectorAll('[data-rule-field]').forEach(el=>el.oninput=()=>{
    const r=draftRules[Number(el.dataset.ruleIndex)],key=el.dataset.ruleField;r[key]=key==='value'?(el.value===''?NaN:Number(el.value)):el.value;
    if(key==='metric'){r.value=0;renderRuleEditor();}else previewRules();
  });
  document.querySelectorAll('[data-remove-rule]').forEach(el=>el.onclick=()=>{draftRules.splice(Number(el.dataset.removeRule),1);renderRuleEditor();});
  previewRules();
}
function previewRules(){
  const d=division(),m=d.fixtures.find(m=>m.id===editingMatch),resolved=resolveMatch(m,{},[]);
  try{
    const errors=ruleErrors(draftRules);if(errors.length)throw new Error(errors.join(' '));
    const full=filterRuleOutcomes('rounds',resolved,draftRules);
    const allowed=new Set(full.map(([h,a])=>`${h}-${a}`)),scores=SCORES.filter(([h,a])=>allowed.has(`${h}-${a}`)).map(([h,a])=>`${h}–${a}`);
    $('#rule-preview').textContent=`許されるスコア（H–A）：${scores.join(' / ')}。バトル ${filterRuleOutcomes('battles',resolved,draftRules).length}状態・ラウンド ${full.length}状態。`;
    $('#rule-preview').classList.remove('error');$('#save-rules').disabled=false;$('#dialog-error').hidden=true;
  }catch(error){$('#rule-preview').textContent=`${error.message} ${draftRules.map((r,i)=>`条件${i+1}：${ruleText(r,team(d,m.homeTeamId).shortName,team(d,m.awayTeamId).shortName)}`).join(' ／ ')}`;$('#rule-preview').classList.add('error');$('#save-rules').disabled=true;}
}
$('#add-rule').onclick=()=>{draftRules.push({id:crypto.randomUUID(),metric:'homePoints',operator:'gte',value:0,source:'manual'});renderRuleEditor();};
$('#close-dialog').onclick=()=>$('#result-dialog').close();
$('#result-form').onsubmit=event=>{
  event.preventDefault();previewRules();if($('#save-rules').disabled)return;
  if(change(d=>setMatchRules(d,editingMatch,draftRules)))$('#result-dialog').close();
};
$('#delete-result').onclick=()=>{if(change(d=>setMatchRules(d,editingMatch,[])))$('#result-dialog').close();};

try {
  const response = await fetch(new URL('../data/default.json', import.meta.url),{cache:'no-store'});
  if (!response.ok) throw new Error('標準データを取得できません。');
  defaults = migrateData(await response.json());
  const errors = validate(defaults); if (errors.length) throw new Error(errors.join('\n'));
  data = structuredClone(defaults);
  let saveOnLoad=true;
  try {
    const stored = localStorage.getItem(STORE) ?? localStorage.getItem('sfl-rank-probability:v3') ?? localStorage.getItem('sfl-rank-probability:v2') ?? localStorage.getItem('sfl-rank-probability:v1');
    if (stored) {
      const parsed = JSON.parse(stored);
      const loaded=applyUserSettings(defaults,parsed);data=loaded.data;
      if(loaded.removed||loaded.seasonChanged)notice(settingsNotice(loaded));
    }
  } catch { saveOnLoad=false;storageStatus = '保存設定を読み込めませんでした。最新の配信データと初期設定を使用しています。';notice('保存設定の形式が合わないため復元しませんでした。成績・日程は最新の配信データです。',true); }
  normalizePresetSettings();
  if(saveOnLoad)persist();
  for(const d of data.divisions)try{
    const cp=restoreMatchingCheckpoint(localStorage,{...d,cases:[]});
    if(cp)results.set(d.id,monteCarloBundle(cp));
  }catch{notice('保存済みモンテカルロ結果を復元できませんでした。現在の入力から再計算してください。',true);}
  enterSummary();
} catch (error) {
  $('#app').textContent = '読み込みに失敗しました。ページをHTTP(S)経由で開き、再読み込みしてください。';
  notice(error.message, true);
}
