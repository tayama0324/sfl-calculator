import { SCORES, EXPLORATION_MODES, CALCULATION_METHODS, rankingLabel, prepare, scoreKey, remaining, current, validate, verifyFractions, migrateData, BASE_CASE } from './model.js';
import { escape, modeNotice, renderCases, renderComparison } from './comparison-ui.js';
import { simulationFingerprint, validateCheckpoint, emptyCheckpoint } from './monte-carlo.js';
import { newSeed } from './random.js';
import {prepareSearch,searchFingerprint,verifySearchResult} from './condition-search.js';
import {renderSearchControls,renderSearchResult,searchNotice} from './condition-search-ui.js';
import {renderCost} from './exhaustive-cost.js';
import {defaultSearchConfig,searchConfigErrors} from './search-config.js';

const $ = s => document.querySelector(s);
const STORE = 'sfl-rank-probability:v3';
const teamColors = ['#c0adff', '#ff9355', '#ffd270', '#91cdb0', '#eb7c87', '#7cb9e7'];
const signed = n => n === null ? '不明' : `${n > 0 ? '+' : ''}${n}`;
let defaults, data, active = 'S', storageStatus = 'このブラウザに自動保存', editingMatch = null;
let run = null, lastRunStatus = '', timer, feature='probability';
const searchResults=new Map();
const searchConfig=()=>data.conditionSearch[active];
const results = new Map();
const division = () => data.divisions.find(d => d.id === active);
const fingerprint = d => JSON.stringify(d);
const team = (d, id) => d.teams.find(t => t.id === id);
const notice = (text, error = false) => {
  $('#message').textContent = text; $('#message').classList.toggle('error', error); $('#message').hidden = !text;
  if ($('#result-dialog').open) { $('#dialog-error').textContent = error ? text : ''; $('#dialog-error').hidden = !error; }
};
function persist() {
  try { localStorage.setItem(STORE, JSON.stringify(data)); storageStatus = 'このブラウザに自動保存済み'; }
  catch { storageStatus = '保存できません。JSONを書き出してください。'; }
}
function change(mutator, renderPage = true) {
  const next = structuredClone(data);
  mutator(next.divisions.find(d => d.id === active), next);
  for(const d of next.divisions)if(next.conditionSearch?.[d.id]&&next.conditionSearch[d.id].caseId!=='@normal'&&!d.cases.some(c=>c.id===next.conditionSearch[d.id].caseId))next.conditionSearch[d.id].caseId='@normal';
  const errors = validate(next);
  if (errors.length) { notice(errors.join('\n'), true); return false; }
  data = next;
  persist(); notice('');
  if (renderPage) render();
  else { renderOutput(); $('#json-data').value=JSON.stringify(data,null,2); }
  return true;
}
function scoreOptions(selected = '', placeholder = '指定なし · 通常の確率分布') {
  return `<option value="">${placeholder}</option>` + SCORES.map(([h, a]) => `<option value="${scoreKey(h, a)}" ${selected === scoreKey(h, a) ? 'selected' : ''}>${h} – ${a}${h + a === 50 ? '（延長）' : ''}</option>`).join('');
}
function renderResult(d) { return feature==='conditions'?renderSearchResult(searchResults.get(d.id),d,searchConfig()):renderComparison(results.get(d.id),d); }
function bindExampleButtons(){document.querySelectorAll('[data-search-example]').forEach(button=>button.onclick=()=>{const saved=searchResults.get(active);if(saved?.status==='done'){saved.exampleIndex=Number(button.dataset.searchExample);renderOutput();}});}
function renderOutput() {
  const target=$('#result-content');
  if (!target) return;
  const open=[...target.querySelectorAll('details[open]')].map(el=>el.id).filter(Boolean);
  target.innerHTML=renderResult(division());
  updateResumeAvailability();bindExampleButtons();
  for (const id of open) target.querySelector(`#${CSS.escape(id)}`)?.setAttribute('open','');
}
function renderFixture(d, m) {
  const result = d.results[m.id];
  return `<article class="fixture ${result ? 'done' : ''}"><div class="fixture-top"><span>${escape(m.scheduledAt || '日付未設定')}</span><span>${result ? '結果登録済み' : '未消化'}</span></div><div class="fixture-teams"><span><small>H</small>${escape(team(d, m.homeTeamId).shortName)}</span><span class="versus">VS</span><span><small>A</small>${escape(team(d, m.awayTeamId).shortName)}</span></div>${result ? `<div class="fixture-score">${result.homePoints} – ${result.awayPoints}</div>` : `<label class="sr-label"><span class="muted" style="font-size:10px;margin-top:10px">仮定スコア（ホーム – アウェイ）</span><select data-fixed="${escape(m.id)}" aria-label="第${m.round}節 ${escape(team(d,m.homeTeamId).name)} 対 ${escape(team(d,m.awayTeamId).name)} の仮定">${scoreOptions(d.fixedScores[m.id])}</select></label>`}<div class="fixture-actions"><button class="tiny-button secondary-button" data-result="${escape(m.id)}">${result ? '訂正・取り消し' : '実結果を登録 ↗'}</button></div></article>`;
}
function render() {
  const focused = document.activeElement;
  const focusId = focused?.id;
  const focusFixed = focused?.dataset?.fixed;
  const d = division(), rows = current(d), pending = remaining(d);
  const c=searchConfig(),visibleMode=feature==='conditions'?c.mode:d.explorationMode;
  $('.model-notice p').innerHTML = feature==='conditions'?searchNotice(c):modeNotice(d.explorationMode,d.calculationMethod);
  const included = new Set(d.baseline.includedMatchIds);
  const editable = d.fixtures.filter(m => !included.has(m.id));
  const sorted = rows.toSorted((a, b) => b.points - a.points);
  $('#app').innerHTML = `
  <nav class="feature-nav" aria-label="機能"><button data-feature="probability" aria-pressed="${feature==='probability'}" class="${feature==='probability'?'selected':''}">順位確率</button><button data-feature="conditions" aria-pressed="${feature==='conditions'}" class="${feature==='conditions'?'selected':''}">必要・十分条件の探索</button></nav>
  <div class="division-nav"><div class="tabs" role="tablist" aria-label="ディビジョン"><button role="tab" aria-selected="${active === 'S'}" class="tab ${active === 'S' ? 'active' : ''}" data-division="S">Division <span>S</span></button><button role="tab" aria-selected="${active === 'F'}" class="tab ${active === 'F' ? 'active' : ''}" data-division="F">Division <span>F</span></button></div><span class="baseline-date">基準日 ${escape(d.baseline.asOf)}<br>日程：二次資料参照・公式未照合</span></div>
  <div class="stats"><div class="stat"><span class="label">REMAINING / 残り試合</span><strong>${pending.length}<small>/ 30試合</small></strong></div><div class="stat"><span class="label">PLAYOFF SPOTS / 進出枠</span><strong>3<small>/ 6チーム</small></strong></div><div class="stat"><span class="label">METHOD / 計算方法</span><strong style="font-size:19px">${feature==='conditions'?'条件探索':d.calculationMethod==='monteCarlo'?'推定':'厳密集計'}<small>${visibleMode === 'points' ? 'ポイント' : visibleMode === 'battles' ? 'バトル' : 'ラウンド'}</small></strong></div></div>
  <div class="layout">
    <section class="panel"><div class="section-heading"><div><div class="kicker">01 / STANDINGS</div><h2>現在のチーム状況</h2></div><span class="tag">ポイント順</span></div><div class="scroll-table"><table aria-label="現在の順位表"><thead><tr><th>チーム</th><th>消化</th><th>ポイント</th><th>バトル差</th><th>ラウンド差</th></tr></thead><tbody>${sorted.map(t => `<tr><td class="team-name"><span class="team-code" style="--team-color:${teamColors[d.teams.findIndex(x => x.id === t.teamId)]}"></span>${escape(team(d, t.teamId).name)}</td><td class="muted">${t.played}/10</td><td class="points">${t.points}</td><td class="muted">${signed(t.battleDiff)}</td><td class="muted">${signed(t.roundDiff)}</td></tr>`).join('')}</tbody></table></div><div class="panel-foot">同ポイントの行の表示順は順位を意味しません。比較に使用する得失点差は探索モードで決まります。</div>
    <details><summary>基準となる集計値を編集</summary><p class="muted">基準日までの累計です。下で登録する実結果は、この値に追加されます。基準に含む日程を変える場合はJSON編集を使用してください。</p><form id="baseline-form" class="editor"><label>基準日<input type="date" name="asOf" value="${escape(d.baseline.asOf)}" required></label><div class="scroll-table"><table><thead><tr><th>チーム</th><th>ポイント</th><th>バトル差</th><th>ラウンド差</th></tr></thead><tbody>${d.baseline.standings.map(t => `<tr><td>${escape(team(d,t.teamId).shortName)}</td>${['points','battleDiff','roundDiff'].map(field => `<td><input type="number" step="${field === 'points' ? 10 : 1}" ${field === 'points' ? 'min="0" required' : ''} name="${t.teamId}:${field}" value="${t[field] === null ? '' : t[field]}" aria-label="${escape(team(d,t.teamId).name)} ${field}"></td>`).join('')}</tr>`).join('')}</tbody></table></div><label class="rebase-choice"><input id="rebase-current" type="checkbox">入力を現在の累計として再設定する（登録結果を基準へ統合）</label><p class="muted">チェックすると現在値を入力欄へ反映します。不明な累計差を補完し、基準日を確認して保存してください。統合後は個別結果の訂正ではなく基準値を編集します。</p><button type="submit" class="tiny-button">基準値を保存</button></form></details></section>
    ${feature==='probability'?`<aside class="panel condition-panel"><div class="section-heading"><div><div class="kicker">02 / EXPLORATION</div><h2>計算方式・順位判定</h2></div></div><div class="condition-body"><label>計算方式<select id="calculation-method">${Object.entries(CALCULATION_METHODS).map(([id,name])=>`<option value="${id}" ${d.calculationMethod===id?'selected':''}>${name}</option>`).join('')}</select></label><label>順位判定<select id="exploration-mode">${Object.entries(EXPLORATION_MODES).map(([id,name])=>`<option value="${id}" ${d.explorationMode===id?'selected':''}>${rankingLabel(id,d.calculationMethod)}</option>`).join('')}</select></label>${renderSimulationSettings(d)}${d.calculationMethod==='exact'?renderCost(d):''}<p class="condition-note">詳細モードは各バトル／ラウンドの勝率50%・独立を仮定します。計算時間に上限はありません。${d.calculationMethod==='monteCarlo'?'全ケースを同じ試行番号で計算します。同点による範囲と、有限試行の95%区間を分けて表示します。':'モードによっては非常に多くの状態を探索します。'}</p><div class="run-area"><div class="calc-actions"><button class="primary-button run-button" id="calculate" ${run?'disabled':''}>${run?'計算実行中':'順位確率を計算'} <span aria-hidden="true">→</span></button><button id="cancel" ${run?'':'hidden'} ${run?.stopping?'disabled':''}>${run?.stopping?'停止待ち':'中止'}</button></div><button id="extend" class="tiny-button secondary-button" ${d.calculationMethod==='monteCarlo'?'':'hidden'} ${canResume(d)?'':'disabled'}>指定回数を追加試行</button><progress id="progress" max="100" value="0" ${run?'':'hidden'} aria-label="計算の進捗"></progress><div id="run-status" class="run-status" role="status">${escape(lastRunStatus || `基準＋${d.cases.length}ケースを順に計算`)}</div></div></div></aside>`:renderSearchControls(d,c,run,lastRunStatus)}
    ${feature==='probability'?renderCases(d):''}
    <section class="panel result-panel"><div class="section-heading"><div><div class="kicker">03 / PROBABILITY</div><h2>${feature==='conditions'?'必要条件・十分条件':'最終順位の確率'}</h2></div><div class="result-toolbar"><span class="tag">${feature==='conditions'?'厳密条件探索':escape(rankingLabel(results.get(d.id)?.input.explorationMode ?? d.explorationMode,results.get(d.id)?.input.calculationMethod ?? d.calculationMethod))}</span>${(feature==='conditions'?searchResults.has(d.id):results.has(d.id)) ? '<button class="tiny-button secondary-button" id="export-result">結果JSON ↗</button>' : ''}</div></div><div id="result-content">${renderResult(d)}</div></section>
  </div>
  <section class="panel"><div class="section-heading"><div><div class="kicker">04 / FIXTURES & RESULTS</div><h2>残り日程・登録結果</h2></div><button class="tiny-button secondary-button" id="clear-fixed">仮定をすべて解除</button></div><div class="data-note">全日程は格ゲーチェッカーの対戦表を参照。公式ページとの直接照合は未完了です。H＝ホーム、A＝アウェイ。スコアの向きに注意してください。</div>${[...new Set(editable.map(m => m.round))].map(r => `<h3 class="round-title" style="margin-top:16px">第${r}節</h3><div class="fixtures">${editable.filter(m => m.round === r).map(m => renderFixture(d,m)).join('')}</div>`).join('')}<details><summary>基準に含まれる過去の試合（${included.size}試合）</summary><p class="muted">個別の実結果は保持していません。累計値として基準順位表に含まれています。</p><div class="scroll-table"><table><thead><tr><th>節</th><th>ホーム</th><th>アウェイ</th></tr></thead><tbody>${d.fixtures.filter(m => included.has(m.id)).map(m => `<tr><td>第${m.round}節</td><td>${escape(team(d,m.homeTeamId).name)}</td><td>${escape(team(d,m.awayTeamId).name)}</td></tr>`).join('')}</tbody></table></div></details></section>
  <section class="panel"><div class="data-tools"><div><h3>データの保存・読み込み</h3><p class="storage-status">${escape(storageStatus)}</p></div><div class="data-tools-buttons"><button class="tiny-button" id="export">設定JSONを書き出す ↗</button><button class="tiny-button" id="import">JSONを読み込む</button><input id="import-file" type="file" accept=".json,application/json" hidden><button class="tiny-button secondary-button" id="reset">初期データに戻す</button></div></div><details id="advanced"><summary>日程・大会データをJSONで編集（詳細設定）</summary><p class="muted">両ディビジョンのデータを編集します。変更は「検証して適用」を押すまで反映されません。対戦日程・チーム名・基準に含む試合も変更できます。</p><div class="json-editor"><label for="json-data">大会データJSON</label><textarea id="json-data" spellcheck="false">${escape(JSON.stringify(data,null,2))}</textarea><button class="tiny-button" id="apply-json">検証して適用</button></div></details><details><summary>計算モデルと精度について</summary><p class="muted">40–0 / 30–10 / 30–20 / 20–30 / 10–30 / 0–40 の重みは1 / 2 / 1 / 1 / 2 / 1です。6通りは等確率ではありません。条件で残った候補を正規化します。厳密方式は全組み合わせを整数の重みで集計し、モンテカルロは同じ分布から抽選して寄与を集計します。ポイントモードは同ポイントを均等配分し、詳細モードは未解決同点を上下限で表示します。各比較ケースは、試合別固定→先行条件の順に優先します。計算時間の上限は設けていません。厳密計算はタブを閉じると停止します。モンテカルロは中止・完了時のチェックポイント、または書き出したJSONから追加試行できます。詳細モードではバトル／ラウンドの勝率も50%・独立と仮定し、延長を含む整合した試合結果を集計します。未解決同点とPO境界の同点の確率、厳密な分数、計算時の入力、スキップ理由は結果JSONから保存できます。</p></details></section>`;
  bind(); bindExampleButtons(); updateRunStatus(); updateResumeAvailability();
  if (focusId && $(`#${CSS.escape(focusId)}`)) $(`#${CSS.escape(focusId)}`).focus({ preventScroll: true });
  else if (focusFixed) $(`[data-fixed="${CSS.escape(focusFixed)}"]`)?.focus({ preventScroll: true });
}
function renderSimulationSettings(d) {
  if(d.calculationMethod!=='monteCarlo')return '';
  const trials=d.simulation.trials;
  return `<div class="simulation-settings"><label>試行回数の候補<select id="mc-preset">${[10000,100000,1000000].map(n=>`<option value="${n}" ${trials===n?'selected':''}>${n.toLocaleString()}回</option>`).join('')}<option value="custom" ${[10000,100000,1000000].includes(trials)?'':'selected'}>任意指定</option></select></label><label>試行回数（追加時は追加する回数）<input id="mc-trials" type="number" min="1" max="${Number.MAX_SAFE_INTEGER}" step="1" required value="${trials}"></label><label>乱数シード<input id="mc-seed" type="text" maxlength="256" value="${escape(d.simulation.seed)}" placeholder="空欄なら自動生成"></label><button class="tiny-button secondary-button" id="new-seed">シードを自動生成</button></div>`;
}
function canResume(d) {
  const saved=results.get(d.id);
  return !run&&d.calculationMethod==='monteCarlo'&&saved?.method==='monteCarlo'&&saved.checkpoint.fingerprint===simulationFingerprint(d);
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
function startCalculation(additional=false) {
  if (run) return;
  const errors=validate(data);
  if (errors.length) return notice(errors.join('\n'),true);
  if(division().calculationMethod==='monteCarlo'){if(!$('#mc-trials').reportValidity())return;if(!division().simulation.seed){change(d=>{d.simulation.seed=newSeed();},false);$('#mc-seed').value=division().simulation.seed;}}
  const snapshot=structuredClone(division());
  const fields=snapshot.explorationMode==='rounds'?['battleDiff','roundDiff']:snapshot.explorationMode==='battles'?['battleDiff']:[];
  const missing=current(snapshot).flatMap(t=>fields.filter(f=>t[f]===null).map(f=>`${team(snapshot,t.teamId).name}：${f==='battleDiff'?'バトル差':'ラウンド差'}`));
  if (missing.length) return notice(`現在の集計値を補完してください。${missing.join('、')}`,true);
  if(snapshot.calculationMethod==='monteCarlo'){startMonteCarlo(snapshot,additional);return;}
  let worker;
  try { worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'}); }
  catch { return notice('計算用Workerを起動できません。HTTP(S)でページを開いてください。',true); }
  results.set(snapshot.id,{fingerprint:fingerprint(snapshot),input:snapshot,startedAt:new Date().toLocaleString('ja-JP'),entries:[BASE_CASE,...snapshot.cases].map(definition=>({id:definition.id,name:definition.name,definition,status:'pending'}))});
  run={kind:'exact',worker,divisionId:snapshot.id,started:performance.now(),caseId:null,progress:null};
  notice('');render();timer=setInterval(updateRunStatus,250);
  worker.onmessage=({data:message})=>{
    if (!run) return;
    const bundle=results.get(snapshot.id), entry=bundle.entries.find(e=>e.id===message.caseId);
    if (message.type==='case-start') { run.caseId=message.caseId;run.progress=null;entry.status='running';renderOutput();updateRunStatus(); }
    if (message.type==='progress') { run.progress=message;updateRunStatus(); }
    if (message.type==='error') { stopRun('計算に失敗しました',true);notice(message.message,true); }
    if (message.type==='case-done') {
      if (!verifyFractions(message.result).ok) { stopRun('検算エラー',true);notice('確率の検算に失敗したため、このケースの結果を表示しません。',true);return; }
      Object.assign(entry,{status:'done',result:message.result,resolution:message.resolution,modelVersion:message.modelVersion,reused:message.reused,seconds:message.seconds});renderOutput();
    }
    if (message.type==='comparison-done') { const seconds=(performance.now()-run.started)/1000;stopRun(`Division ${snapshot.id} · 全ケース完了 ${seconds.toFixed(2)}秒`); }
  };
  worker.onerror=event=>{event.preventDefault();stopRun('計算用Workerでエラー',true);notice('計算用Workerが停止しました。HTTP(S)で開いているか確認してください。',true);};
  worker.postMessage({type:'comparison',division:snapshot});
}
function startConditionSearch(){
  if(run)return;
  const errors=validate(data);if(errors.length)return notice(errors.join('\n'),true);
  const snapshot=structuredClone(division()),config=structuredClone(searchConfig());
  try{prepareSearch(snapshot,config);}catch(error){notice(error.message,true);return;}
  let worker;try{worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});}catch{notice('探索用Workerを起動できません。',true);return;}
  const saved={status:'running',input:snapshot,config,fingerprint:searchFingerprint(snapshot,config),result:null,exampleIndex:null};
  searchResults.set(snapshot.id,saved);run={kind:'search',worker,divisionId:snapshot.id,started:performance.now(),progress:null};
  notice('');render();timer=setInterval(updateRunStatus,250);
  worker.onmessage=({data:message})=>{
    if(!run)return;
    if(message.type==='search-progress'){run.progress=message;saved.progress=message;updateRunStatus();}
    if(message.type==='error'){stopRun('条件探索に失敗しました。',true);notice(message.message,true);return;}
    if(message.type==='search-done'){
      if(!verifySearchResult(message.result)||message.result.fingerprint!==saved.fingerprint){stopRun('条件探索の集計検証に失敗しました。',true);notice('結果が入力・代表例と一致しないため表示しません。',true);return;}
      saved.status='done';saved.result=message.result;saved.seconds=(performance.now()-run.started)/1000;
      saved.exampleIndex=message.result.analysis.points.counterexample??message.result.analysis.points.necessaryWitness??0;
      stopRun(`条件探索が完了しました · ${saved.seconds.toFixed(2)}秒`);
    }
  };
  worker.onerror=event=>{event.preventDefault();stopRun('探索用Workerが停止しました。未完了の保証は表示しません。',true);};
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
  try {localStorage.setItem(`sfl-mc:last-${cp.division.id}`,JSON.stringify(cp));return true;}
  catch {notice('モンテカルロ結果をブラウザに保存できません。結果JSONを書き出してください。集計値は画面に保持しています。',true);return false;}
}
function startMonteCarlo(snapshot,additional){
  let cp;
  try {
    if(additional&&!canResume(snapshot))throw new Error('入力・条件・シードが変わっているため追加試行できません。');
    cp=additional?results.get(snapshot.id).checkpoint:emptyCheckpoint(snapshot);
    validateCheckpoint(cp);
    if(!Number.isSafeInteger(cp.completed+snapshot.simulation.trials))throw new Error('総試行数が上限を超えます。');
  }catch(error){notice(error.message,true);return;}
  let worker;
  try{worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});}catch{notice('計算用Workerを起動できません。',true);return;}
  const bundle=monteCarloBundle(cp,'running');bundle.input=snapshot;results.set(snapshot.id,bundle);
  run={kind:'monteCarlo',worker,divisionId:snapshot.id,started:performance.now(),goal:cp.completed+snapshot.simulation.trials,progress:{processed:String(cp.completed)},stopping:false};
  notice('');render();timer=setInterval(updateRunStatus,250);
  worker.onmessage=({data:message})=>{
    if(!run)return;
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
  worker.onerror=event=>{event.preventDefault();stopRun('Workerが停止しました。最後の受領済み集計を保持します。',true);notice('Workerが停止しました。結果JSONから追加試行できます。',true);};
  worker.postMessage({type:'mc-start',division:snapshot,trials:snapshot.simulation.trials,checkpoint:additional?cp:null});
}
function importCheckpoint(cp){
  try{
    validateCheckpoint(cp);
    const next=structuredClone(data),index=next.divisions.findIndex(d=>d.id===cp.division.id);
    next.divisions[index]=structuredClone(cp.division);
    if(searchConfigErrors(cp.division,next.conditionSearch[cp.division.id]).length)next.conditionSearch[cp.division.id]=defaultSearchConfig(cp.division);
    const errors=validate(next);if(errors.length)throw new Error(errors.join('\n'));
    if(run)stopRun('データ変更のため計算を停止しました。最後の受領済み集計を保持します。');
    data=next;active=cp.division.id;feature='probability';results.set(active,monteCarloBundle(cp));persist();const stored=saveMonteCarlo(cp);render();notice(stored?'チェックポイントを復元しました。指定回数を追加試行できます。':'チェックポイントは復元しましたが、ブラウザに保存できません。結果JSONで保存してください。',!stored);return true;
  }catch(error){notice(error.message,true);return false;}
}
function download(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function replaceData(value) {
  if(value?.kind==='sfl-monte-carlo-checkpoint')return importCheckpoint(value);
  let migrated;
  try { migrated=migrateData(value); } catch(error) { notice(error.message,true);return false; }
  if (run) stopRun('データ変更のため計算を中止しました');
  data=migrated;results.clear();searchResults.clear();persist();render();notice('データを検証して読み込みました。');return true;
}
function openResult(id) {
  editingMatch = id;
  $('#dialog-error').hidden = true;
  const d = division(), m = d.fixtures.find(m => m.id === id), r = d.results[id];
  $('#match-title').textContent = `第${m.round}節：${team(d,m.homeTeamId).name}（H） vs ${team(d,m.awayTeamId).name}（A）`;
  const form = $('#result-form');
  form.elements.score.innerHTML = scoreOptions(r ? scoreKey(r.homePoints,r.awayPoints) : '', 'スコアを選択');
  form.elements.battle.value = r?.homeBattleDiffDelta ?? '';
  form.elements.round.value = r?.homeRoundDiffDelta ?? '';
  $('#delete-result').hidden = !r;
  $('#result-dialog').showModal();
}
function bind() {
  document.querySelectorAll('[data-feature]').forEach(button=>button.onclick=()=>{feature=button.dataset.feature;render();});
  if($('#search-team'))for(const [id,key]of [['search-team','targetTeamId'],['search-goal','goal'],['search-mode','mode'],['search-context','caseId']])$(`#${id}`).onchange=event=>change((d,next)=>{next.conditionSearch[active][key]=event.target.value;});
  if($('#cost-to-mc'))$('#cost-to-mc').onclick=()=>change(d=>{d.calculationMethod='monteCarlo';if(!d.simulation.seed)d.simulation.seed=newSeed();});
  document.querySelectorAll('[data-division]').forEach(b => b.onclick = () => { active = b.dataset.division; render(); });
  if($('#calculation-method'))$('#calculation-method').onchange=e=>change(d=>{d.calculationMethod=e.target.value;if(e.target.value==='monteCarlo'&&!d.simulation.seed)d.simulation.seed=newSeed();});
  if($('#mc-trials')){
    $('#mc-trials').onchange=e=>{if(change(d=>{d.simulation.trials=Number(e.target.value);},false))$('#mc-preset').value=[10000,100000,1000000].includes(division().simulation.trials)?String(division().simulation.trials):'custom';};
    $('#mc-preset').onchange=e=>{if(e.target.value!=='custom')change(d=>{d.simulation.trials=Number(e.target.value);});else $('#mc-trials').focus();};
    $('#mc-seed').onchange=e=>change(d=>{d.simulation.seed=e.target.value;},false);
    $('#new-seed').onclick=()=>{change(d=>{d.simulation.seed=newSeed();},false);$('#mc-seed').value=division().simulation.seed;};
  }
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
  document.querySelectorAll('[data-fixed]').forEach(s => s.onchange = () => change(d => { if (s.value) d.fixedScores[s.dataset.fixed] = s.value; else delete d.fixedScores[s.dataset.fixed]; }));
  document.querySelectorAll('[data-result]').forEach(b => b.onclick = () => openResult(b.dataset.result));
  $('#calculate').onclick = ()=>feature==='conditions'?startConditionSearch():startCalculation(false);
  $('#cancel').onclick = requestStop;
  $('#clear-fixed').onclick = () => change(d => { d.fixedScores = {}; for (const c of d.cases) c.conditions=[]; });
  $('#rebase-current').onchange=event=>{const rows=event.target.checked?current(division()):division().baseline.standings,form=$('#baseline-form');for(const row of rows)for(const field of ['points','battleDiff','roundDiff'])form.elements[`${row.teamId}:${field}`].value=row[field]??'';};
  $('#baseline-form').onsubmit = event => {
    event.preventDefault(); const form = event.target;
    change(d => {
      if ($('#rebase-current').checked) {
        const rows=current(d);
        d.baseline.includedMatchIds.push(...Object.keys(d.results));
        d.baseline.standings=rows;
        d.results={};
      }
      d.baseline.asOf = form.elements.asOf.value;
      for (const row of d.baseline.standings) for (const field of ['points','battleDiff','roundDiff']) {
        const value = form.elements[`${row.teamId}:${field}`].value;
        row[field] = value === '' ? null : Number(value);
      }
    });
  };
  $('#export').onclick = () => download('sfl-2026-settings.json', data);
  if($('#export-result'))$('#export-result').onclick=()=>{if(feature==='conditions'){const saved=searchResults.get(active);download(`sfl-2026-${active}-conditions.json`,saved.status==='done'?saved.result:{kind:'sfl-condition-search-incomplete',complete:false,input:saved.input,config:saved.config,status:saved.status,progress:saved.progress});}else download(`sfl-2026-division-${active}-result.json`,results.get(active).method==='monteCarlo'?results.get(active).checkpoint:results.get(active));};
  $('#import').onclick = () => $('#import-file').click();
  $('#import-file').onchange = async event => {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) return notice('JSONは2MB以下にしてください。', true);
    try { replaceData(JSON.parse(await file.text())); }
    catch { notice('JSONとして読み込めませんでした。元のデータは保持しています。', true); }
  };
  $('#apply-json').onclick = () => { try { replaceData(JSON.parse($('#json-data').value)); } catch { notice('JSONの書式が不正です。元のデータは保持しています。', true); } };
  $('#reset').onclick = () => { if (confirm('両ディビジョンの編集内容と仮定を初期データに戻しますか？必要なら先にJSONを書き出してください。')) replaceData(defaults); };
}
$('#close-dialog').onclick = () => $('#result-dialog').close();
$('#result-form').onsubmit = event => {
  event.preventDefault(); const form = event.target;
  const [h, a] = form.elements.score.value.split('-').map(Number);
  const ok = change(d => {
    d.results[editingMatch] = { homePoints: h, awayPoints: a, homeBattleDiffDelta: form.elements.battle.value === '' ? null : Number(form.elements.battle.value), homeRoundDiffDelta: form.elements.round.value === '' ? null : Number(form.elements.round.value) };
    delete d.fixedScores[editingMatch];
  });
  if (ok) $('#result-dialog').close();
};
$('#delete-result').onclick = () => { if (change(d => { delete d.results[editingMatch]; })) $('#result-dialog').close(); };

try {
  const response = await fetch(new URL('../data/default.json', import.meta.url));
  if (!response.ok) throw new Error('標準データを取得できません。');
  defaults = migrateData(await response.json());
  const errors = validate(defaults); if (errors.length) throw new Error(errors.join('\n'));
  data = structuredClone(defaults);
  let saveOnLoad=true;
  try {
    const stored = localStorage.getItem(STORE) ?? localStorage.getItem('sfl-rank-probability:v2') ?? localStorage.getItem('sfl-rank-probability:v1');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (validate(parsed).length) { saveOnLoad=false;storageStatus='保存済みデータは未変更。標準データを表示しています。';notice('保存データの形式が合わないため、標準データで開きました。保存済みデータは上書きしていません。', true); }
      else data = migrateData(parsed);
    }
  } catch { saveOnLoad=false;storageStatus = '保存データを読み込めません。JSONで保存してください。'; }
  if(saveOnLoad)persist();
  for(const id of ['S','F'])try{const stored=localStorage.getItem(`sfl-mc:last-${id}`);if(stored){const cp=JSON.parse(stored);validateCheckpoint(cp);results.set(id,monteCarloBundle(cp));}}catch{notice('保存済みモンテカルロ結果を復元できませんでした。保存データは上書きしていません。',true);}
  render();
} catch (error) {
  $('#app').textContent = '読み込みに失敗しました。ページをHTTP(S)経由で開き、再読み込みしてください。';
  notice(error.message, true);
}
