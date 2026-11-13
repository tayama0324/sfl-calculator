// Extrema of the final points at rank 1 and rank 3, independent of weights.
export function pointBorders(){return {first:{min:Infinity,max:-Infinity},playoff:{min:Infinity,max:-Infinity}};}
function update(border,min,max){border.min=Math.min(border.min,min);border.max=Math.max(border.max,max);}
export function recordPointBorder(borders,first,last,min,max=min){
  if(first===0)update(borders.first,min,max);
  if(first<=2&&last>=2)update(borders.playoff,min,max);
}
