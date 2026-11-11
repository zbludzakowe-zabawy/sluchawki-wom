// Słuchawki – confetti w nagrodę (bez bibliotek).
export function confetti(duration = 3500) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  document.body.appendChild(c);
  const g = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const resize = () => { c.width = innerWidth * dpr; c.height = innerHeight * dpr; };
  resize();
  const colors = ['#ff7a59', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff', '#ff5d8f'];
  const shapes = ['rect', 'circle', 'note'];
  const N = Math.min(220, Math.round(innerWidth / 3));
  const parts = Array.from({ length: N }, () => ({
    x: Math.random() * c.width,
    y: -Math.random() * c.height * 0.6,
    vx: (Math.random() - 0.5) * 3 * dpr,
    vy: (2 + Math.random() * 4) * dpr,
    r: (5 + Math.random() * 6) * dpr,
    a: Math.random() * Math.PI,
    va: (Math.random() - 0.5) * 0.3,
    color: colors[(Math.random() * colors.length) | 0],
    shape: shapes[(Math.random() * shapes.length) | 0],
  }));
  const t0 = performance.now();
  const frame = (t) => {
    const age = t - t0;
    g.clearRect(0, 0, c.width, c.height);
    g.globalAlpha = age > duration - 800 ? Math.max(0, (duration - age) / 800) : 1;
    for (const p of parts) {
      p.x += p.vx + Math.sin((t / 400) + p.a) * 0.8 * dpr;
      p.y += p.vy;
      p.a += p.va;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.a);
      g.fillStyle = p.color;
      if (p.shape === 'rect') g.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      else if (p.shape === 'circle') { g.beginPath(); g.arc(0, 0, p.r / 2.5, 0, Math.PI * 2); g.fill(); }
      else { g.font = `${p.r * 2}px sans-serif`; g.fillText('♪', -p.r / 2, p.r / 2); }
      g.restore();
    }
    if (age < duration) requestAnimationFrame(frame);
    else c.remove();
  };
  requestAnimationFrame(frame);
}
