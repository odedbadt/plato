import { VS_SOURCE, FS_SOURCE, FS_SOURCE_NO_TEXTURE } from './glsl.js'
import * as RenderUtils from './render_utils.js'

function draw_all_models(model_names, models) {
  const main_canvas = document.getElementById("mainCanvas");
  const main_gl = main_canvas.getContext("webgl2");

  const identity = glMatrix.mat3.create();
  const x_axis = [1, 0, 0];
  const y_axis = [0, 1, 0];

  const rotation_matrix_4x4 = glMatrix.mat4.create();
  glMatrix.mat4.rotate(rotation_matrix_4x4, rotation_matrix_4x4, 0* Math.PI / 2, y_axis);
  glMatrix.mat4.rotate(rotation_matrix_4x4, rotation_matrix_4x4, 0* Math.PI /3, x_axis);

  const rotationMatrix3x3 = glMatrix.mat3.create();
  glMatrix.mat3.fromMat4(rotationMatrix3x3, rotation_matrix_4x4);
  
  Array.from(model_names).forEach((model_name, index) => {
    const model = models[model_name]
    const main_shader_program = RenderUtils.build_program(main_gl, 
      VS_SOURCE, FS_SOURCE_NO_TEXTURE, false);




    const viewMatrix = glMatrix.mat4.create();
    glMatrix.mat4.lookAt(viewMatrix, [0, 0, 6], [0, 0, 0], [0, 1, 0]);
    const projectionMatrix = glMatrix.mat4.create();
    const idx_x = index % 4
    const idx_y = Math.floor(index / 4)
    //glMatrix.mat4.perspective(projectionMatrix, Math.PI * 0.15, 1, 1, 10.0);
    glMatrix.mat4.ortho(projectionMatrix, -20+idx_x*5,5+idx_x*5,-20+idx_y*5,5+idx_y*5,1,100);
    glMatrix.mat4.multiply(projectionMatrix, projectionMatrix, viewMatrix)

    const uniforms = {
      "projector": {
        type: 'uniformMatrix4fv',
        value: projectionMatrix
      },
      "model_transformer": {
        type: 'uniformMatrix3fv',
        value: identity //rotationMatrix3x3
      },
    }
    RenderUtils.draw_model(main_gl, main_shader_program, uniforms, model)

})
}
function load_models(model_names) {
  console.log(model_names);
  if (localStorage.getItem('gallery_models')) {
    const gallery_models = JSON.parse(localStorage.getItem('gallery_models'))
    draw_all_models(model_names, gallery_models)
    return
  }
  const models = {}
  let remaining = new Map()
  for (var model_name of model_names) {
    remaining.set(model_name, 1)
  }
  console.log(` model len: ${model_names.length}, remainig size: ${remaining.size}`)
  Array.from(model_names).forEach((model_name) => {
    const xhr = new XMLHttpRequest();

    xhr.open('GET', `/model?model_name=${model_name}`);

    // Setup a function to handle the response
    xhr.onreadystatechange = function () {
      if (xhr.readyState == 4 && xhr.status == 200) {
        const unparsed = xhr.responseText
        models[model_name] = JSON.parse(unparsed);
        console.log(`${model_name} returned`);
        remaining.delete(model_name)
        console.log(`${remaining.size} remaining`);
        if (remaining.size == 0) {
          localStorage.setItem('gallery_models', JSON.stringify(models))
          draw_all_models(model_names, models)

        }
      }
    };
    // Send the request
    xhr.send();
  
  })
}
export function load_model_names() {
  const xhr = new XMLHttpRequest();

  // Configure it: GET-request to the URL /example/data
  xhr.open('GET', '/list_models');

  console.log('loading model names')
  // Setup a function to handle the response
  xhr.onreadystatechange = function () {
    if (xhr.readyState == 4 && xhr.status == 200) {
      // Parse the JSON response
      const unparsed = xhr.responseText
      // Log or use the response data
      const model_names = JSON.parse(unparsed);
      load_models(model_names)
      
    }
  };
  // Send the request
  xhr.send();
}
window.addEventListener('load', load_model_names);