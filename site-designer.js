/* ==========================================================================
   SimuCore — ออกแบบผังบริเวณ (อยู่ในหน้าต่างสแกนแผนผัง ขั้นที่ 3 ของโหมด "ผังบริเวณ")
   วางบนภาพแผนที่: อาคาร (ลาก/หมุน/ย่อขยาย กำหนดชั้น หลังคา ห้องภายใน) ถนน รั้ว
   ระบายพื้นที่ (หญ้า บ่อน้ำ ลาน) ต้นไม้และวัตถุ แนวเสาไฟฟ้า สนามกีฬา วัดระยะเทียบมาตราส่วน
   ข้อมูลเป็นพิกัดภาพแผนที่ (px) + เมตร/px — แปลงเป็นฉาก 3D ด้วย SiteModel.toScene()
   ========================================================================== */
(function () {
  'use strict';
  const SM = window.SiteModel;
  const DEG = Math.PI / 180;
  const PROPS = ['value', 'checked', 'disabled', 'hidden', 'title', 'type', 'min', 'max', 'step', 'placeholder', 'selected', 'maxLength'];
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (PROPS.includes(k)) e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    kids.flat(Infinity).forEach(c => { if (c !== null && c !== undefined && c !== false) e.append(c); });
    return e;
  }
  const icon = n => h('i', { class: 'fa-solid ' + n, 'aria-hidden': 'true' });
  const toast = (m, t, ms) => { if (window.UI) UI.toast(m, t, ms); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: d });
  const r1 = v => Math.round(v * 10) / 10;
  const segD = (x, y, x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1, t = clamp(((x - x1) * dx + (y - y1) * dy) / L, 0, 1); return Math.hypot(x - x1 - t * dx, y - y1 - t * dy); };
  const STYLE_COL = { white: '#e9ebee', cream: '#f0dfbd', brick: '#b07a62', gray: '#b3bcc7', blue: '#d3e3f3', wood: '#d1a77c' };
  const AREA_RGB = [null, [109, 154, 72], [83, 88, 95], [203, 197, 184], [46, 109, 148], [155, 120, 83], [217, 196, 149], [79, 130, 54]];
  const PROP_DRAW = { tree: '#2f7d32', pine: '#1f5f2f', palm: '#6aa834', bush: '#4d7c0f', lamp: '#fbbf24', sala: '#c2410c', flag: '#ef4444', tower: '#94a3b8', shelter: '#2f855a', car: '#dc2626', bus: '#f59e0b', bench: '#a16207', gate: '#64748b', guard: '#0ea5e9', statue: '#78716c', toilet: '#38bdf8' };
  // [id, ไอคอน, ชื่อสั้นบนปุ่ม, คีย์ลัด, ชื่อเต็ม]
  const TOOLS = [
    ['select', 'fa-arrow-pointer', 'เลือก', 'V', 'เลือก/ย้าย'], ['pan', 'fa-hand', 'เลื่อน', 'H', 'เลื่อนแผนที่'],
    ['building', 'fa-building', 'อาคาร', 'B', 'อาคาร'], ['road', 'fa-road', 'ถนน', 'R', 'ถนน'], ['area', 'fa-fill-drip', 'พื้นที่', 'A', 'ระบายพื้นที่ (หญ้า บ่อน้ำ ลาน)'],
    ['prop', 'fa-tree', 'ต้นไม้', 'T', 'ต้นไม้และวัตถุ'], ['pole', 'fa-bolt', 'เสาไฟ', 'P', 'แนวเสาไฟฟ้า'], ['field', 'fa-futbol', 'สนาม', 'F', 'สนามกีฬา'],
    ['fence', 'fa-grip-lines-vertical', 'รั้ว', 'L', 'รั้ว'], ['measure', 'fa-ruler', 'วัด', 'M', 'วัดระยะ / ตั้งมาตราส่วน']
  ];
  const HINT = {
    select: 'คลิกเลือกอาคาร ถนน ต้นไม้ เสาไฟ แล้วลากเพื่อย้าย · ลากมุมอาคารเพื่อย่อขยาย จุดด้านบนเพื่อหมุน · Delete = ลบ · [ ] = หมุน',
    pan: 'ลากเพื่อเลื่อนแผนที่ · ล้อเมาส์/สองนิ้ว = ซูม',
    building: 'ลากเป็นกรอบสี่เหลี่ยมทับอาคารในแผนที่ แล้วตั้งชื่อ จำนวนชั้น และห้องในแผงด้านขวา',
    road: 'คลิกทีละจุดตามแนวถนน · ดับเบิลคลิกหรือ Enter = จบเส้น · Backspace = ลบจุดล่าสุด',
    area: 'ระบายพื้นที่บนแผนที่ (ลากด้วยแปรง / ลากกรอบ / แตะเพื่อเติมตามสีในแผนที่)',
    prop: 'คลิกเพื่อวาง · เปิด "โรยต้นไม้" แล้วลากเพื่อปลูกเป็นแนว',
    pole: 'คลิกวางเสาไฟฟ้าทีละต้นตามแนวถนน (ห่างเกิน 45 ม. ระบบเติมเสาให้) · ดับเบิลคลิก/Enter = จบแนว — สายสื่อสารระหว่างอาคารจะพาดตามแนวนี้',
    field: 'ลากเป็นกรอบสนาม',
    fence: 'คลิกทีละจุดตามแนวรั้ว · ดับเบิลคลิกหรือ Enter = จบ',
    measure: 'คลิก 2 จุดที่รู้ระยะจริง (เช่น ความยาวอาคาร) แล้วใส่ระยะเพื่อตั้งมาตราส่วน'
  };

  const D = {
    root: null, el: {}, site: null, img: null, imgData: null, imgTaint: false, ground: null, gCanvas: null,
    view: { k: 1, ox: 0, oy: 0 }, dpr: 1, tool: 'select', sel: null, draft: null, drag: null, measure: null,
    history: [], onApply: null, onBack: null, onInterior: null, dirtyScale: false, pointers: new Map(), space: false,
    opts: { underlay: 0.8, area: 'water', areaMode: 'brush', brush: 6, tol: 38, prop: 'tree', scatter: false, roadW: 7, fieldT: 'football', floors: 3, style: 'white', roof: 'hip' }
  };

  /* =========================================================================
     โครงหน้า
     ========================================================================= */
  function mount(container, api) {
    D.root = container;
    D.onApply = api.onApply; D.onBack = api.onBack; D.onInterior = api.onInterior; D.onCancel = api.onCancel;
    const el = D.el;
    el.tools = h('div', { class: 'ps-toolbar sd-tools', role: 'toolbar', 'aria-label': 'เครื่องมือผังบริเวณ' },
      TOOLS.map(([id, ic, t, key, full]) => h('button', { class: 'ps-tool', type: 'button', 'data-sdtool': id, title: `${full} (${key})`, 'aria-label': full, onclick: () => setTool(id) }, icon(ic), h('span', { text: ' ' + t }))),
      h('span', { class: 'ps-toolbar__sp' }),
      h('button', { class: 'ps-tool', type: 'button', title: 'ย้อนกลับ (Ctrl+Z)', id: 'sdUndo', onclick: undo }, icon('fa-rotate-left'), h('span', { text: ' ย้อน' })),
      h('button', { class: 'ps-tool', type: 'button', title: 'ซูมออก', onclick: () => zoomAt(0.8) }, icon('fa-magnifying-glass-minus')),
      h('button', { class: 'ps-tool', type: 'button', title: 'ซูมเข้า', onclick: () => zoomAt(1.25) }, icon('fa-magnifying-glass-plus')),
      h('button', { class: 'ps-tool', type: 'button', title: 'พอดีจอ', onclick: () => { fit(); draw(); } }, icon('fa-expand')));
    el.sub = h('div', { class: 'sd-sub' });
    el.canvas = h('canvas', { class: 'sd-canvas', tabindex: '0', 'aria-label': 'แผนที่ผังบริเวณ: อาคาร ถนน พื้นที่ ต้นไม้ เสาไฟ' });
    el.hint = h('div', { class: 'sd-hint' });
    el.measure = h('div', { class: 'ps-measure', hidden: true });
    el.stage = h('div', { class: 'sd-stage' }, el.canvas, el.hint, el.measure);
    el.panel = h('aside', { class: 'sd-panel' });
    el.apply = h('button', { class: 'ps-btn ps-btn--main', type: 'button', id: 'sdApply', onclick: apply }, icon('fa-cube'), ' สร้างผังบริเวณ 3D');
    container.append(
      h('div', { class: 'sd-main' }, el.tools, el.sub, el.stage,
        h('p', { class: 'ps-legend sd-legend' }, h('span', { class: 'lg lg--bldg' }), 'อาคาร', h('span', { class: 'lg lg--road' }), 'ถนน', h('span', { class: 'lg lg--pole' }), 'เสาไฟฟ้า', h('span', { class: 'lg lg--tree' }), 'ต้นไม้', h('span', { class: 'lg lg--water' }), 'บ่อน้ำ')),
      el.panel,
      h('footer', { class: 'ps-foot' },
        h('button', { class: 'ps-btn', type: 'button', onclick: () => D.onBack && D.onBack() }, icon('fa-file-arrow-up'), ' เลือกแผนที่ใหม่'),
        h('span', { class: 'ps-foot__sp' }),
        h('button', { class: 'ps-btn', type: 'button', onclick: () => D.onCancel && D.onCancel() }, 'ยกเลิก'),
        el.apply));
    bind();
    if (window.ResizeObserver) new ResizeObserver(() => { if (visible()) { if (!D.fitted) fit(); draw(); } }).observe(el.stage);
  }
  const visible = () => D.root && !D.root.hidden && D.site;

  /* =========================================================================
     เปิดผัง
     ========================================================================= */
  // site: JSON ผังบริเวณ (v2) · img: HTMLCanvasElement/Image ของแผนที่ (หรือ null)
  function open(site, img, o) {
    const opt = o || {};
    D.site = SM.normalize(JSON.parse(JSON.stringify(site)));
    D.ground = SM.groundOf(D.site) || SM.newGround(D.site.W, D.site.H);
    if (D.ground.cols * D.ground.cell < D.site.W || D.ground.rows * D.ground.cell < D.site.H) D.ground = SM.newGround(D.site.W, D.site.H);
    D.img = img || null; D.imgData = null; D.imgTaint = false;
    if (img) {
      try {
        const c = document.createElement('canvas');
        c.width = D.site.W; c.height = D.site.H;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, c.width, c.height);
        D.imgData = g.getImageData(0, 0, c.width, c.height);
      } catch (e) { D.imgTaint = true; D.imgData = null; }
    }
    D.history = []; D.sel = null; D.draft = null; D.measure = null; D.fitted = false;
    D.dirtyScale = !!opt.askScale;
    D.el.measure.hidden = true;
    refreshGround();
    setTool('select');
    requestAnimationFrame(() => { fit(); draw(); renderPanel(); });
    if (D.dirtyScale) setTimeout(() => toast('ตั้งมาตราส่วนก่อน: ใส่ความกว้างจริงของแผนที่ หรือใช้ "วัดระยะ" เทียบกับอาคารที่รู้ขนาด', 'info', 5200), 300);
  }

  /* =========================================================================
     มุมมอง (ซูม/เลื่อน)
     ========================================================================= */
  function sizeCanvas() {
    const r = D.el.stage.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    D.dpr = dpr;
    const c = D.el.canvas;
    const w = Math.max(50, Math.floor(r.width)), hh = Math.max(50, Math.floor(r.height));
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hh * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr); }
    c.style.width = w + 'px'; c.style.height = hh + 'px';
    return { w, h: hh };
  }
  function fit() {
    if (!D.site) return;
    const { w, h: hh } = sizeCanvas();
    const k = Math.min((w - 20) / D.site.W, (hh - 20) / D.site.H);
    D.view = { k, ox: (w - D.site.W * k) / 2, oy: (hh - D.site.H * k) / 2 };
    D.fitted = true;
  }
  function zoomAt(f, sx, sy) {
    const { w, h: hh } = sizeCanvas(), v = D.view;
    const cx = sx === undefined ? w / 2 : sx, cy = sy === undefined ? hh / 2 : sy;
    const px = (cx - v.ox) / v.k, py = (cy - v.oy) / v.k;
    const minK = Math.min((w - 20) / D.site.W, (hh - 20) / D.site.H) * 0.5;
    v.k = clamp(v.k * f, minK, 40);
    v.ox = cx - px * v.k; v.oy = cy - py * v.k;
    draw();
  }
  const toPlan = e => { const r = D.el.canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - D.view.ox) / D.view.k, y: (e.clientY - r.top - D.view.oy) / D.view.k, sx: e.clientX - r.left, sy: e.clientY - r.top }; };
  const M = m => m / D.site.mpp;            // เมตร → px ของผัง

  /* =========================================================================
     พื้นที่ (ตารางสี)
     ========================================================================= */
  function refreshGround(cells) {
    const G = D.ground;
    if (!D.gCanvas || D.gCanvas.width !== G.cols || D.gCanvas.height !== G.rows) { D.gCanvas = document.createElement('canvas'); D.gCanvas.width = G.cols; D.gCanvas.height = G.rows; }
    const g = D.gCanvas.getContext('2d'), im = g.createImageData(G.cols, G.rows);
    for (let i = 0; i < G.data.length; i++) {
      const c = AREA_RGB[G.data[i]];
      if (!c) continue;
      im.data[i * 4] = c[0]; im.data[i * 4 + 1] = c[1]; im.data[i * 4 + 2] = c[2]; im.data[i * 4 + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }

  /* =========================================================================
     วาด
     ========================================================================= */
  function draw() {
    if (!visible()) return;
    const { w, h: hh } = sizeCanvas(), g = D.el.canvas.getContext('2d'), s = D.site, v = D.view, k = v.k;
    g.setTransform(D.dpr, 0, 0, D.dpr, 0, 0);
    g.fillStyle = '#0b1030'; g.fillRect(0, 0, w, hh);
    g.setTransform(D.dpr * k, 0, 0, D.dpr * k, D.dpr * v.ox, D.dpr * v.oy);
    // พื้นหลัง: แผนที่ หรือ สนามหญ้า + ตาราง 10 ม.
    g.fillStyle = s.base === 'concrete' ? '#cbc5b8' : s.base === 'dirt' ? '#9b7853' : s.base === 'sand' ? '#d9c495' : '#5f8f43';
    g.fillRect(0, 0, s.W, s.H);
    if (D.img && D.opts.underlay > 0) { g.globalAlpha = D.opts.underlay; g.drawImage(D.img, 0, 0, s.W, s.H); g.globalAlpha = 1; }
    else {
      g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1 / k;
      const st = M(10);
      g.beginPath();
      for (let x = 0; x <= s.W; x += st) { g.moveTo(x, 0); g.lineTo(x, s.H); }
      for (let y = 0; y <= s.H; y += st) { g.moveTo(0, y); g.lineTo(s.W, y); }
      g.stroke();
    }
    // พื้นที่ที่ระบาย
    g.globalAlpha = D.img && D.opts.underlay > 0 ? 0.55 : 0.85;
    g.imageSmoothingEnabled = false;
    g.drawImage(D.gCanvas, 0, 0, D.ground.cols * D.ground.cell, D.ground.rows * D.ground.cell);
    g.imageSmoothingEnabled = true;
    g.globalAlpha = 1;
    g.lineCap = 'round'; g.lineJoin = 'round';
    // สนามกีฬา
    s.fields.forEach((f, i) => {
      g.save(); g.translate(f.x, f.y); g.rotate(f.rot * DEG);
      g.fillStyle = f.t === 'basketball' ? 'rgba(185,88,58,0.85)' : f.t === 'futsal' ? 'rgba(47,125,109,0.85)' : 'rgba(79,154,60,0.85)';
      g.fillRect(-f.w / 2, -f.d / 2, f.w, f.d);
      g.strokeStyle = '#fff'; g.lineWidth = Math.max(1 / k, M(0.3));
      g.strokeRect(-f.w / 2 + M(2), -f.d / 2 + M(2), f.w - M(4), f.d - M(4));
      g.beginPath(); g.moveTo(0, -f.d / 2 + M(2)); g.lineTo(0, f.d / 2 - M(2)); g.stroke();
      g.beginPath(); g.arc(0, 0, Math.min(f.d, f.w) * 0.14, 0, Math.PI * 2); g.stroke();
      g.restore();
      if (isSel('field', i)) selRect(g, f.x, f.y, f.w, f.d, f.rot, k, false);
    });
    // ถนน
    s.roads.forEach((r, i) => {
      if (isSel('road', i)) { g.strokeStyle = 'rgba(251,191,36,0.6)'; g.lineWidth = M(r.w) + 8 / k; path(g, r.pts); g.stroke(); }
      g.strokeStyle = 'rgba(64,68,76,0.92)'; g.lineWidth = M(r.w); path(g, r.pts); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = Math.max(0.8 / k, M(0.18)); g.setLineDash([M(3), M(3)]); path(g, r.pts); g.stroke(); g.setLineDash([]);
    });
    // รั้ว
    s.fences.forEach((f, i) => {
      g.strokeStyle = isSel('fence', i) ? '#fbbf24' : '#e879f9'; g.lineWidth = Math.max(2 / k, M(0.5)); g.setLineDash([6 / k, 4 / k]); path(g, f.pts); g.stroke(); g.setLineDash([]);
    });
    // อาคาร
    s.buildings.forEach((b, i) => drawBuilding(g, b, i, k));
    // วัตถุ
    s.props.forEach((p, i) => {
      const def = SM.PROPS[p.t] || { r: 1 }, rr = Math.max(2.2 / k, M(def.r * (p.s || 1)) * (p.t === 'shelter' || p.t === 'gate' ? 0.5 : 1));
      g.fillStyle = PROP_DRAW[p.t] || '#22d3ee';
      if (p.t === 'shelter' || p.t === 'gate' || p.t === 'bus' || p.t === 'car' || p.t === 'bench' || p.t === 'toilet') {
        const L = p.t === 'shelter' ? M(12 * (p.s || 1)) : p.t === 'gate' ? M(12 * (p.s || 1) + 2.4) : M({ bus: 11, car: 4.3, bench: 1.8, toilet: 7 }[p.t]), Wd = M({ shelter: 6.4, gate: 1.2, bus: 2.5, car: 1.8, bench: 0.5, toilet: 4 }[p.t]);
        g.save(); g.translate(p.x, p.y); g.rotate((p.rot || 0) * DEG); g.globalAlpha = 0.9; g.fillRect(-L / 2, -Wd / 2, L, Wd); g.restore(); g.globalAlpha = 1;
      } else {
        g.globalAlpha = p.t === 'tree' || p.t === 'pine' || p.t === 'palm' || p.t === 'bush' ? 0.85 : 1;
        g.beginPath(); g.arc(p.x, p.y, rr, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
        if (p.t === 'lamp' || p.t === 'flag') { g.strokeStyle = '#111'; g.lineWidth = 1 / k; g.stroke(); }
      }
      if (isSel('prop', i)) { g.strokeStyle = '#fbbf24'; g.lineWidth = 2.5 / k; g.beginPath(); g.arc(p.x, p.y, rr + 4 / k, 0, Math.PI * 2); g.stroke(); }
    });
    // แนวเสาไฟฟ้า
    s.poles.forEach((l, i) => {
      const on = isSel('pole', i);
      g.strokeStyle = on ? '#fbbf24' : 'rgba(249,115,22,0.95)'; g.lineWidth = (on ? 3 : 2) / k; path(g, l.pts); g.stroke();
      l.pts.forEach(([x, y]) => { g.fillStyle = '#f97316'; g.beginPath(); g.arc(x, y, Math.max(3.2 / k, M(0.6)), 0, Math.PI * 2); g.fill(); g.strokeStyle = '#1c1003'; g.lineWidth = 1.2 / k; g.stroke(); });
    });
    // จุดจับของเส้นที่เลือก
    const selLine = selectedLine();
    if (selLine) selLine.pts.forEach(([x, y], j) => { handle(g, x, y, k, D.sel.v === j ? '#fde68a' : '#fbbf24'); });
    if (selLine) for (let j = 1; j < selLine.pts.length; j++) { const a = selLine.pts[j - 1], b = selLine.pts[j]; g.fillStyle = 'rgba(255,255,255,0.75)'; g.beginPath(); g.arc((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 4 / k, 0, Math.PI * 2); g.fill(); }
    // กำลังวาด
    const d = D.draft;
    if (d && d.kind === 'rect') {
      g.fillStyle = d.tool === 'building' ? 'rgba(56,189,248,0.25)' : d.tool === 'field' ? 'rgba(79,154,60,0.35)' : 'rgba(251,191,36,0.2)';
      g.strokeStyle = '#fbbf24'; g.lineWidth = 2 / k; g.setLineDash([6 / k, 4 / k]);
      const x = Math.min(d.a.x, d.b.x), y = Math.min(d.a.y, d.b.y), ww = Math.abs(d.b.x - d.a.x), dd = Math.abs(d.b.y - d.a.y);
      g.fillRect(x, y, ww, dd); g.strokeRect(x, y, ww, dd); g.setLineDash([]);
      label(g, `${fmt(ww * s.mpp)} × ${fmt(dd * s.mpp)} ม.`, x + ww / 2, y - 12 / k, k, '#fbbf24');
    } else if (d && d.kind === 'line') {
      const pts = d.hover ? d.pts.concat([[d.hover.x, d.hover.y]]) : d.pts;
      g.strokeStyle = d.tool === 'pole' ? '#f97316' : d.tool === 'fence' ? '#e879f9' : 'rgba(64,68,76,0.85)';
      g.lineWidth = d.tool === 'road' ? M(D.opts.roadW) : 2.5 / k;
      path(g, pts); g.stroke();
      g.strokeStyle = '#fbbf24'; g.lineWidth = 1.5 / k; g.setLineDash([6 / k, 4 / k]); path(g, pts); g.stroke(); g.setLineDash([]);
      d.pts.forEach(([x, y]) => handle(g, x, y, k, '#fbbf24'));
      if (d.hover && d.pts.length) { const [lx, ly] = d.pts[d.pts.length - 1]; label(g, `${fmt(Math.hypot(d.hover.x - lx, d.hover.y - ly) * s.mpp)} ม.`, (lx + d.hover.x) / 2, (ly + d.hover.y) / 2 - 12 / k, k, '#fbbf24'); }
    }
    if (D.tool === 'area' && D.hover && (D.opts.areaMode === 'brush' || D.opts.areaMode === 'erase')) {
      g.strokeStyle = '#fbbf24'; g.lineWidth = 1.5 / k; g.beginPath(); g.arc(D.hover.x, D.hover.y, M(D.opts.brush), 0, Math.PI * 2); g.stroke();
    }
    // วัดระยะ
    if (D.measure && D.measure.a) {
      const m = D.measure, b = m.b || m.hover;
      if (b) {
        g.strokeStyle = '#22d3ee'; g.lineWidth = 2.5 / k; g.setLineDash([5 / k, 4 / k]); g.beginPath(); g.moveTo(m.a.x, m.a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
        label(g, `${fmt(Math.hypot(b.x - m.a.x, b.y - m.a.y) * s.mpp, 1)} ม.`, (m.a.x + b.x) / 2, (m.a.y + b.y) / 2 - 12 / k, k, '#22d3ee');
      }
      [m.a, m.b].filter(Boolean).forEach(q => handle(g, q.x, q.y, k, '#22d3ee'));
    }
    D.el.stage.dataset.tool = D.tool;
  }
  function path(g, pts) { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); }
  function handle(g, x, y, k, col) { g.fillStyle = col; g.beginPath(); g.arc(x, y, 6 / k, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#1c1003'; g.lineWidth = 1.5 / k; g.stroke(); }
  function label(g, text, x, y, k, col) {
    g.save(); g.font = `600 ${12 / k}px Prompt, "IBM Plex Sans Thai", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = g.measureText(text).width + 12 / k;
    g.fillStyle = 'rgba(8,12,34,0.85)'; g.fillRect(x - w / 2, y - 9 / k, w, 18 / k);
    g.fillStyle = col; g.fillText(text, x, y + 0.5 / k); g.restore();
  }
  function selRect(g, x, y, w, d, rot, k, handles) {
    g.save(); g.translate(x, y); g.rotate(rot * DEG);
    g.strokeStyle = '#fbbf24'; g.lineWidth = 2.5 / k; g.setLineDash([7 / k, 4 / k]); g.strokeRect(-w / 2 - 3 / k, -d / 2 - 3 / k, w + 6 / k, d + 6 / k); g.setLineDash([]);
    if (handles) {
      for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.fillStyle = '#fbbf24'; g.fillRect(cx * w / 2 - 5 / k, cy * d / 2 - 5 / k, 10 / k, 10 / k); }
      g.beginPath(); g.moveTo(0, -d / 2); g.lineTo(0, -d / 2 - 22 / k); g.stroke();
      g.fillStyle = '#22d3ee'; g.beginPath(); g.arc(0, -d / 2 - 22 / k, 6 / k, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }
  function drawBuilding(g, b, i, k) {
    const sel = isSel('building', i);
    g.save(); g.translate(b.x, b.y); g.rotate((b.rot || 0) * DEG);
    g.fillStyle = STYLE_COL[b.style] || '#e9ebee'; g.globalAlpha = 0.92;
    g.fillRect(-b.w / 2, -b.d / 2, b.w, b.d); g.globalAlpha = 1;
    g.strokeStyle = sel ? '#fbbf24' : '#334155'; g.lineWidth = (sel ? 2.5 : 1.5) / k; g.strokeRect(-b.w / 2, -b.d / 2, b.w, b.d);
    // ผนังห้องภายใน (เมื่อซูมพอ)
    if (b.plan && Math.min(b.w, b.d) * k > 26) {
      const pl = b.plan, f = (1 / SM.PPM) / D.site.mpp, cx = pl.W / 2, cy = pl.H / 2;
      g.strokeStyle = 'rgba(30,41,59,0.85)'; g.lineWidth = Math.max(0.8 / k, 0.15 / D.site.mpp);
      g.beginPath();
      pl.walls.forEach(w => { g.moveTo((w[0] - cx) * f, (w[1] - cy) * f); g.lineTo((w[2] - cx) * f, (w[3] - cy) * f); });
      g.stroke();
      g.strokeStyle = '#16a34a'; g.lineWidth = Math.max(1.2 / k, 0.25 / D.site.mpp);
      g.beginPath();
      (pl.openings || []).forEach(o => { if (o[5]) return; g.moveTo((o[0] - cx) * f, (o[1] - cy) * f); g.lineTo((o[2] - cx) * f, (o[3] - cy) * f); });
      g.stroke();
      if (Math.min(b.w, b.d) * k > 60) {
        g.fillStyle = '#0f172a'; g.font = `500 ${10 / k}px "IBM Plex Sans Thai", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        (pl.rooms || []).forEach(r => { if (!r.h) g.fillText(r.n, (r.x - cx) * f, (r.y - cy) * f); });
      }
    }
    // ทิศด้านหน้า (ประตูหลัก)
    g.fillStyle = '#16a34a'; g.beginPath(); g.moveTo(-5 / k, b.d / 2 + 1 / k); g.lineTo(5 / k, b.d / 2 + 1 / k); g.lineTo(0, b.d / 2 + 8 / k); g.closePath(); g.fill();
    g.restore();
    if (sel) selRect(g, b.x, b.y, b.w, b.d, b.rot || 0, k, true);
    // ป้ายชื่อ
    const t = (b.num ? b.num + ' · ' : '') + b.name;
    g.save(); g.font = `600 ${11 / k}px Prompt, "IBM Plex Sans Thai", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const tw = g.measureText(t).width + 12 / k;
    if (tw < b.w * 2.2 || sel || k > 1.5) {
      g.fillStyle = sel ? 'rgba(251,191,36,0.95)' : 'rgba(8,12,34,0.82)'; g.fillRect(b.x - tw / 2, b.y - 9 / k, tw, 18 / k);
      g.fillStyle = sel ? '#1c1003' : '#f8fafc'; g.fillText(t, b.x, b.y + 0.5 / k);
    } else if (b.num) {                                   // ชื่อยาวเกินอาคาร: แสดงเฉพาะเลขอาคาร
      g.fillStyle = 'rgba(8,12,34,0.85)'; g.beginPath(); g.arc(b.x, b.y, 9 / k, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f8fafc'; g.font = `700 ${10 / k}px Prompt, sans-serif`; g.fillText(b.num, b.x, b.y + 0.5 / k);
    }
    g.restore();
  }
  const isSel = (type, i) => D.sel && D.sel.type === type && D.sel.i === i;
  const selectedLine = () => { const s = D.sel; if (!s) return null; return s.type === 'road' ? D.site.roads[s.i] : s.type === 'fence' ? D.site.fences[s.i] : s.type === 'pole' ? D.site.poles[s.i] : null; };

  /* =========================================================================
     เลือก / แก้ไข
     ========================================================================= */
  const local = (b, x, y) => { const c = Math.cos((b.rot || 0) * DEG), s = Math.sin((b.rot || 0) * DEG), dx = x - b.x, dy = y - b.y; return { x: c * dx + s * dy, y: -s * dx + c * dy }; };
  const world = (b, lx, ly) => { const c = Math.cos((b.rot || 0) * DEG), s = Math.sin((b.rot || 0) * DEG); return { x: b.x + c * lx - s * ly, y: b.y + s * lx + c * ly }; };
  function hit(x, y) {
    const s = D.site, k = D.view.k, tol = 7 / k;
    // จุดจับของสิ่งที่เลือกอยู่ก่อน
    if (D.sel && D.sel.type === 'building') {
      const b = s.buildings[D.sel.i], q = local(b, x, y);
      if (Math.hypot(q.x, q.y + b.d / 2 + 22 / k) < 9 / k) return { type: 'building', i: D.sel.i, part: 'rotate' };
      for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) if (Math.abs(q.x - cx * b.w / 2) < 8 / k && Math.abs(q.y - cy * b.d / 2) < 8 / k) return { type: 'building', i: D.sel.i, part: 'corner', cx, cy };
    }
    const line = selectedLine();
    if (line) {
      for (let j = 0; j < line.pts.length; j++) if (Math.hypot(line.pts[j][0] - x, line.pts[j][1] - y) < 9 / k) return Object.assign({}, D.sel, { v: j, part: 'vertex' });
      for (let j = 1; j < line.pts.length; j++) { const a = line.pts[j - 1], b = line.pts[j]; if (Math.hypot((a[0] + b[0]) / 2 - x, (a[1] + b[1]) / 2 - y) < 7 / k) return Object.assign({}, D.sel, { v: j, part: 'insert' }); }
    }
    for (let i = s.poles.length - 1; i >= 0; i--) for (let j = 0; j < s.poles[i].pts.length; j++) { const [px, py] = s.poles[i].pts[j]; if (Math.hypot(px - x, py - y) < Math.max(tol, M(0.8))) return { type: 'pole', i, v: j, part: 'vertex' }; }
    for (let i = s.props.length - 1; i >= 0; i--) {
      const p = s.props[i], def = SM.PROPS[p.t] || { r: 1 };
      const r = p.t === 'shelter' || p.t === 'gate' ? M(6 * (p.s || 1)) : Math.max(tol, M(def.r * (p.s || 1)) * 0.8);
      if (Math.hypot(p.x - x, p.y - y) < r) return { type: 'prop', i };
    }
    for (let i = s.buildings.length - 1; i >= 0; i--) { const b = s.buildings[i], q = local(b, x, y); if (Math.abs(q.x) <= b.w / 2 && Math.abs(q.y) <= b.d / 2) return { type: 'building', i, part: 'body' }; }
    for (let i = s.fields.length - 1; i >= 0; i--) { const f = s.fields[i], q = local(f, x, y); if (Math.abs(q.x) <= f.w / 2 && Math.abs(q.y) <= f.d / 2) return { type: 'field', i }; }
    for (let i = s.poles.length - 1; i >= 0; i--) { const p = s.poles[i].pts; for (let j = 1; j < p.length; j++) if (segD(x, y, ...p[j - 1], ...p[j]) < tol) return { type: 'pole', i }; }
    for (let i = s.fences.length - 1; i >= 0; i--) { const p = s.fences[i].pts; for (let j = 1; j < p.length; j++) if (segD(x, y, ...p[j - 1], ...p[j]) < tol) return { type: 'fence', i }; }
    for (let i = s.roads.length - 1; i >= 0; i--) { const r = s.roads[i], p = r.pts; for (let j = 1; j < p.length; j++) if (segD(x, y, ...p[j - 1], ...p[j]) < M(r.w) / 2 + tol * 0.5) return { type: 'road', i }; }
    return null;
  }
  function snapshot() {
    const s = D.site;
    D.history.push(JSON.stringify({ buildings: s.buildings, roads: s.roads, props: s.props, poles: s.poles, fields: s.fields, fences: s.fences, mpp: s.mpp, base: s.base, ground: SM.packGround(D.ground) }));
    if (D.history.length > 50) D.history.shift();
  }
  function undo() {
    const t = D.history.pop();
    if (!t) { toast('ไม่มีขั้นตอนให้ย้อนแล้ว', 'info', 1400); return; }
    const d = JSON.parse(t);
    Object.assign(D.site, { buildings: d.buildings, roads: d.roads, props: d.props, poles: d.poles, fields: d.fields, fences: d.fences, mpp: d.mpp, base: d.base });
    D.ground = SM.groundOf({ ground: d.ground });
    refreshGround();
    D.sel = null; D.draft = null;
    renderPanel(); draw();
  }
  function deleteSel() {
    const s = D.sel, site = D.site;
    if (!s) return;
    snapshot();
    const listOf = { building: 'buildings', road: 'roads', prop: 'props', pole: 'poles', field: 'fields', fence: 'fences' }[s.type];
    const line = selectedLine();
    if (line && s.v !== undefined && line.pts.length > (s.type === 'pole' ? 1 : 2)) { line.pts.splice(s.v, 1); D.sel = { type: s.type, i: s.i }; }
    else { site[listOf].splice(s.i, 1); D.sel = null; }
    renderPanel(); draw();
  }
  function rotateSel(deg) {
    const s = D.sel;
    if (!s || !['building', 'prop', 'field'].includes(s.type)) return;
    snapshot();
    const o = D.site[{ building: 'buildings', prop: 'props', field: 'fields' }[s.type]][s.i];
    o.rot = (((o.rot || 0) + deg) % 360 + 360) % 360;
    renderPanel(); draw();
  }
  function duplicateSel() {
    const s = D.sel;
    if (!s || !['building', 'prop', 'field'].includes(s.type)) return;
    snapshot();
    const key = { building: 'buildings', prop: 'props', field: 'fields' }[s.type], o = JSON.parse(JSON.stringify(D.site[key][s.i]));
    o.x += M(6); o.y += M(6);
    if (s.type === 'building') { o.name = o.name + ' (สำเนา)'; o.num = ''; }
    D.site[key].push(o);
    D.sel = { type: s.type, i: D.site[key].length - 1 };
    renderPanel(); draw();
  }

  /* =========================================================================
     เมาส์ / สัมผัส
     ========================================================================= */
  function bind() {
    const c = D.el.canvas;
    c.addEventListener('wheel', e => { if (!D.site) return; e.preventDefault(); const p = toPlan(e); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.sx, p.sy); }, { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', e => { D.pointers.delete(e.pointerId); D.drag = null; });
    c.addEventListener('dblclick', e => { if (D.draft && D.draft.kind === 'line') { e.preventDefault(); finishLine(); } });
    c.addEventListener('pointerleave', () => { D.hover = null; if (D.draft && D.draft.kind === 'line') D.draft.hover = null; draw(); });
  }
  function down(e) {
    if (!D.site) return;
    D.el.canvas.focus({ preventScroll: true });
    D.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    D.el.canvas.setPointerCapture(e.pointerId);
    const p = toPlan(e), s = D.site;
    if (D.pointers.size === 2) {                       // สองนิ้ว: ซูม/เลื่อน
      const [a, b] = [...D.pointers.values()];
      D.drag = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), k0: D.view.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, view: Object.assign({}, D.view) };
      D.draft = D.draft && D.draft.kind === 'line' ? D.draft : null;
      return;
    }
    if (e.button === 1 || e.button === 2 || D.tool === 'pan' || D.space) { D.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: D.view.ox, oy: D.view.oy }; return; }
    if (e.button !== 0) return;
    const t = D.tool;
    if (t === 'select') {
      const hh = hit(p.x, p.y);
      if (!hh) {
        D.sel = null; renderPanel(); draw();
        D.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: D.view.ox, oy: D.view.oy, quiet: true };
        return;
      }
      if (hh.part === 'insert') {
        snapshot();
        const line = selectedLine(), a = line.pts[hh.v - 1], b = line.pts[hh.v];
        line.pts.splice(hh.v, 0, [r1((a[0] + b[0]) / 2), r1((a[1] + b[1]) / 2)]);
        D.sel = { type: hh.type, i: hh.i, v: hh.v };
        D.drag = { kind: 'vertex', snap: true, moved: true };
      } else {
        const changed = !D.sel || D.sel.type !== hh.type || D.sel.i !== hh.i || D.sel.v !== hh.v;
        D.sel = { type: hh.type, i: hh.i, v: hh.part === 'vertex' ? hh.v : undefined };
        D.drag = { kind: hh.part === 'rotate' ? 'rotate' : hh.part === 'corner' ? 'corner' : hh.part === 'vertex' ? 'vertex' : 'move', start: p, last: p, cx: hh.cx, cy: hh.cy, moved: false };
        if (changed) renderPanel();
      }
      draw();
      return;
    }
    if (t === 'building' || t === 'field' || (t === 'area' && D.opts.areaMode === 'rect')) { D.draft = { kind: 'rect', tool: t, a: p, b: p }; return; }
    if (t === 'road' || t === 'fence' || t === 'pole') {
      if (!D.draft || D.draft.kind !== 'line' || D.draft.tool !== t) D.draft = { kind: 'line', tool: t, pts: [] };
      const pts = D.draft.pts, last = pts[pts.length - 1];
      if (last && Math.hypot(last[0] - p.x, last[1] - p.y) < 3 / D.view.k) return;
      let q = [p.x, p.y];
      if (last && e.shiftKey) { const ang = Math.round(Math.atan2(p.y - last[1], p.x - last[0]) / (Math.PI / 4)) * (Math.PI / 4), L = Math.hypot(p.x - last[0], p.y - last[1]); q = [last[0] + Math.cos(ang) * L, last[1] + Math.sin(ang) * L]; }
      if (t === 'pole' && last) {                     // เสาไฟห่างเกิน 45 ม. → เติมเสาตรงกลางให้
        const L = Math.hypot(q[0] - last[0], q[1] - last[1]) * s.mpp, n = Math.ceil(L / 40);
        if (L > 45) for (let j = 1; j < n; j++) pts.push([r1(last[0] + (q[0] - last[0]) * j / n), r1(last[1] + (q[1] - last[1]) * j / n)]);
      }
      pts.push([r1(q[0]), r1(q[1])]);
      draw();
      return;
    }
    if (t === 'area') {
      snapshot();
      const v = D.opts.areaMode === 'erase' ? 0 : SM.AREA_INDEX[D.opts.area];
      if (D.opts.areaMode === 'wand') {
        if (!D.imgData) { toast(D.imgTaint ? 'อ่านสีจากภาพนี้ไม่ได้ (เปิดไฟล์จากเครื่องโดยตรง) — ใช้แปรงหรือกรอบแทน' : 'ต้องมีภาพแผนที่ก่อนจึงเลือกตามสีได้', 'warn', 3200); D.history.pop(); return; }
        const n = SM.wand(D.imgData, D.ground, p.x, p.y, D.opts.tol, v);
        refreshGround(); draw();
        toast(`เติมพื้นที่ ${fmt(n * (D.ground.cell * s.mpp) ** 2, 0)} ตร.ม.`, 'ok', 1600);
        return;
      }
      SM.paintCircle(D.ground, p.x, p.y, M(D.opts.brush), v);
      refreshGround(); draw();
      D.drag = { kind: 'paint', v, last: p };
      return;
    }
    if (t === 'prop') {
      snapshot();
      addProp(D.opts.prop, p.x, p.y);
      if (D.opts.scatter && ['tree', 'pine', 'palm', 'bush'].includes(D.opts.prop)) D.drag = { kind: 'scatter', last: p };
      else { D.sel = { type: 'prop', i: s.props.length - 1 }; renderPanel(); }
      draw();
      return;
    }
    if (t === 'measure') {
      const m = D.measure || (D.measure = { a: null, b: null });
      if (!m.a || m.b) { m.a = p; m.b = null; D.el.measure.hidden = true; }
      else { m.b = p; showMeasure(); }
      draw();
    }
  }
  function move(e) {
    if (!D.site) return;
    if (D.pointers.has(e.pointerId)) D.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = toPlan(e), d = D.drag, s = D.site;
    D.hover = p;
    if (d && d.kind === 'pinch' && D.pointers.size === 2) {
      const [a, b] = [...D.pointers.values()], r = D.el.canvas.getBoundingClientRect();
      const f = Math.hypot(a.x - b.x, a.y - b.y) / (d.d0 || 1), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const px = (d.cx - r.left - d.view.ox) / d.view.k, py = (d.cy - r.top - d.view.oy) / d.view.k;
      D.view.k = clamp(d.k0 * f, 0.05, 40);
      D.view.ox = cx - r.left - px * D.view.k; D.view.oy = cy - r.top - py * D.view.k;
      draw();
      return;
    }
    if (d && d.kind === 'pan') { D.view.ox = d.ox + e.clientX - d.sx; D.view.oy = d.oy + e.clientY - d.sy; d.moved = d.moved || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 3; draw(); return; }
    if (d && d.kind === 'paint') {
      const steps = Math.max(1, Math.ceil(Math.hypot(p.x - d.last.x, p.y - d.last.y) / Math.max(1, M(D.opts.brush) / 2)));
      for (let j = 1; j <= steps; j++) SM.paintCircle(D.ground, d.last.x + (p.x - d.last.x) * j / steps, d.last.y + (p.y - d.last.y) * j / steps, M(D.opts.brush), d.v);
      d.last = p;
      refreshGround(); draw();
      return;
    }
    if (d && d.kind === 'scatter') {
      const gap = M(((SM.PROPS[D.opts.prop] || { r: 3 }).r) * 2.2);
      if (Math.hypot(p.x - d.last.x, p.y - d.last.y) >= gap) { addProp(D.opts.prop, p.x + (Math.random() - 0.5) * gap * 0.4, p.y + (Math.random() - 0.5) * gap * 0.4, Math.random() * 360, 0.8 + Math.random() * 0.45); d.last = p; draw(); }
      return;
    }
    if (d && D.sel && ['move', 'corner', 'rotate', 'vertex'].includes(d.kind)) {
      if (!d.moved) { if (Math.hypot(p.x - d.start.x, p.y - d.start.y) * D.view.k < 3) return; snapshot(); d.moved = true; }
      const sel = D.sel;
      if (d.kind === 'vertex') {
        const line = selectedLine() || (sel.type === 'pole' ? s.poles[sel.i] : null);
        if (line && sel.v !== undefined) line.pts[sel.v] = [r1(p.x), r1(p.y)];
      } else if (d.kind === 'move') {
        const dx = p.x - d.last.x, dy = p.y - d.last.y;
        const key = { building: 'buildings', prop: 'props', field: 'fields' }[sel.type];
        if (key) { const o = s[key][sel.i]; o.x = r1(o.x + dx); o.y = r1(o.y + dy); }
        else { const line = selectedLine(); if (line) line.pts = line.pts.map(([x, y]) => [r1(x + dx), r1(y + dy)]); }
        d.last = p;
      } else if (d.kind === 'rotate') {
        const b = s.buildings[sel.i];
        let ang = Math.atan2(p.y - b.y, p.x - b.x) / DEG + 90;
        if (!e.shiftKey) ang = Math.round(ang / 5) * 5;
        b.rot = ((Math.round(ang) % 360) + 360) % 360;
      } else if (d.kind === 'corner') {
        const b = s.buildings[sel.i], q = local(b, p.x, p.y);
        const ox = -d.cx * b.w / 2, oy = -d.cy * b.d / 2;            // มุมตรงข้ามอยู่กับที่
        const nw = Math.max(M(3), Math.abs(q.x - ox)), nd = Math.max(M(3), Math.abs(q.y - oy));
        const ncx = ox + d.cx * nw / 2, ncy = oy + d.cy * nd / 2, wc = world(b, ncx, ncy);
        b.x = r1(wc.x); b.y = r1(wc.y);
        b.w = r1(nw); b.d = r1(nd);
        d.resized = true;
      }
      draw();
      return;
    }
    if (D.draft && D.draft.kind === 'rect') { D.draft.b = p; draw(); return; }
    if (D.draft && D.draft.kind === 'line') { D.draft.hover = p; draw(); return; }
    if (D.measure && D.measure.a && !D.measure.b) { D.measure.hover = p; draw(); return; }
    if (D.tool === 'area') draw();
  }
  function up(e) {
    D.pointers.delete(e.pointerId);
    const d = D.drag, s = D.site;
    D.drag = null;
    if (!s) return;
    if (d && d.kind === 'corner' && d.resized) {
      const b = s.buildings[D.sel.i];
      SM.resizeBuilding(s, b, b.w, b.d);                // จัดห้องภายในใหม่ตามขนาด
      renderPanel(); draw();
      return;
    }
    if (d && d.moved && D.sel) { renderPanel(); draw(); return; }
    const dr = D.draft;
    if (dr && dr.kind === 'rect') {
      D.draft = null;
      const x0 = Math.min(dr.a.x, dr.b.x), y0 = Math.min(dr.a.y, dr.b.y), w = Math.abs(dr.b.x - dr.a.x), dd = Math.abs(dr.b.y - dr.a.y);
      if (w * s.mpp < 3 || dd * s.mpp < 3) { draw(); if (w * s.mpp > 0.5) toast('กรอบเล็กเกินไป (ต้องกว้างอย่างน้อย 3 ม.)', 'info', 1800); return; }
      snapshot();
      if (dr.tool === 'building') {
        const n = s.buildings.filter(b => b.num).length + 1;
        const wm = w * s.mpp, dm = dd * s.mpp, rooms = Math.max(1, Math.min(10, Math.round(wm / 9)));
        s.buildings.push(SM.newBuilding(s, { name: `อาคาร ${n}`, num: String(n), x: r1(x0 + w / 2), y: r1(y0 + dd / 2), w: r1(w), d: r1(dd), floors: D.opts.floors, style: D.opts.style, roof: D.opts.roof, rot: 0, layout: { n: rooms, corridor: rooms > 2 && dm >= 9 ? 'front' : 'none' } }));
        D.sel = { type: 'building', i: s.buildings.length - 1 };
        setTool('select');
        toast(`เพิ่มอาคาร ${fmt(wm)} × ${fmt(dm)} ม. (${rooms} ห้อง) — ปรับชื่อ ชั้น และห้องได้ที่แผงขวา`, 'ok', 2600);
      } else if (dr.tool === 'field') {
        s.fields.push({ t: D.opts.fieldT, x: r1(x0 + w / 2), y: r1(y0 + dd / 2), w: r1(w), d: r1(dd), rot: 0 });
        D.sel = { type: 'field', i: s.fields.length - 1 };
      } else {
        SM.paintRect(D.ground, x0, y0, x0 + w, y0 + dd, D.opts.areaMode === 'erase' ? 0 : SM.AREA_INDEX[D.opts.area]);
        refreshGround();
      }
      renderPanel(); draw();
      return;
    }
    if (d && d.kind === 'scatter') { renderPanel(); return; }
  }
  function finishLine() {
    const d = D.draft;
    if (!d || d.kind !== 'line') return;
    D.draft = null;
    const s = D.site, min = d.tool === 'pole' ? 1 : 2;
    if (d.pts.length < min) { draw(); toast(d.tool === 'pole' ? 'คลิกวางเสาอย่างน้อย 1 ต้น' : 'ต้องมีอย่างน้อย 2 จุด', 'info', 1600); return; }
    snapshot();
    if (d.tool === 'road') { s.roads.push({ pts: d.pts, w: D.opts.roadW }); D.sel = { type: 'road', i: s.roads.length - 1 }; }
    else if (d.tool === 'fence') { s.fences.push({ pts: d.pts, h: 1.8 }); D.sel = { type: 'fence', i: s.fences.length - 1 }; }
    else { s.poles.push({ pts: d.pts, h: 9 }); D.sel = { type: 'pole', i: s.poles.length - 1 }; }
    renderPanel(); draw();
  }
  function addProp(t, x, y, rot, sc) {
    D.site.props.push({ t, x: r1(x), y: r1(y), rot: Math.round(rot || 0), s: Math.round((sc || 1) * 100) / 100 });
  }
  function showMeasure() {
    const s = D.site, m = D.measure, dpx = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y);
    if (dpx < 3) return;
    const input = h('input', { type: 'number', min: 0.5, step: 0.1, value: (dpx * s.mpp).toFixed(1), id: 'sdMeasureInput', 'aria-label': 'ระยะจริง (เมตร)' });
    const ok = () => {
      const v = parseFloat(input.value);
      if (!(v > 0)) return;
      setScale(v / dpx);
      D.el.measure.hidden = true;
      D.measure = { a: null, b: null };
      toast(`ตั้งมาตราส่วนแล้ว: ผังกว้าง ${fmt(s.W * s.mpp, 0)} × ${fmt(s.H * s.mpp, 0)} ม.`, 'ok', 2600);
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
    D.el.measure.innerHTML = '';
    D.el.measure.append(h('b', { text: 'ระยะจริงระหว่าง 2 จุดนี้' }), h('div', {}, input, h('span', { text: 'เมตร' })), h('button', { class: 'ps-btn ps-btn--main', type: 'button', id: 'sdMeasureOk', onclick: ok }, 'ใช้เป็นมาตราส่วน'));
    D.el.measure.hidden = false;
    setTimeout(() => input.select(), 30);
  }
  // เปลี่ยนมาตราส่วน: อาคารคงขนาดบนแผนที่ (ขนาดจริงเปลี่ยน) จึงต้องจัดห้องภายในใหม่
  function setScale(mpp) {
    const s = D.site;
    if (!(mpp > 0) || Math.abs(mpp - s.mpp) < 1e-9) return;
    snapshot();
    s.mpp = mpp;
    s.buildings.forEach(b => SM.resizeBuilding(s, b, b.w, b.d));
    D.dirtyScale = false;
    renderPanel(); draw();
  }

  /* =========================================================================
     แถบตัวเลือกของเครื่องมือ + แผงขวา
     ========================================================================= */
  function setTool(t) {
    if (D.draft && D.draft.kind === 'line' && D.draft.tool !== t) finishLine();
    D.tool = t; D.draft = null;
    D.measure = t === 'measure' ? { a: null, b: null } : null;
    D.el.measure.hidden = true;
    D.el.tools.querySelectorAll('[data-sdtool]').forEach(b => { const on = b.dataset.sdtool === t; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
    D.el.hint.textContent = HINT[t] || '';
    renderSub();
    draw();
  }
  function renderSub() {
    const box = D.el.sub, o = D.opts, t = D.tool;
    box.innerHTML = '';
    box.hidden = !['area', 'prop', 'road', 'field', 'building'].includes(t);
    if (t === 'area') {
      box.append(h('div', { class: 'sd-swatches', role: 'radiogroup', 'aria-label': 'ชนิดพื้นที่' }, SM.AREAS.slice(1).map(a => h('button', {
        type: 'button', class: 'sd-sw' + (o.area === a.id ? ' is-on' : ''), style: `--c:${a.color}`, role: 'radio', 'aria-checked': String(o.area === a.id), 'data-area': a.id,
        onclick: () => { o.area = a.id; if (o.areaMode === 'erase') o.areaMode = 'brush'; renderSub(); }
      }, h('i', {}), a.th))),
      h('div', { class: 'ps-seg sd-modes' }, [['brush', 'fa-paintbrush', 'แปรง'], ['rect', 'fa-vector-square', 'กรอบ'], ['wand', 'fa-wand-magic-sparkles', 'ตามสีแผนที่'], ['erase', 'fa-eraser', 'ยางลบ']].map(([m, ic, tt]) => h('button', { type: 'button', class: o.areaMode === m ? 'is-on' : '', 'data-mode': m, onclick: () => { o.areaMode = m; renderSub(); draw(); } }, icon(ic), ' ' + tt))),
      o.areaMode === 'wand'
        ? h('label', { class: 'sd-range' }, 'ช่วงสี', h('input', { type: 'range', min: 10, max: 90, step: 2, value: o.tol, oninput: e => { o.tol = +e.target.value; } }))
        : h('label', { class: 'sd-range' }, 'ขนาดแปรง', h('input', { type: 'range', min: 1, max: 30, step: 1, value: o.brush, oninput: e => { o.brush = +e.target.value; e.target.nextSibling.textContent = `${o.brush} ม.`; draw(); } }), h('small', { text: `${o.brush} ม.` })));
    } else if (t === 'prop') {
      box.append(h('div', { class: 'sd-props', role: 'radiogroup', 'aria-label': 'วัตถุ' }, Object.entries(SM.PROPS).map(([id, p]) => h('button', {
        type: 'button', class: 'sd-prop' + (o.prop === id ? ' is-on' : ''), style: `--c:${p.color}`, role: 'radio', 'aria-checked': String(o.prop === id), 'data-prop': id, title: p.th,
        onclick: () => { o.prop = id; renderSub(); }
      }, icon(p.icon), h('span', { text: p.th })))),
      ['tree', 'pine', 'palm', 'bush'].includes(o.prop) ? h('label', { class: 'ps-chk' }, h('input', { type: 'checkbox', checked: o.scatter, id: 'sdScatter', onchange: e => { o.scatter = e.target.checked; } }), ' โรยต้นไม้เมื่อลาก (ปลูกเป็นแนว)') : null);
    } else if (t === 'road') {
      box.append(h('label', { class: 'sd-sel' }, 'ความกว้างถนน', h('select', { onchange: e => { o.roadW = +e.target.value; } },
        [[4, 'ทางเดิน/ทางรถเล็ก 4 ม.'], [6, 'ถนนภายใน 6 ม.'], [7, 'ถนน 2 ช่องจราจร 7 ม.'], [10, 'ถนนหลัก 10 ม.'], [14, 'ถนน 4 ช่องจราจร 14 ม.'], [22, 'ทางหลวง 22 ม.']].map(([v, tt]) => h('option', { value: v, text: tt, selected: o.roadW === v })))),
        h('small', { class: 'sd-note', text: 'กด Shift ค้างเพื่อล็อกแนวตรง/เฉียง 45°' }));
    } else if (t === 'field') {
      box.append(h('label', { class: 'sd-sel' }, 'ชนิดสนาม', h('select', { onchange: e => { o.fieldT = e.target.value; } }, Object.entries(SM.FIELDS).map(([v, tt]) => h('option', { value: v, text: tt, selected: o.fieldT === v })))));
    } else if (t === 'building') {
      box.append(
        h('label', { class: 'sd-sel' }, 'จำนวนชั้น', h('select', { onchange: e => { o.floors = +e.target.value; } }, [1, 2, 3, 4, 5, 6].map(n => h('option', { value: n, text: `${n} ชั้น`, selected: o.floors === n })))),
        h('label', { class: 'sd-sel' }, 'สีอาคาร', h('select', { onchange: e => { o.style = e.target.value; } }, Object.entries(SM.STYLES).map(([v, st]) => h('option', { value: v, text: st.th, selected: o.style === v })))),
        h('label', { class: 'sd-sel' }, 'หลังคา', h('select', { onchange: e => { o.roof = e.target.value; } }, Object.entries(SM.ROOFS).map(([v, tt]) => h('option', { value: v, text: tt, selected: o.roof === v })))));
    }
  }
  const num = (label, value, o, onchange, unit) => h('label', { class: 'sd-num' }, h('span', { text: label }),
    h('span', { class: 'ps-num' }, h('input', Object.assign({ type: 'number', value, onchange: e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onchange(v); } }, o)), unit ? h('small', { text: unit }) : null));
  function renderPanel() {
    const box = D.el.panel, s = D.site;
    if (!box || !s) return;
    box.innerHTML = '';
    const rooms = s.buildings.reduce((a, b) => a + ((b.plan && b.plan.rooms) || []).filter(r => !r.h && !r.k).length, 0);
    const trees = s.props.filter(p => ['tree', 'pine', 'palm', 'bush'].includes(p.t)).length, poles = s.poles.reduce((a, l) => a + l.pts.length, 0);
    box.append(h('div', { class: 'ps-sum sd-sum' },
      h('span', {}, h('b', { text: s.buildings.length }), ' อาคาร'), h('span', {}, h('b', { text: rooms }), ' ห้อง'),
      h('span', {}, h('b', { text: s.roads.length }), ' ถนน'), h('span', {}, h('b', { text: trees }), ' ต้นไม้'), h('span', {}, h('b', { text: poles }), ' เสาไฟ')));
    const sel = D.sel;
    if (sel && sel.type === 'building' && s.buildings[sel.i]) box.append(buildingPanel(s.buildings[sel.i], sel.i));
    else if (sel && sel.type === 'road' && s.roads[sel.i]) box.append(roadPanel(s.roads[sel.i]));
    else if (sel && sel.type === 'prop' && s.props[sel.i]) box.append(propPanel(s.props[sel.i]));
    else if (sel && sel.type === 'pole' && s.poles[sel.i]) box.append(polePanel(s.poles[sel.i]));
    else if (sel && sel.type === 'field' && s.fields[sel.i]) box.append(fieldPanel(s.fields[sel.i]));
    else if (sel && sel.type === 'fence' && s.fences[sel.i]) box.append(h('section', { class: 'ps-sec' }, h('h3', {}, icon('fa-grip-lines-vertical'), ` รั้ว ยาว ${fmt(lineLen(s.fences[sel.i].pts) * s.mpp)} ม.`),
      num('ความสูง', s.fences[sel.i].h || 1.8, { min: 0.8, max: 4, step: 0.1 }, v => { snapshot(); s.fences[sel.i].h = clamp(v, 0.8, 4); }, 'ม.'),
      h('button', { class: 'ps-btn ps-btn--danger ps-btn--block', type: 'button', onclick: deleteSel }, icon('fa-trash-can'), ' ลบรั้ว')));
    box.append(sitePanel());
  }
  const lineLen = pts => pts.reduce((a, p, i) => a + (i ? Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
  function buildingPanel(b, idx) {
    const s = D.site, pl = b.plan || { rooms: [] };
    const roomList = (pl.rooms || []).filter(r => !r.h);
    const L = b.layout || { n: 1, corridor: 'none' };
    const relayout = patch => { snapshot(); SM.relayout(s, b, patch); renderPanel(); draw(); };
    const names = () => roomList.filter(r => !r.k).map(r => r.n);
    return h('section', { class: 'ps-sec sd-bldg' },
      h('h3', {}, icon('fa-building'), ' อาคารที่เลือก'),
      h('div', { class: 'sd-row2' },
        h('label', { class: 'sd-txt sd-txt--num' }, h('span', { text: 'เลข' }), h('input', { type: 'text', value: b.num || '', maxLength: 4, 'aria-label': 'เลขอาคาร', onchange: e => { snapshot(); b.num = e.target.value.trim(); draw(); } })),
        h('label', { class: 'sd-txt' }, h('span', { text: 'ชื่ออาคาร' }), h('input', { type: 'text', value: b.name, maxLength: 60, id: 'sdBName', 'aria-label': 'ชื่ออาคาร', oninput: e => { b.name = e.target.value || 'อาคาร'; draw(); }, onfocus: () => snapshot() }))),
      h('div', { class: 'sd-row3' },
        num('กว้าง', r1(b.w * s.mpp), { min: 3, max: 400, step: 0.5, id: 'sdBW' }, v => { snapshot(); SM.resizeBuilding(s, b, M(clamp(v, 3, 400)), b.d); renderPanel(); draw(); }, 'ม.'),
        num('ลึก', r1(b.d * s.mpp), { min: 3, max: 400, step: 0.5, id: 'sdBD' }, v => { snapshot(); SM.resizeBuilding(s, b, b.w, M(clamp(v, 3, 400))); renderPanel(); draw(); }, 'ม.'),
        num('หมุน', b.rot || 0, { min: 0, max: 359, step: 5 }, v => { snapshot(); b.rot = ((Math.round(v) % 360) + 360) % 360; draw(); }, '°')),
      h('div', { class: 'sd-row3' },
        h('label', { class: 'sd-sel' }, 'ชั้น', h('select', { id: 'sdBFloors', onchange: e => { snapshot(); b.floors = +e.target.value; } }, [1, 2, 3, 4, 5, 6, 7, 8].map(n => h('option', { value: n, text: `${n} ชั้น`, selected: b.floors === n })))),
        h('label', { class: 'sd-sel' }, 'สี', h('select', { onchange: e => { snapshot(); b.style = e.target.value; draw(); } }, Object.entries(SM.STYLES).map(([v, st]) => h('option', { value: v, text: st.th, selected: b.style === v })))),
        h('label', { class: 'sd-sel' }, 'หลังคา', h('select', { onchange: e => { snapshot(); b.roof = e.target.value; } }, Object.entries(SM.ROOFS).map(([v, tt]) => h('option', { value: v, text: tt, selected: b.roof === v }))))),
      h('div', { class: 'sd-rooms-h' }, h('b', {}, icon('fa-door-open'), ` ห้องชั้นล่าง (${roomList.filter(r => !r.k).length})`),
        b.custom ? h('small', { class: 'sd-tag', text: 'จัดเอง' }) : null),
      b.custom ? null : h('div', { class: 'sd-row2' },
        h('div', { class: 'sd-stepper' }, h('span', { text: 'จำนวนห้อง' }),
          h('button', { type: 'button', class: 'ps-ico', 'aria-label': 'ลดห้อง', id: 'sdRoomMinus', onclick: () => relayout({ n: Math.max(1, (L.n || 1) - 1), names: names().slice(0, Math.max(1, (L.n || 1) - 1)) }) }, icon('fa-minus')),
          h('b', { text: L.n || 1 }),
          h('button', { type: 'button', class: 'ps-ico', 'aria-label': 'เพิ่มห้อง', id: 'sdRoomPlus', onclick: () => relayout({ n: Math.min(24, (L.n || 1) + 1), names: names() }) }, icon('fa-plus'))),
        h('div', { class: 'ps-seg sd-corr' }, [['none', 'ไม่มีทางเดิน'], ['front', 'ทางเดินหน้า'], ['center', 'ทางเดินกลาง']].map(([v, tt]) => h('button', { type: 'button', class: (L.corridor || 'none') === v ? 'is-on' : '', 'data-corr': v, onclick: () => relayout({ corridor: v, names: names() }) }, tt)))),
      h('ul', { class: 'ps-rooms sd-roomlist' }, roomList.map(r => h('li', { class: r.k ? 'is-corr' : '' },
        h('i', { class: 'ps-sw', style: `--c:${r.c}` }),
        h('input', { type: 'text', value: r.n, maxLength: 40, 'aria-label': 'ชื่อห้อง', onfocus: () => snapshot(), oninput: e => {
          r.n = e.target.value || 'ห้อง';
          if (!b.custom && !r.k) { b.layout = Object.assign({}, b.layout, { names: roomList.filter(q => !q.k).map(q => q.n) }); }
          draw();
        } }),
        r.k ? h('small', { text: 'ทางเดิน' }) : null))),
      h('button', { class: 'ps-btn ps-btn--block', type: 'button', id: 'sdInterior', onclick: () => editInterior(b) }, icon('fa-pen-ruler'), ' จัดห้องเอง (วาดผนัง เจาะประตู)'),
      b.custom ? h('button', { class: 'ps-btn ps-btn--block', type: 'button', onclick: () => relayout({}) }, icon('fa-wand-magic-sparkles'), ' กลับไปแบ่งห้องอัตโนมัติ') : null,
      h('div', { class: 'ps-row' },
        h('button', { class: 'ps-btn', type: 'button', onclick: duplicateSel, title: 'Ctrl+D' }, icon('fa-clone'), ' ทำสำเนา'),
        h('button', { class: 'ps-btn ps-btn--danger', type: 'button', id: 'sdDelete', onclick: deleteSel }, icon('fa-trash-can'), ' ลบอาคาร')),
      h('p', { class: 'ps-note' }, icon('fa-circle-info'), ' ห้องที่แบ่งไว้คือชั้นล่าง (วางอุปกรณ์เครือข่ายได้) ชั้นบนแสดงเป็นตัวอาคารพร้อมหน้าต่าง ลูกศรสีเขียว = ด้านหน้า/ประตูหลัก'));
  }
  function editInterior(b) {
    if (!D.onInterior) return;
    D.onInterior(b.plan, `${b.num ? 'อาคาร ' + b.num + ' · ' : ''}${b.name}`, json => {
      snapshot();
      b.plan = json;
      b.custom = true;
      b.layout = Object.assign({}, b.layout, { n: (json.rooms || []).filter(r => !r.h && !r.k).length });
      renderPanel(); draw();
      toast('บันทึกห้องภายในอาคารแล้ว', 'ok', 1800);
    });
  }
  function roadPanel(r) {
    const s = D.site;
    return h('section', { class: 'ps-sec' }, h('h3', {}, icon('fa-road'), ` ถนน ยาว ${fmt(lineLen(r.pts) * s.mpp)} ม.`),
      num('ความกว้าง', r.w, { min: 2, max: 40, step: 0.5, id: 'sdRoadW' }, v => { snapshot(); r.w = clamp(v, 2, 40); draw(); }, 'ม.'),
      h('div', { class: 'ps-row' },
        h('button', { class: 'ps-btn', type: 'button', onclick: () => { snapshot(); const L = SM.lampsAlong(s, r, 30); s.props.push(...L); renderPanel(); draw(); toast(`ใส่เสาไฟถนน ${L.length} ต้น`, 'ok', 1600); } }, icon('fa-lightbulb'), ' ไฟถนนทุก 30 ม.'),
        h('button', { class: 'ps-btn', type: 'button', onclick: () => { snapshot(); const n = treesAlong(r); renderPanel(); draw(); toast(`ปลูกต้นไม้ริมถนน ${n} ต้น`, 'ok', 1600); } }, icon('fa-tree'), ' ต้นไม้ริมถนน')),
      h('button', { class: 'ps-btn ps-btn--danger ps-btn--block', type: 'button', id: 'sdDelete', onclick: deleteSel }, icon('fa-trash-can'), D.sel.v !== undefined ? ' ลบจุดที่เลือก' : ' ลบถนน'),
      h('p', { class: 'ps-note' }, icon('fa-circle-info'), ' ลากจุดเหลืองเพื่อดัดแนวถนน · ลากจุดขาวกลางเส้นเพื่อเพิ่มจุด'));
  }
  function treesAlong(r) {
    const s = D.site, off = M(r.w / 2 + 3.5), step = M(12);
    let n = 0, carry = step / 2;
    for (let i = 1; i < r.pts.length; i++) {
      const [ax, ay] = r.pts[i - 1], [bx, by] = r.pts[i], L = Math.hypot(bx - ax, by - ay);
      if (L < 1) continue;
      const ux = (bx - ax) / L, uy = (by - ay) / L;
      for (let d = carry; d < L; d += step) for (const sd of [-1, 1]) {
        const x = ax + ux * d - uy * off * sd, y = ay + uy * d + ux * off * sd;
        if (s.buildings.some(b => { const q = local(b, x, y); return Math.abs(q.x) < b.w / 2 + M(2) && Math.abs(q.y) < b.d / 2 + M(2); })) continue;
        addProp('tree', x, y, Math.random() * 360, 0.8 + Math.random() * 0.35); n++;
      }
      carry = (carry - L) % step; if (carry < 0) carry += step;
    }
    return n;
  }
  function propPanel(p) {
    const def = SM.PROPS[p.t] || { th: p.t };
    return h('section', { class: 'ps-sec' }, h('h3', {}, icon(def.icon || 'fa-cube'), ` ${def.th}`),
      h('label', { class: 'sd-sel' }, 'ชนิด', h('select', { onchange: e => { snapshot(); p.t = e.target.value; renderPanel(); draw(); } }, Object.entries(SM.PROPS).map(([v, q]) => h('option', { value: v, text: q.th, selected: p.t === v })))),
      h('div', { class: 'sd-row2' },
        num(p.t === 'shelter' || p.t === 'gate' ? 'ความยาว (×12 ม.)' : 'ขนาด (เท่า)', p.s || 1, { min: 0.3, max: 8, step: 0.1 }, v => { snapshot(); p.s = clamp(v, 0.3, 8); draw(); }),
        num('หมุน', p.rot || 0, { min: 0, max: 359, step: 15 }, v => { snapshot(); p.rot = ((Math.round(v) % 360) + 360) % 360; draw(); }, '°')),
      h('div', { class: 'ps-row' },
        h('button', { class: 'ps-btn', type: 'button', onclick: duplicateSel }, icon('fa-clone'), ' ทำสำเนา'),
        h('button', { class: 'ps-btn ps-btn--danger', type: 'button', id: 'sdDelete', onclick: deleteSel }, icon('fa-trash-can'), ' ลบ')));
  }
  function polePanel(l) {
    const s = D.site, L = lineLen(l.pts) * s.mpp;
    const maxSpan = l.pts.reduce((a, p, i) => Math.max(a, i ? Math.hypot(p[0] - l.pts[i - 1][0], p[1] - l.pts[i - 1][1]) * s.mpp : 0), 0);
    return h('section', { class: 'ps-sec' }, h('h3', {}, icon('fa-bolt'), ` แนวเสาไฟฟ้า ${l.pts.length} ต้น`),
      h('p', { class: 'ps-note' }, `ยาวรวม ${fmt(L)} ม. · ช่วงยาวสุด ${fmt(maxSpan)} ม. (ปกติ 30–40 ม.)`),
      maxSpan > 45 ? h('button', { class: 'ps-btn ps-btn--block', type: 'button', onclick: () => {
        snapshot();
        const out = [l.pts[0]];
        for (let i = 1; i < l.pts.length; i++) { const a = l.pts[i - 1], b = l.pts[i], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * s.mpp / 40); for (let j = 1; j < n; j++) out.push([r1(a[0] + (b[0] - a[0]) * j / n), r1(a[1] + (b[1] - a[1]) * j / n)]); out.push(b); }
        l.pts = out; renderPanel(); draw();
      } }, icon('fa-plus'), ' เติมเสาให้ห่างไม่เกิน 40 ม.') : null,
      h('button', { class: 'ps-btn ps-btn--danger ps-btn--block', type: 'button', id: 'sdDelete', onclick: deleteSel }, icon('fa-trash-can'), D.sel.v !== undefined ? ' ลบเสาต้นที่เลือก' : ' ลบแนวเสาทั้งหมด'),
      h('p', { class: 'ps-note' }, icon('fa-circle-info'), ' สายสื่อสาร (Fiber/LAN) ระหว่างอาคารจะพาดตามแนวเสาที่ใกล้ที่สุดให้อัตโนมัติ'));
  }
  function fieldPanel(f) {
    const s = D.site;
    return h('section', { class: 'ps-sec' }, h('h3', {}, icon('fa-futbol'), ` ${SM.FIELDS[f.t] || 'สนาม'}`),
      h('label', { class: 'sd-sel' }, 'ชนิด', h('select', { onchange: e => { snapshot(); f.t = e.target.value; draw(); } }, Object.entries(SM.FIELDS).map(([v, tt]) => h('option', { value: v, text: tt, selected: f.t === v })))),
      h('div', { class: 'sd-row3' },
        num('ยาว', r1(f.w * s.mpp), { min: 5, max: 200, step: 1 }, v => { snapshot(); f.w = M(clamp(v, 5, 200)); draw(); }, 'ม.'),
        num('กว้าง', r1(f.d * s.mpp), { min: 5, max: 200, step: 1 }, v => { snapshot(); f.d = M(clamp(v, 5, 200)); draw(); }, 'ม.'),
        num('หมุน', f.rot || 0, { min: 0, max: 359, step: 15 }, v => { snapshot(); f.rot = ((Math.round(v) % 360) + 360) % 360; draw(); }, '°')),
      h('button', { class: 'ps-btn ps-btn--danger ps-btn--block', type: 'button', id: 'sdDelete', onclick: deleteSel }, icon('fa-trash-can'), ' ลบสนาม'));
  }
  function sitePanel() {
    const s = D.site;
    const wIn = h('input', { type: 'number', min: 10, max: 5000, step: 1, value: Math.round(s.W * s.mpp), id: 'sdSiteW', 'aria-label': 'ความกว้างจริงของแผนที่ (เมตร)', onchange: e => { const v = parseFloat(e.target.value); if (v > 0) setScale(v / s.W); } });
    return h('div', {},
      h('section', { class: 'ps-sec' + (D.dirtyScale ? ' sd-attn' : '') },
        h('h3', {}, icon('fa-ruler-combined'), ' มาตราส่วน'),
        h('div', { class: 'ps-size' }, h('label', {}, 'แผนที่กว้างจริง', h('span', { class: 'ps-num' }, wIn, h('small', { text: 'ม.' }))),
          h('div', {}, h('small', { text: 'ยาว' }), h('b', { text: `${fmt(s.H * s.mpp, 0)} ม.` }))),
        h('p', { class: 'ps-note' }, icon(D.dirtyScale ? 'fa-triangle-exclamation' : 'fa-circle-info'), D.dirtyScale ? ' ยังไม่ได้ตั้งมาตราส่วน — ใส่ความกว้างจริง หรือวัดเทียบกับอาคาร/ถนนที่รู้ขนาด' : ` 1 ช่องตาราง = 10 ม. · พื้นที่ ${fmt(s.W * s.H * s.mpp * s.mpp / 1600, 0)} ไร่`),
        h('button', { class: 'ps-btn ps-btn--block', type: 'button', onclick: () => setTool('measure') }, icon('fa-ruler'), ' วัดเทียบจากระยะที่รู้')),
      h('section', { class: 'ps-sec' },
        h('h3', {}, icon('fa-map'), ' แผนที่และพื้น'),
        h('label', { class: 'sd-txt' }, h('span', { text: 'ชื่อผัง' }), h('input', { type: 'text', value: s.name || '', maxLength: 60, id: 'sdSiteName', oninput: e => { s.name = e.target.value || 'ผังบริเวณ'; } })),
        D.img ? h('label', { class: 'sd-range' }, 'ภาพแผนที่ (จาง ↔ ชัด)', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: D.opts.underlay, oninput: e => { D.opts.underlay = +e.target.value; draw(); } })) : null,
        h('label', { class: 'sd-sel' }, 'พื้นหลัก', h('select', { onchange: e => { snapshot(); s.base = e.target.value; draw(); } }, [['grass', 'สนามหญ้า'], ['concrete', 'ลานคอนกรีต'], ['dirt', 'ลานดิน'], ['sand', 'ทราย']].map(([v, tt]) => h('option', { value: v, text: tt, selected: (s.base || 'grass') === v })))),
        D.img ? h('label', { class: 'sd-sel' }, 'แผนที่บนพื้นในฉาก 3D', h('select', { id: 'sdUnderlay3d', onchange: e => { s.underlay = +e.target.value; } }, [[0, 'ไม่แสดง (สมจริง)'], [0.35, 'จาง ๆ'], [0.75, 'ชัด']].map(([v, tt]) => h('option', { value: v, text: tt, selected: (s.underlay || 0) === v })))) : null),
      h('section', { class: 'ps-sec' },
        h('h3', {}, icon('fa-wand-magic-sparkles'), ' ช่วยวางอัตโนมัติ'),
        D.img ? h('button', { class: 'ps-btn ps-btn--block', type: 'button', id: 'sdAutoAreas', onclick: autoAreas }, icon('fa-droplet'), ' หาบ่อน้ำ สนามหญ้า ถนน จากสีแผนที่') : null,
        h('button', { class: 'ps-btn ps-btn--block', type: 'button', id: 'sdAutoLamps', onclick: () => {
          snapshot();
          s.props = s.props.filter(p => p.t !== 'lamp');
          let n = 0;
          s.roads.forEach(r => { if (r.w >= 5) { const L = SM.lampsAlong(s, r, 30).filter(l => !s.buildings.some(b => { const q = local(b, l.x, l.y); return Math.abs(q.x) < b.w / 2 + 2 && Math.abs(q.y) < b.d / 2 + 2; })); s.props.push(...L); n += L.length; } });
          renderPanel(); draw(); toast(n ? `ใส่เสาไฟถนน ${n} ต้นตามถนนทุกเส้น` : 'ยังไม่มีถนน — วาดถนนก่อน', n ? 'ok' : 'info', 2000);
        } }, icon('fa-lightbulb'), ' ไฟถนนตามถนนทุกเส้น'),
        h('button', { class: 'ps-btn ps-btn--block', type: 'button', onclick: async () => {
          const ok = await UI.confirm({ title: 'ล้างผังทั้งหมด?', message: 'อาคาร ถนน ต้นไม้ เสาไฟ และพื้นที่ที่ระบายจะถูกลบ (ภาพแผนที่ยังอยู่)', confirmText: 'ล้างผัง' });
          if (!ok) return;
          snapshot();
          Object.assign(s, { buildings: [], roads: [], props: [], poles: [], fields: [], fences: [] });
          D.ground.data.fill(0); refreshGround(); D.sel = null; renderPanel(); draw();
        } }, icon('fa-broom'), ' ล้างผังทั้งหมด')),
      h('p', { class: 'ps-note sd-help' }, icon('fa-keyboard'), ' คีย์ลัด: V เลือก · H เลื่อน · B อาคาร · R ถนน · A พื้นที่ · T ต้นไม้ · P เสาไฟ · F สนาม · L รั้ว · M วัด · Ctrl+Z ย้อน · Delete ลบ · [ ] หมุน · Ctrl+D สำเนา'));
  }
  function autoAreas() {
    if (!D.imgData) { toast('อ่านสีจากภาพนี้ไม่ได้', 'warn', 2400); return; }
    snapshot();
    const st = SM.autoAreas(D.imgData, D.ground);
    refreshGround(); draw();
    const c = D.ground.cell * D.site.mpp, a = n => fmt(n * c * c, 0);
    toast(`พบ บ่อน้ำ ${a(st.water)} · หญ้า ${a(st.grass)} · ถนน/ลาน ${a(st.road)} ตร.ม. (แก้ด้วยแปรง/ยางลบได้)`, 'ok', 4200);
  }

  /* =========================================================================
     คีย์ลัด (PlanScanUI ส่งต่อมาให้)
     ========================================================================= */
  function onKey(e) {
    if (!visible()) return false;
    const typing = /INPUT|SELECT|TEXTAREA/.test((e.target && e.target.tagName) || '');
    if (e.key === ' ' && !typing) { D.space = e.type === 'keydown'; e.preventDefault(); return true; }
    if (e.type !== 'keydown') return false;
    if (e.key === 'Escape') {
      if (D.draft) { if (D.draft.kind === 'line' && D.draft.pts.length >= (D.draft.tool === 'pole' ? 1 : 2)) finishLine(); else { D.draft = null; draw(); } return true; }
      if (D.measure && D.measure.a) { D.measure = { a: null, b: null }; D.el.measure.hidden = true; draw(); return true; }
      if (D.sel) { D.sel = null; renderPanel(); draw(); return true; }
      return false;
    }
    if (typing) { if (e.key === 'Enter' && e.target.id === 'sdMeasureInput') return true; return true; }
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); return true; }
    if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); duplicateSel(); return true; }
    if (e.key === 'Enter') { finishLine(); return true; }
    if (k === 'delete' || k === 'backspace') {
      e.preventDefault();
      if (D.draft && D.draft.kind === 'line') { D.draft.pts.pop(); if (!D.draft.pts.length) D.draft = null; draw(); }
      else deleteSel();
      return true;
    }
    if (e.key === '[' || e.key === ']') { rotateSel(e.key === '[' ? -15 : 15); return true; }
    if (e.key.startsWith('Arrow') && D.sel) {
      e.preventDefault();
      const st = M(e.shiftKey ? 5 : 1), dx = e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, dy = e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0;
      const key = { building: 'buildings', prop: 'props', field: 'fields' }[D.sel.type];
      snapshot();
      if (key) { const o = D.site[key][D.sel.i]; o.x = r1(o.x + dx); o.y = r1(o.y + dy); }
      else { const line = selectedLine(); if (line) line.pts = line.pts.map(([x, y]) => [r1(x + dx), r1(y + dy)]); }
      draw();
      return true;
    }
    const map = { v: 'select', h: 'pan', b: 'building', r: 'road', a: 'area', t: 'prop', p: 'pole', f: 'field', l: 'fence', m: 'measure' };
    if (!e.ctrlKey && !e.metaKey && map[k]) { setTool(map[k]); return true; }
    if (k === '+' || k === '=') { zoomAt(1.25); return true; }
    if (k === '-') { zoomAt(0.8); return true; }
    return false;
  }

  /* =========================================================================
     ส่งผล
     ========================================================================= */
  function result() {
    const s = D.site;
    if (D.draft && D.draft.kind === 'line') finishLine();
    return Object.assign({}, s, { v: 2, kind: 'site', ground: SM.packGround(D.ground) });
  }
  function apply() {
    const s = D.site;
    if (!s.buildings.length) { toast('ยังไม่มีอาคาร — เลือกเครื่องมือ "อาคาร" แล้วลากกรอบทับอาคารในแผนที่', 'err', 3600); setTool('building'); return; }
    if (!s.buildings.some(b => ((b.plan && b.plan.rooms) || []).some(r => !r.h))) { toast('อาคารยังไม่มีห้อง', 'err', 2600); return; }
    if (D.onApply) D.onApply(result());
  }

  window.SiteDesigner = {
    mount, open, draw, fit, onKey, result, apply, dirty: () => D.history.length > 0,
    state: () => D, _setTool: setTool, _undo: undo, _hit: hit, _finishLine: finishLine, _delete: deleteSel
  };
})();
