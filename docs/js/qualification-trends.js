// Reverse conditioning: P(score | qualified), not P(qualified | score).
// In detailed modes, goalLower counts only definitely qualified cases.
export function qualificationTrends(summary,division,{goal=2,includeOwn=false}={}){
  if(!Number.isInteger(goal)||goal<0||goal>2)throw Error('進出目標が不正です。');
  const denominator=BigInt(summary.denominator),qualified=BigInt(summary.total.goalLower[goal]),possible=BigInt(summary.total.goalUpper[goal]);
  const target=division.teams.findIndex(t=>t.id===summary.targetTeamId);
  const result={goal,definiteOnly:summary.mode!=='points',denominator:String(denominator),qualified:String(qualified),possible:String(possible),matches:[]};
  if(qualified===0n)return {...result,status:possible===0n?'impossible':'no-definite-cases'};
  const deltaDenominator=denominator*qualified;
  result.matches=summary.matches.filter(m=>includeOwn||m.home!==target&&m.away!==target).map(m=>{
    let distance=0n;
    const scores=m.scores.map(row=>{
      const delta=BigInt(row.goalLower[goal])*denominator-BigInt(row.mass)*qualified;
      distance+=delta<0n?-delta:delta;
      return {homePoints:row.homePoints,awayPoints:row.awayPoints,mass:row.mass,qualifiedMass:row.goalLower[goal],delta:String(delta)};
    });
    return {matchId:m.matchId,home:m.home,away:m.away,scores,distance:String(distance),deltaDenominator:String(deltaDenominator)};
  }).sort((a,b)=>BigInt(a.distance)>BigInt(b.distance)?-1:BigInt(a.distance)<BigInt(b.distance)?1:0);
  return {...result,status:result.matches.length?'ready':summary.matches.length?'no-other-matches':'no-matches'};
}
