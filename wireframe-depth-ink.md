# Depth-Weighted Wireframe Rendering

## Problem

In a 3D wireframe renderer, line weight is a natural depth cue: near edges should look heavier, far edges lighter. But projected edges are drawn on a pixel grid, and a line can't usefully be thinner than ~1px. That leaves no room to make distant lines "thinner," so a typical wireframe draws every edge at 1px and loses its depth cue. The result:

- the shape reads only while it moves,
- front and back are ambiguous (Necker-cube effect),
- crossing lines give no hint of which is in front.

## Solution

### 1. Use *ink*, not width, as the depth cue

```
ink = width × opacity
```

Width has a floor at 1px, but ink doesn't. Compute a target weight `w` per vertex and render it in one of three regimes:

| Target weight `w` | Drawn width | Opacity |
|---|---|---|
| `w < 1` | 1px | `w` |
| `1 ≤ w ≤ wMax` | `w` | 1 |
| `w > wMax` | `wMax` (clamp) | 1 |

Perceived weight then changes continuously across the 1px boundary. This is the same thing antialiasing does for sub-pixel lines, but here it's done on purpose.

### 2. Depth → weight mapping

Normalize depth to the scene's actual near/far range, then map on a log curve so the whole range gets used evenly:

```
t = clamp((zFar − z) / (zFar − zNear), 0, 1)   // 1 = nearest
w = wMin · (wMax / wMin)^t
```

Typical values: `wMin ≈ 0.25`, `wMax ≈ 3` px.

### 3. Tapered edges

Weight is computed **per vertex**, and each edge is drawn as a quad whose width is interpolated along its length. An edge that recedes tapers like a pen stroke, and crosses the width/opacity boundary smoothly where it passes 1px.

### 4. Occlusion haloes

Width shows *how far* a line is, but not *what's in front* where two lines cross. At each screen-space crossing:

1. Find the crossing point on both edges.
2. Get each edge's depth there, interpolating `1/z` for perspective correctness.
3. Cut a gap in the **farther** edge only.

Gap half-length along the far edge:

```
half = (max(wNear,1) / 2) / max(|sin θ|, 0.25)    // clears the near line at angle θ
     + extra
```

- **Fixed halo:** `extra` is a constant, e.g. 1.5px.
- **Depth-scaled halo (variant):** `extra = 0.5 + gain · Δz_normalized · 10`. Wide gaps then mean a large depth separation and narrow gaps mean the lines are close, so the gaps act as a rough depth map. A `gain` of about 1–2 looks best; higher values chop far lines into dashes that read as "hidden."

Resolving per crossing, rather than sorting whole edges, also handles long edges whose depth order flips along their length.

### 5. Linear-light blending

Do coverage and opacity math in linear color space and gamma-correct at output. Otherwise 30% opacity won't *look* like 30% weight, and the depth ramp looks uneven.

### Optional cues

- Slight contrast or hue shift with depth (atmospheric cueing).
- Dashed hidden edges instead of removing them.
- Define "1px" in **device** pixels: on high-DPI screens there's extra headroom.

---

## Prior art and tools

Most of this is established technique rather than new:

- Intensity depth cueing on vector displays (1960s–70s).
- Haloed lines: Appel, Rohlf & Stein, SIGGRAPH 1979.
- Depth-based stroke thickness in non-photorealistic rendering research (e.g. Goodwin, Vollick & Hertzmann, 2007).

The depth-scaled per-crossing halo may be less common; it has not been checked against the literature.

Off-the-shelf options:

- **Pencil+ 4** (PSOFT, commercial): distance-based line size and alpha reduction. A plugin for 3ds Max, Maya, Unity and Blender.
- **Blender Freestyle / Line Art**: free, offline, with distance-based thickness and alpha modifiers.
- **Babylon.js GreasedLine**: per-point width multipliers; the best web starting point.
- **Three.js `Line2`/`LineMaterial`**: fat lines with optional world-unit width.

None bundles all of the above, so for an app you write a custom line shader on top of a base engine.

---

## Reference implementation (Canvas 2D, standalone)

A complete prototype: a rotating torus with four modes (flat 1px, ink, fixed halo, depth-scaled halo). Save it as `index.html` and open it in a browser. Drag to rotate.

Crossing detection here is brute-force O(n²) with bounding-box rejection. That's fine for ~1,000 edges; see the GPU section for production.

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Depth-Ink Wireframe</title>
<style>
  body { margin: 0; font: 14px system-ui, sans-serif; background: #f4f3ef; color: #222; }
  .ui { padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
  canvas { display: block; width: 100%; height: 70vh; touch-action: none; }
  button.on { background: #222; color: #fff; }
</style>
</head>
<body>
<div class="ui">
  <span id="modes">
    <button data-m="0">Flat 1px</button>
    <button data-m="1">Ink</button>
    <button data-m="2">Fixed halo</button>
    <button data-m="3" class="on">Depth halo</button>
  </span>
  <label>Near <input id="mx" type="range" min="1" max="6" step="0.5" value="3"></label>
  <label>Far <input id="mn" type="range" min="0.1" max="1" step="0.05" value="0.25"></label>
  <label>Halo gain <input id="hg" type="range" min="0" max="3" step="0.1" value="1.5"></label>
</div>
<canvas id="cv"></canvas>
<script>
// ---- config / state ----
const BG = '#f4f3ef', FG = '#222';
let mode = 3, wMax = 3, wMin = 0.25, gain = 1.5;
let ax = 0.55, ay = 0, drag = null, paused = false;

const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
function resize() {
  const d = devicePixelRatio || 1;
  cv.width = cv.clientWidth * d; cv.height = cv.clientHeight * d;
  ctx.setTransform(d, 0, 0, d, 0, 0);
}
addEventListener('resize', resize); resize();

// ---- geometry: torus wireframe ----
const R = 1, r = 0.42, U = 28, V = 12, P = [], E = [];
for (let i = 0; i < U; i++) for (let j = 0; j < V; j++) {
  const u = i / U * 2 * Math.PI, v = j / V * 2 * Math.PI;
  P.push([(R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u)]);
  const a = i * V + j;
  E.push([a, ((i + 1) % U) * V + j]);   // around the ring
  E.push([a, i * V + (j + 1) % V]);     // around the tube
}

// ---- UI ----
document.getElementById('modes').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  mode = +b.dataset.m;
  document.querySelectorAll('#modes button').forEach(x => x.classList.toggle('on', x === b));
};
document.getElementById('mx').oninput = e => wMax = +e.target.value;
document.getElementById('mn').oninput = e => wMin = +e.target.value;
document.getElementById('hg').oninput = e => gain = +e.target.value;
cv.onpointerdown = e => { drag = [e.clientX, e.clientY]; paused = true; cv.setPointerCapture(e.pointerId); };
cv.onpointermove = e => {
  if (!drag) return;
  ay += (e.clientX - drag[0]) * 0.01; ax += (e.clientY - drag[1]) * 0.01;
  drag = [e.clientX, e.clientY];
};
cv.onpointerup = () => drag = null;

// ---- camera ----
const D = 3.4, zNear = D - 1.45, zFar = D + 1.45;   // scene depth range

// Draw part [t0,t1] of edge a→b as a tapered quad with round caps.
// a, b = [screenX, screenY, z, weight]
function piece(a, b, t0, t1) {
  const lerp = (p, q, t) => p + (q - p) * t;
  const x0 = lerp(a[0], b[0], t0), y0 = lerp(a[1], b[1], t0);
  const x1 = lerp(a[0], b[0], t1), y1 = lerp(a[1], b[1], t1);
  const w0 = lerp(a[3], b[3], t0), w1 = lerp(a[3], b[3], t1);
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
  const h0 = Math.max(w0, 1) / 2, h1 = Math.max(w1, 1) / 2;   // width floor = 1px
  ctx.globalAlpha = Math.min(1, (w0 + w1) / 2);                // sub-pixel weight → opacity
  ctx.fillStyle = FG;
  ctx.beginPath();
  ctx.moveTo(x0 + nx * h0, y0 + ny * h0); ctx.lineTo(x1 + nx * h1, y1 + ny * h1);
  ctx.lineTo(x1 - nx * h1, y1 - ny * h1); ctx.lineTo(x0 - nx * h0, y0 - ny * h0);
  ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(x0, y0, h0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(x1, y1, h1, 0, 7); ctx.fill();
}

function frame() {
  if (!paused) ay += 0.005;
  const W = cv.clientWidth, H = cv.clientHeight, f = Math.min(W, H) * 1.05;
  ctx.globalAlpha = 1; ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);

  // Transform + project; compute per-vertex weight from depth (log mapping).
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay);
  const S = P.map(([x, y, z]) => {
    let X = x * cy + z * sy, Z = -x * sy + z * cy, Y = y * cx - Z * sx;
    Z = y * sx + Z * cx + D;
    const t = Math.min(1, Math.max(0, (zFar - Z) / (zFar - zNear)));
    return [W / 2 + X * f / Z, H / 2 + Y * f / Z, Z, wMin * Math.pow(wMax / wMin, t)];
  });

  if (mode === 0) {   // baseline: uniform 1px
    ctx.strokeStyle = FG; ctx.lineWidth = 1; ctx.beginPath();
    for (const [a, b] of E) { ctx.moveTo(S[a][0], S[a][1]); ctx.lineTo(S[b][0], S[b][1]); }
    ctx.stroke(); requestAnimationFrame(frame); return;
  }

  // Per-edge screen bounding boxes + lengths, and a gap list per edge.
  const n = E.length, gaps = E.map(() => []);
  const B = E.map(([a, b]) => {
    const p = S[a], q = S[b];
    return [Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[1], q[1]),
            Math.hypot(q[0] - p[0], q[1] - p[1]) || 1];
  });

  // Haloes: find every screen-space crossing and cut a gap in the farther edge.
  if (mode >= 2) for (let i = 0; i < n; i++) {
    const [a, b] = E[i], bi = B[i], A = S[a], Bv = S[b], rx = Bv[0] - A[0], ry = Bv[1] - A[1];
    for (let j = i + 1; j < n; j++) {
      const bj = B[j];
      if (bj[0] > bi[1] || bj[1] < bi[0] || bj[2] > bi[3] || bj[3] < bi[2]) continue;
      const [c, d] = E[j];
      if (c === a || c === b || d === a || d === b) continue;   // shared vertex, not a crossing
      const C = S[c], Dv = S[d], sx2 = Dv[0] - C[0], sy2 = Dv[1] - C[1];
      const den = rx * sy2 - ry * sx2; if (Math.abs(den) < 1e-9) continue;
      const qx = C[0] - A[0], qy = C[1] - A[1];
      const t = (qx * sy2 - qy * sx2) / den, u = (qx * ry - qy * rx) / den;
      if (t <= 0 || t >= 1 || u <= 0 || u >= 1) continue;

      // Perspective-correct depth at the crossing (interpolate 1/z).
      const zi = 1 / ((1 - t) / A[2] + t / Bv[2]);
      const zj = 1 / ((1 - u) / C[2] + u / Dv[2]);
      const iNear = zi < zj, far = iNear ? j : i, tFar = iNear ? u : t;
      const wNear = iNear ? A[3] + (Bv[3] - A[3]) * t : C[3] + (Dv[3] - C[3]) * u;

      const sinT = Math.max(Math.abs(den) / (bi[4] * bj[4]), 0.25);
      const dzN = Math.abs(zi - zj) / (zFar - zNear);
      const half = Math.max(wNear, 1) / 2 / sinT + (mode === 2 ? 1.5 : 0.5 + gain * dzN * 10);
      const h = half / B[far][4];
      gaps[far].push([tFar - h, tFar + h]);
    }
  }

  // Draw each edge minus its gaps.
  for (let i = 0; i < n; i++) {
    const A = S[E[i][0]], Bv = S[E[i][1]], g = gaps[i].sort((p, q) => p[0] - q[0]);
    let s = 0;
    for (const [g0, g1] of g) {
      if (g0 > s) piece(A, Bv, s, Math.min(g0, 1));
      s = Math.max(s, g1); if (s >= 1) break;
    }
    if (s < 1) piece(A, Bv, Math.max(s, 0), 1);
  }
  ctx.globalAlpha = 1;
  requestAnimationFrame(frame);
}
frame();
</script>
</body>
</html>
```

**Known limitations of the prototype:**

- Canvas 2D blends in sRGB, not linear light.
- Where translucent sub-pixel edges meet, overlapping round caps slightly darken the joints.
- The O(n²) crossing test doesn't scale past a few thousand edges.

---

## Production directions (GPU)

For an interactive app, use a base engine and write a custom line shader. Structure:

### Pass 1: lines

- **Instanced quads:** one instance per edge, with both endpoints as per-instance attributes. Expand to a screen-space quad in the vertex shader.
- **Ink mapping in the vertex shader:**
  ```glsl
  // per endpoint, after projection
  float t   = clamp((uZFar - viewZ) / (uZFar - uZNear), 0.0, 1.0);
  float w   = uWMin * pow(uWMax / uWMin, t);     // target weight (px)
  float wid = clamp(w, 1.0, uWMax);              // drawn width
  float a   = min(w, 1.0);                       // opacity for sub-pixel weight
  // offset quad corners by ±(wid/2 + 1px AA margin) along the screen-space normal
  // pass `a`, `wid`, and signed distance-from-center as varyings
  ```
- **Analytic antialiasing in the fragment shader:** compute coverage from the pixel's distance to the line center, e.g. `coverage = clamp(wid/2 + 0.5 - abs(dist), 0, 1)`. Output `color × coverage × a`. This matters more than MSAA for crisp 1px and sub-pixel lines.
- Write line depth to a depth or float target for pass 2.
- Use **premultiplied alpha** and an **sRGB-encoded render target** (linear blending, gamma on output).

### Pass 2: haloes (screen space)

For each line pixel at depth `z`, search a small neighborhood (e.g. 2–8px) in the line-depth buffer for a nearer pixel at depth `z' < z − ε`. If one is found within radius `r(Δz)`, discard or fade this pixel. For the depth-scaled variant, make `r` grow with `Δz = z − z'`. This replaces the CPU's O(n²) crossing search with a fixed per-pixel cost. A separable or jump-flood distance pass keeps large radii cheap.

### Choosing a base

| Target | Base |
|---|---|
| Web / webview | Babylon.js: start from GreasedLine and add a material plugin for the ink mapping and halo pass |
| Native, cross-platform | wgpu (Rust) for full control, or Unity / Godot if the app needs a general 3D engine |
| Apple only | Metal |

### Open questions

- Target platform?
- Typical model size (hundreds vs. millions of edges)? This decides between the simple path (instanced quads, CPU-fed) and a GPU-driven pipeline with culling and LOD.
