import * as Glsl from './glsl'
import * as webgl_utils from './webgl_utils'
import type { Rect } from "@oded/tsutils/vec2";

// WebglRenderer: Stateful bridge that caches shader programs and orchestrates draw calls
// webgl_utils remains stateless - this class manages the GL state lifecycle
export class WebglRenderer {
  gl: WebGL2RenderingContext;
  texture_canvas: HTMLCanvasElement;

  // Cached shader programs - built once, reused every frame
  main_shader_program: WebGLProgram | null = null;
  mirror_shader_program: WebGLProgram | null = null;
  overlay_shader_program: WebGLProgram | null = null;

  // Texture dirty tracking
  texture_dirty: boolean = true;

  constructor(main_canvas: HTMLCanvasElement, texture_canvas: HTMLCanvasElement) {
    this.texture_canvas = texture_canvas;
    const gl = main_canvas.getContext("webgl2");
    if (!gl) {
      throw new Error("WebGL2 not supported");
    }
    this.gl = gl;

    // Build and cache all shader programs once
    this.main_shader_program = webgl_utils.build_program(gl, Glsl.VS_SOURCE, Glsl.FS_SOURCE);
    this.mirror_shader_program = webgl_utils.build_program(gl, Glsl.VS_SOURCE, Glsl.FS_SOURCE_MIRRORS);
    this.overlay_shader_program = webgl_utils.build_program(gl, Glsl.VS_SOURCE_OVERLAY, Glsl.FS_SOURCE_OVERLAY);
  }

  // Mark texture as needing refresh
  mark_texture_dirty() {
    this.texture_dirty = true;
  }

  // Refresh texture from canvas (only if dirty)
  refresh_texture() {
    if (this.texture_dirty) {
      webgl_utils.create_texture_from_canvas(this.gl, this.texture_canvas);
      this.texture_dirty = false;
    }
  }

  // Begin frame - setup GL state
  begin_frame() {
    webgl_utils.setup_render_state(this.gl);
  }

  // End frame - cleanup GL state
  end_frame() {
    webgl_utils.unbind_data(this.gl);
  }

  // Draw model with cached main shader
  draw_model(model: webgl_utils.Model, uniforms: webgl_utils.Uniforms) {
    if (this.main_shader_program) {
      webgl_utils.draw_webgl_model(this.gl, model, this.main_shader_program, uniforms);
    }
  }

  // Draw mirrors with cached mirror shader
  draw_mirrors(model: webgl_utils.Model, uniforms: webgl_utils.Uniforms) {
    if (this.mirror_shader_program) {
      webgl_utils.draw_webgl_model(this.gl, model, this.mirror_shader_program, uniforms);
    }
  }

  // Draw overlay with cached overlay shader
  draw_overlay(model: webgl_utils.Model, uniforms: webgl_utils.Uniforms) {
    if (this.overlay_shader_program) {
      // Disable depth test for overlay - it should always be on top
      this.gl.disable(this.gl.DEPTH_TEST);
      webgl_utils.draw_webgl_model(this.gl, model, this.overlay_shader_program, uniforms);
      this.gl.enable(this.gl.DEPTH_TEST);
    }
  }
}
