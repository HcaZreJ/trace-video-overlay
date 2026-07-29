// ==================== 颜色空间转换（HEX / RGB / HSL / HSV 互转） ====================
// 供自定义 color picker 使用；HEX 6 位小写，RGB 0-255 整数，HSL h∈[0,360) s/l∈[0,100]，
// HSV h∈[0,360) s/v∈[0,1]。参数校验遵循 PATTERNS.md：类型错抛 TypeError、值域错抛 RangeError。

export function parseHex(hex) {
  if (typeof hex !== 'string') {
    throw new TypeError('parseHex: hex must be a string');
  }
  let s = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  if (s.length !== 3 && s.length !== 6) {
    throw new RangeError('parseHex: hex must be 3 or 6 hex digits');
  }
  if (!/^[0-9a-fA-F]+$/.test(s)) {
    throw new RangeError('parseHex: invalid hex digit');
  }
  if (s.length === 3) {
    s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  }
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  return { r, g, b };
}

export function formatHex(r, g, b) {
  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') {
    throw new TypeError('formatHex: r/g/b must be numbers');
  }
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    throw new RangeError('formatHex: r/g/b must be finite');
  }
  const cr = Math.round(r < 0 ? 0 : r > 255 ? 255 : r);
  const cg = Math.round(g < 0 ? 0 : g > 255 ? 255 : g);
  const cb = Math.round(b < 0 ? 0 : b > 255 ? 255 : b);
  return '#' + cr.toString(16).padStart(2, '0') + cg.toString(16).padStart(2, '0') + cb.toString(16).padStart(2, '0');
}

export function rgbToHsl(r, g, b) {
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    throw new RangeError('rgbToHsl: r/g/b must be finite');
  }
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l < 0.5 ? d / (max + min) : d / (2 - max - min);
    if (max === rr) {
      h = (gg - bb) / d + (gg < bb ? 6 : 0);
    } else if (max === gg) {
      h = (bb - rr) / d + 2;
    } else {
      h = (rr - gg) / d + 4;
    }
    h *= 60;
  }
  const H = ((Math.round(h) % 360) + 360) % 360;
  return { h: H, s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb(h, s, l) {
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) {
    throw new RangeError('hslToRgb: h/s/l must be finite');
  }
  const H = ((h % 360) + 360) % 360;
  const S = (s < 0 ? 0 : s > 100 ? 100 : s) / 100;
  const L = (l < 0 ? 0 : l > 100 ? 100 : l) / 100;
  let r, g, b;
  if (S === 0) {
    r = g = b = L;
  } else {
    const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
    const p = 2 * L - q;
    const hk = H / 360;
    const hue2rgb = (t) => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    r = hue2rgb(hk + 1 / 3);
    g = hue2rgb(hk);
    b = hue2rgb(hk - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

export function rgbToHsv(r, g, b) {
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    throw new RangeError('rgbToHsv: r/g/b must be finite');
  }
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const v = max;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (max !== min) {
    if (max === rr) {
      h = (gg - bb) / d + (gg < bb ? 6 : 0);
    } else if (max === gg) {
      h = (bb - rr) / d + 2;
    } else {
      h = (rr - gg) / d + 4;
    }
    h *= 60;
  }
  const H = ((h % 360) + 360) % 360;
  return { h: H, s, v };
}

export function hsvToRgb(h, s, v) {
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(v)) {
    throw new RangeError('hsvToRgb: h/s/v must be finite');
  }
  const H = ((h % 360) + 360) % 360;
  const S = s < 0 ? 0 : s > 1 ? 1 : s;
  const V = v < 0 ? 0 : v > 1 ? 1 : v;
  const c = V * S;
  const hh = H / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hh < 1) { r1 = c; g1 = x; b1 = 0; }
  else if (hh < 2) { r1 = x; g1 = c; b1 = 0; }
  else if (hh < 3) { r1 = 0; g1 = c; b1 = x; }
  else if (hh < 4) { r1 = 0; g1 = x; b1 = c; }
  else if (hh < 5) { r1 = x; g1 = 0; b1 = c; }
  else { r1 = c; g1 = 0; b1 = x; }
  const m = V - c;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255)
  };
}
