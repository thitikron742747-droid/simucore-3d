/* ==========================================================================
   SimuCore SiteModel — ผังบริเวณ (วิทยาลัย / วิทยาเขต / หมู่บ้าน)
   --------------------------------------------------------------------------
   เก็บอาคาร (มีหลายชั้น + ห้องภายใน), ถนน, พื้นที่ (หญ้า น้ำ ลาน ถนน), สนามกีฬา,
   ต้นไม้ เสาไฟ ศาลา ฯลฯ บนพิกัดของภาพแผนที่ (px) + มาตราส่วน (เมตร/px)
   แล้วแปลงเป็นข้อมูลฉาก 3D หน่วยเมตร: ผนังทุกห้อง โซนห้อง วัตถุ และแนวเสาไฟ
   ห้องภายในอาคารใช้รูปแบบเดียวกับแผนผังที่สแกน (plan-scan.js) จึงแก้ไขด้วยเครื่องมือเดียวกันได้
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./plan-scan.js'));
  else root.SiteModel = factory(root.PlanScan);
})(typeof self !== 'undefined' ? self : this, function (PS) {
  'use strict';
  const DEG = Math.PI / 180;
  const r1 = v => Math.round(v * 10) / 10;
  const r3 = v => Math.round(v * 1000) / 1000;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ------------------------------ ชนิดข้อมูล ------------------------------ */
  // พื้นที่ (ระบายบนตาราง) — 0 = ไม่กำหนด (ใช้พื้นหลักของผัง)
  const AREAS = [
    null,
    { id: 'grass', th: 'สนามหญ้า', color: '#5d9a3c' },
    { id: 'road', th: 'ถนนลาดยาง', color: '#4b5563' },
    { id: 'concrete', th: 'ลานคอนกรีต / ทางเท้า', color: '#cfc9bd' },
    { id: 'water', th: 'บ่อน้ำ / สระ', color: '#3b9ae1' },
    { id: 'dirt', th: 'ลานดิน', color: '#a7845b' },
    { id: 'sand', th: 'ทราย / ลานกีฬา', color: '#e2cf9f' },
    { id: 'garden', th: 'สวน / แปลงไม้', color: '#3f7f34' }
  ];
  const AREA_INDEX = Object.fromEntries(AREAS.map((a, i) => [a ? a.id : '', i]));
  const PROPS = {
    tree: { th: 'ต้นไม้ใหญ่', icon: 'fa-tree', color: '#16a34a', r: 3.5 },
    pine: { th: 'ต้นสน', icon: 'fa-tree', color: '#15803d', r: 2.2 },
    palm: { th: 'ต้นปาล์ม / มะพร้าว', icon: 'fa-umbrella-beach', color: '#65a30d', r: 2.5 },
    bush: { th: 'พุ่มไม้', icon: 'fa-seedling', color: '#4d7c0f', r: 1.2 },
    lamp: { th: 'เสาไฟถนน', icon: 'fa-lightbulb', color: '#fbbf24', r: 0.6 },
    sala: { th: 'ศาลา', icon: 'fa-place-of-worship', color: '#b45309', r: 3 },
    flag: { th: 'เสาธง', icon: 'fa-flag', color: '#ef4444', r: 1 },
    tower: { th: 'หอถังน้ำ', icon: 'fa-tower-observation', color: '#94a3b8', r: 3.5 },
    shelter: { th: 'โรงจอดรถ', icon: 'fa-warehouse', color: '#2f855a', r: 6 },
    car: { th: 'รถยนต์', icon: 'fa-car', color: '#dc2626', r: 2.4 },
    bus: { th: 'รถบัส', icon: 'fa-bus', color: '#e11d48', r: 5.5 },
    bench: { th: 'ม้านั่ง', icon: 'fa-chair', color: '#a16207', r: 1 },
    gate: { th: 'ซุ้มประตูทางเข้า', icon: 'fa-archway', color: '#64748b', r: 5 },
    guard: { th: 'ป้อมยาม', icon: 'fa-shield-halved', color: '#0ea5e9', r: 1.6 },
    statue: { th: 'อนุสาวรีย์ / พระพุทธรูป', icon: 'fa-monument', color: '#78716c', r: 1.6 },
    toilet: { th: 'ห้องน้ำ', icon: 'fa-restroom', color: '#38bdf8', r: 2.5 }
  };
  const STYLES = {
    white: { th: 'คอนกรีตขาว', wall: '#e8eaee', trim: '#9aa6b5', glass: '#5d7fa8', roof: '#64748b' },
    cream: { th: 'ครีม / เหลืองอ่อน', wall: '#f1dfbc', trim: '#c08a52', glass: '#5d7fa8', roof: '#a85b3a' },
    brick: { th: 'อิฐ / น้ำตาล', wall: '#a8705a', trim: '#ecd9c6', glass: '#46617e', roof: '#7c3f2a' },
    gray: { th: 'เทา', wall: '#aab3bf', trim: '#e2e8f0', glass: '#3d5a80', roof: '#475569' },
    blue: { th: 'ฟ้า / กระจก', wall: '#cfe1f3', trim: '#7aa7d4', glass: '#2f6fb3', roof: '#1e3a5f' },
    wood: { th: 'ไม้ (บ้านพัก)', wall: '#c99b6d', trim: '#7a4b2a', glass: '#3f5872', roof: '#8a3b2a' }
  };
  const ROOFS = { flat: 'ดาดฟ้า', gable: 'หน้าจั่ว', hip: 'ปั้นหยา', dome: 'หลังคาโค้ง (โดม)' };
  const FIELDS = { football: 'สนามฟุตบอล', futsal: 'สนามฟุตซอล', basketball: 'สนามบาสเกตบอล' };
  const ROOM_COLORS = PS.COLORS;

  /* ------------------------- ตารางพื้นที่ (บีบอัด RLE) ------------------------- */
  function rleEncode(arr) {
    const out = [];
    let v = arr[0], n = 0;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === v) n++;
      else { out.push(n === 1 ? String(v) : `${n}*${v}`); v = arr[i]; n = 1; }
    }
    if (arr.length) out.push(n === 1 ? String(v) : `${n}*${v}`);
    return out.join(',');
  }
  function rleDecode(str, len) {
    const out = new Uint8Array(len);
    if (!str) return out;
    let i = 0;
    for (const part of String(str).split(',')) {
      const k = part.indexOf('*');
      const n = k < 0 ? 1 : parseInt(part.slice(0, k), 10), v = parseInt(k < 0 ? part : part.slice(k + 1), 10) || 0;
      for (let j = 0; j < n && i < len; j++) out[i++] = v;
    }
    return out;
  }
  function newGround(W, H, cellPx) {
    const cell = cellPx || Math.max(1, Math.ceil(Math.max(W, H) / 400));
    const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
    return { cell, cols, rows, data: new Uint8Array(cols * rows) };
  }
  const groundOf = site => {
    const g = site.ground;
    if (!g) return null;
    if (g.data) return g;
    return { cell: g.cell, cols: g.cols, rows: g.rows, data: rleDecode(g.rle, g.cols * g.rows) };
  };
  const packGround = g => (g ? { cell: g.cell, cols: g.cols, rows: g.rows, rle: rleEncode(g.data) } : null);
  // ระบายพื้นที่: วงกลม (แปรง) / สี่เหลี่ยม / เทตามสีภาพ
  function paintCircle(g, x, y, rPx, val) {
    const c0 = Math.floor((x - rPx) / g.cell), c1 = Math.floor((x + rPx) / g.cell), r0 = Math.floor((y - rPx) / g.cell), rr1 = Math.floor((y + rPx) / g.cell);
    for (let r = Math.max(0, r0); r <= Math.min(g.rows - 1, rr1); r++) for (let c = Math.max(0, c0); c <= Math.min(g.cols - 1, c1); c++) {
      const px = (c + 0.5) * g.cell, py = (r + 0.5) * g.cell;
      if ((px - x) ** 2 + (py - y) ** 2 <= rPx * rPx) g.data[r * g.cols + c] = val;
    }
  }
  function paintRect(g, x0, y0, x1, y1, val) {
    const ca = Math.max(0, Math.floor(Math.min(x0, x1) / g.cell)), cb = Math.min(g.cols - 1, Math.floor(Math.max(x0, x1) / g.cell));
    const ra = Math.max(0, Math.floor(Math.min(y0, y1) / g.cell)), rb = Math.min(g.rows - 1, Math.floor(Math.max(y0, y1) / g.cell));
    for (let r = ra; r <= rb; r++) for (let c = ca; c <= cb; c++) g.data[r * g.cols + c] = val;
  }
  function paintEllipse(g, cx, cy, rx, ry, val) {
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
      const px = (c + 0.5) * g.cell, py = (r + 0.5) * g.cell;
      if (((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1) g.data[r * g.cols + c] = val;
    }
  }
  function paintPolygon(g, pts, val) {
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
      const px = (c + 0.5) * g.cell, py = (r + 0.5) * g.cell;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) g.data[r * g.cols + c] = val;
    }
  }
  // สีเฉลี่ยของแต่ละช่องในตาราง
  function cellColors(img, g) {
    const out = new Float32Array(g.cols * g.rows * 3), cnt = new Float32Array(g.cols * g.rows), d = img.data, W = img.width;
    for (let y = 0; y < img.height; y++) {
      const r = Math.floor(y / g.cell);
      if (r >= g.rows) break;
      for (let x = 0; x < W; x++) {
        const c = Math.floor(x / g.cell);
        if (c >= g.cols) break;
        const i = r * g.cols + c, k = (y * W + x) * 4;
        out[i * 3] += d[k]; out[i * 3 + 1] += d[k + 1]; out[i * 3 + 2] += d[k + 2]; cnt[i]++;
      }
    }
    for (let i = 0; i < cnt.length; i++) if (cnt[i]) { out[i * 3] /= cnt[i]; out[i * 3 + 1] /= cnt[i]; out[i * 3 + 2] /= cnt[i]; }
    return out;
  }
  // จำแนกพื้นที่จากสีในแผนที่: ฟ้า = น้ำ, เขียว = หญ้า, เทาเรียบ = ถนน (เฉพาะช่องที่ยังว่าง)
  function autoAreas(img, g, opts) {
    const o = opts || {}, col = cellColors(img, g), out = { water: 0, grass: 0, road: 0 };
    for (let i = 0; i < g.cols * g.rows; i++) {
      if (g.data[i] && !o.overwrite) continue;
      const r = col[i * 3], gg = col[i * 3 + 1], b = col[i * 3 + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      if (b > r + 30 && b > gg - 5 && mx - mn > 45) { g.data[i] = AREA_INDEX.water; out.water++; }
      else if (gg > r + 18 && gg > b + 8 && mx > 70) { g.data[i] = AREA_INDEX.grass; out.grass++; }
      else if (mx - mn < 16 && mx > 85 && mx < 175) { g.data[i] = AREA_INDEX.road; out.road++; }
    }
    return out;
  }
  // เทพื้นที่ตามสีที่แตะ (ไม้กายสิทธิ์) → คืนจำนวนช่องที่ระบาย
  function wand(img, g, x, y, tol, val) {
    const col = cellColors(img, g), c0 = Math.floor(x / g.cell), r0 = Math.floor(y / g.cell);
    if (c0 < 0 || r0 < 0 || c0 >= g.cols || r0 >= g.rows) return 0;
    const s = r0 * g.cols + c0, sr = col[s * 3], sg = col[s * 3 + 1], sb = col[s * 3 + 2], t2 = (tol || 40) ** 2;
    const seen = new Uint8Array(g.cols * g.rows), stack = [s];
    seen[s] = 1;
    let n = 0;
    while (stack.length) {
      const i = stack.pop(), c = i % g.cols, r = (i - c) / g.cols;
      g.data[i] = val; n++;
      for (const j of [c > 0 ? i - 1 : -1, c < g.cols - 1 ? i + 1 : -1, r > 0 ? i - g.cols : -1, r < g.rows - 1 ? i + g.cols : -1]) {
        if (j < 0 || seen[j]) continue;
        const dr = col[j * 3] - sr, dg = col[j * 3 + 1] - sg, db = col[j * 3 + 2] - sb;
        if (dr * dr + dg * dg + db * db <= t2) { seen[j] = 1; stack.push(j); }
      }
    }
    return n;
  }

  /* -------------------------- ห้องภายในอาคาร -------------------------- */
  const PPM = 20;            // แผนผังภายในอาคาร: 20 px = 1 เมตร
  const PAD = 12;
  /* layout: { n: จำนวนห้อง, corridor: 'front'|'center'|'none', names: [...], windows: true }
     ด้านหน้าอาคาร = ด้านล่างของแผนผังภายใน (แกน +z ของอาคาร) */
  function layoutPlan(wm, dm, layout, bname) {
    const L = Object.assign({ n: 1, corridor: 'none', windows: true }, layout || {});
    const n = Math.max(1, Math.min(24, Math.round(L.n)));
    const W = Math.round(wm * PPM) + 2 * PAD, H = Math.round(dm * PPM) + 2 * PAD;
    const T = 0.2 * PPM, t = 0.12 * PPM, DOOR = 1.0 * PPM, MAIN = Math.min(2.2 * PPM, wm * PPM * 0.3);
    const x0 = PAD + T / 2, x1 = W - PAD - T / 2, y0 = PAD + T / 2, y1 = H - PAD - T / 2;
    const walls = [], openings = [], rooms = [];
    // ผนังพร้อมช่องเปิด: gaps = [{ a, b, kind }] ระยะตามแนวผนังจากจุดเริ่ม
    const wallGaps = (ax, ay, bx, by, th, gaps) => {
      const len = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / len, uy = (by - ay) / len;
      let cur = 0;
      gaps.filter(g => g.b > g.a && g.a > 0.5 && g.b < len - 0.5).sort((p, q) => p.a - q.a).forEach(g => {
        if (g.a > cur + 1) walls.push([ax + ux * cur, ay + uy * cur, ax + ux * g.a, ay + uy * g.a, th]);
        openings.push([ax + ux * g.a, ay + uy * g.a, ax + ux * g.b, ay + uy * g.b, th, g.kind === 'window' ? 1 : 0]);
        cur = Math.max(cur, g.b);
      });
      if (len - cur > 1) walls.push([ax + ux * cur, ay + uy * cur, bx, by, th]);
    };
    const win = (a, b) => (L.windows && b - a > 1.6 * PPM ? [{ a: a + (b - a) * 0.22, b: b - (b - a) * 0.22, kind: 'window' }] : []);
    const name = i => (L.names && L.names[i]) || (n === 1 ? (bname ? 'โถง' + bname.replace(/^อาคาร/, '') : 'ห้องโถง') : `ห้อง ${i + 1}`);
    const bandRooms = (ya, yb, k, offset, doorSide) => {
      // แบ่งช่วงแนวนอน x0..x1 เป็น k ห้อง ระหว่าง ya..yb ประตูออกด้าน doorSide ('down'|'up'|'front')
      const step = (x1 - x0) / k;
      for (let i = 1; i < k; i++) walls.push([x0 + step * i, ya, x0 + step * i, yb, t]);
      for (let i = 0; i < k; i++) rooms.push({ n: name(offset + i), x: x0 + step * (i + 0.5), y: (ya + yb) / 2 });
      return step;
    };
    const cd = Math.min(2.6 * PPM, (y1 - y0) * 0.32);
    if (L.corridor === 'front' && n > 1) {
      const yc = y1 - cd;
      const step = bandRooms(y0, yc, n, 0);
      // ผนังระหว่างห้องกับทางเดิน (ประตูห้องละบาน)
      wallGaps(x0, yc, x1, yc, t, Array.from({ length: n }, (_, i) => ({ a: step * (i + 1) - DOOR - 0.5 * PPM, b: step * (i + 1) - 0.5 * PPM })));
      rooms.push({ n: L.corridorName || 'ทางเดิน', x: (x0 + x1) / 2, y: (yc + y1) / 2, k: 1 });
      wallGaps(x0, y0, x1, y0, T, Array.from({ length: n }, (_, i) => win(step * i, step * (i + 1))).flat());
      // ทางเดินหน้าอาคารเปิดโล่งแบบอาคารเรียนทั่วไป: เหลือเฉพาะเสาทุกช่วง ~3.8 ม.
      const span = x1 - x0, bays = Math.max(1, Math.round(span / (3.8 * PPM))), bw = span / bays, col = 0.4 * PPM;
      wallGaps(x0, y1, x1, y1, T, Array.from({ length: bays }, (_, i) => ({ a: bw * i + col / 2 + (i ? 0 : col / 2), b: bw * (i + 1) - col / 2 - (i === bays - 1 ? col / 2 : 0) })));
      wallGaps(x0, y0, x0, y1, T, []);
      wallGaps(x1, y0, x1, y1, T, [{ a: (y1 - y0) - cd + 0.4 * PPM, b: (y1 - y0) - 0.4 * PPM }]);
    } else if (L.corridor === 'center' && n > 1) {
      const kTop = Math.ceil(n / 2), kBot = n - kTop, ya = (y0 + y1) / 2 - cd / 2, yb = (y0 + y1) / 2 + cd / 2;
      const s1 = bandRooms(y0, ya, kTop, 0);
      const s2 = kBot ? bandRooms(yb, y1, kBot, kTop) : 0;
      wallGaps(x0, ya, x1, ya, t, Array.from({ length: kTop }, (_, i) => ({ a: s1 * (i + 1) - DOOR - 0.5 * PPM, b: s1 * (i + 1) - 0.5 * PPM })));
      if (kBot) wallGaps(x0, yb, x1, yb, t, Array.from({ length: kBot }, (_, i) => ({ a: s2 * i + 0.5 * PPM, b: s2 * i + 0.5 * PPM + DOOR })));
      else wallGaps(x0, yb, x1, yb, t, []);
      rooms.push({ n: L.corridorName || 'ทางเดิน', x: (x0 + x1) / 2, y: (ya + yb) / 2, k: 1 });
      wallGaps(x0, y0, x1, y0, T, Array.from({ length: kTop }, (_, i) => win(s1 * i, s1 * (i + 1))).flat());
      wallGaps(x0, y1, x1, y1, T, kBot ? Array.from({ length: kBot }, (_, i) => win(s2 * i, s2 * (i + 1))).flat() : []);
      const c0 = (y1 - y0) / 2 - Math.min(cd, 2.2 * PPM) / 2 + 0.2 * PPM, c1 = (y1 - y0) / 2 + Math.min(cd, 2.2 * PPM) / 2 - 0.2 * PPM;
      wallGaps(x0, y0, x0, y1, T, [{ a: c0, b: c1 }]);
      wallGaps(x1, y0, x1, y1, T, [{ a: c0, b: c1 }]);
    } else {
      const step = bandRooms(y0, y1, n, 0);
      wallGaps(x0, y0, x1, y0, T, Array.from({ length: n }, (_, i) => win(step * i, step * (i + 1))).flat());
      const doors = n === 1 ? [{ a: (x1 - x0) / 2 - MAIN / 2, b: (x1 - x0) / 2 + MAIN / 2 }]
        : Array.from({ length: n }, (_, i) => ({ a: step * (i + 0.5) - DOOR / 2, b: step * (i + 0.5) + DOOR / 2 }));
      if (n === 1 && L.windows) doors.push(...win(0, (x1 - x0) / 2 - MAIN / 2 - 0.5 * PPM), ...win((x1 - x0) / 2 + MAIN / 2 + 0.5 * PPM, x1 - x0));
      wallGaps(x0, y1, x1, y1, T, doors);
      wallGaps(x0, y0, x0, y1, T, n === 1 && L.windows ? win(0, y1 - y0) : []);
      wallGaps(x1, y0, x1, y1, T, n === 1 && L.windows ? win(0, y1 - y0) : []);
    }
    const r = v => Math.round(v * 10) / 10;
    return {
      v: 1, name: bname || 'อาคาร', W, H, mpp: 1 / PPM,
      walls: walls.map(w => w.map(r)), openings: openings.map(o => o.map(r)),
      rooms: rooms.map((q, i) => ({ n: q.n, c: ROOM_COLORS[i % ROOM_COLORS.length], k: q.k || 0, x: r(q.x), y: r(q.y) }))
    };
  }
  // ย่อ/ขยายแผนผังภายในเมื่อปรับขนาดอาคาร (คงห้องที่จัดเองไว้)
  function scalePlan(plan, wm, dm) {
    const W = Math.round(wm * PPM) + 2 * PAD, H = Math.round(dm * PPM) + 2 * PAD;
    const sx = (W - 2 * PAD) / (plan.W - 2 * PAD), sy = (H - 2 * PAD) / (plan.H - 2 * PAD);
    const X = x => r1(PAD + (x - PAD) * sx), Y = y => r1(PAD + (y - PAD) * sy);
    return Object.assign({}, plan, {
      W, H,
      walls: plan.walls.map(w => [X(w[0]), Y(w[1]), X(w[2]), Y(w[3]), w[4]]),
      openings: (plan.openings || []).map(o => [X(o[0]), Y(o[1]), X(o[2]), Y(o[3]), o[4], o[5]]),
      rooms: (plan.rooms || []).map(q => Object.assign({}, q, { x: X(q.x), y: Y(q.y) }))
    });
  }
  /* อาคารใหม่: x, y, w, d (px ของผัง), rot (องศา) */
  function newBuilding(site, o) {
    const b = Object.assign({ name: 'อาคารใหม่', num: '', floors: 2, style: 'white', roof: 'flat', rot: 0 }, o);
    b.layout = Object.assign({ n: 1, corridor: 'none' }, o.layout || {});
    b.plan = layoutPlan(b.w * site.mpp, b.d * site.mpp, b.layout, b.name);
    return b;
  }
  function relayout(site, b, layout) {
    if (layout) b.layout = Object.assign({}, b.layout, layout);
    b.plan = layoutPlan(b.w * site.mpp, b.d * site.mpp, b.layout, b.name);
    b.custom = false;
    return b;
  }
  function resizeBuilding(site, b, w, d) {
    b.w = w; b.d = d;
    if (b.custom && b.plan) b.plan = scalePlan(b.plan, w * site.mpp, d * site.mpp);
    else relayout(site, b);
    return b;
  }

  /* ------------------------------ ผังว่าง / ตรวจข้อมูล ------------------------------ */
  function blank(o) {
    const opt = o || {}, wm = opt.widthM || 300, hm = opt.heightM || 200, mpp = opt.mpp || 0.5;
    const W = Math.round(wm / mpp), H = Math.round(hm / mpp);
    return { v: 2, kind: 'site', name: opt.name || 'ผังบริเวณใหม่', W, H, mpp, img: opt.img || null, underlay: 0, base: 'grass', ground: packGround(newGround(W, H)), roads: [], fields: [], buildings: [], props: [], poles: [], fences: [] };
  }
  function normalize(site) {
    const s = Object.assign({ v: 2, kind: 'site', underlay: 0, base: 'grass', roads: [], fields: [], buildings: [], props: [], poles: [], fences: [] }, site);
    if (!s.W || !s.H || !s.mpp) throw new Error('ผังบริเวณไม่ถูกต้อง');
    s.buildings.forEach(b => { if (!b.plan) Object.assign(b, newBuilding(s, b)); });
    return s;
  }

  /* ------------------------------ แปลงเป็นฉาก 3D ------------------------------ */
  function toScene(siteIn) {
    const site = normalize(siteIn);
    const mpp = site.mpp, Wm = site.W * mpp, Hm = site.H * mpp, maxM = Math.max(Wm, Hm);
    const scale = maxM <= 1600 ? 1 : Math.ceil(maxM / 1500);
    const k = mpp / scale, cx = site.W / 2, cy = site.H / 2;
    const X = x => r3((x - cx) * k), Z = y => r3((y - cy) * k);
    const out = {
      kind: 'campus', scale, k, W: site.W, H: site.H, mpp, name: site.name,
      w: r3(Wm / scale + 24), l: r3(Hm / scale + 24), floorW: r3(Wm / scale), floorL: r3(Hm / scale),
      base: site.base || 'grass', underlay: site.underlay || 0,
      walls: [], doors: [], zones: [], buildings: [], props: [], poles: [], roads: [], fields: [], fences: [],
      ground: groundOf(site)
    };
    site.buildings.forEach((b, bi) => {
      let plan;
      try { plan = PS.restore(b.plan); } catch (e) { plan = PS.restore(layoutPlan(b.w * mpp, b.d * mpp, b.layout, b.name)); }
      const bx = X(b.x), bz = Z(b.y), rot = (b.rot || 0) * DEG, c = Math.cos(rot), s = Math.sin(rot);
      const pk = plan.mpp / scale;
      const L = (px, py) => [(px - plan.W / 2) * pk, (py - plan.H / 2) * pk];
      const T = (lx, lz) => [r3(bx + c * lx - s * lz), r3(bz + s * lx + c * lz)];
      const hw = (plan.W / 2 - PAD) * pk, hd = (plan.H / 2 - PAD) * pk;
      const isExt = seg => {
        const [ax, az] = L(seg.x1, seg.y1), [bx2, bz2] = L(seg.x2, seg.y2), tol = seg.t * pk + 0.05;
        return (Math.abs(ax - bx2) < 0.01 && (Math.abs(Math.abs(ax) - hw) < tol)) || (Math.abs(az - bz2) < 0.01 && (Math.abs(Math.abs(az) - hd) < tol));
      };
      const B = {
        index: bi, name: b.name || `อาคาร ${bi + 1}`, num: b.num || '', x: bx, z: bz, rot: b.rot || 0, cos: c, sin: s,
        w: r3(hw * 2), d: r3(hd * 2), floors: Math.max(1, Math.min(8, b.floors || 1)), style: STYLES[b.style] ? b.style : 'white', roof: ROOFS[b.roof] ? b.roof : 'flat',
        pk, pw: plan.W, ph: plan.H, plan, walls: [], openings: [], rooms: [], roomZone: [], r2: (hw * hw + hd * hd) * 1.05 + 1,
        corridor: (b.layout && !b.custom && b.layout.corridor) || 'none', color: b.color || ROOM_COLORS[bi % ROOM_COLORS.length]
      };
      plan.walls.forEach(seg => {
        const [ax, az] = L(seg.x1, seg.y1), [ex, ez] = L(seg.x2, seg.y2), ext = isExt(seg), tm = seg.t * pk;
        B.walls.push([r3(ax), r3(az), r3(ex), r3(ez), r3(Math.max(0.06, tm)), ext ? 1 : 0]);
        const [wx1, wz1] = T(ax, az), [wx2, wz2] = T(ex, ez);
        out.walls.push([wx1, wz1, wx2, wz2, ext ? 10 : 6, r3(Math.max(0.06, tm)), 0, bi]);
      });
      plan.openings.forEach(o => {
        const [ax, az] = L(o.x1, o.y1), [ex, ez] = L(o.x2, o.y2), ext = isExt(o);
        B.openings.push([r3(ax), r3(az), r3(ex), r3(ez), r3(Math.max(0.06, o.t * pk)), o.kind === 'window' ? 1 : 0, ext ? 1 : 0]);
        const [wx1, wz1] = T(ax, az), [wx2, wz2] = T(ex, ez);
        if (o.kind === 'window') out.walls.push([wx1, wz1, wx2, wz2, 2, r3(Math.max(0.06, o.t * pk)), 1, bi]);
        else out.doors.push([wx1, wz1, wx2, wz2, ext ? 1 : 0, bi]);
      });
      plan.rooms.forEach((r, ri) => {
        const [lx, lz] = L(r.lx, r.ly);
        B.rooms.push({ name: r.name, color: r.color, corridor: !!r.corridor, lx: r3(lx), lz: r3(lz), hidden: !!r.hidden });
        if (r.hidden) { B.roomZone.push(-1); return; }
        const corners = [[r.bbox.x0, r.bbox.y0], [r.bbox.x1, r.bbox.y0], [r.bbox.x1, r.bbox.y1], [r.bbox.x0, r.bbox.y1]].map(([px, py]) => T(...L(px, py)));
        const xs = corners.map(p => p[0]), zs = corners.map(p => p[1]);
        const [wx, wz] = T(lx, lz);
        B.roomZone.push(out.zones.length);
        out.zones.push({
          id: `b${bi + 1}r${ri + 1}`, name: r.name, bname: B.name, building: bi, num: B.num, color: r.color || ROOM_COLORS[ri % ROOM_COLORS.length], corridor: !!r.corridor,
          x: r3((Math.min(...xs) + Math.max(...xs)) / 2), z: r3((Math.min(...zs) + Math.max(...zs)) / 2),
          w: r3(Math.max(...xs) - Math.min(...xs)), l: r3(Math.max(...zs) - Math.min(...zs)),
          lx: wx, lz: wz, areaM2: r1(r.area * plan.mpp * plan.mpp)
        });
      });
      out.buildings.push(B);
    });
    out.props = (site.props || []).filter(p => PROPS[p.t]).map(p => ({ t: p.t, x: X(p.x), z: Z(p.y), rot: p.rot || 0, s: p.s || 1 }));
    out.poles = (site.poles || []).map(line => ({ pts: (line.pts || []).map(([x, y]) => ({ x: X(x), z: Z(y), h: (line.h || 8) / scale })) })).filter(l => l.pts.length);
    out.roads = (site.roads || []).filter(r => r.pts && r.pts.length > 1).map(r => ({ pts: r.pts.map(([x, y]) => [X(x), Z(y)]), w: (r.w || 6) / scale, line: r.line !== false }));
    out.fields = (site.fields || []).map(f => ({ t: FIELDS[f.t] ? f.t : 'football', x: X(f.x), z: Z(f.y), w: r3(f.w * k), d: r3(f.d * k), rot: f.rot || 0 }));
    out.fences = (site.fences || []).filter(f => f.pts && f.pts.length > 1).map(f => ({ pts: f.pts.map(([x, y]) => [X(x), Z(y)]), h: (f.h || 1.8) / scale }));
    return out;
  }
  // หาห้องจากจุดในฉาก (อาคารหมุนได้ ห้องเป็นรูปทรงใดก็ได้)
  function zoneIndexAt(desc, x, z) {
    if (!desc) return -1;
    for (const B of desc.buildings) {
      const dx = x - B.x, dz = z - B.z;
      if (dx * dx + dz * dz > B.r2) continue;
      const lx = B.cos * dx + B.sin * dz, lz = -B.sin * dx + B.cos * dz;
      const ri = PS.roomAt(B.plan, lx / B.pk + B.pw / 2, lz / B.pk + B.ph / 2);
      if (ri >= 0 && B.roomZone[ri] >= 0) return B.roomZone[ri];
    }
    return -1;
  }
  function buildingAt(desc, x, z) {
    if (!desc) return null;
    for (const B of desc.buildings) {
      const dx = x - B.x, dz = z - B.z;
      const lx = B.cos * dx + B.sin * dz, lz = -B.sin * dx + B.cos * dz;
      if (Math.abs(lx) <= B.w / 2 + 0.05 && Math.abs(lz) <= B.d / 2 + 0.05) return B;
    }
    return null;
  }
  // จุดบนผนังด้านนอกอาคารที่ใกล้เป้าหมายที่สุด (ใช้เดินสายออกจากอาคาร)
  function exitPoint(B, tx, tz, off) {
    const o = off === undefined ? 0.3 : off;
    const dx = tx - B.x, dz = tz - B.z;
    let lx = B.cos * dx + B.sin * dz, lz = -B.sin * dx + B.cos * dz;
    const hw = B.w / 2, hd = B.d / 2;
    lx = clamp(lx, -hw, hw); lz = clamp(lz, -hd, hd);
    const ex = hw - Math.abs(lx), ez = hd - Math.abs(lz);
    if (ex < ez) lx = Math.sign(lx || 1) * (hw + o); else lz = Math.sign(lz || 1) * (hd + o);
    return { x: r3(B.x + B.cos * lx - B.sin * lz), z: r3(B.z + B.sin * lx + B.cos * lz) };
  }
  /* เดินสายผ่านเสาไฟ: Dijkstra บนเสาทุกต้น (ต้นติดกันในแนวเดียวกันเชื่อมเสมอ + ต้นที่ห่างไม่เกิน maxSpan) */
  function poleRoute(desc, a, b, maxSpan) {
    const P = [];
    (desc.poles || []).forEach((line, li) => line.pts.forEach((p, pi) => P.push({ x: p.x, z: p.z, h: p.h || 8, li, pi })));
    if (!P.length) return [];
    const span = maxSpan || 60, n = P.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    const d2 = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
    const near = q => P.reduce((bi, p, i) => (d2(p, q) < d2(P[bi], q) ? i : bi), 0);
    const s = near(a), e = near(b);
    dist[s] = 0;
    for (let it = 0; it < n; it++) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || dist[u] === Infinity) break;
      if (u === e) break;
      done[u] = 1;
      for (let v = 0; v < n; v++) {
        if (done[v] || v === u) continue;
        const same = P[u].li === P[v].li && Math.abs(P[u].pi - P[v].pi) === 1, dd = d2(P[u], P[v]);
        if (!same && dd > span) continue;
        const w = dd * (same ? 1 : 1.15);
        if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
      }
    }
    if (dist[e] === Infinity) return [P[s]];
    const path = [];
    for (let v = e; v >= 0; v = prev[v]) { path.unshift(P[v]); if (v === s) break; }
    return path;
  }
  // วางเสาไฟถนนตามแนวถนน ทุก ๆ step เมตร (ข้างถนนด้านเดียว)
  function lampsAlong(site, road, stepM) {
    const out = [], step = (stepM || 30) / site.mpp, off = ((road.w || 6) / 2 + 1.2) / site.mpp;
    let carry = step / 2;
    for (let i = 1; i < road.pts.length; i++) {
      const [ax, ay] = road.pts[i - 1], [bx, by] = road.pts[i], L = Math.hypot(bx - ax, by - ay);
      if (L < 1) continue;
      const ux = (bx - ax) / L, uy = (by - ay) / L;
      for (let d = carry; d < L; d += step) out.push({ t: 'lamp', x: r1(ax + ux * d - uy * off), y: r1(ay + uy * d + ux * off), rot: Math.round(Math.atan2(uy, ux) / DEG) });
      carry = (carry - L) % step;
      if (carry < 0) carry += step;
    }
    return out;
  }

  return {
    AREAS, AREA_INDEX, PROPS, STYLES, ROOFS, FIELDS, PPM, PAD,
    rleEncode, rleDecode, newGround, groundOf, packGround, paintCircle, paintRect, paintEllipse, paintPolygon, autoAreas, wand, cellColors,
    layoutPlan, scalePlan, newBuilding, relayout, resizeBuilding, blank, normalize, toScene, zoneIndexAt, buildingAt, exitPoint, poleRoute, lampsAlong
  };
});
