import { VS_SOURCE, FS_SOURCE, FS_SOURCE_MIRRORS, FS_SOURCE_NO_TEXTURE } from './glsl.js'
import * as RenderUtils from './render_utils.js'
function hsl_to_rgb(hsl) {
  let r, g, b;
  const h = hsl[0];
  const s = hsl[1];
  const l = hsl[2];
  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
export class App {
  constructor(model, spinning_speed, pen_color, pen_radius) {
    this.model = model;
    this.spinning_speed = spinning_speed || 0;
    this.is_spinning = this.spinning_speed && this.spinning_speed > 0;
    this.alpha = 0;
    this.pen_color = pen_color || 'black'
    this.pen_radius = pen_radius || 5
    this.dpr = window.devicePixelRatio;
    this.spinning_speed = 0.035;
    this.is_spinning = false;
    this.cache = localStorage;
  }
  construct_url_for_name(model_name) {
    return `static/models/${model_name}.json`
  }
  warmup_cache(model_names) {
    const _this = this;
    Array.from(model_names).forEach((model_name) => {
      _this.load_model(_this.construct_url_for_name(model_name), (model) => {
        this.cache.setItem(model_name, model)
      })
    })
  }
  load_spinner_model() {
    const _this = this;
    this.load_model(this.construct_url_for_name('spinner'), (model) => {
      _this.spinner_model = model;
    });
  }
  init() {
    const _this = this;
    this.init_canvas_sizes();

    this.init_palette();
    this.init_texture_sketcher();
    this.init_pen_selector();
    this.load_model_names((model_names) => {
      _this.model_names = model_names;
      _this.cache.setItem('all_model_names', model_names);
      const model_entries = []
      for (const model_name of model_names) {
        model_entries.push({ name: model_name })
      }
      // Warmup cache
      _this.warmup_cache(model_names);
      _this.load_spinner_model();
      new Vue({
        el: '#model-select',
        data: {
          model_entries: model_entries
        }
      })
      const model_select_element = document.getElementById('model-select')
      model_select_element.addEventListener('change', (event) => {
        _this.load_and_set_model(model_select_element.value);
      });
      const first_model = this.model_names[0];
      this.load_and_set_model(first_model, () => {

        const clear_btn = document.getElementById('clear-canvas-button');
        clear_btn.addEventListener('click', () => _this.clear());
        const cache_clear_btn = document.getElementById('clear-cache');
        cache_clear_btn.addEventListener('click', () => localStorage.clear());
        for (const id of ['model', 'all-mirrors', 'no-mirrors', 'generating-mirrors']) {
          document.getElementById(id).addEventListener('change', () => { _this.is_dirty = true; })
        }
        _this.is_dirty = true;
        _this.init_animation_loop();
        _this.spinning_interval = setInterval(() => {
          if (_this.is_spinning) {
            _this.alpha = _this.alpha + _this.spinning_speed;
            _this.is_dirty = true;
          }
        }, 100);
      });
      const main_canvas = document.getElementById("mainCanvas");

      main_canvas.addEventListener("click", (event) => {
        _this.is_spinning = !_this.is_spinning;
      })
    

    })
  }
  init_animation_loop() {
    const _this = this
    const animate = () => {
      if (this.model) {
        _this.draw_model()
      }

      requestAnimationFrame(animate)
    }
    requestAnimationFrame(animate)
  }
  load_model(model_url, callback) {
    if (this.cache.getItem(model_url)) {
      callback(this.cache.getItem(model_url));
      return
    }
    fetch(`${model_url}#'${Date.now()}`)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json(); // Parse JSON from the response
      })
      .then(data => {
        callback(data); // Handle the JSON data
      })
      .catch(error => {
        console.error('Error fetching data:', error); // Handle errors
      });
  }
  load_model_names(callback) {
    const cache_key = 'model_list';
    if (this.cache.getItem(cache_key)) {
      callback(this.cache.getItem(cache_key));
      return
    }
    fetch(`static/models/models.txt#'${Date.now()}`)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.text(); // Parse JSON from the response
      })
      .then(data => {
        const model_names = data.split(',');
        this.cache.setItem(cache_key, model_names)
        callback(model_names); // Handle the JSON data
      })
      .catch(error => {
        console.error('Error fetching data:', error); // Handle errors
      });
  }

  load_and_set_model(model_name, ready_callback) {

    if (this.interval_id) {
      window.clearInterval(this.interval_id);
    }
    const shape_name_element = document.getElementById('shape-name');
    shape_name_element.innerHTML = 'Loading...';
    if (this.spinner_model) {
      this.set_model(this.spinner_model);
    }
    this.set_spinning_speed(.035);
    const _this = this
    this.load_model(this.construct_url_for_name(model_name),
      (model) => {
        _this.cache.setItem(model_name, model);
        _this.set_model(model)
        ready_callback()
      })
  };
  set_spinning_speed(spinning_speed) {
    this.spinning_speed = spinning_speed || 0
    this.is_spinning = this.spinning_speed > 0
    //this.spin_and_draw();
  }
  set_model(model) {
    this.model = model;
    this.path = null;
    this.mirror_path = null;

    this.is_dirty = true;
  }
  init_and_draw() {
    const main_canvas = document.getElementById("mainCanvas");
    this.init_canvas_sizes();

    this.init_palette();
    this.init_texture_sketcher();
    this.init_pen_selector();
    this.is_dirty = true
    const _this = this;
    main_canvas.addEventListener("click", (event) => {
      _this.is_spinning = !_this.is_spinning
    })
  };
  init_canvas_sizes() {
    const dpr = this.dpr;
    const _this = this;
    const set_size = () => {
      _this.init_palette()
      _this.init_pen_selector()
      const main_canvas_element = document.getElementById('mainCanvas');
      const main_rect = main_canvas_element.getBoundingClientRect();
      main_canvas_element.width = main_rect.width * dpr;
      main_canvas_element.height = main_rect.height * dpr;
      this.is_dirty = true

      const texture_canvas_element = document.getElementById('textureCanvas');
      const texture_rect = texture_canvas_element.getBoundingClientRect();
      const texture_canvas_context = texture_canvas_element.getContext('2d', { 'willReadFrequently': true });
      const offscreen_canvas_element = document.createElement('canvas');
      offscreen_canvas_element.width = texture_rect.width * dpr;
      offscreen_canvas_element.height = texture_rect.height * dpr;
      const offscreen_context = offscreen_canvas_element.getContext('2d', { 'willReadFrequently': true });
      offscreen_context.drawImage(texture_canvas_element, 0, 0,
        offscreen_canvas_element.width,
        offscreen_canvas_element.height)
      texture_canvas_element.width = texture_rect.width * dpr;
      texture_canvas_element.height = texture_rect.height * dpr;
      texture_canvas_context.drawImage(offscreen_canvas_element, 0, 0,
        texture_canvas_element.width,
        texture_canvas_element.height);
    }
    set_size();
    const resize_observer = new ResizeObserver(entries => {
      entries.forEach((_) => { set_size() });
    })
    set_size();
    document.querySelectorAll('body').forEach((body_element) => {
      resize_observer.observe(body_element);
    })

  }
  init_palette() {
    const palette_canvas = document.getElementById("paletteCanvas");
    const palette_canvas_rect = palette_canvas.getBoundingClientRect();
    const width = palette_canvas_rect.width * this.dpr;
    const height = palette_canvas_rect.height * this.dpr;
    palette_canvas.width = width;
    palette_canvas.height = height;
    const palette_context = palette_canvas.getContext('2d', { 'willReadFrequently': true });
    const image_data = palette_context.getImageData(0, 0, palette_canvas.width, palette_canvas.height)
    const data = image_data.data;
    for (let y = 0; y < palette_canvas.height; y++) {
      for (let x = 0; x < palette_canvas.width; x++) {
        const h = x / palette_canvas.width;

        const s = 1;
        const l = y / palette_canvas.height;
        const rgb = hsl_to_rgb([h, s, l]);
        const base_offset = (y * palette_canvas.width + x) * 4;
        data[base_offset] = 255;
        data[base_offset + 1] = 0;
        data[base_offset + 2] = 0;
        data[base_offset] = rgb[0];
        data[base_offset + 1] = rgb[1];
        data[base_offset + 2] = rgb[2];
        data[base_offset + 3] = 255;


      }



    }
    palette_context.putImageData(image_data, 0, 0);
    // var img = new Image();
    // img.src = "static/palette.png"; // Replace with the path to your image
    const dpr = this.dpr;
    // img.onload = () => {
    //   palette_context.drawImage(img, 0, 0, 25, 200, 0, 0,
    //     palette_canvas.width, palette_canvas.height);
    // }
    palette_canvas.onclick = (event) => {
      const color = palette_context.getImageData(event.offsetX, event.offsetY, 1, 1).data;
      this.pen_color = `rgb(${color[0]},${color[1]},${color[2]})`;
      this.draw_pen_selector()
    }
  }
  draw_pen_selector() {
    const pen_canvas = document.getElementById("penCanvas");
    const pen_context = pen_canvas.getContext('2d', { willReadFrequently: true });
    const pen_canvas_rect = pen_canvas.getBoundingClientRect();
    const width = pen_canvas_rect.width * this.dpr;
    const height = pen_canvas_rect.height * this.dpr;

    pen_context.clearColor = 'black'
    pen_context.clearRect(0, 0, pen_canvas.width, pen_canvas.height)
    pen_context.fillStyle = this.pen_color
    pen_context.strokeStyle = 'white'
    pen_context.beginPath()
    pen_context.moveTo(width, 0)
    pen_context.lineTo(width, height)
    pen_context.lineTo(width / 2, height)
    pen_context.lineTo(width, 0)
    pen_context.fill()
    pen_context.stroke()
    pen_context.beginPath()
    const bak_globalCompositeOperation = pen_context.globalCompositeOperation;
    pen_context.globalCompositeOperation = "xor"
    const slope = pen_canvas_rect.width / 2 / pen_canvas_rect.height;

    pen_context.ellipse(width - this.pen_radius * this.dpr,
      this.dpr * this.pen_radius * 2 / slope,
      this.pen_radius * this.dpr,
      this.pen_radius * this.dpr,
      0, 0, Math.PI * 2)
    pen_context.fill()
    pen_context.stroke()
    pen_context.globalCompositeOperation = bak_globalCompositeOperation
  }
  init_pen_selector() {
    const pen_canvas = document.getElementById("penCanvas");
    const pen_canvas_rect = pen_canvas.getBoundingClientRect();
    const dpr = this.dpr;
    pen_canvas.width = pen_canvas_rect.width * dpr;
    pen_canvas.height = pen_canvas_rect.height * dpr;
    this.draw_pen_selector();
    const slope = pen_canvas_rect.width / 2 / pen_canvas_rect.height;
    const _this = this;
    pen_canvas.addEventListener("mousemove", (event) => {
      if (event.buttons) {
        const pen_canvas_y = event.offsetY;
        this.pen_radius = pen_canvas_y * slope / 2;
        _this.draw_pen_selector()
      }
    });
  }
  clear() {
    const texture_canvas = document.getElementById("textureCanvas");
    const texture_context = texture_canvas.getContext('2d', { willReadFrequently: true });
    const w = texture_canvas.width;
    const h = texture_canvas.height;
    texture_context.fillStyle = 'white';
    texture_context.fillRect(0, 0, w, h);
    this.is_dirty = true;
  }
  init_texture_sketcher() {
    const texture_canvas = document.getElementById("textureCanvas");
    const texture_context = texture_canvas.getContext('2d', { willReadFrequently: true });
    texture_context.fillStyle = "white";
    texture_context.fillRect(0, 0,
      texture_canvas.width, texture_canvas.height);
    // const frame_texture = () {
    //   texture_context.lineWidth = 3;
    //   texture_context.fillStyle = "black";
    //   texture_context.beginPath();
    //   texture_context.moveTo(texture_canvas.width, 0);
    //   texture_context.lineTo(texture_canvas.width, texture_canvas.height);
    //   texture_context.lineTo(0, texture_canvas.height);
    //   texture_context.lineTo(texture_canvas.width, 0);
    //   texture_context.fill();
    //   texture_context.strokeStyle = "blue";
    //   texture_context.beginPath();
    //   texture_context.moveTo(texture_canvas.width, 0);
    //   texture_context.lineTo(0, texture_canvas.height);
    //   texture_context.lineTo(0, 0);
    //   texture_context.lineTo(texture_canvas.width, 0);
    //   texture_context.stroke();
    // }
    //frame_texture()

    const w = texture_canvas.width;
    const h = texture_canvas.height;
    const dpr = this.dpr;
    const mouse_event_to_coordinates = (event) => {
      const canvas_x = event.offsetX;
      const canvas_y = event.offsetY;
      return [canvas_x * dpr, canvas_y * dpr];
    }
    const mirror_coordinates = (coords) => {
      return [w - coords[1], h - coords[0]]
    }
    const dist2 = (v1, v2) => {
      const mn = [v1[0] - v2[0], v1[1] - v2[1]];
      return mn[0] * mn[0] + mn[1] * mn[1];
    }
    const _this = this;

    texture_canvas.addEventListener("mousedown", (event) => {
      _this.path = new Path2D();
      _this.mirror_path = new Path2D();
      texture_context.strokeStyle = 'black'
      texture_context.fillStyle = _this.pen_color;
      texture_context.lineWidth = 1;
      const coords = mouse_event_to_coordinates(event);
      _this.prev_coords = [coords[0], coords[1]]
      const mirror_coords = mirror_coordinates(coords);

      texture_context.beginPath();
      //texture_context.ellipse(coords[0], coords[1], this.pen_radius, this.pen_radius, 0, 0, Math.PI * 2)
      texture_context.fill();
      texture_context.beginPath();
      //texture_context.ellipse(mirror_coords[0], mirror_coords[1], this.pen_radius, this.pen_radius, 0, 0, Math.PI * 2)
      texture_context.fill();
      texture_context.beginPath();

      _this.path.moveTo(coords[0], coords[1])
      _this.mirror_path.moveTo(mirror_coords[0], mirror_coords[1])
    })
    texture_canvas.addEventListener("mouseup", (event) => {
      if (_this.path) {
        texture_context.lineWidth = _this.pen_radius;
        texture_context.beginPath();
        texture_context.stroke(_this.path);
        _this.path = null;
        texture_context.beginPath();
        texture_context.stroke(_this.mirror_path);
        _this.mirror_path = null;
      }
    })
    texture_canvas.addEventListener("mousemove", (event) => {
      const coords = mouse_event_to_coordinates(event);
      const mirror_coords = mirror_coordinates(coords);
      if (event.buttons) {
        if (_this.path && _this.mirror_path) {
          if (dist2(coords, _this.prev_coords) * dpr * dpr > 10) {
            _this.path.lineTo(coords[0], coords[1]);
            _this.mirror_path.lineTo(mirror_coords[0], mirror_coords[1]);
            texture_context.strokeStyle = _this.pen_color;
            texture_context.fillStyle = _this.pen_color;
            texture_context.lineWidth = _this.pen_radius*2;
            texture_context.lineCap = 'butt';
            texture_context.lineJoin = 'miter';
            texture_context.stroke(_this.path)
            texture_context.stroke(_this.mirror_path)
          } else {
            _this.path.moveTo(coords[0], coords[1]);
            _this.mirror_path.moveTo(mirror_coords[0], mirror_coords[1]);

          }
        }
        this.prev_coords = [coords[0], coords[1]];

        texture_context.beginPath();
        texture_context.ellipse(coords[0], coords[1], this.pen_radius, this.pen_radius, 0, 0, Math.PI * 2)
//        texture_context.ellipse(coords[0], coords[1], 30, 30, 0, 0, Math.PI * 2)
        texture_context.fill();
        texture_context.fillStyle = this.pen_color;
        texture_context.lineWidth = 0;
        texture_context.beginPath();
        texture_context.ellipse(mirror_coords[0], mirror_coords[1], this.pen_radius, this.pen_radius, 0, 0, Math.PI * 2)
        texture_context.fill();
        texture_context.beginPath();
        texture_context.lineWidth = this.pen_radius;
        this.is_dirty = true;
      }

    })

  }
  draw_model() {
    if (!this.is_dirty) {
      return
    }
    this.is_dirty = false
    const texture_canvas = document.getElementById("textureCanvas");
    const main_canvas = document.getElementById("mainCanvas");
    const main_gl = main_canvas.getContext("webgl2");

    RenderUtils.bindTextureToProgram(main_gl, texture_canvas);


    const x_axis = [1, 0, 0];
    const y_axis = [0, 1, 0];

    const rotation_matrix_4x4 = glMatrix.mat4.create();
    glMatrix.mat4.rotate(rotation_matrix_4x4, rotation_matrix_4x4, this.alpha, y_axis);
    glMatrix.mat4.rotate(rotation_matrix_4x4, rotation_matrix_4x4, Math.PI / 3, x_axis);

    const viewMatrix = glMatrix.mat4.create();
    glMatrix.mat4.lookAt(viewMatrix, [0, 0, 6], [0, 0, 0], [0, 1, 0]);
    const projectionMatrix = glMatrix.mat4.create();
    glMatrix.mat4.perspective(projectionMatrix, Math.PI * 0.15, 1, 1, 10.0);

    glMatrix.mat4.multiply(projectionMatrix, projectionMatrix, viewMatrix)

    const rotationMatrix3x3 = glMatrix.mat3.create();
    glMatrix.mat3.fromMat4(rotationMatrix3x3, rotation_matrix_4x4);
    const uniforms = {
      "projector": {
        type: 'uniformMatrix4fv',
        value: projectionMatrix
      },
      "model_transformer": {
        type: 'uniformMatrix3fv',
        value: rotationMatrix3x3
      },

    }
    //RenderUtils.clear(main_gl)
    const main_shader_program = RenderUtils.build_program(main_gl, VS_SOURCE, FS_SOURCE, true,
      texture_canvas.width, texture_canvas.height);
    if (document.getElementById('model').checked) {
      RenderUtils.draw_model(main_gl, main_shader_program, uniforms,
        this.model)
      RenderUtils.unbind_data(main_gl)
    }
    const mirror_shader_program = RenderUtils.build_program(main_gl, VS_SOURCE, FS_SOURCE_MIRRORS, false,
      texture_canvas.width, texture_canvas.height);

    if (this.model.mirrors) {
      if (document.getElementById('all-mirrors').checked) {
        RenderUtils.draw_model(main_gl, mirror_shader_program, uniforms,
          {
            "vertices": this.model.mirrors,
            "normals": this.model.mirror_normals
          })
      } else if (document.getElementById('generating-mirrors').checked) {
        RenderUtils.draw_model(main_gl, mirror_shader_program, uniforms,
          {
            "vertices": this.model.mirrors,
            "normals": this.model.mirror_normals
          },
          450)
      }
    }

  };
  spin_and_draw() {
    if (typeof (this.spinning_speed) === 'number') {
      this.alpha = this.alpha + this.spinning_speed;
    }
    if (this.is_spinning && this.spinning_speed > 0) {
      this.is_dirty = true;
    }
  }
}

