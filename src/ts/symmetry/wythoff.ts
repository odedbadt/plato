// The Wythoff construction: one seed point instead of one triangle.
//
// transformations_to_mesh() sweeps the fundamental triangle itself through the
// group, so the solid it draws is fixed by the group plus a couple of radial
// tweaks. Wythoff's construction instead places a single seed point inside the
// fundamental triangle and takes its orbit as the vertex set, which sweeps out
// the whole uniform family continuously as the seed moves:
//
//   seed at a corner        -> the Platonic solids
//   seed on an edge         -> the truncations, and the rectified solids at
//                              the point equidistant from both ends
//   seed strictly inside    -> the omnitruncated solid
//
// The faces are the rings of orbit points around each rotation axis. Around
// the axis through corner k the ring lies in the plane x . c_k = seed . c_k —
// every ring point is the seed moved by something that fixes c_k, so they all
// share that dot product — which makes the face exactly planar with c_k as its
// outward normal, no cross products needed.
//
// None of that needs the rings to be assembled explicitly. Fanning each face
// from its centre and splitting every fan triangle where it crosses a mirror
// leaves 6|G| triangles, each lying wholly inside one fundamental domain, and
// each a copy of one of six triangles in the base domain. So the whole mesh is
// the existing sweep with six triangles in place of one, and the six are:
//
//   (face centre on c_k, seed, foot of the seed on a mirror through c_k)
//
// for each corner k and each of the two mirrors meeting there. The polyhedron's
// edges fall out the same way: the ring neighbours of the seed are its
// reflections, so three base segments sweep to every edge and nothing else.

import { Mat3, Vec3, add, cross, dot, norm, normalize, scale, mat_apply, round_to } from './linalg';
import {
    GeneratedModel, MeshOptions, SweptEdges,
    build_mirror_mesh, perpendicular_to_mirror_matrix
} from './geometry';

const DEFAULT_DECIMALS = 3;

// Corner k is where the two mirrors that are not k meet, so it lies in both of
// their planes and is fixed by both reflections. Signs are settled against
// corner 0 so all three bound the same fundamental triangle rather than three
// scattered antipodes.
export function triangle_corners(mirrors: Vec3[]): Vec3[] {
    const corners = [0, 1, 2].map(k =>
        normalize(cross(mirrors[(k + 1) % 3], mirrors[(k + 2) % 3])));
    for (let k = 1; k < 3; k++) {
        if (dot(corners[k], corners[0]) < 0) corners[k] = scale(corners[k], -1);
    }
    return corners;
}

// Barycentric weights on the fundamental triangle, placed on the unit sphere.
// Mirror k is perpendicular to the two corners that lie in it, so a point's
// weight on corner k is just how far it stands off mirror k.
export function seed_point(
    mirrors: Vec3[], corners: Vec3[], barycentric: Vec3
): Vec3 {
    const [b0, b1, b2] = barycentric;
    const sum = b0 + b1 + b2;
    const w: Vec3 = sum > 0 ? [b0 / sum, b1 / sum, b2 / sum] : [1, 0, 0];
    return normalize(add(add(scale(corners[0], w[0]), scale(corners[1], w[1])),
        scale(corners[2], w[2])));
}

function barycentric_of(mirrors: Vec3[], corners: Vec3[], p: Vec3): Vec3 {
    const raw = [0, 1, 2].map(k =>
        dot(p, mirrors[k]) / dot(corners[k], mirrors[k])) as Vec3;
    const sum = raw[0] + raw[1] + raw[2];
    const d = sum !== 0 ? sum : 1;
    return [raw[0] / d, raw[1] / d, raw[2] / d];
}

// Matches the UV corners transformations_to_mesh assigns its one triangle:
// corner 0 -> (0,0), corner 1 -> (0,1), corner 2 -> (1,0). Mapping through the
// barycentric coordinates lands every piece of every face on the part of the
// texture its own place in the fundamental domain calls for, so one drawing
// still tiles the whole solid.
function corner_uv(barycentric: Vec3): [number, number] {
    return [barycentric[2], barycentric[1]];
}

type Triangle = { points: [Vec3, Vec3, Vec3], normal: Vec3, uvs: [number, number][] };

// The six triangles the seed cuts the fundamental domain into, plus the three
// segments that become the solid's edges.
export function wythoff_cell(
    mirrors: Vec3[], barycentric: Vec3, factor = 1.0
): { triangles: Triangle[], edges: [Vec3, Vec3][] } {
    const corners = triangle_corners(mirrors);
    const seed = seed_point(mirrors, corners, barycentric);
    const reflections = mirrors.map(perpendicular_to_mirror_matrix);
    // Every point here is the seed, a midpoint of it, or a retraction of a unit
    // corner, so the seed is always the farthest out.
    const s = factor / (norm(seed) || 1);

    const triangles: Triangle[] = [];
    for (let k = 0; k < 3; k++) {
        // The face around corner k sits in the plane x . c_k = seed . c_k, and
        // its centre is where that plane crosses the axis.
        const height = dot(seed, corners[k]);
        const centre = scale(corners[k], height);
        for (const m of [(k + 1) % 3, (k + 2) % 3]) {
            // Halfway to the reflected seed, i.e. the foot of the seed on
            // mirror m — where the fan triangle crosses into the next domain.
            const foot = scale(add(seed, mat_apply(reflections[m], seed)), 0.5);
            const points: [Vec3, Vec3, Vec3] = [centre, seed, foot];
            triangles.push({
                points: points.map(p => scale(p, s)) as [Vec3, Vec3, Vec3],
                normal: corners[k],
                uvs: points.map(p => corner_uv(barycentric_of(mirrors, corners, p)))
            });
        }
    }

    // A ring neighbour of the seed is one of its reflections, so these three
    // segments sweep to every edge of the solid and to nothing else. A seed
    // sitting on mirror m collapses that segment to a point, which is exactly
    // the edge vanishing as the truncation closes up.
    const edges = mirrors.map((_, m): [Vec3, Vec3] =>
        [scale(seed, s), scale(mat_apply(reflections[m], seed), s)]);

    return { triangles, edges };
}

export function wythoff_mesh(
    mirrors: Vec3[], transformations: Mat3[], options: MeshOptions = {}
): GeneratedModel {
    const {
        seed = [1, 1, 1],
        factor = 1.0,
        mirror_factor = 1.0,
        number_of_rays = 50,
        include_mirrors = true,
        decimals = DEFAULT_DECIMALS,
        round = true
    } = options;
    const q = round ? (v: number) => round_to(v, decimals) : (v: number) => v;

    const { triangles } = wythoff_cell(mirrors, seed, factor);

    const vertices: number[] = [];
    const normals: number[] = [];
    const texture: number[] = [];
    for (const transformation of transformations) {
        for (const triangle of triangles) {
            for (const p of triangle.points) {
                const t = mat_apply(transformation, p);
                vertices.push(q(t[0]), q(t[1]), q(t[2]));
            }
            const n = mat_apply(transformation, triangle.normal);
            const rn = [q(n[0]), q(n[1]), q(n[2])];
            normals.push(...rn, ...rn, ...rn);
            for (const uv of triangle.uvs) texture.push(uv[0], uv[1]);
        }
    }

    const model: GeneratedModel = { vertices, normals, texture };

    if (include_mirrors) {
        const { mesh, normals: mesh_normals } = build_mirror_mesh(
            mirrors, transformations, number_of_rays, mirror_factor);
        model.mirrors = round ? mesh.map(q) : mesh;
        model.mirror_normals = round ? mesh_normals.map(q) : mesh_normals;
    }

    return model;
}

export function wythoff_edges(
    mirrors: Vec3[], transformations: Mat3[], options: MeshOptions = {}
): SweptEdges {
    const { seed = [1, 1, 1], factor = 1.0 } = options;
    const { edges } = wythoff_cell(mirrors, seed, factor);

    const starts: number[] = [];
    const ends: number[] = [];
    for (const transformation of transformations) {
        for (const [a, b] of edges) {
            starts.push(...mat_apply(transformation, a));
            ends.push(...mat_apply(transformation, b));
        }
    }
    return { starts, ends };
}
