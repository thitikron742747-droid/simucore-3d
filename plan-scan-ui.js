/* ==========================================================================
   SimuCore — หน้าต่าง "สแกนแผนผังห้อง" (ใช้กับ plan-scan.js)
   ขั้นที่ 1 เลือกไฟล์ (รูป/กล้อง/SVG/PDF/DXF/ตัวอย่าง) → 2 ปรับกรอบ 4 มุม (ภาพถ่าย) →
   3 ตรวจผล แก้ผนัง/ประตู/ชื่อห้อง/มาตราส่วน → สร้างห้อง 3D
   ========================================================================== */
(function () {
  'use strict';
  const PS = window.PlanScan;
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const MAX_SRC = 1600, MAX_SCAN = 1000;

  const PROPS = ['value', 'checked', 'disabled', 'hidden', 'title', 'type', 'min', 'max', 'step', 'placeholder', 'accept', 'selected'];
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
  const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });

  const S = {
    built: false, open: false, step: 1, onApply: null, existing: null,
    src: null, name: '', quad: null, base: null, kind: 'raster',
    plan: null, imgCanvas: null, roomCanvas: null, inkCanvas: null,
    history: [], tool: 'select', sel: null, draft: null, measure: null, pickColor: false,
    opts: { sens: 0, diagonal: true, invert: 'auto', fill: false, color: null, tol: 60 },
    style: 'dark', showImg: true, showInk: false, scaleLocked: false, busy: false,
    mode: 'plan', siteExisting: null, onApplySite: null, sub: null
  };
  const STEP_LABELS = { plan: ['เลือกไฟล์', 'ปรับกรอบ', 'ตรวจและแก้ไข'], site: ['เลือกแผนที่', 'ปรับกรอบ', 'วางอาคารและสิ่งแวดล้อม'] };
  let el = {};

  /* =========================================================================
     โครงหน้าต่าง
     ========================================================================= */
  function build() {
    if (S.built) return;
    S.built = true;
    const fileIn = h('input', { type: 'file', accept: 'image/*,.svg,.pdf,.dxf,.json,application/pdf,image/svg+xml', hidden: true, id: 'psFile', onchange: e => pickFile(e.target) });
    const camIn = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, id: 'psCam', onchange: e => pickFile(e.target) });
    el.steps = h('ol', { class: 'ps-steps', 'aria-label': 'ขั้นตอน' }, ['เลือกไฟล์', 'ปรับกรอบ', 'ตรวจและแก้ไข'].map((t, i) => h('li', { 'data-s': i + 1 }, h('b', { text: i + 1 }), h('span', { text: t }))));
    // ขั้นที่ 1
    el.drop = h('label', { class: 'ps-drop', for: 'psFile', tabindex: '0' },
      h('span', { class: 'ps-drop__ic' }, icon('fa-file-arrow-up')),
      h('b', { text: 'ลากไฟล์แผนผังมาวางที่นี่ หรือแตะเพื่อเลือก' }),
      h('span', { text: 'รูปถ่าย/รูปสแกน JPG PNG WebP · SVG · PDF (หน้าแรก) · DXF จาก AutoCAD' }));
    el.drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
    ['dragenter', 'dragover'].forEach(t => el.drop.addEventListener(t, e => { e.preventDefault(); el.drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach(t => el.drop.addEventListener(t, e => { e.preventDefault(); el.drop.classList.remove('is-over'); }));
    el.drop.addEventListener('drop', e => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) loadFile(f); });
    el.existingBtn = h('button', { class: 'ps-btn', type: 'button', hidden: true, onclick: () => editExisting() }, icon('fa-pen-ruler'), ' แก้ไขแผนผังเดิม');
    el.mode = h('div', { class: 'ps-mode', role: 'tablist', 'aria-label': 'สิ่งที่ต้องการสร้าง' },
      h('button', { type: 'button', role: 'tab', 'data-mode': 'plan', id: 'psModePlan', onclick: () => setMode('plan') }, icon('fa-house-chimney'),
        h('span', {}, h('b', { text: 'แผนผังห้อง / อาคารเดียว' }), h('small', { text: 'ผนัง ประตู หน้าต่าง จากแบบบ้านหรือแบบอาคาร' }))),
      h('button', { type: 'button', role: 'tab', 'data-mode': 'site', id: 'psModeSite', onclick: () => setMode('site') }, icon('fa-school'),
        h('span', {}, h('b', { text: 'ผังบริเวณ (หลายอาคาร)' }), h('small', { text: 'แผนที่โรงเรียน/วิทยาลัย: อาคาร ห้อง ถนน ต้นไม้ เสาไฟ บ่อน้ำ' }))));
    el.planBtns = h('div', { class: 'ps-start__btns' },
        h('button', { class: 'ps-btn', type: 'button', onclick: () => fileIn.click() }, icon('fa-folder-open'), ' เลือกไฟล์'),
        h('button', { class: 'ps-btn', type: 'button', onclick: () => camIn.click() }, icon('fa-camera'), ' ถ่ายรูปแผนผัง'),
        h('button', { class: 'ps-btn', type: 'button', id: 'psSample', onclick: () => useSample() }, icon('fa-house'), ' ลองกับแผนผังตัวอย่าง'),
        el.existingBtn);
    el.siteExistingBtn = h('button', { class: 'ps-btn', type: 'button', hidden: true, id: 'psSiteEdit', onclick: () => editExistingSite() }, icon('fa-pen-ruler'), ' แก้ไขผังบริเวณเดิม');
    el.siteBtns = h('div', { class: 'ps-start__btns', hidden: true },
      h('button', { class: 'ps-btn', type: 'button', onclick: () => fileIn.click() }, icon('fa-folder-open'), ' เลือกไฟล์แผนที่'),
      h('button', { class: 'ps-btn', type: 'button', onclick: () => camIn.click() }, icon('fa-camera'), ' ถ่ายรูปแผนที่'),
      h('button', { class: 'ps-btn', type: 'button', id: 'psSiteSample', onclick: () => useCollege() }, icon('fa-school'), ' ตัวอย่าง: วิทยาลัยการอาชีพชนแดน'),
      h('button', { class: 'ps-btn', type: 'button', id: 'psSiteBlank', onclick: () => blankSite() }, icon('fa-border-all'), ' เริ่มจากผังว่าง'),
      el.siteExistingBtn);
    el.siteTips = h('ul', { class: 'ps-tips', hidden: true },
      h('li', {}, icon('fa-map'), ' ใช้แผนที่ผังโรงเรียน/วิทยาลัย ภาพจากป้ายแผนที่ หรือภาพแคปจากแผนที่ดาวเทียม'),
      h('li', {}, icon('fa-ruler-combined'), ' ตั้งมาตราส่วนครั้งแรกด้วยการวัดเทียบความยาวอาคารหรือถนนที่รู้ระยะจริง'),
      h('li', {}, icon('fa-building'), ' ลากกรอบทับอาคาร ตั้งจำนวนชั้นและห้อง วาดถนน แนวเสาไฟฟ้า ระบายบ่อน้ำ ปลูกต้นไม้'),
      h('li', {}, icon('fa-network-wired'), ' สร้างฉาก 3D แล้ววางอุปกรณ์ในแต่ละห้อง สายระหว่างอาคารพาดตามเสาไฟให้อัตโนมัติ'));
    el.step1 = h('section', { class: 'ps-body ps-start', 'data-step': 1 },
      el.mode,
      el.drop,
      el.planBtns, el.siteBtns,
      el.planTips = h('ul', { class: 'ps-tips' },
        h('li', {}, icon('fa-camera'), ' ถ่ายตรง ๆ ให้เห็นทั้งแผ่น แสงสม่ำเสมอ ไม่มีเงามือบัง — ขั้นต่อไปลากมุมกระดาษให้ตรงได้'),
        h('li', {}, icon('fa-pen'), ' ผนังสีเข้มบนพื้นขาวได้ผลดีที่สุด รูปวาดมือด้วยปากกาก็ใช้ได้'),
        h('li', {}, icon('fa-ruler-combined'), ' ระบบเดาขนาดจริงจากความกว้างประตู (ประมาณ 0.9 ม.) ไฟล์ DXF ใช้หน่วยในไฟล์ได้ขนาดจริงเป๊ะ'),
        h('li', {}, icon('fa-map'), ' แผนที่อาคาร: เปิด "พื้นที่ทึบ" แล้วแตะเลือกสีอาคารในขั้นตรวจผล')),
      el.siteTips,
      fileIn, camIn);
    // ขั้นที่ 2
    el.cropCanvas = h('canvas', { class: 'ps-canvas', 'aria-label': 'ภาพแผนผัง ลากจุดมุมทั้ง 4 ให้ตรงขอบแผนผัง' });
    el.cropStage = h('div', { class: 'ps-stage ps-stage--crop' }, el.cropCanvas,
      h('div', { class: 'ps-stage__hint' }, icon('fa-hand-pointer'), ' ลากจุดมุมทั้ง 4 ให้ตรงมุมแผนผัง (แก้ภาพถ่ายเอียงได้)'));
    el.step2 = h('section', { class: 'ps-body ps-crop', 'data-step': 2, hidden: true },
      h('div', { class: 'ps-toolbar' },
        h('button', { class: 'ps-tool', type: 'button', onclick: () => { S.quad = fullQuad(); drawCrop(); } }, icon('fa-expand'), ' ทั้งภาพ'),
        h('button', { class: 'ps-tool', type: 'button', id: 'psAuto', onclick: () => { S.quad = autoQuad(); drawCrop(); } }, icon('fa-wand-magic-sparkles'), ' ตามเส้นในรูป'),
        h('button', { class: 'ps-tool', type: 'button', onclick: () => rotate90(-1), title: 'หมุนซ้าย 90°' }, icon('fa-rotate-left'), ' หมุนซ้าย'),
        h('button', { class: 'ps-tool', type: 'button', onclick: () => rotate90(1), title: 'หมุนขวา 90°' }, icon('fa-rotate-right'), ' หมุนขวา')),
      el.cropStage,
      h('footer', { class: 'ps-foot' },
        h('button', { class: 'ps-btn', type: 'button', onclick: () => go(1) }, icon('fa-arrow-left'), ' เลือกไฟล์ใหม่'),
        el.scanBtn = h('button', { class: 'ps-btn ps-btn--main', type: 'button', id: 'psScan', onclick: () => (S.mode === 'site' ? mapFromCrop() : scanFromCrop()) }, icon('fa-wand-magic-sparkles'), ' สแกนหาผนังและห้อง')));
    // ขั้นที่ 3
    el.canvas = h('canvas', { class: 'ps-canvas', 'aria-label': 'ผลการสแกน: ผนังสีแดง ประตูสีเขียว หน้าต่างสีฟ้า ห้องเป็นสีอ่อน' });
    el.busy = h('div', { class: 'ps-busy', hidden: true }, h('span', { class: 'ps-spin' }), h('b', { text: 'กำลังสแกนแผนผัง…' }));
    el.measureBox = h('div', { class: 'ps-measure', hidden: true });
    el.stage = h('div', { class: 'ps-stage' }, el.canvas, el.busy, el.measureBox);
    const tools = [['select', 'fa-arrow-pointer', 'เลือก/ลบ', 'V'], ['wall', 'fa-pen-ruler', 'วาดผนัง', 'W'], ['door', 'fa-door-open', 'เจาะประตู', 'D'], ['measure', 'fa-ruler', 'วัดเทียบระยะ', 'M']];
    el.tools = h('div', { class: 'ps-toolbar', role: 'toolbar' },
      tools.map(([id, ic, t, key]) => h('button', { class: 'ps-tool', type: 'button', 'data-tool': id, title: `${t} (${key})`, onclick: () => setTool(id) }, icon(ic), ' ' + t)),
      h('button', { class: 'ps-tool', type: 'button', id: 'psUndo', title: 'ย้อนกลับ (Ctrl+Z)', onclick: undo }, icon('fa-rotate-left'), ' ย้อน'),
      h('span', { class: 'ps-toolbar__sp' }),
      h('label', { class: 'ps-chk' }, h('input', { type: 'checkbox', checked: true, onchange: e => { S.showImg = e.target.checked; drawStage(); } }), ' ภาพต้นฉบับ'),
      h('label', { class: 'ps-chk' }, h('input', { type: 'checkbox', onchange: e => { S.showInk = e.target.checked; drawStage(); } }), ' เส้นที่ระบบเห็น'));
    el.panel = h('aside', { class: 'ps-panel' });
    el.applyBtn = h('button', { class: 'ps-btn ps-btn--main', type: 'button', id: 'psApply', onclick: apply }, icon('fa-cube'), ' สร้างห้อง 3D');
    el.step3 = h('section', { class: 'ps-body ps-edit', 'data-step': 3, hidden: true },
      h('div', { class: 'ps-edit__main' }, el.tools, el.stage,
        h('p', { class: 'ps-legend' }, h('span', { class: 'lg lg--wall' }), 'ผนัง', h('span', { class: 'lg lg--door' }), 'ประตู/ช่องเปิด', h('span', { class: 'lg lg--win' }), 'หน้าต่าง', h('span', { class: 'lg lg--room' }), 'ห้อง (สีตามห้อง)')),
      el.panel,
      h('footer', { class: 'ps-foot' },
        el.newFileBtn = h('button', { class: 'ps-btn', type: 'button', onclick: () => go(1) }, icon('fa-file-arrow-up'), ' เลือกไฟล์ใหม่'),
        h('span', { class: 'ps-foot__sp' }),
        h('button', { class: 'ps-btn', type: 'button', onclick: () => (S.sub ? endSub(false) : close()) }, 'ยกเลิก'),
        el.applyBtn));
    // ขั้นออกแบบผังบริเวณ (site-designer.js)
    el.step4 = h('section', { class: 'ps-body ps-site', 'data-step': 4, hidden: true });
    if (window.SiteDesigner) SiteDesigner.mount(el.step4, {
      onApply: json => applySite(json),
      onBack: () => requestClose(() => go(1)),
      onCancel: () => requestClose(),
      onInterior: (plan, title, done) => editSubPlan(plan, { title, onDone: done })
    });
    el.modal = h('div', { class: 'ps-modal glass', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'psTitle' },
      h('header', { class: 'ps-head' },
        h('span', { class: 'ps-head__ic' }, icon('fa-object-group')),
        h('div', { class: 'ps-head__t' }, el.title = h('h2', { id: 'psTitle', text: 'สแกนแผนผังห้อง' }), el.subtitle = h('p', { text: 'แปลงรูปถ่าย ภาพแผนผัง หรือไฟล์ CAD เป็นห้อง 3D สำหรับวางเครือข่าย' })),
        el.steps,
        h('button', { class: 'ps-x', type: 'button', 'aria-label': 'ปิด', onclick: () => requestClose() }, icon('fa-xmark'))),
      el.step1, el.step2, el.step3, el.step4);
    el.overlay = h('div', { class: 'ps-overlay', id: 'psOverlay', hidden: true }, el.modal);
    document.body.append(el.overlay);

    // คีย์ลัด (ดักก่อนคีย์ลัดของห้องแล็บ)
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', e => { if (S.open && S.step === 4 && window.SiteDesigner && e.key === ' ') { e.stopPropagation(); SiteDesigner.onKey(e); } }, true);
    bindCrop();
    bindStage();
    const redraw = () => { if (!S.open) return; if (S.step === 2) drawCrop(); else if (S.step === 3) drawStage(); else if (S.step === 4 && window.SiteDesigner) SiteDesigner.draw(); };
    if (window.ResizeObserver) new ResizeObserver(redraw).observe(el.overlay);
    else window.addEventListener('resize', redraw);
  }
  function go(step) {
    S.step = step;
    [el.step1, el.step2, el.step3, el.step4].forEach((s, i) => { s.hidden = i + 1 !== step; });
    const shown = step === 4 ? 3 : step, labels = S.sub ? ['แผนผังบริเวณ', 'อาคาร', 'จัดห้องภายในอาคาร'] : STEP_LABELS[S.mode] || STEP_LABELS.plan;
    el.steps.querySelectorAll('li').forEach(li => { const n = +li.dataset.s; li.className = n === shown ? 'is-on' : n < shown ? 'is-done' : ''; li.querySelector('span').textContent = labels[n - 1]; });
    el.modal.classList.toggle('ps-modal--wide', step >= 3);
    el.modal.classList.toggle('is-sub', !!S.sub);
    el.newFileBtn.hidden = !!S.sub;
    el.applyBtn.innerHTML = '';
    el.applyBtn.append(icon(S.sub ? 'fa-check' : 'fa-cube'), S.sub ? ' บันทึกห้องในอาคาร' : ' สร้างห้อง 3D');
    requestAnimationFrame(() => (step === 2 ? drawCrop() : step === 3 ? (drawStage(), renderPanel()) : step === 4 && window.SiteDesigner ? SiteDesigner.draw() : null));
  }
  function setMode(m) {
    S.mode = m === 'site' && window.SiteDesigner ? 'site' : 'plan';
    const site = S.mode === 'site';
    el.mode.querySelectorAll('[data-mode]').forEach(b => { const on = b.dataset.mode === S.mode; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', String(on)); });
    el.planBtns.hidden = site; el.planTips.hidden = site;
    el.siteBtns.hidden = !site; el.siteTips.hidden = !site;
    el.drop.querySelector('b').textContent = site ? 'ลากภาพแผนที่โรงเรียน/วิทยาลัยมาวางที่นี่ หรือแตะเพื่อเลือก' : 'ลากไฟล์แผนผังมาวางที่นี่ หรือแตะเพื่อเลือก';
    el.drop.querySelectorAll('span')[1].textContent = site ? 'รูปแผนที่ JPG PNG WebP · PDF (หน้าแรก) · ภาพแคปแผนที่ดาวเทียม' : 'รูปถ่าย/รูปสแกน JPG PNG WebP · SVG · PDF (หน้าแรก) · DXF จาก AutoCAD';
    el.title.textContent = site ? 'ออกแบบผังบริเวณ' : 'สแกนแผนผังห้อง';
    el.subtitle.textContent = site ? 'วางอาคาร ห้อง ถนน ต้นไม้ เสาไฟฟ้า บ่อน้ำ บนแผนที่จริง แล้วสร้างวิทยาเขต 3D สำหรับเดินสายเครือข่าย' : 'แปลงรูปถ่าย ภาพแผนผัง หรือไฟล์ CAD เป็นห้อง 3D สำหรับวางเครือข่าย';
    el.scanBtn.innerHTML = '';
    el.scanBtn.append(icon(site ? 'fa-map-location-dot' : 'fa-wand-magic-sparkles'), site ? ' ใช้ภาพนี้เป็นแผนที่' : ' สแกนหาผนังและห้อง');
    if (S.step <= 2) go(S.step);
  }
  function open(o) {
    build();
    const opt = o || {};
    S.onApply = opt.onApply || null;
    S.existing = opt.plan || null;
    S.siteExisting = opt.site || null;
    S.onApplySite = opt.onApplySite || null;
    S.sub = null;
    el.existingBtn.hidden = !S.existing;
    el.siteExistingBtn.hidden = !S.siteExisting;
    el.mode.hidden = !S.onApplySite || !window.SiteDesigner;
    S.open = true;
    el.overlay.hidden = false;
    document.body.classList.add('ps-open');
    setMode(opt.mode === 'site' ? 'site' : 'plan');
    go(1);
    if (opt.edit && S.mode === 'site' && S.siteExisting) editExistingSite();
    else if (opt.edit && S.existing) editExisting();
    setTimeout(() => { if (S.step === 1) el.drop.focus(); }, 50);
  }
  // ปิด/ย้อนจากหน้าออกแบบผังบริเวณ: ถามก่อนถ้ามีงานที่ยังไม่ได้สร้าง 3D
  async function requestClose(then) {
    if (S.step === 4 && window.SiteDesigner && SiteDesigner.dirty() && window.UI) {
      const ok = await UI.confirm({ title: 'ทิ้งผังที่กำลังออกแบบ?', message: 'อาคาร ถนน ต้นไม้ และเสาไฟที่วางไว้ยังไม่ได้สร้างเป็นฉาก 3D ถ้าออกตอนนี้งานจะหายไป', confirmText: 'ทิ้งงานนี้' });
      if (!ok) return;
    }
    if (then) then(); else close();
  }
  function close() {
    S.open = false;
    S.sub = null;
    if (el.overlay) el.overlay.hidden = true;
    document.body.classList.remove('ps-open');
    S.measure = null; S.draft = null; S.pickColor = false;
  }
  function setBusy(on, text) {
    S.busy = on;
    el.busy.hidden = !on;
    if (text) el.busy.querySelector('b').textContent = text;
  }
  const later = fn => new Promise((res, rej) => setTimeout(() => { try { res(fn()); } catch (e) { rej(e); } }, 40));

  /* =========================================================================
     ขั้นที่ 1: เปิดไฟล์
     ========================================================================= */
  function pickFile(input) {
    const f = input.files && input.files[0];
    input.value = '';
    if (f) loadFile(f);
  }
  async function loadFile(file) {
    const name = (file.name || 'แผนผัง').replace(/\.[^.]+$/, '');
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    S.name = name;
    try {
      if (S.mode === 'site') {
        if (ext === 'json') return await loadSiteJSON(file);
        if (ext === 'dxf') { toast('ผังบริเวณใช้ภาพแผนที่ (JPG PNG PDF SVG) — ไฟล์ DXF ใช้กับ "แผนผังห้อง / อาคารเดียว"', 'warn', 4200); return; }
        if (ext === 'svg' || file.type === 'image/svg+xml') return startCrop(await imageToCanvas(file), name);
      }
      if (ext === 'dxf') return await loadDXF(file, name);
      if (ext === 'json') return await loadJSON(file);
      if (ext === 'svg' || file.type === 'image/svg+xml') return await loadSVG(file, name);
      if (ext === 'pdf' || file.type === 'application/pdf') return await loadPDF(file, name);
      if (/^image\//.test(file.type) || /^(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/.test(ext)) {
        const canvas = await imageToCanvas(file);
        return startCrop(canvas, name);
      }
      toast('ไฟล์ชนิดนี้ยังไม่รองรับ — ใช้รูป JPG/PNG, SVG, PDF หรือ DXF', 'err', 4200);
    } catch (e) {
      console.error(e);
      toast(e.message || 'เปิดไฟล์ไม่ได้', 'err', 4800);
    }
  }
  function imageToCanvas(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob), img = new Image();
      img.onload = () => {
        const f = Math.min(1, MAX_SRC / Math.max(img.naturalWidth, img.naturalHeight));
        const c = h('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * f)); c.height = Math.max(1, Math.round(img.naturalHeight * f));
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดรูปนี้ไม่ได้ (ถ้าเป็นไฟล์ HEIC ของ iPhone ให้บันทึกเป็น JPG ก่อน)')); };
      img.src = url;
    });
  }
  const imageData = c => c.getContext('2d').getImageData(0, 0, c.width, c.height);
  function canvasFrom(img) {
    const c = h('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(img instanceof ImageData ? img : new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    return c;
  }
  async function loadDXF(file, name) {
    const buf = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    if (/ANSI_874/i.test(text.slice(0, 20000)) && /�/.test(text)) { try { text = new TextDecoder('windows-874').decode(buf); } catch (e) { /* ใช้ UTF-8 */ } }
    setBusy(true, 'กำลังอ่านไฟล์ DXF…');
    go(3);
    const plan = await later(() => PS.analyzeVector(PS.parseDXF(text)));
    setBusy(false);
    if (!plan.rooms.length && !plan.walls.length) throw new Error('ไม่พบเส้นผนังในไฟล์ DXF');
    S.kind = 'vector'; S.base = null; S.scaleLocked = true;
    plan.name = name;
    setPlan(plan, renderPlanImage(plan));
    toast(`อ่าน DXF แล้ว: ผนัง ${plan.walls.length} เส้น ห้อง ${plan.rooms.length} ห้อง (ขนาดจริงตามหน่วยในไฟล์)`, 'ok', 3600);
  }
  async function loadJSON(file) {
    const data = JSON.parse(await file.text());
    const json = data && data.walls ? data : data && data.room && data.room.plan ? data.room.plan : null;
    if (!json) throw new Error('ไฟล์ JSON นี้ไม่มีแผนผัง (ต้องเป็นไฟล์ที่ส่งออกจาก SimuCore)');
    await openJSON(json);
  }
  async function loadSVG(file, name) {
    const text = await file.text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg') throw new Error('ไฟล์ SVG ไม่ถูกต้อง');
    const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    let w = parseFloat(svg.getAttribute('width')) || (vb.length === 4 ? vb[2] : 1000), hh = parseFloat(svg.getAttribute('height')) || (vb.length === 4 ? vb[3] : 700);
    const f = 1200 / Math.max(w, hh);
    w = Math.round(w * f); hh = Math.round(hh * f);
    svg.setAttribute('width', w); svg.setAttribute('height', hh);
    if (vb.length !== 4) svg.setAttribute('viewBox', `0 0 ${w / f} ${hh / f}`);
    const src = new XMLSerializer().serializeToString(svg);
    const canvas = await imageToCanvas(new Blob([src], { type: 'image/svg+xml' }));
    // ตำแหน่งข้อความในภาพ (ใช้เป็นชื่อห้อง)
    const host = h('div', { style: 'position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none' });
    host.innerHTML = src;
    document.body.append(host);
    const live = host.querySelector('svg'), box = live.getBoundingClientRect(), k = canvas.width / (box.width || canvas.width);
    const texts = [...live.querySelectorAll('text')].map(t => { const r = t.getBoundingClientRect(); return { x: (r.left + r.width / 2 - box.left) * k, y: (r.top + r.height / 2 - box.top) * k, h: r.height * k, text: (t.textContent || '').trim() }; });
    host.remove();
    S.svgTexts = texts;
    S.kind = 'raster';
    S.src = canvas; S.quad = fullQuad();
    await scanFromCrop();
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if ([...document.scripts].some(s => s.src === src)) return resolve();
      const s = h('script', { src });
      s.onload = () => resolve(); s.onerror = () => reject(new Error('โหลดตัวอ่าน PDF ไม่ได้ (ต้องต่ออินเทอร์เน็ต)'));
      document.head.append(s);
    });
  }
  async function loadPDF(file, name) {
    setBusy(true, 'กำลังเปิด PDF…');
    go(3);
    try {
      await loadScript(PDFJS);
      const lib = window.pdfjsLib;
      if (!lib) throw new Error('โหลดตัวอ่าน PDF ไม่ได้');
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      const page = await pdf.getPage(1);
      const v1 = page.getViewport({ scale: 1 }), sc = MAX_SRC / Math.max(v1.width, v1.height);
      const vp = page.getViewport({ scale: sc });
      const c = h('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      setBusy(false);
      startCrop(c, name);
    } catch (e) {
      setBusy(false);
      go(1);
      throw new Error((e && e.message ? e.message + ' — ' : '') + 'ลองแคปหน้าจอแผนผังจาก PDF เป็นรูปแล้วอัปโหลดแทน');
    }
  }
  async function openJSON(json) {
    const plan = PS.restore(json);
    plan.name = json.name || 'แผนผัง';
    S.name = plan.name; S.style = json.style || 'dark'; S.kind = 'saved'; S.base = null; S.scaleLocked = true;
    let img = null;
    if (json.img) img = await new Promise(res => { const im = new Image(); im.onload = () => { const c = h('canvas'); c.width = plan.W; c.height = plan.H; c.getContext('2d').drawImage(im, 0, 0, plan.W, plan.H); res(c); }; im.onerror = () => res(null); im.src = json.img; });
    if (img) { S.base = imageData(img); S.kind = 'raster'; }
    go(3);
    setPlan(plan, img || renderPlanImage(plan));
  }
  function editExisting() { if (S.existing) openJSON(S.existing).catch(e => toast(e.message, 'err')); }

  /* ------------------------------ แผนผังตัวอย่าง ------------------------------ */
  function makeSample() {
    const W = 1000, H = 700, c = h('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const T = 14, t = 8;
    g.fillStyle = '#111';
    const hw = (y, x1, x2, th, gaps = []) => { let cur = x1; for (const [a, b] of gaps.concat([[x2, x2]])) { if (a > cur) g.fillRect(cur, y - th / 2, a - cur, th); cur = b; } };
    const vw = (x, y1, y2, th, gaps = []) => { let cur = y1; for (const [a, b] of gaps.concat([[y2, y2]])) { if (a > cur) g.fillRect(x - th / 2, cur, th, a - cur); cur = b; } };
    // ภายนอก (หน้าต่าง: บนครัว บนห้องนอน 1, ขวาห้องนอน 2, ซ้ายห้องนั่งเล่น) และประตูหน้าบ้านด้านล่าง
    hw(67, 60, 940, T, [[120, 260], [680, 860]]); hw(633, 60, 940, T, [[497, 562]]);
    vw(67, 60, 640, T, [[420, 560]]); vw(933, 60, 640, T, [[430, 560]]);
    // ภายใน
    vw(470, 74, 626, t, [[150, 215], [420, 485]]);
    vw(590, 74, 626, t, [[250, 315], [420, 485]]);
    hw(330, 74, 470, t, [[150, 215]]);
    vw(330, 74, 330, t);
    hw(360, 590, 926, t);
    // หน้าต่าง: เส้นบาง 3 เส้น
    g.strokeStyle = '#111'; g.lineWidth = 1.2;
    const win = (x1, y1, x2, y2) => { for (const o of [-5, 0, 5]) { g.beginPath(); if (y1 === y2) { g.moveTo(x1, y1 + o); g.lineTo(x2, y2 + o); } else { g.moveTo(x1 + o, y1); g.lineTo(x2 + o, y2); } g.stroke(); } };
    win(120, 67, 260, 67); win(680, 67, 860, 67); win(933, 430, 933, 560); win(67, 420, 67, 560);
    // วงสวิงประตู
    g.strokeStyle = '#555'; g.lineWidth = 1;
    const arc = (x, y, r, a0, a1) => { g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke(); g.beginPath(); g.moveTo(x, y); g.lineTo(x + r * Math.cos(a1), y + r * Math.sin(a1)); g.stroke(); };
    arc(470, 150, 65, Math.PI / 2, Math.PI); arc(470, 485, 65, Math.PI, Math.PI * 1.5); arc(590, 315, 65, -Math.PI / 2, 0);
    arc(590, 420, 65, 0, Math.PI / 2); arc(150, 330, 65, 0, Math.PI / 2); arc(562, 633, 65, Math.PI, Math.PI * 1.5);
    // เฟอร์นิเจอร์
    g.strokeStyle = '#777';
    [[700, 110, 150, 120], [690, 430, 140, 110], [110, 520, 200, 70], [90, 90, 210, 40], [370, 90, 60, 40], [380, 250, 46, 52]].forEach(([x, y, w, hh]) => g.strokeRect(x, y, w, hh));
    g.beginPath(); g.ellipse(403, 200, 18, 24, 0, 0, Math.PI * 2); g.stroke();
    // ชื่อห้อง เส้นบอกขนาด และชื่อแบบ
    g.fillStyle = '#1f2937'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const names = [['ห้องครัว', 200, 200], ['ห้องน้ำ', 400, 150], ['ห้องนั่งเล่น', 268, 450], ['ทางเดิน', 530, 300], ['ห้องนอน 1', 760, 280], ['ห้องนอน 2', 760, 590]];
    g.font = '600 22px Prompt, "IBM Plex Sans Thai", sans-serif';
    names.forEach(([n, x, y]) => g.fillText(n, x, y));
    g.strokeStyle = '#333'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(60, 30); g.lineTo(940, 30); g.moveTo(60, 22); g.lineTo(60, 38); g.moveTo(940, 22); g.lineTo(940, 38); g.stroke();
    g.font = '500 16px "IBM Plex Sans Thai", sans-serif'; g.fillText('12.57 ม.', 500, 18);
    g.fillText('แผนผังบ้านตัวอย่าง ชั้น 1 (มาตราส่วน 1:100)', 500, 672);
    return { canvas: c, texts: names.map(([text, x, y]) => ({ text, x, y, h: 22 })) };
  }
  async function useSample() {
    const s = makeSample();
    S.name = 'บ้านตัวอย่าง';
    S.src = s.canvas; S.quad = fullQuad(); S.svgTexts = s.texts; S.kind = 'raster';
    await scanFromCrop();
  }

  /* ------------------------- ผังบริเวณ (โรงเรียน/วิทยาลัย) ------------------------- */
  const MAX_SITE = 1600;
  const loadImg = src => new Promise(res => { if (!src) return res(null); const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  const isPath = src => !!src && !/^data:/.test(src);
  function openSite(site, img, src, askScale) {
    S.siteImg = img || null;
    S.siteImgSrc = isPath(src) ? src : null;
    S.name = site.name || S.name;
    go(4);
    window.SiteDesigner.open(site, img || null, { askScale: !!askScale });
  }
  async function mapFromCrop() {
    if (!window.SiteModel || !window.SiteDesigner) return;
    const src = imageData(S.src), q = S.quad;
    const full = q[0].x === 0 && q[0].y === 0 && q[2].x === S.src.width && q[2].y === S.src.height && q[1].y === 0 && q[3].x === 0;
    const img = await later(() => (full ? PS.downscale(src, MAX_SITE) : PS.warpQuad(src, q, MAX_SITE)));
    const canvas = canvasFrom(img), W = canvas.width, H = canvas.height, mpp = 400 / Math.max(W, H);   // เดาไว้ก่อน: ด้านยาว ≈ 400 ม.
    const site = SiteModel.blank({ widthM: W * mpp, heightM: H * mpp, mpp, name: S.name || 'ผังบริเวณ' });
    Object.assign(site, { W, H, mpp, ground: SiteModel.packGround(SiteModel.newGround(W, H)) });
    openSite(site, canvas, null, true);
  }
  async function useCollege() {
    if (!window.SiteTemplates) return;
    const site = SiteTemplates.college();
    openSite(site, await loadImg(site.img), site.img, false);
    toast('ผังวิทยาลัย 21 อาคาร ลอกจากแผนที่จริง — แก้ไข เพิ่มอาคาร ห้อง ต้นไม้ เสาไฟ ได้ทุกอย่าง', 'ok', 3600);
  }
  function blankSite() {
    if (!window.SiteModel) return;
    openSite(SiteModel.blank({ widthM: 300, heightM: 200, mpp: 0.5, name: 'ผังบริเวณใหม่' }), null, null, false);
  }
  async function editExistingSite() {
    const site = S.siteExisting;
    if (site) openSite(site, await loadImg(site.img), site.img, false);
  }
  async function loadSiteJSON(file) {
    const data = JSON.parse(await file.text());
    const site = data && data.kind === 'site' ? data : data && data.room && data.room.site ? data.room.site : null;
    if (!site) throw new Error('ไฟล์ JSON นี้ไม่มีผังบริเวณ (ต้องเป็นไฟล์ที่ส่งออกจาก SimuCore)');
    openSite(site, await loadImg(site.img), site.img, false);
  }
  function applySite(json) {
    // เก็บภาพแผนที่ไว้ในผัง (ย่อ) เพื่อเปิดแก้ไขภายหลัง — ถ้าเป็นไฟล์ในเว็บอยู่แล้วเก็บแค่ที่อยู่ไฟล์
    if (S.siteImgSrc) json.img = S.siteImgSrc;
    else if (S.siteImg) {
      try {
        const c = h('canvas'), f = Math.min(1, 1400 / Math.max(json.W, json.H));
        c.width = Math.round(json.W * f); c.height = Math.round(json.H * f);
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(S.siteImg, 0, 0, c.width, c.height);
        json.img = c.toDataURL('image/jpeg', 0.8);
      } catch (e) { json.img = null; }
    } else json.img = null;
    const cb = S.onApplySite;
    close();
    if (cb) cb(json);
  }
  // แก้ห้องภายในอาคาร: ใช้เครื่องมือแก้แผนผังเดิม (ขั้นที่ 3) แล้วกลับไปหน้าผังบริเวณ
  function editSubPlan(json, o) {
    build();
    const opt = o || {};
    const plan = PS.restore(json);
    plan.name = json.name || opt.title || 'อาคาร';
    S.sub = { onDone: opt.onDone, title: opt.title || plan.name };
    S.subName = plan.name;
    S.kind = 'saved'; S.base = null; S.scaleLocked = true; S.history = []; S.sel = null; S.svgTexts = null;
    go(3);
    el.title.textContent = 'จัดห้องภายในอาคาร';
    el.subtitle.textContent = `${S.sub.title} — วาดผนัง (W) เจาะประตู (D) ตั้งชื่อห้อง แล้วกด "บันทึกห้องในอาคาร"`;
    setPlan(plan, renderPlanImage(plan));
    setTool('select');
  }
  function endSub(save) {
    const sub = S.sub;
    if (!sub) return;
    const json = save && S.plan ? PS.compact(Object.assign({}, S.plan, { name: S.subName })) : null;
    S.sub = null; S.plan = null; S.sel = null;
    el.title.textContent = 'ออกแบบผังบริเวณ';
    el.subtitle.textContent = 'วางอาคาร ห้อง ถนน ต้นไม้ เสาไฟฟ้า บ่อน้ำ บนแผนที่จริง แล้วสร้างวิทยาเขต 3D สำหรับเดินสายเครือข่าย';
    go(4);
    if (json && sub.onDone) sub.onDone(json);
  }

  /* =========================================================================
     ขั้นที่ 2: ปรับกรอบ 4 มุม
     ========================================================================= */
  const fullQuad = () => { const w = S.src.width, hh = S.src.height; return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: hh }, { x: 0, y: hh }]; };
  function autoQuad() {
    const full = imageData(S.src);
    const paper = PS.findPaper(full);                      // ภาพถ่ายกระดาษบนโต๊ะ → ใช้มุมกระดาษ
    if (paper) return paper;
    const small = PS.downscale(full, 500), f = S.src.width / small.width;
    const { ink } = PS.binarize(small, {});
    const xs = [], ys = [];
    for (let y = 0; y < small.height; y++) for (let x = 0; x < small.width; x++) if (ink[y * small.width + x]) { xs.push(x); ys.push(y); }
    if (xs.length < 30) return fullQuad();
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
    const mx = small.width * 0.02, my = small.height * 0.02;
    const x0 = clamp((q(xs, 0.003) - mx) * f, 0, S.src.width), x1 = clamp((q(xs, 0.997) + mx) * f, 0, S.src.width);
    const y0 = clamp((q(ys, 0.003) - my) * f, 0, S.src.height), y1 = clamp((q(ys, 0.997) + my) * f, 0, S.src.height);
    return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  }
  function startCrop(canvas, name) {
    S.src = canvas; S.name = name; S.svgTexts = null; S.kind = 'raster';
    S.quad = autoQuad();
    go(2);
  }
  function rotate90(dir) {
    const c = h('canvas'), s = S.src;
    c.width = s.height; c.height = s.width;
    const g = c.getContext('2d');
    g.translate(c.width / 2, c.height / 2); g.rotate(dir * Math.PI / 2); g.drawImage(s, -s.width / 2, -s.height / 2);
    S.src = c; S.quad = autoQuad();
    drawCrop();
  }
  let cropView = { k: 1, ox: 0, oy: 0 };
  function fitCanvas(canvas, stage, w, hh) {
    const r = stage.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const k = Math.min((r.width - 16) / w, (r.height - 16) / hh) || 1;
    const cw = Math.max(10, Math.floor(w * k)), ch = Math.max(10, Math.floor(hh * k));
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    const g = canvas.getContext('2d');
    g.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
    return { g, k, dpr };
  }
  function drawCrop() {
    if (!S.src || S.step !== 2) return;
    const { g, k } = fitCanvas(el.cropCanvas, el.cropStage, S.src.width, S.src.height);
    cropView.k = k;
    g.drawImage(S.src, 0, 0);
    const q = S.quad;
    g.fillStyle = 'rgba(4,6,20,0.55)';
    g.beginPath(); g.rect(0, 0, S.src.width, S.src.height);
    g.moveTo(q[0].x, q[0].y); q.slice(1).concat([q[0]]).forEach(p => g.lineTo(p.x, p.y));
    g.fill('evenodd');
    g.strokeStyle = '#fbbf24'; g.lineWidth = 2.5 / k;
    g.beginPath(); g.moveTo(q[0].x, q[0].y); q.slice(1).concat([q[0]]).forEach(p => g.lineTo(p.x, p.y)); g.stroke();
    q.forEach((p, i) => {
      g.beginPath(); g.arc(p.x, p.y, 11 / k, 0, Math.PI * 2);
      g.fillStyle = i === S.dragCorner ? '#fde68a' : '#fbbf24'; g.fill();
      g.lineWidth = 2 / k; g.strokeStyle = '#1c1003'; g.stroke();
    });
  }
  function bindCrop() {
    const toImg = e => { const r = el.cropCanvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / cropView.k, y: (e.clientY - r.top) / cropView.k }; };
    el.cropCanvas.addEventListener('pointerdown', e => {
      const p = toImg(e);
      let best = -1, bd = 28 / cropView.k;
      S.quad.forEach((c, i) => { const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < bd) { bd = d; best = i; } });
      if (best < 0) return;
      S.dragCorner = best;
      el.cropCanvas.setPointerCapture(e.pointerId);
      drawCrop();
    });
    el.cropCanvas.addEventListener('pointermove', e => {
      if (S.dragCorner === undefined || S.dragCorner === null) return;
      const p = toImg(e);
      S.quad[S.dragCorner] = { x: clamp(p.x, 0, S.src.width), y: clamp(p.y, 0, S.src.height) };
      drawCrop();
    });
    const up = () => { S.dragCorner = null; drawCrop(); };
    el.cropCanvas.addEventListener('pointerup', up);
    el.cropCanvas.addEventListener('pointercancel', up);
  }

  /* =========================================================================
     สแกน
     ========================================================================= */
  async function scanFromCrop() {
    go(3);
    setBusy(true, 'กำลังสแกนแผนผัง…');
    S.history = []; S.sel = null; S.scaleLocked = false;
    try {
      const src = imageData(S.src);
      const q = S.quad, full = q[0].x === 0 && q[0].y === 0 && q[2].x === S.src.width && q[2].y === S.src.height && q[1].y === 0 && q[3].x === 0;
      S.base = await later(() => (full ? PS.downscale(src, MAX_SCAN) : PS.warpQuad(src, q, MAX_SCAN)));
      // ข้อความจาก SVG/ตัวอย่าง ต้องย่อตามภาพที่สแกน
      if (S.svgTexts && full) { const f = S.base.width / S.src.width; S.textsScaled = S.svgTexts.map(t => Object.assign({}, t, { x: t.x * f, y: t.y * f, h: t.h * f })); }
      else S.textsScaled = null;
      await rescan(false);
    } catch (e) {
      console.error(e);
      setBusy(false);
      toast('สแกนไม่สำเร็จ: ' + e.message, 'err');
    }
  }
  async function rescan(keepNames) {
    if (!S.base) return;
    setBusy(true, 'กำลังสแกนแผนผัง…');
    const old = keepNames && S.plan ? S.plan : null;
    const plan = await later(() => PS.analyzeRaster(S.base, S.opts));
    setBusy(false);
    plan.name = S.name;
    const img = canvasFrom(plan.image || S.base);
    if (S.textsScaled && !plan.angle) PS.nameRooms(plan, S.textsScaled);
    if (old) {
      if (S.scaleLocked) plan.mpp = old.mpp;
      const metas = old.rooms.map(r => ({ n: r.name, c: r.color, k: r.corridor ? 1 : 0, h: r.hidden ? 1 : 0, x: r.lx, y: r.ly }));
      metas.forEach(m => { const i = PS.roomAt(plan, m.x, m.y); if (i >= 0) { const r = plan.rooms[i]; r.name = m.n; r.color = m.c; r.corridor = !!m.k; r.hidden = !!m.h; } });
    }
    setPlan(plan, img);
    if (!old) {
      const d = plan.openings.filter(o => o.kind === 'door').length;
      toast(plan.rooms.length ? `พบ ${plan.rooms.length} ห้อง ผนัง ${plan.walls.length} เส้น ประตู ${d} บาน — ตรวจและแก้ไขได้ก่อนสร้าง` : 'ยังไม่พบห้องที่ปิดล้อมด้วยผนัง ลองปรับความไวการจับเส้น หรือวาดผนังที่ขาดเพิ่ม', plan.rooms.length ? 'ok' : 'warn', 4200);
    }
  }
  function setPlan(plan, imgCanvas) {
    S.plan = plan;
    S.imgCanvas = imgCanvas;
    S.inkCanvas = plan.ink ? inkCanvasOf(plan) : null;
    S.sel = null;
    refreshRooms();
    renderPanel();
    drawStage();
  }
  function inkCanvasOf(plan) {
    const c = h('canvas');
    c.width = plan.W; c.height = plan.H;
    const g = c.getContext('2d'), im = g.createImageData(plan.W, plan.H);
    for (let i = 0; i < plan.ink.length; i++) if (plan.ink[i]) { im.data[i * 4] = 250; im.data[i * 4 + 1] = 204; im.data[i * 4 + 2] = 21; im.data[i * 4 + 3] = 230; }
    g.putImageData(im, 0, 0);
    return c;
  }
  // ภาพแผนผังจากเส้นผนัง (ไฟล์ DXF ไม่มีรูป)
  function renderPlanImage(plan) {
    const c = h('canvas');
    c.width = plan.W; c.height = plan.H;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.lineCap = 'square'; g.strokeStyle = '#111';
    plan.walls.forEach(s => { g.lineWidth = Math.max(1.5, s.t); g.beginPath(); g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2); g.stroke(); });
    g.strokeStyle = '#555'; g.lineWidth = 1;
    plan.openings.filter(o => o.kind === 'window').forEach(s => { g.beginPath(); g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2); g.stroke(); });
    return c;
  }
  function refreshRooms() {
    const p = S.plan;
    if (!p) return;
    const c = h('canvas');
    c.width = p.cols; c.height = p.rows;
    const g = c.getContext('2d'), im = g.createImageData(p.cols, p.rows);
    const rgb = p.rooms.map(r => { const x = r.color || '#38bdf8'; return [parseInt(x.slice(1, 3), 16), parseInt(x.slice(3, 5), 16), parseInt(x.slice(5, 7), 16)]; });
    for (let i = 0; i < p.grid.length; i++) {
      const r = p.grid[i];
      if (r < 0) continue;
      const room = p.rooms[r], col = room.hidden ? [120, 120, 130] : rgb[r];
      im.data[i * 4] = col[0]; im.data[i * 4 + 1] = col[1]; im.data[i * 4 + 2] = col[2]; im.data[i * 4 + 3] = room.hidden ? 40 : 110;
    }
    g.putImageData(im, 0, 0);
    S.roomCanvas = c;
  }

  /* =========================================================================
     ขั้นที่ 3: แสดงผลและแก้ไข
     ========================================================================= */
  let view = { k: 1 };
  function drawStage() {
    const p = S.plan;
    if (!p || S.step !== 3) return;
    const { g, k } = fitCanvas(el.canvas, el.stage, p.W, p.H);
    view.k = k;
    g.fillStyle = '#0b1030'; g.fillRect(0, 0, p.W, p.H);
    if (S.showImg && S.imgCanvas) { g.globalAlpha = 0.85; g.drawImage(S.imgCanvas, 0, 0, p.W, p.H); g.globalAlpha = 1; }
    if (S.showInk && S.inkCanvas) g.drawImage(S.inkCanvas, 0, 0);
    if (S.roomCanvas) { g.imageSmoothingEnabled = false; g.drawImage(S.roomCanvas, 0, 0, p.cols * p.cell, p.rows * p.cell); g.imageSmoothingEnabled = true; }
    const line = (s, col, w, dash) => { g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash || []); g.beginPath(); g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2); g.stroke(); g.setLineDash([]); };
    g.lineCap = 'round';
    p.walls.forEach(s => {
      if (S.sel && S.sel.type === 'wall' && S.sel.item === s) line(s, 'rgba(251,191,36,0.55)', Math.max(s.t, 3 / k) + 8 / k);
      line(s, '#ef4444', Math.max(s.t, 2.5 / k));
    });
    p.openings.forEach(s => {
      const on = S.sel && S.sel.type === 'opening' && S.sel.item === s;
      if (on) line(s, 'rgba(251,191,36,0.55)', 12 / k);
      line(s, s.kind === 'window' ? '#60a5fa' : '#22c55e', 4 / k, s.kind === 'window' ? [6 / k, 4 / k] : null);
    });
    // ป้ายชื่อห้อง
    g.textAlign = 'center'; g.textBaseline = 'middle';
    p.rooms.forEach((r, i) => {
      const area = r.area * p.mpp * p.mpp;
      const t1 = r.name, t2 = `${fmt(area)} ตร.ม.`;
      const small = el.canvas.clientWidth < 520, fs = (small ? 10 : 13) / k;
      g.font = `600 ${fs}px Prompt, "IBM Plex Sans Thai", sans-serif`;
      const w = Math.max(g.measureText(t1).width, g.measureText(t2).width) + 16 / k;
      const sel = S.sel && S.sel.type === 'room' && S.sel.index === i;
      g.fillStyle = r.hidden ? 'rgba(30,30,40,0.6)' : sel ? 'rgba(251,191,36,0.95)' : 'rgba(8,12,34,0.82)';
      const bh = (small ? 30 : 38) / k;
      roundRect(g, r.lx - w / 2, r.ly - bh / 2, w, bh, 9 / k); g.fill();
      g.strokeStyle = r.hidden ? '#64748b' : r.color; g.lineWidth = 2 / k; g.stroke();
      g.fillStyle = sel ? '#1c1003' : r.hidden ? '#94a3b8' : '#f8fafc';
      g.fillText(r.hidden ? 'ไม่ใช่ห้อง' : t1, r.lx, r.ly - (small ? 5.5 : 7) / k);
      g.font = `500 ${(small ? 8.5 : 11) / k}px "IBM Plex Sans Thai", sans-serif`;
      g.fillStyle = sel ? '#422006' : '#cbd5e1';
      g.fillText(t2, r.lx, r.ly + (small ? 7 : 9) / k);
    });
    // เส้นที่กำลังวาด / วัด
    if (S.draft) line(S.draft, '#fbbf24', Math.max(S.draft.t, 3 / k), [8 / k, 5 / k]);
    if (S.measure && S.measure.a) {
      const m = S.measure, b = m.b || m.hover;
      if (b) {
        line({ x1: m.a.x, y1: m.a.y, x2: b.x, y2: b.y }, '#22d3ee', 3 / k, [4 / k, 4 / k]);
        const d = Math.hypot(b.x - m.a.x, b.y - m.a.y);
        g.font = `600 ${13 / k}px Prompt, sans-serif`; g.fillStyle = '#22d3ee';
        g.fillText(`${fmt(d * p.mpp, 2)} ม. (ตอนนี้)`, (m.a.x + b.x) / 2, (m.a.y + b.y) / 2 - 14 / k);
      }
      [m.a, m.b].filter(Boolean).forEach(q => { g.fillStyle = '#22d3ee'; g.beginPath(); g.arc(q.x, q.y, 5 / k, 0, Math.PI * 2); g.fill(); });
    }
    el.stage.dataset.tool = S.pickColor ? 'pick' : S.tool;
  }
  function roundRect(g, x, y, w, hh, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  function setTool(t) {
    S.tool = t; S.draft = null; S.pickColor = false;
    S.measure = t === 'measure' ? { a: null, b: null } : null;
    el.measureBox.hidden = true;
    el.tools.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('is-on', b.dataset.tool === t));
    const hint = { select: 'คลิกผนัง ประตู หรือห้องเพื่อเลือก · Delete = ลบ', wall: 'ลากเพื่อวาดผนังใหม่ (จับแนวตรงให้อัตโนมัติ)', door: 'คลิกบนผนังเพื่อเจาะช่องประตูกว้าง 0.9 ม.', measure: 'คลิก 2 จุดที่รู้ระยะจริง เช่น ความกว้างห้องตามตัวเลขในแบบ' }[t];
    el.canvas.title = hint;
    drawStage();
  }
  function snapshot() {
    const p = S.plan;
    S.history.push(JSON.stringify({ walls: p.walls, openings: p.openings, mpp: p.mpp, rooms: p.rooms.map(r => ({ n: r.name, c: r.color, k: r.corridor ? 1 : 0, h: r.hidden ? 1 : 0, x: r.lx, y: r.ly })) }));
    if (S.history.length > 60) S.history.shift();
  }
  function undo() {
    const s = S.history.pop();
    if (!s) { toast('ไม่มีขั้นตอนให้ย้อนแล้ว', 'info', 1400); return; }
    const d = JSON.parse(s), p = S.plan;
    p.walls = d.walls; p.openings = d.openings; p.mpp = d.mpp;
    Object.assign(p, PS.buildRooms(p.W, p.H, p.walls, p.openings));
    d.rooms.forEach(m => { const i = PS.roomAt(p, m.x, m.y); if (i >= 0) Object.assign(p.rooms[i], { name: m.n, color: m.c, corridor: !!m.k, hidden: !!m.h }); });
    S.sel = null;
    refreshRooms(); renderPanel(); drawStage();
  }
  function edited() { PS.recompute(S.plan); refreshRooms(); renderPanel(); drawStage(); }

  function hitTest(x, y) {
    const p = S.plan, tol = 9 / view.k;
    let best = null, bd = Infinity;
    p.openings.forEach(s => { const d = PS.pointSegDist(x, y, s) - Math.max(2, s.t / 2); if (d < tol && d < bd) { bd = d; best = { type: 'opening', item: s }; } });
    p.walls.forEach(s => { const d = PS.pointSegDist(x, y, s) - s.t / 2; if (d < tol && d < bd - 0.5) { bd = d; best = { type: 'wall', item: s }; } });
    if (best) return best;
    const i = PS.roomAt(p, x, y);
    return i >= 0 ? { type: 'room', index: i } : null;
  }
  function snapPoint(x, y, skip) {
    const p = S.plan, tol = 12 / view.k;
    let best = null, bd = tol;
    p.walls.forEach(s => { if (s === skip) return; for (const [px, py] of [[s.x1, s.y1], [s.x2, s.y2]]) { const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = { x: px, y: py }; } } });
    if (best) return best;
    let bl = null, bld = tol;
    p.walls.forEach(s => {
      const d = PS.pointSegDist(x, y, s);
      if (d < bld) {
        const L = PS.segLen(s), ux = (s.x2 - s.x1) / L, uy = (s.y2 - s.y1) / L, t = clamp((x - s.x1) * ux + (y - s.y1) * uy, 0, L);
        bld = d; bl = { x: s.x1 + ux * t, y: s.y1 + uy * t };
      }
    });
    return bl || { x, y };
  }
  function typicalT() {
    const ts = S.plan.walls.map(s => s.t).sort((a, b) => a - b);
    return ts.length ? ts[Math.floor(ts.length / 2)] : Math.max(3, 0.12 / S.plan.mpp);
  }
  function bindStage() {
    const toPlan = e => { const r = el.canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / view.k, y: (e.clientY - r.top) / view.k }; };
    el.canvas.addEventListener('pointerdown', e => {
      if (!S.plan || S.busy) return;
      const pt = toPlan(e);
      if (S.pickColor) { pickColorAt(pt); return; }
      if (S.tool === 'wall') {
        const a = snapPoint(pt.x, pt.y);
        S.draft = { x1: a.x, y1: a.y, x2: a.x, y2: a.y, t: typicalT() };
        el.canvas.setPointerCapture(e.pointerId);
        drawStage();
      } else if (S.tool === 'measure') {
        const m = S.measure || (S.measure = { a: null, b: null });
        if (!m.a || m.b) { m.a = snapPoint(pt.x, pt.y); m.b = null; el.measureBox.hidden = true; }
        else { m.b = snapPoint(pt.x, pt.y); showMeasureBox(); }
        drawStage();
      } else if (S.tool === 'door') {
        const hit = hitTest(pt.x, pt.y);
        if (hit && hit.type === 'wall') cutDoor(hit.item, pt);
        else toast('คลิกบนเส้นผนังสีแดงเพื่อเจาะประตู', 'info', 1800);
      } else {
        S.sel = hitTest(pt.x, pt.y);
        renderPanel(); drawStage();
      }
    });
    el.canvas.addEventListener('pointermove', e => {
      if (!S.plan) return;
      const pt = toPlan(e);
      if (S.draft) {
        let b = snapPoint(pt.x, pt.y);
        const dx = b.x - S.draft.x1, dy = b.y - S.draft.y1, ang = Math.atan2(dy, dx), snapA = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
        if (Math.abs(ang - snapA) < 7 * Math.PI / 180) { const L = Math.hypot(dx, dy); b = { x: S.draft.x1 + Math.cos(snapA) * L, y: S.draft.y1 + Math.sin(snapA) * L }; }
        S.draft.x2 = b.x; S.draft.y2 = b.y;
        drawStage();
      } else if (S.measure && S.measure.a && !S.measure.b) { S.measure.hover = pt; drawStage(); }
    });
    const finish = () => {
      if (!S.draft) return;
      const d = S.draft;
      S.draft = null;
      if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 8) { drawStage(); return; }
      snapshot();
      S.plan.walls.push(PS.mkSeg(d.x1, d.y1, d.x2, d.y2, d.t));
      edited();
    };
    el.canvas.addEventListener('pointerup', finish);
    el.canvas.addEventListener('pointercancel', () => { S.draft = null; drawStage(); });
  }
  function cutDoor(wall, pt) {
    const p = S.plan, L = PS.segLen(wall), ux = (wall.x2 - wall.x1) / L, uy = (wall.y2 - wall.y1) / L;
    const w = Math.max(6, 0.9 / p.mpp);
    snapshot();
    p.walls = p.walls.filter(s => s !== wall);
    if (L <= w + 4) {
      p.openings.push(PS.mkSeg(wall.x1, wall.y1, wall.x2, wall.y2, wall.t, { kind: 'door' }));
    } else {
      const c = clamp((pt.x - wall.x1) * ux + (pt.y - wall.y1) * uy, w / 2, L - w / 2);
      const a = c - w / 2, b = c + w / 2, P = t => ({ x: wall.x1 + ux * t, y: wall.y1 + uy * t });
      if (a > 2) p.walls.push(PS.mkSeg(wall.x1, wall.y1, P(a).x, P(a).y, wall.t));
      if (L - b > 2) p.walls.push(PS.mkSeg(P(b).x, P(b).y, wall.x2, wall.y2, wall.t));
      p.openings.push(PS.mkSeg(P(a).x, P(a).y, P(b).x, P(b).y, wall.t, { kind: 'door' }));
    }
    edited();
    toast('เจาะช่องประตูแล้ว', 'ok', 1400);
  }
  function deleteSelected() {
    const s = S.sel, p = S.plan;
    if (!s || !p) return;
    snapshot();
    if (s.type === 'wall') p.walls = p.walls.filter(w => w !== s.item);
    else if (s.type === 'opening') {               // ปิดช่อง = กลายเป็นผนัง
      p.openings = p.openings.filter(o => o !== s.item);
      p.walls.push(PS.mkSeg(s.item.x1, s.item.y1, s.item.x2, s.item.y2, s.item.t || typicalT()));
    } else if (s.type === 'room') { p.rooms[s.index].hidden = !p.rooms[s.index].hidden; refreshRooms(); renderPanel(); drawStage(); return; }
    S.sel = null;
    edited();
  }
  function showMeasureBox() {
    const p = S.plan, m = S.measure, d = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y);
    if (d < 4) return;
    const input = h('input', { type: 'number', min: 0.1, step: 0.01, value: (d * p.mpp).toFixed(2), 'aria-label': 'ระยะจริง (เมตร)', id: 'psMeasureInput' });
    const ok = () => {
      const v = parseFloat(input.value);
      if (!(v > 0)) return;
      snapshot();
      p.mpp = v / d;
      S.scaleLocked = true;
      el.measureBox.hidden = true;
      S.measure = { a: null, b: null };
      renderPanel(); drawStage();
      toast(`ตั้งมาตราส่วนแล้ว: แผนผังกว้าง ${fmt(p.W * p.mpp)} × ${fmt(p.H * p.mpp)} ม.`, 'ok', 2600);
    };
    el.measureBox.innerHTML = '';
    el.measureBox.append(h('b', { text: 'ระยะจริงระหว่าง 2 จุดนี้' }), h('div', {}, input, h('span', { text: 'เมตร' })),
      h('button', { class: 'ps-btn ps-btn--main', type: 'button', id: 'psMeasureOk', onclick: ok }, 'ใช้เป็นมาตราส่วน'));
    el.measureBox.hidden = false;
    setTimeout(() => input.select(), 30);
  }
  function pickColorAt(pt) {
    const c = S.imgCanvas;
    if (!c) return;
    const d = c.getContext('2d').getImageData(clamp(Math.round(pt.x), 0, c.width - 1), clamp(Math.round(pt.y), 0, c.height - 1), 1, 1).data;
    S.pickColor = false;
    S.opts.color = [d[0], d[1], d[2]];
    renderPanel();
    rescan(true);
  }

  /* ------------------------------- แผงด้านขวา ------------------------------- */
  function renderPanel() {
    const p = S.plan, box = el.panel;
    if (!box) return;
    box.innerHTML = '';
    if (!p) return;
    const doors = p.openings.filter(o => o.kind !== 'window').length, wins = p.openings.length - doors;
    const visible = p.rooms.filter(r => !r.hidden).length;
    const srcTxt = { door: 'เดาจากความกว้างประตู', wall: 'เดาจากความหนาผนัง', default: 'ค่าประมาณ — ควรวัดเทียบ', units: 'จากหน่วยในไฟล์ DXF' }[p.scaleSource] || '';
    box.append(h('div', { class: 'ps-sum' },
      h('span', {}, h('b', { text: visible }), ' ห้อง'), h('span', {}, h('b', { text: p.walls.length }), ' ผนัง'),
      h('span', {}, h('b', { text: doors }), ' ประตู'), h('span', {}, h('b', { text: wins }), ' หน้าต่าง')));
    // สิ่งที่เลือก
    if (S.sel) {
      const s = S.sel;
      let body;
      if (s.type === 'wall') body = [h('b', {}, icon('fa-grip-lines'), ` ผนัง ยาว ${fmt(PS.segLen(s.item) * p.mpp, 2)} ม. หนา ${fmt(s.item.t * p.mpp * 100, 0)} ซม.`),
        h('div', { class: 'ps-row' }, h('button', { class: 'ps-btn ps-btn--danger', type: 'button', id: 'psDelete', onclick: deleteSelected }, icon('fa-trash-can'), ' ลบผนัง'),
          h('button', { class: 'ps-btn', type: 'button', onclick: () => { snapshot(); p.walls = p.walls.filter(w => w !== s.item); p.openings.push(PS.mkSeg(s.item.x1, s.item.y1, s.item.x2, s.item.y2, s.item.t, { kind: 'window' })); S.sel = null; edited(); } }, icon('fa-border-all'), ' เป็นหน้าต่าง'))];
      else if (s.type === 'opening') body = [h('b', {}, icon(s.item.kind === 'window' ? 'fa-border-all' : 'fa-door-open'), ` ${s.item.kind === 'window' ? 'หน้าต่าง' : 'ประตู/ช่องเปิด'} กว้าง ${fmt(PS.segLen(s.item) * p.mpp, 2)} ม.`),
        h('div', { class: 'ps-row' }, h('button', { class: 'ps-btn', type: 'button', id: 'psDelete', onclick: deleteSelected }, icon('fa-square'), ' ปิดเป็นผนัง'),
          h('button', { class: 'ps-btn', type: 'button', onclick: () => { snapshot(); s.item.kind = s.item.kind === 'window' ? 'door' : 'window'; edited(); } }, icon('fa-right-left'), s.item.kind === 'window' ? ' เป็นประตู' : ' เป็นหน้าต่าง'))];
      else {
        const r = p.rooms[s.index];
        body = [h('b', {}, icon('fa-vector-square'), ` ${r.name} · ${fmt(r.area * p.mpp * p.mpp)} ตร.ม.`),
          h('div', { class: 'ps-row' }, h('button', { class: 'ps-btn', type: 'button', onclick: deleteSelected }, icon(r.hidden ? 'fa-eye' : 'fa-eye-slash'), r.hidden ? ' นับเป็นห้อง' : ' ไม่ใช่ห้อง'))];
      }
      box.append(h('div', { class: 'ps-sel' }, body));
    }
    // ขนาดจริง
    const wIn = h('input', { type: 'number', min: 1, max: 2000, step: 0.1, value: (p.W * p.mpp).toFixed(2), id: 'psWidth', 'aria-label': 'ความกว้างจริงของแผนผัง (เมตร)',
      onchange: e => { const v = parseFloat(e.target.value); if (v > 0) { snapshot(); p.mpp = v / p.W; S.scaleLocked = true; renderPanel(); drawStage(); } } });
    if (!S.sub) box.append(h('section', { class: 'ps-sec' },
      h('h3', {}, icon('fa-ruler-combined'), ' ขนาดจริง'),
      h('div', { class: 'ps-size' }, h('label', {}, 'กว้างทั้งภาพ', h('span', { class: 'ps-num' }, wIn, h('small', { text: 'ม.' }))),
        h('div', {}, h('small', { text: 'ยาว' }), h('b', { text: `${fmt(p.H * p.mpp)} ม.` }))),
      h('p', { class: 'ps-note' }, icon(S.scaleLocked ? 'fa-lock' : 'fa-circle-info'), ' ' + (S.scaleLocked ? 'ตั้งมาตราส่วนเองแล้ว' : srcTxt)),
      h('button', { class: 'ps-btn ps-btn--block', type: 'button', onclick: () => setTool('measure') }, icon('fa-ruler'), ' วัดเทียบจากระยะที่รู้')));
    // รายชื่อห้อง
    box.append(h('section', { class: 'ps-sec' },
      h('h3', {}, icon('fa-vector-square'), ` ห้อง (${visible})`),
      p.rooms.length ? h('ul', { class: 'ps-rooms' }, p.rooms.map((r, i) => h('li', { class: (r.hidden ? 'is-hidden' : '') + (S.sel && S.sel.type === 'room' && S.sel.index === i ? ' is-sel' : '') },
        h('button', { class: 'ps-sw', type: 'button', style: `--c:${r.color}`, title: 'เปลี่ยนสี', 'aria-label': `เปลี่ยนสี${r.name}`, onclick: () => { const C = PS.COLORS; r.color = C[(C.indexOf(r.color) + 1) % C.length]; refreshRooms(); renderPanel(); drawStage(); } }),
        h('input', { type: 'text', value: r.name, maxLength: 40, 'aria-label': 'ชื่อห้อง', 'data-room': i, oninput: e => { r.name = e.target.value || 'ห้อง'; drawStage(); }, onfocus: () => { S.sel = { type: 'room', index: i }; drawStage(); } }),
        h('small', { text: `${fmt(r.area * p.mpp * p.mpp)} ม²` }),
        h('button', { class: 'ps-ico' + (r.corridor ? ' is-on' : ''), type: 'button', title: r.corridor ? 'เป็นทางเดิน (กดเพื่อเป็นห้อง)' : 'ทำเป็นทางเดิน', 'aria-pressed': String(!!r.corridor), onclick: () => { r.corridor = !r.corridor; renderPanel(); } }, icon('fa-person-walking')),
        h('button', { class: 'ps-ico' + (r.hidden ? ' is-on' : ''), type: 'button', title: r.hidden ? 'นับเป็นห้อง' : 'ไม่ใช่ห้อง (ไม่สร้างในห้อง 3D)', 'aria-pressed': String(!!r.hidden), onclick: () => { r.hidden = !r.hidden; refreshRooms(); renderPanel(); drawStage(); } }, icon(r.hidden ? 'fa-eye-slash' : 'fa-eye')))))
        : h('p', { class: 'ps-note ps-note--warn' }, icon('fa-triangle-exclamation'), ' ยังไม่พบห้องที่ปิดล้อม — ใช้ "วาดผนัง" ปิดช่องที่ขาด หรือเพิ่มความไวการจับเส้น')));
    // ตั้งค่าการสแกน
    if (S.base && S.kind === 'raster') {
      const o = S.opts;
      const sens = h('input', { type: 'range', min: -1, max: 1, step: 0.1, value: o.sens, id: 'psSens', 'aria-label': 'ความไวการจับเส้น', onchange: e => { o.sens = +e.target.value; rescanAsk(); } });
      box.append(h('details', { class: 'ps-sec ps-opts', open: S.optsOpen || null, ontoggle: e => { S.optsOpen = e.target.open; } },
        h('summary', {}, icon('fa-sliders'), ' ปรับการสแกน'),
        h('label', { class: 'ps-range' }, h('span', {}, 'ความไวการจับเส้น', h('small', { text: 'จับเฉพาะเส้นเข้ม ← → จับเส้นจาง' })), sens),
        h('label', { class: 'ps-chk' }, h('input', { type: 'checkbox', checked: o.diagonal, onchange: e => { o.diagonal = e.target.checked; rescanAsk(); } }), ' หาผนังเฉียงด้วย'),
        h('label', { class: 'ps-chk' }, h('input', { type: 'checkbox', checked: o.fill, id: 'psFill', onchange: e => { o.fill = e.target.checked; rescanAsk(); } }), ' พื้นที่ทึบ (แผนที่อาคาร ใช้ขอบเป็นผนัง)'),
        h('label', { class: 'ps-sel-row' }, 'พื้นหลังภาพ', h('select', { onchange: e => { o.invert = e.target.value === 'auto' ? 'auto' : e.target.value === 'dark'; rescanAsk(); } },
          h('option', { value: 'auto', text: 'ตรวจเอง', selected: o.invert === 'auto' }), h('option', { value: 'light', text: 'พื้นสว่าง เส้นเข้ม', selected: o.invert === false }), h('option', { value: 'dark', text: 'พื้นเข้ม เส้นสว่าง (Blueprint)', selected: o.invert === true }))),
        h('div', { class: 'ps-color' }, h('span', {}, 'สีผนัง/อาคาร'),
          o.color ? h('i', { class: 'ps-swatch', style: `background:rgb(${o.color.join(',')})` }) : h('small', { text: 'อัตโนมัติ' }),
          h('button', { class: 'ps-btn', type: 'button', id: 'psPick', onclick: () => { S.pickColor = true; drawStage(); toast('แตะที่ผนังหรืออาคารในภาพเพื่อเลือกสี', 'info', 2200); } }, icon('fa-eye-dropper'), ' เลือกจากรูป'),
          o.color ? h('button', { class: 'ps-btn', type: 'button', onclick: () => { o.color = null; rescanAsk(); } }, 'ล้าง') : null),
        o.color ? h('label', { class: 'ps-range' }, h('span', {}, 'ช่วงสีที่ยอมรับ'), h('input', { type: 'range', min: 15, max: 140, step: 5, value: o.tol, onchange: e => { o.tol = +e.target.value; rescanAsk(); } })) : null,
        p.angle ? h('p', { class: 'ps-note' }, icon('fa-rotate'), ` แก้ภาพเอียง ${fmt(p.angle)}° ให้แล้ว`) : null));
    }
    // พื้นในห้อง 3D
    if (S.sub) { box.append(h('p', { class: 'ps-note' }, icon('fa-circle-info'), ' ขนาดอาคารกำหนดจากหน้าผังบริเวณ ห้องที่จัดตรงนี้คือชั้นล่างของอาคาร (วางอุปกรณ์เครือข่ายได้)')); return; }
    box.append(h('section', { class: 'ps-sec' }, h('h3', {}, icon('fa-layer-group'), ' พื้นในห้อง 3D'),
      h('div', { class: 'ps-seg' }, [['dark', 'แผนผังโทนมืด'], ['photo', 'ภาพต้นฉบับ'], ['rooms', 'สีห้องอย่างเดียว']].map(([v, t]) => h('button', { type: 'button', class: S.style === v ? 'is-on' : '', 'data-style': v, onclick: () => { S.style = v; renderPanel(); } }, t)))));
  }
  async function rescanAsk() {
    if (S.history.length) {
      const ok = await UI.confirm({ title: 'สแกนใหม่?', message: 'การปรับค่านี้จะสแกนภาพใหม่ และล้างผนัง/ประตูที่แก้ด้วยมือ (ชื่อห้องที่ตั้งไว้จะพยายามคงไว้)', confirmText: 'สแกนใหม่' });
      if (!ok) { renderPanel(); return; }
    }
    S.history = [];
    rescan(true);
  }

  /* --------------------------------- คีย์ลัด --------------------------------- */
  function onKey(e) {
    if (!S.open || document.querySelector('.sc-dialog')) return;     // กล่องยืนยันจัดการคีย์เอง
    const typing = /INPUT|SELECT|TEXTAREA/.test((e.target && e.target.tagName) || '');
    e.stopPropagation();                // ไม่ให้คีย์ลัดของห้องแล็บ (เดิน WASD, ลบอุปกรณ์) ทำงานซ้อน
    if (S.step === 4 && window.SiteDesigner) {
      if (typing && e.key === 'Enter' && e.target.id === 'sdMeasureInput') { e.preventDefault(); const b = document.getElementById('sdMeasureOk'); if (b) b.click(); return; }
      SiteDesigner.onKey(e);           // Esc ในหน้าออกแบบไม่ปิดหน้าต่าง (กันงานหาย) — ปิดด้วยปุ่ม ✕/ยกเลิก
      return;
    }
    if (typing && e.key === 'Enter' && e.target.id === 'psMeasureInput') { e.preventDefault(); const b = document.getElementById('psMeasureOk'); if (b) b.click(); return; }
    if (e.key === 'Escape') {
      if (S.draft || (S.measure && S.measure.a) || S.pickColor) { S.draft = null; S.pickColor = false; if (S.measure) S.measure = { a: null, b: null }; el.measureBox.hidden = true; drawStage(); }
      else if (S.sel) { S.sel = null; renderPanel(); drawStage(); }
      else if (S.sub) endSub(false);
      else close();
      return;
    }
    if (typing || S.step !== 3) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); }
    else if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSelected(); }
    else if (k === 'v') setTool('select');
    else if (k === 'w') setTool('wall');
    else if (k === 'd') setTool('door');
    else if (k === 'm' && !S.sub) setTool('measure');
  }

  /* --------------------------------- สร้างห้อง --------------------------------- */
  function apply() {
    const p = S.plan;
    if (!p) return;
    if (!p.rooms.some(r => !r.hidden)) { toast('ยังไม่มีห้องที่ปิดล้อม — วาดผนังที่ขาดก่อน', 'err', 3200); return; }
    if (S.sub) { endSub(true); return; }
    const json = PS.compact(Object.assign({}, p, { name: S.name || p.name, style: S.style }));
    if (S.imgCanvas) {
      const c = h('canvas'), f = Math.min(1, MAX_SCAN / Math.max(p.W, p.H));
      c.width = Math.round(p.W * f); c.height = Math.round(p.H * f);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(S.imgCanvas, 0, 0, c.width, c.height);
      json.img = c.toDataURL('image/jpeg', 0.82);
    }
    close();
    if (S.onApply) S.onApply(json);
  }

  /* ------------------- พื้นของห้อง 3D (ให้ workspace ใช้) ------------------- */
  function floorCanvas(plan, style, img) {
    const W = plan.W, H = plan.H, f = Math.min(1, 1400 / Math.max(W, H));
    const c = document.createElement('canvas');
    c.width = Math.round(W * f); c.height = Math.round(H * f);
    const g = c.getContext('2d');
    g.scale(f, f);
    if (style === 'photo' && img) { g.drawImage(img, 0, 0, W, H); return c; }
    g.fillStyle = '#0d1338'; g.fillRect(0, 0, W, H);
    // สีห้อง
    const rc = document.createElement('canvas');
    rc.width = plan.cols; rc.height = plan.rows;
    const rg = rc.getContext('2d'), im = rg.createImageData(plan.cols, plan.rows);
    const rgb = plan.rooms.map(r => { const x = r.color || '#38bdf8'; return [parseInt(x.slice(1, 3), 16), parseInt(x.slice(3, 5), 16), parseInt(x.slice(5, 7), 16)]; });
    for (let i = 0; i < plan.grid.length; i++) {
      const r = plan.grid[i];
      if (r < 0 || plan.rooms[r].hidden) continue;
      im.data[i * 4] = rgb[r][0]; im.data[i * 4 + 1] = rgb[r][1]; im.data[i * 4 + 2] = rgb[r][2]; im.data[i * 4 + 3] = style === 'rooms' ? 95 : 55;
    }
    rg.putImageData(im, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(rc, 0, 0, plan.cols * plan.cell, plan.rows * plan.cell);
    g.imageSmoothingEnabled = true;
    if (style !== 'rooms' && img) {
      // เส้นในแผนผัง (เฟอร์นิเจอร์ ตัวหนังสือ) เป็นเส้นสว่างบนพื้นมืด
      const t = document.createElement('canvas');
      t.width = c.width; t.height = c.height;
      const tg = t.getContext('2d');
      tg.drawImage(img, 0, 0, t.width, t.height);
      const d = tg.getImageData(0, 0, t.width, t.height);
      for (let i = 0; i < d.data.length; i += 4) {
        const L = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2], a = clamp((215 - L) / 170, 0, 1);
        d.data[i] = 186; d.data[i + 1] = 228; d.data[i + 2] = 255; d.data[i + 3] = Math.round(a * 210);
      }
      tg.putImageData(d, 0, 0);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(t, 0, 0);
      g.scale(f, f);
    } else {
      g.strokeStyle = 'rgba(199,210,254,0.9)'; g.lineCap = 'square';
      plan.walls.forEach(s => { g.lineWidth = Math.max(1.5, s.t); g.beginPath(); g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2); g.stroke(); });
    }
    return c;
  }

  window.PlanScanUI = { open, close, floorCanvas, makeSample, loadFile, editSubPlan, setMode, state: () => S, _setTool: setTool, _deleteSelected: deleteSelected, _cutDoor: cutDoor, _undo: undo, _endSub: endSub };
})();
