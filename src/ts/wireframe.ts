import * as THREE from 'three'
import {
  ModelSpec, generate_edges, generate_edges_from_spec, is_generated_model
} from './symmetry'

// Wireframe edge extraction.
//
// Models are triangle soups whose faces are triangulated (and subdivided), so a
// naive "draw every triangle edge" wireframe shows the tessellation rather than
// the polyhedron. Only the *feature* edges belong in a wireframe.
//
// Every model is generated, so the edges come from the symmetry group rather
// than from measuring the mesh: each triangle is a copy of one in the base
// domain, which settles the whole solid exactly — see crease_slots() and
// transformations_to_edges() in symmetry/geometry.ts, and wythoff_edges() for
// the seed-point path. Afterwards the collinear runs that face subdivision
// left behind are welded back into single segments.

const QUANT = 1e5;        // vertex welding precision
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

// Where a model's edges are asked for: a registered model's name, or a spec
// the shape controls have edited.
export type EdgeSource = string | ModelSpec;

export function extract_edges(source?: EdgeSource): EdgeSet {
    if (typeof source === 'string') {
        if (is_generated_model(source)) {
            return edges_from_symmetry(generate_edges(source));
        }
    } else if (source) {
        return edges_from_symmetry(generate_edges_from_spec(source));
    }
    // No generator behind this model: nothing to draw rather than a guess.
    return { starts: new Float32Array(0), ends: new Float32Array(0), count: 0, radius: 1 };
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
