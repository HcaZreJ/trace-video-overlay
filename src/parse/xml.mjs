// ==================== XML 系（GPX / TCX / KML）坐标提取 ====================
// 三个提取器接收 DOMParser 产出的 Document，属浏览器运行时，Node 下无 DOMParser。
function ptFromAttrEl(el){
  const lat=parseFloat(el.getAttribute('lat')),lon=parseFloat(el.getAttribute('lon'));
  if(isNaN(lat)||isNaN(lon)) return null;
  const p={lng:lon,lat};
  const e=el.querySelector('ele'); if(e){ const v=parseFloat(e.textContent); if(!isNaN(v)) p.ele=v; }
  const t=el.querySelector('time'); if(t){ const ms=Date.parse(t.textContent.trim()); if(!isNaN(ms)) p.time=ms; }
  return p;
}
export function extractGPXCoords(xml){
  const pts=[];
  xml.querySelectorAll('trkpt').forEach(el=>{ const p=ptFromAttrEl(el); if(p) pts.push(p); });
  if(pts.length===0) xml.querySelectorAll('rtept').forEach(el=>{ const p=ptFromAttrEl(el); if(p) pts.push(p); });
  return pts;
}
export function extractTCXCoords(xml){
  const pts=[];
  xml.querySelectorAll('Trackpoint').forEach(tp=>{
    const latEl=tp.querySelector('LatitudeDegrees'), lonEl=tp.querySelector('LongitudeDegrees');
    if(!latEl||!lonEl) return;
    const lat=parseFloat(latEl.textContent), lon=parseFloat(lonEl.textContent);
    if(isNaN(lat)||isNaN(lon)) return;
    const p={lng:lon,lat};
    const a=tp.querySelector('AltitudeMeters'); if(a){ const v=parseFloat(a.textContent); if(!isNaN(v)) p.ele=v; }
    const t=tp.querySelector('Time'); if(t){ const ms=Date.parse(t.textContent.trim()); if(!isNaN(ms)) p.time=ms; }
    pts.push(p);
  });
  return pts;
}
export function extractKMLCoords(xml){
  const track=[];
  xml.querySelectorAll('gx\\:Track, Track').forEach(trackEl=>{
    const whens=[...trackEl.querySelectorAll('when')].map(w=>Date.parse(w.textContent.trim()));
    [...trackEl.querySelectorAll('gx\\:coord, coord')].forEach((el,i)=>{
      const p=el.textContent.trim().split(/\s+/);
      const lng=parseFloat(p[0]),lat=parseFloat(p[1]),ele=parseFloat(p[2]);
      if(!isNaN(lng)&&!isNaN(lat)){
        const pt={lng,lat}; if(!isNaN(ele)) pt.ele=ele;
        if(whens[i]!=null&&!isNaN(whens[i])) pt.time=whens[i];
        track.push(pt);
      }
    });
  });
  if(track.length) return track;
  const line=[];
  xml.querySelectorAll('LineString coordinates, Polygon coordinates').forEach(el=>{
    el.textContent.trim().split(/\s+/).forEach(chunk=>{
      const p=chunk.split(','); const lng=parseFloat(p[0]),lat=parseFloat(p[1]),ele=parseFloat(p[2]);
      if(!isNaN(lng)&&!isNaN(lat)){ const pt={lng,lat}; if(!isNaN(ele)) pt.ele=ele; line.push(pt); }
    });
  });
  if(line.length) return line;
  const pt=[];
  xml.querySelectorAll('Placemark Point coordinates').forEach(el=>{
    const p=el.textContent.trim().split(','); const lng=parseFloat(p[0]),lat=parseFloat(p[1]);
    if(!isNaN(lng)&&!isNaN(lat)) pt.push({lng,lat});
  });
  return pt;
}
