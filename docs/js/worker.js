import { calculate } from './engine.js';
import { prepare, BASE_CASE } from './model.js';
import { createMonteCarlo } from './monte-carlo.js';
import {runConditionSearch,verifySearchResult} from './condition-search.js';
let simulationJob=null;
self.onmessage = async ({ data }) => {
  if(data.type==='mc-cancel'){if(simulationJob)simulationJob.cancelled=true;return;}
  try {
    if(data.type==='mc-start') {
      if(simulationJob)throw new Error('別の計算を実行中です。');
      const job={cancelled:false};simulationJob=job;
      try {
        if(!Number.isSafeInteger(data.trials)||data.trials<1)throw new Error('試行回数が不正です。');
        const session=await createMonteCarlo(data.division,data.checkpoint??null),goal=session.completed+data.trials;
        if(!Number.isSafeInteger(goal))throw new Error('総試行数が上限を超えます。');
        const batch=Number.isSafeInteger(data.batchSize)?Math.max(1,Math.min(8192,data.batchSize)):512;
        let last=performance.now();
        self.postMessage({type:'mc-progress',checkpoint:session.checkpoint(),goal});
        while(session.completed<goal&&!job.cancelled){
          session.step(Math.min(batch,goal-session.completed));
          if(performance.now()-last>=200){self.postMessage({type:'mc-progress',checkpoint:session.checkpoint(),goal});last=performance.now();}
          await new Promise(resolve=>setTimeout(resolve,0));
        }
        self.postMessage({type:'mc-done',checkpoint:session.checkpoint(),goal,stopped:job.cancelled});
      } finally {simulationJob=null;}
      return;
    }
    if(simulationJob)throw new Error('別の計算を実行中です。');
    if(data.type==='condition-search'){
      const result=runConditionSearch(data.division,data.config,progress=>self.postMessage({type:'search-progress',...progress}));
      if(!verifySearchResult(result))throw new Error('条件探索の代表例・集計の検証に失敗しました。');
      self.postMessage({type:'search-done',result});return;
    }
    if (data.type === 'comparison') {
      const cache = new Map();
      for (const definition of [BASE_CASE,...data.division.cases]) {
        self.postMessage({type:'case-start',caseId:definition.id});
        const input = prepare(data.division,definition);
        const key = JSON.stringify({mode:input.mode,matches:input.matches});
        const started = performance.now();
        const reused = cache.has(key);
        const result = reused ? cache.get(key) : calculate(input, progress => self.postMessage({type:'progress',caseId:definition.id,...progress}));
        cache.set(key,result);
        self.postMessage({type:'case-done',caseId:definition.id,result,resolution:input.resolution,modelVersion:input.modelVersion,reused,seconds:(performance.now()-started)/1000});
      }
      self.postMessage({type:'comparison-done'});
      return;
    }
    const result = calculate(data, progress => self.postMessage({ type: 'progress', ...progress }));
    self.postMessage({ type: 'done', result });
  } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
};
