// =============================================================
// Animasi partikel cupang di latar hero
// - Ratusan cupang kecil berenang mengikuti kursor (berputar & mengalir)
// - Klik kanan / tekan lama: partikel berkumpul membentuk cupang raksasa,
//   lalu meledak lagi menjadi partikel
// =============================================================
(() => {
  const hero = document.getElementById('hero');
  const canvas = document.getElementById('hero-canvas');
  if (!hero || !canvas) return;

  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Warna partikel: nuansa emas (krem, emas muda, emas, emas tua)
  const COLORS = ['#FFF1C9', '#F8E3A3', '#E9C46A', '#D4A24C', '#B8862B', '#C9A86A'];
  const RGB = COLORS.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  // Tingkat kedalaman: jauh (redup & kecil) sampai dekat (terang & besar)
  const TIERS = [{ a: 0.28, s: 0.7 }, { a: 0.5, s: 0.9 }, { a: 0.8, s: 1.1 }];
  // Cahaya emas di latar yang bergerak pelan (membuat gradasi yang mengalir)
  const GLOWS = [
    { rgb: [212, 162, 76], a: 0.22, sx: 0.00011, sy: 0.00013, ph: 0 },
    { rgb: [233, 196, 106], a: 0.14, sx: 0.00009, sy: 0.00007, ph: 2.1 },
    { rgb: [150, 105, 35], a: 0.25, sx: 0.00007, sy: 0.00012, ph: 4.2 },
  ];

  let W = 0, H = 0;
  const particles = [];
  let buckets = [];                 // partikel polos, dikelompokkan per warna & kedalaman (agar cepat)
  let fadeList = [];                // partikel bergradasi transparan
  const dust = [];                  // titik-titik kecil berkilau di latar
  const ripples = [];               // gelombang lingkaran
  const pointer = { x: 0, y: 0, active: false };
  const ghost = { x: 0, y: 0 };     // titik yang diikuti saat kursor tidak ada

  let mode = 'follow';              // 'follow' = ikut kursor, 'form' = membentuk cupang raksasa
  let formUntil = 0;
  let formCenter = { x: 0, y: 0 };
  let formScale = 1;
  let formFlip = 1;
  let flare = 0;                    // 0..1, sirip mengembang setelah ledakan
  let boost = 0;                    // 0..1, partikel lebih terang saat jadi cupang raksasa
  let dustBoost = 0;
  let shape = null;                 // titik-titik siluet cupang raksasa

  let running = false;
  let lastTime = 0;
  let clock = 0;                    // waktu animasi (ms)

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

  // ---------- Membuat partikel ----------
  function makeParticle() {
    const tier = Math.random() < 0.35 ? 0 : Math.random() < 0.6 ? 1 : 2;
    return {
      x: rand(0, W), y: rand(0, H),
      vx: rand(-1, 1), vy: rand(-1, 1),
      angle: rand(0, Math.PI * 2),
      ci: Math.floor(Math.random() * COLORS.length),
      tier,
      size: rand(2.5, 5) * TIERS[tier].s,
      fade: Math.random() < 0.45,                          // 45% bergradasi transparan
      follow: Math.random() < 0.75 ? rand(0.35, 1) : 0,   // 25% berenang bebas
      swirl: rand(0.3, 1) * (Math.random() < 0.5 ? -1 : 1),
      phase: rand(0, Math.PI * 2),
      tx: 0, ty: 0, tail: 0,
    };
  }

  function rebuildBuckets() {
    buckets = Array.from({ length: COLORS.length * TIERS.length }, () => []);
    fadeList = [];
    particles.forEach((p) => (p.fade ? fadeList : buckets[p.tier * COLORS.length + p.ci]).push(p));
  }

  // ---------- Ukuran kanvas ----------
  function resize() {
    const rect = hero.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width;
    H = rect.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const target = Math.round(clamp((W * H) / 2000, 220, 650));
    while (particles.length < target) particles.push(makeParticle());
    if (particles.length > target) particles.length = target;
    rebuildBuckets();

    dust.length = 0;
    for (let i = 0; i < 70; i++) dust.push({ x: rand(0, W), y: rand(0, H), t: rand(0, 6) });
  }

  // ---------- Siluet cupang raksasa (dibuat sekali) ----------
  // Cupang digambar putih di kanvas tersembunyi, lalu pikselnya diambil sebagai titik tujuan.
  function buildShape() {
    const s = 95;
    const SW = 320, SH = 230, cx = 2.2 * s + 12, cy = 115;
    const off = document.createElement('canvas');
    off.width = SW;
    off.height = SH;
    const c = off.getContext('2d');
    c.translate(cx, cy);
    c.fillStyle = '#fff';

    // Ekor "halfmoon" berbentuk huruf D
    c.beginPath();
    c.moveTo(-0.7 * s, -0.1 * s);
    c.bezierCurveTo(-1.0 * s, -0.6 * s, -1.5 * s, -1.05 * s, -2.0 * s, -0.95 * s);
    c.quadraticCurveTo(-2.35 * s, 0, -2.0 * s, 0.95 * s);
    c.bezierCurveTo(-1.5 * s, 1.05 * s, -1.0 * s, 0.6 * s, -0.7 * s, 0.1 * s);
    c.fill();
    // Sirip punggung
    c.beginPath();
    c.moveTo(0.1 * s, -0.26 * s);
    c.bezierCurveTo(-0.1 * s, -0.9 * s, -0.6 * s, -1.0 * s, -0.95 * s, -0.55 * s);
    c.lineTo(-0.65 * s, -0.2 * s);
    c.fill();
    // Sirip bawah (anal)
    c.beginPath();
    c.moveTo(0.3 * s, 0.26 * s);
    c.bezierCurveTo(0.1 * s, 0.95 * s, -0.5 * s, 1.05 * s, -0.95 * s, 0.6 * s);
    c.lineTo(-0.65 * s, 0.2 * s);
    c.fill();
    // Sirip perut (panjang & tipis)
    c.beginPath();
    c.moveTo(0.45 * s, 0.25 * s);
    c.quadraticCurveTo(0.42 * s, 0.85 * s, 0.25 * s, 0.95 * s);
    c.quadraticCurveTo(0.32 * s, 0.5 * s, 0.3 * s, 0.25 * s);
    c.fill();
    // Badan
    c.beginPath();
    c.ellipse(0, 0, 0.85 * s, 0.3 * s, 0, 0, Math.PI * 2);
    c.fill();

    // Garis pemisah sirip, insang, dan mata (dilubangi supaya bentuknya terbaca)
    c.globalCompositeOperation = 'destination-out';
    c.lineCap = 'round';
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(-0.72 * s, -0.28 * s);
    c.lineTo(-1.15 * s, -0.8 * s);
    c.moveTo(-0.72 * s, 0.28 * s);
    c.lineTo(-1.15 * s, 0.8 * s);
    c.stroke();
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(0.38 * s, -0.22 * s);
    c.quadraticCurveTo(0.26 * s, 0, 0.38 * s, 0.22 * s);
    c.stroke();
    c.beginPath();
    c.arc(0.58 * s, -0.06 * s, 0.09 * s, 0, Math.PI * 2);
    c.fill();

    const data = c.getImageData(0, 0, SW, SH).data;
    const filled = (x, y) => x >= 0 && y >= 0 && x < SW && y < SH && data[(y * SW + x) * 4 + 3] > 128;

    const minX = cx - 2.2 * s;               // ujung ekor
    const maxX = cx + 0.85 * s;              // ujung kepala
    const midX = (minX + maxX) / 2;
    const tailStart = cx - 0.75 * s;

    const edges = [], fill = [];
    const step = 3;
    for (let y = 0; y < SH; y += step) {
      for (let x = 0; x < SW; x += step) {
        if (!filled(x, y)) continue;
        const pt = {
          x: x - midX,
          y: y - cy,
          tail: x < tailStart ? clamp((tailStart - x) / (tailStart - minX), 0, 1) : 0,
        };
        const isEdge = !filled(x + step, y) || !filled(x - step, y) || !filled(x, y + step) || !filled(x, y - step);
        (isEdge ? edges : fill).push(pt);
      }
    }
    return { edges, fill, halfW: (maxX - minX) / 2, halfH: 1.0 * s };
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---------- Kejutan: bentuk cupang raksasa ----------
  function formBetta(x, y) {
    if (!shape) shape = buildShape();

    formScale = Math.min((W * 0.6) / (shape.halfW * 2), (H * 0.8) / (shape.halfH * 2), 2);
    formFlip = x > W / 2 ? -1 : 1;  // menghadap ke tengah layar
    formCenter = {
      x: clamp(x, shape.halfW * formScale + 10, W - shape.halfW * formScale - 10),
      y: clamp(y, shape.halfH * formScale + 10, H - shape.halfH * formScale - 10),
    };

    // 55% partikel jadi garis tepi (supaya siluet tegas), sisanya mengisi badan
    const edges = shuffle(shape.edges.slice());
    const fill = shuffle(shape.fill.slice());
    const nEdge = Math.floor(particles.length * 0.55);
    shuffle(particles).forEach((p, i) => {
      const pt = i < nEdge ? edges[i % edges.length] : fill[i % fill.length];
      p.tx = formCenter.x + pt.x * formScale * formFlip;
      p.ty = formCenter.y + pt.y * formScale;
      p.tail = pt.tail;
    });

    mode = 'form';
    formUntil = clock + 3200;
    addRipples(x, y, 2);
  }

  // ---------- Ledakan kembali jadi partikel ----------
  function explode() {
    mode = 'follow';
    const { x, y } = formCenter;
    for (const p of particles) {
      const dx = p.x - x, dy = p.y - y;
      const d = Math.hypot(dx, dy) || 1;
      const sp = rand(5, 14);
      p.vx = (dx / d) * sp;
      p.vy = (dy / d) * sp;
    }
    flare = 1;
    dustBoost = 1;
    addRipples(x, y, 3);
  }

  function addRipples(x, y, n) {
    for (let i = 0; i < n; i++) ripples.push({ x, y, r: 0, life: 1, delay: i * 9 });
  }

  // ---------- Arus cai (membuat gerakan mengalir) ----------
  function flowAngle(x, y) {
    return Math.sin(x * 0.004 + clock * 0.0003) * Math.cos(y * 0.005 - clock * 0.0002) * Math.PI * 2;
  }

  // ---------- Update gerak ----------
  function update(k) {
    // Titik bayangan bergerak sendiri saat kursor tidak ada
    ghost.x = W * (0.5 + 0.32 * Math.sin(clock * 0.00037));
    ghost.y = H * (0.5 + 0.3 * Math.sin(clock * 0.00053 + 1));
    const target = pointer.active ? pointer : ghost;

    if (mode === 'form' && clock > formUntil) explode();

    const friction = Math.pow(0.962, k);
    const faceAngle = formFlip > 0 ? 0 : Math.PI;

    for (const p of particles) {
      if (mode === 'form') {
        // Ekor cupang raksasa berkibas
        const sway = p.tail * Math.sin(clock * 0.004 - p.tail * 3) * 18 * formScale;
        p.vx = p.vx * Math.pow(0.86, k) + (p.tx - p.x) * 0.045 * k;
        p.vy = p.vy * Math.pow(0.86, k) + (p.ty + sway - p.y) * 0.045 * k;
      } else {
        const dx = target.x - p.x, dy = target.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const pull = p.follow * 0.32 * Math.min(d, 260) / 260;
        const swirl = p.follow ? p.swirl * 0.22 * (d < 180 ? 1 : 180 / d) : 0;
        const fa = flowAngle(p.x, p.y);
        const ax = (dx / d) * pull - (dy / d) * swirl + Math.cos(fa) * 0.06;
        const ay = (dy / d) * pull + (dx / d) * swirl + Math.sin(fa) * 0.06;
        p.vx = (p.vx + ax * k) * friction;
        p.vy = (p.vy + ay * k) * friction;
      }

      const sp = Math.hypot(p.vx, p.vy);
      const max = 14;
      if (sp > max) {
        p.vx = (p.vx / sp) * max;
        p.vy = (p.vy / sp) * max;
      }
      p.x += p.vx * k;
      p.y += p.vy * k;

      if (mode === 'follow') {
        const m = 20;
        if (p.x < -m) p.x = W + m; else if (p.x > W + m) p.x = -m;
        if (p.y < -m) p.y = H + m; else if (p.y > H + m) p.y = -m;
      }

      // Arah badan
      if (mode === 'form' && Math.hypot(p.tx - p.x, p.ty - p.y) < 40) {
        // Sudah dekat tujuan: semua menghadap ke arah yang sama, supaya rapi
        let diff = faceAngle - p.angle;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        p.angle += diff * Math.min(1, 0.2 * k);
      } else if (sp > 0.4) {
        p.angle = Math.atan2(p.vy, p.vx);
      }
      p.speed = sp;
      p.phase += 0.2 * k;
    }

    flare = Math.max(0, flare - 0.01 * k);
    boost += ((mode === 'form' ? 1 : 0) - boost) * Math.min(1, 0.05 * k);
    dustBoost = Math.max(0, dustBoost - 0.012 * k);
  }

  // ---------- Menggambar ----------
  function draw() {
    // Latar gelap
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0A0806';
    ctx.fillRect(0, 0, W, H);

    // Cahaya emas yang melayang & berubah ukuran pelan
    ctx.globalCompositeOperation = 'lighter';
    const R = Math.max(W, H);
    for (const g of GLOWS) {
      const x = W * (0.5 + 0.38 * Math.sin(clock * g.sx + g.ph));
      const y = H * (0.5 + 0.35 * Math.cos(clock * g.sy + g.ph));
      const r = R * (0.45 + 0.12 * Math.sin(clock * 0.0002 + g.ph));
      const [cr, cg, cb] = g.rgb;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${cr},${cg},${cb},${g.a})`);
      grad.addColorStop(0.5, `rgba(${cr},${cg},${cb},${g.a * 0.35})`);
      grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }

    // Vinyet: pinggir sedikit lebih gelap supaya fokus ke tengah
    ctx.globalCompositeOperation = 'source-over';
    const vig = ctx.createRadialGradient(W / 2, H / 2, R * 0.25, W / 2, H / 2, R * 0.75);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    // Mulai sini semua menyala "menyatu" dengan latar
    ctx.globalCompositeOperation = 'lighter';

    // Titik berkilau
    ctx.fillStyle = '#FFE8A8';
    for (const d of dust) {
      d.t += 0.03;
      ctx.globalAlpha = clamp(0.15 + Math.sin(d.t) * 0.25 + dustBoost * 0.6, 0, 1);
      ctx.fillRect(d.x, d.y, 1.6, 1.6);
    }

    // Gelombang
    ctx.lineWidth = 1.5;
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      if (r.delay > 0) { r.delay -= 1; continue; }
      r.r += 7;
      r.life -= 0.016;
      if (r.life <= 0) { ripples.splice(i, 1); continue; }
      ctx.globalAlpha = r.life * 0.5;
      ctx.strokeStyle = '#E9C46A';
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Partikel cupang
    const fl = 1 + flare * 1.2;
    const boostMul = 1 + boost * 1.4;
    for (const p of particles) p.len = p.size * 1.2 + (p.speed || 0) * 2.4;

    // A) Partikel polos: digambar sekaligus per warna & kedalaman
    buckets.forEach((list, idx) => {
      if (!list.length) return;
      const color = COLORS[idx % COLORS.length];
      const a = Math.min(1, TIERS[Math.floor(idx / COLORS.length)].a * boostMul);

      // 1) Badan + jejak gerak (garis)
      ctx.globalAlpha = a;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (const p of list) {
        const ux = Math.cos(p.angle), uy = Math.sin(p.angle);
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - ux * p.len, p.y - uy * p.len);
      }
      ctx.stroke();

      // 2) Ekor kipas yang berkibas
      ctx.globalAlpha = a * 0.7;
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const p of list) {
        const ux = Math.cos(p.angle), uy = Math.sin(p.angle);
        const nx = -uy, ny = ux;
        const bx = p.x - ux * p.len, by = p.y - uy * p.len;
        const fanL = p.size * 1.3 * fl;
        const fanW = p.size * (0.8 + 0.25 * Math.sin(p.phase)) * fl;
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - ux * fanL + nx * fanW, by - uy * fanL + ny * fanW);
        ctx.lineTo(bx - ux * fanL - nx * fanW, by - uy * fanL - ny * fanW);
        ctx.closePath();
      }
      ctx.fill();

      // 3) Kepala
      ctx.globalAlpha = Math.min(1, a + 0.15);
      ctx.beginPath();
      for (const p of list) {
        const r = p.size * 0.35;
        ctx.moveTo(p.x + r, p.y);
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    });

    // B) Partikel bergradasi: terang di kepala, memudar sampai ujung ekor
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.1;
    for (const p of fadeList) {
      const ux = Math.cos(p.angle), uy = Math.sin(p.angle);
      const nx = -uy, ny = ux;
      const bx = p.x - ux * p.len, by = p.y - uy * p.len;
      const fanL = p.size * 1.3 * fl;
      const fanW = p.size * (0.8 + 0.25 * Math.sin(p.phase)) * fl;
      const ex = bx - ux * fanL, ey = by - uy * fanL;
      const [r, g, b] = RGB[p.ci];
      const a = Math.min(1, (TIERS[p.tier].a + 0.1) * boostMul);

      const grad = ctx.createLinearGradient(p.x, p.y, ex, ey);
      grad.addColorStop(0, `rgba(${r},${g},${b},${a})`);
      grad.addColorStop(0.6, `rgba(${r},${g},${b},${a * 0.35})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.strokeStyle = grad;
      ctx.fillStyle = grad;

      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(bx, by);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(ex + nx * fanW, ey + ny * fanW);
      ctx.lineTo(ex - nx * fanW, ey - ny * fanW);
      ctx.closePath();
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // ---------- Loop animasi ----------
  function frame(time) {
    if (!running) return;
    const dt = Math.min(time - lastTime || 16.67, 50);
    lastTime = time;
    clock += dt;
    const k = dt / 16.67; // normalisasi ke 60fps

    update(k);
    draw();
    requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(frame);
  }
  function stop() { running = false; }

  // ---------- Pasang semua event ----------
  resize();

  // Pengguna yang memilih "kurangi animasi": tampilkan partikel diam saja
  if (reduceMotion) {
    draw();
    new ResizeObserver(() => { resize(); draw(); }).observe(hero);
    return;
  }

  new ResizeObserver(resize).observe(hero);

  hero.addEventListener('pointermove', (e) => {
    const rect = hero.getBoundingClientRect();
    pointer.x = e.clientX - rect.left;
    pointer.y = e.clientY - rect.top;
    pointer.active = true;
  });
  hero.addEventListener('pointerleave', () => { pointer.active = false; });

  hero.addEventListener('contextmenu', (e) => {
    // Di tombol, link, atau foto: biarkan menu klik kanan biasa
    if (e.target.closest('a, button, img')) return;
    e.preventDefault();
    if (mode === 'form') {
      explode(); // klik kanan lagi saat jadi cupang raksasa = langsung meledak
    } else {
      const rect = hero.getBoundingClientRect();
      formBetta(e.clientX - rect.left, e.clientY - rect.top);
    }
  });

  // Hemat baterai: jalan hanya saat hero terlihat di layar
  new IntersectionObserver(([entry]) => {
    entry.isIntersecting ? start() : stop();
  }).observe(hero);
})();
