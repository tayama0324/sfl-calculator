// A single score bound is sufficient iff it excludes every failure/unresolved
// state and admits at least one success. Only marginal extrema are needed;
// no cross-match score vectors or repeated league searches are constructed.
export function analyzeSingleMatchConditions(matches,status,{includeNecessary=false}={}) {
  const sufficient=[];
  if(status==='conditional')for(const m of matches)for(const side of m.sides){
    const good=side.success,bad=side.notGuaranteed;
    if(!good||!bad)continue;
    if(good.max.points>bad.max.points)sufficient.push({matchId:m.matchId,teamId:side.teamId,operator:'atLeast',points:bad.max.points+10,witness:good.max.witness,counterexample:bad.max.witness});
    if(good.min.points<bad.min.points)sufficient.push({matchId:m.matchId,teamId:side.teamId,operator:'atMost',points:bad.min.points-10,witness:good.min.witness,counterexample:bad.min.witness});
  }
  if(!includeNecessary)return {status,sufficient};
  const necessary=status==='impossible'?null:matches.flatMap(m=>m.sides.flatMap(side=>{
    const minimum=side.possible?.min;
    return minimum?.points>0?[{matchId:m.matchId,teamId:side.teamId,points:minimum.points,witness:minimum.witness}]:[];
  }));
  return {status,sufficient,necessary};
}
