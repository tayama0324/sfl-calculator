import {qualificationTrends} from './qualification-trends.js';
import {formatTeamPercent} from './team-summary-ui.js?v=qualification-trends-1';
const goals=['1位通過','2位以内','PO進出'];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function deltaText(value,denominator,signed=true){
  const n=BigInt(value),d=BigInt(denominator),absolute=n<0n?-n:n,rounded=(absolute*10000n+d/2n)/d;
  return `${signed&&rounded!==0n?(n<0n?'−':'+'):''}${rounded/100n}.${String(rounded%100n).padStart(2,'0')}pt`;
}
export function renderQualificationTrendBody(summary,division,options={}){
  const trends=qualificationTrends(summary,division,options),goal=goals[trends.goal],label=trends.definiteOnly?`${goal}確定時`:`${goal}時`;
  const empty={impossible:`この前提では${trends.goal===1?'2位以内で終わる':goal+'する'}ケースがありません。`,'no-definite-cases':`${goal}が確定するケースはありません。同点で進出が未確定のケースは、この集計には含めません。`,'no-matches':'残り試合はありません。','no-other-matches':'他チーム同士の残り試合はありません。「自チームの試合も含める」で表示できます。'};
  if(trends.status!=='ready')return `<p class="trend-empty">${empty[trends.status]}</p>`;
  const name=i=>esc(division.teams[i].shortName);
  return `<p class="trend-context">${trends.definiteOnly?`${goal}が確定するケースのみ`:trends.goal===1?'2位以内で終わったケース':`${goal}したケース`}で集計 · 全体との差が大きい試合順</p>${trends.matches.map(m=>{
    const fixture=division.fixtures.find(f=>f.id===m.matchId);
    return `<section class="qualification-trend-match" data-trend-match="${esc(m.matchId)}"><div class="trend-match-heading"><h3>第${fixture.round}節 ${name(m.home)} vs. ${name(m.away)}</h3><span>分布の差 ${deltaText(m.distance,BigInt(m.deltaDenominator)*2n,false)}</span></div><div class="scroll-table"><table aria-label="${name(m.home)}対${name(m.away)}の${label}のスコア分布"><thead><tr><th>スコア<br>${name(m.home)} – ${name(m.away)}</th><th>全ケース</th><th>${label}</th><th>差</th></tr></thead><tbody>${m.scores.map(row=>`<tr class="${BigInt(row.delta)>0n?'trend-increase':BigInt(row.delta)<0n?'trend-decrease':'trend-unchanged'}"><th scope="row">${row.homePoints} – ${row.awayPoints}</th><td>${formatTeamPercent(row.mass,trends.denominator)}</td><td>${formatTeamPercent(row.qualifiedMass,trends.qualified)}</td><td>${deltaText(row.delta,m.deltaDenominator)}</td></tr>`).join('')}</tbody></table></div></section>`;
  }).join('')}`;
}
export function renderQualificationTrends(summary,division,options={}){
  if(!summary)return '';
  const goal=options.goal??2,includeOwn=options.includeOwn??false;
  return `<details class="qualification-trends" id="qualification-trends"><summary>進出時に多い試合結果</summary><div class="trend-controls"><label>目標<select id="trend-goal">${goals.map((g,i)=>`<option value="${i}" ${i===goal?'selected':''}>${g}</option>`).join('')}</select></label><label class="trend-own-control"><input type="checkbox" id="trend-include-own" ${includeOwn?'checked':''}>自チームの試合も含める</label></div><div id="qualification-trend-body" aria-live="polite">${renderQualificationTrendBody(summary,division,{goal,includeOwn})}</div><details class="trend-help"><summary>傾向の読み方</summary><p>全ケースのスコア分布と、選んだ目標を達成したケースのスコア分布を比較しています。${summary.mode==='points'?'ポイント同点は順位を均等配分し、その進出割合を重みとして集計します。':'同点で進出が未確定なケースは除き、進出が確定するケースだけで集計します。'}入力済みの仮定と、スコア・得失のモデル上の重みを反映しています。</p><p>差がプラスのスコアは進出時に多く現れますが、必要条件や十分条件ではありません。「試合結果による変化」とは条件付けの向きが逆で、ここでは進出した場合の試合結果を見ています。</p><p>試合の並び順に使う「分布の差」は、各スコアの確率差の絶対値を合計して半分にした値です。0ptなら全体と同じ分布です。</p></details></details>`;
}
