import {prepare,current,BASE_CASE} from './model.js';
import {MODEL_VERSION,matchDistribution,playerExample} from './distributions.js';
import {searchConfigErrors} from './search-config.js';
import {classifyTarget,compareLex,compareTeams} from './ranking.js';
export const SEARCH_VERSION=1;
export function searchFingerprint(d,c){
  return JSON.stringify({teams:d.teams,fixtures:d.fixtures,baseline:d.baseline,results:d.results,config:c,caseDefinition:c.caseId==='@normal'?null:d.cases.find(x=>x.id===c.caseId),fixedScores:c.caseId==='@normal'?{}:d.fixedScores});
}
export function prepareSearch(d,c){
  const errors=searchConfigErrors(d,c);if(errors.length)throw new Error(errors.join('\n'));
  const source=structuredClone(d);source.explorationMode=c.mode;source.calculationMethod='exact';
  if(c.caseId==='@normal')source.fixedScores={};
  const definition=c.caseId==='@normal'?BASE_CASE:source.cases.find(x=>x.id===c.caseId);
  return {prepared:prepare(source,definition),definition};
}
export function analyzeConditions(cells){
  const possible=cells.filter(c=>c.success!==null||c.unresolved!==null),notGuaranteed=cells.filter(c=>c.failure!==null||c.unresolved!==null);
  const certain=cells.some(c=>c.success!==null),status=!possible.length?'impossible':!notGuaranteed.length?'certain':!certain?'possible-not-guaranteed':'conditional';
  function metric(field,step){
    const maxPossible=Math.max(...cells.map(c=>c[field]));
    if(!possible.length)return {necessary:null,sufficient:null,maxPossible,necessaryWitness:null,sufficientWitness:null,counterexample:null};
    const minimum=Math.min(...possible.map(c=>c[field])),cell=possible.find(c=>c[field]===minimum);
    const maximum=notGuaranteed.length?Math.max(...notGuaranteed.map(c=>c[field])):null;
    const candidate=maximum===null?0:maximum+step;
    const sufficient=cells.some(c=>c[field]>=candidate)?candidate:null;
    const example=sufficient===null?null:cells.find(c=>c[field]>=sufficient&&c.success!==null);
    const counter=maximum===null?null:notGuaranteed.find(c=>c[field]===maximum&&c.failure!==null)??notGuaranteed.find(c=>c[field]===maximum);
    return {necessary:minimum,sufficient,maxPossible,maximumNotGuaranteed:maximum,necessaryWitness:cell.success??cell.unresolved,sufficientWitness:example?.success??null,counterexample:counter?(counter.failure??counter.unresolved):null};
  }
  return {status,points:metric('points',10),wins:metric('wins',1)};
}
export function searchPrepared(input,{targetTeamId,goal='po',optimize=true}={},onProgress=()=>{}){
  const mode=input.mode??'points',target=input.teamIds.indexOf(targetTeamId),cutoff=goal==='po'?3:goal==='first'?1:0;
  const dims=mode==='rounds'?3:mode==='battles'?2:1;
  if(target<0||!cutoff||!['points','battles','rounds'].includes(mode)||input.matches.length>30)throw new Error('条件探索の設定が不正です。');
  const initial={teamIds:[...input.teamIds],points:[...input.points],battleDiffs:[...input.battleDiffs],roundDiffs:[...input.roundDiffs]};
  const values={points:[...initial.points],battles:[...initial.battleDiffs],rounds:[...initial.roundDiffs]};
  const arrays=[values.points,values.battles,values.rounds].slice(0,dims);
  if(arrays.some(a=>a.length!==6||a.some(n=>!Number.isSafeInteger(n))))throw new Error('現在の順位判定に必要な集計値が不足しています。');
  const outcomeSets=[],setIds=new Map();
  const games=input.matches.map(m=>{
    if(!Number.isInteger(m.home)||m.home<0||m.home>=6||!Number.isInteger(m.away)||m.away<0||m.away>=6||m.home===m.away||!m.outcomes.length)throw new Error('未消化試合の構成が不正です。');
    const key=JSON.stringify(m.outcomes);if(!setIds.has(key)){setIds.set(key,outcomeSets.length);outcomeSets.push(structuredClone(m.outcomes));}
    const outcomes=m.outcomes.map(([h,a,w,b=0,r=0])=>{
      if(![h,a,b,r].every(Number.isSafeInteger)||BigInt(w)<=0n)throw new Error('探索する試合状態が不正です。');
      const pts=m.home===target?h:m.away===target?a:0,win=m.home===target?(h>a?1:0):m.away===target?(a>h?1:0):0;
      return {h,a,b,r,pts,win};
    });
    return {id:m.id,home:m.home,away:m.away,outcomeSet:setIds.get(key),outcomes};
  });
  const n=games.length,suffixPaths=Array(n+1).fill(1n);
  const min=Array.from({length:n+1},()=>Array.from({length:dims},()=>Array(6).fill(0))),max=structuredClone(min);
  const stats=Array(n+1);stats[n]=[{points:0,wins:0,path:[]}];
  for(let depth=n-1;depth>=0;depth--){
    const g=games[depth];suffixPaths[depth]=suffixPaths[depth+1]*BigInt(g.outcomes.length);
    for(let dim=0;dim<dims;dim++){
      min[depth][dim]=[...min[depth+1][dim]];max[depth][dim]=[...max[depth+1][dim]];
      for(const [id,home]of [[g.home,true],[g.away,false]]){
        const ds=g.outcomes.map(o=>dim===0?(home?o.h:o.a):(home?1:-1)*(dim===1?o.b:o.r));
        min[depth][dim][id]+=Math.min(...ds);max[depth][dim][id]+=Math.max(...ds);
      }
    }
    const effects=new Map();g.outcomes.forEach((o,i)=>{const key=`${o.pts}/${o.win}`;if(!effects.has(key))effects.set(key,{...o,index:i});});
    const next=new Map();
    for(const e of effects.values())for(const tail of stats[depth+1]){
      const points=e.pts+tail.points,wins=e.win+tail.wins,key=`${points}/${wins}`;
      if(!next.has(key))next.set(key,{points,wins,path:[e.index,...tail.path]});
    }
    stats[depth]=[...next.values()];
  }
  function fixedClass(depth){
    let certainlyHigher=0,possiblyHigher=0,certainlyAtLeast=0,possiblyAtLeast=0;
    for(let j=0;j<6;j++)if(j!==target){
      const lows=[],highs=[];
      for(let dim=0;dim<dims;dim++){
        const diff=arrays[dim][target]-arrays[dim][j];
        lows.push(diff+min[depth][dim][target]-max[depth][dim][j]);
        highs.push(diff+max[depth][dim][target]-min[depth][dim][j]);
      }
      const lo=compareLex(lows,Array(dims).fill(0)),hi=compareLex(highs,Array(dims).fill(0));
      if(hi<0)certainlyHigher++;if(lo<0)possiblyHigher++;
      if(hi<=0)certainlyAtLeast++;if(lo<=0)possiblyAtLeast++;
    }
    if(certainlyHigher>=cutoff)return 'failure';
    if(possiblyAtLeast<cutoff)return 'success';
    if(possiblyHigher<cutoff&&certainlyAtLeast>=cutoff)return 'unresolved';
    return null;
  }
  const cellMap=new Map(),witnessPaths=[],witnessIds=new Map(),path=Array(n).fill(0);
  let processed=0n,visited=0n,collapsed=0n,lastReport=performance.now();
  function report(force=false){if(force||performance.now()-lastReport>250){onProgress({processed:String(processed),total:String(suffixPaths[0]),visited:String(visited),collapsed:String(collapsed),cells:cellMap.size});lastReport=performance.now();}}
  function record(points,wins,status,pathFactory){
    const key=`${points}/${wins}`;
    if(!cellMap.has(key))cellMap.set(key,{points,wins,success:null,failure:null,unresolved:null});
    const c=cellMap.get(key);if(c[status]!==null)return;
    const sequence=pathFactory(),id=sequence.join(',');
    if(!witnessIds.has(id)){witnessIds.set(id,witnessPaths.length);witnessPaths.push(sequence);}
    c[status]=witnessIds.get(id);
  }
  function visit(depth,points,wins){
    visited++;
    const status=depth===n?classifyTarget(values,mode,target,cutoff).status:optimize?fixedClass(depth):null;
    if(status){
      for(const tail of stats[depth])record(points+tail.points,wins+tail.wins,status,()=>[...path.slice(0,depth),...tail.path]);
      processed+=suffixPaths[depth];if(depth<n)collapsed++;report();return;
    }
    const g=games[depth];
    for(let i=0;i<g.outcomes.length;i++){
      const o=g.outcomes[i];path[depth]=i;
      values.points[g.home]+=o.h;values.points[g.away]+=o.a;
      if(dims>=2){values.battles[g.home]+=o.b;values.battles[g.away]-=o.b;}
      if(dims===3){values.rounds[g.home]+=o.r;values.rounds[g.away]-=o.r;}
      visit(depth+1,points+o.pts,wins+o.win);
      values.points[g.home]-=o.h;values.points[g.away]-=o.a;
      if(dims>=2){values.battles[g.home]-=o.b;values.battles[g.away]+=o.b;}
      if(dims===3){values.rounds[g.home]-=o.r;values.rounds[g.away]+=o.r;}
    }
  }
  report(true);visit(0,0,0);report(true);
  const cells=[...cellMap.values()].sort((a,b)=>a.points-b.points||a.wins-b.wins);
  return {kind:'sfl-condition-search-result',version:SEARCH_VERSION,modelVersion:MODEL_VERSION,complete:true,mode,targetTeamId,goal,initial,matches:games.map(({id,home,away,outcomeSet})=>({id,home,away,outcomeSet})),outcomeSets,witnessPaths,cells,analysis:analyzeConditions(cells),processed:String(processed),total:String(suffixPaths[0]),visited:String(visited),collapsed:String(collapsed)};
}
function attachExampleCatalog(result){
  const playerExamples=[],ids=new Map();
  const states=result.mode==='points'?null:new Map(matchDistribution(result.mode).outcomes.map(o=>[`${o.homePoints}/${o.awayPoints}/${o.battleDiff}/${o.roundDiff}`,o]));
  result.outcomeExamples=result.outcomeSets.map(set=>set.map(([h,a,,b=0,r=0])=>{
    if(!states)return null;
    const state=states.get(`${h}/${a}/${b}/${r}`);if(!state)throw new Error('試合の代表例が見つかりません。');
    return state.example.map(p=>{const key=JSON.stringify(p);if(!ids.has(key)){ids.set(key,playerExamples.length);playerExamples.push(playerExample(p));}return ids.get(key);});
  }));
  result.playerExamples=playerExamples;return result;
}
export function runConditionSearch(d,c,onProgress=()=>{}){
  const {prepared,definition}=prepareSearch(d,c);
  const result=searchPrepared(prepared,{targetTeamId:c.targetTeamId,goal:c.goal},onProgress);
  result.input=structuredClone(d);result.config=structuredClone(c);result.fingerprint=searchFingerprint(d,c);result.resolution=prepared.resolution;result.caseDefinition=structuredClone(definition);
  return attachExampleCatalog(result);
}
export function reconstructExample(result,index){
  const path=result.witnessPaths[index];if(!path||path.length!==result.matches.length)throw new Error('具体例のIDが不正です。');
  const values={points:[...result.initial.points],battles:[...result.initial.battleDiffs],rounds:[...result.initial.roundDiffs]};
  const target=result.initial.teamIds.indexOf(result.targetTeamId),games=[];
  let points=0,wins=0;
  result.matches.forEach((m,i)=>{
    const row=result.outcomeSets[m.outcomeSet]?.[path[i]];if(!row)throw new Error('具体例の試合結果が不正です。');
    const [h,a,,b=0,r=0]=row;
    values.points[m.home]+=h;values.points[m.away]+=a;
    for(const [id,sign]of [[m.home,1],[m.away,-1]]){
      values.battles[id]=result.mode==='points'?null:values.battles[id]+sign*b;
      values.rounds[id]=result.mode==='rounds'?values.rounds[id]+sign*r:null;
    }
    if(m.home===target){points+=h;wins+=h>a?1:0;}if(m.away===target){points+=a;wins+=a>h?1:0;}
    const players=result.outcomeExamples?.[m.outcomeSet]?.[path[i]]?.map(id=>result.playerExamples[id]);
    games.push({matchId:m.id,homeTeamId:result.initial.teamIds[m.home],awayTeamId:result.initial.teamIds[m.away],homePoints:h,awayPoints:a,battleDiff:result.mode==='points'?null:b,roundDiff:result.mode==='rounds'?r:null,players:players??null});
  });
  const classification=classifyTarget(values,result.mode,target,result.goal==='po'?3:1);
  const order=[0,1,2,3,4,5].sort((i,j)=>-compareTeams(values,result.mode,i,j));
  return {points,wins,classification,games,standings:order.map(i=>({teamId:result.initial.teamIds[i],points:values.points[i],battleDiff:values.battles[i],roundDiff:values.rounds[i]}))};
}
export function verifySearchResult(r){
  try{
    if(r.kind!=='sfl-condition-search-result'||r.version!==SEARCH_VERSION||!r.complete||BigInt(r.total)<1n||r.total!==r.processed||!r.cells.length)return false;
    for(const cell of r.cells){
      if(!Number.isInteger(cell.points)||cell.points<0||cell.points%10||!Number.isInteger(cell.wins)||cell.wins<0)return false;
      let present=false;
      for(const state of ['success','failure','unresolved'])if(cell[state]!==null){
        present=true;const example=reconstructExample(r,cell[state]);
        if(example.points!==cell.points||example.wins!==cell.wins||example.classification.status!==state)return false;
      }
      if(!present)return false;
    }
    return JSON.stringify(r.analysis)===JSON.stringify(analyzeConditions(r.cells));
  }catch{return false;}
}
