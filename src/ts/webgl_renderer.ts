import * as THREE from 'three'
import * as Glsl from './glsl'
import {
  Model, Uniforms, model_to_geometry, update_geometry_in_place,
  create_canvas_texture, CAMERA_DISTANCE, CLIP_NEAR, CLIP_FAR,
} from './webgl_utils'
import { EdgeSet, EdgeSource, extract_edges, edges_to_geometry } from './wireframe'

export type WireframeOptions = {
  // false: depth-weighted ink. true: every edge a flat 1px, as a baseline.
  flat: boolean,
  halo: boolean,
  w_min: number,            // target weight at the far end (px)
  w_max: number,            // target weight at the near end (px)
  halo_px: number,          // outer reach of a halo gap (px)
  halo_gain: number,        // 0: fixed-radius gaps. >0: gaps scale with depth
  color: [number, number, number],
  opacity: number,
  ink_gamma: number,        // 1.0 disables the sRGB-blend correction
  // Occlude edges on the far side using the solid's own depth, without
  // drawing the solid. No-op when the solid is already being drawn.
  hide_back: boolean,
};

export const DEFAULT_WIREFRAME_OPTIONS: WireframeOptions = {
  flat: false,
  halo: true,
  w_min: 0.25,
  w_max: 3.0,
  halo_px: 4.0,
  halo_gain: 1.5,
  color: [0.93, 0.95, 0.98],
  opacity: 1.0,
  ink_gamma: 2.2,
  hide_back: false,
};

// Uniforms common to both wireframe passes, plus the per-pass extras.
function wireframe_uniforms(extra: Uniforms): Uniforms {
  return {
    projector: { value: null },
    model_transformer: { value: null },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uWMin: { value: 0.25 },
    uWMax: { value: 3.0 },
    uInkNear: { value: CAMERA_DISTANCE - 1 },
    uInkFar: { value: CAMERA_DISTANCE + 1 },
    uFlat: { value: 0.0 },
    uPad: { value: 0.0 },
    uClipNear: { value: CLIP_NEAR },
    uClipFar: { value: CLIP_FAR },
    ...extra,
  };
}

// WebglRenderer: Stateful bridge using Three.js WebGLRenderer
// webgl_utils provides geometry/texture helpers; this class owns the scene lifecycle
export class WebglRenderer {
  renderer: THREE.WebGLRenderer;
  texture_canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  texture_dirty: boolean = true;

  // Per-pass materials - built once, uniforms updated each frame
  main_material: THREE.RawShaderMaterial;
  mirror_material: THREE.RawShaderMaterial;
  overlay_material: THREE.RawShaderMaterial;
  wireframe_material: THREE.RawShaderMaterial;
  wireframe_halo_material: THREE.RawShaderMaterial;

  scene: THREE.Scene;
  camera: THREE.Camera;

  // Geometry caches — avoid re-creating Float32Arrays + GPU uploads every frame
  private cached_model: Model | null = null;
  private cached_model_geo: THREE.BufferGeometry | null = null;
  private cached_mirrors_verts: Array<number> | null = null;
  private cached_mirrors_geo: THREE.BufferGeometry | null = null;
  private cached_wire_model: Model | null = null;
  private cached_wire_edges: EdgeSet | null = null;
  private cached_wire_geo: THREE.InstancedBufferGeometry | null = null;

  constructor(main_canvas: HTMLCanvasElement, texture_canvas: HTMLCanvasElement, preserve_buffer = false) {
    this.texture_canvas = texture_canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas: main_canvas, alpha: true, preserveDrawingBuffer: preserve_buffer });
    this.renderer.autoClear = false;

    this.texture = create_canvas_texture(texture_canvas);

    this.main_material = new THREE.RawShaderMaterial({
      vertexShader: Glsl.VS_SOURCE,
      fragmentShader: Glsl.FS_SOURCE,
      uniforms: {
        projector: { value: null },
        model_transformer: { value: null },
        uTexture: { value: this.texture },
        uSurface: { value: 1.0 },
        uInk: { value: 1.0 },
      },
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });

    this.mirror_material = new THREE.RawShaderMaterial({
      vertexShader: Glsl.VS_SOURCE,
      fragmentShader: Glsl.FS_SOURCE_MIRRORS,
      uniforms: {
        projector: { value: null },
        model_transformer: { value: null },
        uTexture: { value: this.texture },
      },
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });

    this.overlay_material = new THREE.RawShaderMaterial({
      vertexShader: Glsl.VS_SOURCE_OVERLAY,
      fragmentShader: Glsl.FS_SOURCE_OVERLAY,
      uniforms: {
        uTexture: { value: this.texture },
        uOpacity: { value: 1.0 },
      },
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });

    this.wireframe_material = new THREE.RawShaderMaterial({
      vertexShader: Glsl.VS_SOURCE_WIREFRAME,
      fragmentShader: Glsl.FS_SOURCE_WIREFRAME,
      uniforms: wireframe_uniforms({
        uColor: { value: new THREE.Vector3(0.13, 0.13, 0.13) },
        uOpacity: { value: 1.0 },
        uLineBias: { value: 0.0 },
        uInkGamma: { value: 2.2 },
        uInkOnDark: { value: 1.0 },
      }),
      glslVersion: THREE.GLSL3,
      transparent: true,
      // The halo prepass already carries occlusion; leaving depth writes off
      // keeps the translucent sub-pixel edges order-independent.
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      premultipliedAlpha: true,
    });

    this.wireframe_halo_material = new THREE.RawShaderMaterial({
      vertexShader: Glsl.VS_SOURCE_WIREFRAME,
      fragmentShader: Glsl.FS_SOURCE_WIREFRAME_HALO,
      uniforms: wireframe_uniforms({
        uHaloPx: { value: 4.0 },
        uHaloEps: { value: 0.0 },
        uHaloSlope: { value: 0.0 },
      }),
      glslVersion: THREE.GLSL3,
      transparent: false,
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    this.wireframe_halo_material.colorWrite = false;

    this.scene = new THREE.Scene();
    // Identity camera - projection is handled entirely by the 'projector' uniform
    this.camera = new THREE.Camera();
  }

  mark_texture_dirty() {
    this.texture_dirty = true;
  }

  refresh_texture() {
    if (this.texture_dirty) {
      this.texture.needsUpdate = true;
      this.texture_dirty = false;
    }
  }

  begin_frame() {
    const canvas = this.renderer.domElement;
    this.renderer.setViewport(0, 0, canvas.width, canvas.height);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, true, false);
  }

  end_frame() {
    // Three.js manages GL state cleanup internally
  }

  private render_pass(geometry: THREE.BufferGeometry, material: THREE.RawShaderMaterial, owned: boolean = true) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    this.scene.clear();
    this.scene.add(mesh);
    this.renderer.render(this.scene, this.camera);
    if (owned) geometry.dispose();
  }

  private apply_uniforms(material: THREE.RawShaderMaterial, uniforms: Uniforms) {
    for (const [key, entry] of Object.entries(uniforms)) {
      if (key in material.uniforms) {
        material.uniforms[key].value = entry.value;
      }
    }
  }

  // Refreshes `geo` in place where the layout allows it, so a model that is
  // being regenerated every frame does not churn a new BufferGeometry each
  // time; rebuilds otherwise.
  private refresh_geometry(
    geo: THREE.BufferGeometry | null, model: Model
  ): THREE.BufferGeometry {
    if (geo && update_geometry_in_place(geo, model)) return geo;
    geo?.dispose();
    return model_to_geometry(model);
  }

  private model_geometry(model: Model): THREE.BufferGeometry {
    if (this.cached_model !== model) {
      this.cached_model_geo = this.refresh_geometry(this.cached_model_geo, model);
      this.cached_model = model;
    }
    return this.cached_model_geo!;
  }

  // The surface and the drawing on it are separately switchable. With the
  // surface off the pass still runs over the same geometry, so the drawing
  // keeps its place in space and its shading; it is only the lit ground
  // underneath that goes. Lay down `draw_model_depth_only` first in that case,
  // or the ink on the far side shows through the blank near side.
  draw_model(model: Model, uniforms: Uniforms,
             surface: boolean = true, ink: boolean = true) {
    this.apply_uniforms(this.main_material, uniforms);
    this.main_material.uniforms.uSurface.value = surface ? 1.0 : 0.0;
    this.main_material.uniforms.uInk.value = ink ? 1.0 : 0.0;
    this.render_pass(this.model_geometry(model), this.main_material, false);
  }

  // Lay the solid into the depth buffer without drawing it, so a wireframe
  // rendered afterwards is occluded by the surface it belongs to.
  draw_model_depth_only(model: Model, uniforms: Uniforms) {
    this.apply_uniforms(this.main_material, uniforms);
    const geometry = this.model_geometry(model);
    // Opaque ground, no ink: the shader discards fully transparent fragments,
    // so this is what makes the whole surface land in the depth buffer.
    this.main_material.uniforms.uSurface.value = 1.0;
    this.main_material.uniforms.uInk.value = 0.0;
    this.main_material.colorWrite = false;
    this.render_pass(geometry, this.main_material, false);
    this.main_material.colorWrite = true;
  }

  draw_mirrors(model: Model, uniforms: Uniforms) {
    this.apply_uniforms(this.mirror_material, uniforms);
    if (this.cached_mirrors_verts !== model.vertices) {
      this.cached_mirrors_geo = this.refresh_geometry(this.cached_mirrors_geo, model);
      this.cached_mirrors_verts = model.vertices;
    }
    this.render_pass(this.cached_mirrors_geo!, this.mirror_material, false);
  }

  // Depth-weighted wireframe. Draws feature edges as instanced screen-space
  // quads whose weight falls off with depth, optionally preceded by a depth-only
  // halo prepass that cuts the farther line at every crossing.
  draw_wireframe(
    model: Model, uniforms: Uniforms, options: WireframeOptions,
    source?: EdgeSource
  ) {
    if (this.cached_wire_model !== model) {
      this.cached_wire_geo?.dispose();
      this.cached_wire_edges = extract_edges(source);
      this.cached_wire_geo = edges_to_geometry(this.cached_wire_edges);
      this.cached_wire_model = model;
    }
    const edges = this.cached_wire_edges!;
    if (edges.count === 0) return;

    // The model spins about the origin, so its depth range is fixed by its
    // radius whatever the rotation.
    const ink_near = CAMERA_DISTANCE - edges.radius;
    const ink_far = CAMERA_DISTANCE + edges.radius;
    const depth_range = ink_far - ink_near;

    const canvas = this.renderer.domElement;
    const halo_reach = options.halo ? options.halo_px : 0;

    const shared = (material: THREE.RawShaderMaterial, pad: number) => {
      this.apply_uniforms(material, uniforms);
      const u = material.uniforms;
      u.uViewport.value.set(canvas.width, canvas.height);
      u.uWMin.value = options.w_min;
      u.uWMax.value = options.w_max;
      u.uInkNear.value = ink_near;
      u.uInkFar.value = ink_far;
      u.uFlat.value = options.flat ? 1.0 : 0.0;
      u.uPad.value = pad;
    };

    if (options.halo) {
      const h = this.wireframe_halo_material;
      shared(h, halo_reach);
      h.uniforms.uHaloPx.value = options.halo_px;
      // Enough to let edges meeting at a shared corner through, and small
      // against the model's depth range so it costs no real separation.
      h.uniforms.uHaloEps.value = 0.02 * edges.radius;
      // Matches the doc's extra = gain * dz_normalized * 10 px, inverted into
      // view units of separation per pixel of gap.
      h.uniforms.uHaloSlope.value =
        options.halo_gain > 0 ? depth_range / (10 * options.halo_gain) : 0.0;
      this.render_pass(this.cached_wire_geo!, h, false);
    }

    const m = this.wireframe_material;
    shared(m, 0);
    m.uniforms.uColor.value.set(options.color[0], options.color[1], options.color[2]);
    m.uniforms.uOpacity.value = options.opacity;
    // Pull the lines a hair toward the camera so they win against the solid
    // faces they sit on, and against their own halo skirt.
    m.uniforms.uLineBias.value = 0.01 * edges.radius;
    m.uniforms.uInkGamma.value = Math.max(options.ink_gamma, 1.0);
    const luminance = 0.2126 * options.color[0] + 0.7152 * options.color[1]
      + 0.0722 * options.color[2];
    m.uniforms.uInkOnDark.value = luminance > 0.5 ? 1.0 : 0.0;
    this.render_pass(this.cached_wire_geo!, m, false);
  }

  draw_overlay(model: Model, uniforms: Uniforms) {
    this.apply_uniforms(this.overlay_material, uniforms);
    this.render_pass(model_to_geometry(model), this.overlay_material);
  }
}
