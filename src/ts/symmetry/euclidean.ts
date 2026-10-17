// The third kernel: the kaleidoscopes whose triangle is flat.
//
// A Coxeter triple with 1/x + 1/y + 1/z exactly 1 bounds a Euclidean triangle,
// and there are only three of them up to order — (3,3,3), (4,4,2) and (6,3,2),
// the wallpaper groups p3m1, p4m and p6m. They sit between the two kernels
// either side: the group is infinite, as in hyperbolic.ts, but the plane is
// flat, as in geometry.ts.
//
// What makes this a third file rather than a case in one of the others is that
// the mirrors do not share a point. On the sphere all three planes pass through
// the origin and reflection is linear; in the hyperbolic plane all three pass
// through the origin of R^{2,1} and reflection is linear there too. Here the
// three mirror *lines* bound a triangle, so two of them are offset from the
// origin and reflection is affine. Writing points as (x, y, 1) puts those
// affine maps back into 3x3 matrices, after which the enumeration, the view
// folding and the sweep are the same shape as hyperbolic.ts's — and the
// projection and the subdivision both disappear, since the plane is already
// the plane and its geodesics are already straight.

import { Mat3, Vec3, round_to } from './linalg';
import { classify_triple } from './geometry';
import type { GeneratedModel, SweptEdges } from './geometry';
import { Viewport } from './hyperbolic';

// ---------------------------------------------------------------------------
// Affine isometries as 3x3 matrices on (x, y, 1)
// ---------------------------------------------------------------------------

export type Point = [number, number];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

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

// The bottom row is always (0, 0, 1), so a point needs no division back.
function apply(m: Mat3, p: Point): Point {
    return [
        m[0] * p[0] + m[1] * p[1] + m[2],
        m[3] * p[0] + m[4] * p[1] + m[5]
    ];
}

// A rigid motion's inverse: transpose the rotation, and move the offset back
// through it.
export function invert_isometry(m: Mat3): Mat3 {
    const tx = -(m[0] * m[2] + m[3] * m[5]);
    const ty = -(m[1] * m[2] + m[4] * m[5]);
    return [m[0], m[3], tx, m[1], m[4], ty, 0, 0, 1];
}

export function translation(dx: number, dy: number): Mat3 {
    return [1, 0, dx, 0, 1, dy, 0, 0, 1];
}

// Orientation-reversing exactly when the linear part flips the plane, which is
// what the checker shading reads.
function determinant(m: Mat3): number {
    return m[0] * m[4] - m[1] * m[3];
}

// ---------------------------------------------------------------------------
// The fundamental triangle
// ---------------------------------------------------------------------------

// A mirror line: the points with n . p = offset, for a unit normal n.
export type Line = { n: Point, offset: number };

export type EuclideanGroup = {
    x: number, y: number, z: number,
    mirrors: Line[],
    corners: Point[],
    centroid: Point
};

// Corner k is where mirrors k+1 and k+2 meet, and place_mirrors() separates
// mirrors 0 and 1 by pi/x, 0 and 2 by pi/y, 1 and 2 by pi/z — so the angle at
// corner 0 is pi/z, at corner 1 pi/y and at corner 2 pi/x. Same convention as
// everywhere else, which is why corner_orders() still reads [z, y, x].
//
// A Euclidean triangle is fixed by its angles only up to scale, unlike the
// spherical and hyperbolic ones where the angles fix the size too. That spare
// degree of freedom is the one the UI exposes: `scale` is how big a cell is
// against the window, and it is the only knob a flat tiling has.
export function place_triangle(x: number, y: number, z: number, scale: number): Point[] {
    if (classify_triple(x, y, z) !== 'euclidean') {
        throw new Error(
            `(${x},${y},${z}) is not a Euclidean triple: 1/x + 1/y + 1/z is not 1`);
    }
    const a0 = Math.PI / z;   // angle at corner 0
    const a1 = Math.PI / y;   // angle at corner 1
    const a2 = Math.PI / x;   // angle at corner 2
    // Sine rule, with corner 2 at the origin and corner 1 along +x. The side
    // opposite a corner is proportional to the sine of its angle.
    const to_c1 = Math.sin(a0);
    const to_c0 = Math.sin(a1);
    const raw: Point[] = [
        [to_c0 * Math.cos(a2), to_c0 * Math.sin(a2)],
        [to_c1, 0],
        [0, 0]
    ];
    // Put the centroid at the origin and normalise the size, so `scale` means
    // the same thing from one triple to the next.
    const cx = (raw[0][0] + raw[1][0] + raw[2][0]) / 3;
    const cy = (raw[0][1] + raw[1][1] + raw[2][1]) / 3;
    const reach = Math.max(...raw.map(p => Math.hypot(p[0] - cx, p[1] - cy))) || 1;
    const s = scale / reach;
    return raw.map((p): Point => [(p[0] - cx) * s, (p[1] - cy) * s]);
}

// Mirror k is the line through the two corners that are not k — each corner
// lies in both of the mirrors that meet there.
export function lines_through(corners: Point[]): Line[] {
    return [0, 1, 2].map(k => {
        const a = corners[(k + 1) % 3], b = corners[(k + 2) % 3];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy) || 1;
        const n: Point = [-dy / len, dx / len];
        return { n, offset: n[0] * a[0] + n[1] * a[1] };
    });
}

// p - 2(n . p - offset) n, written out in homogeneous coordinates.
export function line_reflection(line: Line): Mat3 {
    const [a, b] = line.n;
    const d = line.offset;
    return [
        1 - 2 * a * a, -2 * a * b, 2 * d * a,
        -2 * b * a, 1 - 2 * b * b, 2 * d * b,
        0, 0, 1
    ];
}

const group_cache = new Map<string, EuclideanGroup>();

export function euclidean_group(
    x: number, y: number, z: number, scale: number
): EuclideanGroup {
    const key = `${x},${y},${z},${scale}`;
    const cached = group_cache.get(key);
    if (cached) return cached;
    const corners = place_triangle(x, y, z, scale);
    const centroid: Point = [
        (corners[0][0] + corners[1][0] + corners[2][0]) / 3,
        (corners[0][1] + corners[1][1] + corners[2][1]) / 3
    ];
    const group = { x, y, z, mirrors: lines_through(corners), corners, centroid };
    group_cache.set(key, group);
    return group;
}

// ---------------------------------------------------------------------------
// Where the viewer stands
// ---------------------------------------------------------------------------

const FOLD_EPSILON = 1e-9;
const FOLD_LIMIT = 10000;

function domain_signs(mirrors: Line[], centroid: Point): number[] {
    return mirrors.map(m =>
        (m.n[0] * centroid[0] + m.n[1] * centroid[1] - m.offset >= 0 ? 1 : -1));
}

function side_of(line: Line, p: Point): number {
    return line.n[0] * p[0] + line.n[1] * p[1] - line.offset;
}

// Same trick as hyperbolic.ts: rewrite the view so the point it puts at the
// centre of the screen lies in the fundamental triangle, by reflecting it back
// in until it does. The correction is a group element, so the picture does not
// change; what it buys is that the identity cell is always the one under the
// viewer, which is what lets the enumeration start there.
//
// It matters less here than it does there — a Euclidean isometry's entries do
// not grow with the distance walked, so nothing is about to lose precision —
// but the enumeration below still needs its starting cell to be the one on
// screen, and panning a long way without folding would leave it far away.
export function fold_view(view: Mat3, group: EuclideanGroup): Mat3 {
    const reflections = group.mirrors.map(line_reflection);
    const signs = domain_signs(group.mirrors, group.centroid);
    let folded = view;
    let where = apply(invert_isometry(folded), [0, 0]);
    for (let step = 0; step < FOLD_LIMIT; step++) {
        let outside = -1;
        for (let k = 0; k < 3; k++) {
            if (signs[k] * side_of(group.mirrors[k], where) < -FOLD_EPSILON) {
                outside = k; break;
            }
        }
        if (outside < 0) return folded;
        where = apply(reflections[outside], where);
        folded = mat_multiply(folded, reflections[outside]);
    }
    // Only reachable if the mirrors are not a kaleidoscope at all.
    return IDENTITY.slice();
}

export function pan_view(
    view: Mat3, from: Point, to: Point, group: EuclideanGroup
): Mat3 {
    return fold_view(
        mat_multiply(translation(to[0] - from[0], to[1] - from[1]), view), group);
}

// ---------------------------------------------------------------------------
// Enumerating the tiling
// ---------------------------------------------------------------------------

export type EuclideanTiling = {
    group: EuclideanGroup,
    cells: Mat3[],
    view: Mat3,
    truncated: boolean
};

// Cells are keyed on a quantised centroid image. The quantum is far finer
// than the gap between neighbouring cells and far coarser than the arithmetic
// noise, so the only way two words for the same element can be told apart is
// if their centroid images straddle a grid line.
//
// Which is exactly what used to happen here, because place_triangle() puts
// the centroid at the origin: a decimal-string key made "-0.000000" and
// "0.000000" two different cells, so the identity came back three times over
// and three copies of every cell were drawn on top of each other. Rounding to
// integers is what fixes it — JavaScript stringifies -0 as "0", so the two
// signs of zero cannot come apart.
const CELL_KEY_QUANTUM = 1e5;

// Breadth-first over words in the three reflections, keeping any cell whose
// image lands within `radius` of the middle of the screen. Keyed on the image
// of the centroid, for the same reason as in hyperbolic.ts: the group acts
// simply transitively on cells, so two numbers identify an element as surely
// as nine do.
export function enumerate_tiling(
    group: EuclideanGroup, radius: number, view: Mat3, max_cells: number
): EuclideanTiling {
    const folded = fold_view(view, group);
    const reflections = group.mirrors.map(line_reflection);
    const limit = radius * radius;

    const inside = (p: Point): boolean => {
        const q = apply(folded, p);
        return q[0] * q[0] + q[1] * q[1] < limit;
    };
    const key = (p: Point): string =>
        `${Math.round(p[0] * CELL_KEY_QUANTUM)},${Math.round(p[1] * CELL_KEY_QUANTUM)}`;

    const cells: Mat3[] = [IDENTITY.slice()];
    const seen = new Set<string>([key(group.centroid)]);
    let frontier: Mat3[] = cells.slice();
    let truncated = false;

    while (frontier.length > 0 && !truncated) {
        const next: Mat3[] = [];
        for (const cell of frontier) {
            for (const reflection of reflections) {
                const candidate = mat_multiply(reflection, cell);
                const image = apply(candidate, group.centroid);
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
        frontier = next;
    }
    return { group, cells, view: folded, truncated };
}

// ---------------------------------------------------------------------------
// Meshing
// ---------------------------------------------------------------------------

export type EuclideanSpec = {
    x: number, y: number, z: number,
    // How big one cell is against the window — the degree of freedom a flat
    // triangle has and the curved ones do not.
    scale?: number,
    view?: Mat3,
    viewport?: Viewport,
    max_cells?: number,
    include_mirrors?: boolean,
    mirror_width?: number,
    checker?: boolean,
    seed?: Vec3
};

const DEFAULTS = {
    scale: 0.22,
    max_cells: 20000,
    include_mirrors: true,
    mirror_width: 0.004,
    checker: true
};

// The lamp VS_SOURCE shades by, and the tilt that sets reflected cells apart
// from direct ones. Both are hyperbolic.ts's, for the same reasons and so the
// two flat kernels look like each other.
const FLAT_NORMAL: Vec3 = [-0.68041382, 0.27216553, -0.68041382];
const CHECKER_TILT = 0.43;

function to_unit(v: Vec3): Vec3 {
    const n = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / n, v[1] / n, v[2] / n];
}

function checker_normals(): [Vec3, Vec3] {
    const l = to_unit(FLAT_NORMAL);
    const perp = to_unit([
        l[1] * 1 - l[2] * 0, l[2] * 0 - l[0] * 1, l[0] * 0 - l[1] * 0
    ]);
    const k = Math.sqrt(Math.max(1 - CHECKER_TILT * CHECKER_TILT, 0));
    return [l, [
        CHECKER_TILT * l[0] + k * perp[0],
        CHECKER_TILT * l[1] + k * perp[1],
        CHECKER_TILT * l[2] + k * perp[2]
    ]];
}

type BaseTriangle = {
    points: [Point, Point, Point],
    uvs: [[number, number], [number, number], [number, number]]
};

function corner_uv(w: Vec3): [number, number] {
    return [w[2], w[1]];
}

// A point's weight on corner k is how far it stands off mirror k, measured
// against how far corner k stands off it — the same identity the other two
// kernels use, read with the affine line equation.
function barycentric_of(mirrors: Line[], corners: Point[], p: Point): Vec3 {
    const raw = [0, 1, 2].map(k =>
        side_of(mirrors[k], p) / (side_of(mirrors[k], corners[k]) || 1)) as Vec3;
    const sum = raw[0] + raw[1] + raw[2] || 1;
    return [raw[0] / sum, raw[1] / sum, raw[2] / sum];
}

function classic_base(corners: Point[]): BaseTriangle[] {
    return [{
        points: [corners[0], corners[1], corners[2]],
        uvs: [[0, 0], [0, 1], [1, 0]]
    }];
}

// The same six-piece decomposition as the hyperbolic Wythoff path: the face
// around corner k is the orbit of the seed under the rotation fixing that
// corner, so its centre is the corner itself, and splitting each fan triangle
// where it crosses a mirror leaves (corner k, seed, foot on mirror m).
function wythoff_base(
    mirrors: Line[], corners: Point[], seed: Vec3
): { triangles: BaseTriangle[], edges: [Point, Point][] } {
    const sum = seed[0] + seed[1] + seed[2] || 1;
    const w: Vec3 = [seed[0] / sum, seed[1] / sum, seed[2] / sum];
    const point: Point = [
        w[0] * corners[0][0] + w[1] * corners[1][0] + w[2] * corners[2][0],
        w[0] * corners[0][1] + w[1] * corners[1][1] + w[2] * corners[2][1]
    ];
    const reflections = mirrors.map(line_reflection);
    const uv_of = (p: Point) => corner_uv(barycentric_of(mirrors, corners, p));

    const triangles: BaseTriangle[] = [];
    for (let k = 0; k < 3; k++) {
        for (const m of [(k + 1) % 3, (k + 2) % 3]) {
            const image = apply(reflections[m], point);
            const foot: Point = [(point[0] + image[0]) / 2, (point[1] + image[1]) / 2];
            const points: [Point, Point, Point] = [corners[k], point, foot];
            triangles.push({
                points, uvs: [uv_of(points[0]), uv_of(points[1]), uv_of(points[2])]
            });
        }
    }
    const edges = reflections.map((r): [Point, Point] => [point, apply(r, point)]);
    return { triangles, edges };
}

const DEGENERATE = 1e-9;

function degenerate(points: Point[]): boolean {
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            if (Math.hypot(points[i][0] - points[j][0],
                points[i][1] - points[j][1]) < DEGENERATE) return true;
        }
    }
    return false;
}

function bbox_outside(points: Point[], view: Viewport, margin: number): boolean {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of points) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return x1 < view.x0 - margin || x0 > view.x1 + margin
        || y1 < view.y0 - margin || y0 > view.y1 + margin;
}

export const DEFAULT_VIEWPORT: Viewport = { x0: -1, x1: 1, y0: -1, y1: 1 };

export type EuclideanResult = {
    model: GeneratedModel,
    edges: SweptEdges,
    tiling: EuclideanTiling,
    cells: number,
    triangles: number
};

// No subdivision and no projection: a flat triangle in a flat plane drawn
// through an orthographic window is already exact, which is the one way this
// kernel is simpler than either of the others.
export function build_euclidean(spec: EuclideanSpec): EuclideanResult {
    const scale = Math.max(spec.scale ?? DEFAULTS.scale, 1e-3);
    const max_cells = spec.max_cells ?? DEFAULTS.max_cells;
    const include_mirrors = spec.include_mirrors ?? DEFAULTS.include_mirrors;
    const mirror_width = spec.mirror_width ?? DEFAULTS.mirror_width;
    const checker = spec.checker ?? DEFAULTS.checker;
    const viewport = spec.viewport ?? DEFAULT_VIEWPORT;
    const [direct_normal, mirrored_normal] = checker_normals();

    const group = euclidean_group(spec.x, spec.y, spec.z, scale);
    // Far enough to cover the corners of the window, plus one cell so the
    // edge of the enumeration is off screen rather than on it.
    const radius = Math.hypot(
        Math.max(Math.abs(viewport.x0), Math.abs(viewport.x1)),
        Math.max(Math.abs(viewport.y0), Math.abs(viewport.y1))) + 2 * scale;
    const tiling = enumerate_tiling(group, radius, spec.view ?? IDENTITY.slice(), max_cells);
    const { cells, view } = tiling;
    const at = (p: Point): Point => apply(view, p);

    const wythoff = spec.seed ? wythoff_base(group.mirrors, group.corners, spec.seed) : null;
    const base = (wythoff ? wythoff.triangles : classic_base(group.corners))
        .filter(t => !degenerate(t.points));
    const base_edges: [Point, Point][] = wythoff
        ? wythoff.edges.filter(e => !degenerate(e))
        : [[group.corners[0], group.corners[1]],
           [group.corners[1], group.corners[2]],
           [group.corners[2], group.corners[0]]];

    const vertices: number[] = [];
    const normals: number[] = [];
    const texture: number[] = [];
    const starts: number[] = [];
    const ends: number[] = [];
    const seen_edges = new Set<string>();
    let triangles = 0;

    const edge_key = (a: Point, b: Point): string => {
        const ka = `${round_to(a[0], 5)},${round_to(a[1], 5)}`;
        const kb = `${round_to(b[0], 5)},${round_to(b[1], 5)}`;
        return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    };

    for (const cell of cells) {
        const outline = group.corners.map(p => at(apply(cell, p)));
        if (bbox_outside(outline, viewport, 0.05)) continue;
        const normal = (checker && determinant(cell) < 0) ? mirrored_normal : direct_normal;

        for (const piece of base) {
            for (let k = 0; k < 3; k++) {
                const p = at(apply(cell, piece.points[k]));
                vertices.push(p[0], p[1], 0);
                normals.push(normal[0], normal[1], normal[2]);
                texture.push(piece.uvs[k][0], piece.uvs[k][1]);
            }
            triangles++;
        }

        for (const [a0, b0] of base_edges) {
            const a = at(apply(cell, a0)), b = at(apply(cell, b0));
            const key = edge_key(a, b);
            if (seen_edges.has(key)) continue;
            seen_edges.add(key);
            starts.push(a[0], a[1], 0);
            ends.push(b[0], b[1], 0);
        }
    }

    const model: GeneratedModel = { vertices, normals, texture };

    if (include_mirrors) {
        const { mesh, normals: mesh_normals } =
            build_mirror_lines(tiling, viewport, mirror_width, direct_normal);
        model.mirrors = mesh;
        model.mirror_normals = mesh_normals;
    }

    return { model, edges: { starts, ends }, tiling, cells: cells.length, triangles };
}

// ---------------------------------------------------------------------------
// Mirror lines
// ---------------------------------------------------------------------------

// Every mirror of the group, as the orbit of the three generators, deduped by
// line up to the sign of its normal.
function distinct_mirrors(tiling: EuclideanTiling): Line[] {
    const seen = new Map<string, Line>();
    for (const cell of tiling.cells) {
        for (const base of tiling.group.mirrors) {
            // Carry the line through the cell: a point on it and its direction.
            const a = apply(cell, [base.n[0] * base.offset, base.n[1] * base.offset]);
            const b = apply(cell, [
                base.n[0] * base.offset - base.n[1],
                base.n[1] * base.offset + base.n[0]
            ]);
            const dx = b[0] - a[0], dy = b[1] - a[1];
            const len = Math.hypot(dx, dy) || 1;
            let n: Point = [-dy / len, dx / len];
            let offset = n[0] * a[0] + n[1] * a[1];
            // A line and its opposite normal are one line.
            if (n[0] < -1e-9 || (Math.abs(n[0]) <= 1e-9 && n[1] < 0)) {
                n = [-n[0], -n[1]]; offset = -offset;
            }
            const key = `${round_to(n[0], 6)},${round_to(n[1], 6)},${round_to(offset, 6)}`;
            if (!seen.has(key)) seen.set(key, { n, offset });
        }
    }
    return Array.from(seen.values());
}

// Each mirror clipped to the window and drawn as one quad — straight lines,
// so there is nothing to trace or sample.
function build_mirror_lines(
    tiling: EuclideanTiling, viewport: Viewport, half_width: number, normal: Vec3
): { mesh: number[], normals: number[] } {
    const mesh: number[] = [];
    const normals: number[] = [];
    const view = tiling.view;

    for (const line of distinct_mirrors(tiling)) {
        // A point on the line and its direction, moved into view coordinates.
        const base: Point = [line.n[0] * line.offset, line.n[1] * line.offset];
        const a = apply(view, base);
        const b = apply(view, [base[0] - line.n[1], base[1] + line.n[0]]);
        const dx = b[0] - a[0], dy = b[1] - a[1];

        // Clip the infinite line to the window with a Liang-Barsky sweep over
        // the parameter t.
        let t0 = -Infinity, t1 = Infinity;
        const clip = (p: number, q: number): boolean => {
            if (Math.abs(p) < 1e-12) return q >= 0;
            const r = q / p;
            if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
            else { if (r < t0) return false; if (r < t1) t1 = r; }
            return true;
        };
        if (!clip(-dx, a[0] - viewport.x0)) continue;
        if (!clip(dx, viewport.x1 - a[0])) continue;
        if (!clip(-dy, a[1] - viewport.y0)) continue;
        if (!clip(dy, viewport.y1 - a[1])) continue;
        if (!(t1 > t0)) continue;

        const p0: Point = [a[0] + t0 * dx, a[1] + t0 * dy];
        const p1: Point = [a[0] + t1 * dx, a[1] + t1 * dy];
        const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        if (len < 1e-9) continue;
        const nx = (-(p1[1] - p0[1]) / len) * half_width;
        const ny = ((p1[0] - p0[0]) / len) * half_width;
        const quad: Point[] = [
            [p0[0] + nx, p0[1] + ny], [p1[0] + nx, p1[1] + ny],
            [p1[0] - nx, p1[1] - ny], [p0[0] - nx, p0[1] - ny]
        ];
        for (const [i0, i1, i2] of [[0, 1, 2], [0, 2, 3]]) {
            for (const c of [quad[i0], quad[i1], quad[i2]]) {
                mesh.push(c[0], c[1], 0);
                normals.push(normal[0], normal[1], normal[2]);
            }
        }
    }
    return { mesh, normals };
}
