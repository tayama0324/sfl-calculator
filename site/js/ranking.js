export function compareLex(a,b) {
  for(let i=0;i<a.length;i++){const sign=Math.sign(a[i]-b[i]);if(sign)return sign;}
  return 0;
}
export function compareTeams(values,mode,i,j){
  return Math.sign(values.points[i]-values.points[j])||(mode==='points'?0:Math.sign(values.battles[i]-values.battles[j]))||(mode==='rounds'?Math.sign(values.rounds[i]-values.rounds[j]):0);
}
export function classifyTarget(values,mode,target,cutoff){
  let higher=0,equal=1;
  for(let j=0;j<values.points.length;j++)if(j!==target){const sign=compareTeams(values,mode,target,j);if(sign<0)higher++;else if(!sign)equal++;}
  const status=higher>=cutoff?'failure':higher+equal<=cutoff?'success':'unresolved';
  return {status,higher,equal,first:higher+1,last:higher+equal,reason:status==='unresolved'?(mode==='rounds'?'additional-tiebreak':mode==='battles'?'unexplored-rounds':'unexplored-battles-rounds'):null};
}
