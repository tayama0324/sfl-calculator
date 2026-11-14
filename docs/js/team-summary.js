// Weighted exact team distributions. Uniform target-rank subtrees are summed
// with suffix point distributions and score marginals, preserving tie bounds.
export function calculateTeamSummary(input,targetTeamId,onProgress=()=>{}, {optimize=true}={}){
  const target=input.teamIds.indexOf(targetTeamId),mode=input.mode??'points',dims=mode==='points'?1:mode==='battles'?2:3;
  if(target<0)throw Error('対象チームが不正です。');
  const weightTotal=input.matches.reduce((n,m)=>n*m.outcomes.reduce((s,o)=>s+BigInt(o[2]),0n),1n);
  const pathsTotal=input.matches.reduce((n,m)=>n*BigInt(m.outcomes.length),1n);
  const numeric=weightTotal*60n<=BigInt(Number.MAX_SAFE_INTEGER)&&pathsTotal<=BigInt(Number.MAX_SAFE_INTEGER),C=n=>numeric?Number(n):BigInt(n),zero=C(0),one=C(1),sixty=C(60);
  const games=input.matches.map(m=>{
    const scores=[],ids=new Map();
    const outcomes=m.outcomes.map(([h,a,w,b=0,r=0])=>{
      const key=`${h}/${a}`;if(!ids.has(key)){ids.set(key,scores.length);scores.push({homePoints:h,awayPoints:a,weight:zero});}
      const score=ids.get(key),weight=C(w);scores[score].weight+=weight;
      return {h,a,b,r,weight,score,points:m.home===target?h:m.away===target?a:0};
    });
    return {...m,outcomes,scores,weight:outcomes.reduce((n,o)=>n+o.weight,zero)};
  });
  const n=games.length,values=[input.points,input.battleDiffs??Array(6).fill(0),input.roundDiffs??Array(6).fill(0)].slice(0,dims).map(a=>[...a]);
  const suffixWeight=Array(n+1).fill(one),suffixPaths=Array(n+1).fill(one),suffixPoints=Array(n+1);suffixPoints[n]=new Map([[0,{weight:one,paths:one}]]);
  const min=Array.from({length:n+1},()=>Array.from({length:dims},()=>Array(6).fill(0))),max=structuredClone(min);
  for(let depth=n-1;depth>=0;depth--){
    const g=games[depth];suffixWeight[depth]=suffixWeight[depth+1]*g.weight;suffixPaths[depth]=suffixPaths[depth+1]*C(g.outcomes.length);
    const dist=new Map();for(const o of g.outcomes)for(const [points,tail]of suffixPoints[depth+1]){
      const key=points+o.points;if(!dist.has(key))dist.set(key,{weight:zero,paths:zero});const row=dist.get(key);row.weight+=o.weight*tail.weight;row.paths+=tail.paths;
    }suffixPoints[depth]=dist;
    for(let dim=0;dim<dims;dim++){
      min[depth][dim]=[...min[depth+1][dim]];max[depth][dim]=[...max[depth+1][dim]];
      for(const [id,home]of [[g.home,true],[g.away,false]]){
        const ds=g.outcomes.map(o=>dim===0?(home?o.h:o.a):(home?1:-1)*(dim===1?o.b:o.r));
        min[depth][dim][id]+=Math.min(...ds);max[depth][dim][id]+=Math.max(...ds);
      }
    }
  }
  const bucket=()=>({mass:zero,patterns:zero,rankLower:Array(6).fill(zero),rankUpper:Array(6).fill(zero),rankPatternsLower:Array(6).fill(zero),rankPatternsUpper:Array(6).fill(zero),goalLower:Array(3).fill(zero),goalUpper:Array(3).fill(zero)});
  const total=bucket(),byPoints=new Map(),byMatch=games.map(g=>({matchId:g.id,home:g.home,away:g.away,scores:g.scores.map(s=>({homePoints:s.homePoints,awayPoints:s.awayPoints,mass:zero,goalLower:Array(3).fill(zero),goalUpper:Array(3).fill(zero)}))}));
  const chosen=Array(n).fill(0);let processed=zero,visited=0,last=performance.now();
  function report(force=false){if(force||performance.now()-last>250){onProgress({phase:'team-summary',processed:String(processed),total:String(pathsTotal)});last=performance.now();}}
  function order(depth){
    let higher=0,equal=1;
    for(let j=0;j<6;j++)if(j!==target){
      let lo=0,hi=0;for(let dim=0;dim<dims;dim++){
        const delta=values[dim][target]-values[dim][j];
        if(!lo)lo=Math.sign(delta+min[depth][dim][target]-max[depth][dim][j]);
        if(!hi)hi=Math.sign(delta+max[depth][dim][target]-min[depth][dim][j]);
      }
      if(lo>0)continue;if(hi<0){higher++;continue;}if(lo===0&&hi===0){equal++;continue;}return null;
    }
    return {first:higher,last:higher+equal-1};
  }
  function addGoals(b,mass,first,last){
    b.mass+=mass;
    for(let i=0;i<3;i++){
      if(mode==='points'){const allocated=(mass/C(last-first+1))*C(Math.max(0,Math.min(last,i)-first+1));b.goalLower[i]+=allocated;b.goalUpper[i]+=allocated;}
      else {if(last<=i)b.goalLower[i]+=mass;if(first<=i)b.goalUpper[i]+=mass;}
    }
  }
  function add(b,weight,paths,first,last){
    const mass=weight*sixty;addGoals(b,mass,first,last);b.patterns+=paths;
    for(let rank=first;rank<=last;rank++){
      if(mode==='points'){b.rankLower[rank]+=mass/C(last-first+1);b.rankUpper[rank]+=mass/C(last-first+1);}
      else {if(first===last)b.rankLower[rank]+=mass;b.rankUpper[rank]+=mass;}
      if(first===last)b.rankPatternsLower[rank]+=paths;b.rankPatternsUpper[rank]+=paths;
    }
  }
  function visit(depth,weight){
    visited++;const ranks=depth===n||optimize?order(depth):null;
    if(ranks){
      const {first,last}=ranks,massWeight=weight*suffixWeight[depth];add(total,massWeight,suffixPaths[depth],first,last);
      for(const [points,tail]of suffixPoints[depth]){
        const finalPoints=values[0][target]+points;if(!byPoints.has(finalPoints))byPoints.set(finalPoints,bucket());
        add(byPoints.get(finalPoints),weight*tail.weight,tail.paths,first,last);
      }
      for(let i=0;i<n;i++){
        if(i<depth)addGoals(byMatch[i].scores[chosen[i]],massWeight*sixty,first,last);
        else {const base=weight*(suffixWeight[depth]/games[i].weight)*sixty;games[i].scores.forEach((score,j)=>addGoals(byMatch[i].scores[j],base*score.weight,first,last));}
      }
      processed+=suffixPaths[depth];report();return;
    }
    const g=games[depth];for(const o of g.outcomes){
      chosen[depth]=o.score;values[0][g.home]+=o.h;values[0][g.away]+=o.a;
      if(dims>1){values[1][g.home]+=o.b;values[1][g.away]-=o.b;}
      if(dims>2){values[2][g.home]+=o.r;values[2][g.away]-=o.r;}
      visit(depth+1,weight*o.weight);
      values[0][g.home]-=o.h;values[0][g.away]-=o.a;
      if(dims>1){values[1][g.home]-=o.b;values[1][g.away]+=o.b;}
      if(dims>2){values[2][g.home]-=o.r;values[2][g.away]+=o.r;}
    }
  }
  report(true);visit(0,one);report(true);
  const encode=b=>Object.fromEntries(Object.entries(b).map(([k,v])=>[k,Array.isArray(v)?v.map(String):String(v)]));
  return {kind:'sfl-team-summary',version:1,mode,targetTeamId,denominator:String(weightTotal*60n),processed:String(processed),total:encode(total),scores:[...byPoints].sort((a,b)=>a[0]-b[0]).map(([points,b])=>({points,...encode(b)})),matches:byMatch.map(m=>({...m,scores:m.scores.map(({homePoints,awayPoints,...b})=>({homePoints,awayPoints,...encode(b)}))})),visited};
}

export function verifyTeamSummary(summary){
  try{
    if(summary.kind!=='sfl-team-summary'||summary.version!==1||!['points','battles','rounds'].includes(summary.mode))return false;
    const den=BigInt(summary.denominator),paths=BigInt(summary.processed);if(den<=0n||paths<1n||BigInt(summary.total.mass)!==den||BigInt(summary.total.patterns)!==paths)return false;
    const fields=['rankLower','rankUpper','rankPatternsLower','rankPatternsUpper','goalLower','goalUpper'];
    const valid=b=>{
      const mass=BigInt(b.mass);if(mass<=0n)return false;
      for(const [lo,hi,size]of [['rankLower','rankUpper',6],['goalLower','goalUpper',3],['rankPatternsLower','rankPatternsUpper',6]])if(b[lo]){
        if(b[lo].length!==size||b[hi].length!==size)return false;
        const limit=lo==='rankPatternsLower'?BigInt(b.patterns):mass;
        for(let i=0;i<size;i++){const l=BigInt(b[lo][i]),h=BigInt(b[hi][i]);if(l<0n||h<l||h>limit||summary.mode==='points'&&lo!=='rankPatternsLower'&&l!==h)return false;}
      }
      if(b.rankLower){const sum=a=>a.reduce((n,v)=>n+BigInt(v),0n);if(sum(b.rankLower)>mass||sum(b.rankUpper)<mass||sum(b.rankPatternsLower)>BigInt(b.patterns)||sum(b.rankPatternsUpper)<BigInt(b.patterns))return false;}
      return b.goalLower.every((_,i)=>i===0||BigInt(b.goalLower[i])>=BigInt(b.goalLower[i-1])&&BigInt(b.goalUpper[i])>=BigInt(b.goalUpper[i-1]));
    };
    if(!valid(summary.total)||!summary.scores.length||summary.scores.some((s,i)=>!Number.isSafeInteger(s.points)||i>0&&s.points<=summary.scores[i-1].points||!valid(s)))return false;
    for(const f of ['mass','patterns'])if(summary.scores.reduce((n,s)=>n+BigInt(s[f]),0n)!==BigInt(summary.total[f]))return false;
    for(const f of fields)for(let i=0;i<summary.total[f].length;i++)if(summary.scores.reduce((n,s)=>n+BigInt(s[f][i]),0n)!==BigInt(summary.total[f][i]))return false;
    for(const m of summary.matches){
      if(!m.scores.length||m.scores.some(s=>!valid(s)))return false;
      if(m.scores.reduce((n,s)=>n+BigInt(s.mass),0n)!==den)return false;
      for(const f of ['goalLower','goalUpper'])for(let i=0;i<3;i++)if(m.scores.reduce((n,s)=>n+BigInt(s[f][i]),0n)!==BigInt(summary.total[f][i]))return false;
    }
    return true;
  }catch{return false;}
}
