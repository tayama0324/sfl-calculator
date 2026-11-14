// Project uniformly classified subtrees onto small joint score tables. This
// retains cross-match correlations without enumerating detailed suffix states.
export const combinationLimit=matches=>matches<=6?3:matches<=9?2:0;
export function createCombinedCollector(games,goalCount,target,witness){
  const limit=combinationLimit(games.length);
  const supports=games.map(g=>{const rows=[],lookup=new Map(),indices=g.outcomes.map((o,i)=>{const key=`${o.h}/${o.a}`;if(!lookup.has(key)){lookup.set(key,rows.length);rows.push({h:o.h,a:o.a,index:i});}return lookup.get(key);});return {rows,indices};});
  const groups=[];
  function choose(start,ids,size){if(ids.length===size){
    const sizes=ids.map(i=>supports[i].rows.length),strides=sizes.map((_,i)=>sizes.slice(i+1).reduce((a,b)=>a*b,1)),count=sizes.reduce((a,b)=>a*b,1);
    const offsets=[0];let prefixes=1;for(const size of sizes){offsets.push(offsets.at(-1)+prefixes);prefixes*=size;}
    groups.push({ids:[...ids],sizes,strides,count,offsets,seen:new Uint8Array(offsets.at(-1)+count),goals:Array.from({length:goalCount},()=>({good:Array(count).fill(null),bad:Array(count).fill(null)}))});return;
  }for(let i=start;i<games.length;i++)choose(i+1,[...ids,i],size);}
  for(let k=1;k<=Math.min(limit,games.length);k++)choose(0,[],k);
  return {
    record(depth,statuses,path){
      let flags=0;statuses.forEach((s,i)=>flags|=(s==='success'?1:2)<<(i*2));
      for(const g of groups){
        let prefix=0,k=0;while(k<g.ids.length&&g.ids[k]<depth){prefix=prefix*g.sizes[k]+supports[g.ids[k]].indices[path[g.ids[k]]];k++;}
        const key=g.offsets[k]+prefix,newFlags=flags&~g.seen[key];if(!newFlags)continue;g.seen[key]|=flags;
        const span=k===0?g.count:g.strides[k-1],start=prefix*span;
        for(let cell=start;cell<start+span;cell++)for(let gi=0;gi<goalCount;gi++){
          const bit=(statuses[gi]==='success'?1:2)<<(gi*2);if(!(newFlags&bit))continue;
          const table=g.goals[gi][statuses[gi]==='success'?'good':'bad'];if(table[cell]!==null)continue;
          table[cell]=witness(()=>{const sequence=[...path.slice(0,depth),...Array(games.length-depth).fill(0)];for(let j=k;j<g.ids.length;j++)sequence[g.ids[j]]=supports[g.ids[j]].rows[Math.floor(cell/g.strides[j])%g.sizes[j]].index;return sequence;});
        }
      }
    },
    result(gi,status){
      const matches=games.map((g,i)=>({matchId:g.id,home:g.home,away:g.away,scores:supports[i].rows.map(o=>[o.h,o.a])}));
      const tables=groups.map(g=>({indices:g.ids,...g.goals[gi]}));
      const result={format:'score-ranges',limit,matches,tables};return {...result,sufficient:status==='conditional'?analyzeCombinedConditions(result,target):[]};
    }
  };
}
export function scoreConditionOptions(m,ranges=false){
  const all=(1<<m.scores.length)-1,unique=new Map();
  for(const side of [0,1])for(const operator of ['atLeast','atMost'])for(const points of [0,10,20,30,40]){
    const mask=m.scores.reduce((mask,s,i)=>mask|((operator==='atLeast'?s[side]>=points:s[side]<=points)?1<<i:0),0);
    if(mask&&mask!==all&&!unique.has(mask))unique.set(mask,{side,operator,points,mask});
  }
  if(ranges){
    const add=(predicate,condition)=>{const mask=m.scores.reduce((v,s,i)=>v|(predicate(s)?1<<i:0),0);if(mask&&mask!==all&&!unique.has(mask))unique.set(mask,{...condition,mask});};
    // Keep existing one-sided bounds when equivalent. Prefer exact scores to
    // spelling the same singleton with two teams' ranges.
    for(const score of m.scores)add(s=>s[0]===score[0]&&s[1]===score[1],{operator:'exact',score});
    for(const side of [0,1])for(let min=0;min<=40;min+=10)for(let max=min;max<=40;max+=10)
      add(s=>s[side]>=min&&s[side]<=max,{operator:'range',side,min,max});
    for(let hmin=0;hmin<=40;hmin+=10)for(let hmax=hmin;hmax<=40;hmax+=10)
      for(let amin=0;amin<=40;amin+=10)for(let amax=amin;amax<=40;amax+=10)
        add(s=>s[0]>=hmin&&s[0]<=hmax&&s[1]>=amin&&s[1]<=amax,{operator:'ranges',bounds:[[hmin,hmax],[amin,amax]]});
  }
  return [...unique.values()];
}
// True when every state admitted by narrow also satisfies broad.
const contains=(broad,narrow)=>broad.every(b=>narrow.some(n=>n.matchIndex===b.matchIndex&&(n.mask&b.mask)===n.mask));
export function analyzeCombinedConditions(data,target){
  const opts=data.matches.map(m=>scoreConditionOptions(m,data.format==='score-ranges')),safe=[];
  for(const table of data.tables){
    const sizes=table.indices.map(i=>data.matches[i].scores.length),strides=sizes.map((_,i)=>sizes.slice(i+1).reduce((a,b)=>a*b,1));
    const local=[];
    function visit(clauses){
      if(clauses.length<table.indices.length){const mi=table.indices[clauses.length];for(const o of opts[mi])visit([...clauses,{matchIndex:mi,...o}]);return;}
      if(safe.some(c=>contains(c.clauses,clauses))||local.some(c=>contains(c.clauses,clauses)))return;
      let witness=null;
      for(let i=0;i<table.good.length;i++){
        if(!clauses.every((c,j)=>c.mask&(1<<(Math.floor(i/strides[j])%sizes[j]))))continue;
        if(table.bad[i]!==null)return;
        if(table.good[i]!==null)witness??=table.good[i];
      }
      if(witness===null)return;
      for(let i=local.length-1;i>=0;i--)if(contains(clauses,local[i].clauses))local.splice(i,1);
      local.push({clauses,witness});
    }
    visit([]);safe.push(...local);
  }
  return safe.filter(c=>c.clauses.some(({matchIndex:i})=>data.matches[i].home!==target&&data.matches[i].away!==target));
}
