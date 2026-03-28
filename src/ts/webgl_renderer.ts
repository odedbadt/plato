import * as THREE from 'three'
import * as Glsl from './glsl'
import { Model, Uniforms, model_to_geometry, create_canvas_texture } from './webgl_utils'

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

  scene: THREE.Scene;
  camera: THREE.Camera;

  // Geometry caches — avoid re-creating Float32Arrays + GPU uploads every frame
  private cached_model: Model | null = null;
  private cached_model_geo: THREE.BufferGeometry | null = null;
  private cached_mirrors_verts: Array<number> | null = null;
  private cached_mirrors_geo: THREE.BufferGeometry | null = null;

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

  draw_model(model: Model, uniforms: Uniforms) {
    this.apply_uniforms(this.main_material, uniforms);
    if (this.cached_model !== model) {
      this.cached_model_geo?.dispose();
      this.cached_model_geo = model_to_geometry(model);
      this.cached_model = model;
    }
    this.render_pass(this.cached_model_geo!, this.main_material, false);
  }

  draw_mirrors(model: Model, uniforms: Uniforms) {
    this.apply_uniforms(this.mirror_material, uniforms);
    if (this.cached_mirrors_verts !== model.vertices) {
      this.cached_mirrors_geo?.dispose();
      this.cached_mirrors_geo = model_to_geometry(model);
      this.cached_mirrors_verts = model.vertices;
    }
    this.render_pass(this.cached_mirrors_geo!, this.mirror_material, false);
  }

  draw_overlay(model: Model, uniforms: Uniforms) {
    this.apply_uniforms(this.overlay_material, uniforms);
    this.render_pass(model_to_geometry(model), this.overlay_material);
  }
}
