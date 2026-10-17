// Port of ~/work/weekend/concepts/symmetry/utils/geometry.py — the Coxeter
// kaleidoscope construction that generates Plato's polyhedra.
//
// Three mirror planes placed at angles pi/x, pi/y, pi/z generate a finite
// reflection group. Enumerating the group orbit of a single fundamental
// triangle tiles the whole solid.
//
// Quirks of the original are reproduced deliberately so the generated geometry
// matches the JSON models that shipped before; each is called out below.

import {
    Mat3, Vec3, IDENTITY3,
    cross, dot, norm, normalize, scale, subtract, negate,
    mat_multiply, mat_apply, transpose, column, set_column,
    squared_distance, round_to
} from './linalg';

export type GeneratedModel = {
    vertices: number[],
    normals: number[],
    texture: number[],
    mirrors?: number[],
    mirror_normals?: number[]
};

const DEFAULT_DECIMALS = 3;
const NORMAL_DECIMALS = 9; // distinct_normals rounds harder than everything else

// UV corners of each fundamental triangle, as shipped in the JSON models.
const TRIANGLE_UVS = [0, 0, 0, 1, 1, 0];

// Which geometry a Coxeter triple's triangle lives in, from the determinant of
// its Gram matrix: G_ii = 1, G_ij = -cos(pi / n_ij).
//
// This is the exact, total test, and the only one to trust. The `acos` in
// place_mirrors() below is not a geometry test: it returns NaN for some
// non-spherical triples — (6,3,2), (4,4,2), (7,3,2) — but finite nonsense for
// others, with (5,4,3), (4,4,4) and (7,7,7) all producing plausible-looking
// Euclidean normals and then running the closure away to nothing. The
// equivalent angle-sum statement is that 1/x + 1/y + 1/z greater than 1 is
// spherical, equal is Euclidean and less is hyperbolic.
export type TriangleGeometry = 'spherical' | 'euclidean' | 'hyperbolic';

export function gram_determinant(x: number, y: number, z: number): number {
    const a = -Math.cos(Math.PI / x); // between mirrors 0 and 1
    const b = -Math.cos(Math.PI / y); // between mirrors 0 and 2
    const c = -Math.cos(Math.PI / z); // between mirrors 1 and 2
    return (1 - c * c) - a * (a - c * b) + b * (a * c - b);
}

const FLAT_EPSILON = 1e-9;

export function classify_triple(x: number, y: number, z: number): TriangleGeometry {
    const d = gram_determinant(x, y, z);
    if (Math.abs(d) < FLAT_EPSILON) return 'euclidean';
    return d > 0 ? 'spherical' : 'hyperbolic';
}

// A triple only describes a kaleidoscope at all if every angle is pi/n for a
// real n of at least 2.
export function triple_is_valid(x: number, y: number, z: number): boolean {
    return [x, y, z].every(n => Number.isFinite(n) && n >= 2);
}

// Unit normals of three mirror planes meeting at angles pi/x, pi/y, pi/z.
//
// Spherical triples only: anything else has no such arrangement in R^3, and
// letting one through here is what used to hang the tab.
export function place_mirrors(x: number, y: number, z: number): Vec3[] {
    const geometry = classify_triple(x, y, z);
    if (geometry !== 'spherical') {
        throw new Error(
            `(${x},${y},${z}) is ${geometry}, not spherical: its group is infinite. ` +
            `See symmetry/hyperbolic.ts.`);
    }
    const a = Math.PI / x; // between mirrors 0 and 1
    const b = Math.PI / y; // between mirrors 0 and 2
    const c = Math.PI / z; // between mirrors 1 and 2
    // Angle between the (2,0) and (2,1) intersection lines.
    const C = Math.acos(
        (Math.cos(c) - Math.cos(a) * Math.cos(b)) / (Math.sin(a) * Math.sin(b))
    );
    return [
        [1, 0, 0],
        [Math.cos(a), Math.sin(a), 0],
        [Math.cos(b), Math.sin(b) * Math.cos(C), Math.sin(b) * Math.sin(C)]
    ];
}

// Householder reflection I - 2pp^T for a unit perpendicular p.
export function perpendicular_to_mirror_matrix(p: Vec3): Mat3 {
    return [
        1 - 2 * p[0] * p[0], -2 * p[1] * p[0], -2 * p[2] * p[0],
        -2 * p[0] * p[1], 1 - 2 * p[1] * p[1], -2 * p[2] * p[1],
        -2 * p[0] * p[2], -2 * p[1] * p[2], 1 - 2 * p[2] * p[2]
    ];
}

// Keeps the first of each group of matrices within `threshold` (Frobenius) of
// one another, preserving input order.
export function fuzzy_unique(matrices: Mat3[], threshold = 10e-3): Mat3[] {
    const limit = threshold * threshold;
    const kept: Mat3[] = [];
    for (const candidate of matrices) {
        let duplicate = false;
        for (const seen of kept) {
            if (squared_distance(candidate, seen) < limit) {
                duplicate = true;
                break;
            }
        }
        if (!duplicate) kept.push(candidate);
    }
    return kept;
}

// Largest group this will enumerate. The biggest one it is ever asked for is
// icosahedral at 120, so this is pure containment: a triple that is not
// spherical has an infinite group, and without a ceiling the loop below simply
// grows — (4,4,4) reaches 6718 matrices in 682 ms and never stops, taking the
// tab with it. place_mirrors() now refuses such triples outright, and this is
// the second line in case something reaches here another way.
const MAX_GROUP_ORDER = 1000;

// Closure under left-multiplication by the mirrors, enumerating the group.
export function mirror_matrices_to_group_transformations(mirror_matrices: Mat3[]): Mat3[] {
    let transformations: Mat3[] = [IDENTITY3.slice()];
    for (let iteration = 0; iteration < 20; iteration++) {
        const applied: Mat3[] = [];
        // Mirror-major order, matching numpy's (3, n, 3, 3) reshape.
        for (const mirror of mirror_matrices) {
            for (const transformation of transformations) {
                applied.push(mat_multiply(mirror, transformation));
            }
        }
        const next = fuzzy_unique(transformations.concat(applied));
        if (next.length === transformations.length) return next;
        if (next.length > MAX_GROUP_ORDER) {
            throw new Error(
                `reflection group exceeded ${MAX_GROUP_ORDER} elements; ` +
                `the mirrors do not generate a finite group`);
        }
        transformations = next;
    }
    return transformations;
}

// Orthonormal basis whose first column is the given axis.
export function unitary_matrix_from_left_column(left_column: Vec3): Mat3 {
    const m: Mat3 = [
        left_column[0], 0, 0,
        left_column[1], 1, 0,
        left_column[2], 0, 1
    ];
    set_column(m, 0, normalize(column(m, 0)));
    const c0 = column(m, 0);
    const c1 = column(m, 1);
    set_column(m, 1, normalize(subtract(c1, scale(c0, dot(c0, c1)))));
    set_column(m, 2, normalize(cross(column(m, 0), column(m, 1))));
    return m;
}

// A plane and its opposite normal are the same plane, so normals are flipped
// to a canonical orientation before dedup: first non-zero component positive.
//
// The original compared against exactly 0. Components that are zero in exact
// arithmetic land on +-1e-17 in floating point, so that test branched
// inconsistently and let n and -n through as two "distinct" planes — the
// icosahedral group came out with 17 planes instead of 15, drawing two of the
// mirror discs twice. Comparing against an epsilon (and snapping the noise to
// zero) collapses those pairs. Pass `legacy_duplicate_planes` to get the old
// 17-plane behaviour back; note it cannot be reproduced bit-for-bit, since
// which of the two signs survives is pure float noise.
const NORMAL_EPSILON = 1e-9;

export function distinct_normals(
    mirrors: Vec3[], transformations: Mat3[], legacy_duplicate_planes = false
): Vec3[] {
    const seen = new Map<string, Vec3>();
    for (const transformation of transformations) {
        for (const mirror of mirrors) {
            const n = normalize(mat_apply(transformation, mirror));
            let directed: Vec3;
            if (legacy_duplicate_planes) {
                if (n[0] < 0) directed = negate(n);
                else if (n[0] === 0 && n[1] < 0) directed = negate(n);
                else if (n[0] === 0 && n[1] === 0 && n[2] < 0) directed = negate(n);
                else directed = n;
            } else {
                const snapped: Vec3 = [
                    Math.abs(n[0]) < NORMAL_EPSILON ? 0 : n[0],
                    Math.abs(n[1]) < NORMAL_EPSILON ? 0 : n[1],
                    Math.abs(n[2]) < NORMAL_EPSILON ? 0 : n[2]
                ];
                const leading = snapped.find(c => c !== 0) ?? 0;
                directed = leading < 0 ? negate(snapped) : snapped;
            }
            const rounded: Vec3 = [
                round_to(directed[0], NORMAL_DECIMALS),
                round_to(directed[1], NORMAL_DECIMALS),
                round_to(directed[2], NORMAL_DECIMALS)
            ];
            const key = `${rounded[0]},${rounded[1]},${rounded[2]}`;
            if (!seen.has(key)) seen.set(key, rounded);
        }
    }
    return Array.from(seen.values());
}

// A disc perpendicular to `rotation_axis`, as a fan of `number_of_rays`
// triangles, each (ray, rotated ray, origin). Returns flat xyz triplets.
export function vector_to_perpendicular_circle(
    rotation_axis: Vec3, number_of_rays: number
): number[] {
    const a = 2 * Math.PI / number_of_rays;
    const base_rotator: Mat3 = [
        1, 0, 0,
        0, Math.cos(a), -Math.sin(a),
        0, Math.sin(a), Math.cos(a)
    ];
    const m = unitary_matrix_from_left_column(rotation_axis);
    const rotator = mat_multiply(mat_multiply(m, base_rotator), transpose(m));
    const result: number[] = [];
    let ray = column(m, 2);
    for (let j = 0; j < number_of_rays; j++) {
        const rotated = mat_apply(rotator, ray);
        result.push(...normalize(ray));
        result.push(...normalize(rotated));
        result.push(0, 0, 0);
        ray = rotated;
    }
    return result;
}

export function build_mirror_mesh(
    mirrors: Vec3[], transformations: Mat3[], number_of_rays = 50, factor = 1,
    legacy_duplicate_planes = false
): { mesh: number[], normals: number[] } {
    const normal_tuples = distinct_normals(mirrors, transformations, legacy_duplicate_planes);
    const mesh: number[] = [];
    const normals: number[] = [];
    for (const normal of normal_tuples) {
        const circle = vector_to_perpendicular_circle(normal, number_of_rays);
        for (const value of circle) mesh.push(value * factor);
        for (let i = 0; i < number_of_rays * 3; i++) {
            normals.push(normal[0], normal[1], normal[2]);
        }
    }
    return { mesh, normals };
}

// How far v2 is pushed out before the triangle is rescaled. `stellated: true`
// is the classic factor of 2; `stellation` replaces it with any value, so a
// slider can travel continuously between the solid (1) and its stellation (2).
//
// Only at those special values does a face stay flat across the edges the
// group reflects it over, so intermediate settings are genuinely creased
// everywhere — crease_slots() reports that honestly and the wireframe gets
// denser in between.
export function stellation_factor(options: MeshOptions): number {
    return options.stellation ?? (options.stellated ? 2 : 1);
}

// The fundamental triangle, plus which mirror plane each of its edges lies in.
//
// v0 = m1 x m2 is perpendicular to the normals of mirrors 1 and 2, so it lies
// *in* both of those planes; likewise v1 in planes 2 and 0, and v2 in planes 1
// and 0. Each edge therefore lies in the one plane its two endpoints share.
export type FundamentalTriangle = {
    v0: Vec3, v1: Vec3, v2: Vec3,
    // Unnormalised, exactly as the mesh builder wants it.
    face_normal: Vec3,
    // Mirror index for edges (v0,v1), (v1,v2), (v2,v0).
    edge_mirrors: [number, number, number]
};

export function fundamental_triangle(
    mirrors: Vec3[], options: MeshOptions = {}
): FundamentalTriangle {
    const { dual = false, rhombic = false, factor = 1.0 } = options;
    const stellation = stellation_factor(options);
    const indices = dual ? [0, 2, 1] : [0, 1, 2];

    const m1xm2 = normalize(cross(mirrors[indices[1]], mirrors[indices[2]]));
    const m2xm0 = normalize(cross(mirrors[indices[2]], mirrors[indices[0]]));
    // Quirk: reversed relative to its name — cross(m1, m0), not cross(m0, m1).
    // This sets the triangle winding; flipping it inverts every face.
    const m0xm1 = normalize(cross(mirrors[indices[1]], mirrors[indices[0]]));

    let v0 = m1xm2;
    let v1 = scale(m2xm0, 1 / dot(m2xm0, m1xm2));
    // Quirk: v2 multiplies by the dot product where v1 divides; only the
    // rhombic variant divides in both.
    let v2 = rhombic
        ? scale(m0xm1, 1 / dot(m0xm1, m1xm2))
        : scale(m0xm1, dot(m0xm1, m1xm2));
    if (stellation !== 1) v2 = scale(v2, stellation);

    // Radial scale per corner, applied before the triangle is renormalised.
    // Two of the shipped models pull a corner in by a factor the formulas
    // above cannot produce; see MODEL_SPECS.
    const scales = options.corner_scales;
    if (scales) {
        v0 = scale(v0, scales[0]);
        v1 = scale(v1, scales[1]);
        v2 = scale(v2, scales[2]);
    }

    const max_norm = Math.max(norm(v0), norm(v1), norm(v2));
    v0 = scale(v0, factor / max_norm);
    v1 = scale(v1, factor / max_norm);
    v2 = scale(v2, factor / max_norm);

    // Flat per-face normal, left unnormalised exactly as in the original.
    const face_normal = cross(subtract(v0, v1), subtract(v0, v2));

    return {
        v0, v1, v2, face_normal,
        edge_mirrors: [indices[2], indices[0], indices[1]]
    };
}

// Reflecting the fundamental triangle across the plane holding one of its
// edges produces the neighbour sharing that edge. The two are coplanar — so
// the edge is interior to a face rather than a crease — exactly when the
// mirror is perpendicular to the face, i.e. when the face normal is
// perpendicular to the mirror normal.
//
// This is what makes the generated models easier to wireframe than the meshes
// they produce: the question is settled by three dot products on one triangle,
// with no dihedral-angle threshold and no tolerance for the mesh's rounding.
// The two cases are not close — creases land around 0.3 to 0.8, face interiors
// at 1e-16 — and which slot is which varies by solid, so it cannot be hardcoded
// (the stellated octahedron creases along a different edge than the cube).
const CREASE_EPSILON = 1e-6;

// Edge endpoints keep this much precision regardless of the mesh's own
// rounding; the wireframe's depth bias covers the sub-thousandth offset.
const EDGE_DECIMALS = 6;

export function crease_slots(triangle: FundamentalTriangle, mirrors: Vec3[]): boolean[] {
    const n = normalize(triangle.face_normal);
    return triangle.edge_mirrors.map(index =>
        Math.abs(dot(n, normalize(mirrors[index]))) > CREASE_EPSILON);
}

// Endpoint pairs of every edge of a solid, flat xyz triplets. The Wythoff
// builder produces these too, so the wireframe takes either.
export type SweptEdges = { starts: number[], ends: number[] };

// Sweeps the fundamental triangle's crease edges through the whole group,
// yielding every real edge of the solid and nothing else. Endpoints are
// rounded like the mesh so the wireframe sits exactly on the surface.
export function transformations_to_edges(
    mirrors: Vec3[], transformations: Mat3[], options: MeshOptions = {}
): SweptEdges & { edge_mirrors: number[] } {
    // Round no coarser than the mesh, but not as coarse as the spinner's 2
    // decimals: at factor 0.25 that is ~4% of the model, enough to fuse
    // distinct corners when the edges are welded.
    const decimals = Math.max(options.decimals ?? DEFAULT_DECIMALS, EDGE_DECIMALS);
    const triangle = fundamental_triangle(mirrors, options);
    const creases = crease_slots(triangle, mirrors);
    const corners = [triangle.v0, triangle.v1, triangle.v2];

    const starts: number[] = [];
    const ends: number[] = [];
    const edge_mirrors: number[] = [];
    const round3 = (v: Vec3): Vec3 => [
        round_to(v[0], decimals), round_to(v[1], decimals), round_to(v[2], decimals)
    ];

    for (const transformation of transformations) {
        for (let slot = 0; slot < 3; slot++) {
            if (!creases[slot]) continue;
            const a = round3(mat_apply(transformation, corners[slot]));
            const b = round3(mat_apply(transformation, corners[(slot + 1) % 3]));
            starts.push(...a);
            ends.push(...b);
            edge_mirrors.push(triangle.edge_mirrors[slot]);
        }
    }
    return { starts, ends, edge_mirrors };
}

export type MeshOptions = {
    dual?: boolean,
    stellated?: boolean,
    // Continuous stand-in for `stellated`, which it overrides when present:
    // 1 is the plain solid, 2 what `stellated: true` gives. See
    // stellation_factor().
    stellation?: number,
    // Radial scale for each corner of the fundamental triangle, in corner
    // order. `stellation` is the corner-2 case with its own name because it is
    // the one worth a slider.
    corner_scales?: [number, number, number],
    // Barycentric weights of a Wythoff seed point on the fundamental triangle.
    // Present means the solid comes from symmetry/wythoff.ts instead of from
    // sweeping the triangle itself, and `stellated` / `dual` / `rhombic` no
    // longer apply — where the seed sits says which solid this is.
    seed?: Vec3,
    rhombic?: boolean,
    factor?: number,
    mirror_factor?: number,
    number_of_rays?: number,
    include_mirrors?: boolean,
    // Decimal places the output is rounded to, matching the shipped JSON.
    decimals?: number,
    // Extra triangles' worth of UVs emitted past the draw range; see below.
    texture_padding?: number,
    // Rounding exists only to match the retired JSON models byte for byte, and
    // costs more than the sweep that produces the numbers. Pass false while a
    // shape control is being dragged.
    round?: boolean,
    legacy_duplicate_planes?: boolean
};

// Builds the fundamental triangle and sweeps it through the whole group.
export function transformations_to_mesh(
    mirrors: Vec3[], transformations: Mat3[], options: MeshOptions = {}
): GeneratedModel {
    const {
        dual = false,
        stellated = false,
        rhombic = false,
        factor = 1.0,
        mirror_factor = 1.0,
        number_of_rays = 50,
        include_mirrors = true,
        decimals = DEFAULT_DECIMALS,
        texture_padding = 18,
        round = true,
        legacy_duplicate_planes = false
    } = options;
    const q = round ? (v: number) => round_to(v, decimals) : (v: number) => v;

    const t = transformations.length;
    const { v0, v1, v2, face_normal } = fundamental_triangle(mirrors, options);

    const vertices: number[] = [];
    const normals: number[] = [];
    for (const transformation of transformations) {
        for (const v of [v0, v1, v2]) {
            const p = mat_apply(transformation, v);
            vertices.push(q(p[0]), q(p[1]), q(p[2]));
        }
        const n = mat_apply(transformation, face_normal);
        const rn: Vec3 = [q(n[0]), q(n[1]), q(n[2])];
        normals.push(...rn, ...rn, ...rn);
    }

    // Quirk: the shipped models emit t+18 triangles' worth of UVs rather than
    // t, so the tail past the draw range is never read. Harmless, and kept so
    // generated models stay comparable to the JSON they replace.
    const texture: number[] = [];
    for (let i = 0; i < t + texture_padding; i++) texture.push(...TRIANGLE_UVS);

    const model: GeneratedModel = { vertices, normals, texture };

    if (include_mirrors) {
        const { mesh, normals: mesh_normals } = build_mirror_mesh(
            mirrors, transformations, number_of_rays, mirror_factor,
            legacy_duplicate_planes);
        model.mirrors = round ? mesh.map(q) : mesh;
        model.mirror_normals = round ? mesh_normals.map(q) : mesh_normals;
    }

    return model;
}
