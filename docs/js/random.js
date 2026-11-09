export const RNG_VERSION='chacha20-sha256-v1';
export const SAMPLER_VERSION='shared-inverse-cdf-v1';
const rot=(x,n)=>(x<<n)|(x>>>(32-n));
function quarter(s,a,b,c,d) {
  s[a]=(s[a]+s[b])>>>0;s[d]=rot(s[d]^s[a],16);
  s[c]=(s[c]+s[d])>>>0;s[b]=rot(s[b]^s[c],12);
  s[a]=(s[a]+s[b])>>>0;s[d]=rot(s[d]^s[a],8);
  s[c]=(s[c]+s[d])>>>0;s[b]=rot(s[b]^s[c],7);
}
export function chachaBlock(key,counter,nonce) {
  const initial=new Uint32Array([0x61707865,0x3320646e,0x79622d32,0x6b206574,...key,counter,...nonce]);
  const s=new Uint32Array(initial);
  for(let i=0;i<10;i++) {
    quarter(s,0,4,8,12);quarter(s,1,5,9,13);quarter(s,2,6,10,14);quarter(s,3,7,11,15);
    quarter(s,0,5,10,15);quarter(s,1,6,11,12);quarter(s,2,7,8,13);quarter(s,3,4,9,14);
  }
  return s.map((n,i)=>(n+initial[i])>>>0);
}
export async function seedKey(seed,divisionId) {
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([RNG_VERSION,seed,divisionId]))));
  const view=new DataView(bytes.buffer);
  return Uint32Array.from({length:8},(_,i)=>view.getUint32(i*4,true));
}
export function trialRandom(key,trial) {
  if(!Number.isSafeInteger(trial)||trial<0)throw new Error('試行番号が不正です。');
  const blocks=new Map(),nonce=[trial>>>0,Math.floor(trial/4294967296),0];
  return (matchSlot,draw=0)=>{
    if(!Number.isInteger(matchSlot)||matchSlot<0||matchSlot>=32||!Number.isSafeInteger(draw)||draw<0)throw new Error('乱数の位置が不正です。');
    const offset=matchSlot+draw*32,block=Math.floor(offset/16);
    if(block>0xffffffff)throw new Error('乱数ブロックを使い切りました。');
    if(!blocks.has(block))blocks.set(block,chachaBlock(key,block,nonce));
    return blocks.get(block)[offset%16];
  };
}
export function makeSampler(outcomes) {
  if(!Array.isArray(outcomes)||!outcomes.length||outcomes.some(o=>BigInt(o[2])<=0n))throw new Error('抽選の重みが不正です。');
  let total=0n;
  const cumulative=outcomes.map(o=>{total+=BigInt(o[2]);return total;});
  if(total<=0n)throw new Error('抽選の重みが不正です。');
  const find=ticket=>{let lo=0,hi=cumulative.length-1;while(lo<hi){const mid=(lo+hi)>>>1;if(ticket<cumulative[mid])hi=mid;else lo=mid+1;}return lo;};
  const power=total<=0x100000000n&&(total&(total-1n))===0n ? Number(total).toString(2).length-1 : null;
  return randomWord=>{
    if(outcomes.length===1)return outcomes[0];
    const word=randomWord(0);
    if(power!==null) return outcomes[find(BigInt(power===32?word:word>>>(32-power)))];
    // A common uniform's binary prefix is shared across cases. Refine it only
    // if it straddles a CDF boundary. This avoids modulo and Float64 bias.
    let prefix=BigInt(word),scale=1n<<32n,draw=1;
    for(;;){
      const lo=find(prefix*total/scale),hi=find(((prefix+1n)*total-1n)/scale);
      if(lo===hi)return outcomes[lo];
      prefix=(prefix<<32n)|BigInt(randomWord(draw++));scale<<=32n;
    }
  };
}
export function newSeed() { return [...crypto.getRandomValues(new Uint32Array(4))].map(n=>n.toString(16).padStart(8,'0')).join(''); }
