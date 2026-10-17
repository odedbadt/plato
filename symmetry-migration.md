# Migrating the symmetry generator into Plato

The polyhedra Plato renders were, until this change, produced out-of-band: a set
of Python/jupytext notebooks in `~/work/weekend/concepts/symmetry/` computed the
meshes with numpy and wrote them to `static/models/*.json`, which the app then
fetched. This change ports that math to TypeScript and moves it inside the app,
so the shapes are built in the browser when a model is selected.

## What the math does

Three mirror planes placed at angles pi/x, pi/y, pi/z generate a finite
reflection group — a kaleidoscope. Taking a single fundamental triangle and
sweeping it through every element of that group tiles a whole solid:

| Angles    | Group        | Order | Models |
|-----------|--------------|-------|--------|
| (5, 3, 2) | icosahedral  | 120   | `dodecahedron_a`, `icosahedron_a`, `stellated_dodecahedron` |
| (4, 3, 2) | octahedral   | 48    | `cube`, `octahedron`, `stellated_octahedron` |
| (3, 3, 2) | tetrahedral  | 24    | `tetra_b`, `spinner` |

The pipeline is four steps:

1. `place_mirrors(x, y, z)` — position the three mirror-plane normals.
2. `perpendicular_to_mirror_matrix(p)` — each normal becomes a Householder
   reflection `I - 2pp^T`.
3. `mirror_matrices_to_group_transformations(...)` — repeatedly multiply the
   current set of transformations by the three mirrors, deduplicating with a
   float tolerance, until the count stops growing. That enumerates the group.
4. `transformations_to_mesh(...)` — build one fundamental triangle from the
   mirror-pair cross products, then push it through every transformation.
   Whether the solid is a dual or a stellation is a matter of permuting which
   cross products become which corner, and how far out the third corner is
   pushed.

`build_mirror_mesh()` separately produces the cyan mirror-plane overlay: each
distinct plane of the group becomes a disc drawn as a fan of 50 triangles.

## Layout

```
src/ts/symmetry/
  linalg.ts     vec3 / row-major mat3 helpers
  geometry.ts   the port: steps 1-4 above, plus the mirror mesh
  models.ts     per-model parameters, the picker's name list, generate_model()
  index.ts      re-exports
```

`models.ts` caches each reflection group after its first enumeration, so the
three families are each built at most once per page load.

The loading seam in `app.ts` is `load_model_by_name()`: generated models are
built on the spot, everything else still goes through `fetch`.

## Faithfulness to the original

The committed JSON was treated as ground truth, not the Python — the two had
drifted (see below). For all eight generated models the port reproduces
`vertices`, `normals` and `texture` **exactly, value for value**, and the mirror
discs are bit-identical. The rendered canvas was also confirmed pixel-identical
to the old file for `stellated_octahedron`.

Three oddities in the original were deliberately preserved, because changing
them would have changed the output:

- **`m0xm1` is reversed.** It is computed as `cross(mirrors[1], mirrors[0])`,
  not `cross(mirrors[0], mirrors[1])` as its name suggests. This sets the
  triangle winding; flipping it inverts every face.
- **`v2` multiplies where `v1` divides.** `v1 = m2xm0 / dot(m2xm0, m1xm2)` but
  `v2 = m0xm1 * dot(m0xm1, m1xm2)`. Only the rhombic variant divides in both.
- **UVs are emitted for `t + 18` triangles, not `t`.** The tail past the draw
  range is never read. Harmless, and kept so output stays comparable.

Two places where the Python no longer matched what shipped, where the JSON won:

- **The UV pattern.** Current `transformations_to_mesh` tiles
  `[0.5,1, 0,1, 0.5,0]`, but every shipped model uses `[0,0, 0,1, 1,0]`. The
  committed JSON predates that edit, and the drawing system expects the shipped
  pattern, so that is what the port emits.
- **`spinner.json` came from a different code path** — `tetra_b` at
  `factor=0.25`, rounded to 2 decimals rather than 3, UVs tiled `t` times with
  no padding, and no mirror geometry at all. It gets its own spec.

## The one deliberate behaviour change: duplicate mirror planes

The original's `distinct_normals` canonicalised each plane normal by flipping it
so its first non-zero component is positive, comparing against exactly `0`.
Components that are zero in exact arithmetic land on +-1e-17 in floating point,
so that test branched inconsistently and let both `n` and `-n` through as two
"distinct" planes. Every family leaked:

| Group        | Real planes | Discs drawn |
|--------------|-------------|-------------|
| icosahedral  | 15          | 17          |
| octahedral   | 9           | 11          |
| tetrahedral  | 6           | 7           |

The duplicates are coincident, so they z-fight and read as extra opacity.

This is the one thing the port does not reproduce bit-for-bit — and cannot:
*which* of the two signs survived is pure numpy rounding noise at the 1e-17
level. So it is fixed instead. `distinct_normals` now snaps near-zero components
to zero and compares against an epsilon, emitting each plane exactly once. The
surviving planes were verified to be the same planes, with identical disc
geometry. Pass `legacy_duplicate_planes` to restore the old behaviour.

## What was not migrated

Six models in the picker are **not** reproducible from the generator and still
load from `static/models/`:

- `dodecahedron`, `icosahedron` — randomly coloured near-copies of the `_a`
  meshes (they differ by ~5e-4).
- `sellated_dodecahedron`, `sellated_octahedron`,
  `random_colored_st_dodec`, `random_colored_st_octa` — randomly coloured, and
  built with stellation factors the driver no longer records (they differ from
  the current stellations by 0.16 to 0.41).

Their random colours and parameters exist only in those files. Rather than drop
six of the twelve entries from the picker, the loader keeps fetching them.

Also not ported, as agreed: the matplotlib plotting helpers (`scatter_3d`,
`line_3d`, `mesh_3d`), the superseded `transformations_to_mesh2`, the GCS upload
path, and `solve_for_dodecahedron.py` (906 lines of exploration that does not
produce any shipped model).

## Effects

- Switching models costs **1.5-3.3 ms**, replacing a network fetch plus a 116 KB
  JSON parse.
- ~585 KB of JSON and `models.txt` removed from the repo. The remaining six
  legacy files are 296 KB.
- The model list now comes from `SELECTABLE_MODEL_NAMES` instead of
  `models.txt`, in the same order, so the picker is unchanged.
- `tetra_b` and `spinner` are generatable but deliberately still absent from the
  picker, matching the old `models.txt`. Adding them is a one-line change.
- Stale localStorage entries for the now-generated models are purged on load,
  so an old cache cannot mask generated output.

## Verifying parity again

The reference JSON files are deleted but remain in git history. To re-check,
restore them and compare field by field against `generate_model(name)`:

```bash
git show <commit-before-this>:static/models/cube.json > /tmp/cube.json
```

Expect exact equality on `vertices`, `normals` and `texture`, and on `mirrors` /
`mirror_normals` once the duplicate plane blocks described above are accounted
for.
