// The hyperbolic sibling of geometry.ts.
//
// A Coxeter triple (x, y, z) describes three mirrors meeting at angles pi/x,
// pi/y, pi/z, and the angle sum decides which geometry the resulting triangle
// lives in: 1/x + 1/y + 1/z greater than 1 is spherical, equal is Euclidean,
// less is hyperbolic. geometry.ts handles the first case, where the group is
// finite and the mirrors are ordinary planes through the origin of R^3.
//
// Here the same construction runs in Minkowski space R^{2,1}, with the form
//
//     <u, v> = u0 v0 + u1 v1 - u2 v2
//
// and the hyperbolic plane realised as the upper sheet of <v, v> = -1. Mirrors
// become spacelike unit normals (<p, p> = +1) and reflection is the same
// Householder formula read against the new form, so almost everything below is
// geometry.ts with `dot` replaced by `mdot`.
//
// Two things genuinely differ, and they are what the rest of this file is
// about:
//
//   1. The group is infinite. There is no closure to run; the tiling is
//      enumerated outward from the fundamental cell and cut off at a chosen
//      radius. To keep that cutoff meaningful while the viewer moves, the view
//      isometry is folded back into the fundamental domain after every pan —
//      it differs by a group element, so the picture is unchanged.
//
//   2. Geodesics are straight only in the projective (Klein) model, and both
//      models asked for here are conformal, so a flat triangle visibly cuts
//      the corner off its own edges — up to 4.7px on a 1000px disc for (7,3,2).
//      Each cell is therefore subdivided, at a level chosen from how curved its
//      own edges come out: ~10k triangles for a 1px tolerance, against 65k if
//      every cell were subdivided to the worst case.

import { Mat3, Vec3, cross, round_to } from './linalg';
import { classify_triple } from './geometry';
import type { GeneratedModel, SweptEdges } from './geometry';

// Which geometry a triple's triangle lives in is decided in geometry.ts: it is
// the question of which of the two kernels can build it at all, so it belongs
// with neither one of them in particular.
export type { TriangleGeometry } from './geometry';
export { gram_determinant, classify_triple, triple_is_valid } from './geometry';

// ---------------------------------------------------------------------------
// Minkowski R^{2,1}
// ---------------------------------------------------------------------------

// The signature, as the diagonal of J = diag(1, 1, -1).
const SIGNATURE: Vec3 = [1, 1, -1];

export function mdot(u: Vec3, v: Vec3): number {
    return u[0] * v[0] + u[1] * v[1] - u[2] * v[2];
}

// Jv. Turns a Minkowski inner product into a Euclidean one — <u, v> = u . Jv —
// which is what lets the Euclidean cross product below find Minkowski normals.
function jdual(v: Vec3): Vec3 {
    return [v[0], v[1], -v[2]];
}

// A timelike vector scaled onto the upper sheet of <v, v> = -1, i.e. an actual
// point of the hyperbolic plane.
export function to_hyperboloid(v: Vec3): Vec3 {
    const q = mdot(v, v);
    const s = 1 / Math.sqrt(q < 0 ? -q : 1);
    const p: Vec3 = [v[0] * s, v[1] * s, v[2] * s];
    return p[2] < 0 ? [-p[0], -p[1], -p[2]] : p;
}

// A spacelike vector scaled to <v, v> = +1, i.e. the normal of a geodesic.
function to_spacelike(v: Vec3): Vec3 {
    const q = mdot(v, v);
    const s = 1 / Math.sqrt(q > 0 ? q : 1);
    return [v[0] * s, v[1] * s, v[2] * s];
}

// The origin of the hyperbolic plane — the point both models put at their
// centre, and the point the viewer stands at.
export const ORIGIN: Vec3 = [0, 0, 1];

// Hyperbolic distance. cosh d = -<a, b> for two points on the hyperboloid.
export function hyperbolic_distance(a: Vec3, b: Vec3): number {
    return Math.acosh(Math.max(1, -mdot(a, b)));
}

function mat_multiply(a: Mat3, b: Mat3): Mat3 {
    const out = new Array<number>(9);
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            out[r * 3 + c] =
                a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
        }
    }
    return out;
}

function mat_apply(m: Mat3, v: Vec3): Vec3 {
    return [
        m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
        m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
        m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
    ];
}

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// A Lorentz matrix preserves <.,.>, i.e. L^T J L = J, so its inverse is J L^T J
// and never needs a general solve.
export function invert_isometry(l: Mat3): Mat3 {
    const out = new Array<number>(9);
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            out[r * 3 + c] = SIGNATURE[r] * l[c * 3 + r] * SIGNATURE[c];
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// The kaleidoscope, in Minkowski space
// ---------------------------------------------------------------------------

// Spacelike unit normals of three mirrors meeting at angles pi/x, pi/y, pi/z,
// realising the Coxeter Gram matrix directly rather than going through a
// spherical-trigonometry solve. Same pair convention as place_mirrors(): pi/x
// between mirrors 0 and 1, pi/y between 0 and 2, pi/z between 1 and 2.
//
// The third normal's timelike component squared is a^2 + b^2 - 1, which is
// non-negative exactly when the triple is hyperbolic — the same test as
// det(Gram) < 0, arrived at from the other side.
export function place_mirrors_minkowski(x: number, y: number, z: number): Vec3[] {
    const g01 = -Math.cos(Math.PI / x);
    const g02 = -Math.cos(Math.PI / y);
    const g12 = -Math.cos(Math.PI / z);
    const s = Math.sqrt(1 - g01 * g01);
    const a = g02;
    const b = (g12 - g01 * a) / s;
    const timelike = a * a + b * b - 1;
    if (!(timelike >= 0)) {
        throw new Error(
            `(${x},${y},${z}) is not a hyperbolic triple: 1/x + 1/y + 1/z >= 1`);
    }
    return [
        [1, 0, 0],
        [g01, s, 0],
        [a, b, Math.sqrt(timelike)]
    ];
}

// Householder reflection against the Minkowski form: v - 2<v, p>p, i.e.
// I - 2 p p^T J for a spacelike unit normal p.
export function minkowski_reflection(p: Vec3): Mat3 {
    const m = new Array<number>(9);
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            m[r * 3 + c] = (r === c ? 1 : 0) - 2 * p[r] * p[c] * SIGNATURE[c];
        }
    }
    return m;
}

// Corner k of the fundamental triangle is where mirrors k+1 and k+2 meet, so
// it is Minkowski-orthogonal to both of their normals. <v, p> = v . Jp turns
// that into an ordinary perpendicularity, which the cross product solves.
export function hyperbolic_corners(mirrors: Vec3[]): Vec3[] {
    return [0, 1, 2].map(k =>
        to_hyperboloid(cross(jdual(mirrors[(k + 1) % 3]), jdual(mirrors[(k + 2) % 3]))));
}

export function triangle_centroid(corners: Vec3[]): Vec3 {
    return to_hyperboloid([
        corners[0][0] + corners[1][0] + corners[2][0],
        corners[0][1] + corners[1][1] + corners[2][1],
        corners[0][2] + corners[1][2] + corners[2][2]
    ]);
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

export type Projection = 'disc' | 'halfplane';

export const PROJECTION_LABELS: Record<Projection, string> = {
    disc: 'Poincare disc',
    halfplane: 'Poincare half-plane'
};

// Poincare disc: the hyperboloid seen from (0, 0, -1). Conformal, the whole
// plane inside the unit circle, geodesics are arcs meeting it at right angles.
export function to_disc(v: Vec3): [number, number] {
    const d = 1 + v[2];
    return [v[0] / d, v[1] / d];
}

// Poincare upper half-plane, via the Cayley transform i(1 + w)/(1 - w) of the
// disc point w. Conformal too — the same picture cut open at w = 1 and
// unrolled, with the disc's boundary circle become the real axis.
export function to_halfplane(v: Vec3): [number, number] {
    const [a, b] = to_disc(v);
    // i(1 + w) / (1 - w)
    const dr = 1 - a, di = -b;
    const nr = -b, ni = 1 + a;
    const d = dr * dr + di * di || 1e-12;
    return [(nr * dr + ni * di) / d, (ni * dr - nr * di) / d];
}

export function project(v: Vec3, projection: Projection): [number, number] {
    return projection === 'disc' ? to_disc(v) : to_halfplane(v);
}

// Inverse of to_disc, for turning a pointer position back into a point of the
// plane. Returns null outside the disc, where there is no such point.
export function from_disc(x: number, y: number): Vec3 | null {
    const r2 = x * x + y * y;
    if (r2 >= 1) return null;
    const s = 1 / (1 - r2);
    return [2 * x * s, 2 * y * s, (1 + r2) * s];
}

export function from_halfplane(x: number, y: number): Vec3 | null {
    if (!(y > 0)) return null;
    // Inverse Cayley: w = (h - i) / (h + i)
    const nr = x, ni = y - 1;
    const dr = x, di = y + 1;
    const d = dr * dr + di * di || 1e-12;
    return from_disc((nr * dr + ni * di) / d, (ni * dr - nr * di) / d);
}

export function unproject(
    x: number, y: number, projection: Projection
): Vec3 | null {
    return projection === 'disc' ? from_disc(x, y) : from_halfplane(x, y);
}

// The visible window of each model, in its own projected coordinates. The disc
// is bounded by construction; the half-plane is not, so it gets a frame chosen
// to put the fundamental cell's neighbourhood on screen.
export type Viewport = { x0: number, x1: number, y0: number, y1: number };

export const VIEWPORTS: Record<Projection, Viewport> = {
    disc: { x0: -1, x1: 1, y0: -1, y1: 1 },
    halfplane: { x0: -1.6, x1: 1.6, y0: 0, y1: 3.2 }
};

// ---------------------------------------------------------------------------
// Isometries: where the viewer stands
// ---------------------------------------------------------------------------

// The boost fixing the plane spanned by a timelike unit `a` and a spacelike
// unit `u` perpendicular to it, by rapidity t — a translation of distance t
// along the geodesic through `a` in direction `u`.
function boost(a: Vec3, u: Vec3, t: number): Mat3 {
    const ch = Math.cosh(t) - 1;
    const sh = Math.sinh(t);
    // <v, a> = v . Ja, and the a-component of v carries a minus sign because
    // <a, a> = -1.
    const ja = jdual(a), ju = jdual(u);
    const m = new Array<number>(9);
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            m[r * 3 + c] = (r === c ? 1 : 0)
                + ch * (a[r] * -ja[c] + u[r] * ju[c])
                + sh * (a[r] * ju[c] + u[r] * -ja[c]);
        }
    }
    return m;
}

// The translation along the geodesic from a to b that carries a onto b.
export function translation_between(a: Vec3, b: Vec3): Mat3 {
    const cosh_t = Math.max(1, -mdot(a, b));
    const t = Math.acosh(cosh_t);
    if (t < 1e-12) return IDENTITY.slice();
    // The component of b perpendicular to a, which comes out with Minkowski
    // length sinh t and so points along the geodesic joining them.
    const lambda = mdot(b, a);
    const perp: Vec3 = [
        b[0] + lambda * a[0], b[1] + lambda * a[1], b[2] + lambda * a[2]
    ];
    return boost(a, to_spacelike(perp), t);
}

// Which side of each mirror the fundamental triangle is on. Used to recognise
// when a point has wandered out of it.
function domain_signs(mirrors: Vec3[], centroid: Vec3): number[] {
    return mirrors.map(p => (mdot(centroid, p) >= 0 ? 1 : -1));
}

// Gram-Schmidt against the Minkowski form, which pulls a matrix that has
// drifted off the Lorentz group back onto it. Composing isometries is exact
// enough on its own; this exists so a view that has been panned thousands of
// times is still exactly an isometry at the end of it.
export function renormalize_isometry(m: Mat3): Mat3 {
    const col = (c: number): Vec3 => [m[c], m[3 + c], m[6 + c]];
    const axpy = (v: Vec3, a: Vec3, k: number): Vec3 =>
        [v[0] + k * a[0], v[1] + k * a[1], v[2] + k * a[2]];
    // The timelike column first — it is where the viewer stands, and the other
    // two are only a frame around it.
    const c2 = to_hyperboloid(col(2));
    const c0 = to_spacelike(axpy(col(0), c2, mdot(col(0), c2)));
    const c1 = to_spacelike(
        axpy(axpy(col(1), c2, mdot(col(1), c2)), c0, -mdot(col(1), c0)));
    return [
        c0[0], c1[0], c2[0],
        c0[1], c1[1], c2[1],
        c0[2], c1[2], c2[2]
    ];
}

const FOLD_EPSILON = 1e-9;
const FOLD_LIMIT = 400;

// Rewrites the view isometry so the point it puts at the centre of the screen
// lies in the fundamental triangle, by reflecting it back in across whichever
// mirror it is outside of until none is left.
//
// The correction is a group element applied on the right, and the tiling is
// invariant under the group, so this changes nothing about the picture. What
// it buys is that the identity cell is always the one under the viewer, which
// is what lets the enumeration below start there and cut off by radius.
export function fold_view(view: Mat3, mirrors: Vec3[], centroid: Vec3): Mat3 {
    const reflections = mirrors.map(minkowski_reflection);
    const signs = domain_signs(mirrors, centroid);
    let folded = renormalize_isometry(view);
    // Where the viewer stands, in the tiling's own coordinates.
    let q = mat_apply(invert_isometry(folded), ORIGIN);
    let settled = false;
    for (let step = 0; step < FOLD_LIMIT; step++) {
        let outside = -1;
        for (let k = 0; k < 3; k++) {
            if (signs[k] * mdot(q, mirrors[k]) < -FOLD_EPSILON) { outside = k; break; }
        }
        if (outside < 0) { settled = true; break; }
        q = mat_apply(reflections[outside], q);
        folded = mat_multiply(folded, reflections[outside]);
    }
    // Not settling means the input was not usably an isometry to begin with —
    // the walk needs one reflection per cell crossed, so a view that is merely
    // far away still settles, while one that has lost its accuracy wanders.
    // Folding makes such a matrix worse rather than better, since it keeps
    // multiplying it: a view 20 unfolded pans out of date has entries of 1.8e6
    // and a Lorentz error of 5e-4 going in, and 3e+49 coming out. Going back
    // to the origin loses the viewer's place, which is a great deal better
    // than drawing nonsense. Nothing reaches this by panning — pan_view()
    // folds every step, which holds the error at 4e-16 indefinitely.
    if (!settled) return IDENTITY.slice();
    return renormalize_isometry(folded);
}

// The three mirrors of a triple and the triangle they bound. Cheap to build,
// but every pan wants it, so it is kept rather than recomputed.
export type HyperbolicGroup = {
    x: number, y: number, z: number,
    mirrors: Vec3[], corners: Vec3[], centroid: Vec3
};

const group_cache = new Map<string, HyperbolicGroup>();

export function hyperbolic_group(x: number, y: number, z: number): HyperbolicGroup {
    const key = `${x},${y},${z}`;
    const cached = group_cache.get(key);
    if (cached) return cached;
    const mirrors = place_mirrors_minkowski(x, y, z);
    const corners = hyperbolic_corners(mirrors);
    const group = { x, y, z, mirrors, corners, centroid: triangle_centroid(corners) };
    group_cache.set(key, group);
    return group;
}

// Moves the view so that the point currently drawn at `from` is drawn at `to`,
// and folds the result straight away.
//
// Folding every step is what keeps panning stable rather than merely tidy. An
// unfolded view accumulates the whole distance walked, and a boost of distance
// d has entries of order cosh d — twenty steps across half the disc is already
// 2.4e9, at which point the matrix has no accuracy left. Folded, the viewer
// never leaves the fundamental triangle and the entries stay of order 1, so a
// walk of any length is as exact as its first step.
export function pan_view(
    view: Mat3, from: Vec3, to: Vec3, group: HyperbolicGroup
): Mat3 {
    const moved = mat_multiply(translation_between(from, to), view);
    return fold_view(moved, group.mirrors, group.centroid);
}

// ---------------------------------------------------------------------------
// Enumerating the tiling
// ---------------------------------------------------------------------------

export type Tiling = {
    mirrors: Vec3[],
    corners: Vec3[],
    centroid: Vec3,
    // One matrix per cell, each carrying the fundamental triangle to its copy.
    cells: Mat3[],
    // The view isometry actually used, folded into the fundamental domain.
    view: Mat3,
    truncated: boolean
};

// See the note in euclidean.ts: integers rather than decimal strings, so that
// a coordinate sitting at exactly zero cannot come apart into "-0.00000" and
// "0.00000" and split one cell into two. Centroid images on an axis of the
// tiling are the case that would reach it here.
const CELL_KEY_QUANTUM = 1e5;

// Breadth-first over words in the three reflections, keeping any cell whose
// image falls inside the cutoff disc.
//
// The group is infinite, so this replaces the closure in geometry.ts outright
// rather than adapting it. Two details matter. Cells are keyed on the image of
// the fundamental centroid rather than on the matrix: the group acts simply
// transitively on cells, so three numbers identify an element as well as nine
// do, and a hash beats the O(n^2) Frobenius scan that would not survive the
// cell counts here. And the cutoff is applied in the disc whichever model is
// being drawn, because the region it describes is a hyperbolic disc either
// way — one tiling, seen two ways.
export function enumerate_tiling(
    mirrors: Vec3[], cutoff: number, view: Mat3, max_cells: number
): Tiling {
    const corners = hyperbolic_corners(mirrors);
    const centroid = triangle_centroid(corners);
    const folded = fold_view(view, mirrors, centroid);
    const reflections = mirrors.map(minkowski_reflection);

    const limit = cutoff * cutoff;
    const inside = (v: Vec3): boolean => {
        const [a, b] = to_disc(mat_apply(folded, v));
        return a * a + b * b < limit;
    };
    const key = (v: Vec3): string =>
        `${Math.round(v[0] * CELL_KEY_QUANTUM)},${Math.round(v[1] * CELL_KEY_QUANTUM)},` +
        `${Math.round(v[2] * CELL_KEY_QUANTUM)}`;

    const cells: Mat3[] = [IDENTITY.slice()];
    const seen = new Set<string>([key(centroid)]);
    let frontier: Mat3[] = cells.slice();
    let truncated = false;

    while (frontier.length > 0 && cells.length < max_cells) {
        const next: Mat3[] = [];
        for (const cell of frontier) {
            for (const reflection of reflections) {
                const candidate = mat_multiply(reflection, cell);
                const image = mat_apply(candidate, centroid);
                if (!inside(image)) continue;
                const k = key(image);
                if (seen.has(k)) continue;
                seen.add(k);
                cells.push(candidate);
                next.push(candidate);
                if (cells.length >= max_cells) { truncated = true; break; }
            }
            if (truncated) break;
        }
        if (truncated) break;
        frontier = next;
    }

    return { mirrors, corners, centroid, cells, view: folded, truncated };
}

// ---------------------------------------------------------------------------
// Meshing
// ---------------------------------------------------------------------------

export type HyperbolicSpec = {
    x: number, y: number, z: number,
    projection?: Projection,
    // How far out the tiling is generated, as a Poincare disc radius. The cell
    // count climbs steeply as this approaches 1: for (7,3,2), 700 cells at
    // 0.90, 4102 at 0.98, 16674 at 0.995.
    cutoff?: number,
    // Where the viewer stands, as an isometry of the plane. Panning composes
    // a translation onto this; see translation_between().
    view?: Mat3,
    // Largest chord-to-geodesic error a cell is allowed, in projected units.
    // The viewport is 2 units across, so 0.002 is about 1px on a 1000px canvas.
    tolerance?: number,
    // The rect that is really on screen, which the canvas's shape decides.
    // Defaults to VIEWPORTS[projection]; passing the fitted one keeps the
    // off-screen cull honest on a window that is not the assumed shape.
    viewport?: Viewport,
    max_level?: number,
    max_cells?: number,
    include_mirrors?: boolean,
    // Shade reflected cells apart from direct ones, so a blank tiling still
    // reads as a tiling. See checker_normals().
    checker?: boolean,
    // Half-width of the mirror lines, in projected units.
    mirror_width?: number,
    // Barycentric weights of a Wythoff seed. Present means the vertex set is
    // the seed's orbit rather than the triangle corners, exactly as in
    // wythoff.ts — a corner gives the regular tiling, an edge a truncation.
    seed?: Vec3
};

const DEFAULTS = {
    projection: 'disc' as Projection,
    cutoff: 0.98,
    tolerance: 0.002,
    max_level: 6,
    max_cells: 20000,
    include_mirrors: true,
    checker: true,
    mirror_width: 0.004
};

// The light direction baked into VS_SOURCE. A flat tiling has no shape for
// directional light to find, so its normals point straight at the lamp and
// every cell comes out at full brightness.
const FLAT_NORMAL: Vec3 = [-0.68041382, 0.27216553, -0.68041382];

// ...except that a blank tiling drawn that way is a plain white disc, which
// says nothing about the tiling it is. Alternate cells are mirror images of
// one another — that is what a kaleidoscope is — so shading the two classes
// apart makes the cells legible before anything has been drawn on them, and
// is the alternation Escher colours his Circle Limits by.
//
// It needs no new shader and no new attribute. VS_SOURCE already shades by
// how far a normal is turned from the lamp, so tilting the reflected cells'
// normals off it by a fixed amount dims them by a fixed amount. The cost is
// that ink laid on a reflected cell is dimmed with it, exactly as ink on the
// shaded side of a solid is.
const CHECKER_TILT = 0.43;   // cos of the tilt: about 12% dimmer than full on

function to_unit(v: Vec3): Vec3 {
    const n = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / n, v[1] / n, v[2] / n];
}

// Which way a cell faces: straight at the lamp for a direct copy, tilted off
// it for a reflected one.
function checker_normals(tilt: number): [Vec3, Vec3] {
    const l = to_unit(FLAT_NORMAL);
    // Any direction perpendicular to the lamp; which one makes no difference,
    // since only the angle to the lamp is ever read.
    const perp = to_unit(cross(l, [0, 0, 1]));
    const k = Math.sqrt(Math.max(1 - tilt * tilt, 0));
    return [l, [
        tilt * l[0] + k * perp[0],
        tilt * l[1] + k * perp[1],
        tilt * l[2] + k * perp[2]
    ]];
}

// Mirror images are precisely the orientation-reversing elements of the group,
// so a determinant settles which class a placement is in with no bookkeeping to
// carry through the enumeration. The placement is `view * cell`, though, not the
// cell on its own — see build_hyperbolic().
function determinant(m: Mat3): number {
    return m[0] * (m[4] * m[8] - m[5] * m[7])
        - m[1] * (m[3] * m[8] - m[5] * m[6])
        + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

// Geodesic interpolation. A positive combination of hyperboloid points pulled
// back onto the sheet is the projective — Klein — straight line between them,
// and Klein straight lines are exactly the geodesics. So this traces the real
// edge, however curved the conformal models draw it.
function along(a: Vec3, b: Vec3, c: Vec3, w0: number, w1: number, w2: number): Vec3 {
    return to_hyperboloid([
        w0 * a[0] + w1 * b[0] + w2 * c[0],
        w0 * a[1] + w1 * b[1] + w2 * c[1],
        w0 * a[2] + w1 * b[2] + w2 * c[2]
    ]);
}

// How far the midpoint of a projected edge sits from the midpoint of its
// chord. Measured at the midpoint alone because that is where a circular arc's
// deviation peaks, and the whole point of this pass is that it runs per cell.
function sagitta(
    a: Vec3, b: Vec3, view: Mat3, projection: Projection
): number {
    const pa = project(mat_apply(view, a), projection);
    const pb = project(mat_apply(view, b), projection);
    const mid = project(mat_apply(view, along(a, b, a, 0.5, 0.5, 0)), projection);
    return Math.hypot(mid[0] - (pa[0] + pb[0]) / 2, mid[1] - (pa[1] + pb[1]) / 2);
}

// Subdivision level for one cell: the error of a chord falls as 1/n^2, so the
// level needed to reach the tolerance is the square root of how far over it we
// currently are.
function subdivision_level(
    image: Vec3[], view: Mat3, projection: Projection,
    tolerance: number, max_level: number
): number {
    let worst = 0;
    for (let k = 0; k < 3; k++) {
        worst = Math.max(worst, sagitta(image[k], image[(k + 1) % 3], view, projection));
    }
    const level = Math.ceil(Math.sqrt(worst / tolerance));
    return Math.min(Math.max(level, 1), max_level);
}

function bbox_outside(points: [number, number][], view: Viewport, margin: number): boolean {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of points) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return x1 < view.x0 - margin || x0 > view.x1 + margin
        || y1 < view.y0 - margin || y0 > view.y1 + margin;
}

export type HyperbolicResult = {
    model: GeneratedModel,
    edges: SweptEdges,
    tiling: Tiling,
    cells: number,
    triangles: number
};

// One piece of the fundamental cell, with the UVs its corners carry. Classic
// mode has a single piece — the fundamental triangle itself — and seed mode
// has the six that the Wythoff construction cuts it into.
type BaseTriangle = {
    points: [Vec3, Vec3, Vec3],
    uvs: [[number, number], [number, number], [number, number]]
};

// Matches the UV corners transformations_to_mesh() gives its one triangle:
// corner 0 -> (0,0), corner 1 -> (0,1), corner 2 -> (1,0). Carrying that
// through the barycentric weights is what keeps one drawing tiling the whole
// plane, and is the same mapping wythoff.ts uses.
function corner_uv(w: Vec3): [number, number] {
    return [w[2], w[1]];
}

// Barycentric weights of a point on the fundamental triangle. Mirror k is
// perpendicular to the two corners lying in it, so a point's weight on corner
// k is just how far it stands off mirror k — the same identity wythoff.ts
// uses, read against the Minkowski form.
function barycentric_of(mirrors: Vec3[], corners: Vec3[], p: Vec3): Vec3 {
    const raw = [0, 1, 2].map(k =>
        mdot(p, mirrors[k]) / mdot(corners[k], mirrors[k])) as Vec3;
    const sum = raw[0] + raw[1] + raw[2] || 1;
    return [raw[0] / sum, raw[1] / sum, raw[2] / sum];
}

function classic_base(corners: Vec3[]): BaseTriangle[] {
    return [{
        points: [corners[0], corners[1], corners[2]],
        uvs: [[0, 0], [0, 1], [1, 0]]
    }];
}

// The Wythoff construction: the vertex set is the orbit of a single seed point
// rather than the triangle's corners, which sweeps out the whole uniform
// family as the seed moves — a corner gives the regular tiling, an edge a
// truncation, the interior the omnitruncated one.
//
// The decomposition is the one wythoff.ts uses, and it reads more simply here.
// On the sphere the face around corner k is a ring about a rotation *axis*,
// and its centre has to be found by intersecting a plane with that axis; in
// the hyperbolic plane the rotation centre is the corner itself, so the face
// centre is corner k and nothing needs solving. Fanning each face from its
// centre and splitting where it crosses a mirror leaves six triangles
//
//     (corner k, seed, foot of the seed on a mirror through corner k)
//
// per cell, each wholly inside one fundamental domain. The three segments
// joining the seed to its mirror images sweep to every edge and nothing else;
// a seed sitting on a mirror collapses that one to a point, which is exactly
// the edge vanishing as the truncation closes up.
function wythoff_base(
    mirrors: Vec3[], corners: Vec3[], seed: Vec3
): { triangles: BaseTriangle[], edges: [Vec3, Vec3][] } {
    const sum = seed[0] + seed[1] + seed[2] || 1;
    const w: Vec3 = [seed[0] / sum, seed[1] / sum, seed[2] / sum];
    const point = to_hyperboloid([
        w[0] * corners[0][0] + w[1] * corners[1][0] + w[2] * corners[2][0],
        w[0] * corners[0][1] + w[1] * corners[1][1] + w[2] * corners[2][1],
        w[0] * corners[0][2] + w[1] * corners[1][2] + w[2] * corners[2][2]
    ]);
    const reflections = mirrors.map(minkowski_reflection);
    const uv_of = (p: Vec3) => corner_uv(barycentric_of(mirrors, corners, p));

    const triangles: BaseTriangle[] = [];
    for (let k = 0; k < 3; k++) {
        // Corner k is fixed by the two mirrors meeting there, and those are
        // the ones the face around it folds across.
        for (const m of [(k + 1) % 3, (k + 2) % 3]) {
            const image = mat_apply(reflections[m], point);
            // Halfway to the reflected seed is the foot of the perpendicular
            // from the seed onto mirror m.
            const foot = to_hyperboloid([
                point[0] + image[0], point[1] + image[1], point[2] + image[2]
            ]);
            const points: [Vec3, Vec3, Vec3] = [corners[k], point, foot];
            triangles.push({
                points,
                uvs: [uv_of(points[0]), uv_of(points[1]), uv_of(points[2])]
            });
        }
    }

    const edges = reflections.map((r): [Vec3, Vec3] => [point, mat_apply(r, point)]);
    return { triangles, edges };
}

// Two hyperboloid points closer than this count as the same point, which is
// how a seed sitting on a corner or a mirror retires the pieces it collapses.
const DEGENERATE = 1e-7;

function degenerate(points: Vec3[]): boolean {
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            if (hyperbolic_distance(points[i], points[j]) < DEGENERATE) return true;
        }
    }
    return false;
}

// Builds the whole picture — tiling, mesh, edges and mirror lines — in one
// pass, because every part of it wants the same enumeration and the same
// per-cell subdivision level.
export function build_hyperbolic(spec: HyperbolicSpec): HyperbolicResult {
    const projection = spec.projection ?? DEFAULTS.projection;
    const cutoff = Math.min(Math.max(spec.cutoff ?? DEFAULTS.cutoff, 0.1), 0.999);
    const tolerance = spec.tolerance ?? DEFAULTS.tolerance;
    const max_level = spec.max_level ?? DEFAULTS.max_level;
    const max_cells = spec.max_cells ?? DEFAULTS.max_cells;
    const include_mirrors = spec.include_mirrors ?? DEFAULTS.include_mirrors;
    const mirror_width = spec.mirror_width ?? DEFAULTS.mirror_width;
    const checker = spec.checker ?? DEFAULTS.checker;
    const [direct_normal, mirrored_normal] = checker_normals(CHECKER_TILT);

    const mirrors = place_mirrors_minkowski(spec.x, spec.y, spec.z);
    const tiling = enumerate_tiling(
        mirrors, cutoff, spec.view ?? IDENTITY.slice(), max_cells);
    const { corners, cells, view } = tiling;

    // The checker has to track the handedness a cell is actually DRAWN with,
    // which is that of `view * cell` and not of `cell` alone. fold_view() keeps
    // the view canonical by reflecting the viewer back into the fundamental
    // triangle, so crossing a mirror while panning multiplies the view by a
    // reflection and flips det(view) — while the enumerated cells are always
    // the same BFS out from the identity, so det(cell) does not move with it.
    // Shading on det(cell) alone therefore inverted the whole checkerboard at
    // every mirror crossing. det(view) is fixed for the frame, so the one sign
    // hoists out of the loop instead of multiplying matrices per cell.
    const view_reversed = determinant(view) < 0;

    const viewport = spec.viewport ?? VIEWPORTS[projection];
    const at = (v: Vec3): [number, number] => project(mat_apply(view, v), projection);

    const wythoff = spec.seed ? wythoff_base(mirrors, corners, spec.seed) : null;
    const base = (wythoff ? wythoff.triangles : classic_base(corners))
        .filter(t => !degenerate(t.points));
    // Classic mode draws the cell's own three sides; a seed instead draws the
    // segments from it to its mirror images, which are the tiling's real edges.
    const base_edges: [Vec3, Vec3][] = wythoff
        ? wythoff.edges.filter(e => !degenerate(e))
        : [[corners[0], corners[1]], [corners[1], corners[2]], [corners[2], corners[0]]];

    const vertices: number[] = [];
    const normals: number[] = [];
    const texture: number[] = [];
    const starts: number[] = [];
    const ends: number[] = [];
    const seen_edges = new Set<string>();
    let triangles = 0;

    const edge_key = (a: [number, number], b: [number, number]): string => {
        const ka = `${round_to(a[0], 5)},${round_to(a[1], 5)}`;
        const kb = `${round_to(b[0], 5)},${round_to(b[1], 5)}`;
        return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    };

    for (const cell of cells) {
        // Culling and the subdivision level are both decided on the cell's own
        // fundamental triangle: every base piece sits inside it, so neither
        // answer can come out too generous for the pieces.
        const frame = corners.map(v => mat_apply(cell, v));
        const outline = frame.map(at) as [number, number][];
        // Cells off screen cost nothing to skip and would otherwise dominate
        // the half-plane, where most of the disc lands outside the frame.
        if (bbox_outside(outline, viewport, 0.1)) continue;

        const level = subdivision_level(frame, view, projection, tolerance, max_level);
        const normal = (checker && ((determinant(cell) < 0) !== view_reversed))
            ? mirrored_normal : direct_normal;

        for (const piece of base) {
            const image = piece.points.map(v => mat_apply(cell, v)) as [Vec3, Vec3, Vec3];
            // Barycentric grid over the piece, every node pulled onto the
            // hyperboloid so the mesh follows the real geodesics.
            const nodes: { p: [number, number], uv: [number, number] }[] = [];
            const index = (i: number, j: number) => i * (level + 1) + j;
            for (let i = 0; i <= level; i++) {
                for (let j = 0; j <= level - i; j++) {
                    const w1 = i / level, w2 = j / level, w0 = 1 - w1 - w2;
                    nodes[index(i, j)] = {
                        p: at(along(image[0], image[1], image[2], w0, w1, w2)),
                        uv: [
                            w0 * piece.uvs[0][0] + w1 * piece.uvs[1][0] + w2 * piece.uvs[2][0],
                            w0 * piece.uvs[0][1] + w1 * piece.uvs[1][1] + w2 * piece.uvs[2][1]
                        ]
                    };
                }
            }
            const emit = (a: number, b: number, c: number) => {
                for (const n of [nodes[a], nodes[b], nodes[c]]) {
                    vertices.push(n.p[0], n.p[1], 0);
                    normals.push(normal[0], normal[1], normal[2]);
                    texture.push(n.uv[0], n.uv[1]);
                }
                triangles++;
            };
            for (let i = 0; i < level; i++) {
                for (let j = 0; j < level - i; j++) {
                    emit(index(i, j), index(i + 1, j), index(i, j + 1));
                    if (i + j < level - 1) {
                        emit(index(i + 1, j), index(i + 1, j + 1), index(i, j + 1));
                    }
                }
            }
        }

        // Edges, subdivided to the same level so the wireframe follows the
        // geodesic the faces do. An edge shared by two cells is drawn once.
        for (const [a0, b0] of base_edges) {
            const a = mat_apply(cell, a0), b = mat_apply(cell, b0);
            let previous = at(a);
            for (let s = 1; s <= level; s++) {
                const t = s / level;
                const point = at(along(a, b, a, 1 - t, t, 0));
                const key = edge_key(previous, point);
                if (!seen_edges.has(key)) {
                    seen_edges.add(key);
                    starts.push(previous[0], previous[1], 0);
                    ends.push(point[0], point[1], 0);
                }
                previous = point;
            }
        }
    }

    const model: GeneratedModel = { vertices, normals, texture };

    if (include_mirrors) {
        const { mesh, normals: mesh_normals } = build_mirror_lines(
            tiling, projection, cutoff, mirror_width, viewport);
        model.mirrors = mesh;
        model.mirror_normals = mesh_normals;
    }

    return { model, edges: { starts, ends }, tiling, cells: cells.length, triangles };
}

// ---------------------------------------------------------------------------
// Mirror lines
// ---------------------------------------------------------------------------

// Every mirror of the group, as the orbit of the three generators, deduped by
// normal up to sign — the hyperbolic reading of distinct_normals().
export function distinct_mirrors(tiling: Tiling): Vec3[] {
    const seen = new Map<string, Vec3>();
    for (const cell of tiling.cells) {
        for (const mirror of tiling.mirrors) {
            const n = to_spacelike(mat_apply(cell, mirror));
            const snapped: Vec3 = [
                Math.abs(n[0]) < 1e-9 ? 0 : n[0],
                Math.abs(n[1]) < 1e-9 ? 0 : n[1],
                Math.abs(n[2]) < 1e-9 ? 0 : n[2]
            ];
            const leading = snapped.find(c => c !== 0) ?? 0;
            const directed: Vec3 = leading < 0
                ? [-snapped[0], -snapped[1], -snapped[2]] : snapped;
            const key = [0, 1, 2].map(i => round_to(directed[i], 6)).join(',');
            if (!seen.has(key)) seen.set(key, directed);
        }
    }
    return Array.from(seen.values());
}

// The geodesic a mirror normal describes, as a polyline on the hyperboloid.
// Points of the geodesic are the hyperboloid points perpendicular to p, which
// is the one-parameter family cosh(t) w + sinh(t) u for any Minkowski-
// orthonormal pair w (timelike), u (spacelike) perpendicular to p.
function geodesic_points(p: Vec3, reach: number, steps: number): Vec3[] {
    // Closest point of the geodesic to the origin, which keeps the sampling
    // centred on the part that is actually on screen.
    const k = mdot(ORIGIN, p);
    const w = to_hyperboloid([
        ORIGIN[0] - k * p[0], ORIGIN[1] - k * p[1], ORIGIN[2] - k * p[2]
    ]);
    const u = to_spacelike(cross(jdual(p), jdual(w)));
    const points: Vec3[] = [];
    for (let i = 0; i <= steps; i++) {
        const t = -reach + (2 * reach * i) / steps;
        const ch = Math.cosh(t), sh = Math.sinh(t);
        points.push([
            ch * w[0] + sh * u[0], ch * w[1] + sh * u[1], ch * w[2] + sh * u[2]
        ]);
    }
    return points;
}

// Mirror lines as thin strips. Width is applied after projection so the lines
// keep an even weight on screen rather than thinning away toward the boundary
// along with everything else.
function build_mirror_lines(
    tiling: Tiling, projection: Projection, cutoff: number, half_width: number,
    viewport: Viewport
): { mesh: number[], normals: number[] } {
    // A Poincare radius r is hyperbolic distance 2 atanh(r) from the centre.
    const reach = 2 * Math.atanh(Math.min(cutoff, 0.9995));
    const steps = Math.max(32, Math.min(512, Math.round(reach * 24)));
    const mesh: number[] = [];
    const normals: number[] = [];

    for (const p of distinct_mirrors(tiling)) {
        const points = geodesic_points(p, reach, steps);
        // Only the stretch that is both inside the cutoff and on screen.
        const projected: ([number, number] | null)[] = points.map(v => {
            const moved = mat_apply(tiling.view, v);
            const [dx, dy] = to_disc(moved);
            if (dx * dx + dy * dy > cutoff * cutoff) return null;
            const q = project(moved, projection);
            if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) return null;
            if (q[0] < viewport.x0 - 0.2 || q[0] > viewport.x1 + 0.2) return null;
            if (q[1] < viewport.y0 - 0.2 || q[1] > viewport.y1 + 0.2) return null;
            return q;
        });

        // The sampling is uniform in arc length along the geodesic, but the
        // conformal models compress it hard toward the boundary, so most of
        // those samples land on top of one another. Carrying an anchor forward
        // until the projected step is worth drawing turns a geodesic's worth
        // of sub-pixel quads into the handful that are actually visible.
        let anchor: [number, number] | null = null;
        for (let i = 0; i < projected.length; i++) {
            const b = projected[i];
            if (!b) { anchor = null; continue; }
            const a = anchor;
            if (!a) { anchor = b; continue; }
            const dx = b[0] - a[0], dy = b[1] - a[1];
            const length = Math.hypot(dx, dy);
            if (length < half_width) continue;
            anchor = b;
            const nx = (-dy / length) * half_width, ny = (dx / length) * half_width;
            const quad: [number, number][] = [
                [a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny],
                [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]
            ];
            for (const [i0, i1, i2] of [[0, 1, 2], [0, 2, 3]]) {
                for (const c of [quad[i0], quad[i1], quad[i2]]) {
                    mesh.push(c[0], c[1], 0);
                    normals.push(...FLAT_NORMAL);
                }
            }
        }
    }
    return { mesh, normals };
}
