import {compareLex} from './ranking.js';

// Each vector contains the remaining points and (in ranking order) difference
// increments. The least significant integer coordinate gives an exact strict
// upper cut, including when the boundary itself is not an attainable score.
export function analyzeRankingCondition(maximum, maximumNotGuaranteed) {
  if(!maximumNotGuaranteed)return {status:'certain',threshold:null,sufficientWitness:maximum.witness,counterexample:null,maximum,maximumNotGuaranteed:null};
  if(compareLex(maximum.values,maximumNotGuaranteed.values)<=0)return {status:'dependent',threshold:null,sufficientWitness:null,counterexample:maximumNotGuaranteed.witness,maximum,maximumNotGuaranteed};
  const threshold=[...maximumNotGuaranteed.values];threshold[threshold.length-1]++;
  return {status:'conditional',threshold,sufficientWitness:maximum.witness,counterexample:maximumNotGuaranteed.witness,maximum,maximumNotGuaranteed};
}
