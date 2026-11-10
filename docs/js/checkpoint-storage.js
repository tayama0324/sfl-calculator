import {simulationFingerprint,validateCheckpoint} from './monte-carlo.js';
const key=id=>`sfl-mc:last-${id}`;
export function clearStoredCheckpoints(storage,ids){
  for(const id of ids)storage.removeItem(key(id));
}
export function restoreMatchingCheckpoint(storage,division){
  const value=storage.getItem(key(division.id));
  if(!value)return null;
  let cp;
  try{cp=JSON.parse(value);validateCheckpoint(cp);}catch(error){
    storage.removeItem(key(division.id));throw error;
  }
  if(cp.division.id!==division.id||cp.fingerprint!==simulationFingerprint(division)){
    storage.removeItem(key(division.id));return null;
  }
  return cp;
}
