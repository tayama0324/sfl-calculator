import {conditionedOutcomes,gcd} from './distributions.js';
export const ASSUMPTION_METRICS={homePoints:'ホームの獲得ポイント',awayPoints:'アウェイの獲得ポイント',battleDiff:'ホームのバトル得失',roundDiff:'ホームのラウンド得失'};
export const ASSUMPTION_OPERATORS={gte:'以上',lte:'以下',eq:'ちょうど'};
export function rulesFor(d,id){
  const rules=[...(d.matchAssumptions?.[id]??[])],score=(d.fixedScores??d.scenario?.fixedScores)?.[id];
  if(score){const [h,a]=score.split('-').map(Number);rules.push({id:'legacy-home',metric:'homePoints',operator:'eq',value:h,source:'manual'},{id:'legacy-away',metric:'awayPoints',operator:'eq',value:a,source:'manual'});}
  const detail=d.fixedDetails?.[id];for(const metric of ['battleDiff','roundDiff'])if(detail?.[metric]!=null)rules.push({id:`legacy-${metric}`,metric,operator:'eq',value:detail[metric],source:'manual'});
  return rules;
}
export function setMatchRules(d,id,rules){
  d.matchAssumptions??={};
  const unique=[...new Map(rules.map(r=>[`${r.metric}/${r.operator}/${r.value}`,r])).values()];
  if(unique.length)d.matchAssumptions[id]=structuredClone(unique);else delete d.matchAssumptions[id];
  if(d.fixedScores)delete d.fixedScores[id];if(d.fixedDetails)delete d.fixedDetails[id];
}
export function mergeMatchRules(d,additions){
  for(const [id,rules]of Object.entries(additions)){
    const old=rulesFor(d,id),seen=new Set(old.map(r=>`${r.metric}/${r.operator}/${r.value}`));
    setMatchRules(d,id,[...old,...rules.filter(r=>!seen.has(`${r.metric}/${r.operator}/${r.value}`))]);
  }
}
export function clearMatchRules(d){d.matchAssumptions={};d.fixedScores={};delete d.fixedDetails;}
export function ruleErrors(rules){
  if(!Array.isArray(rules)||rules.length>64)return ['条件は64件以下の配列にしてください。'];
  const errors=[],ids=new Set();
  rules.forEach((r,i)=>{
    if(!r||!Object.hasOwn(ASSUMPTION_METRICS,r.metric)||!Object.hasOwn(ASSUMPTION_OPERATORS,r.operator)||!Number.isSafeInteger(r.value)||typeof r.id!=='string'||!r.id.length||r.id.length>100||ids.has(r.id)||!['manual','necessary'].includes(r.source)){errors.push(`条件${i+1}の形式が不正です。`);return;}
    ids.add(r.id);const points=r.metric.endsWith('Points'),limit=r.metric==='battleDiff'?9:60;
    if(points?(r.value<0||r.value>40||r.value%10):(Math.abs(r.value)>limit))errors.push(`条件${i+1}の数値が範囲外です。`);
  });return errors;
}
const accepts=(rule,row)=>{const value=row[{homePoints:0,awayPoints:1,battleDiff:3,roundDiff:4}[rule.metric]];return rule.operator==='gte'?value>=rule.value:rule.operator==='lte'?value<=rule.value:value===rule.value;};
export function filterRuleOutcomes(mode,resolved,rules){
  const errors=ruleErrors(rules);if(errors.length)throw new Error(errors.join(' '));
  const detailed=rules.some(r=>!r.metric.endsWith('Points'));
  if(mode==='points'&&!detailed){const rows=resolved.outcomes.filter(row=>rules.every(r=>accepts(r,row)));if(!rows.length)throw new Error('条件のANDに一致するスコアがありません。');return rows;}
  const sourceMode=mode==='rounds'||rules.some(r=>r.metric==='roundDiff')?'rounds':'battles';
  const rows=conditionedOutcomes(sourceMode,resolved.allowedScores).filter(row=>rules.every(r=>accepts(r,row)));
  if(!rows.length)throw new Error('条件のANDに一致するスコア・得失の組み合わせがありません。');
  const grouped=new Map();for(const [h,a,w,b,r]of rows){const key=JSON.stringify(mode==='points'?[h,a]:[h,a,b,mode==='rounds'?r:0]);grouped.set(key,(grouped.get(key)??0n)+BigInt(w));}
  const divisor=[...grouped.values()].reduce((a,b)=>gcd(a,b));
  return [...grouped].map(([key,w])=>{const [h,a,b,r]=JSON.parse(key);return mode==='points'?[h,a,String(w/divisor)]:[h,a,String(w/divisor),b,r];});
}
export function ruleText(rule,home='ホーム',away='アウェイ'){
  const target=rule.metric==='homePoints'?`${home}の獲得ポイント`:rule.metric==='awayPoints'?`${away}の獲得ポイント`:rule.metric==='battleDiff'?`${home}のバトル得失`:`${home}のラウンド得失`;
  const value=rule.metric.endsWith('Points')?`${rule.value}点`:`${rule.value>0?'+':''}${rule.value}`;
  return `${target} ${value}${rule.operator==='eq'?'ちょうど':ASSUMPTION_OPERATORS[rule.operator]}`;
}
export function exactRuleScore(rules){
  const h=rules.find(r=>r.metric==='homePoints'&&r.operator==='eq'),a=rules.find(r=>r.metric==='awayPoints'&&r.operator==='eq');
  return h&&a?`${h.value}-${a.value}`:null;
}
