// @ts-nocheck

import * as Glsl from './glsl'
import * as RenderUtils from './render_utils'
import * as glMatrix from 'gl-matrix'

function isPowerOf2(value) {
  return (value & (value - 1)) === 0;
}

export function create_vertex_buffer(gl, vertices) {
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array(vertices),
    gl.STATIC_DRAW
  );
  return vertexBuffer;
}

export function create_color_buffer(gl, colors) {
  const colorBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
  return colorBuffer;
}

export function create_normal_buffer(gl, normals) {
  if (!normals) {
    return null;
  }
  const normalBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
  return normalBuffer;
}

export function create_texture_buffer(gl, textureCoords) {
  if (!textureCoords) {
    return null;
  }
  const textureCoordBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoords), gl.STATIC_DRAW);
  return textureCoordBuffer;
}

export function compile_vertex_shader(gl, vsSource) {
  const vertexShader = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vertexShader, vsSource);
  gl.compileShader(vertexShader);
  if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
    console.error(
      "Vertex shader compilation failed: " +
      gl.getShaderInfoLog(vertexShader)
    );
    return;
  }

  return vertexShader;
}
export function compile_fragment_shader(gl, fsSource) {
  const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fragmentShader, fsSource);
  gl.compileShader(fragmentShader);
  if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
    console.error('Version: ' + gl.getParameter(gl.VERSION));
    console.error(
      "Fragment shader compilation failed: " +
      gl.getShaderInfoLog(fragmentShader)
    );
    return;
  }
  return fragmentShader;
}
export function link_shaders(gl, vertexShader, fragmentShader) {
  const shaderProgram = gl.createProgram();
  gl.attachShader(shaderProgram, vertexShader);
  gl.attachShader(shaderProgram, fragmentShader);
  gl.linkProgram(shaderProgram);
  if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
    console.error(
      "Unable to initialize the shader program: " +
      gl.getProgramInfoLog(shaderProgram)
    );
    return;
  }
  gl.useProgram(shaderProgram);
  return shaderProgram;
}
export function build_shaders(gl, fSource, vsSource) {
  // Vertex shader source code
  const vertexShader = compile_vertex_shader(gl, fSource);
  const fragmentShader = compile_fragment_shader(gl, vsSource);
  gl.disable(gl.CULL_FACE)
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);


  return link_shaders(gl, vertexShader, fragmentShader);

  // Fragment shader source code



}
export function unbind_data(gl, model, shaderProgram) {
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.DITHER);
  gl.disable(gl.POLYGON_OFFSET_FILL);
  gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
  gl.disable(gl.SAMPLE_COVERAGE);
  gl.disable(gl.SCISSOR_TEST);
  gl.disable(gl.STENCIL_TEST);

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);

  gl.useProgram(null);
  gl.clearColor(0, 0, 0, 0);
  gl.clearDepth(1.0);
  gl.clearStencil(0);
  //gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  const maxAttributes = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
  for (let i = 0; i < maxAttributes; i++) {
    gl.disableVertexAttribArray(i);
    gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttrib1f(i, 0);
  }

}
export function bind_data_to_shaders(gl, model, shaderProgram) {
  // statefull
  const vertexBuffer = create_vertex_buffer(gl, model.vertices);
  const textureCoordBuffer = create_texture_buffer(gl, model.texture)

  const vertexPosition = gl.getAttribLocation(
    shaderProgram,
    "aVertexPosition"
  );
  gl.enableVertexAttribArray(vertexPosition);
  // window.bound_locations = window.bound_locations || []
  // window.bound_locations.push(vertexPosition)
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.vertexAttribPointer(vertexPosition, 3, gl.FLOAT, false, 0, 0);
  if (model.colors) {
    const colorBuffer = create_color_buffer(gl, model.colors)
    const vertexColorPosition = gl.getAttribLocation(
      shaderProgram, "aVertexColor");
    //window.bound_locations.push(vertexColorPosition)

    console.log(vertexPosition, vertexColorPosition, gl.getError());

    gl.enableVertexAttribArray(vertexColorPosition);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.vertexAttribPointer(vertexColorPosition, 4, gl.FLOAT, false, 0, 0);
  }
  if (model.normals) {
    const normalBuffer = create_normal_buffer(gl, model.normals)
    const normalPosition = gl.getAttribLocation(
      shaderProgram,
      "aNormalDirection"
    );
    //window.bound_locations.push(normalPosition)
    gl.enableVertexAttribArray(normalPosition);
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.vertexAttribPointer(normalPosition, 3, gl.FLOAT, false, 0, 0);
  }


  if (textureCoordBuffer) {
    const textureCoordPosition = gl.getAttribLocation(
      shaderProgram,
      "aTextureCoord"
    );
    gl.enableVertexAttribArray(textureCoordPosition);
    gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
    gl.vertexAttribPointer(textureCoordPosition, 2, gl.FLOAT, false, 0, 0);
  }
  const vectorIndexPosition = gl.getAttribLocation(
    shaderProgram,
    "aVectorIndex"
  );

}
export function build_program(gl, vsSource, fsSource, has_texture,
  texture_width,
  texture_height) {


  const shaderProgram = build_shaders(gl, vsSource, fsSource);
  if (has_texture) {
    if (isPowerOf2(texture_width) && isPowerOf2(texture_height)) {
      // Yes, it's a power of 2. Generate mips.
      gl.generateMipmap(gl.TEXTURE_2D);
    } else {
      // No, it's not a power of 2. Turn off mips and set
      // wrapping to clamp to edge
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
  }
  return shaderProgram
}

export function bindTextureToProgram(gl, texture_canvas) {
  const texture = gl.createTexture();
  const texture_context = texture_canvas.getContext('2d', { willReadFrequently: true });

  const imageData = texture_canvas && texture_context ?
    texture_context.getImageData(0, 0, texture_canvas.width, texture_canvas.height)
    : new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1);

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    imageData
  );
  gl.bindTexture(gl.TEXTURE_2D, texture);
  return texture;
}
export function draw_model(gl, shader_program, uniforms, model, vertex_count) {
  if (model.vertices && vertex_count && vertex_count != model.vertices.length * 3) {
    throw new Exception(`Bad vertex count ${vertex_count} != ${model.vertices.length}*3} `)
  }
  if (model.normals && vertex_count && vertex_count != model.normals.length * 3) {
    throw new Exception(`Bad normal count, vertex count: ${vertex_count} != ${model.normals.length}*9}`)
  }
  if (model.vertices && model.normals && model.vertices.length != model.normals.length) {
    throw new Exception(`Bad normal count, vertices:${model.vertices.length} != normals:${model.normals.length}`)
  }

  Object.entries(uniforms).forEach((entry) => {
    const name = entry[0]
    const type: string = entry[1].type as string
    const value = entry[1].value
    const uniform_location = gl.getUniformLocation(shader_program, name);
    if (uniform_location != -1) {
      gl[type](uniform_location, false, value);
    }
  })
  bind_data_to_shaders(gl, model, shader_program);
  gl.useProgram(shader_program);
  gl.drawArrays(gl.TRIANGLES, 0, vertex_count || model.vertices.length / 3);
  unbind_data(gl);
};
