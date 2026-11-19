/* ==========================================================================
   SimuCore PlanScan — สแกนแผนผังห้องจากรูปภาพ / SVG / DXF
   --------------------------------------------------------------------------
   รูปภาพ → ปรับแสงพื้นหลัง → แยกเส้น (binarize) → แก้ภาพเอียง → หาเส้นผนัง
   แนวนอน/แนวตั้ง (run-length) + ผนังเฉียง (Hough) → รวมเส้นคู่ขนานเป็นผนังหนา →
   ต่อมุมผนัง → หาช่องประตู/หน้าต่าง → เทน้ำ (flood fill) หาห้อง → เดามาตราส่วน
   จากความกว้างประตู แล้วแปลงเป็นพื้นที่ 3D (เมตร) ให้ห้องแล็บเครือข่าย
   ทุกฟังก์ชันใช้ข้อมูลภาพแบบ {width, height, data RGBA} จึงทดสอบด้วย Node ได้
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlanScan = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLORS = ['#38bdf8', '#f59e0b', '#a855f7', '#34d399', '#ec4899', '#22d3ee', '#fb7185', '#a3e635', '#f97316', '#818cf8', '#2dd4bf', '#facc15'];
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const median = arr => {
    if (!arr.length) return 0;
    const s = Array.from(arr).sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  function wmedian(vals, ws) {
    const idx = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    const tot = ws.reduce((a, b) => a + b, 0);
    let acc = 0;
    for (const i of idx) { acc += ws[i]; if (acc >= tot / 2) return vals[i]; }
    return vals.length ? vals[idx[idx.length - 1]] : 0;
  }
  const segLen = s => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  const r1 = v => Math.round(v * 10) / 10;

  /* ------------------------------- เรขาคณิต ------------------------------- */
  function mkSeg(x1, y1, x2, y2, t, extra) {
    const dx = x2 - x1, dy = y2 - y1;
    let o = 'd';
    if (Math.abs(dy) <= 0.5 && Math.abs(dx) > 0.5) o = 'h';
    else if (Math.abs(dx) <= 0.5 && Math.abs(dy) > 0.5) o = 'v';
    let s;
    if (o === 'h') { const y = (y1 + y2) / 2; s = { o, x1: Math.min(x1, x2), y1: y, x2: Math.max(x1, x2), y2: y, t }; }
    else if (o === 'v') { const x = (x1 + x2) / 2; s = { o, x1: x, y1: Math.min(y1, y2), x2: x, y2: Math.max(y1, y2), t }; }
    else s = x1 < x2 || (x1 === x2 && y1 < y2) ? { o, x1, y1, x2, y2, t } : { o, x1: x2, y1: y2, x2: x1, y2: y1, t };
    return extra ? Object.assign(s, extra) : s;
  }
  function pointSegDist(px, py, s) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L = dx * dx + dy * dy;
    let t = L ? ((px - s.x1) * dx + (py - s.y1) * dy) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
  }
  const cross = (ax, ay, bx, by) => ax * by - ay * bx;
  function segsIntersect(a, b) {
    const d1 = cross(b.x2 - b.x1, b.y2 - b.y1, a.x1 - b.x1, a.y1 - b.y1), d2 = cross(b.x2 - b.x1, b.y2 - b.y1, a.x2 - b.x1, a.y2 - b.y1);
    const d3 = cross(a.x2 - a.x1, a.y2 - a.y1, b.x1 - a.x1, b.y1 - a.y1), d4 = cross(a.x2 - a.x1, a.y2 - a.y1, b.x2 - a.x1, b.y2 - a.y1);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }
  function segSegDist(a, b) {
    if (segsIntersect(a, b)) return 0;
    return Math.min(pointSegDist(a.x1, a.y1, b), pointSegDist(a.x2, a.y2, b), pointSegDist(b.x1, b.y1, a), pointSegDist(b.x2, b.y2, a));
  }
  function lineIntersect(a, b) {
    const ux = a.x2 - a.x1, uy = a.y2 - a.y1, vx = b.x2 - b.x1, vy = b.y2 - b.y1;
    const den = cross(ux, uy, vx, vy);
    if (Math.abs(den) < 1e-9) return null;
    const s = cross(b.x1 - a.x1, b.y1 - a.y1, vx, vy) / den;
    return { x: a.x1 + s * ux, y: a.y1 + s * uy };
  }
  function angleBetween(a, b) {
    const t1 = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), t2 = Math.atan2(b.y2 - b.y1, b.x2 - b.x1);
    let d = Math.abs(t1 - t2) % Math.PI;
    if (d > Math.PI / 2) d = Math.PI - d;
    return d / DEG;
  }
  class DSU {
    constructor(n) { this.p = Array.from({ length: n }, (_, i) => i); }
    find(i) { while (this.p[i] !== i) { this.p[i] = this.p[this.p[i]]; i = this.p[i]; } return i; }
    union(a, b) { a = this.find(a); b = this.find(b); if (a !== b) this.p[b] = a; }
  }

  /* ----------------------------- 1) แยกเส้นออกจากพื้น ----------------------------- */
  // ค่าความสว่าง (สีสดถูกนับว่าสว่างขึ้น เพราะผนังส่วนใหญ่เป็นสีดำ/เทา ไม่ใช่สีพื้นห้อง)
  function lightness(img) {
    const { width: W, height: H, data } = img, n = W * H, out = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      if (data[j + 3] < 100) { out[i] = 255; continue; }
      const r = data[j], g = data[j + 1], b = data[j + 2];
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      const v = 0.299 * r + 0.587 * g + 0.114 * b + 0.6 * (mx - mn);
      out[i] = v > 255 ? 255 : v;
    }
    return out;
  }
  // Otsu: คืนค่ากลางของช่วงเกณฑ์ที่ดีที่สุด (ภาพที่มีแค่ดำ/ขาวจะได้เกณฑ์ตรงกลาง)
  function histOtsu(hist, total) {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = -1, first = 127, last = 127;
    for (let i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best * (1 + 1e-9)) { best = v; first = i; last = i; } else if (v >= best * (1 - 1e-9)) last = i;
    }
    return (first + last) / 2;
  }
  function otsuOf(values) {
    const hist = new Float64Array(256);
    for (let i = 0; i < values.length; i++) hist[values[i] < 0 ? 0 : values[i] > 255 ? 255 : values[i] | 0]++;
    return histOtsu(hist, values.length);
  }
  function maxFilter(src, W, H, r) {
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H), dq = new Int32Array(Math.max(W, H) + 1);
    for (let y = 0; y < H; y++) {
      const o = y * W;
      let h = 0, t = 0, next = 0;
      for (let x = 0; x < W; x++) {
        const hi = Math.min(W - 1, x + r);
        while (next <= hi) { const v = src[o + next]; while (t > h && src[o + dq[t - 1]] <= v) t--; dq[t++] = next++; }
        while (dq[h] < x - r) h++;
        tmp[o + x] = src[o + dq[h]];
      }
    }
    for (let x = 0; x < W; x++) {
      let h = 0, t = 0, next = 0;
      for (let y = 0; y < H; y++) {
        const hi = Math.min(H - 1, y + r);
        while (next <= hi) { const v = tmp[next * W + x]; while (t > h && tmp[dq[t - 1] * W + x] <= v) t--; dq[t++] = next++; }
        while (dq[h] < y - r) h++;
        out[y * W + x] = tmp[dq[h] * W + x];
      }
    }
    return out;
  }
  function boxBlur(src, W, H, r) {
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const o = y * W;
      let acc = 0, a = 0, b = -1;
      for (let x = 0; x < W; x++) {
        const lo = Math.max(0, x - r), hi = Math.min(W - 1, x + r);
        while (b < hi) acc += src[o + ++b];
        while (a < lo) acc -= src[o + a++];
        tmp[o + x] = acc / (hi - lo + 1);
      }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0, a = 0, b = -1;
      for (let y = 0; y < H; y++) {
        const lo = Math.max(0, y - r), hi = Math.min(H - 1, y + r);
        while (b < hi) acc += tmp[++b * W + x];
        while (a < lo) acc -= tmp[a++ * W + x];
        out[y * W + x] = acc / (hi - lo + 1);
      }
    }
    return out;
  }
  /* opts: sens (-1..1 ยิ่งมากยิ่งจับเส้นจาง), invert ('auto'|true|false),
           color [r,g,b] + tol = เลือกสีผนังเอง (เช่น สีอาคารในแผนที่) */
  function binarize(img, opts) {
    const o = opts || {}, W = img.width, H = img.height, n = W * H, ink = new Uint8Array(n);
    if (o.color) {
      const d = img.data, cr = o.color[0], cg = o.color[1], cb = o.color[2], tol = o.tol || 60, t2 = tol * tol;
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        if (d[j + 3] < 100) continue;
        const dr = d[j] - cr, dg = d[j + 1] - cg, db = d[j + 2] - cb;
        if (dr * dr + dg * dg + db * db <= t2) ink[i] = 1;
      }
      return { ink, inverted: false, threshold: null };
    }
    const v = lightness(img);
    const t0 = otsuOf(v);
    let darkCount = 0;
    for (let i = 0; i < n; i++) if (v[i] <= t0) darkCount++;
    const inverted = o.invert === true || (o.invert !== false && darkCount / n > 0.55);
    if (inverted) for (let i = 0; i < n; i++) v[i] = 255 - v[i];
    // ปรับแสงไม่สม่ำเสมอ (ภาพถ่ายกระดาษ): หารด้วยความสว่างกระดาษรอบ ๆ
    const r = Math.max(6, Math.round(Math.max(W, H) / 40));
    const bg = boxBlur(maxFilter(v, W, H, r), W, H, Math.max(2, r >> 1));
    const norm = new Float32Array(n);
    const hist = new Float64Array(256);
    for (let i = 0; i < n; i++) {
      const q = v[i] / (bg[i] > 30 ? bg[i] : 30);
      norm[i] = q > 1 ? 1 : q;
      hist[Math.min(255, Math.round(norm[i] * 255))]++;
    }
    let t = clamp(histOtsu(hist, n) / 255, 0.3, 0.85) + (o.sens || 0) * 0.12;
    t = clamp(t, 0.12, 0.97);
    for (let i = 0; i < n; i++) if (norm[i] < t) ink[i] = 1;
    return { ink, inverted, threshold: t };
  }
  // โหมดพื้นที่ทึบ (เช่น อาคารในแผนที่): ใช้ขอบของพื้นที่เป็นผนัง
  function outline(ink, W, H) {
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!ink[i]) continue;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || !ink[i - 1] || !ink[i + 1] || !ink[i - W] || !ink[i + W]) out[i] = 1;
    }
    return out;
  }

  // เปิดภาพ (erode แล้ว dilate) ด้วยสี่เหลี่ยม (2r+1): ลบเส้นบางกว่า 2r+1 px เช่น ตัวหนังสือ เฟอร์นิเจอร์ เส้นบอกขนาด
  function prefixSum(src, W, H) {
    const S = new Int32Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) { row += src[y * W + x]; S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row; }
    }
    return S;
  }
  function boxMorph(src, W, H, r, erode) {
    const S = prefixSum(src, W, H), out = new Uint8Array(W * H), W1 = W + 1;
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
        const cnt = S[(y1 + 1) * W1 + x1 + 1] - S[y0 * W1 + x1 + 1] - S[(y1 + 1) * W1 + x0] + S[y0 * W1 + x0];
        out[y * W + x] = erode ? (cnt === (x1 - x0 + 1) * (y1 - y0 + 1) ? 1 : 0) : (cnt > 0 ? 1 : 0);
      }
    }
    return out;
  }
  const openBox = (ink, W, H, r) => boxMorph(boxMorph(ink, W, H, r, true), W, H, r, false);

  /* ----------------------------- 2) หมุน / แก้มุมมอง ----------------------------- */
  function sampleRGBA(src, x, y, out, k) {
    const W = src.width, H = src.height, d = src.data;
    if (x < -0.5 || y < -0.5 || x > W - 0.5 || y > H - 0.5) { out[k] = out[k + 1] = out[k + 2] = 255; out[k + 3] = 255; return; }
    const fx = clamp(x - 0.5, 0, W - 1), fy = clamp(y - 0.5, 0, H - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
    const ax = fx - x0, ay = fy - y0;
    for (let c = 0; c < 4; c++) {
      const p00 = d[(y0 * W + x0) * 4 + c], p10 = d[(y0 * W + x1) * 4 + c], p01 = d[(y1 * W + x0) * 4 + c], p11 = d[(y1 * W + x1) * 4 + c];
      out[k + c] = (p00 * (1 - ax) + p10 * ax) * (1 - ay) + (p01 * (1 - ax) + p11 * ax) * ay;
    }
  }
  // หมุนเนื้อหาภาพ deg องศา (ขยายขนาดภาพให้ไม่ตัดมุม เติมสีขาว)
  function rotateImage(img, deg) {
    const a = deg * DEG, c = Math.cos(a), s = Math.sin(a), W = img.width, H = img.height;
    const W2 = Math.ceil(Math.abs(W * c) + Math.abs(H * s)), H2 = Math.ceil(Math.abs(W * s) + Math.abs(H * c));
    const out = new Uint8ClampedArray(W2 * H2 * 4);
    const cx = W / 2, cy = H / 2, cx2 = W2 / 2, cy2 = H2 / 2;
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
      const dx = x + 0.5 - cx2, dy = y + 0.5 - cy2;
      sampleRGBA(img, c * dx + s * dy + cx, -s * dx + c * dy + cy, out, (y * W2 + x) * 4);
    }
    return { width: W2, height: H2, data: out };
  }
  function solveLinear(A, b) {
    const n = b.length, M = A.map((row, i) => row.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      if (Math.abs(M[c][c]) < 1e-12) return null;
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((row, i) => row[n] / row[i]);
  }
  // homography ที่ส่งจุด src[i] → dst[i] (จุดละ {x,y} 4 จุด)
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const { x, y } = src[i], { x: u, y: v } = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = solveLinear(A, b);
    return h ? h.concat([1]) : null;
  }
  // ตัดและดัดภาพตามมุมกระดาษ 4 จุด (บนซ้าย บนขวา ล่างขวา ล่างซ้าย) ให้เป็นสี่เหลี่ยมตรง
  function warpQuad(img, quad, maxSide) {
    const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
    let w = Math.max(d(quad[0], quad[1]), d(quad[3], quad[2])), h = Math.max(d(quad[0], quad[3]), d(quad[1], quad[2]));
    const f = Math.min(1, (maxSide || 1000) / Math.max(w, h));
    w = Math.max(8, Math.round(w * f)); h = Math.max(8, Math.round(h * f));
    const Hm = homography([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], quad);
    const out = new Uint8ClampedArray(w * h * 4);
    if (!Hm) return { width: w, height: h, data: out.fill(255) };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const X = x + 0.5, Y = y + 0.5, z = Hm[6] * X + Hm[7] * Y + Hm[8];
      sampleRGBA(img, (Hm[0] * X + Hm[1] * Y + Hm[2]) / z, (Hm[3] * X + Hm[4] * Y + Hm[5]) / z, out, (y * w + x) * 4);
    }
    return { width: w, height: h, data: out };
  }
  // ย่อภาพ (เฉลี่ยพิกเซล) ให้ด้านยาวไม่เกิน maxSide
  function downscale(img, maxSide) {
    const W = img.width, H = img.height, f = maxSide / Math.max(W, H);
    if (f >= 1) return img;
    const w = Math.max(1, Math.round(W * f)), h = Math.max(1, Math.round(H * f)), out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const xa = Math.floor(x / f), xb = Math.min(W, Math.max(xa + 1, Math.floor((x + 1) / f))), ya = Math.floor(y / f), yb = Math.min(H, Math.max(ya + 1, Math.floor((y + 1) / f)));
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let yy = ya; yy < yb; yy++) for (let xx = xa; xx < xb; xx++) { const k = (yy * W + xx) * 4; acc[0] += img.data[k]; acc[1] += img.data[k + 1]; acc[2] += img.data[k + 2]; acc[3] += img.data[k + 3]; n++; }
      const k = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) out[k + c] = acc[c] / n;
    }
    return { width: w, height: h, data: out };
  }
  // หาแผ่นกระดาษในภาพถ่าย (พื้นที่สว่างก้อนใหญ่ที่สุด) → มุม 4 มุม [บนซ้าย บนขวา ล่างขวา ล่างซ้าย]
  function findPaper(img) {
    const sm = downscale(img, 400), W = sm.width, H = sm.height, n = W * H, L = lightness(sm), t = otsuOf(L);
    const lab = new Int32Array(n).fill(-1), stack = new Int32Array(n);
    let best = null;
    for (let s0 = 0; s0 < n; s0++) {
      if (lab[s0] !== -1 || L[s0] <= t) continue;
      let sp = 0, area = 0;
      const ext = { tl: [1e9, 0, 0], br: [-1e9, 0, 0], tr: [-1e9, 0, 0], bl: [1e9, 0, 0] };
      stack[sp++] = s0; lab[s0] = s0;
      while (sp) {
        const i = stack[--sp], x = i % W, y = (i - x) / W;
        area++;
        if (x + y < ext.tl[0]) ext.tl = [x + y, x, y];
        if (x + y > ext.br[0]) ext.br = [x + y, x, y];
        if (x - y > ext.tr[0]) ext.tr = [x - y, x, y];
        if (x - y < ext.bl[0]) ext.bl = [x - y, x, y];
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && lab[j] === -1 && L[j] > t) { lab[j] = s0; stack[sp++] = j; }
      }
      if (!best || area > best.area) best = { area, ext };
    }
    if (!best || best.area / n < 0.2) return null;
    const f = img.width / W, P = e => ({ x: (e[1] + 0.5) * f, y: (e[2] + 0.5) * f });
    const quad = [P(best.ext.tl), P(best.ext.tr), P(best.ext.br), P(best.ext.bl)];
    const qa = Math.abs(quad.reduce((a, p, i) => { const q = quad[(i + 1) % 4]; return a + p.x * q.y - q.x * p.y; }, 0)) / 2;
    if (qa > 0.94 * img.width * img.height) return null;           // ทั้งภาพคือกระดาษอยู่แล้ว (ภาพแคปหน้าจอ)
    return quad;
  }
  // หามุมเอียงของภาพ (องศา) จากการฉายจุดหมึก: มุมที่ทำให้เส้นเรียงตรงที่สุด
  function estimateSkew(ink, W, H, range) {
    const R = range || 10;
    let count = 0;
    for (let i = 0; i < ink.length; i++) if (ink[i]) count++;
    if (count < 50) return 0;
    const step = Math.max(1, Math.floor(count / 60000)), xs = [], ys = [];
    let c = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ink[y * W + x] && c++ % step === 0) { xs.push(x - W / 2); ys.push(y - H / 2); }
    const D = Math.ceil(Math.hypot(W, H)) + 2, b1 = new Float64Array(2 * D + 2), b2 = new Float64Array(2 * D + 2);
    const score = deg => {
      const a = deg * DEG, cs = Math.cos(a), sn = Math.sin(a);
      b1.fill(0); b2.fill(0);
      for (let k = 0; k < xs.length; k++) {
        b1[Math.round(xs[k] * cs + ys[k] * sn) + D]++;
        b2[Math.round(-xs[k] * sn + ys[k] * cs) + D]++;
      }
      let s = 0;
      for (let i = 0; i < b1.length; i++) s += b1[i] * b1[i] + b2[i] * b2[i];
      return s;
    };
    let best = 0, bs = -1;
    for (let d = -R; d <= R + 1e-9; d += 0.5) { const s = score(d); if (s > bs) { bs = s; best = d; } }
    const base = best;
    for (let d = base - 0.5; d <= base + 0.5 + 1e-9; d += 0.1) { const s = score(d); if (s > bs) { bs = s; best = d; } }
    best = Math.round(best * 10) / 10;
    return Math.abs(best) < 0.3 ? 0 : best;
  }

  /* ----------------------------- 3) หาเส้นผนัง ----------------------------- */
  function transpose(a, W, H) {
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[x * H + y] = a[y * W + x];
    return out;
  }
  // แถวที่มีหมึกยาวต่อกัน → กลุ่มแถวที่ซ้อนกัน = ผนังแนวนอน 1 เส้น (k = ขยายแนวตั้งเพื่อทนเส้นสั่น)
  function runBands(ink, W, H, minRun, k) {
    const row = new Uint8Array(W), out = [];
    let active = [];
    for (let y = 0; y < H; y++) {
      row.fill(0);
      const ya = Math.max(0, y - k), yb = Math.min(H - 1, y + k);
      for (let yy = ya; yy <= yb; yy++) { const o = yy * W; for (let x = 0; x < W; x++) if (ink[o + x]) row[x] = 1; }
      const runs = [];
      for (let x = 0; x < W;) {
        if (!row[x]) { x++; continue; }
        const s = x;
        while (x < W && row[x]) x++;
        if (x - s >= minRun) runs.push(s, x - 1);
      }
      const next = [];
      for (let i = 0; i < runs.length; i += 2) {
        const s = runs[i], e = runs[i + 1], L = e - s + 1;
        let best = null, bo = 0;
        for (const b of active) {
          if (b.used) continue;
          const ov = Math.min(e, b.e) - Math.max(s, b.s) + 1;
          if (ov > bo) { bo = ov; best = b; }
        }
        if (best && bo >= 0.7 * Math.max(L, best.e - best.s + 1)) {
          best.used = true; best.s = s; best.e = e; best.ss.push(s); best.es.push(e); best.y1 = y;
          next.push(best);
        } else next.push({ s, e, ss: [s], es: [e], y0: y, y1: y, used: true });
      }
      for (const b of active) if (!b.used) out.push(b);
      for (const b of next) b.used = false;
      active = next;
    }
    out.push(...active);
    return out;
  }
  function axisSegments(ink, W, H, minRun, k) {
    const segs = [];
    const fromBand = (b, o) => {
      const t = Math.max(1, b.y1 - b.y0 + 1 - 2 * k), a = median(b.ss), e = median(b.es) + 1, c = (b.y0 + b.y1 + 1) / 2;
      if (e - a < Math.max(minRun, 1.8 * t)) return;
      segs.push(o === 'h' ? { o, x1: a, y1: c, x2: e, y2: c, t } : { o, x1: c, y1: a, x2: c, y2: e, t });
    };
    runBands(ink, W, H, minRun, k).forEach(b => fromBand(b, 'h'));
    runBands(transpose(ink, W, H), H, W, minRun, k).forEach(b => fromBand(b, 'v'));
    return segs;
  }
  function stampSeg(mask, W, H, s, hw, val) {
    const x0 = Math.max(0, Math.floor(Math.min(s.x1, s.x2) - hw)), x1 = Math.min(W - 1, Math.ceil(Math.max(s.x1, s.x2) + hw));
    const y0 = Math.max(0, Math.floor(Math.min(s.y1, s.y2) - hw)), y1 = Math.min(H - 1, Math.ceil(Math.max(s.y1, s.y2) + hw));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (pointSegDist(x + 0.5, y + 0.5, s) <= hw) mask[y * W + x] = val;
  }
  // ผนังเฉียง: Hough transform บนหมึกที่เหลือจากผนังแนวนอน/ตั้ง
  function diagonalSegments(ink, W, H, axis, minLen) {
    const res = ink.slice();
    for (const s of axis) stampSeg(res, W, H, s, s.t / 2 + 2, 0);
    let count = 0;
    for (let i = 0; i < res.length; i++) if (res[i]) count++;
    if (count < minLen) return [];
    const step = Math.max(1, Math.floor(count / 50000)), xs = [], ys = [];
    let c = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (res[y * W + x] && c++ % step === 0) { xs.push(x + 0.5); ys.push(y + 0.5); }
    const thetas = [];
    for (let d = 0; d < 180; d++) { const m = d % 90; if (m >= 8 && m <= 82) thetas.push(d); }
    const R = Math.ceil(Math.hypot(W, H)), nR = 2 * R + 1, nT = thetas.length;
    const cs = thetas.map(d => Math.cos(d * DEG)), sn = thetas.map(d => Math.sin(d * DEG));
    const acc = new Int32Array(nT * nR);
    for (let k = 0; k < xs.length; k++) for (let ti = 0; ti < nT; ti++) acc[ti * nR + Math.round(xs[k] * cs[ti] + ys[k] * sn[ti]) + R]++;
    const minVotes = Math.max(6, Math.floor(minLen * 0.75 / step));
    const out = [];
    const at = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y); return xi >= 0 && yi >= 0 && xi < W && yi < H && res[yi * W + xi]; };
    const inkAt = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y); return xi >= 0 && yi >= 0 && xi < W && yi < H && ink[yi * W + xi]; };
    for (let iter = 0; iter < 40; iter++) {
      let best = -1, bv = minVotes - 1;
      for (let i = 0; i < acc.length; i++) if (acc[i] > bv) { bv = acc[i]; best = i; }
      if (best < 0) break;
      const ti = Math.floor(best / nR), rIdx = best % nR, r = rIdx - R;
      for (let dt = -5; dt <= 5; dt++) {
        const tj = ti + dt;
        if (tj < 0 || tj >= nT) continue;
        for (let dr = -10; dr <= 10; dr++) { const rr = rIdx + dr; if (rr >= 0 && rr < nR) acc[tj * nR + rr] = 0; }
      }
      const ca = cs[ti], sa = sn[ti];
      // จุดบนเส้น: (r·cos, r·sin) + t·(−sin, cos)
      const hit = t => { const px = r * ca - t * sa, py = r * sa + t * ca; for (let q = -2; q <= 2; q++) if (at(px + q * ca, py + q * sa)) return true; return false; };
      let runStart = null, lastHit = null;
      const flush = () => {
        if (runStart === null) return;
        if (lastHit - runStart >= minLen) {
          const ts = [], offs = [];
          for (let k = 1; k <= 7; k++) {
            const t = runStart + (lastHit - runStart) * k / 8, px = r * ca - t * sa, py = r * sa + t * ca;
            let f = 0, b = 0;
            while (f < 30 && inkAt(px + (f + 1) * ca, py + (f + 1) * sa)) f++;
            while (b < 30 && inkAt(px - (b + 1) * ca, py - (b + 1) * sa)) b++;
            if (inkAt(px, py)) { ts.push(f + b + 1); offs.push((f - b) / 2); }
          }
          const t = Math.max(1, median(ts) || 1), off = median(offs);
          const rr = r + off;
          const s = mkSeg(rr * ca - runStart * sa, rr * sa + runStart * ca, rr * ca - lastHit * sa, rr * sa + lastHit * ca, t);
          if (segLen(s) >= Math.max(minLen, 2 * t)) { out.push(s); stampSeg(res, W, H, s, t / 2 + 2, 0); }
        }
        runStart = null;
      };
      for (let t = -R; t <= R; t++) {
        if (hit(t)) { if (runStart === null) runStart = t; lastHit = t; }
        else if (runStart !== null && t - lastHit > 4) flush();
      }
      flush();
    }
    return out;
  }

  /* ----------------------------- 4) จัดระเบียบเส้น ----------------------------- */
  // รวมเส้นที่อยู่แนวเดียวกันและขาดจากกันเล็กน้อย
  function mergeCollinear(segs, gapTol) {
    const n = segs.length, dsu = new DSU(n);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const A = segs[i], B = segs[j];
      if (A.o !== B.o || (A.o === 'd' && angleBetween(A, B) > 3)) continue;
      const tol = Math.max(2, 0.5 * Math.min(A.t, B.t));
      let gap;
      if (A.o === 'h') { if (Math.abs(A.y1 - B.y1) > tol) continue; gap = Math.max(A.x1, B.x1) - Math.min(A.x2, B.x2); }
      else if (A.o === 'v') { if (Math.abs(A.x1 - B.x1) > tol) continue; gap = Math.max(A.y1, B.y1) - Math.min(A.y2, B.y2); }
      else {
        const L = segLen(A), ux = (A.x2 - A.x1) / L, uy = (A.y2 - A.y1) / L;
        const off = p => cross(ux, uy, p[0] - A.x1, p[1] - A.y1), pr = p => (p[0] - A.x1) * ux + (p[1] - A.y1) * uy;
        if (Math.abs(off([B.x1, B.y1])) > tol || Math.abs(off([B.x2, B.y2])) > tol) continue;
        const b1 = pr([B.x1, B.y1]), b2 = pr([B.x2, B.y2]);
        gap = Math.max(0, Math.min(b1, b2)) - Math.min(L, Math.max(b1, b2));
      }
      if (gap <= gapTol) dsu.union(i, j);
    }
    const groups = new Map();
    for (let i = 0; i < n; i++) { const r = dsu.find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(segs[i]); }
    const out = [];
    for (const g of groups.values()) {
      if (g.length === 1) { out.push(g[0]); continue; }
      const ref = g.reduce((a, b) => (segLen(b) > segLen(a) ? b : a));
      const L = segLen(ref), ux = (ref.x2 - ref.x1) / L, uy = (ref.y2 - ref.y1) / L;
      let lo = Infinity, hi = -Infinity, offW = 0, wsum = 0, t = 0;
      for (const s of g) {
        for (const [px, py] of [[s.x1, s.y1], [s.x2, s.y2]]) { const p = (px - ref.x1) * ux + (py - ref.y1) * uy; lo = Math.min(lo, p); hi = Math.max(hi, p); }
        const l = segLen(s), mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
        offW += cross(ux, uy, mx - ref.x1, my - ref.y1) * l; wsum += l; t = Math.max(t, s.t);
      }
      const off = offW / wsum, nx = -uy, ny = ux;
      const m = mkSeg(ref.x1 + ux * lo + nx * off, ref.y1 + uy * lo + ny * off, ref.x1 + ux * hi + nx * off, ref.y1 + uy * hi + ny * off, t);
      if (ref.o === 'h' && m.o !== 'h') { m.o = 'h'; m.y2 = m.y1; }
      if (ref.o === 'v' && m.o !== 'v') { m.o = 'v'; m.x2 = m.x1; }
      out.push(m);
    }
    return out;
  }
  // เส้นบางคู่ขนานใกล้กัน (ผนังแบบเส้นคู่ใน CAD) → ผนังหนา 1 เส้น
  function pairParallel(segs, maxSep, minSep, thinMax) {
    const cand = [];
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      const A = segs[i], B = segs[j];
      if (A.o !== B.o || A.o === 'd' || A.t > thinMax || B.t > thinMax) continue;
      const h = A.o === 'h';
      const sep = Math.abs(h ? B.y1 - A.y1 : B.x1 - A.x1);
      if (sep < minSep || sep > maxSep) continue;
      const a1 = h ? A.x1 : A.y1, a2 = h ? A.x2 : A.y2, b1 = h ? B.x1 : B.y1, b2 = h ? B.x2 : B.y2;
      const ov = Math.min(a2, b2) - Math.max(a1, b1);
      if (ov < 0.5 * Math.min(a2 - a1, b2 - b1)) continue;
      cand.push({ i, j, sep });
    }
    cand.sort((p, q) => p.sep - q.sep);
    const used = new Set(), out = [];
    for (const c of cand) {
      if (used.has(c.i) || used.has(c.j)) continue;
      used.add(c.i); used.add(c.j);
      const A = segs[c.i], B = segs[c.j], t = c.sep + (A.t + B.t) / 2;
      if (A.o === 'h') out.push({ o: 'h', x1: Math.min(A.x1, B.x1), x2: Math.max(A.x2, B.x2), y1: (A.y1 + B.y1) / 2, y2: (A.y1 + B.y1) / 2, t, paired: true });
      else out.push({ o: 'v', y1: Math.min(A.y1, B.y1), y2: Math.max(A.y2, B.y2), x1: (A.x1 + B.x1) / 2, x2: (A.x1 + B.x1) / 2, t, paired: true });
    }
    segs.forEach((s, i) => { if (!used.has(i)) out.push(s); });
    return out;
  }
  // ลบเส้นบางที่ซ้อนอยู่ในผนังหนาอยู่แล้ว
  function absorb(segs) {
    return segs.filter(B => !segs.some(A => {
      if (A === B || A.t < B.t || (A.t === B.t && segLen(A) <= segLen(B)) || angleBetween(A, B) > 5) return false;
      const L = segLen(A), ux = (A.x2 - A.x1) / L, uy = (A.y2 - A.y1) / L;
      return [[B.x1, B.y1], [B.x2, B.y2]].every(([px, py]) => {
        const p = (px - A.x1) * ux + (py - A.y1) * uy, d = Math.abs(cross(ux, uy, px - A.x1, py - A.y1));
        return d <= A.t / 2 + 1 && p >= -A.t / 2 - 1 && p <= L + A.t / 2 + 1;
      });
    }));
  }
  // ตัดเส้นที่ไม่เชื่อมกับโครงผนังหลัก (เส้นบอกขนาด ขีดเส้นใต้ ตัวหนังสือ)
  function keepConnected(segs, maxDim, linkTol) {
    const n = segs.length, dsu = new DSU(n);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const A = segs[i], B = segs[j];
      if (segSegDist(A, B) <= (A.t + B.t) / 2 + linkTol) dsu.union(i, j);
    }
    const tot = new Map();
    for (let i = 0; i < n; i++) { const r = dsu.find(i); tot.set(r, (tot.get(r) || 0) + segLen(segs[i])); }
    const maxT = Math.max(0, ...tot.values());
    return segs.filter((s, i) => { const t = tot.get(dsu.find(i)); return t >= 0.12 * maxT && t >= 0.2 * maxDim; });
  }
  // ต่อปลายผนังให้ชนผนังตั้งฉากที่อยู่ใกล้ (มุมห้องปิดสนิท)
  function snapEnds(segs, tol) {
    for (const s of segs) {
      for (const end of [1, 2]) {
        const ex = end === 1 ? s.x1 : s.x2, ey = end === 1 ? s.y1 : s.y2;
        const ox = end === 1 ? s.x2 : s.x1, oy = end === 1 ? s.y2 : s.y1;
        const cands = [];
        for (const q of segs) {
          if (q === s || angleBetween(s, q) < 25) continue;
          const lim = Math.max(s.t, q.t) / 2 + tol;
          const L = segLen(q), ux = (q.x2 - q.x1) / L, uy = (q.y2 - q.y1) / L;
          const p = (ex - q.x1) * ux + (ey - q.y1) * uy;
          if (p < -lim || p > L + lim) continue;
          const d = Math.abs(cross(ux, uy, ex - q.x1, ey - q.y1));
          if (d <= lim) cands.push({ q, d });
        }
        cands.sort((a, b) => a.d - b.d);
        let P = null;
        for (const { q } of cands) {
          const X = lineIntersect(s, q);
          if (!X || Math.hypot(X.x - ex, X.y - ey) > Math.max(s.t, q.t) / 2 + tol + 1) continue;
          // ยืดเข้าหาผนังได้ แต่ตัดสั้นลงได้แค่ส่วนที่ล้นเข้าไปในความหนาผนัง (ไม่กินช่องประตู)
          const dx = ex - ox, dy = ey - oy, tP = ((X.x - ox) * dx + (X.y - oy) * dy) / (dx * dx + dy * dy || 1);
          if (tP < 1 && (1 - tP) * Math.hypot(dx, dy) > q.t / 2 + 2) continue;
          if (Math.hypot(X.x - ox, X.y - oy) < 2) continue;
          P = X;
          break;
        }
        if (!P) continue;
        if (end === 1) { s.x1 = P.x; s.y1 = P.y; } else { s.x2 = P.x; s.y2 = P.y; }
        if (s.o === 'h') { s.y1 = s.y2 = (end === 1 ? s.y2 : s.y1); }
        if (s.o === 'v') { s.x1 = s.x2 = (end === 1 ? s.x2 : s.x1); }
      }
      if (s.o === 'h' && s.x1 > s.x2) [s.x1, s.x2] = [s.x2, s.x1];
      if (s.o === 'v' && s.y1 > s.y2) [s.y1, s.y2] = [s.y2, s.y1];
    }
    return segs;
  }

  /* ----------------------------- 5) ประตู / หน้าต่าง ----------------------------- */
  // จากปลายผนังมองต่อไปข้างหน้า ถ้าเว้นช่องแล้วเจอผนังอีกเส้น = ช่องเปิด (ประตู/หน้าต่าง)
  function findOpenings(segs, ink, W, H, maxGap, windowLines, maxWin) {
    const out = [], winLim = maxWin || maxGap * 2.5;
    const touch = s => Math.max(2, 0.3 * s.t);
    for (const s of segs) {
      const L = segLen(s);
      if (L < 1) continue;
      const ux = (s.x2 - s.x1) / L, uy = (s.y2 - s.y1) / L;
      for (const end of [1, 2]) {
        const ex = end === 1 ? s.x1 : s.x2, ey = end === 1 ? s.y1 : s.y2, dx = end === 1 ? -ux : ux, dy = end === 1 ? -uy : uy;
        // ปลายที่ชนผนังอื่นอยู่แล้ว (มุมห้อง / ตัว T) ไม่ใช่ขอบประตู
        if (segs.some(q => q !== s && pointSegDist(ex, ey, q) <= q.t / 2 + 1.5)) continue;
        let bestG = Infinity, bestP = null;
        for (const q of segs) {
          if (q === s) continue;
          const vx = q.x2 - q.x1, vy = q.y2 - q.y1, den = cross(dx, dy, vx, vy), lq = Math.hypot(vx, vy);
          if (Math.abs(den) < 1e-6 * lq) {
            // ขนาน: อยู่แนวเดียวกันไหม
            const off = Math.abs(cross(dx, dy, q.x1 - ex, q.y1 - ey));
            if (off > Math.max(s.t, q.t) / 2 + 1) continue;
            const p1 = (q.x1 - ex) * dx + (q.y1 - ey) * dy, p2 = (q.x2 - ex) * dx + (q.y2 - ey) * dy;
            const near = Math.min(p1, p2), far = Math.max(p1, p2);
            if (far <= 0) continue;
            const g = Math.max(0, near);
            if (g < bestG) { bestG = g; bestP = { x: ex + dx * g, y: ey + dy * g }; }
          } else {
            const sHit = cross(q.x1 - ex, q.y1 - ey, vx, vy) / den, rHit = cross(q.x1 - ex, q.y1 - ey, dx, dy) / den;
            const ext = (s.t / 2 + 1) / lq;
            if (rHit < -ext || rHit > 1 + ext || sHit < -s.t) continue;
            const sinA = Math.abs(den) / lq, g = sHit - (q.t / 2) / Math.max(0.3, sinA);
            if (g < bestG) { bestG = g; bestP = { x: ex + dx * Math.max(0, g), y: ey + dy * Math.max(0, g) }; }
          }
        }
        if (!bestP || bestG <= touch(s) || bestG > winLim) continue;
        const o = mkSeg(ex, ey, bestP.x, bestP.y, s.t);
        const mx = (o.x1 + o.x2) / 2, my = (o.y1 + o.y2) / 2;
        if (out.some(p => Math.hypot((p.x1 + p.x2) / 2 - mx, (p.y1 + p.y2) / 2 - my) < Math.max(4, s.t))) continue;
        o.kind = classifyOpening(o, ink, W, H, windowLines);
        if (o.kind !== 'window' && bestG > maxGap) {
          // ช่องกว้างเกินประตูบนผนังด้านนอกอาคาร = หน้าต่าง/ประตูกระจกบานใหญ่ (เส้นหน้าต่างจางจนมองไม่เห็น)
          if (!exterior(o, segs, W, H)) continue;               // ช่องกว้างในอาคาร = พื้นที่เปิดโล่ง ไม่ปิด
          o.kind = 'window';
        }
        out.push(o);
      }
    }
    return out;
  }
  // ช่องอยู่บนผนังรอบนอกไหม: มองตั้งฉากออกไปด้านหนึ่งแล้วไม่เจอผนังเลยจนสุดภาพ
  function exterior(o, segs, W, H) {
    const L = segLen(o), nx = -(o.y2 - o.y1) / L, ny = (o.x2 - o.x1) / L, mx = (o.x1 + o.x2) / 2, my = (o.y1 + o.y2) / 2, far = W + H;
    return [1, -1].some(sg => {
      const ray = { x1: mx + sg * nx * (o.t / 2 + 2), y1: my + sg * ny * (o.t / 2 + 2), x2: mx + sg * nx * far, y2: my + sg * ny * far };
      return !segs.some(q => segsIntersect(ray, q) || pointSegDist(q.x1, q.y1, ray) < 0.5 || pointSegDist(q.x2, q.y2, ray) < 0.5);
    });
  }
  function classifyOpening(o, ink, W, H, windowLines) {
    if (windowLines && windowLines.length) {
      const L = segLen(o), ux = (o.x2 - o.x1) / L, uy = (o.y2 - o.y1) / L;
      const inside = windowLines.some(w => [[(w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2]].every(([px, py]) => {
        const p = (px - o.x1) * ux + (py - o.y1) * uy, d = Math.abs(cross(ux, uy, px - o.x1, py - o.y1));
        return p >= -2 && p <= L + 2 && d <= o.t / 2 + 3;
      }));
      return inside ? 'window' : 'door';
    }
    if (!ink) return 'door';
    const L = segLen(o), ux = (o.x2 - o.x1) / L, uy = (o.y2 - o.y1) / L, hw = Math.max(1.5, o.t / 2);
    let tot = 0, hitN = 0;
    for (let p = 1; p < L - 1; p += 1) for (let q = -hw; q <= hw; q += 1) {
      const x = Math.floor(o.x1 + ux * p - uy * q), y = Math.floor(o.y1 + uy * p + ux * q);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      tot++;
      if (ink[y * W + x]) hitN++;
    }
    return tot && hitN / tot >= 0.15 ? 'window' : 'door';
  }

  /* ----------------------------- 6) หาห้อง ----------------------------- */
  function buildRooms(W, H, walls, openings, opts) {
    const o = opts || {}, maxDim = Math.max(W, H);
    const c = o.cell || Math.max(1, Math.round(maxDim / 320));
    const cols = Math.ceil(W / c), rows = Math.ceil(H / c), n = cols * rows;
    const block = new Uint8Array(n);
    const stamp = (s, hw) => {
      const lim = hw + c * 0.5;
      const x0 = Math.max(0, Math.floor((Math.min(s.x1, s.x2) - lim) / c)), x1 = Math.min(cols - 1, Math.floor((Math.max(s.x1, s.x2) + lim) / c));
      const y0 = Math.max(0, Math.floor((Math.min(s.y1, s.y2) - lim) / c)), y1 = Math.min(rows - 1, Math.floor((Math.max(s.y1, s.y2) + lim) / c));
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (pointSegDist((cx + 0.5) * c, (cy + 0.5) * c, s) <= lim) block[cy * cols + cx] = 1;
    };
    walls.forEach(s => stamp(s, Math.max(s.t / 2, c * 0.5)));
    openings.forEach(s => stamp(s, s.kind === 'window' ? Math.max(s.t / 2, c * 0.5) : c * 0.5));
    const lab = new Int32Array(n).fill(-1);       // -2 = ภายนอก, -3 = ผนัง
    for (let i = 0; i < n; i++) if (block[i]) lab[i] = -3;
    const stack = new Int32Array(n);
    const fill = (start, val) => {
      let sp = 0, cnt = 0;
      stack[sp++] = start; lab[start] = val;
      while (sp) {
        const i = stack[--sp], x = i % cols, y = (i - x) / cols;
        cnt++;
        if (x > 0 && lab[i - 1] === -1) { lab[i - 1] = val; stack[sp++] = i - 1; }
        if (x < cols - 1 && lab[i + 1] === -1) { lab[i + 1] = val; stack[sp++] = i + 1; }
        if (y > 0 && lab[i - cols] === -1) { lab[i - cols] = val; stack[sp++] = i - cols; }
        if (y < rows - 1 && lab[i + cols] === -1) { lab[i + cols] = val; stack[sp++] = i + cols; }
      }
      return cnt;
    };
    for (let x = 0; x < cols; x++) { if (lab[x] === -1) fill(x, -2); const b = (rows - 1) * cols + x; if (lab[b] === -1) fill(b, -2); }
    for (let y = 0; y < rows; y++) { const a = y * cols; if (lab[a] === -1) fill(a, -2); const b = a + cols - 1; if (lab[b] === -1) fill(b, -2); }
    const comps = [];
    for (let i = 0; i < n; i++) if (lab[i] === -1) { const id = comps.length; comps.push({ id, cells: fill(i, id) }); }
    // ระยะห่างจากขอบห้อง (ใช้หาจุดวางป้ายชื่อ และตัดช่องแคบที่ไม่ใช่ห้อง)
    const dist = new Int32Array(n).fill(0);
    let q = [];
    for (let i = 0; i < n; i++) {
      if (lab[i] < 0) continue;
      const x = i % cols, y = (i - x) / cols;
      const edge = x === 0 || y === 0 || x === cols - 1 || y === rows - 1 || lab[i - 1] !== lab[i] || lab[i + 1] !== lab[i] || lab[i - cols] !== lab[i] || lab[i + cols] !== lab[i];
      if (edge) { dist[i] = 1; q.push(i); }
    }
    while (q.length) {
      const nq = [];
      for (const i of q) {
        const x = i % cols, y = (i - x) / cols, d = dist[i] + 1;
        for (const j of [x > 0 ? i - 1 : -1, x < cols - 1 ? i + 1 : -1, y > 0 ? i - cols : -1, y < rows - 1 ? i + cols : -1]) {
          if (j >= 0 && lab[j] === lab[i] && !dist[j]) { dist[j] = d; nq.push(j); }
        }
      }
      q = nq;
    }
    comps.forEach(cp => Object.assign(cp, { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, best: -1, bd: 0 }));
    for (let i = 0; i < n; i++) {
      const id = lab[i];
      if (id < 0) continue;
      const cp = comps[id], x = i % cols, y = (i - x) / cols;
      if (x < cp.x0) cp.x0 = x; if (x > cp.x1) cp.x1 = x; if (y < cp.y0) cp.y0 = y; if (y > cp.y1) cp.y1 = y;
      if (dist[i] > cp.bd) { cp.bd = dist[i]; cp.best = i; }
    }
    const minArea = (o.minArea || 0.0015) * W * H, minR = Math.max(3, 0.008 * maxDim);
    const ring = cp => (cp.x1 - cp.x0 + 1) >= 0.9 * cols && (cp.y1 - cp.y0 + 1) >= 0.9 * rows && cp.cells / ((cp.x1 - cp.x0 + 1) * (cp.y1 - cp.y0 + 1)) < 0.6;
    let rooms = comps.filter(cp => cp.cells * c * c >= minArea && cp.bd * c >= minR && !ring(cp));
    const keep = new Map(rooms.map((cp, i) => [cp.id, i]));
    // เรียงห้อง บน→ล่าง ซ้าย→ขวา
    const band = Math.max(1, Math.round(rows / 6));
    rooms.sort((a, b) => Math.floor(a.y0 / band) - Math.floor(b.y0 / band) || a.x0 - b.x0);
    rooms.forEach((cp, i) => keep.set(cp.id, i));
    const grid = new Int16Array(n);
    for (let i = 0; i < n; i++) grid[i] = lab[i] >= 0 && keep.has(lab[i]) ? keep.get(lab[i]) : -1;
    let corr = 0;
    const out = rooms.map((cp, i) => {
      const bx0 = cp.x0 * c, by0 = cp.y0 * c, bx1 = (cp.x1 + 1) * c, by1 = (cp.y1 + 1) * c;
      const bw = bx1 - bx0, bh = by1 - by0, area = cp.cells * c * c;
      const corridor = Math.max(bw, bh) / Math.min(bw, bh) >= 3.2 && area / (bw * bh) >= 0.55 && Math.min(bw, bh) <= 0.2 * maxDim;
      const bx = cp.best % cols, by = (cp.best - bx) / cols;
      return {
        id: 'r' + (i + 1), index: i, area, bbox: { x0: bx0, y0: by0, x1: bx1, y1: by1 },
        lx: (bx + 0.5) * c, ly: (by + 0.5) * c, r: cp.bd * c, corridor,
        name: corridor ? 'ทางเดิน' + (corr++ ? ' ' + corr : '') : '', color: COLORS[i % COLORS.length]
      };
    });
    let k = 0;
    out.forEach(r => { if (!r.name) r.name = 'ห้อง ' + (++k); });
    return { rooms: out, grid, cell: c, cols, rows };
  }
  function roomAt(plan, x, y) {
    const cx = Math.floor(x / plan.cell), cy = Math.floor(y / plan.cell);
    if (cx < 0 || cy < 0 || cx >= plan.cols || cy >= plan.rows) return -1;
    return plan.grid[cy * plan.cols + cx];
  }
  // คำนวณห้องใหม่หลังแก้ผนัง โดยคงชื่อ/สีเดิม (จับคู่จากจุดป้ายชื่อเดิม)
  function recompute(plan) {
    const old = plan.rooms || [];
    Object.assign(plan, buildRooms(plan.W, plan.H, plan.walls, plan.openings));
    applyMeta(plan, old.map(r => ({ n: r.name, c: r.color, k: r.corridor ? 1 : 0, h: r.hidden ? 1 : 0, x: r.lx, y: r.ly })));
    return plan;
  }
  function applyMeta(plan, metas) {
    const taken = new Set();
    for (const m of metas || []) {
      const i = roomAt(plan, m.x, m.y);
      if (i < 0 || taken.has(i)) continue;
      taken.add(i);
      const r = plan.rooms[i];
      if (m.n) r.name = m.n;
      if (m.c) r.color = m.c;
      if (m.k !== undefined) r.corridor = !!m.k;
      if (m.h) r.hidden = true;
    }
  }

  /* ----------------------------- 7) มาตราส่วน ----------------------------- */
  function guessScale(W, H, openings, T, thick) {
    const doors = openings.filter(o => o.kind === 'door').map(segLen).filter(g => g > 3);
    if (doors.length) {
      const mpp = 0.9 / median(doors), w = Math.max(W, H) * mpp;
      if (w >= 4 && w <= 250) return { mpp, source: 'door' };
    }
    if (thick && T >= 4) {
      const mpp = 0.2 / T, w = Math.max(W, H) * mpp;
      if (w >= 4 && w <= 250) return { mpp, source: 'wall' };
    }
    return { mpp: 15 / Math.max(W, H), source: 'default' };
  }

  /* ----------------------------- 8) ไล่ทั้งกระบวนการ: รูปภาพ ----------------------------- */
  function analyzeRaster(img, opts) {
    const o = opts || {};
    let image = img, bin = binarize(image, o), angle = 0;
    if (o.deskew !== false && !o.color) {
      angle = estimateSkew(bin.ink, image.width, image.height);
      if (angle) { image = rotateImage(image, -angle); bin = binarize(image, o); }
    }
    const W = image.width, H = image.height, maxDim = Math.max(W, H);
    let ink = bin.ink;
    const rawInk = ink;
    if (o.fill) ink = outline(ink, W, H);
    const minRun = o.minRun || Math.max(10, Math.round(maxDim * 0.025));
    const minDiag = Math.max(minRun * 2, Math.round(0.05 * maxDim));
    const k = Math.max(1, Math.round(maxDim / 600));
    const tol = Math.max(4, Math.round(0.015 * maxDim));
    // รอบแรก: ดูว่าผนังในภาพเป็นแบบหนา (ระบายทึบ) หรือเส้นบาง (วาดมือ/เส้นคู่)
    let segs = mergeCollinear(axisSegments(ink, W, H, minRun, k), Math.max(2, k + 1));
    const T0 = segs.length ? wmedian(segs.map(s => s.t), segs.map(segLen)) : 1;
    const thick = T0 >= 4 && !o.fill;
    let T = T0;
    if (thick) {
      // ผนังหนา: ลบเส้นบาง (ตัวหนังสือ เฟอร์นิเจอร์ วงสวิงประตู เส้นหน้าต่าง เส้นบอกขนาด) ก่อนหาผนัง
      const r = Math.max(1, Math.floor((0.5 * T0 - 1) / 2));
      const opened = openBox(ink, W, H, r);
      const thinRaw = segs.filter(s => s.t <= 2 * r);
      segs = axisSegments(opened, W, H, minRun, 1);
      if (o.diagonal !== false) segs = segs.concat(diagonalSegments(opened, W, H, segs, minDiag));
      segs = mergeCollinear(segs, 3);
      T = segs.length ? wmedian(segs.map(s => s.t), segs.map(segLen)) : T0;
      segs = segs.filter(s => s.t <= Math.max(4 * T, 0.06 * maxDim));      // แถบดำใหญ่ (โต๊ะ เงา ขอบกระดาษ) ไม่ใช่ผนัง
      // ผนังกั้นบางที่วาดเป็นเส้นเดียว: เก็บไว้ถ้าปลายทั้งสองชนผนังหนา และไม่ได้ซ้อนอยู่ในแนวผนัง (เส้นหน้าต่าง)
      const strong = segs.slice();
      const nearW = (x, y) => strong.find(q => pointSegDist(x, y, q) <= q.t / 2 + tol);
      const inBand = s => strong.some(q => angleBetween(q, s) < 5 && pointSegDist((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, q) <= q.t / 2 + 2 + (s.t / 2) ||
        (q.o === s.o && (s.o === 'h' ? Math.abs(q.y1 - s.y1) : Math.abs(q.x1 - s.x1)) <= q.t / 2 + 1));
      const rescued = thinRaw.filter(s => {
        if (segLen(s) < 2.5 * minRun || inBand(s)) return false;
        const a = nearW(s.x1, s.y1), b = nearW(s.x2, s.y2);
        return a && b && a !== b;
      });
      segs = segs.concat(pairParallel(rescued, clamp(0.022 * maxDim, 6, 30), 2, Infinity));
    } else {
      if (o.diagonal !== false) segs = segs.concat(diagonalSegments(ink, W, H, segs, minDiag));
      segs = mergeCollinear(segs, Math.max(2, k + 1));
      segs = pairParallel(segs, clamp(0.022 * maxDim, 6, 30), 2, 3);
    }
    segs = absorb(segs);
    segs = keepConnected(segs, maxDim, tol);
    snapEnds(segs, tol);
    segs = mergeCollinear(segs, Math.max(2, k + 1));
    segs = absorb(segs).filter(s => segLen(s) >= 3);
    const openings = findOpenings(segs, rawInk, W, H, 0.12 * maxDim);
    const rooms = buildRooms(W, H, segs, openings);
    const sc = guessScale(W, H, openings, T, thick);
    const walls = segs.map(s => ({ o: s.o, x1: r1(s.x1), y1: r1(s.y1), x2: r1(s.x2), y2: r1(s.y2), t: Math.max(1, r1(s.t)) }));
    return Object.assign({ W, H, walls, openings, mpp: sc.mpp, scaleSource: sc.source, angle, mode: o.fill ? 'fill' : thick ? 'thick' : 'thin', T, inverted: bin.inverted, ink: rawInk, image: angle ? image : null }, rooms);
  }

  /* ----------------------------- 9) ไฟล์ DXF (AutoCAD) ----------------------------- */
  function cleanText(s) {
    return String(s || '')
      .replace(/\\U\+([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\P/g, ' ').replace(/\\[ACcFfHhLlOoKkQqTtWwSs][^;\\]*;?/g, '').replace(/[{}]/g, '').replace(/%%[a-zA-Z]/g, '').replace(/\s+/g, ' ').trim();
  }
  function parseDXF(text) {
    const L = String(text).split(/\r\n|\r|\n/);
    const pairs = [];
    for (let i = 0; i + 1 < L.length; i += 2) pairs.push([parseInt(L[i].trim(), 10), L[i + 1]]);
    const res = { lines: [], texts: [], units: 0, codepage: '' };
    let section = '';
    for (let i = 0; i < pairs.length; i++) {
      const [c, v] = pairs[i];
      if (c === 0 && v.trim() === 'SECTION') { section = (pairs[i + 1] || [])[1] ? pairs[i + 1][1].trim() : ''; continue; }
      if (section === 'HEADER' && c === 9) {
        const key = v.trim();
        const nxt = pairs[i + 1];
        if (key === '$INSUNITS' && nxt) res.units = parseInt(nxt[1], 10) || 0;
        if (key === '$DWGCODEPAGE' && nxt) res.codepage = nxt[1].trim();
      }
    }
    // เอนทิตีใน ENTITIES
    let start = pairs.findIndex((p, i) => p[0] === 2 && p[1].trim() === 'ENTITIES' && pairs[i - 1] && pairs[i - 1][1].trim() === 'SECTION');
    if (start < 0) return res;
    const ents = [];
    let cur = null;
    for (let i = start + 1; i < pairs.length; i++) {
      const [c, v] = pairs[i];
      if (c === 0) {
        const type = v.trim();
        if (type === 'ENDSEC') break;
        cur = { type, codes: [] };
        ents.push(cur);
        continue;
      }
      if (cur) cur.codes.push([c, v]);
    }
    const num = v => parseFloat(v);
    let poly = null;
    for (const e of ents) {
      const get = c => { const p = e.codes.find(x => x[0] === c); return p ? p[1] : undefined; };
      const layer = (get(8) || '0').trim();
      if (e.type === 'LINE') res.lines.push({ x1: num(get(10)), y1: num(get(20)), x2: num(get(11)), y2: num(get(21)), layer });
      else if (e.type === 'LWPOLYLINE') {
        const pts = [];
        let x = null;
        for (const [c, v] of e.codes) { if (c === 10) x = num(v); else if (c === 20 && x !== null) { pts.push([x, num(v)]); x = null; } }
        const closed = (parseInt(get(70), 10) || 0) & 1;
        for (let k = 0; k + 1 < pts.length; k++) res.lines.push({ x1: pts[k][0], y1: pts[k][1], x2: pts[k + 1][0], y2: pts[k + 1][1], layer });
        if (closed && pts.length > 2) res.lines.push({ x1: pts[pts.length - 1][0], y1: pts[pts.length - 1][1], x2: pts[0][0], y2: pts[0][1], layer });
      } else if (e.type === 'POLYLINE') poly = { layer, closed: (parseInt(get(70), 10) || 0) & 1, pts: [] };
      else if (e.type === 'VERTEX' && poly) poly.pts.push([num(get(10)), num(get(20))]);
      else if (e.type === 'SEQEND' && poly) {
        const p = poly.pts;
        for (let k = 0; k + 1 < p.length; k++) res.lines.push({ x1: p[k][0], y1: p[k][1], x2: p[k + 1][0], y2: p[k + 1][1], layer: poly.layer });
        if (poly.closed && p.length > 2) res.lines.push({ x1: p[p.length - 1][0], y1: p[p.length - 1][1], x2: p[0][0], y2: p[0][1], layer: poly.layer });
        poly = null;
      } else if (e.type === 'TEXT' || e.type === 'MTEXT') {
        const raw = e.type === 'MTEXT' ? e.codes.filter(x => x[0] === 3).map(x => x[1]).join('') + (get(1) || '') : get(1);
        const t = cleanText(raw);
        if (t) res.texts.push({ x: num(get(10)), y: num(get(20)), h: num(get(40)) || 0, text: t, layer });
      }
    }
    res.lines = res.lines.filter(l => [l.x1, l.y1, l.x2, l.y2].every(Number.isFinite));
    return res;
  }
  const UNIT_PER_M = { 1: 39.3701, 2: 3.28084, 4: 1000, 5: 100, 6: 1, 14: 10 };
  const WALL_RX = /wall|ผนัง|กำแพง/i;
  const SKIP_RX = /dim|text|anno|furn|เฟอร์|hatch|door|ประตู|win|หน้าต่าง|glaz|grid|axis|center|defpoints|title|frame|border|sym|elec|plumb|sanit|ไฟฟ้า|สุขภัณฑ์|ตัวอักษร|ขนาด|ต้นไม้|tree|plant/i;
  const WIN_RX = /win|หน้าต่าง|glaz/i;
  const isLabel = t => t && !/^[\d\s.,×xX*:+\-/()]+(m|mm|cm|ม\.?|ซม\.?|มม\.?)?$/i.test(t) && t.length <= 40;
  function analyzeVector(vec, opts) {
    const o = opts || {};
    const all = vec.lines || [];
    const hasWall = all.some(l => WALL_RX.test(l.layer || ''));
    let lines = hasWall ? all.filter(l => WALL_RX.test(l.layer || '')) : all.filter(l => !SKIP_RX.test(l.layer || ''));
    if (lines.length < 2) lines = all;
    if (lines.length < 2) throw new Error('ไม่พบเส้นผนังในไฟล์');
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const l of lines) { minX = Math.min(minX, l.x1, l.x2); maxX = Math.max(maxX, l.x1, l.x2); minY = Math.min(minY, l.y1, l.y2); maxY = Math.max(maxY, l.y1, l.y2); }
    const ext = Math.max(maxX - minX, maxY - minY) || 1;
    const upm = o.unitsPerMeter || UNIT_PER_M[vec.units] || (ext > 3000 ? 1000 : ext > 300 ? 100 : 1);
    const size = o.size || 1000, pad = 24, k = (size - 2 * pad) / ext;
    const W = Math.ceil((maxX - minX) * k) + 2 * pad, H = Math.ceil((maxY - minY) * k) + 2 * pad;
    const tx = x => (x - minX) * k + pad, ty = y => (maxY - y) * k + pad, mpp = 1 / (upm * k), px = m => m / mpp;
    const toSeg = l => {
      let x1 = tx(l.x1), y1 = ty(l.y1), x2 = tx(l.x2), y2 = ty(l.y2);
      const a = Math.abs(Math.atan2(y2 - y1, x2 - x1)) / DEG;
      if (a < 1.5 || a > 178.5) { const y = (y1 + y2) / 2; y1 = y2 = y; }
      else if (Math.abs(a - 90) < 1.5) { const x = (x1 + x2) / 2; x1 = x2 = x; }
      return mkSeg(x1, y1, x2, y2, 1);
    };
    let segs = lines.map(toSeg).filter(s => segLen(s) >= px(0.05));
    segs = mergeCollinear(segs, px(0.03));
    segs = pairParallel(segs, px(0.45), px(0.03), Infinity);
    segs = segs.map(s => (s.paired ? s : Object.assign(s, { t: Math.max(1, px(0.1)) }))).filter(s => s.paired || segLen(s) >= px(0.6));
    segs = absorb(segs);
    const maxDim = Math.max(W, H), tol = px(0.15);
    segs = keepConnected(segs, maxDim, tol);
    snapEnds(segs, tol);
    segs = mergeCollinear(segs, px(0.03));
    segs = absorb(segs).filter(s => segLen(s) >= 3);
    const winLines = all.filter(l => WIN_RX.test(l.layer || '')).map(toSeg);
    const openings = findOpenings(segs, null, W, H, px(2.6), winLines);
    const rooms = buildRooms(W, H, segs, openings);
    const plan = Object.assign({ W, H, walls: segs.map(s => ({ o: s.o, x1: r1(s.x1), y1: r1(s.y1), x2: r1(s.x2), y2: r1(s.y2), t: Math.max(1, r1(s.t)) })), openings, mpp, scaleSource: 'units', angle: 0, mode: 'vector', T: px(0.2) }, rooms);
    nameRooms(plan, (vec.texts || []).map(t => ({ x: tx(t.x), y: ty(t.y), h: t.h, text: t.text })));
    return plan;
  }
  // ตั้งชื่อห้องจากข้อความในไฟล์ (SVG/DXF) ที่อยู่ในห้องนั้น — ข้อความใหญ่สุดชนะ
  function nameRooms(plan, texts) {
    const best = new Map();
    for (const t of texts || []) {
      const label = String(t.text || '').trim();
      if (!isLabel(label)) continue;
      const i = roomAt(plan, t.x, t.y);
      if (i < 0) continue;
      const cur = best.get(i);
      if (!cur || (t.h || 0) > (cur.h || 0)) best.set(i, { text: label, h: t.h || 0 });
    }
    best.forEach((v, i) => { plan.rooms[i].name = v.text; plan.rooms[i].named = true; });
    return plan;
  }

  /* ----------------------------- 10) บันทึก / แปลงเป็นพื้นที่ 3D ----------------------------- */
  function compact(plan) {
    return {
      v: 1, name: plan.name || 'แผนผัง', W: plan.W, H: plan.H, mpp: +(+plan.mpp).toPrecision(6), style: plan.style || 'dark', img: plan.img || null,
      walls: plan.walls.map(s => [r1(s.x1), r1(s.y1), r1(s.x2), r1(s.y2), r1(s.t)]),
      openings: plan.openings.map(s => [r1(s.x1), r1(s.y1), r1(s.x2), r1(s.y2), r1(s.t), s.kind === 'window' ? 1 : 0]),
      rooms: plan.rooms.map(r => Object.assign({ n: r.name, c: r.color, k: r.corridor ? 1 : 0, x: r1(r.lx), y: r1(r.ly) }, r.hidden ? { h: 1 } : {}))
    };
  }
  function restore(json) {
    if (!json || !Array.isArray(json.walls) || !json.W || !json.H) throw new Error('ข้อมูลแผนผังไม่ถูกต้อง');
    const plan = {
      name: json.name || 'แผนผัง', W: json.W, H: json.H, mpp: json.mpp || 15 / Math.max(json.W, json.H), style: json.style || 'dark', img: json.img || null,
      walls: json.walls.map(a => mkSeg(a[0], a[1], a[2], a[3], a[4] || 2)),
      openings: (json.openings || []).map(a => mkSeg(a[0], a[1], a[2], a[3], a[4] || 2, { kind: a[5] ? 'window' : 'door' }))
    };
    Object.assign(plan, buildRooms(plan.W, plan.H, plan.walls, plan.openings));
    applyMeta(plan, json.rooms);
    return plan;
  }
  /* แปลงแผนผัง (หน่วยพิกเซล) เป็นพื้นที่ในฉาก 3D:
     ผนัง [x1,z1,x2,z2, ลดสัญญาณ dB, ความหนา, ชนิด 0=ผนัง 1=หน้าต่าง] หน่วยในฉาก = เมตร / scale */
  function toSite(plan) {
    const mpp = plan.mpp, Wm = plan.W * mpp, Hm = plan.H * mpp, maxM = Math.max(Wm, Hm);
    const scale = maxM <= 64 ? 1 : Math.ceil(maxM / 56);
    const k = mpp / scale, cx = plan.W / 2, cy = plan.H / 2;
    const X = x => +((x - cx) * k).toFixed(3), Z = y => +((y - cy) * k).toFixed(3);
    const walls = plan.walls.map(s => {
      const tm = s.t * mpp;
      return [X(s.x1), Z(s.y1), X(s.x2), Z(s.y2), tm >= 0.17 ? 10 : tm >= 0.09 ? 6 : 4, +Math.max(0.06 / scale, s.t * k).toFixed(3), 0];
    });
    plan.openings.filter(o => o.kind === 'window').forEach(s => walls.push([X(s.x1), Z(s.y1), X(s.x2), Z(s.y2), 2, +Math.max(0.06 / scale, s.t * k).toFixed(3), 1]));
    const doors = plan.openings.filter(o => o.kind !== 'window').map(s => [X(s.x1), Z(s.y1), X(s.x2), Z(s.y2)]);
    const keep = plan.rooms.map((r, i) => (r.hidden ? -1 : i)).filter(i => i >= 0);
    const remap = new Int16Array(plan.rooms.length).fill(-1);
    keep.forEach((ri, zi) => { remap[ri] = zi; });
    const data = new Int16Array(plan.grid.length);
    for (let i = 0; i < data.length; i++) data[i] = plan.grid[i] >= 0 ? remap[plan.grid[i]] : -1;
    const zones = keep.map((ri, i) => {
      const r = plan.rooms[ri], b = r.bbox;
      return {
        id: 'scan' + (i + 1), name: r.name, color: r.color || COLORS[i % COLORS.length], corridor: !!r.corridor,
        x: X((b.x0 + b.x1) / 2), z: Z((b.y0 + b.y1) / 2), w: +((b.x1 - b.x0) * k).toFixed(3), l: +((b.y1 - b.y0) * k).toFixed(3),
        lx: X(r.lx), lz: Z(r.ly), areaM2: +(r.area * mpp * mpp).toFixed(1)
      };
    });
    return {
      label: 'แผนผัง: ' + (plan.name || 'สแกน'), kind: 'building', scan: true, solid: true,
      w: +(Wm / scale + 2).toFixed(2), l: +(Hm / scale + 2).toFixed(2), scale, wallLoss: 6,
      floorW: +(Wm / scale).toFixed(3), floorL: +(Hm / scale).toFixed(3),
      walls, doors, zones,
      zoneGrid: { x0: X(0), z0: Z(0), cell: plan.cell * k, cols: plan.cols, rows: plan.rows, data }
    };
  }
  function zoneIndexAt(site, x, z) {
    const g = site && site.zoneGrid;
    if (!g) return -1;
    const cx = Math.floor((x - g.x0) / g.cell), cy = Math.floor((z - g.z0) / g.cell);
    if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) return -1;
    return g.data[cy * g.cols + cx];
  }

  return {
    COLORS, analyzeRaster, analyzeVector, findPaper, parseDXF, binarize, estimateSkew, rotateImage, warpQuad, downscale, homography,
    buildRooms, recompute, roomAt, nameRooms, compact, restore, toSite, zoneIndexAt, mkSeg, segLen, pointSegDist, guessScale, findOpenings,
    _internal: { axisSegments, diagonalSegments, mergeCollinear, pairParallel, snapEnds, keepConnected, otsuOf, cleanText }
  };
});
