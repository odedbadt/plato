import * as THREE from 'three'
import { Model } from './webgl_utils'
import {
  ModelSpec, generate_edges, generate_edges_from_spec, is_generated_model
} from './symmetry'

// Wireframe edge extraction.
//
// Models are triangle soups whose faces are triangulated (and subdivided), so a
// naive "draw every triangle edge" wireframe shows the tessellation rather than
// the polyhedron. Only the *feature* edges belong in a wireframe.
//
// There are two ways to find them, and which one applies depends on where the
// model came from:
//
//   Generated models ask the symmetry group directly. Every triangle is a copy
//   of one fundamental triangle, so classifying its three edges once settles
//   the whole solid exactly — see crease_slots() in symmetry/geometry.ts.
//
//   The six legacy JSON models have no generator behind them, so they fall back
//   to measuring dihedral angles on the welded mesh. That works here (the
//   angles are strongly bimodal) but it is a threshold against geometry that
//   has already been rounded to 3 decimals, where the exact test is neither.
//
// Both paths finish the same way: weld the collinear runs that face
// subdivision left behind back into single segments.

const QUANT = 1e5;        // vertex welding precision
const EDGE_KEY_STRIDE = 1e6;   // > any vertex count in these models
const COPLANAR_COS = Math.cos(Math.PI / 180);   // 1 degree
const COLLINEAR_COS = Math.cos(Math.PI / 180);

type Vec3 = [number, number, number];

export type EdgeSet = {
  // Flat endpoint pairs: 6 numbers (start xyz, end xyz) per edge
  starts: Float32Array,
  ends: Float32Array,
  count: number,
  // Largest |vertex|, used to size the ink depth ramp
  radius: number,
};

function face_normal(v: Array<number>, b: number): Vec3 {
  const ux = v[b + 3] - v[b], uy = v[b + 4] - v[b + 1], uz = v[b + 5] - v[b + 2];
  const wx = v[b + 6] - v[b], wy = v[b + 7] - v[b + 1], wz = v[b + 8] - v[b + 2];
  const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

// Where a model's edges can be asked for exactly: a registered model's name,
// or a spec the shape controls have edited. Absent (or a legacy JSON model)
// falls back to measuring the mesh.
export type EdgeSource = string | ModelSpec;

// Dispatch: exact when the generator knows the model, measured otherwise.
export function extract_edges(model: Model, source?: EdgeSource): EdgeSet {
    if (typeof source === 'string') {
        if (is_generated_model(source)) {
            return edges_from_symmetry(generate_edges(source));
        }
    } else if (source) {
        return edges_from_symmetry(generate_edges_from_spec(source));
    }
    return edges_from_dihedral(model);
}

// Edges swept from the fundamental triangle's crease slots. Each one arrives
// twice (once from the triangle on either side), so they still need welding and
// deduping — but nothing here is a judgement call about which edges are real.
function edges_from_symmetry(swept: { starts: number[], ends: number[] }): EdgeSet {
    const { starts, ends } = swept;
    const points: Vec3[] = [];
    const ids = new Map<string, number>();
    let radius = 0;

    const id_of = (xs: number[], i: number): number => {
        const x = xs[i], y = xs[i + 1], z = xs[i + 2];
        const key = `${Math.round(x * QUANT)},${Math.round(y * QUANT)},${Math.round(z * QUANT)}`;
        let id = ids.get(key);
        if (id === undefined) {
            id = points.length;
            points.push([x, y, z]);
            ids.set(key, id);
            radius = Math.max(radius, Math.hypot(x, y, z));
        }
        return id;
    };

    const seen = new Set<number>();
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < starts.length; i += 3) {
        const a = id_of(starts, i), b = id_of(ends, i);
        if (a === b) continue;
        const lo = Math.min(a, b), hi = Math.max(a, b);
        const key = lo * 100003 + hi;
        if (seen.has(key)) continue;   // the neighbouring triangle's copy
        seen.add(key);
        pairs.push([lo, hi]);
    }

    return to_edge_set(weld_collinear(pairs, points), points, radius);
}

// Flatten index pairs into the instanced-attribute layout.
function to_edge_set(
    pairs: Array<[number, number]>, points: Vec3[], radius: number
): EdgeSet {
    const count = pairs.length;
    const starts = new Float32Array(count * 3);
    const ends = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const [a, b] = pairs[i];
        starts[i * 3] = points[a][0]; starts[i * 3 + 1] = points[a][1]; starts[i * 3 + 2] = points[a][2];
        ends[i * 3] = points[b][0]; ends[i * 3 + 1] = points[b][1]; ends[i * 3 + 2] = points[b][2];
    }
    return { starts, ends, count, radius: radius || 1 };
}

// Fallback for the legacy JSON models: keep edges whose two adjacent faces are
// not coplanar, plus boundary edges.
function edges_from_dihedral(model: Model): EdgeSet {
  const v = model.vertices;
  const n_tri = Math.floor(v.length / 9);

  // Weld vertices by quantized position
  const vert_ids = new Map<string, number>();
  const points: Vec3[] = [];
  let radius = 0;
  const vert_id = (b: number): number => {
    const x = v[b], y = v[b + 1], z = v[b + 2];
    const key = `${Math.round(x * QUANT)},${Math.round(y * QUANT)},${Math.round(z * QUANT)}`;
    let id = vert_ids.get(key);
    if (id === undefined) {
      id = points.length;
      points.push([x, y, z]);
      vert_ids.set(key, id);
      radius = Math.max(radius, Math.hypot(x, y, z));
    }
    return id;
  };

  // Collect each undirected edge's adjacent face normals
  const adjacency = new Map<number, { a: number, b: number, normals: Vec3[] }>();
  for (let t = 0; t < n_tri; t++) {
    const b = t * 9;
    const nrm = face_normal(v, b);
    const ids = [vert_id(b), vert_id(b + 3), vert_id(b + 6)];
    for (let e = 0; e < 3; e++) {
      const p = ids[e], q = ids[(e + 1) % 3];
      if (p === q) continue;   // degenerate triangle
      const lo = Math.min(p, q), hi = Math.max(p, q);
      // Stable pair key. points.length grows as vertices are welded in, so
      // using it here would hash the same edge differently depending on when
      // it was seen, splitting an edge's two faces into separate buckets.
      const key = lo * EDGE_KEY_STRIDE + hi;
      let entry = adjacency.get(key);
      if (!entry) {
        entry = { a: lo, b: hi, normals: [] };
        adjacency.set(key, entry);
      }
      entry.normals.push(nrm);
    }
  }

  // Keep boundary edges and creases; drop edges interior to a flat face
  const kept: Array<[number, number]> = [];
  for (const { a, b, normals } of adjacency.values()) {
    if (normals.length === 1) { kept.push([a, b]); continue; }
    const n0 = normals[0];
    let crease = false;
    for (let i = 1; i < normals.length; i++) {
      const m = normals[i];
      // Unsigned: winding may differ between the two adjacent faces
      if (Math.abs(n0[0] * m[0] + n0[1] * m[1] + n0[2] * m[2]) < COPLANAR_COS) {
        crease = true;
        break;
      }
    }
    if (crease) kept.push([a, b]);
  }

  return to_edge_set(weld_collinear(kept, points), points, radius);
}

// Subdivision splits one polyhedron edge into several collinear segments. Join
// runs of them back together: a halo pass cuts gaps wherever edges cross, and
// an interior joint between two segments reads as a spurious crossing.
function weld_collinear(edges: Array<[number, number]>, points: Vec3[]): Array<[number, number]> {
  const incident = new Map<number, number[]>();
  for (let i = 0; i < edges.length; i++) {
    for (const p of edges[i]) {
      let list = incident.get(p);
      if (!list) { list = []; incident.set(p, list); }
      list.push(i);
    }
  }

  const dir_of = (e: [number, number]): Vec3 => {
    const a = points[e[0]], b = points[e[1]];
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  };

  const alive = edges.map(() => true);
  const current = edges.map(e => [...e] as [number, number]);

  // Repeatedly collapse any vertex joining exactly two collinear edges
  let changed = true;
  while (changed) {
    changed = false;
    for (const [p, list] of incident) {
      const live = list.filter(i => alive[i] && (current[i][0] === p || current[i][1] === p));
      if (live.length !== 2) continue;
      const [i, j] = live;
      const di = dir_of(current[i]), dj = dir_of(current[j]);
      const dot = Math.abs(di[0] * dj[0] + di[1] * dj[1] + di[2] * dj[2]);
      if (dot < COLLINEAR_COS) continue;

      // Splice j onto i, dropping the shared vertex p
      const other_i = current[i][0] === p ? current[i][1] : current[i][0];
      const other_j = current[j][0] === p ? current[j][1] : current[j][0];
      if (other_i === other_j) continue;   // closed 2-edge loop; leave it alone
      current[i] = [other_i, other_j];
      alive[j] = false;
      const list_i = incident.get(other_j);
      if (list_i) list_i.push(i);
      changed = true;
    }
  }

  return current.filter((_, i) => alive[i]);
}

// A 1x1 quad, instanced once per edge. aCorner.x is the lateral side (-1/+1),
// aCorner.y selects the endpoint (0 = start, 1 = end).
const QUAD_CORNERS = new Float32Array([
  -1, 0, 1, 0, 1, 1,
  -1, 0, 1, 1, -1, 1,
]);

export function edges_to_geometry(edges: EdgeSet): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  // There is no 'position' attribute to infer a vertex count from, so the draw
  // range has to say how long the base quad is — same reason model_to_geometry
  // sets one.
  geometry.setDrawRange(0, QUAD_CORNERS.length / 2);
  geometry.setAttribute('aCorner', new THREE.BufferAttribute(QUAD_CORNERS, 2));
  geometry.setAttribute('aStart', new THREE.InstancedBufferAttribute(edges.starts, 3));
  geometry.setAttribute('aEnd', new THREE.InstancedBufferAttribute(edges.ends, 3));
  geometry.instanceCount = edges.count;
  return geometry;
}
