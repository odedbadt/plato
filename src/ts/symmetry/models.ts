// Per-model parameters for the generated polyhedra, transcribed from
// ~/work/weekend/concepts/symmetry/solve_for_polytopes.py.
//
// Note the dual flip between families: in the icosahedral group the non-dual
// mesh is `dodecahedron_a` and its dual is `icosahedron_a`, while in the
// octahedral group the non-dual mesh is `cube` and the dual is `octahedron`.
// That asymmetry is in the original; the names are kept as shipped.

import { Mat3, Vec3 } from './linalg';
import {
    GeneratedModel, MeshOptions, SweptEdges,
    place_mirrors, perpendicular_to_mirror_matrix,
    mirror_matrices_to_group_transformations, transformations_to_mesh,
    transformations_to_edges
} from './geometry';
import { wythoff_mesh, wythoff_edges } from './wythoff';

export type SymmetryFamily = 'icosahedral' | 'octahedral' | 'tetrahedral';

const FAMILY_ANGLES: Record<SymmetryFamily, [number, number, number]> = {
    icosahedral: [5, 3, 2], // group order 120
    octahedral: [4, 3, 2],  // group order 48
    tetrahedral: [3, 3, 2]  // group order 24
};

// Rotation order of the axis through each corner of the fundamental triangle,
// in corner order. Corner k is where mirrors k+1 and k+2 meet; place_mirrors
// separates mirrors 0 and 1 by pi/x, 0 and 2 by pi/y, and 1 and 2 by pi/z, so
// corner 0 turns z-fold, corner 1 y-fold and corner 2 x-fold.
export function corner_orders(family: SymmetryFamily): [number, number, number] {
    const [x, y, z] = FAMILY_ANGLES[family];
    return [z, y, x];
}

export type ModelSpec = MeshOptions & {
    family: SymmetryFamily
};

export const MODEL_SPECS: Record<string, ModelSpec> = {
    cube: { family: 'octahedral' },
    octahedron: { family: 'octahedral', dual: true },
    stellated_octahedron: { family: 'octahedral', stellated: true },
    dodecahedron_a: { family: 'icosahedral' },
    icosahedron_a: { family: 'icosahedral', dual: true },
    stellated_dodecahedron: { family: 'icosahedral', stellated: true },
    tetra_b: { family: 'tetrahedral' },
    // The spinner is drawn during loading and never gets a mirror overlay, so
    // it ships without mirror geometry, at coarser precision and without the
    // texture padding the other models carry.
    spinner: {
        family: 'tetrahedral',
        factor: 0.25,
        include_mirrors: false,
        decimals: 2,
        texture_padding: 0
    }
};

export const GENERATED_MODEL_NAMES = Object.keys(MODEL_SPECS);

// Models offered in the picker, in the order static/models/models.txt listed
// them. Most are generated; the colour variants below predate the generator
// and are not reproducible from it — `dodecahedron` and `icosahedron` are
// randomly coloured near-copies of the `_a` meshes, and the `sellated_*` /
// `random_colored_*` entries use stellation factors the driver no longer
// records — so those keep loading from static/models/.
export const LEGACY_MODEL_NAMES = [
    'dodecahedron',
    'icosahedron',
    'random_colored_st_dodec',
    'random_colored_st_octa',
    'sellated_dodecahedron',
    'sellated_octahedron'
];

export const SELECTABLE_MODEL_NAMES = [
    'cube',
    'dodecahedron',
    'dodecahedron_a',
    'icosahedron',
    'icosahedron_a',
    'octahedron',
    'random_colored_st_dodec',
    'random_colored_st_octa',
    'sellated_dodecahedron',
    'sellated_octahedron',
    'stellated_dodecahedron',
    'stellated_octahedron'
];

type Family = { mirrors: Vec3[], transformations: Mat3[] };

// Enumerating a reflection group takes long enough to be worth doing once.
const family_cache = new Map<SymmetryFamily, Family>();

export function get_family(name: SymmetryFamily): Family {
    const cached = family_cache.get(name);
    if (cached) return cached;
    const [x, y, z] = FAMILY_ANGLES[name];
    const mirrors = place_mirrors(x, y, z);
    const transformations = mirror_matrices_to_group_transformations(
        mirrors.map(perpendicular_to_mirror_matrix));
    const family = { mirrors, transformations };
    family_cache.set(name, family);
    return family;
}

export function is_generated_model(model_name: string): boolean {
    return Object.prototype.hasOwnProperty.call(MODEL_SPECS, model_name);
}

// A copy of a model's parameters, for a caller that wants to vary them. Null
// for the legacy JSON models, which have no generator behind them.
export function get_model_spec(model_name: string): ModelSpec | null {
    const spec = MODEL_SPECS[model_name];
    return spec ? { ...spec } : null;
}

function spec_of(model_name: string): ModelSpec {
    const spec = MODEL_SPECS[model_name];
    if (!spec) throw new Error(`Unknown generated model: ${model_name}`);
    return spec;
}

// Nothing here depends on a spec being one of MODEL_SPECS: the group is keyed
// by family alone, so a spec edited at runtime generates just as well as a
// registered one. That is what the shape controls ride on.
export function generate_model_from_spec(spec: ModelSpec): GeneratedModel {
    const { mirrors, transformations } = get_family(spec.family);
    return spec.seed
        ? wythoff_mesh(mirrors, transformations, spec)
        : transformations_to_mesh(mirrors, transformations, spec);
}

export function generate_edges_from_spec(spec: ModelSpec): SweptEdges {
    const { mirrors, transformations } = get_family(spec.family);
    return spec.seed
        ? wythoff_edges(mirrors, transformations, spec)
        : transformations_to_edges(mirrors, transformations, spec);
}

export function generate_model(model_name: string): GeneratedModel {
    return generate_model_from_spec(spec_of(model_name));
}

// The solid's real edges, straight from the group rather than recovered from
// the mesh afterwards.
export function generate_edges(model_name: string) {
    return generate_edges_from_spec(spec_of(model_name));
}
