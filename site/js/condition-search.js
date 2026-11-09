import {prepare,current,BASE_CASE} from './model.js';
import {MODEL_VERSION,matchDistribution,playerExample} from './distributions.js';
import {searchConfigErrors,goalCutoff,searchGoals} from './search-config.js';
import {classifyTarget,compareLex,compareTeams} from './ranking.js';
import {analyzeMatchConditions} from './match-conditions.js';
import {analyzeRankingCondition} from './ranking-condition.js';
import {analyzeSingleMatchConditions} from './single-match-conditions.js';
export const SEARCH_VERSION=6;
export function searchFingerprint(d,c){
  return JSON.stringify({teams:d.teams,fixtures:d.fixtures,baseline:d.baseline,results:d.results,config:c,caseDefinition:['@normal','@input'].includes(c.caseId)?null:d.cases.find(x=>x.id===c.caseId),fixedScores:c.caseId==='@normal'?{}:d.fixedScores,...(c.caseId!=='@normal'&&Object.keys(d.matchAssumptions??{}).length?{matchAssumptions:d.matchAssumptions}:{}),...(c.caseId!=='@normal'&&d.fixedDetails?{fixedDetails:d.fixedDetails}:{})});
}
export function prepareSearch(d,c){
  const errors=searchConfigErrors(d,c);if(errors.length)throw new Error(errors.join('\n'));
  const source=structuredClone(d);source.explorationMode=c.mode;source.calculationMethod='exact';
  if(c.caseId==='@normal'){source.fixedScores={};delete source.fixedDetails;source.matchAssumptions={};}
  const definition=['@normal','@input'].includes(c.caseId)?BASE_CASE:source.cases.find(x=>x.id===c.caseId);
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
  const mode=input.mode??'points',target=input.teamIds.indexOf(targetTeamId);
  const goals=searchGoals(goal);
  const cutoffs=goals.map(goalCutoff);
  const dims=mode==='rounds'?3:mode==='battles'?2:1;
  if(target<0||cutoffs.some(c=>!c)||!['points','battles','rounds'].includes(mode)||input.matches.length>30)throw new Error('条件探索の設定が不正です。');
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
  const targetCounts=[0],targetMatchIds=[];
  for(const g of games){if(g.home===target||g.away===target)targetMatchIds.push(g.id);targetCounts.push(targetMatchIds.length);}
  const targetPoints=Array(targetMatchIds.length).fill(0);
  const n=games.length,suffixPaths=Array(n+1).fill(1n);
  const min=Array.from({length:n+1},()=>Array.from({length:dims},()=>Array(6).fill(0))),max=structuredClone(min);
  const stats=Array(n+1);stats[n]=[{points:0,wins:0,matchPoints:[],path:[]}];
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
      const points=e.pts+tail.points,wins=e.win+tail.wins;
      const matchPoints=targetCounts[depth+1]>targetCounts[depth]?[e.pts,...tail.matchPoints]:tail.matchPoints;
      const key=`${matchPoints.join(',')}/${points}/${wins}`;
      if(!next.has(key))next.set(key,{points,wins,matchPoints,path:[e.index,...tail.path]});
    }
    stats[depth]=[...next.values()];
  }
  // Independent match supports let us obtain the lexicographic maximum of a
  // certified subtree without enumerating or storing every difference tuple.
  const suffixBest=Array(n+1);suffixBest[n]={values:Array(dims).fill(0),path:[]};
  for(let depth=n-1;depth>=0;depth--){
    const g=games[depth],sign=g.home===target?1:g.away===target?-1:0;
    let best=null,index=0;
    g.outcomes.forEach((o,i)=>{
      const own=[o.pts,sign*o.b,sign*o.r].slice(0,dims);
      if(best===null||compareLex(own,best)>0){best=own;index=i;}
    });
    suffixBest[depth]={values:best.map((v,i)=>v+suffixBest[depth+1].values[i]),path:[index,...suffixBest[depth+1].path]};
  }
  const rankBounds=goals.map(()=>({maximum:null,maximumNotGuaranteed:null}));
  // Per-match score extrema survive subtree compression without retaining
  // combinations of results across matches. Each witness changes one suffix
  // match in a subtree already certified to have a uniform classification.
  const scoreExtrema=games.map(g=>['h','a'].map(side=>{
    let min=0,max=0;
    g.outcomes.forEach((o,i)=>{if(o[side]<g.outcomes[min][side])min=i;if(o[side]>g.outcomes[max][side])max=i;});
    return {min,max};
  }));
  const singleBounds=goals.map(()=>games.map(g=>({matchId:g.id,sides:[g.home,g.away].map(i=>({teamId:input.teamIds[i],success:null,notGuaranteed:null,possible:null}))})));
  // Once an extremum reaches the full support's limit, later subtrees cannot
  // improve it. Remove it from the active scan to keep the added work small.
  const pendingSingle=goals.map(()=>Object.fromEntries(['success','notGuaranteed','possible'].map(state=>[state,games.flatMap((g,mi)=>['h','a'].flatMap((field,si)=>['min','max'].map(kind=>({mi,si,field,kind,limit:g.outcomes[scoreExtrema[mi][si][kind]][field]}))))])));
  function fixedClass(depth,cutoff){
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
  const cellMaps=goals.map(()=>new Map()),matchMaps=goals.map(()=>new Map()),witnessPaths=[],witnessIds=new Map(),path=Array(n).fill(0);
  let processed=0n,visited=0n,collapsed=0n,lastReport=performance.now();
  function report(force=false){if(force||performance.now()-lastReport>250){onProgress({processed:String(processed),total:String(suffixPaths[0]),visited:String(visited),collapsed:String(collapsed),cells:cellMaps.reduce((n,m)=>n+m.size,0)});lastReport=performance.now();}}
  function witness(pathFactory){
    const sequence=pathFactory(),id=sequence.join(',');
    if(!witnessIds.has(id)){witnessIds.set(id,witnessPaths.length);witnessPaths.push(sequence);}
    return witnessIds.get(id);
  }
  function record(cellMap,points,wins,status,pathFactory,matchPoints=null){
    const key=matchPoints?matchPoints.join(','):`${points}/${wins}`;
    if(!cellMap.has(key))cellMap.set(key,{...(matchPoints?{points:matchPoints}:{points,wins}),success:null,failure:null,unresolved:null});
    const c=cellMap.get(key);if(c[status]!==null)return;
    c[status]=witness(pathFactory);
  }
  function recordSingleBounds(depth,statuses){
    for(let gi=0;gi<goals.length;gi++){
      const states=[statuses[gi]==='success'?'success':'notGuaranteed',...(statuses[gi]!=='failure'?['possible']:[])];
      for(const state of states){
        const pending=pendingSingle[gi][state];
        for(let i=pending.length-1;i>=0;i--){
          const {mi,si,field,kind,limit}=pending[i],side=singleBounds[gi][mi].sides[si];
          if(!side[state])side[state]={min:null,max:null};
          const oi=mi<depth?path[mi]:scoreExtrema[mi][si][kind],points=games[mi].outcomes[oi][field],old=side[state][kind];
          if(!old||(kind==='min'?points<old.points:points>old.points)){
            const id=witness(()=>{
              const sequence=[...path.slice(0,depth),...Array(n-depth).fill(0)];sequence[mi]=oi;return sequence;
            });
            side[state][kind]={points,witness:id};
          }
          if(points===limit){pending[i]=pending[pending.length-1];pending.pop();}
        }
      }
    }
  }
  function visit(depth,points,wins){
    visited++;
    const statuses=cutoffs.map(cutoff=>depth===n?classifyTarget(values,mode,target,cutoff).status:optimize?fixedClass(depth,cutoff):null);
    if(statuses.every(Boolean)){
      recordSingleBounds(depth,statuses);
      if(dims>1){
        const increments=[points,values.battles[target]-initial.battleDiffs[target],values.rounds[target]-initial.roundDiffs[target]].slice(0,dims);
        const best=increments.map((v,i)=>v+suffixBest[depth].values[i]);
        const pathFactory=()=>[...path.slice(0,depth),...suffixBest[depth].path];
        statuses.forEach((status,i)=>{
          const bound=rankBounds[i];
          for(const field of status==='success'?['maximum']:['maximum','maximumNotGuaranteed']){
            if(bound[field]===null||compareLex(best,bound[field].values)>0)bound[field]={values:best,witness:witness(pathFactory)};
          }
        });
      }
      for(const tail of stats[depth]){
        const matchPoints=[...targetPoints.slice(0,targetCounts[depth]),...tail.matchPoints];
        const pathFactory=()=>[...path.slice(0,depth),...tail.path];
        statuses.forEach((status,i)=>{
          record(cellMaps[i],points+tail.points,wins+tail.wins,status,pathFactory);
          record(matchMaps[i],0,0,status,pathFactory,matchPoints);
        });
      }
      processed+=suffixPaths[depth];if(depth<n)collapsed++;report();return;
    }
    const g=games[depth];
    for(let i=0;i<g.outcomes.length;i++){
      const o=g.outcomes[i];path[depth]=i;
      if(targetCounts[depth+1]>targetCounts[depth])targetPoints[targetCounts[depth]]=o.pts;
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
  const results=Object.fromEntries(goals.map((goal,index)=>{
  const cells=[...cellMaps[index].values()].sort((a,b)=>a.points-b.points||a.wins-b.wins);
  const matchCells=[...matchMaps[index].values()].sort((a,b)=>a.points.reduce((n,x,i)=>n||x-b.points[i],0));
  const matchConditions={matchIds:targetMatchIds,cells:matchCells,analysis:analyzeMatchConditions(matchCells,targetMatchIds.length)};
  const analysis=analyzeConditions(cells);
  const singleMatchConditions={matches:singleBounds[index],analysis:analyzeSingleMatchConditions(singleBounds[index],analysis.status,{includeNecessary:true})};
  return [goal,{kind:'sfl-condition-search-result',version:SEARCH_VERSION,modelVersion:MODEL_VERSION,complete:true,mode,targetTeamId,goal,initial,matches:games.map(({id,home,away,outcomeSet})=>({id,home,away,outcomeSet})),outcomeSets,witnessPaths,cells,matchConditions,singleMatchConditions,...(dims>1?{rankingCondition:analyzeRankingCondition(rankBounds[index].maximum,rankBounds[index].maximumNotGuaranteed)}:{}),analysis,processed:String(processed),total:String(suffixPaths[0]),visited:String(visited),collapsed:String(collapsed)}];
  }));
  return goals.length>1?{kind:'sfl-condition-search-results',version:SEARCH_VERSION,complete:true,goal,results,processed:String(processed),total:String(suffixPaths[0]),visited:String(visited)}:results[goal];
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
  const attach=(r,config)=>{
    r.input=structuredClone(d);r.config=structuredClone(config);r.fingerprint=searchFingerprint(d,config);r.resolution=prepared.resolution;r.caseDefinition=structuredClone(definition);
    return attachExampleCatalog(r);
  };
  if(searchGoals(c.goal).length>1){
    for(const goal of searchGoals(c.goal))attach(result.results[goal],{...c,goal});
    result.input=structuredClone(d);result.config=structuredClone(c);result.fingerprint=searchFingerprint(d,c);
    return result;
  }
  return attach(result,c);
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
  const classification=classifyTarget(values,result.mode,target,goalCutoff(result.goal));
  const order=[0,1,2,3,4,5].sort((i,j)=>-compareTeams(values,result.mode,i,j));
  return {points,wins,classification,games,standings:order.map(i=>({teamId:result.initial.teamIds[i],points:values.points[i],battleDiff:values.battles[i],roundDiff:values.rounds[i]}))};
}
export function verifySearchResult(r){
  try{
    if(r.kind==='sfl-condition-search-results')return [1,2,3,4,5,SEARCH_VERSION].includes(r.version)&&r.complete&&['both','all'].includes(r.goal)&&r.processed===r.total&&searchGoals(r.goal).every(goal=>r.results[goal].goal===goal&&r.results[goal].processed===r.processed&&verifySearchResult(r.results[goal]));
    if(r.kind!=='sfl-condition-search-result'||![1,2,3,4,5,SEARCH_VERSION].includes(r.version)||!r.complete||BigInt(r.total)<1n||r.total!==r.processed||!r.cells.length)return false;
    for(const cell of r.cells){
      if(!Number.isInteger(cell.points)||cell.points<0||cell.points%10||!Number.isInteger(cell.wins)||cell.wins<0)return false;
      let present=false;
      for(const state of ['success','failure','unresolved'])if(cell[state]!==null){
        present=true;const example=reconstructExample(r,cell[state]);
        if(example.points!==cell.points||example.wins!==cell.wins||example.classification.status!==state)return false;
      }
      if(!present)return false;
    }
    if(r.version>=2){
      const mc=r.matchConditions;
      const target=r.initial.teamIds.indexOf(r.targetTeamId);
      const ids=r.matches.filter(m=>m.home===target||m.away===target).map(m=>m.id);
      if(JSON.stringify(mc.matchIds)!==JSON.stringify(ids)||!mc.cells.length)return false;
      const keys=new Set();
      for(const cell of mc.cells){
        if(cell.points.length!==ids.length||cell.points.some(p=>!Number.isInteger(p)||p<0||p>40||p%10))return false;
        const key=cell.points.join(',');if(keys.has(key))return false;keys.add(key);
        let present=false;
        for(const state of ['success','failure','unresolved'])if(cell[state]!==null){
          present=true;const e=reconstructExample(r,cell[state]);
          const points=e.games.filter(g=>g.homeTeamId===r.targetTeamId||g.awayTeamId===r.targetTeamId).map(g=>g.homeTeamId===r.targetTeamId?g.homePoints:g.awayPoints);
          if(JSON.stringify(points)!==JSON.stringify(cell.points)||e.classification.status!==state)return false;
        }
        if(!present)return false;
      }
      if(JSON.stringify(mc.analysis)!==JSON.stringify(analyzeMatchConditions(mc.cells,ids.length)))return false;
    }
    if(r.version>=4){
      const single=r.singleMatchConditions;
      if(!single||single.matches.length!==r.matches.length)return false;
      for(let i=0;i<r.matches.length;i++){
        const m=r.matches[i],bounds=single.matches[i];
        if(bounds.matchId!==m.id||bounds.sides.length!==2)return false;
        for(let side=0;side<2;side++){
          const b=bounds.sides[side];
          if(b.teamId!==r.initial.teamIds[side===0?m.home:m.away])return false;
          for(const state of ['success','notGuaranteed',...(r.version>=5?['possible']:[])]){
            const required=r.cells.some(c=>state==='success'?c.success!==null:state==='possible'?c.success!==null||c.unresolved!==null:c.failure!==null||c.unresolved!==null);
            if(Boolean(b[state])!==required)return false;
            if(!required)continue;
            if((state!=='possible'||r.version>=6)&&b[state].min.points>b[state].max.points)return false;
            for(const entry of state==='possible'&&r.version<6?[b[state].min]:[b[state].min,b[state].max]){
              if(!Number.isInteger(entry.points)||entry.points<0||entry.points>40||entry.points%10)return false;
              const e=reconstructExample(r,entry.witness),g=e.games[i];
              if((side===0?g.homePoints:g.awayPoints)!==entry.points||(state==='possible'?e.classification.status==='failure':(e.classification.status==='success')!==(state==='success')))return false;
            }
          }
        }
      }
      if(JSON.stringify(single.analysis)!==JSON.stringify(analyzeSingleMatchConditions(single.matches,r.analysis.status,{includeNecessary:r.version>=5})))return false;
    }
    if(r.version>=3&&r.mode!=='points'){
      const condition=r.rankingCondition,dimensions=r.mode==='rounds'?3:2;
      if(!condition||!condition.maximum)return false;
      const ti=r.initial.teamIds.indexOf(r.targetTeamId);
      const initial=[r.initial.points[ti],r.initial.battleDiffs[ti],r.initial.roundDiffs[ti]].slice(0,dimensions);
      for(const [field,entry]of [['maximum',condition.maximum],['maximumNotGuaranteed',condition.maximumNotGuaranteed]])if(entry){
        if(entry.values.length!==dimensions||!entry.values.every(Number.isSafeInteger))return false;
        const e=reconstructExample(r,entry.witness),t=e.standings.find(t=>t.teamId===r.targetTeamId);
        const actual=[t.points,t.battleDiff,t.roundDiff].slice(0,dimensions).map((n,i)=>n-initial[i]);
        if(compareLex(actual,entry.values)!==0||field==='maximumNotGuaranteed'&&e.classification.status==='success')return false;
      }
      if(JSON.stringify(condition)!==JSON.stringify(analyzeRankingCondition(condition.maximum,condition.maximumNotGuaranteed)))return false;
      if(condition.sufficientWitness!==null&&reconstructExample(r,condition.sufficientWitness).classification.status!=='success')return false;
    }
    return JSON.stringify(r.analysis)===JSON.stringify(analyzeConditions(r.cells));
  }catch{return false;}
}
