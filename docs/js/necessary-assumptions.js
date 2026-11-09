// Group bounds before choosing scores so the two sides of one match cannot
// overwrite each other. Use attainable bounds across possible achievements, not just lower bounds.
export function necessaryMatchGroups(result){
  const conditions=result.singleMatchConditions?.analysis.necessary;
  if(conditions===null)throw new Error('達成不可能な目標の必要条件は適用できません。');
  if(!conditions)throw new Error('必要条件を再探索してください。');
  return result.matches.flatMap(m=>{
    const homeTeamId=result.initial.teamIds[m.home],awayTeamId=result.initial.teamIds[m.away];
    const home=conditions.find(c=>c.matchId===m.id&&c.teamId===homeTeamId)?.points??0;
    const away=conditions.find(c=>c.matchId===m.id&&c.teamId===awayTeamId)?.points??0;
    if(!home&&!away)return [];
    const bounds=result.singleMatchConditions.matches?.find(x=>x.matchId===m.id);
    const homeMax=bounds?.sides.find(s=>s.teamId===homeTeamId)?.possible?.max?.points??40;
    const awayMax=bounds?.sides.find(s=>s.teamId===awayTeamId)?.possible?.max?.points??40;
    const scores=[...new Map(result.outcomeSets[m.outcomeSet].filter(([h,a])=>h>=home&&a>=away&&h<=homeMax&&a<=awayMax).map(([h,a])=>[`${h}-${a}`,[h,a]])).values()];
    if(!scores.length)throw new Error('必要条件を満たす有効なスコアがありません。再探索してください。');
    return [{matchId:m.id,homeTeamId,awayTeamId,home,away,scores,exact:scores.length===1?scores[0]:null}];
  });
}
export function necessaryAssumptions(result){
  // Fix only scores shared by every possible achievement. Choosing a score
  // independently from each lower bound can destroy all joint solutions.
  // Ambiguous matches remain unrestricted, preserving every possible case for
  // the next (battle-aware) search rather than selecting one arbitrary example.
  return Object.fromEntries(necessaryMatchGroups(result).filter(g=>g.exact).map(g=>[g.matchId,g.exact.join('-')]));
}
// Transfer the conjunction itself, not an arbitrary score satisfying its bounds.
export function necessaryMatchRules(result){
  return Object.fromEntries(necessaryMatchGroups(result).map(g=>{
    const values=g.exact?[['homePoints','eq',g.exact[0]],['awayPoints','eq',g.exact[1]]]:[['homePoints','gte',g.home],['awayPoints','gte',g.away]].filter(([, ,n])=>n>0);
    return [g.matchId,values.map(([metric,operator,value])=>({id:`necessary-${metric}-${operator}-${value}`,metric,operator,value,source:'necessary'}))];
  }));
}
