// ==================== 轨迹解析入口：按扩展名分派 ====================
import { parseFIT } from './fit.mjs';
import { extractGeoJSONCoords } from './geojson.mjs';
import { extractGPXCoords, extractTCXCoords, extractKMLCoords } from './xml.mjs';
import { extractTextCoords } from './csv.mjs';

export async function parseTrackFile(file){
  const name=file.name.toLowerCase();
  if(name.endsWith('.fit')){
    const pts=parseFIT(new Uint8Array(await file.arrayBuffer()));
    return pts.length>1 ? {points:pts,format:'FIT'} : null;
  }
  const text=await file.text();
  if(name.endsWith('.geojson')||name.endsWith('.json')){
    try{ const c=extractGeoJSONCoords(JSON.parse(text)); if(c.length>1) return {points:c,format:'GeoJSON'}; }catch(_){}
  }
  if(/\.(gpx|kml|tcx|xml)$/.test(name)){
    try{
      const xml=new DOMParser().parseFromString(text,'text/xml');
      if(!xml.querySelector('parsererror')){
        const k=extractKMLCoords(xml); if(k.length>1) return {points:k,format:'KML'};
        const c=extractTCXCoords(xml);  if(c.length>1) return {points:c,format:'TCX'};
        const g=extractGPXCoords(xml);  if(g.length>1) return {points:g,format:'GPX'};
      }
    }catch(_){}
  }
  const t=extractTextCoords(text); if(t.length>1) return {points:t,format:'CSV'};
  return null;
}
