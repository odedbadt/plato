# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# From this directory (plato/ is self-contained — it has its own package.json
# and node_modules; there is no package.json one level up):
npm run build   # TypeScript type-checking (tsc -b)
npm run bundle  # Webpack bundle — required for the app to pick up changes
```

`index.html` loads `./bundle.js`, which webpack writes to this directory. Running only `tsc -b` does **not** update the bundle.

## Architecture

**Plato** is an interactive 3D polyhedra viewer — a static web app where users can view, rotate, and draw on Platonic solids and related shapes.

### Entry Points
- `index.html` — Two stacked canvases: `#mainCanvas` (3D) and `#textureCanvas` (drawing overlay)
- `src/ts/index.ts` — Dynamically imports `app.ts`, initializes with `stellated_dodecahedron`

### Core Modules

**`src/ts/app.ts`** — Main application controller. Handles model loading, UI events, drawing with mirror symmetry, color/pen selection, and canvas lifecycle. Uses Vue 3 (minimal — just the model selector dropdown). Every model is generated on the spot by `src/ts/symmetry/`; there is no fetch, no cache and no loading state. `drop_stale_model_cache()` clears what the old fetching version left in localStorage and can go once no browser still holds it.

**`src/ts/symmetry/`** — Generates every polyhedron at runtime, replacing the JSON files that used to ship. A TypeScript port of the Python/jupytext notebooks in `~/work/weekend/concepts/symmetry/`.
- `linalg.ts` — vec3 / row-major mat3 helpers.
- `geometry.ts` — the Coxeter kaleidoscope construction: `place_mirrors()` positions three mirror planes at angles pi/x, pi/y, pi/z; `mirror_matrices_to_group_transformations()` closes the Householder reflections into the full group; `transformations_to_mesh()` sweeps one fundamental triangle through it; `build_mirror_mesh()` makes the cyan mirror-plane discs.
- `models.ts` — per-model parameters (`MODEL_SPECS`), the picker's name list, and `generate_model()`. Reflection groups are enumerated once and cached per family. `generate_model_from_spec()` / `generate_edges_from_spec()` take the parameters directly, so a spec edited at runtime generates as well as a registered one.

- `hyperbolic.ts`, `euclidean.ts` — the same kaleidoscope where the triangle
  does not fit on a sphere. See "The two plane kernels" below.
- `wythoff.ts` — the other way to build a solid: a single seed point inside the fundamental triangle, whose orbit under the group is the vertex set. A corner gives a Platonic solid, an edge a truncation, the interior the omnitruncated one, so one draggable point covers the whole uniform family. Fanning each face from its centre and splitting where it crosses a mirror leaves six triangles per fundamental domain, so it is the same sweep the classic path uses with six triangles instead of one; three base segments likewise sweep to every edge. A `seed` on the spec selects this path.

`classify_triple()` in `geometry.ts` decides, from the sign of the Coxeter Gram
determinant, which geometry a triple's triangle lives in, and so which kernel can
build it: `> 0` spherical, `= 0` Euclidean, `< 0` hyperbolic. This is the exact,
total test. The `acos` in `place_mirrors()` is **not** a geometry test — it
returns NaN for some non-spherical triples but finite nonsense for others, and
(5,4,3), (4,4,4) and (7,7,7) all used to sail through it and run the closure away
to nothing ((4,4,4) reached 6718 matrices in 682 ms and never stopped, taking the
tab with it). `place_mirrors()` now refuses anything non-spherical outright, and
the closure has a 1000-element ceiling behind that.

This also settles why `(3,3,3)` used to close at 24 despite being Euclidean,
which two earlier passes flagged as unexplained. `place_mirrors()` separates its
normals by `pi/n`, whereas the Coxeter condition is that they are separated by
`pi - pi/n` (`dot = -cos(pi/n)`). A reflection ignores the sign of its normal, so
flipping `n_i` flips the two Gram entries touching `i` and leaves the **product**
of the three off-diagonals invariant — the two conventions describe the same
kaleidoscope exactly when that product agrees, i.e. when at least one of x, y, z
is 2 and a factor is zero. Every spherical triple has an entry of 2 (all three
`>= 3` forces `1/x + 1/y + 1/z <= 1`), so `place_mirrors()` is right for exactly
the triples it now accepts. `(3,3,3)` is the case where they part: the `+cos`
reading of it is a genuinely *spherical* configuration, so the closure found a
real group of order 24 — just not the one the triple names. `euclidean.ts` now
draws it properly.

Any spherical triple works, not just the three with names: `ModelSpec.angles`
overrides the family's own triple and `get_group()` caches by triple. The three
named families remain the ones worth naming.

The picker chooses a **symmetry group** — `SYMMETRY_FAMILIES`, labelled by `family_label()` as e.g. "Icosahedral (5,3,2)" — not a named mesh. Changing it swaps the group under whatever the shape controls currently say, so a stellation or a seed position carries from one symmetry to the next. `MODEL_SPECS` stays as the preset registry behind `generate_model(name)` (it holds the parameters recovered from the retired JSON) but its names are history, not a menu; the opening view is the `stellated_dodecahedron` preset.

The controls panel's **Shape** section rides on that: stellation, size, mirror size, dual and rhombic all vary the fundamental triangle only, never the group, so a drag regenerates the whole solid in ~0.2 ms and the sliders are live. `stellation` is the continuous form of `stellated` (1 = the plain solid, 2 = what `stellated: true` gives) and overrides it; `round: false` skips the rounding that only exists to match the retired JSON. Faces are flat across a reflected edge only at the special stellation values, so in between every edge is a real crease and the wireframe is correctly denser. The drawing survives a morph untouched — every fundamental triangle carries the same UVs whatever the geometry does.

The **Seed point** checkbox swaps the stellation/dual/rhombic knobs for the seed pad, which draws the fundamental triangle flat with its corners labelled by rotation order. Seed mode maps UVs through barycentric coordinates on that triangle rather than giving every facet the same UV triangle, so a drawing lands on the part of the texture each piece's place in the domain calls for. At a corner this reproduces the classic generator exactly, geometry and texture both. Buffer layouts do not depend on where the seed sits — degenerate seeds just collapse triangles to zero area — so the in-place upload holds and the pad drags at ~0.18 ms a step.

### The two plane kernels

`src/ts/symmetry/hyperbolic.ts` runs the same construction in Minkowski space
`R^{2,1}` with `<u,v> = u0 v0 + u1 v1 - u2 v2`, the hyperbolic plane being the
upper sheet of `<v,v> = -1`. Mirrors are spacelike unit normals (`<p,p> = +1`)
and reflection is the same Householder formula read against the new form,
`I - 2 p p^T J`. Most of the file is `geometry.ts` with `dot` replaced by `mdot`.
Three things genuinely differ:

1. **The group is infinite**, so there is no closure. `enumerate_tiling()` is a
   BFS over words in the three reflections, cut off at a Poincare disc radius.
   Cells are keyed on the image of the fundamental centroid, not on the matrix —
   the group acts simply transitively on cells, so three numbers identify an
   element as well as nine, and a hash beats the `O(n^2)` Frobenius scan at these
   counts. For (7,3,2): 700 cells at cutoff 0.90, 4102 at 0.98, 16674 at 0.995.
2. **The viewer moves by isometry, not rotation.** `pan_view()` composes a
   translation and then folds the result back into the fundamental triangle. The
   fold is a group element applied on the right, so the picture is unchanged —
   what it buys is that the identity cell is always the one under the viewer (so
   the BFS can start there) and that the view matrix stays bounded. Folding every
   step is load-bearing, not tidiness: an unfolded view accumulates the whole
   distance walked, and a boost of distance `d` has entries of order `cosh d`, so
   twenty steps across half the disc is already 2.4e9 and the matrix has no
   accuracy left. Folded, 2000 pans leave the view exact to 2e-16 with entries
   bounded at 1.1.
3. **Geodesics are straight only in the projective (Klein) model**, and both
   models here are conformal, so a flat triangle visibly cuts the corner off its
   own edges — up to 4.7px on a 1000px disc for (7,3,2). Each cell is subdivided
   at a level chosen from its own measured edge curvature: ~10k triangles at a
   1px tolerance against 65k if every cell were subdivided to the worst case.
   Interpolation is a positive combination of hyperboloid points pulled back onto
   the sheet, which is the Klein straight line and so the real geodesic.

Both projections are conformal: `to_disc()` is the Poincare disc, `to_halfplane()`
the Poincare upper half-plane via the Cayley transform of the disc point. They are
the same tiling seen two ways, so the cutoff is always applied in the disc and the
view isometry carries across a projection change untouched.

Vertices come out already projected into the plane, so hyperbolic mode reuses
every existing pass unchanged — including the drawing — by swapping the
perspective camera for `orthographic_uniforms()`. Nothing downstream of
`view_uniforms()` in `app.ts` knows which geometry it is drawing.

A blank tiling shaded flat is a plain white disc, so reflected cells are dimmed
apart from direct ones (`checker_normals()`). This needs no new shader: the
existing one shades by how far a normal is turned from the lamp, so tilting the
reflected cells' normals off it dims them by a fixed amount. Mirror images are
exactly the orientation-reversing elements, so a determinant settles which is
which — but of the **placement**, `view * cell`, not of `cell` on its own.

Reading `det(cell)` is the obvious thing and it is wrong, which cost a session
to find. `fold_view()` keeps the view canonical by reflecting the viewer back
into the fundamental triangle, so panning across a mirror multiplies the view by
a reflection and flips `det(view)`; meanwhile the enumerated cells are always
the same BFS out from the identity, so `det(cell)` does not move with it. The
two labels detach and **the entire checkerboard inverts in one frame** at every
mirror crossing — which while panning is constantly, and reads as the
fundamental set shifting. Measured on the shipped mesh, 25-41% of cells followed
across a pan step changed shade. `det(view * cell)` is the placement's own
determinant and is invariant under which representative the fold picked, since
`det(view * g * g^-1 * cell) = det(view * cell)`; it measures 0 flips. As
`det(view)` is fixed for the frame, both kernels hoist one `view_reversed`
boolean out of the cell loop rather than multiplying matrices per cell, so the
fix is free.

The fold is not what needs changing — `det(view)` changing sign is correct
behaviour for a canonical fold, and the enumeration and keying are right too.
Only the shading rule read the wrong matrix. Note that the test for this must
follow a cell through a pan in a frame that does not move (undo the accumulated
raw pan); comparing frames in screen coordinates just sees the pan.

Mirror lines are the dominant cost — a tiling's mirrors outnumber its faces
several times over, where a solid's are a fixed 15 — so they are only built when
shown. A pan regenerates the whole tiling and measures 2.7 ms/step at cutoff 0.90
and 10.9 ms at 0.98, mirrors off; 9.3 ms at 0.95 with mirrors on.

#### Euclidean

`src/ts/symmetry/euclidean.ts` is the third kernel, for the triples with
`1/x + 1/y + 1/z` exactly 1. There are only three — (3,3,3), (4,4,2) and
(6,3,2), the wallpaper groups p3m1, p4m and p6m — and they sit between the two
either side: the group is infinite, as in `hyperbolic.ts`, but the plane is
flat, as in `geometry.ts`.

It is a third file rather than a case in one of the others because **its
mirrors do not share a point**. On the sphere all three planes pass through the
origin of R^3 and reflection is linear; in the hyperbolic plane all three pass
through the origin of R^{2,1} and reflection is linear there too. Here the three
mirror *lines* bound a triangle, so two of them are offset and reflection is
affine. Writing points as `(x, y, 1)` puts those affine maps back into 3x3
matrices, after which the enumeration, the view folding and the sweep are the
same shape as the hyperbolic ones — and both the projection and the subdivision
disappear, since the plane is already the plane and its geodesics are already
straight. A pan costs 0.37 ms.

A Euclidean triangle is fixed by its angles only up to scale, unlike the
spherical and hyperbolic ones where the angles fix the size too. That spare
degree of freedom is the one knob this kernel has that the others do not, and it
is what the "Cell size" control is.

The two plane kernels collide on nearly every name — `IDENTITY`, `fold_view`,
`pan_view`, `enumerate_tiling` — because they are deliberate parallels, so
`symmetry/index.ts` exports each under its own namespace rather than making one
rename around the other.

#### A shared hazard worth knowing

Both kernels key cells on a **quantised image of the fundamental centroid**: the
group acts simply transitively on cells, so a few numbers identify an element as
well as a whole matrix does, and a hash beats the `O(n^2)` Frobenius scan at
these counts. The quantum has to be far finer than the gap between neighbouring
cells and far coarser than the arithmetic noise, which it is — but two words for
the same element can still come apart if their centroid images straddle a grid
line, and **exactly zero is a grid line**.

That is not hypothetical: `place_triangle()` centres the triangle on the origin,
so a decimal-string key made `"-0.000000"` and `"0.000000"` two different cells,
the identity came back three times over, and three copies of every cell were
drawn on top of each other. Rounding to integers is the fix — JavaScript
stringifies `-0` as `"0"`, so the two signs of zero cannot come apart. The
hyperbolic kernel had the same latent bug waiting for a centroid image on an
axis, and was fixed with it.

The test that found this is worth keeping in mind: summing triangle areas misses
it (the duplicates just inflate the total, and clipping at the window edge
confounds the measurement far more). Sampling points and checking each is
covered **exactly once** catches gaps and overlaps separately and is immune to
the boundary.

Output matches the JSON it replaced exactly — vertices, normals and UVs are byte-identical for the models that were already generated, and within the generator's own 3-decimal rounding for the four whose parameters were recovered by fitting the shipped meshes (`sellated_*`, `random_colored_st_*`; see `MODEL_SPECS`). The one deliberate difference is the mirror mesh: the original's sign-canonicalisation compared floats against exactly `0`, so near-zero components let a plane and its negation both through, drawing 2 of the icosahedral discs twice (17 blocks for 15 planes, 11 for 9, 7 for 6). The port compares against an epsilon and emits each plane once; pass `legacy_duplicate_planes` to restore the old behaviour.

**`src/ts/webgl_renderer.ts`** — Wraps Three.js. Three rendering passes:
1. `main_material` — 3D model with texture mapping
2. `mirror_material` — Reflection plane geometry (cyan overlay)
3. `overlay_material` — Drawing canvas as a fullscreen quad

**`src/ts/glsl.ts`** — Raw GLSL shader strings. Directional lighting via dot-product normal shading; texture sampling with alpha blending.

**`src/ts/webgl_utils.ts`** — Matrix math helpers (`gl-matrix`) and geometry conversion: `model_to_geometry()` converts a generated model → Three.js `BufferGeometry`, `matrix_uniforms()` computes projection/view/rotation matrices.

### Model Format

Every model is generated at runtime by `src/ts/symmetry/`; `static/models/` is gone and nothing is fetched.
```typescript
{
  vertices: number[],       // XYZ triplets
  normals?: number[],       // surface normals
  texture?: number[],       // UV coordinates
  colors?: number[],        // RGBA vertex colors — never rendered, see below
  mirrors?: number[],       // mirror plane geometry
  mirror_normals?: number[] // mirror plane normals
}
```

`colors` is vestigial: the shipped JSON carried it, `model_to_geometry()` still uploads it as `aVertexColor`, and no shader has ever declared that attribute. That is why the six "coloured" models were interchangeable with their generated equivalents — the colours were inert. Nothing produces `colors` now.

### Dependencies
- `three` — WebGL rendering abstraction
- `gl-matrix` — 3D matrix/vector math

These are the only two runtime dependencies in `package.json`. `src/ts/symmetry/` deliberately uses its own small vec3/mat3 helpers rather than `gl-matrix`, so the port stays a close line-by-line match to the Python it came from.

