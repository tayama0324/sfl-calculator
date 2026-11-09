import {rulesFor,exactRuleScore,ruleText} from './match-assumptions.js';
import {remaining} from './model.js';
import {escape} from './comparison-ui.js';
export function resultAssumptions(saved){
  if(!saved?.input||saved.config?.caseId==='@normal'||!Object.keys(saved.input.fixedScores??{}).length&&!Object.keys(saved.input.matchAssumptions??{}).length)return [];
  const d=saved.input;
  return remaining(d).map(m=>({...m,rules:rulesFor(d,m.id),score:exactRuleScore(rulesFor(d,m.id)),details:d.fixedDetails?.[m.id]})).filter(m=>m.rules.length);
}
export function renderAssumptionWarning(saved,{disabled=false,conditions=false}={}){
  const assumptions=resultAssumptions(saved);if(!assumptions.length)return '';
  const d=saved.input,name=id=>escape(d.teams.find(t=>t.id===id).shortName),signed=n=>`${n>0?'+':''}${n}`;
  const item=m=>{
    const texts=m.rules.filter(r=>!m.score||!r.metric.endsWith('Points')).map(r=>ruleText(r,d.teams.find(t=>t.id===m.homeTeamId).shortName,d.teams.find(t=>t.id===m.awayTeamId).shortName));
    return `<li>第${m.round}節 ${name(m.homeTeamId)} vs. ${name(m.awayTeamId)}${m.score?` ＝ <b>${escape(m.score.replace('-', '–'))}</b>`:''}${texts.length?`<small>${texts.map(escape).join(' かつ ')}</small>`:''}</li>`;
  };
  return `<aside class="assumption-warning" aria-label="この結果に適用した仮定"><div class="assumption-warning-heading"><strong>残り日程の仮定${assumptions.length}件・条件${assumptions.reduce((n,m)=>n+m.rules.length,0)}件を適用中</strong><button class="tiny-button" data-clear-assumptions-rerun ${disabled?'disabled':''}>仮定を解除して再探索</button></div><p>この${conditions?'探索結果':'確率'}は、以下の仮定が成立する場合のものです。</p><ul>${item(assumptions[0])}</ul>${assumptions.length>1?`<details id="result-assumptions"><summary>ほか${assumptions.length-1}件の仮定を確認</summary><ul>${assumptions.slice(1).map(item).join('')}</ul></details>`:''}<small>表示しているのは計算時の仮定です。解除して再探索すると、現在の入力からすべての仮定を外して計算します。</small></aside>`;
}
