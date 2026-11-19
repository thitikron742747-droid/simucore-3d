/* ==========================================================================
   SimuCore SiteRender — สร้างฉาก 3D ของผังบริเวณ (วิทยาลัย / วิทยาเขต)
   --------------------------------------------------------------------------
   พื้นหญ้า/ลาน/บ่อน้ำ (วาดเป็นภาพเดียว) · ถนนพร้อมเส้นจราจร · สนามกีฬา · รั้ว
   อาคารหลายชั้น: ชั้นล่างมีห้องตามแผนผัง (ผนัง ประตู หน้าต่าง) ชั้นบนเป็นเปลือกอาคารมีหน้าต่าง
   หลังคา ดาดฟ้า/จั่ว/ปั้นหยา/โดม · ซูมเข้าใกล้แล้วเปิดหลังคาให้เห็นห้องข้างใน
   ต้นไม้ เสาไฟถนน เสาไฟฟ้า+สายไฟ ศาลา เสาธง หอถังน้ำ โรงจอดรถ รถยนต์ ฯลฯ (instancing)
   ใช้ข้อมูลจาก SiteModel.toScene() — หน่วยเมตร แกน x = ตะวันออก, z = ใต้
   ========================================================================== */
(function () {
  'use strict';
  const DEG = Math.PI / 180;
  const POLE_Y = 6.6;                 // ความสูงสายสื่อสารบนเสาไฟฟ้า (ใต้สายไฟแรงสูง)
  const STYLE = {
    white: { wall: '#e9ebee', trim: '#a3adb9', glass: '#5d83ad', roof: '#5f6b7a' },
    cream: { wall: '#f0dfbd', trim: '#b9824f', glass: '#5a7fa6', roof: '#b4532f' },
    brick: { wall: '#b07a62', trim: '#efe2d3', glass: '#4b6683', roof: '#7a3a27' },
    gray: { wall: '#b3bcc7', trim: '#e5e9ef', glass: '#44648a', roof: '#4b5563' },
    blue: { wall: '#d3e3f3', trim: '#7ea8d2', glass: '#2f6aa8', roof: '#2b4c75' },
    wood: { wall: '#d1a77c', trim: '#7a4b2a', glass: '#405a75', roof: '#8c3f2c' }
  };
  const AREA_COL = { 1: '#6d9a48', 2: '#53585f', 3: '#cbc5b8', 4: '#2e6d94', 5: '#9b7853', 6: '#d9c495', 7: '#4f8236' };
  const rand = seed => { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  const hexRGB = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const shade = (h, f) => { const [r, g, b] = hexRGB(h); const m = v => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f)))); return `rgb(${m(r)},${m(g)},${m(b)})`; };
  const hash = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };

  /* ======================= ตัวช่วยรวมรูปทรงเป็นก้อนเดียว ======================= */
  // รวมกล่อง/รูปทรงหลายชิ้นเป็น BufferGeometry เดียว (ลด draw call) พร้อมสีต่อจุด และ UV ตามพิกัดจริง
  class GB {
    constructor(o) {
      const opt = o || {};
      this.pos = []; this.nor = []; this.uv = []; this.col = [];
      this.colors = opt.colors !== false;
      this.world = opt.world === undefined ? 0 : opt.world;     // >0 = UV ตามพิกัดจริง (เมตรต่อรอบลาย)
      this.T = window.THREE;
      this._m = new this.T.Matrix4(); this._n = new this.T.Matrix3();
      this._v = new this.T.Vector3(); this._w = new this.T.Vector3();
      this._q = new this.T.Quaternion(); this._s = new this.T.Vector3(); this._p = new this.T.Vector3();
      this._c = new this.T.Color(); this._c2 = new this.T.Color();
    }
    get empty() { return this.pos.length === 0; }
    add(geo, matrix, color, top) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      const P = g.attributes && g.attributes.position, N = g.attributes && g.attributes.normal, U = g.attributes && g.attributes.uv;
      if (!P) return this;
      if (matrix) this._n.getNormalMatrix(matrix);
      const c = this.colors ? this._c.set(color === undefined ? 0xffffff : color) : null, ct = top !== undefined && top !== null ? this._c2.set(top) : null;
      for (let i = 0; i < P.count; i++) {
        const v = this._v.fromBufferAttribute(P, i), n = this._w;
        if (N) n.fromBufferAttribute(N, i); else n.set(0, 1, 0);
        if (matrix) { v.applyMatrix4(matrix); n.applyMatrix3(this._n).normalize(); }
        this.pos.push(v.x, v.y, v.z); this.nor.push(n.x, n.y, n.z);
        if (this.world) {
          const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z), s = this.world;
          if (ay >= ax && ay >= az) this.uv.push(v.x / s, v.z / s);
          else if (ax >= az) this.uv.push(v.z / s, v.y / s);
          else this.uv.push(v.x / s, v.y / s);
        } else if (U) this.uv.push(U.getX(i), U.getY(i));
        else this.uv.push(0, 0);
        if (c) { const q = ct && n.y > 0.6 ? ct : c; this.col.push(q.r, q.g, q.b); }
      }
      if (g !== geo) g.dispose();
      return this;
    }
    // กล่องจุดศูนย์กลาง (x,y,z) ขนาด sx×sy×sz หมุนรอบแกน y
    box(x, y, z, sx, sy, sz, ry, color, top) {
      if (!(sx > 0 && sy > 0 && sz > 0)) return this;
      this._q.setFromAxisAngle(UP(), ry || 0);
      this._m.compose(this._p.set(x, y, z), this._q, this._s.set(sx, sy, sz));
      return this.add(UNIT_BOX(), this._m, color, top);
    }
    // กล่องตามแนวเส้น (x1,z1)→(x2,z2) ความหนา t ช่วงความสูง y0..y1
    seg(x1, z1, x2, z2, t, y0, y1, color, top, extend) {
      const L = Math.hypot(x2 - x1, z2 - z1);
      if (L < 0.01 || y1 - y0 < 0.005) return this;
      return this.box((x1 + x2) / 2, (y0 + y1) / 2, (z1 + z2) / 2, L + (extend || 0), y1 - y0, t, -Math.atan2(z2 - z1, x2 - x1), color, top);
    }
    geo(geometry, x, y, z, ry, sx, sy, sz, color, top) {
      this._q.setFromAxisAngle(UP(), ry || 0);
      this._m.compose(this._p.set(x, y, z), this._q, this._s.set(sx || 1, sy || sx || 1, sz || sx || 1));
      return this.add(geometry, this._m, color, top);
    }
    // สามเหลี่ยม (หันหน้าออกตาม hint)
    tri(a, b, c, hint, color) {
      let A = a, B = b, C = c;
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { B = c; C = b; nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const col = this.colors ? this._c.set(color === undefined ? 0xffffff : color) : null;
      for (const p of [A, B, C]) {
        this.pos.push(p[0], p[1], p[2]); this.nor.push(nx, ny, nz);
        if (this.world) {
          const s = this.world, ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
          if (ay >= ax && ay >= az) this.uv.push(p[0] / s, p[2] / s); else if (ax >= az) this.uv.push(p[2] / s, p[1] / s); else this.uv.push(p[0] / s, p[1] / s);
        } else this.uv.push(0, 0);
        if (col) this.col.push(col.r, col.g, col.b);
      }
      return this;
    }
    quad(a, b, c, d, hint, color) { return this.tri(a, b, c, hint, color).tri(a, c, d, hint, color); }
    // สี่เหลี่ยมพร้อม UV กำหนดเอง (ใช้กับผนังอาคารชั้นบนที่มีลายหน้าต่าง)
    quadUV(a, b, c, d, ua, ub, uc, ud, normal) {
      for (const [p, u] of [[a, ua], [b, ub], [c, uc], [a, ua], [c, uc], [d, ud]]) {
        this.pos.push(p[0], p[1], p[2]); this.nor.push(normal[0], normal[1], normal[2]); this.uv.push(u[0], u[1]);
        if (this.colors) this.col.push(1, 1, 1);
      }
      return this;
    }
    build() {
      const T = this.T, g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(this.nor, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
      if (this.colors) g.setAttribute('color', new T.Float32BufferAttribute(this.col, 3));
      return g;
    }
  }
  let _up = null, _box = null;
  const UP = () => _up || (_up = new window.THREE.Vector3(0, 1, 0));
  const UNIT_BOX = () => _box || (_box = new window.THREE.BoxGeometry(1, 1, 1));

  /* ============================ ลายพื้นผิว (วาดด้วยโค้ด) ============================ */
  const texCache = new Map();
  function cachedTex(key, make, repeat) {
    if (texCache.has(key)) return texCache.get(key);
    const T = window.THREE, t = new T.CanvasTexture(make());
    if (repeat !== false) t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = 8;
    t.shared = true;
    texCache.set(key, t);
    return t;
  }
  // จุดสุ่มเล็ก ๆ บนพื้นสี (ใช้ทำลายหญ้า ปูน ยางมะตอย)
  function speckle(size, base, spots, seed, count, rmin, rmax) {
    const c = mkCanvas(size, size), g = c.getContext('2d'), r = rand(seed);
    g.fillStyle = base; g.fillRect(0, 0, size, size);
    for (let i = 0; i < count; i++) {
      g.fillStyle = spots[Math.floor(r() * spots.length)];
      g.globalAlpha = 0.25 + r() * 0.5;
      const x = r() * size, y = r() * size, rad = rmin + r() * (rmax - rmin);
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
      // ให้ลายต่อกันได้ไม่เห็นรอยต่อ
      if (x < rad) { g.beginPath(); g.arc(x + size, y, rad, 0, Math.PI * 2); g.fill(); }
      if (y < rad) { g.beginPath(); g.arc(x, y + size, rad, 0, Math.PI * 2); g.fill(); }
    }
    g.globalAlpha = 1;
    return c;
  }
  const TILES = {
    grass: () => speckle(256, '#6d9a48', ['#5c883b', '#7fab56', '#557f35', '#8bb661', '#64913f'], 11, 2600, 0.8, 2.6),
    garden: () => { const c = speckle(256, '#4f8236', ['#41702b', '#5d9440', '#3a6526'], 12, 2200, 0.8, 2.4), g = c.getContext('2d'), r = rand(5); for (let i = 0; i < 70; i++) { g.fillStyle = ['#f472b6', '#facc15', '#f8fafc', '#fb923c'][i % 4]; g.globalAlpha = 0.7; g.beginPath(); g.arc(r() * 256, r() * 256, 1.2, 0, 7); g.fill(); } g.globalAlpha = 1; return c; },
    concrete: () => { const c = speckle(256, '#cbc5b8', ['#b8b2a5', '#d8d3c7', '#a9a397'], 13, 1800, 0.5, 1.6), g = c.getContext('2d'); g.strokeStyle = 'rgba(120,112,100,0.35)'; g.lineWidth = 1; for (let i = 0; i <= 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); } return c; },
    road: () => speckle(256, '#53585f', ['#454a50', '#62676e', '#3d4146', '#6b7076'], 14, 3200, 0.4, 1.3),
    water: () => speckle(256, '#2e6d94', ['#2a6488', '#3a7fa8', '#24597a'], 15, 900, 2, 7),
    dirt: () => speckle(256, '#9b7853', ['#8a6845', '#ad8a63', '#7d5d3c'], 16, 2200, 0.6, 2.2),
    sand: () => speckle(256, '#d9c495', ['#cbb582', '#e6d4aa', '#c2ab78'], 17, 2000, 0.5, 1.6),
    bank: () => speckle(256, '#bfa877', ['#a99364', '#cdb88a'], 18, 1400, 0.6, 2)
  };
  const AREA_TILE = { 1: 'grass', 2: 'road', 3: 'concrete', 4: 'water', 5: 'dirt', 6: 'sand', 7: 'garden' };
  // ลายละเอียดซ้ำ ๆ คูณทับพื้น (ให้พื้นดูมีผิวเมื่อซูมใกล้)
  const detailTex = () => cachedTex('detail', () => {
    const c = mkCanvas(256, 256), g = c.getContext('2d'), im = g.createImageData(256, 256), r = rand(77);
    for (let i = 0; i < 256 * 256; i++) { const v = 112 + Math.round((r() + r() + r() - 1.5) * 34); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
    g.putImageData(im, 0, 0);
    return c;
  });
  const asphaltTex = () => cachedTex('asphalt', () => { const c = speckle(128, '#4d5258', ['#43474d', '#5c6167', '#383c41', '#6a6f75'], 21, 1500, 0.3, 1.1), g = c.getContext('2d'); g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, 56, 128, 16); return c; });
  const dashTex = () => cachedTex('dash', () => { const c = mkCanvas(16, 64), g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 16, 32); return c; });
  const plasterTex = () => cachedTex('plaster', () => speckle(128, '#ececec', ['#dcdcdc', '#f7f7f7', '#d2d2d2'], 31, 900, 0.4, 1.4));
  const tileTex = () => cachedTex('tile', () => {
    const c = mkCanvas(256, 256), g = c.getContext('2d'), r = rand(41);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const v = 222 + Math.round(r() * 14); g.fillStyle = `rgb(${v},${v - 4},${v - 12})`; g.fillRect(x * 64, y * 64, 64, 64); }
    g.strokeStyle = 'rgba(120,115,105,0.55)'; g.lineWidth = 2;
    for (let i = 0; i <= 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
    return c;
  });
  const roofTex = () => cachedTex('rooftile', () => {
    const c = mkCanvas(128, 128), g = c.getContext('2d');
    g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 16) { const gr = g.createLinearGradient(0, y, 0, y + 16); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.8, '#d0d0d0'); gr.addColorStop(1, '#9a9a9a'); g.fillStyle = gr; g.fillRect(0, y, 128, 16); }
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < 128; y += 16) for (let x = (y / 16) % 2 ? 0 : 8; x < 128; x += 16) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 16); g.stroke(); }
    return c;
  });
  const ribTex = () => cachedTex('ribs', () => { const c = mkCanvas(64, 64), g = c.getContext('2d'); g.fillStyle = '#e4e7eb'; g.fillRect(0, 0, 64, 64); for (let x = 0; x < 64; x += 8) { g.fillStyle = '#b9c0c8'; g.fillRect(x, 0, 2, 64); g.fillStyle = '#ffffff'; g.fillRect(x + 2, 0, 2, 64); } return c; });
  // ลายหน้าอาคาร 1 ช่วงเสา × 1 ชั้น: หน้าต่าง หรือ ทางเดินเปิดโล่งมีราวกันตก
  function facadeTex(style, variant, FH) {
    const key = `fac-${style}-${variant}-${FH}`;
    return cachedTex(key, () => facadeCanvas(style, variant, FH, false));
  }
  function facadeRough(style, variant, FH) {
    return cachedTex(`facR-${style}-${variant}-${FH}`, () => facadeCanvas(style, variant, FH, true));
  }
  function facadeCanvas(style, variant, FH, rough) {
    const S = STYLE[style] || STYLE.white, N = 256, c = mkCanvas(N, N), g = c.getContext('2d');
    const Y = h => N * (1 - h / FH);                 // ความสูงจากพื้นชั้น (ม.) → พิกัดภาพ
    const fill = (col, x, y0, w, y1) => { g.fillStyle = rough ? (col === 'glass' ? '#2a2a2a' : '#e8e8e8') : col; g.fillRect(x, Y(y1), w, Y(y0) - Y(y1)); };
    if (!rough) { g.drawImage(speckle(N, S.wall, [shade(S.wall, -0.06), shade(S.wall, 0.05)], 51, 700, 0.5, 1.5), 0, 0); }
    else { g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, N, N); }
    if (variant === 'corridor') {
      // ทางเดินเปิดโล่ง: เสาสองข้าง คานด้านบน ผนังห้องด้านใน (เงา) ราวกันตกด้านล่าง
      const inner = shade(S.wall, -0.42);
      fill(inner, 18, 1.0, N - 36, FH - 0.45);
      if (!rough) {
        const gr = g.createLinearGradient(0, Y(FH - 0.45), 0, Y(1.0));
        gr.addColorStop(0, 'rgba(0,0,0,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0.05)');
        g.fillStyle = gr; g.fillRect(18, Y(FH - 0.45), N - 36, Y(1.0) - Y(FH - 0.45));
        // ประตูห้องและหน้าต่างบานเกล็ดบนผนังด้านใน
        g.fillStyle = shade(S.trim, -0.35); g.fillRect(40, Y(2.15), 46, Y(1.0) - Y(2.15));
        g.fillStyle = shade(S.glass, -0.25); g.fillRect(110, Y(2.2), 110, Y(1.35) - Y(2.2));
        g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 2;
        for (let x = 110; x <= 220; x += 22) { g.beginPath(); g.moveTo(x, Y(2.2)); g.lineTo(x, Y(1.35)); g.stroke(); }
      }
      fill(S.wall, 0, 0, N, 1.05);                    // ราวกันตก (ผนังทึบ)
      fill(S.trim, 0, 0.98, N, 1.08);
      fill(S.trim, 0, FH - 0.45, N, FH);               // คาน
      fill(S.wall, 0, 0, 18, FH); fill(S.wall, N - 18, 0, 18, FH);    // เสา
      if (!rough) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(18, Y(FH - 0.45), 6, Y(1.08) - Y(FH - 0.45)); }
    } else {
      // หน้าต่างกระจกมีกรอบ ขอบล่าง และกันสาดด้านบน
      const x0 = 34, w = N - 68;
      fill(S.trim, x0 - 6, 0.82, w + 12, 0.9);         // ขอบหน้าต่างล่าง
      fill(S.trim, x0 - 4, 0.9, w + 8, 2.42);          // วงกบ
      if (!rough) {
        const gr = g.createLinearGradient(0, Y(2.36), 0, Y(0.96));
        gr.addColorStop(0, shade(S.glass, 0.25)); gr.addColorStop(0.55, S.glass); gr.addColorStop(1, shade(S.glass, -0.3));
        g.fillStyle = gr; g.fillRect(x0, Y(2.36), w, Y(0.96) - Y(2.36));
        g.fillStyle = 'rgba(255,255,255,0.22)';
        g.beginPath(); g.moveTo(x0 + 20, Y(2.36)); g.lineTo(x0 + 70, Y(2.36)); g.lineTo(x0 + 30, Y(0.96)); g.lineTo(x0 - 20 + 20, Y(0.96)); g.fill();
      } else { g.fillStyle = '#2a2a2a'; g.fillRect(x0, Y(2.36), w, Y(0.96) - Y(2.36)); }
      fill(S.trim, x0 + w / 2 - 3, 0.96, 6, 2.36);     // เสากลางหน้าต่าง
      fill(S.trim, x0, 1.6, w, 1.65);
      fill(shade(S.trim, -0.2), x0 - 14, 2.55, w + 28, 2.7);   // กันสาด
      if (!rough) { g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(x0 - 10, Y(2.55), w + 20, 8); }
    }
    fill(shade(S.trim, -0.1), 0, 0, N, 0.08);
    return c;
  }
  function textSprite(lines, opts) {
    const T = window.THREE, o = opts || {};
    const c = mkCanvas(640, 150), g = c.getContext('2d');
    g.font = '600 50px Prompt, "IBM Plex Sans Thai", sans-serif';
    const tw = Math.min(620, g.measureText ? Math.max(...lines.map(l => g.measureText(l).width)) + (o.num ? 150 : 70) : 600);
    const x0 = (640 - tw) / 2;
    g.beginPath(); g.moveTo(x0 + 50, 18); g.arcTo(x0 + tw, 18, x0 + tw, 132, 50); g.arcTo(x0 + tw, 132, x0, 132, 50); g.arcTo(x0, 132, x0, 18, 50); g.arcTo(x0, 18, x0 + tw, 18, 50); g.closePath();
    g.fillStyle = 'rgba(12,18,40,0.86)'; g.fill();
    g.lineWidth = 5; g.strokeStyle = o.color || '#38bdf8'; g.stroke();
    let tx = x0 + 36;
    if (o.num) {
      g.fillStyle = o.color || '#38bdf8'; g.beginPath(); g.arc(x0 + 72, 75, 40, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#0b1020'; g.font = '700 44px Prompt, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(o.num, x0 + 72, 78);
      tx = x0 + 128;
    }
    g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = '#f8fafc'; g.font = '600 50px Prompt, "IBM Plex Sans Thai", sans-serif';
    g.fillText(lines[0], tx, 78);
    const sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), transparent: true, depthTest: false, sizeAttenuation: o.attenuate !== false }));
    sp.renderOrder = 14;
    return sp;
  }
  function badgeSprite(num, color) {
    const T = window.THREE, c = mkCanvas(128, 128), g = c.getContext('2d');
    g.fillStyle = 'rgba(12,18,40,0.88)'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
    g.fillStyle = color || '#38bdf8'; g.beginPath(); g.arc(64, 64, 48, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0b1020'; g.font = '700 54px Prompt, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(num, 64, 68);
    const sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), transparent: true, depthTest: false, sizeAttenuation: false }));
    sp.renderOrder = 14;
    return sp;
  }
  // ภาพป้ายข้อความบนซุ้มประตู
  function signTex(text) {
    const T = window.THREE, c = mkCanvas(1024, 128), g = c.getContext('2d');
    g.fillStyle = '#123a6b'; g.fillRect(0, 0, 1024, 128);
    g.strokeStyle = '#e8c35a'; g.lineWidth = 8; g.strokeRect(6, 6, 1012, 116);
    g.fillStyle = '#f8e7a8'; g.font = '700 66px Prompt, "IBM Plex Sans Thai", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 512, 68, 980);
    return new T.CanvasTexture(c);
  }
  const flagCanvas = () => { const c = mkCanvas(240, 160), g = c.getContext('2d'); [['#c8102e', 0, 1], ['#ffffff', 1, 1], ['#2d2a6e', 2, 2], ['#ffffff', 4, 1], ['#c8102e', 5, 1]].forEach(([col, a, n]) => { g.fillStyle = col; g.fillRect(0, a * 160 / 6, 240, n * 160 / 6 + 1); }); return c; };
  function fieldCanvas(type, w, d) {
    const S = 8, c = mkCanvas(Math.min(1024, w * S), Math.min(1024, d * S)), g = c.getContext('2d'), sx = c.width / w, sy = c.height / d;
    const X = m => m * sx, Yy = m => m * sy;
    if (type === 'football') {
      for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#4f9a3c' : '#5aa845'; g.fillRect(X(i * w / 12), 0, X(w / 12) + 1, c.height); }
    } else if (type === 'futsal') { g.fillStyle = '#2f7d6d'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#c0542f'; g.fillRect(0, 0, c.width, Yy(1.5)); g.fillRect(0, c.height - Yy(1.5), c.width, Yy(1.5)); }
    else { g.fillStyle = '#b9583a'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#3b6fb6'; g.fillRect(X(1.5), Yy(1.5), X(w - 3), Yy(d - 3)); }
    g.strokeStyle = '#f8fafc'; g.lineWidth = Math.max(2, X(0.12));
    const m = type === 'football' ? 2.5 : 1.5, fw = w - 2 * m, fd = d - 2 * m;
    g.strokeRect(X(m), Yy(m), X(fw), Yy(fd));
    g.beginPath(); g.moveTo(X(w / 2), Yy(m)); g.lineTo(X(w / 2), Yy(d - m)); g.stroke();
    g.beginPath(); g.ellipse(X(w / 2), Yy(d / 2), X(Math.min(9.15, fd * 0.16)), Yy(Math.min(9.15, fd * 0.16)), 0, 0, Math.PI * 2); g.stroke();
    const box = (bw, bd) => { g.strokeRect(X(m), Yy(d / 2 - bd / 2), X(bw), Yy(bd)); g.strokeRect(X(w - m - bw), Yy(d / 2 - bd / 2), X(bw), Yy(bd)); };
    if (type === 'football') { box(Math.min(16.5, fw * 0.16), Math.min(40.3, fd * 0.6)); box(Math.min(5.5, fw * 0.06), Math.min(18.3, fd * 0.3)); }
    else box(Math.min(6, fw * 0.15), Math.min(10, fd * 0.5));
    return c;
  }

  /* ========================================================================
     ฉากทั้งหมด
     ======================================================================== */
  function build(desc, opts) {
    const T = window.THREE, o = opts || {};
    const WALL_H = o.wallH || 3.2, FH = WALL_H + 0.3;
    const root = new T.Group();
    root.name = 'campus';
    const hooks = [];
    const W = desc.floorW, L = desc.floorL, span = Math.max(W, L);
    const std = (p) => new T.MeshStandardMaterial(Object.assign({ roughness: 0.85, metalness: 0 }, p));
    const shared = m => { m.shared = true; return m; };
    const mesh = (geo, mat, shadow) => { const m = new T.Mesh(geo, mat); if (shadow !== false) { m.castShadow = true; m.receiveShadow = true; } return m; };
    function addDetail(mat, tex, rep, amount, offset) {
      mat.onBeforeCompile = sh => {
        sh.uniforms.uDetail = { value: tex };
        sh.uniforms.uDetailRep = { value: rep };
        sh.uniforms.uDetailOff = { value: offset || new T.Vector2(0, 0) };
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;\nuniform vec2 uDetailRep;\nuniform vec2 uDetailOff;')
          .replace('#include <map_fragment>', `#include <map_fragment>\n\tdiffuseColor.rgb *= mix(vec3(1.0), texture2D(uDetail, vUv * uDetailRep + uDetailOff).rgb * 2.2, ${amount.toFixed(2)});`);
      };
      mat.customProgramCacheKey = () => 'detail' + amount.toFixed(2);
    }

    /* ------------------------------ พื้นผัง ------------------------------ */
    const CW = Math.round(o.groundRes || 2048), k0 = CW / Math.max(W, L);
    const gw = Math.max(64, Math.round(W * k0)), gl = Math.max(64, Math.round(L * k0));
    const gc = mkCanvas(gw, gl), gx = gc.getContext('2d');
    const toC = (x, z) => [(x / W + 0.5) * gw, (z / L + 0.5) * gl];
    const pat = name => gx.createPattern(TILES[name](), 'repeat');
    const baseTile = AREA_TILE[{ grass: 1, road: 2, concrete: 3, water: 4, dirt: 5, sand: 6, garden: 7 }[desc.base] || 1];
    gx.fillStyle = pat(baseTile); gx.fillRect(0, 0, gw, gl);
    const G = desc.ground;
    const cellToC = G ? (desc.k * G.cell) * k0 : 0;
    function maskOf(test, blur) {
      const m = mkCanvas(G.cols, G.rows), mg = m.getContext('2d'), im = mg.createImageData(G.cols, G.rows);
      let any = false;
      for (let i = 0; i < G.data.length; i++) if (test(G.data[i])) { im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = 255; im.data[i * 4 + 3] = 255; any = true; }
      if (!any) return null;
      mg.putImageData(im, 0, 0);
      const big = mkCanvas(gw, gl), bg = big.getContext('2d');
      bg.imageSmoothingEnabled = true;
      if (blur && 'filter' in bg) bg.filter = `blur(${blur}px)`;
      bg.drawImage(m, 0, 0, G.cols * cellToC, G.rows * cellToC);
      return big;
    }
    function paintLayer(mask, fillStyle) {
      if (!mask) return;
      const lg = mask.getContext('2d');
      lg.filter = 'none';
      lg.globalCompositeOperation = 'source-in';
      lg.fillStyle = fillStyle; lg.fillRect(0, 0, gw, gl);
      gx.drawImage(mask, 0, 0);
    }
    if (G) {
      for (const v of [5, 6, 1, 7, 3, 2]) paintLayer(maskOf(x => x === v, 1.2), pat(AREA_TILE[v]));
      paintLayer(maskOf(x => x === 4, Math.max(3, 2.5 * k0)), pat('bank'));        // ตลิ่งรอบบ่อ
      paintLayer(maskOf(x => x === 4, 0.8), pat('water'));
    }
    // ลานคอนกรีตรอบอาคาร + เงาที่โคนผนัง
    const concreteP = pat('concrete');
    desc.buildings.forEach(B => {
      gx.save();
      const [cx, cz] = toC(B.x, B.z);
      gx.translate(cx, cz); gx.rotate(B.rot * DEG);
      const m = 2.6 * k0, w = B.w * k0, d = B.d * k0;
      gx.fillStyle = concreteP; gx.fillRect(-w / 2 - m, -d / 2 - m, w + 2 * m, d + 2 * m);
      gx.fillStyle = 'rgba(70,64,56,0.35)'; gx.fillRect(-w / 2 - m, -d / 2 - m, w + 2 * m, 1.2); gx.fillRect(-w / 2 - m, d / 2 + m - 1.2, w + 2 * m, 1.2);
      if ('filter' in gx) gx.filter = `blur(${Math.max(2, 0.9 * k0)}px)`;
      gx.fillStyle = 'rgba(25,22,18,0.55)'; gx.fillRect(-w / 2 - 0.4 * k0, -d / 2 - 0.4 * k0, w + 0.8 * k0, d + 0.8 * k0);
      gx.restore();
      if ('filter' in gx) gx.filter = 'none';
    });
    // ถนน: ทางเท้า/ขอบถนน แล้วผิวยางมะตอย
    const roadP = pat('road');
    gx.lineJoin = 'round'; gx.lineCap = 'round';
    for (const pass of [0, 1]) desc.roads.forEach(r => {
      gx.beginPath();
      r.pts.forEach(([x, z], i) => { const [a, b] = toC(x, z); if (i) gx.lineTo(a, b); else gx.moveTo(a, b); });
      gx.strokeStyle = pass ? roadP : concreteP;
      gx.lineWidth = (r.w + (pass ? 0 : 2.6)) * k0;
      gx.stroke();
    });
    // สนามกีฬา (พื้นใต้สนาม)
    desc.fields.forEach(f => { gx.save(); const [cx, cz] = toC(f.x, f.z); gx.translate(cx, cz); gx.rotate(f.rot * DEG); gx.fillStyle = '#4f8f3a'; gx.fillRect(-f.w * k0 / 2 - 2, -f.d * k0 / 2 - 2, f.w * k0 + 4, f.d * k0 + 4); gx.restore(); });
    // เงาใต้ต้นไม้ / ศาลา (ช่วยให้วัตถุดูวางบนพื้นจริงแม้มองไกล)
    desc.props.forEach(p => {
      const r = { tree: 3.2, pine: 2.2, palm: 2.4, bush: 1.2, sala: 3.5, tower: 3.6, shelter: 0 }[p.t];
      if (!r) return;
      const [cx, cz] = toC(p.x, p.z), rr = r * p.s * k0;
      const gr = gx.createRadialGradient(cx, cz, 0, cx, cz, rr);
      gr.addColorStop(0, 'rgba(20,30,15,0.38)'); gr.addColorStop(1, 'rgba(20,30,15,0)');
      gx.fillStyle = gr; gx.beginPath(); gx.arc(cx, cz, rr, 0, Math.PI * 2); gx.fill();
    });
    if (o.underlay > 0 && o.img) { gx.globalAlpha = Math.min(1, o.underlay); gx.drawImage(o.img, 0, 0, gw, gl); gx.globalAlpha = 1; }
    const groundTex = new T.CanvasTexture(gc);
    groundTex.anisotropy = 8;
    const groundMat = std({ map: groundTex, roughness: 0.96 });
    addDetail(groundMat, detailTex(), new T.Vector2(W / 7, L / 7), 0.5);
    const groundGeo = new T.PlaneGeometry(W, L);
    groundGeo.rotateX(-Math.PI / 2);
    const ground = new T.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    ground.name = 'ground';
    root.add(ground);
    // พื้นหญ้านอกผัง (กว้างไปถึงขอบฟ้า)
    const outerTex = new T.CanvasTexture(TILES.grass());
    outerTex.wrapS = outerTex.wrapT = T.RepeatWrapping;
    outerTex.repeat.set(span * 8 / 90, span * 8 / 90);
    const outerGeo = new T.PlaneGeometry(span * 8, span * 8);
    outerGeo.rotateX(-Math.PI / 2);
    const outer = new T.Mesh(outerGeo, std({ map: outerTex, roughness: 1 }));
    outer.position.y = -0.04;
    outer.name = 'outer';
    root.add(outer);

    /* ------------------------------ น้ำ ------------------------------ */
    let waterMat = null;
    if (G && G.data.some(v => v === 4)) {
      const m = mkCanvas(G.cols, G.rows), mg = m.getContext('2d'), im = mg.createImageData(G.cols, G.rows);
      for (let i = 0; i < G.data.length; i++) { const on = G.data[i] === 4 ? 255 : 0; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = on; im.data[i * 4 + 3] = 255; }
      mg.putImageData(im, 0, 0);
      const ar = Math.min(1024, gw), wm = mkCanvas(ar, Math.round(ar * gl / gw)), wg = wm.getContext('2d');
      wg.fillStyle = '#000'; wg.fillRect(0, 0, wm.width, wm.height);
      wg.imageSmoothingEnabled = true;
      wg.drawImage(m, 0, 0, G.cols * cellToC * wm.width / gw, G.rows * cellToC * wm.height / gl);
      const alpha = new T.CanvasTexture(wm);
      const off = new T.Vector2(0, 0);
      waterMat = std({ color: 0x3f8fc0, roughness: 0.12, metalness: 0.15, alphaMap: alpha, alphaTest: 0.5, transparent: false });
      addDetail(waterMat, cachedTex('ripple', () => speckle(256, '#7f7f7f', ['#6a6a6a', '#9a9a9a', '#5c5c5c', '#ababab'], 61, 500, 3, 10)), new T.Vector2(W / 9, L / 9), 0.28, off);
      const geo = new T.PlaneGeometry(W, L);
      geo.rotateX(-Math.PI / 2);
      const water = new T.Mesh(geo, waterMat);
      water.position.y = 0.05;
      water.receiveShadow = true;
      water.name = 'water';
      root.add(water);
      hooks.push(now => { off.x = (now / 90000) % 1; off.y = (now / 130000) % 1; waterMat.color.setHSL(0.56, 0.5, 0.48 + 0.02 * Math.sin(now / 1400)); });
    }

    /* ------------------------------ ถนน ------------------------------ */
    // แถบตามแนวเส้น (ต่อมุมแบบ miter) u = ขวาง, v = ตามยาว / uvLen
    function ribbon(gb, pts, w, y, uvLen, offset) {
      const n = pts.length;
      if (n < 2) return;
      const closed = Math.hypot(pts[0][0] - pts[n - 1][0], pts[0][1] - pts[n - 1][1]) < 0.05;
      const nrm = [];
      for (let i = 0; i < n; i++) {
        const prev = i > 0 ? pts[i - 1] : closed ? pts[n - 2] : null, next = i < n - 1 ? pts[i + 1] : closed ? pts[1] : null, p = pts[i];
        let dx = 0, dz = 0;
        if (prev) { const l = Math.hypot(p[0] - prev[0], p[1] - prev[1]) || 1; dx += (p[0] - prev[0]) / l; dz += (p[1] - prev[1]) / l; }
        if (next) { const l = Math.hypot(next[0] - p[0], next[1] - p[1]) || 1; dx += (next[0] - p[0]) / l; dz += (next[1] - p[1]) / l; }
        const l = Math.hypot(dx, dz) || 1;
        let nx = -dz / l, nz = dx / l, sc = 1;
        if (prev && next) { const l1 = Math.hypot(p[0] - prev[0], p[1] - prev[1]) || 1, px1 = -(p[1] - prev[1]) / l1, pz1 = (p[0] - prev[0]) / l1; sc = 1 / Math.max(0.35, nx * px1 + nz * pz1); }
        nrm.push([nx * sc, nz * sc]);
      }
      let dist = 0;
      const off = offset || 0;
      for (let i = 0; i < n - 1; i++) {
        const a = pts[i], b = pts[i + 1], na = nrm[i], nb = nrm[i + 1], seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const L1 = [a[0] + na[0] * (off + w / 2), y, a[1] + na[1] * (off + w / 2)], R1 = [a[0] + na[0] * (off - w / 2), y, a[1] + na[1] * (off - w / 2)];
        const L2 = [b[0] + nb[0] * (off + w / 2), y, b[1] + nb[1] * (off + w / 2)], R2 = [b[0] + nb[0] * (off - w / 2), y, b[1] + nb[1] * (off - w / 2)];
        const v1 = dist / uvLen, v2 = (dist + seg) / uvLen;
        gb.quadUV(R1, L1, L2, R2, [0, v1], [1, v1], [1, v2], [0, v2], [0, 1, 0]);
        dist += seg;
      }
    }
    if (desc.roads.length) {
      const asph = new GB({ colors: false }), dash = new GB({ colors: false }), solid = new GB({ colors: false }), yellow = new GB({ colors: false });
      desc.roads.forEach((r, i) => {
        const y = 0.02 + (i % 7) * 0.0015, w = r.w;
        ribbon(asph, r.pts, w, y, 6);
        if (w >= 14) {
          ribbon(yellow, r.pts, 0.12, y + 0.012, 1, 0.12); ribbon(yellow, r.pts, 0.12, y + 0.012, 1, -0.12);
          ribbon(dash, r.pts, 0.15, y + 0.012, 9, w / 4); ribbon(dash, r.pts, 0.15, y + 0.012, 9, -w / 4);
          ribbon(solid, r.pts, 0.15, y + 0.012, 1, w / 2 - 0.5); ribbon(solid, r.pts, 0.15, y + 0.012, 1, -w / 2 + 0.5);
        } else if (w >= 5) {
          ribbon(dash, r.pts, 0.14, y + 0.012, 6, 0);
          ribbon(solid, r.pts, 0.12, y + 0.012, 1, w / 2 - 0.35); ribbon(solid, r.pts, 0.12, y + 0.012, 1, -w / 2 + 0.35);
        }
      });
      const off = (m, f) => Object.assign(m, { polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f });
      const roads = new T.Mesh(asph.build(), off(std({ map: asphaltTex(), roughness: 0.92 }), -1));
      roads.receiveShadow = true; roads.name = 'roads';
      root.add(roads);
      const lineMat = (col, map) => off(new T.MeshBasicMaterial({ color: col, map: map || null, transparent: !!map, alphaTest: map ? 0.5 : 0 }), -2);
      if (!dash.empty) root.add(new T.Mesh(dash.build(), lineMat(0xf1f1ec, dashTex())));
      if (!solid.empty) root.add(new T.Mesh(solid.build(), lineMat(0xe8e8e2)));
      if (!yellow.empty) root.add(new T.Mesh(yellow.build(), lineMat(0xf2c230)));
    }

    /* ------------------------------ สนามกีฬา ------------------------------ */
    desc.fields.forEach(f => {
      const grp = new T.Group();
      grp.position.set(f.x, 0, f.z); grp.rotation.y = -f.rot * DEG;
      const tex = new T.CanvasTexture(fieldCanvas(f.t, f.w, f.d));
      tex.anisotropy = 8;
      const g = new T.PlaneGeometry(f.w, f.d); g.rotateX(-Math.PI / 2);
      const pl = new T.Mesh(g, Object.assign(std({ map: tex, roughness: 0.9 }), { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      pl.position.y = 0.03; pl.receiveShadow = true;
      grp.add(pl);
      const gb = new GB({});
      const goal = (x, dir, gw2, gh) => {
        const z1 = -gw2 / 2, z2 = gw2 / 2, d2 = dir * 1.6;
        gb.box(x, gh / 2, z1, 0.12, gh, 0.12, 0, 0xf8fafc).box(x, gh / 2, z2, 0.12, gh, 0.12, 0, 0xf8fafc).box(x, gh, 0, 0.12, 0.12, gw2 + 0.12, 0, 0xf8fafc);
        gb.box(x + d2, 0.05, 0, 0.06, 0.06, gw2, 0, 0xcbd5e1).box(x + d2 / 2, gh * 0.6, z1, 1.6, 0.04, 0.04, 0, 0xcbd5e1).box(x + d2 / 2, gh * 0.6, z2, 1.6, 0.04, 0.04, 0, 0xcbd5e1);
      };
      if (f.t === 'football') { goal(-f.w / 2 + 2.5, -1, 7.32, 2.44); goal(f.w / 2 - 2.5, 1, 7.32, 2.44); }
      else if (f.t === 'futsal') { goal(-f.w / 2 + 1.5, -1, 3, 2); goal(f.w / 2 - 1.5, 1, 3, 2); }
      else for (const s of [-1, 1]) { const x = s * (f.w / 2 - 1.2); gb.box(x + s * 0.6, 1.6, 0, 0.18, 3.2, 0.18, 0, 0x6b7280).box(x, 3.2, 0, 0.08, 1.05, 1.8, 0, 0xf8fafc).box(x - s * 0.35, 3.0, 0, 0.45, 0.04, 0.45, 0, 0xf97316); }
      grp.add(mesh(gb.build(), shared(std({ vertexColors: true, roughness: 0.6 }))));
      root.add(grp);
    });

    /* ------------------------------ รั้ว ------------------------------ */
    if (desc.fences.length) {
      const gb = new GB({}), bars = new GB({ colors: false });
      desc.fences.forEach(f => {
        const h = f.h || 1.8;
        for (let i = 1; i < f.pts.length; i++) {
          const [x1, z1] = f.pts[i - 1], [x2, z2] = f.pts[i], Lg = Math.hypot(x2 - x1, z2 - z1);
          if (Lg < 0.1) continue;
          gb.seg(x1, z1, x2, z2, 0.22, 0, 0.55, 0xcfc8bb, 0xe2ddd2);
          gb.seg(x1, z1, x2, z2, 0.06, h - 0.08, h - 0.02, 0x8b949e);
          const n = Math.max(1, Math.round(Lg / 3));
          for (let j = 0; j <= n; j++) { const t = j / n; gb.box(x1 + (x2 - x1) * t, h / 2, z1 + (z2 - z1) * t, 0.2, h, 0.2, -Math.atan2(z2 - z1, x2 - x1), 0xe8e6e1); }
          // ซี่รั้วเหล็ก: แผ่นโปร่งลายซี่ (ประหยัดกว่าสร้างทีละซี่)
          const nx = -(z2 - z1) / Lg, nz = (x2 - x1) / Lg;
          bars.quadUV([x1, 0.55, z1], [x2, 0.55, z2], [x2, h - 0.08, z2], [x1, h - 0.08, z1], [0, 0], [Lg / 0.8, 0], [Lg / 0.8, 1], [0, 1], [nx, 0, nz]);
        }
      });
      const fence = mesh(gb.build(), shared(std({ vertexColors: true, roughness: 0.7 })));
      fence.name = 'fence';
      root.add(fence);
      const barTex = cachedTex('bars', () => { const c = mkCanvas(32, 64), g = c.getContext('2d'); g.fillStyle = '#5b636d'; g.fillRect(6, 0, 4, 64); g.fillRect(22, 0, 4, 64); g.fillRect(0, 28, 32, 4); return c; });
      const bm = new T.Mesh(bars.build(), std({ map: barTex, alphaTest: 0.5, side: T.DoubleSide, roughness: 0.5, metalness: 0.4 }));
      bm.castShadow = true;
      root.add(bm);
    }

    /* ------------------------------ อาคาร ------------------------------ */
    const matCache = {};
    const M = (key, make) => matCache[key] || (matCache[key] = make());
    const wallMat = () => M('wall', () => std({ vertexColors: true, map: plasterTex(), roughness: 0.9 }));
    const floorMat = () => M('floor', () => std({ map: tileTex(), roughness: 0.5, color: 0xf4f1ea }));
    const glassMat = st => M('glass-' + st, () => std({ color: (STYLE[st] || STYLE.white).glass, roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.42, depthWrite: false }));
    const roofTileMat = () => M('rooftile', () => std({ vertexColors: true, map: roofTex(), roughness: 0.75, side: T.DoubleSide }));
    const metalMat = () => M('metal', () => std({ vertexColors: true, map: ribTex(), roughness: 0.45, metalness: 0.35, side: T.DoubleSide }));
    const facMat = (st, v) => M(`fac-${st}-${v}`, () => std({ map: facadeTex(st, v, FH), roughnessMap: facadeRough(st, v, FH), roughness: 1, metalness: 0.05 }));
    const buildings = desc.buildings.map(B => buildBuilding(B));
    function buildBuilding(B) {
      const S = STYLE[B.style] || STYLE.white;
      const grp = new T.Group();
      grp.position.set(B.x, 0, B.z);
      grp.rotation.y = -B.rot * DEG;
      grp.name = 'building-' + B.index;
      const shell = new T.Group(), inside = new T.Group();
      grp.add(shell, inside);
      const hw = B.w / 2, hd = B.d / 2, floors = B.floors, H = FH * floors;
      // พื้นกระเบื้อง
      const fl = new GB({ colors: false, world: 2.4 });
      fl.box(0, -0.06, 0, B.w + 0.1, 0.16, B.d + 0.1, 0);
      const floor = new T.Mesh(fl.build(), floorMat());
      floor.receiveShadow = true;
      grp.add(floor);
      // ผนังชั้นล่างตามแผนผัง
      const wb = new GB({ world: 1.6 }), gl2 = new GB({ colors: false });
      const IN = 0xeef0f2, CAP = 0x8f99a8, EXT = S.wall, TRIM = S.trim;
      B.walls.forEach(w => {
        const [x1, z1, x2, z2, t, ext] = w;
        wb.seg(x1, z1, x2, z2, t, 0, ext ? FH : WALL_H, ext ? EXT : IN, ext ? TRIM : CAP, t * 0.9);
      });
      B.openings.forEach(op => {
        const [x1, z1, x2, z2, t, win, ext] = op, top = ext ? FH : WALL_H, col = ext ? EXT : IN, cap = ext ? TRIM : CAP;
        if (win) {
          wb.seg(x1, z1, x2, z2, t, 0, 0.9, col, TRIM);
          wb.seg(x1, z1, x2, z2, t, 2.4, top, col, cap);
          wb.seg(x1, z1, x2, z2, t * 1.25, 0.86, 0.92, TRIM);
          gl2.seg(x1, z1, x2, z2, Math.max(0.03, t * 0.25), 0.92, 2.4);
          const Lw = Math.hypot(x2 - x1, z2 - z1), n = Math.max(1, Math.round(Lw / 1.2));
          for (let j = 1; j < n; j++) { const q = j / n; wb.box(x1 + (x2 - x1) * q, 1.66, z1 + (z2 - z1) * q, 0.06, 1.48, t * 0.5, -Math.atan2(z2 - z1, x2 - x1), TRIM); }
        } else {
          wb.seg(x1, z1, x2, z2, t, 2.15, top, col, cap);              // ทับหลังประตู
          if (ext) {
            // กันสาดหน้าทางเข้า + ขั้นบันได
            const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2, Lw = Math.hypot(x2 - x1, z2 - z1), ux = (x2 - x1) / (Lw || 1), uz = (z2 - z1) / (Lw || 1);
            let nx = -uz, nz = ux;
            if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
            const ang = -Math.atan2(uz, ux);
            if (Lw > 1.4 && Lw < 3) {                                   // ประตูหลัก (ช่องทางเดินโล่งกว้างกว่านี้ ไม่ใส่กันสาด)
              wb.box(mx + nx * 1.0, 2.75, mz + nz * 1.0, Lw + 1.4, 0.16, 2.1, ang, TRIM);
              for (const sd of [-1, 1]) wb.box(mx + nx * 1.9 + ux * sd * (Lw / 2 + 0.5), 1.35, mz + nz * 1.9 + uz * sd * (Lw / 2 + 0.5), 0.18, 2.7, 0.18, ang, TRIM);
            }
            wb.box(mx + nx * 0.45, 0.02, mz + nz * 0.45, Lw + (Lw < 3 ? 0.6 : 0.05), 0.12, 0.8, ang, 0xc9c4b8);
          }
        }
      });
      const walls = mesh(wb.build(), wallMat());
      walls.name = 'walls';
      grp.add(walls);
      if (!gl2.empty) { const gm = new T.Mesh(gl2.build(), glassMat(B.style)); gm.renderOrder = 2; grp.add(gm); }

      // ---- ชั้นบน + หลังคา (ซ่อนเมื่อมองเข้าไปข้างใน) ----
      const sb = new GB({ world: 2 });
      sb.box(0, WALL_H + (FH - WALL_H) / 2, 0, B.w - 0.02, FH - WALL_H, B.d - 0.02, 0, 0xe2e5ea, TRIM);  // เพดานชั้นล่าง / พื้นชั้น 2
      for (let f = 1; f <= floors; f++) sb.box(0, FH * f - 0.11, 0, B.w + 0.32, 0.22, B.d + 0.32, 0, TRIM);   // แถบพื้นแต่ละชั้น
      if (floors > 1) {
        const fronts = { win: new GB({ colors: false }), cor: new GB({ colors: false }) };
        const corrSide = B.corridor === 'front' ? 1 : 0;
        const side = (ax, az, bx, bz, nrm, variant) => {
          const len = Math.hypot(bx - ax, bz - az), bays = Math.max(1, Math.round(len / 3.8)), y0 = FH, y1 = H, fl2 = floors - 1;
          fronts[variant].quadUV([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [0, 0], [bays, 0], [bays, fl2], [0, fl2], nrm);
        };
        side(-hw, hd, hw, hd, [0, 0, 1], corrSide ? 'cor' : 'win');          // ด้านหน้า (+z)
        side(hw, -hd, -hw, -hd, [0, 0, -1], 'win');
        side(hw, hd, hw, -hd, [1, 0, 0], 'win');
        side(-hw, -hd, -hw, hd, [-1, 0, 0], 'win');
        for (const v of ['win', 'cor']) if (!fronts[v].empty) shell.add(mesh(fronts[v].build(), facMat(B.style, v === 'cor' ? 'corridor' : 'window')));
      }
      // หลังคา
      const rb = new GB({ world: 1.4 }), roofCol = S.roof;
      let roofMesh = null, roofTop = H;
      if (B.roof === 'flat') {
        sb.box(0, H + 0.1, 0, B.w, 0.2, B.d, 0, 0x9aa3ad, 0x9aa3ad);
        const t = 0.2, ph = 0.95;
        sb.box(0, H + ph / 2, -hd + t / 2, B.w, ph, t, 0, EXT, TRIM).box(0, H + ph / 2, hd - t / 2, B.w, ph, t, 0, EXT, TRIM)
          .box(-hw + t / 2, H + ph / 2, 0, t, ph, B.d, 0, EXT, TRIM).box(hw - t / 2, H + ph / 2, 0, t, ph, B.d, 0, EXT, TRIM);
        if (B.w > 10 && B.d > 6) {
          sb.box(-hw + 3, H + 1.4, -hd + 2.4, 3.2, 2.8, 3.2, 0, EXT, TRIM);                  // ห้องบันไดบนดาดฟ้า
          for (const dx of [0, 1.6]) sb.geo(cylGeo(), hw - 3 - dx, H + 1.25, -hd + 2, 0, 0.7, 1.3, 0.7, 0x2b6cb0);   // ถังน้ำ
          sb.box(hw - 3.8, H + 0.35, -hd + 2, 3.6, 0.3, 1.4, 0, 0x6b7280);
          for (let i = 0; i < Math.min(6, Math.floor(B.w / 8)); i++) sb.box(-hw + 8 + i * 4.5, H + 0.45, hd - 1.6, 1, 0.7, 0.7, 0, 0xd1d5db);   // คอมเพรสเซอร์แอร์
        }
        roofTop = H + 2.8;
      } else if (B.roof === 'dome') {
        const r = hd + 0.4, len = B.w + 0.8, ky = Math.min(0.6, 9 / r);
        const vault = new T.CylinderGeometry(r, r, len, 36, 1, true, 0, Math.PI);
        vault.rotateZ(Math.PI / 2);
        vault.scale(1, ky, 1);
        rb.geo(vault, 0, H, 0, 0, 1, 1, 1, 0xdfe5ec);
        vault.dispose();
        const cap = new T.CircleGeometry(r, 36, 0, Math.PI);
        cap.scale(1, ky, 1);
        for (const s of [-1, 1]) { const g2 = cap.clone(); g2.rotateY(s * Math.PI / 2); rb.geo(g2, s * len / 2, H, 0, 0, 1, 1, 1, shade(EXT, -0.05)); g2.dispose(); }
        cap.dispose();
        roofMesh = mesh(rb.build(), metalMat());
        roofTop = H + r * ky;
      } else {
        const ov = 0.8, rise = Math.max(1.6, Math.min(B.w, B.d) * 0.3);
        const W2 = hw + ov, D2 = hd + ov, yy = H;
        if (B.roof === 'gable') {
          const alongX = B.w >= B.d;
          if (alongX) {
            rb.quad([-W2, yy, D2], [W2, yy, D2], [W2, yy + rise, 0], [-W2, yy + rise, 0], [0, 1, 1], roofCol);
            rb.quad([W2, yy, -D2], [-W2, yy, -D2], [-W2, yy + rise, 0], [W2, yy + rise, 0], [0, 1, -1], roofCol);
            for (const s of [-1, 1]) sb.tri([s * hw, yy, -hd], [s * hw, yy, hd], [s * hw, yy + rise, 0], [s, 0, 0], EXT);
          } else {
            rb.quad([W2, yy, -D2], [W2, yy, D2], [0, yy + rise, D2], [0, yy + rise, -D2], [1, 1, 0], roofCol);
            rb.quad([-W2, yy, D2], [-W2, yy, -D2], [0, yy + rise, -D2], [0, yy + rise, D2], [-1, 1, 0], roofCol);
            for (const s of [-1, 1]) sb.tri([-hw, yy, s * hd], [hw, yy, s * hd], [0, yy + rise, s * hd], [0, 0, s], EXT);
          }
        } else {
          // ปั้นหยา: สันหลังคาตามด้านยาว ปลายลาดลง 4 ด้าน
          if (B.w >= B.d) {
            const r = Math.max(0, W2 - D2);
            const A = [-r, yy + rise, 0], Bp = [r, yy + rise, 0];
            rb.quad([-W2, yy, D2], [W2, yy, D2], Bp, A, [0, 1, 1], roofCol);
            rb.quad([W2, yy, -D2], [-W2, yy, -D2], A, Bp, [0, 1, -1], roofCol);
            rb.tri([W2, yy, D2], [W2, yy, -D2], Bp, [1, 1, 0], roofCol);
            rb.tri([-W2, yy, -D2], [-W2, yy, D2], A, [-1, 1, 0], roofCol);
          } else {
            const r = Math.max(0, D2 - W2);
            const A = [0, yy + rise, -r], Bp = [0, yy + rise, r];
            rb.quad([W2, yy, -D2], [W2, yy, D2], Bp, A, [1, 1, 0], roofCol);
            rb.quad([-W2, yy, D2], [-W2, yy, -D2], A, Bp, [-1, 1, 0], roofCol);
            rb.tri([-W2, yy, D2], [W2, yy, D2], Bp, [0, 1, 1], roofCol);
            rb.tri([W2, yy, -D2], [-W2, yy, -D2], A, [0, 1, -1], roofCol);
          }
        }
        // ฝ้าชายคา (ใต้หลังคา) ไม่ให้เห็นโปร่งจากด้านล่าง
        sb.box(0, yy + 0.02, 0, B.w + 2 * ov, 0.04, B.d + 2 * ov, 0, shade(TRIM, 0.3), shade(roofCol, -0.2));
        roofMesh = mesh(rb.build(), roofTileMat());
        roofTop = yy + rise;
      }
      if (roofMesh) shell.add(roofMesh);
      shell.add(mesh(sb.build(), wallMat()));
      // ป้ายชื่ออาคาร (ขนาดคงที่บนจอ): ไกล = เลขอาคาร, ใกล้ = เลข + ชื่อ
      let sign = null, badge = null;
      sign = textSprite([B.name], { num: B.num, color: B.color, attenuate: false });
      sign.scale.set(0.15, 0.035, 1);
      sign.position.set(0, roofTop + 4, 0);
      grp.add(sign);
      if (B.num) {
        badge = badgeSprite(B.num, B.color);
        badge.scale.set(0.034, 0.034, 1);
        badge.position.set(0, roofTop + 4, 0);
        grp.add(badge);
      }
      return { B, grp, shell, inside, sign, badge, labels: null, cut: false, roofTop };
    }
    buildings.forEach(b => root.add(b.grp));

    /* ------------------------------ วัตถุประกอบฉาก ------------------------------ */
    const DUMMY = new T.Object3D();
    function instanced(list, parts, opt) {
      if (!list.length) return;
      const op = opt || {};
      parts.forEach(({ geo, mat, shadow }) => {
        const im = new T.InstancedMesh(geo, mat, list.length);
        im.frustumCulled = false;                // r128: ขอบเขตคำนวณจากต้นแบบที่จุดกำเนิด ทำให้หายตอนมองไกลได้
        if (shadow !== false) { im.castShadow = true; im.receiveShadow = true; }
        const r = rand(op.seed || 7), col = new T.Color();
        list.forEach((p, i) => {
          const s = (p.s || 1) * (op.vary ? 0.85 + r() * 0.35 : 1);
          DUMMY.position.set(p.x, p.y || 0, p.z);
          DUMMY.rotation.set(0, p.ry !== undefined ? p.ry : -(p.rot || 0) * DEG, 0);
          DUMMY.scale.set(op.sx ? s * op.sx(p) : s, s, s);
          DUMMY.updateMatrix();
          im.setMatrixAt(i, DUMMY.matrix);
          if (op.tint) { op.tint(col, p, r); im.setColorAt(i, col); }
        });
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        root.add(im);
      });
    }
    const byType = {};
    desc.props.forEach(p => (byType[p.t] = byType[p.t] || []).push(p));
    const VC = p => shared(std(Object.assign({ vertexColors: true, roughness: 0.8 }, p || {})));
    const ico = (r, det) => new T.IcosahedronGeometry(r, det === undefined ? 1 : det);
    // ทรงพุ่มไม่เรียบ: ขยับจุดตามตำแหน่ง (จุดซ้ำกันขยับเท่ากัน ผิวไม่แตก)
    function lumpy(geo, amt) {
      const P = geo.attributes.position;
      for (let i = 0; i < P.count; i++) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i), f = 1 + (hash(x * 3.1, y * 3.1, z * 3.1) - 0.5) * amt;
        P.setXYZ(i, x * f, y * f, z * f);
      }
      geo.computeVertexNormals();
      return geo;
    }
    const PROTO = {
      tree() {
        const gb = new GB({});
        gb.geo(cylGeo(), 0, 1.6, 0, 0, 0.3, 3.2, 0.3, 0x6b4a2f);
        [[0, 4.6, 0, 2.5, 0x3f7a34], [1.3, 4.0, 0.6, 1.8, 0x4b8a3c], [-1.1, 4.1, -0.7, 1.9, 0x37702e], [0.2, 5.6, -0.3, 1.7, 0x4f9142]].forEach(([x, y, z, r, c]) => gb.geo(lumpy(ico(r), 0.35), x, y, z, 0, 1, 0.85, 1, c));
        return [{ geo: gb.build(), mat: VC({ roughness: 0.9 }) }];
      },
      pine() {
        const gb = new GB({});
        gb.geo(cylGeo(), 0, 1.0, 0, 0, 0.22, 2, 0.22, 0x5b3d26);
        [[2.0, 2.8, 1.8], [1.6, 2.5, 3.4], [1.1, 2.2, 4.8]].forEach(([r, h, y], i) => gb.geo(new T.ConeGeometry(r, h, 9), 0, y + h / 2 - 0.3, 0, i * 0.4, 1, 1, 1, [0x2f5d2a, 0x356a2f, 0x3c7534][i]));
        return [{ geo: gb.build(), mat: VC({ roughness: 0.9 }) }];
      },
      palm() {
        const gb = new GB({});
        for (let i = 0; i < 7; i++) gb.geo(cylGeo(), Math.sin(i * 0.22) * 0.35, 0.5 + i, 0, 0, 0.2 - i * 0.012, 1.05, 0.2 - i * 0.012, i % 2 ? 0x8a6d4b : 0x7b5f40);
        const top = new T.Vector3(Math.sin(1.5) * 0.35, 7.2, 0);
        for (let i = 0; i < 9; i++) {
          const a = i / 9 * Math.PI * 2, leaf = new T.ConeGeometry(0.45, 3.6, 4);
          leaf.scale(1, 1, 0.18);
          leaf.translate(0, 1.8, 0);
          leaf.rotateZ(-1.05 - (i % 3) * 0.15);
          gb.geo(leaf, top.x, top.y, top.z, a, 1, 1, 1, i % 2 ? 0x4d8a2c : 0x5b9a35);
          leaf.dispose();
        }
        for (let i = 0; i < 3; i++) gb.geo(ico(0.2, 0), top.x + Math.cos(i * 2.1) * 0.3, top.y - 0.3, Math.sin(i * 2.1) * 0.3, 0, 1, 1, 1, 0x6b5a2a);
        return [{ geo: gb.build(), mat: VC({ roughness: 0.85, side: T.DoubleSide }) }];
      },
      bush() {
        const gb = new GB({});
        gb.geo(lumpy(ico(1.1), 0.3), 0, 0.6, 0, 0, 1, 0.7, 1, 0x3f7a2e).geo(lumpy(ico(0.8), 0.3), 0.6, 0.55, 0.3, 0, 1, 0.75, 1, 0x4d8b37);
        return [{ geo: gb.build(), mat: VC({ roughness: 0.95 }) }];
      },
      lamp() {
        const gb = new GB({}), head = new GB({ colors: false });
        gb.geo(cylGeo(), 0, 4, 0, 0, 0.11, 8, 0.11, 0x8d96a0).box(0, 0.3, 0, 0.4, 0.6, 0.4, 0, 0x9ca3af);
        gb.box(0, 7.9, -0.9, 0.08, 0.08, 1.8, 0, 0x8d96a0).box(0, 7.85, -1.85, 0.36, 0.14, 0.7, 0, 0x6b7280);
        head.box(0, 7.76, -1.85, 0.3, 0.05, 0.62, 0);
        return [{ geo: gb.build(), mat: VC({ roughness: 0.5, metalness: 0.4 }) }, { geo: head.build(), mat: shared(new T.MeshBasicMaterial({ color: 0xfff3c4 })), shadow: false }];
      },
      sala() {
        const gb = new GB({}), roof = new GB({ world: 1 });
        gb.box(0, 0.25, 0, 5.4, 0.5, 5.4, 0, 0xd6d0c4, 0xc9b79a);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) gb.box(sx * 2.2, 1.85, sz * 2.2, 0.22, 2.7, 0.22, 0, 0x8a3b2a);
        gb.box(0, 3.2, 0, 5.0, 0.2, 5.0, 0, 0x8a3b2a);
        for (const [sx, sz, len, rot] of [[0, -2.2, 4.4, 0], [0, 2.2, 4.4, 0], [-2.2, 0, 4.4, Math.PI / 2], [2.2, 0, 4.4, Math.PI / 2]]) gb.box(sx, 0.95, sz, len, 0.08, 0.08, rot, 0x8a3b2a);
        const hip = (w, y, rise, col) => { const h2 = w / 2, top = [0, y + rise, 0]; [[[-h2, y, h2], [h2, y, h2], [0, 0.5, 1]], [[h2, y, -h2], [-h2, y, -h2], [0, 0.5, -1]], [[h2, y, h2], [h2, y, -h2], [1, 0.5, 0]], [[-h2, y, -h2], [-h2, y, h2], [-1, 0.5, 0]]].forEach(([a, b, n]) => roof.tri(a, b, top, n, col)); };
        hip(6.6, 3.25, 1.1, 0xb3462e);
        hip(4.4, 3.95, 2.4, 0xc0502f);
        gb.geo(new T.ConeGeometry(0.12, 1.3, 6), 0, 6.9, 0, 0, 1, 1, 1, 0xd4a72c);
        return [{ geo: gb.build(), mat: VC({ roughness: 0.7 }) }, { geo: roof.build(), mat: VC({ map: roofTex(), roughness: 0.7, side: T.DoubleSide }) }];
      },
      tower() {
        const gb = new GB({});
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) gb.box(sx * 1.6, 7, sz * 1.6, 0.22, 14, 0.22, 0, 0x6b7280);
        for (const y of [3, 7, 11]) {
          for (const [x, z, rot] of [[0, -1.6, 0], [0, 1.6, 0], [-1.6, 0, Math.PI / 2], [1.6, 0, Math.PI / 2]]) gb.box(x, y, z, 3.2, 0.12, 0.12, rot, 0x6b7280);
          for (const [x, z, rot] of [[0, -1.6, 0], [0, 1.6, 0], [-1.6, 0, Math.PI / 2], [1.6, 0, Math.PI / 2]]) {
            const brace = new T.BoxGeometry(4.5, 0.08, 0.08); brace.rotateZ(Math.PI / 4.4);
            gb.geo(brace, x, y + 2, z, rot, 1, 1, 1, 0x7b8490); brace.dispose();
          }
        }
        gb.box(0, 14.1, 0, 4.4, 0.25, 4.4, 0, 0x9ca3af);
        gb.geo(cylGeo(), 0, 16, 0, 0, 2.6, 3.6, 2.6, 0xd7dde4);
        gb.geo(new T.ConeGeometry(2.75, 1.1, 24), 0, 18.35, 0, 0, 1, 1, 1, 0x9aa5b1);
        gb.geo(cylGeo(), 0, 16, 0, 0, 2.66, 0.25, 2.66, 0x2563eb);
        return [{ geo: gb.build(), mat: VC({ roughness: 0.55, metalness: 0.3 }) }];
      },
      guard() {
        const gb = new GB({}), gl3 = new GB({ colors: false });
        gb.box(0, 0.5, 0, 2.6, 1.0, 2.6, 0, 0xe9ebee).box(0, 2.6, 0, 2.6, 0.5, 2.6, 0, 0xe9ebee, 0x9aa3ad);
        for (const [x, z] of [[-1.25, -1.25], [1.25, -1.25], [-1.25, 1.25], [1.25, 1.25]]) gb.box(x, 1.6, z, 0.12, 1.2, 0.12, 0, 0xe9ebee);
        gl3.box(0, 1.6, 0, 2.5, 1.18, 2.5, 0);
        gb.box(0, 2.95, 0, 3.4, 0.16, 3.4, 0, 0x1e3a8a);
        return [{ geo: gb.build(), mat: VC() }, { geo: gl3.build(), mat: glassMat('blue') }];
      },
      toilet() {
        const gb = new GB({}), roof = new GB({ world: 1 });
        gb.box(0, 1.5, 0, 7, 3, 4, 0, 0xeee4cf, 0xd7cdb8);
        for (let i = 0; i < 5; i++) gb.box(-2.6 + i * 1.3, 2.55, 2.01, 0.8, 0.35, 0.04, 0, 0x475569);
        for (const x of [-1.8, 1.8]) gb.box(x, 1.05, 2.01, 0.9, 2.1, 0.05, 0, 0x7c4a2c);
        roof.quad([-4, 3, 2.6], [4, 3, 2.6], [4, 4.3, 0], [-4, 4.3, 0], [0, 1, 1], 0xa5452c).quad([4, 3, -2.6], [-4, 3, -2.6], [-4, 4.3, 0], [4, 4.3, 0], [0, 1, -1], 0xa5452c);
        for (const s of [-1, 1]) gb.tri([s * 3.5, 3, -2], [s * 3.5, 3, 2], [s * 3.5, 4.3, 0], [s, 0, 0], 0xeee4cf);
        return [{ geo: gb.build(), mat: VC() }, { geo: roof.build(), mat: VC({ map: roofTex(), side: T.DoubleSide }) }];
      },
      statue() {
        const gb = new GB({});
        gb.box(0, 0.25, 0, 4, 0.5, 4, 0, 0xd6d3cc).box(0, 0.75, 0, 3, 0.5, 3, 0, 0xe7e5e1).box(0, 1.4, 0, 1.8, 0.8, 1.6, 0, 0xc9b27a);
        gb.geo(ico(0.75, 1), 0, 2.35, 0, 0, 1.05, 0.85, 0.8, 0x4a3a28).geo(ico(0.45, 1), 0, 3.25, 0, 0, 1, 1.15, 1, 0x4a3a28).geo(ico(0.28, 1), 0, 3.85, 0, 0, 1, 1, 1, 0x4a3a28);
        gb.geo(new T.ConeGeometry(0.1, 0.4, 6), 0, 4.25, 0, 0, 1, 1, 1, 0xc9a227);
        return [{ geo: gb.build(), mat: VC({ roughness: 0.5, metalness: 0.4 }) }];
      },
      bench() {
        const gb = new GB({});
        gb.box(0, 0.45, 0, 1.8, 0.07, 0.45, 0, 0x9a6b3f).box(0, 0.75, -0.2, 1.8, 0.35, 0.05, 0, 0x9a6b3f);
        for (const x of [-0.75, 0.75]) gb.box(x, 0.22, 0, 0.1, 0.45, 0.42, 0, 0x6b7280);
        return [{ geo: gb.build(), mat: VC() }];
      },
      car() {
        const gb = new GB({});
        gb.box(0, 0.6, 0, 4.3, 0.7, 1.8, 0, 0xffffff).box(-0.25, 1.18, 0, 2.3, 0.55, 1.62, 0, 0x2b3440);
        gb.box(0, 0.32, 0, 4.4, 0.12, 1.84, 0, 0x2d2d2d);
        for (const x of [-1.35, 1.35]) for (const z of [-0.86, 0.86]) gb.geo(cylGeoX(), x, 0.34, z, 0, 0.34, 0.34, 0.24, 0x16181b);
        gb.box(2.16, 0.7, 0.6, 0.04, 0.14, 0.3, 0, 0xfff7d6).box(2.16, 0.7, -0.6, 0.04, 0.14, 0.3, 0, 0xfff7d6);
        return [{ geo: gb.build(), mat: VC({ roughness: 0.35, metalness: 0.4 }) }];
      },
      bus() {
        const gb = new GB({});
        gb.box(0, 1.65, 0, 11, 2.5, 2.5, 0, 0xffffff, 0xd1d5db).box(0, 2.1, 0, 10.2, 0.85, 2.52, 0, 0x2b3440);
        gb.box(0, 0.8, 0, 11.02, 0.25, 2.52, 0, 0xf97316);
        for (const x of [-3.6, 3.4]) for (const z of [-1.15, 1.15]) gb.geo(cylGeoX(), x, 0.5, z, 0, 0.5, 0.5, 0.3, 0x16181b);
        return [{ geo: gb.build(), mat: VC({ roughness: 0.4, metalness: 0.3 }) }];
      }
    };
    const PALETTE = [0xe5e7eb, 0x1f2937, 0xb91c1c, 0x9ca3af, 0x1d4ed8, 0xf8fafc, 0x7c2d12, 0x065f46];
    const treeTint = (col, p, r) => col.setHSL(0, 0, 0.85 + r() * 0.3);
    for (const [t, list] of Object.entries(byType)) {
      if (!PROTO[t]) continue;
      const items = list.map(p => Object.assign({}, p, { ry: p.t === 'lamp' ? -p.rot * DEG : undefined }));
      instanced(items, PROTO[t](), {
        seed: t.length * 13,
        vary: ['tree', 'pine', 'palm', 'bush'].includes(t),
        tint: t === 'car' || t === 'bus' ? (col, p, r) => col.setHex(t === 'bus' ? 0xfde68a : PALETTE[Math.floor(r() * PALETTE.length)]) : (['tree', 'pine', 'bush'].includes(t) ? treeTint : null)
      });
    }
    // โรงจอดรถ (ยาวตามขนาด) และซุ้มประตู (ป้ายชื่อ) สร้างทีละชิ้น
    (byType.shelter || []).forEach(p => {
      const len = 12 * (p.s || 1), gb = new GB({}), grp = new T.Group();
      grp.position.set(p.x, 0, p.z); grp.rotation.y = -(p.rot || 0) * DEG;
      const n = Math.max(2, Math.round(len / 4));
      for (let i = 0; i <= n; i++) { const x = -len / 2 + len * i / n; gb.box(x, 1.4, -2.6, 0.14, 2.8, 0.14, 0, 0x6b7280).box(x, 1.25, 2.6, 0.14, 2.5, 0.14, 0, 0x6b7280); }
      const rf = new T.BoxGeometry(len + 0.6, 0.08, 6.4);
      rf.rotateX(-0.05);
      const rr = new GB({});
      rr.geo(rf, 0, 2.75, 0, 0, 1, 1, 1, 0x2f855a); rf.dispose();
      const mr = rand(Math.round(p.x * 7 + p.z));
      for (let x = -len / 2 + 0.8; x < len / 2 - 0.4; x += 0.9) if (mr() < 0.7) gb.box(x, 0.5, 0.6 + (mr() - 0.5) * 0.6, 0.35, 0.75, 1.75, 0, [0x111827, 0xb91c1c, 0x1d4ed8, 0x374151][Math.floor(mr() * 4)]);
      grp.add(mesh(gb.build(), VC({ roughness: 0.6 })));
      const rm = mesh(rr.build(), VC({ map: ribTex(), roughness: 0.5, metalness: 0.3, side: T.DoubleSide }));
      grp.add(rm);
      root.add(grp);
    });
    (byType.gate || []).forEach(p => {
      const s = p.s || 1, w = 12 * s, gb = new GB({}), grp = new T.Group();
      grp.position.set(p.x, 0, p.z); grp.rotation.y = -(p.rot || 0) * DEG;
      for (const sd of [-1, 1]) gb.box(sd * (w / 2 + 0.6), 2.6, 0, 1.2, 5.2, 1.2, 0, 0xf1f0ec, 0xc9a227).box(sd * (w / 2 + 0.6), 5.35, 0, 1.5, 0.3, 1.5, 0, 0xc9a227);
      gb.box(0, 5.0, 0, w + 2.4, 0.9, 0.9, 0, 0xf1f0ec, 0xc9a227);
      grp.add(mesh(gb.build(), VC({ roughness: 0.6 })));
      const tex = signTex(desc.name || 'วิทยาลัย');
      for (const sd of [-1, 1]) {
        const pg = new T.PlaneGeometry(w, 0.75);
        const pl = new T.Mesh(pg, new T.MeshBasicMaterial({ map: tex }));
        pl.position.set(0, 5.0, sd * 0.46);
        if (sd < 0) pl.rotation.y = Math.PI;
        grp.add(pl);
      }
      root.add(grp);
    });
    // เสาธงชาติ (ธงโบก)
    (byType.flag || []).forEach(p => {
      const grp = new T.Group(), gb = new GB({});
      grp.position.set(p.x, 0, p.z);
      gb.box(0, 0.2, 0, 3.6, 0.4, 3.6, 0, 0xd6d3cc).box(0, 0.55, 0, 2.4, 0.3, 2.4, 0, 0xe7e5e1);
      gb.geo(cylGeo(), 0, 7, 0, 0, 0.09, 13, 0.09, 0xf5f5f4).geo(ico(0.2, 1), 0, 13.6, 0, 0, 1, 1, 1, 0xd4a72c);
      grp.add(mesh(gb.build(), VC({ roughness: 0.4, metalness: 0.3 })));
      const fg = new T.PlaneGeometry(3.6, 2.4, 16, 1);
      fg.translate(1.8, 12.1, 0);
      const base = Float32Array.from(fg.attributes.position.array);
      const flag = new T.Mesh(fg, new T.MeshStandardMaterial({ map: new T.CanvasTexture(flagCanvas()), side: T.DoubleSide, roughness: 0.8 }));
      flag.castShadow = true;
      grp.add(flag);
      root.add(grp);
      hooks.push(now => {
        const P = fg.attributes.position, t = now / 400;
        for (let i = 0; i < P.count; i++) { const x = base[i * 3]; P.setZ(i, Math.sin(x * 1.6 - t) * 0.16 * (x / 3.6)); }
        P.needsUpdate = true;
      });
    });

    /* ------------------------------ เสาไฟฟ้า + สายไฟ ------------------------------ */
    const poleList = [];
    desc.poles.forEach(line => {
      const pts = line.pts;
      pts.forEach((p, i) => {
        const a = pts[i - 1] || p, b = pts[i + 1] || p;
        let dx = b.x - a.x, dz = b.z - a.z;
        if (!dx && !dz) dx = 1;
        poleList.push({ x: p.x, z: p.z, h: p.h || 9, ry: Math.atan2(-dx, -dz), dx, dz });
      });
    });
    if (poleList.length) {
      const gb = new GB({});
      gb.geo(new T.CylinderGeometry(0.11, 0.17, 9, 10), 0, 4.5, 0, 0, 1, 1, 1, 0xb8b6ae);
      gb.box(0, 8.55, 0, 2.5, 0.13, 0.13, 0, 0x8a8a84).box(0, 7.85, 0, 1.6, 0.11, 0.11, 0, 0x8a8a84);
      for (const x of [-1.05, 0, 1.05]) gb.geo(cylGeo(), x, 8.72, 0, 0, 0.06, 0.22, 0.06, 0xd9e5d6);
      for (const x of [-0.65, 0.65]) gb.geo(cylGeo(), x, 8.0, 0, 0, 0.05, 0.18, 0.05, 0xd9e5d6);
      gb.box(0, POLE_Y, 0.16, 0.28, 0.32, 0.12, 0, 0x374151);         // กล่องพักสายสื่อสาร
      const items = poleList.map(p => ({ x: p.x, z: p.z, ry: p.ry, s: 1 }));
      instanced(items, [{ geo: gb.build(), mat: VC({ roughness: 0.75 }) }], {});
      // สายไฟ 3 เส้น + สายสื่อสาร 1 เส้น ห้อยโค้งระหว่างเสา
      const wires = [], tel = [];
      let pi = 0;
      desc.poles.forEach(line => {
        const n = line.pts.length;
        for (let i = 0; i < n - 1; i++) {
          const A = poleList[pi + i], B2 = poleList[pi + i + 1], span2 = Math.hypot(B2.x - A.x, B2.z - A.z);
          const armA = [Math.cos(A.ry), -Math.sin(A.ry)], armB = [Math.cos(B2.ry), -Math.sin(B2.ry)];
          const run = (list, offA, offB, y, sag) => {
            const segs = 10;
            for (let j = 0; j < segs; j++) {
              const t1 = j / segs, t2 = (j + 1) / segs;
              const P1 = [A.x + armA[0] * offA + (B2.x + armB[0] * offB - A.x - armA[0] * offA) * t1, y - sag * 4 * t1 * (1 - t1), A.z + armA[1] * offA + (B2.z + armB[1] * offB - A.z - armA[1] * offA) * t1];
              const P2 = [A.x + armA[0] * offA + (B2.x + armB[0] * offB - A.x - armA[0] * offA) * t2, y - sag * 4 * t2 * (1 - t2), A.z + armA[1] * offA + (B2.z + armB[1] * offB - A.z - armA[1] * offA) * t2];
              list.push(...P1, ...P2);
            }
          };
          for (const off of [-1.05, 0, 1.05]) run(wires, off, off, 8.83, Math.min(1.1, span2 * 0.022));
          run(tel, 0, 0, POLE_Y, Math.min(1.3, span2 * 0.026));
        }
        pi += n;
      });
      const lineGeo = arr => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(arr, 3)); return g; };
      if (wires.length) root.add(new T.LineSegments(lineGeo(wires), new T.LineBasicMaterial({ color: 0x1f2328 })));
      if (tel.length) root.add(new T.LineSegments(lineGeo(tel), new T.LineBasicMaterial({ color: 0x3f4650 })));
    }

    /* ------------------------------ เปิดหลังคามองห้อง ------------------------------ */
    let cutMode = 'auto', walking = false, highlight = null;
    function setCut(b, on) {
      if (b.cut === on) return;
      b.cut = on;
      b.shell.visible = !on;
      if (on && !b.labels && o.roomLabel) {
        b.labels = new T.Group();
        b.B.rooms.forEach(r => {
          if (r.hidden || r.corridor) return;
          const s = o.roomLabel(r.name, r.color);
          s.position.set(r.lx, WALL_H + 0.55, r.lz);
          b.labels.add(s);
        });
        b.inside.add(b.labels);
      }
      if (b.labels) b.labels.visible = on;
    }
    function update(now, camera, target) {
      hooks.forEach(fn => fn(now));
      if (!camera || !target) return;
      const dist = camera.position.distanceTo(target);
      let focus = null;
      if (!walking && cutMode === 'auto' && dist < 160) {
        let best = Infinity;
        buildings.forEach(b => {
          const B = b.B, dx = target.x - B.x, dz = target.z - B.z;
          const lx = B.cos * dx + B.sin * dz, lz = -B.sin * dx + B.cos * dz;
          const ex = Math.max(0, Math.abs(lx) - B.w / 2), ez = Math.max(0, Math.abs(lz) - B.d / 2), d = Math.hypot(ex, ez);
          if (d < 12 && d < best && dist < Math.max(55, Math.max(B.w, B.d) * 1.5)) { best = d; focus = b; }
        });
      }
      buildings.forEach(b => setCut(b, !walking && (cutMode === 'all' || b === focus)));
      // ป้ายอาคาร: มองไกลเห็นแค่เลขอาคาร (ไม่รก) เข้าใกล้จึงเห็นชื่อเต็ม
      const cp = camera.position;
      buildings.forEach(b => {
        const d = Math.hypot(cp.x - b.B.x, cp.y - b.roofTop, cp.z - b.B.z), near = d < (b.B.num ? 340 : 150);
        if (b.sign) b.sign.visible = !b.cut && near && !walking;
        if (b.badge) b.badge.visible = !b.cut && !near && !walking;
      });
    }
    function setHighlight(zone) {
      if (highlight) { highlight.parent && highlight.parent.remove(highlight); highlight.geometry.dispose(); highlight.material.dispose(); highlight = null; }
      if (!zone || zone.building === undefined) return;
      const b = buildings[zone.building];
      if (!b) return;
      const B = b.B, ri = B.roomZone.indexOf(desc.zones.indexOf(zone));
      const room = ri >= 0 ? B.plan.rooms[ri] : null;
      if (!room) return;
      const x0 = (room.bbox.x0 - B.pw / 2) * B.pk, x1 = (room.bbox.x1 - B.pw / 2) * B.pk, z0 = (room.bbox.y0 - B.ph / 2) * B.pk, z1 = (room.bbox.y1 - B.ph / 2) * B.pk;
      const g = new T.PlaneGeometry(Math.max(0.5, x1 - x0), Math.max(0.5, z1 - z0));
      g.rotateX(-Math.PI / 2);
      highlight = new T.Mesh(g, new T.MeshBasicMaterial({ color: zone.color || 0x22d3ee, transparent: true, opacity: 0.22, depthWrite: false }));
      highlight.position.set((x0 + x1) / 2, 0.03, (z0 + z1) / 2);
      highlight.renderOrder = 3;
      b.inside.add(highlight);
    }
    const poles = poleList.map(p => ({ x: p.x, z: p.z, ry: p.ry }));
    return {
      group: root, buildings, poles, FH, POLE_Y,
      update,
      setCutaway(m) { cutMode = m; },
      cutaway: () => cutMode,
      setWalking(on) { walking = !!on; },
      setHighlight,
      waterMat: () => waterMat
    };
  }
  // ทรงกระบอกหนึ่งหน่วย (สูง 1 รัศมี 1) ใช้ซ้ำ — ย่อขยายด้วย scale
  let _cyl = null, _cylX = null;
  function cylGeo() { return _cyl || (_cyl = new window.THREE.CylinderGeometry(1, 1, 1, 10)); }
  function cylGeoX() { if (!_cylX) { _cylX = new window.THREE.CylinderGeometry(1, 1, 1, 12); _cylX.rotateX(Math.PI / 2); } return _cylX; }

  window.SiteRender = { build, POLE_Y, STYLE };
})();
