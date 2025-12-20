import * as glMatrix from 'gl-matrix'
import * as Glsl from './glsl'
import * as webgl_utils from './webgl_utils'
import { rect_union } from "@oded/tsutils/vec2";
import type { Rect } from "@oded/tsutils/vec2";



export class WebglRenderer {
  alpha: number = 0;
  texture_canvas: HTMLCanvasElement;
  dirty_rectangle: Rect | null = null;
  texture: WebGLTexture | null = null;
  is_dirty: boolean = true;
  main_gl: WebGL2RenderingContext;
  model: webgl_utils.Model;
  program: WebGLProgram | null = null;
  overlay_transparency: any;
  mirrors: boolean = false;
  main_model_uniforms: webgl_utils.Uniforms = {};
  main_shader_program: WebGLProgram | null = null;
  overlay_shader_program: WebGLProgram | null = null;
  overlay_uniforms: webgl_utils.Uniforms = {};
  overlay_model: webgl_utils.Model = { vertices: [], texture: [] };



  constructor(texture_canvas: HTMLCanvasElement, model: webgl_utils.Model) {
    this.texture_canvas = texture_canvas;
    this.model = model;
    this.main_gl = texture_canvas.getContext("webgl2")!;
    if (!this.main_gl) {
      throw new Error("WebGL2 not supported");
    }
    this.overlay_model =
    {
      "vertices": [
        -1, -1, -1,
        1, -1, -1,
        -1, 1, -1,
        1, 1, -1,
        1, -1, -1,
        -1, 1, -1],
      "texture": [
        0, 1,
        1, 1,
        0, 0,
        1, 0,
        1, 1,
        0, 0]
    }
    this.initialize();
  }
  initialize() {
    //this.program = webgl_utils.
    this.texture = webgl_utils.create_texture_from_canvas(this.main_gl!, this.texture_canvas);
    //webgl_utils.bind_texture_to_program(main_gl, this.texture);
    this.main_shader_program = webgl_utils.build_program(main_gl, Glsl.VS_SOURCE, Glsl.FS_SOURCE, true,
      texture_canvas.width, texture_canvas.height);
    this.main_model_uniforms = this.matrix_uniforms();
    this.overlay_shader_program = webgl_utils.build_program(main_gl, Glsl.VS_SOURCE_OVERLAY, Glsl.FS_SOURCE_OVERLAY, false,

      this.overlay_uniforms = {
        "u_texture": {
          type: 'uniform1i',
          value: 0
        }
      }
    this.mark_all_as_dirty();
  }


  mark_as_dirty(rect: Rect) {
    this.dirty_rectangle = rect_union(this.dirty_rectangle, rect);
    this.is_dirty = true;
  }
  mark_all_as_dirty() {
    this.dirty_rectangle = {
      x: 0, y: 0, w: this.texture_canvas.width, h: this.texture_canvas.height
    }
    this.is_dirty = true;
  }

  set_alpha(alpha: number) {
    this.alpha = alpha;
    this.is_dirty = true;
    this.main_model_uniforms = this.matrix_uniforms();
  }

  unbind_data() {
    webgl_utils.unbind_data(this.main_gl);
  }
  draw_model() {
    if (!this.is_dirty || !this.texture || !this.main_shader_program) {
      return
    }
    this.is_dirty = false
    if (this.dirty_rectangle) {
      webgl_utils.update_texture_rect(this.main_gl, this.texture, this.texture_canvas, this.dirty_rectangle);
      this.dirty_rectangle = null;
    }


    //webgl_utils.clear(main_gl)
    if (!this.is_dirty || !this.texture || !this.overlay_shader_program) {
      return
    }
    webgl_utils.draw_webgl_model(this.main_gl, this.model, this.main_shader_program, this.main_model_uniforms)
    webgl_utils.draw_webgl_model(this.main_gl, this.overlay_model, this.overlay_shader_program,
      this.overlay_uniforms)


  };




}



