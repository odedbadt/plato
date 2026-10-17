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

// A Coxeter triple: mirrors at angles pi/x, pi/y, pi/z.
export type Angles = [number, number, number];

export const FAMILY_ANGLES: Record<SymmetryFamily, Angles> = {
    icosahedral: [5, 3, 2], // group order 120
    octahedral: [4, 3, 2],  // group order 48
    tetrahedral: [3, 3, 2]  // group order 24
};

// Rotation order of the axis through each corner of the fundamental triangle,
// in corner order. Corner k is where mirrors k+1 and k+2 meet; place_mirrors
// separates mirrors 0 and 1 by pi/x, 0 and 2 by pi/y, and 1 and 2 by pi/z, so
// corner 0 turns z-fold, corner 1 y-fold and corner 2 x-fold.
export function corner_orders(angles: Angles): [number, number, number] {
    const [x, y, z] = angles;
    return [z, y, x];
}

export type ModelSpec = MeshOptions & {
    family: SymmetryFamily,
    // Overrides the family's own triple. The three named families are the
    // ones worth naming, not the only ones that work: any triple with
    // 1/x + 1/y + 1/z > 1 generates a finite group, and the generator never
    // cared which it was handed. Triples that are not spherical belong to
    // symmetry/hyperbolic.ts, and place_mirrors() refuses them.
    angles?: Angles
};

export function spec_angles(spec: ModelSpec): Angles {
    return spec.angles ?? FAMILY_ANGLES[spec.family];
}

export const MODEL_SPECS: Record<string, ModelSpec> = {
    cube: { family: 'octahedral' },
    octahedron: { family: 'octahedral', dual: true },
    stellated_octahedron: { family: 'octahedral', stellated: true },
    dodecahedron_a: { family: 'icosahedral' },
    icosahedron_a: { family: 'icosahedral', dual: true },
    stellated_dodecahedron: { family: 'icosahedral', stellated: true },
    tetra_b: { family: 'tetrahedral' },
    // The four below shipped as JSON until their parameters were recovered by
    // fitting the meshes; each reproduces the file it replaced to 1e-16. The
    // random_colored_* pair needs `corner_scales` because the driver pulled
    // corner 1 in by a factor none of the formulas above produce, and their
    // names are left as they were even though the colours went with the files
    // — nothing ever rendered them, as no shader declares aVertexColor.
    sellated_dodecahedron: {
        family: 'icosahedral', rhombic: true,
        stellation: 1.1458980337503153   // 1 + phi^-4
    },
    sellated_octahedron: { family: 'octahedral', rhombic: true, stellation: 1.5 },
    random_colored_st_dodec: {
        family: 'icosahedral', corner_scales: [1, 0.631475730333306, 1]
    },
    random_colored_st_octa: {
        family: 'octahedral', corner_scales: [1, 1 / 3, 1]
    },
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

// What the picker offers, now that the shape controls cover the variation the
// old per-mesh names used to stand for: the reflection group itself, smallest
// first. MODEL_SPECS stays as the preset registry behind generate_model(name)
// — it is where the parameters recovered from the retired JSON live — but the
// names there are history, not a menu.
export const SYMMETRY_FAMILIES: SymmetryFamily[] = [
    'tetrahedral', 'octahedral', 'icosahedral'
];

// "Icosahedral (5,3,2)" — the group by name, with the Coxeter triple whose
// mirror angles pi/x, pi/y, pi/z generate it.
export function family_label(family: SymmetryFamily): string {
    const [x, y, z] = FAMILY_ANGLES[family];
    return `${family[0].toUpperCase()}${family.slice(1)} (${x},${y},${z})`;
}

// "(5,5,2)" — a triple with no name of its own.
export function angles_label(angles: Angles): string {
    return `(${angles[0]},${angles[1]},${angles[2]})`;
}

export function family_order(family: SymmetryFamily): number {
    return get_family(family).transformations.length;
}

type Family = { mirrors: Vec3[], transformations: Mat3[] };

// Enumerating a reflection group takes long enough to be worth doing once.
// Keyed on the triple rather than the family name, since the triple is what
// the group actually depends on.
const group_cache = new Map<string, Family>();

export function get_group(angles: Angles): Family {
    const key = angles_label(angles);
    const cached = group_cache.get(key);
    if (cached) return cached;
    const mirrors = place_mirrors(angles[0], angles[1], angles[2]);
    const transformations = mirror_matrices_to_group_transformations(
        mirrors.map(perpendicular_to_mirror_matrix));
    const group = { mirrors, transformations };
    group_cache.set(key, group);
    return group;
}

export function get_family(name: SymmetryFamily): Family {
    return get_group(FAMILY_ANGLES[name]);
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
    const { mirrors, transformations } = get_group(spec_angles(spec));
    return spec.seed
        ? wythoff_mesh(mirrors, transformations, spec)
        : transformations_to_mesh(mirrors, transformations, spec);
}

export function generate_edges_from_spec(spec: ModelSpec): SweptEdges {
    const { mirrors, transformations } = get_group(spec_angles(spec));
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
