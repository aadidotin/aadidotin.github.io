/* ---------------------------------------------------------------------
   liquid-glass lens
   ---------------------------------------------------------------------
   Apple's Liquid Glass is not a noise warp. Each panel behaves like a
   slab of glass whose surface is flat through the middle and curves
   sharply over a narrow bezel at the rim. Light passing through the flat
   part goes straight on; light hitting the curve bends.

   So: build that surface, take its normals, and encode them as a
   displacement map (red = horizontal shift, green = vertical). Feed it
   to feDisplacementMap via feImage, and the backdrop bends the way real
   glass bends it — symmetric, edge-concentrated, geometric.

   The same normals drive the specular rim, so the highlight lands where
   the surface genuinely faces the light.
   --------------------------------------------------------------------- */

const LENS = {
  bezel: 26,        // px — width of the curved band at the rim
  strength: 58,     // px — how far the rim displaces the backdrop
  aberration: 0,    // channel split; 0 = single fast pass, 0.05 = pretty but 3x cost
  light: { x: -0.55, y: -0.82 }, // light direction (upper-left)
  specular: 0.85,
};

const supportsLens = CSS.supports('backdrop-filter', 'url(#x)') ||
                     CSS.supports('-webkit-backdrop-filter', 'url(#x)');

/* Signed distance to a rounded rectangle. Negative inside, zero on the
   boundary. Standard SDF — same maths a shader would use. */
function sdRoundRect(px, py, w, h, r) {
  const qx = Math.abs(px) - (w / 2 - r);
  const qy = Math.abs(py) - (h / 2 - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

/* Slope of the bezel at a given depth into the glass.
   Profile is a quarter-circle: flat where it meets the interior, near
   vertical at the very edge. That steep rim is what produces Apple's
   characteristic pinch. */
function bezelSlope(distFromEdge, bezel) {
  if (distFromEdge >= bezel) return 0;      // flat interior — no bending
  const u = 1 - distFromEdge / bezel;        // 0 inner, 1 at the rim
  const slope = u / Math.sqrt(Math.max(1 - u * u, 1e-4));
  return Math.min(slope, 5) / 5;             // clamp and normalise
}

/* Build both maps for one panel size. */
function buildMaps(w, h, radius) {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  const r = Math.min(radius, W / 2, H / 2);
  const bezel = Math.min(LENS.bezel, W / 2, H / 2);

  const disp = document.createElement('canvas');
  const spec = document.createElement('canvas');
  disp.width = spec.width = W;
  disp.height = spec.height = H;

  const dImg = disp.getContext('2d').createImageData(W, H);
  const sImg = spec.getContext('2d').createImageData(W, H);
  const d = dImg.data;
  const s = sImg.data;

  const lx = LENS.light.x, ly = LENS.light.y;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = x - W / 2 + 0.5;
      const py = y - H / 2 + 0.5;

      const dist = -sdRoundRect(px, py, W, H, r); // depth inside the shape
      const i = (y * W + x) * 4;

      if (dist <= 0) {                 // outside the rounded corners
        d[i] = 128; d[i + 1] = 128; d[i + 2] = 0; d[i + 3] = 255;
        s[i + 3] = 0;
        continue;
      }

      // Outward surface normal = gradient of the distance field.
      const e = 1;
      const gx = (-sdRoundRect(px + e, py, W, H, r)) - (-sdRoundRect(px - e, py, W, H, r));
      const gy = (-sdRoundRect(px, py + e, W, H, r)) - (-sdRoundRect(px, py - e, W, H, r));
      const len = Math.hypot(gx, gy) || 1;
      const nx = -gx / len;            // points outward from the centre
      const ny = -gy / len;

      const slope = bezelSlope(dist, bezel);

      // Displacement: 128 is neutral, so the flat middle stays untouched.
      d[i]     = Math.round(128 + nx * slope * 127);
      d[i + 1] = Math.round(128 + ny * slope * 127);
      d[i + 2] = 0;
      d[i + 3] = 255;

      // Specular: brightest where the tilted surface faces the light.
      const facing = Math.max(0, nx * lx + ny * ly);
      const rim = Math.pow(facing, 2.2) * Math.pow(slope, 0.8);
      s[i] = s[i + 1] = s[i + 2] = 255;
      s[i + 3] = Math.round(Math.min(1, rim * LENS.specular) * 255);
    }
  }

  disp.getContext('2d').putImageData(dImg, 0, 0);
  spec.getContext('2d').putImageData(sImg, 0, 0);

  return { displacement: disp.toDataURL(), specular: spec.toDataURL() };
}

/* Chromatic aberration: displace the three channels by slightly
   different amounts and recombine. Real lenses split colour at the rim,
   and leaving it out is why edges look plastic. */
function buildFilter(id, W, H, maps) {
  const S = LENS.strength;
  const a = LENS.aberration;
  const svgNS = 'http://www.w3.org/2000/svg';

  const filter = document.createElementNS(svgNS, 'filter');
  filter.setAttribute('id', id);
  filter.setAttribute('filterUnits', 'userSpaceOnUse');
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  filter.setAttribute('x', '0');
  filter.setAttribute('y', '0');
  filter.setAttribute('width', W);
  filter.setAttribute('height', H);

  // One displacement pass is the cheap path. The three-pass colour split
  // (chromatic aberration) looks better but costs 3x the per-pixel work,
  // so it's only emitted when explicitly turned on.
  if (a <= 0) {
    filter.innerHTML = `
      <feImage href="${maps.displacement}" x="0" y="0" width="${W}" height="${H}"
               preserveAspectRatio="none" result="map"/>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="${S}"
                         xChannelSelector="R" yChannelSelector="G"/>
    `;
    return filter;
  }

  const keepChannel = {
    R: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
    G: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
    B: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
  };

  filter.innerHTML = `
    <feImage href="${maps.displacement}" x="0" y="0" width="${W}" height="${H}"
             preserveAspectRatio="none" result="map"/>

    <feDisplacementMap in="SourceGraphic" in2="map" scale="${S * (1 + a)}"
                       xChannelSelector="R" yChannelSelector="G" result="dr"/>
    <feDisplacementMap in="SourceGraphic" in2="map" scale="${S}"
                       xChannelSelector="R" yChannelSelector="G" result="dg"/>
    <feDisplacementMap in="SourceGraphic" in2="map" scale="${S * (1 - a)}"
                       xChannelSelector="R" yChannelSelector="G" result="db"/>

    <feColorMatrix in="dr" values="${keepChannel.R}" result="cr"/>
    <feColorMatrix in="dg" values="${keepChannel.G}" result="cg"/>
    <feColorMatrix in="db" values="${keepChannel.B}" result="cb"/>

    <feBlend in="cr" in2="cg" mode="screen" result="crg"/>
    <feBlend in="crg" in2="cb" mode="screen"/>
  `;

  return filter;
}

/* Wire every glass panel to its own lens, regenerated when it resizes. */
function initLenses() {
  if (!supportsLens) return;

  const defs = document.getElementById('lens-defs');
  const panels = document.querySelectorAll('.glass');
  let uid = 0;

  panels.forEach((panel) => {
    const id = `lens-${uid++}`;
    let signature = '';
    let built = false;

    const build = () => {
      const rect = panel.getBoundingClientRect();
      const W = Math.round(rect.width);
      const H = Math.round(rect.height);
      if (W < 8 || H < 8) return;

      const radius = parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 0;
      const key = `${W}x${H}r${radius}`;
      if (key === signature) return;    // size unchanged, reuse existing map
      signature = key;

      const maps = buildMaps(W, H, radius);

      const existing = document.getElementById(id);
      if (existing) existing.remove();
      defs.appendChild(buildFilter(id, W, H, maps));

      panel.style.setProperty('--lg-filter', `url(#${id})`);
      panel.style.setProperty('--lg-specular', `url(${maps.specular})`);
      built = true;
    };

    // Turn the lens on only while the panel is near the viewport. A
    // backdrop-filter that isn't visible still costs paint time, so
    // off-screen cards fall back to the cheap frosted .glass rule.
    const enter = () => {
      if (!built) build();
      panel.classList.add('lg-lens');
    };
    const leave = () => panel.classList.remove('lg-lens');

    if ('IntersectionObserver' in window) {
      const vis = new IntersectionObserver(
        (entries) => entries.forEach((e) => (e.isIntersecting ? enter() : leave())),
        { rootMargin: '200px 0px' }   // warm up just before it scrolls in
      );
      vis.observe(panel);
    } else {
      enter();
    }

    if ('ResizeObserver' in window) {
      let queued = false;
      new ResizeObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          signature = '';          // force a rebuild at the new size
          if (panel.classList.contains('lg-lens')) build();
        });
      }).observe(panel);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLenses);
} else {
  initLenses();
}
