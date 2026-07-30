// 最小 FIT 解析器：从 Garmin/顽鹿 .fit 二进制中提取轨迹点 [{lng,lat,ele,time}]
// 只解析 record 消息(global msg 20) 的 position_lat/long、altitude、timestamp。零依赖。
export function parseFIT(buf){
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if(b.length<14) return [];
  const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);
  const headerSize=b[0];
  if(String.fromCharCode(b[8],b[9],b[10],b[11])!=='.FIT') return [];
  const dataSize=dv.getUint32(4,true);
  let pos=headerSize;
  const end=Math.min(headerSize+dataSize,b.length);
  const defs={};
  const points=[];
  const SEMI=180/2147483648;     // semicircles → degrees
  const EPOCH=631065600;          // FIT 时间基准(1989-12-31) 的 unix 秒

  function readVal(off,size,le,signed){
    if(size>=4) return signed?dv.getInt32(off,le):dv.getUint32(off,le);
    if(size===2) return signed?dv.getInt16(off,le):dv.getUint16(off,le);
    if(size===1) return signed?dv.getInt8(off):dv.getUint8(off);
    return null;
  }
  function readData(def,p){
    const v={};
    for(const f of def.fields){
      if([0,1,2,78,253].includes(f.num)){
        const signed=(f.num===0||f.num===1);
        v[f.num]=readVal(p,Math.min(f.size,4),def.le,signed);
      }
      p+=f.size;
    }
    p+=def.devTotal;
    return {pos:p,v};
  }
  function pushPoint(v){
    const lat=v[0],lng=v[1];
    if(lat==null||lng==null||lat===0x7FFFFFFF||lng===0x7FFFFFFF) return;
    const p={lat:lat*SEMI,lng:lng*SEMI};
    if(v[78]!=null&&v[78]!==0xFFFFFFFF) p.ele=v[78]/5-500;
    else if(v[2]!=null&&v[2]!==0xFFFF) p.ele=v[2]/5-500;
    if(v[253]!=null&&v[253]!==0xFFFFFFFF) p.time=(v[253]+EPOCH)*1000;
    points.push(p);
  }

  while(pos<end){
    const h=b[pos++];
    if(h&0x80){ // compressed-timestamp header
      const lt=(h>>5)&0x3; const def=defs[lt]; if(!def) break;
      const r=readData(def,pos); pos=r.pos;
      if(def.g===20) pushPoint(r.v);
      continue;
    }
    const isDef=(h&0x40)!==0,hasDev=(h&0x20)!==0,lt=h&0x0f;
    if(isDef){
      pos++; // reserved
      const le=b[pos++]===0;
      const g=dv.getUint16(pos,le); pos+=2;
      const nf=b[pos++]; const fields=[];
      for(let i=0;i<nf;i++){ fields.push({num:b[pos],size:b[pos+1]}); pos+=3; }
      let devTotal=0;
      if(hasDev){ const nd=b[pos++]; for(let i=0;i<nd;i++){ devTotal+=b[pos+1]; pos+=3; } }
      defs[lt]={g,fields,le,devTotal};
    } else {
      const def=defs[lt]; if(!def) break;
      const r=readData(def,pos); pos=r.pos;
      if(def.g===20) pushPoint(r.v);
    }
  }
  return points;
}
