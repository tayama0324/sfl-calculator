import {reconstructExample} from './condition-search.js';
export const CONFIRMED_EXAMPLE='確定条件を満たした例';
function meetsNecessary(r,e){
  if(r.analysis.points.necessary===null||e.points<r.analysis.points.necessary)return false;
  const conditions=r.singleMatchConditions?.analysis.necessary;
  if(conditions)return conditions.every(c=>{
    const g=e.games.find(g=>g.matchId===c.matchId);
    return g&&(g.homeTeamId===c.teamId?g.homePoints:g.awayPoints)>=c.points;
  });
  return !r.matchConditions?.analysis.necessary||r.matchConditions.matchIds.every((id,i)=>{
    const g=e.games.find(g=>g.matchId===id);
    return (g.homeTeamId===r.targetTeamId?g.homePoints:g.awayPoints)>=r.matchConditions.analysis.necessary[i];
  });
}
export function searchExamples(r){
  const options=[],a=r.analysis.points;
  const sufficient=r.rankingCondition?.sufficientWitness??a.sufficientWitness??r.matchConditions?.analysis.sufficient[0]?.witness??r.singleMatchConditions?.analysis.sufficient[0]?.witness;
  if(sufficient!=null)options.push({id:sufficient,label:CONFIRMED_EXAMPLE});
  if(a.necessaryWitness!=null){
    const id=r.cells.find(c=>c.points===a.necessary&&c.success!==null)?.success??a.necessaryWitness;
    const e=reconstructExample(r,id);
    options.push({id,label:e.classification.status==='success'?'必要条件ギリギリで達成する例':'必要条件ギリギリで達成の可能性が残る例'});
  }
  const preferred=r.rankingCondition?.counterexample??a.counterexample;
  const ids=[...new Set([preferred,...[...r.cells].sort((a,b)=>b.points-a.points).flatMap(c=>[c.failure,c.unresolved]),...(r.matchConditions?.cells??[]).flatMap(c=>[c.failure,c.unresolved])].filter(id=>id!=null))];
  let bad=null;
  for(const id of ids){const e=reconstructExample(r,id);if(e.classification.status!=='success'&&meetsNecessary(r,e)){bad={id,meets:true};break;}}
  if(!bad&&ids.length)bad={id:ids[0],meets:false};
  if(bad){
    const ending=r.mode==='rounds'?'未達成または追加タイブレーク戦次第の例':'未達成または得失次第の例';
    options.push({id:bad.id,label:r.analysis.status==='impossible'?'未達成の例':bad.meets?`必要条件を満たしたけれども${ending}`:`必要条件に届かない${ending}`});
  }
  return options;
}
