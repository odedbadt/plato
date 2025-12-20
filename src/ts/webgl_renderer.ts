import * as glMatrix from 'gl-matrix'
import * as Glsl from './glsl'
import * as webgl_utils from './webgl_utils'
import { rect_union } from "@oded/tsutils/vec2";
import type { Rect } from "@oded/tsutils/vec2";



export class WebglRenderer {
  alpha: number = 0;
  texture_canvas: HTMLCanvasElement;
  dirty_rectange: Rect | null = null;
  texture: WebGLTexture | null = null;
  is_dirty: boolean = true;
  main_gl: WebGL2RenderingContext | null = null;
  model: webgl_utils.Model | null;
  program: WebGLProgram | null;


  construcror(texture_canvas: HTMLCanvasElement, model: webgl_utils.Model) {
    this.texture_canvas = texture_canvas;
    this.model = model;
  }
  initialize() {
    this.main_gl = this.texture_canvas.getContext("webgl2");
    if (!this.main_gl) {
      throw new Error("WebGL2 not supported");
    }
    this.program = webgl_utils.
      this.texture = webgl_utils.create_texture_from_canvas(this.main_gl, this.texture_canvas);
    //webgl_utils.bind_texture_to_program(main_gl, this.texture);
    this.mark_all_as_dirty();
  }


  mark_as_dirty(rect: Rect) {
    this.dirty_rectange = rect_union(this.dirty_rectange, rect);
    this.is_dirty = true;
  }
  mark_all_as_dirty() {
    this.dirty_rectange = {
      x: 0, y: 0, w: this.texture_canvas.width, h: this.texture_canvas.height
    }
    this.is_dirty = true;
  }

  set_alpha(alpha: number) {
    this.alpha = alpha;
    this.is_dirty = true;
  }
  draw_model() {
    if (!this.is_dirty) {
      return
    }
    this.is_dirty = false
    const texture_canvas = document.getElementById("textureCanvas");
    const main_canvas = document.getElementById("mainCanvas");
    const main_gl = main_canvas.getContext("webgl2");
    if (this.dirty_rectangle) {
      webgl_utils.update_texture_rect(main_gl, texture_canvas, this.texture, this.dirty_rectangle);
      this.dirty_rectange = null;
    }

    const x_axis = [1, 0, 0];
    const y_axis = [0, 1, 0];

    const rotation_matrix_4x4 = glMatrix.mat4.create();
    glMatrix.mat4.rotate(rotation_matrix_4x4, rotation_matrix_4x4, this.alpha, y_axis);
    glMatrix.mat4.rotate(rotation_matrix_4x4, rotation_matrix_4x4, Math.PI / 3, x_axis);

    const viewMatrix = glMatrix.mat4.create();
    glMatrix.mat4.lookAt(viewMatrix, [0, -.1, 5], [0, -.1, 0], [0, 1, 0]);
    const projectionMatrix = glMatrix.mat4.create();
    glMatrix.mat4.perspective(projectionMatrix, Math.PI * 0.15, 1, 1, 10.0);

    glMatrix.mat4.multiply(projectionMatrix, projectionMatrix, viewMatrix)

    const rotationMatrix3x3 = glMatrix.mat3.create();
    glMatrix.mat3.fromMat4(rotationMatrix3x3, rotation_matrix_4x4);
    const uniforms: Uniforms = {
      "projector": {
        type: 'uniformMatrix4fv',
        value: projectionMatrix
      },
      "model_transformer": {
        type: 'uniformMatrix3fv',
        value: rotationMatrix3x3
      },

    }
    //webgl_utils.clear(main_gl)
    if (document.getElementById('model').checked) {
      const main_shader_program = webgl_utils.build_program(main_gl, Glsl.VS_SOURCE, Glsl.FS_SOURCE, true,
        texture_canvas.width, texture_canvas.height);
      webgl_utils.draw_model(main_gl, main_shader_program, uniforms,
        this.model)
      webgl_utils.unbind_data(main_gl)
    }

    if (this.model.mirrors) {
      const mirror_shader_program = webgl_utils.build_program(main_gl, Glsl.VS_SOURCE, Glsl.FS_SOURCE_MIRRORS, false,
        texture_canvas.width, texture_canvas.height);
      if (document.getElementById('all-mirrors').checked) {
        webgl_utils.draw_model(main_gl, mirror_shader_program, uniforms,
          {
            "vertices": this.model.mirrors,
            "normals": this.model.mirror_normals
          })
      } else if (document.getElementById('generating-mirrors').checked) {
        webgl_utils.draw_model(main_gl, mirror_shader_program, uniforms,
          {
            "vertices": this.model.mirrors,
            "normals": this.model.mirror_normals
          },
          450)
      }
    }
    const overlay_shader_program = webgl_utils.build_program(main_gl,
      Glsl.VS_SOURCE_OVERLAY, Glsl.FS_SOURCE_OVERLAY, false,
      0, 0);
    webgl_utils.draw_model(main_gl, overlay_shader_program,
      {
        "uOpacity": { type: "uniform1f", value: this.overlay_transparency }
      },
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
      })

  };




}



