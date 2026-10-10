/* Rhymescape chain engine (style-tile prototype).
   Generates rhyme-chain colours programmatically, for any number of chains,
   and guarantees WCAG contrast against the active stock.

   Colour is never the only signal: every chain also gets a marker shape,
   an arc/underline line style and a letter. These cycle at different rates
   (8 shapes x 5 line styles) so combinations stay unique for 40 chains,
   and the letter label is always unique. */
(function (global) {
  'use strict';

  const GOLDEN_ANGLE = 137.50776405;
  const START_HUE = 354; // chain A starts near the pink ink
  const MIN_CONTRAST = 4.7; // WCAG AA is 4.5; the margin absorbs rounding

  /* ── OKLCH maths ─────────────────────────────────────── */
  function oklchToLinear(L, C, hDeg) {
    const h = (hDeg * Math.PI) / 180;
    const a = C * Math.cos(h);
    const b = C * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
  }

  const inGamut = (rgb) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

  function luminance(rgb) {
    const [r, g, b] = rgb.map((v) => Math.min(1, Math.max(0, v)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  const lum = (c) => luminance(oklchToLinear(c.L, c.C, c.h));
  const ratioOfY = (y1, y2) => (Math.max(y1, y2) + 0.05) / (Math.min(y1, y2) + 0.05);
  const contrast = (a, b) => ratioOfY(lum(a), lum(b));
  /* A chain colour may land on any stock, so it must pass on the hardest one. */
  const worstContrast = (c, surfaces) => Math.min(...surfaces.map((s) => contrast(c, s)));

  /* Largest chroma that still fits in sRGB at this lightness and hue. */
  function maxChroma(L, h) {
    let lo = 0;
    let hi = 0.4;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(L, mid, h))) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  const fmt = (c) => `oklch(${c.L.toFixed(3)} ${c.C.toFixed(3)} ${c.h.toFixed(1)})`;

  function parseOklch(str) {
    const m = /oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/i.exec(str || '');
    if (!m) return null;
    const L = m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
    return { L, C: parseFloat(m[2]), h: parseFloat(m[3]) };
  }

  /* ── Chain generation ────────────────────────────────── */

  /* Lightest lightness at which the ink still clears MIN_CONTRAST against every surface,
     at the chain's hue, with chroma capped by the gamut. */
  function solveInk(h, chromaWanted, surfaces, lightnessNudge) {
    const step = -0.005;
    let L = 0.8;
    let best = null;
    for (let i = 0; i < 120; i++, L += step) {
      const C = Math.min(chromaWanted, maxChroma(L, h) * 0.97);
      const c = { L, C, h };
      if (worstContrast(c, surfaces) >= MIN_CONTRAST) {
        best = c;
        break;
      }
    }
    if (!best) best = { L: 0.2, C: 0.02, h };
    if (lightnessNudge) {
      // Alternate chains sit a touch deeper so neighbours differ in value as well as hue.
      const L2 = best.L - lightnessNudge;
      best = { L: L2, C: Math.min(chromaWanted, maxChroma(L2, h) * 0.97), h };
      while (worstContrast(best, surfaces) < MIN_CONTRAST) {
        best.L -= 0.005;
        best.C = Math.min(chromaWanted, maxChroma(best.L, h) * 0.97);
      }
    }
    return best;
  }

  /* Highlighter fill that the page's body ink can sit on at 4.5:1. */
  function solveWash(h, text) {
    let L = 0.87;
    let c;
    for (let i = 0; i < 60; i++) {
      c = { L, C: Math.min(0.17, maxChroma(L, h) * 0.95), h };
      if (contrast(c, text) >= MIN_CONTRAST) break;
      L += 0.005;
    }
    return c;
  }

  const MARKERS = [
    { name: 'circle', d: 'M-4.4 0a4.4 4.4 0 1 0 8.8 0a4.4 4.4 0 1 0 -8.8 0Z' },
    { name: 'square', d: 'M-3.8 -3.8H3.8V3.8H-3.8Z' },
    { name: 'triangle', d: 'M0 -5.2L5 3.8H-5Z' },
    { name: 'diamond', d: 'M0 -5.6L5.6 0L0 5.6L-5.6 0Z' },
    { name: 'plus', d: 'M-1.7 -5.2H1.7V-1.7H5.2V1.7H1.7V5.2H-1.7V1.7H-5.2V-1.7H-1.7Z' },
    { name: 'cross', d: 'M-3.6 -5.6L0 -2L3.6 -5.6L5.6 -3.6L2 0L5.6 3.6L3.6 5.6L0 2L-3.6 5.6L-5.6 3.6L-2 0L-5.6 -3.6Z' },
    { name: 'hexagon', d: 'M-2.7 -4.7H2.7L5.4 0L2.7 4.7H-2.7L-5.4 0Z' },
    { name: 'spark', d: 'M0 -6L1.6 -1.6L6 0L1.6 1.6L0 6L-1.6 1.6L-6 0L-1.6 -1.6Z' },
  ];

  /* text-decoration-style names double as the arc style names. */
  const LINE_STYLES = ['solid', 'dashed', 'dotted', 'wavy', 'double'];

  function chainLabel(i) {
    let s = '';
    let n = i;
    do {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
  }

  /* surfaces: every stock a chain colour can land on. text: body ink. All {L,C,h}.
     Returns n chains; there is no upper limit. */
  function generateChains(n, surfaces, text) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const h = (START_HUE + i * GOLDEN_ANGLE) % 360;
      const chromaWanted = i % 2 === 0 ? 0.2 : 0.17;
      const ink = solveInk(h, chromaWanted, surfaces, i % 2 === 0 ? 0 : 0.035);
      const wash = solveWash(h, text);
      out.push({
        index: i,
        label: chainLabel(i),
        hue: h,
        ink,
        wash,
        inkCss: fmt(ink),
        washCss: fmt(wash),
        inkRatio: worstContrast(ink, surfaces),
        washRatio: contrast(text, wash),
        marker: MARKERS[i % MARKERS.length],
        lineStyle: LINE_STYLES[i % LINE_STYLES.length],
      });
    }
    return out;
  }

  /* Publish chains as --chain-{i}-ink / --chain-{i}-wash on an element. */
  function applyChainVars(el, chains) {
    chains.forEach((c) => {
      el.style.setProperty(`--chain-${c.index}-ink`, c.inkCss);
      el.style.setProperty(`--chain-${c.index}-wash`, c.washCss);
    });
  }

  /* ── Arc geometry (pure maths, no DOM) ───────────────── */

  function sampleCubic(p0, p1, p2, p3, count) {
    const pts = [];
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const u = 1 - t;
      pts.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
    return pts;
  }

  /* Same-row rhyme arc: rises from a to b over the text. */
  function arcPoints(x1, x2, y, height) {
    const k = Math.min(0.36 * Math.abs(x2 - x1), height * 1.1);
    return sampleCubic([x1, y], [x1 + Math.sign(x2 - x1) * k * 0.25, y - height * 1.28], [x2 - Math.sign(x2 - x1) * k * 0.25, y - height * 1.28], [x2, y], 56);
  }

  /* Cross-row route: up, along the lane, down the gutter, along, down. Rounded corners. */
  function routePoints(vertices, radius) {
    const pts = [vertices[0]];
    for (let i = 1; i < vertices.length - 1; i++) {
      const [px, py] = vertices[i - 1];
      const [cx, cy] = vertices[i];
      const [nx, ny] = vertices[i + 1];
      const d1 = Math.hypot(cx - px, cy - py);
      const d2 = Math.hypot(nx - cx, ny - cy);
      const r = Math.min(radius, d1 / 2, d2 / 2);
      const a = [cx - ((cx - px) / d1) * r, cy - ((cy - py) / d1) * r];
      const b = [cx + ((nx - cx) / d2) * r, cy + ((ny - cy) / d2) * r];
      pts.push(a);
      for (let s = 1; s < 8; s++) {
        const t = s / 8;
        const u = 1 - t;
        pts.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1]]);
      }
      pts.push(b);
    }
    pts.push(vertices[vertices.length - 1]);
    return pts;
  }

  function resample(pts, spacing) {
    const out = [pts[0]];
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      let [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      let seg = Math.hypot(x1 - x0, y1 - y0);
      while (carry + seg >= spacing) {
        const t = (spacing - carry) / seg;
        x0 += (x1 - x0) * t;
        y0 += (y1 - y0) * t;
        out.push([x0, y0]);
        seg = Math.hypot(x1 - x0, y1 - y0);
        carry = 0;
      }
      carry += seg;
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  function offsetPoints(pts, fn) {
    // fn(distanceAlong) -> perpendicular offset in px
    let along = 0;
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      if (i > 0) along += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      const o = fn(along);
      return [p[0] + (-dy / len) * o, p[1] + (dx / len) * o];
    });
  }

  const toPath = (pts) => 'M' + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L');

  /* Returns [{d, width, dash, cap}] strokes that render the given line style. */
  function strokesFor(style, pts) {
    const dense = resample(pts, 2.2);
    switch (style) {
      case 'dashed':
        return [{ d: toPath(pts), width: 2.4, dash: '9 6', cap: 'butt' }];
      case 'dotted':
        return [{ d: toPath(pts), width: 3.2, dash: '0.1 6.4', cap: 'round' }];
      case 'wavy':
        return [{ d: toPath(offsetPoints(dense, (s) => Math.sin(s / 2.1) * 2.6)), width: 2, dash: '', cap: 'round' }];
      case 'double':
        return [
          { d: toPath(offsetPoints(dense, () => -2.3)), width: 1.5, dash: '', cap: 'round' },
          { d: toPath(offsetPoints(dense, () => 2.3)), width: 1.5, dash: '', cap: 'round' },
        ];
      default:
        return [{ d: toPath(pts), width: 2.6, dash: '', cap: 'round' }];
    }
  }

  global.Rhymescape = Object.assign(global.Rhymescape || {}, {
    chains: {
      generateChains,
      applyChainVars,
      parseOklch,
      contrast,
      worstContrast,
      lum,
      fmt,
      MARKERS,
      LINE_STYLES,
      MIN_CONTRAST,
      chainLabel,
      arcPoints,
      routePoints,
      strokesFor,
      toPath,
    },
  });
})(window);
