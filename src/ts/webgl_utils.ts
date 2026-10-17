
import * as THREE from 'three'
import * as glMatrix from 'gl-matrix'

export type Uniforms = {
    [key: string]: {
        type?: string,
        value: any
    }
}
export type Model = {
    vertices: Array<number>,
    colors?: Array<number>,
    normals?: Array<number>,
    texture?: Array<number>,
    mirrors?: Array<number>,
    mirror_normals?: Array<number>
}

// Möller–Trumbore ray-triangle intersection.
// Returns barycentric (u, v) and ray distance t, or null on miss.
function ray_triangle_intersect(
    orig: glMatrix.vec3, dir: glMatrix.vec3,
    v0: glMatrix.vec3, v1: glMatrix.vec3, v2: glMatrix.vec3
): { t: number, u: number, v: number } | null {
    const EPSILON = 1e-8;
    const edge1 = glMatrix.vec3.subtract(glMatrix.vec3.create(), v1, v0);
    const edge2 = glMatrix.vec3.subtract(glMatrix.vec3.create(), v2, v0);
    const h = glMatrix.vec3.cross(glMatrix.vec3.create(), dir, edge2);
    const a = glMatrix.vec3.dot(edge1, h);
    if (Math.abs(a) < EPSILON) return null;
    const f = 1.0 / a;
    const s = glMatrix.vec3.subtract(glMatrix.vec3.create(), orig, v0);
    const u = f * glMatrix.vec3.dot(s, h);
    if (u < 0.0 || u > 1.0) return null;
    const q = glMatrix.vec3.cross(glMatrix.vec3.create(), s, edge1);
    const v = f * glMatrix.vec3.dot(dir, q);
    if (v < 0.0 || u + v > 1.0) return null;
    const t = f * glMatrix.vec3.dot(edge2, q);
    if (t < EPSILON) return null;
    return { t, u, v };
}

// Cast a ray from screen position (css_x, css_y) through the model and return
// the corresponding texture pixel coordinates [tx, ty], or null if no hit.
//
// Takes the uniforms the frame was drawn with rather than a rotation, so it
// picks against whatever is actually on screen — the spinning solid under its
// perspective camera, or a flat hyperbolic tiling under an orthographic one.
export function pick_uv(
    css_x: number, css_y: number,
    css_width: number, css_height: number,
    texture_width: number, texture_height: number,
    model: Model,
    uniforms: Uniforms
): [number, number] | null {
    if (!model.texture) return null;

    const proj = uniforms.projector.value as glMatrix.mat4;
    const mt = uniforms.model_transformer.value as glMatrix.mat3;

    // NDC of the mouse position
    const nx = (css_x / css_width) * 2 - 1;
    const ny = 1 - (css_y / css_height) * 2;

    // Unproject near/far clip points to world space to form a ray
    const inv_proj = glMatrix.mat4.invert(glMatrix.mat4.create(), proj)!;

    const near4 = glMatrix.vec4.fromValues(nx, ny, -1, 1);
    glMatrix.vec4.transformMat4(near4, near4, inv_proj);
    const ray_origin = glMatrix.vec3.fromValues(
        near4[0] / near4[3], near4[1] / near4[3], near4[2] / near4[3]);

    const far4 = glMatrix.vec4.fromValues(nx, ny, 1, 1);
    glMatrix.vec4.transformMat4(far4, far4, inv_proj);
    const far_pt = glMatrix.vec3.fromValues(
        far4[0] / far4[3], far4[1] / far4[3], far4[2] / far4[3]);

    const ray_dir = glMatrix.vec3.normalize(
        glMatrix.vec3.create(),
        glMatrix.vec3.subtract(glMatrix.vec3.create(), far_pt, ray_origin));

    const verts = model.vertices;
    const uvs = model.texture;
    const n_tri = Math.floor(verts.length / 9);

    let best_t = Infinity;
    let best_uv: [number, number] | null = null;

    for (let i = 0; i < n_tri; i++) {
        const vb = i * 9, ub = i * 6;
        const v0 = glMatrix.vec3.transformMat3(glMatrix.vec3.create(),
            glMatrix.vec3.fromValues(verts[vb], verts[vb + 1], verts[vb + 2]), mt);
        const v1 = glMatrix.vec3.transformMat3(glMatrix.vec3.create(),
            glMatrix.vec3.fromValues(verts[vb + 3], verts[vb + 4], verts[vb + 5]), mt);
        const v2 = glMatrix.vec3.transformMat3(glMatrix.vec3.create(),
            glMatrix.vec3.fromValues(verts[vb + 6], verts[vb + 7], verts[vb + 8]), mt);

        const hit = ray_triangle_intersect(ray_origin, ray_dir, v0, v1, v2);
        if (hit && hit.t < best_t) {
            best_t = hit.t;
            const u0 = uvs[ub], v0_ = uvs[ub + 1];
            const u1 = uvs[ub + 2], v1_ = uvs[ub + 3];
            const u2 = uvs[ub + 4], v2_ = uvs[ub + 5];
            const tex_u = u0 + hit.u * (u1 - u0) + hit.v * (u2 - u0);
            const tex_v = v0_ + hit.u * (v1_ - v0_) + hit.v * (v2_ - v0_);
            best_uv = [tex_u * texture_width, tex_v * texture_height];
        }
    }

    return best_uv;
}

// Camera constants. The wireframe pass needs these to turn a fragment's view
// depth back into a window depth, and to size the ink ramp to the model.
export const CAMERA_EYE: [number, number, number] = [0, -.1, 5];
export const CAMERA_TARGET: [number, number, number] = [0, -.1, 0];
export const CAMERA_DISTANCE = Math.hypot(
    CAMERA_EYE[0] - CAMERA_TARGET[0],
    CAMERA_EYE[1] - CAMERA_TARGET[1],
    CAMERA_EYE[2] - CAMERA_TARGET[2]);
export const CLIP_NEAR = 1.0;
export const CLIP_FAR = 10.0;
export const FOV_Y = Math.PI * 0.15;

export function matrix_uniforms(rotation: glMatrix.quat): Uniforms {
    const rotation_matrix_4x4 = glMatrix.mat4.create();
    glMatrix.mat4.fromQuat(rotation_matrix_4x4, rotation);

    const viewMatrix = glMatrix.mat4.create();
    glMatrix.mat4.lookAt(viewMatrix, CAMERA_EYE, CAMERA_TARGET, [0, 1, 0]);
    const projectionMatrix = glMatrix.mat4.create();
    glMatrix.mat4.perspective(projectionMatrix, FOV_Y, 1, CLIP_NEAR, CLIP_FAR);

    glMatrix.mat4.multiply(projectionMatrix, projectionMatrix, viewMatrix)

    const rotationMatrix3x3 = glMatrix.mat3.create();
    glMatrix.mat3.fromMat4(rotationMatrix3x3, rotation_matrix_4x4);
    return {
        "projector": {
            type: 'uniformMatrix4fv',
            value: projectionMatrix
        },
        "model_transformer": {
            type: 'uniformMatrix3fv',
            value: rotationMatrix3x3
        },
    }
}

// Attribute name, item size, and where the model keeps the data.
const MODEL_ATTRIBUTES: Array<[string, number, (model: Model) => Array<number> | undefined]> = [
    ['aVertexPosition', 3, model => model.vertices],
    ['aNormalDirection', 3, model => model.normals],
    ['aTextureCoord', 2, model => model.texture],
    ['aVertexColor', 4, model => model.colors],
];

export function model_to_geometry(model: Model): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setDrawRange(0, Math.floor(model.vertices.length / 3));
    for (const [name, item_size, pick] of MODEL_ATTRIBUTES) {
        const source = pick(model);
        if (!source) continue;
        geometry.setAttribute(name,
            new THREE.BufferAttribute(new Float32Array(source), item_size));
    }
    return geometry;
}

// Overwrite a geometry's attributes from a model of the same shape, instead of
// allocating a new one. A shape control being dragged regenerates the model
// every frame, and for a fixed symmetry family the buffer lengths never change
// — only the numbers in them. Returns false when the layouts differ and the
// caller has to rebuild.
export function update_geometry_in_place(
    geometry: THREE.BufferGeometry, model: Model
): boolean {
    for (const [name, , pick] of MODEL_ATTRIBUTES) {
        const source = pick(model);
        const attribute = geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
        if (!source !== !attribute) return false;
        if (source && attribute && attribute.array.length !== source.length) return false;
    }
    for (const [name, , pick] of MODEL_ATTRIBUTES) {
        const source = pick(model);
        if (!source) continue;
        const attribute = geometry.getAttribute(name) as THREE.BufferAttribute;
        (attribute.array as Float32Array).set(source);
        attribute.needsUpdate = true;
    }
    geometry.setDrawRange(0, Math.floor(model.vertices.length / 3));
    return true;
}

export function create_canvas_texture(texture_canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(texture_canvas);
    texture.flipY = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
}

// A rectangle of the plane, in the coordinates the model is already in.
export type PlaneView = { x0: number, x1: number, y0: number, y1: number };

// Orthographic view of a flat model — what the hyperbolic tilings need, since
// they arrive already projected into the plane and have no depth to show.
//
// The rect is fitted inside the canvas rather than stretched to it, so a disc
// stays a disc on a window of any shape.
// The rect actually shown, once `view` has been fitted to the canvas. Pointer
// handling needs this to run the mapping backwards.
export function fit_plane_view(view: PlaneView, aspect: number): PlaneView {
    const cx = (view.x0 + view.x1) / 2;
    const cy = (view.y0 + view.y1) / 2;
    const width = Math.max(view.x1 - view.x0, 1e-6);
    const height = Math.max(view.y1 - view.y0, 1e-6);
    let half_w = width / 2;
    let half_h = height / 2;
    if (aspect > width / height) half_w = half_h * aspect;
    else half_h = half_w / aspect;
    return { x0: cx - half_w, x1: cx + half_w, y0: cy - half_h, y1: cy + half_h };
}

export function orthographic_uniforms(view: PlaneView, aspect: number): Uniforms {
    const fitted = fit_plane_view(view, aspect);
    const projection = glMatrix.mat4.create();
    glMatrix.mat4.ortho(projection,
        fitted.x0, fitted.x1, fitted.y0, fitted.y1, -1, 1);
    return {
        "projector": { type: 'uniformMatrix4fv', value: projection },
        "model_transformer": { type: 'uniformMatrix3fv', value: glMatrix.mat3.create() },
    };
}
