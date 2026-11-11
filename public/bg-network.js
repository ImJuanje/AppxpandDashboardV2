/* AppXpand · Fondo animado «red de puntos» (sin librerías).
   Nodos que flotan y se conectan entre sí, siguen suavemente al cursor/dedo y de vez en cuando
   lanzan un pulso (como una ubicación en Google Maps). Se pausa si no se ve o la pestaña está en
   segundo plano, y con «reducir movimiento» queda como imagen fija.
   Uso: AXBackground(canvas, { colors: ['#4a8eff', '#8b5cf6'] }) */
(function () {
  window.AXBackground = function (canvas, opt) {
    if (!canvas || !canvas.getContext) return;
    opt = Object.assign({ colors: ['#4a8eff', '#8b5cf6'], density: 14000, max: 90, link: 130 }, opt || {});
    const ctx = canvas.getContext('2d');
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const host = canvas.parentElement;
    let w = 0, h = 0, nodes = [], pings = [], raf = 0, running = false, lastPing = 0, visible = true;
    const mouse = { x: -9999, y: -9999 };
    const rnd = (a, b) => a + Math.random() * (b - a);

    function size() {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.max(22, Math.min(opt.max, Math.round(w * h / opt.density)));
      while (nodes.length < n) nodes.push({ x: rnd(0, w), y: rnd(0, h), vx: rnd(-.25, .25), vy: rnd(-.25, .25), r: rnd(1.2, 2.5), c: opt.colors[Math.random() < .5 ? 0 : 1] });
      nodes.length = n;
      nodes.forEach(p => { p.x = Math.min(p.x, w); p.y = Math.min(p.y, h); });
      if (reduce) frame(0);
    }

    function frame(t) {
      ctx.clearRect(0, 0, w, h);
      for (const p of nodes) {
        if (reduce) continue;
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        const dx = p.x - mouse.x, dy = p.y - mouse.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d < 120 && d > 0) { const f = (1 - d / 120) * .7; p.x += dx / d * f; p.y += dy / d * f; }
      }
      const L2 = opt.link * opt.link;
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d = dx * dx + dy * dy;
          if (d < L2) { ctx.globalAlpha = (1 - d / L2) * .5; ctx.strokeStyle = a.c; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        }
        const mx = a.x - mouse.x, my = a.y - mouse.y, md = mx * mx + my * my;
        if (md < 19600) { ctx.globalAlpha = (1 - md / 19600) * .6; ctx.strokeStyle = b0(a); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
      for (const p of nodes) { ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill(); }
      if (!reduce) {
        if (t - lastPing > 1400 && pings.length < 4 && nodes.length) { pings.push({ p: nodes[(Math.random() * nodes.length) | 0], t0: t }); lastPing = t; }
        pings = pings.filter(g => {
          const k = (t - g.t0) / 1800;
          if (k >= 1) return false;
          ctx.globalAlpha = (1 - k) * .55; ctx.strokeStyle = g.p.c; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(g.p.x, g.p.y, 4 + k * 34, 0, 6.283); ctx.stroke();
          return true;
        });
      }
      ctx.globalAlpha = 1;
    }
    const b0 = () => opt.colors[0];

    function tick(t) { if (!running) return; frame(t); raf = requestAnimationFrame(tick); }
    function update() {
      const should = visible && !document.hidden && !reduce;
      if (should && !running) { running = true; raf = requestAnimationFrame(tick); }
      else if (!should && running) { running = false; cancelAnimationFrame(raf); }
    }

    host.addEventListener('pointermove', e => { const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; }, { passive: true });
    host.addEventListener('pointerleave', () => { mouse.x = mouse.y = -9999; });
    document.addEventListener('visibilitychange', update);
    if ('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es[0].isIntersecting; update(); }).observe(canvas);
    if ('ResizeObserver' in window) new ResizeObserver(size).observe(canvas); else window.addEventListener('resize', size);
    size(); update();
  };
})();
