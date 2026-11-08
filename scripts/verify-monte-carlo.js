import {readFile,writeFile} from 'node:fs/promises';
import {migrateData} from '../site/js/model.js';
import {createMonteCarlo,validateCheckpoint,checkpointResults} from '../site/js/monte-carlo.js';
const original=JSON.parse(await readFile(new URL('../site/data/default.json',import.meta.url)));
const reports=[];
for(const id of ['S','F'])for(const mode of ['points','battles','rounds']){
  const d=migrateData(original).divisions.find(d=>d.id===id);
  d.calculationMethod='monteCarlo';d.explorationMode=mode;
  d.simulation={trials:100000,seed:'sfl-2026-verification-v1'};
  d.cases=[{id:'all-win',name:'首位チーム全勝',conditions:[{targetTeamId:d.teams[0].id,mode:'win'}]},{id:'priority',name:'優先条件付き',conditions:[{targetTeamId:d.teams[0].id,mode:'win'},{targetTeamId:d.teams[1].id,mode:'win'}]}];
  const start=performance.now(),session=await createMonteCarlo(d);
  session.step(100000);const seconds=(performance.now()-start)/1000;
  const checkpoint=session.checkpoint();validateCheckpoint(checkpoint);
  reports.push({divisionId:id,mode,seconds,checkpoint});
  console.log(`${id} ${mode}: 100000 paired trials × ${checkpoint.records.length} cases, ${seconds.toFixed(3)}s; all conservation checks passed`);
  if(checkpointResults(checkpoint).length!==3)throw new Error('Missing results');
}
await writeFile(new URL('../docs/monte-carlo-verification.json',import.meta.url),JSON.stringify(reports,null,2)+'\n');
