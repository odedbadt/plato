import * as Glsl from './glsl'
import * as webgl_utils from './webgl_utils'
import { WebglRenderer } from './webgl_renderer'
import { OVERLAY_VERTICES, OVERLAY_TEXTURE_COORDS } from './geometry_data'
import { parse_RGBA, hsl_to_rgb } from '@oded/tsutils/color';
import { floodfill as _floodfill } from '@oded/tsutils/canvas';

import { createApp, h } from 'vue';
import * as glMatrix from 'gl-matrix'
export class App {
  prefered_model_name: string;
  model: any;
  spinning_speed: number;
  alpha: number;
  pen_color: string;
  pen_radius: number;
  dpr: number;
  is_spinning: boolean;
  cache: Storage;
  model_names: string[] | null = null;
  spinner_model: any = null;
  is_dirty: boolean = false;
  spinning_interval: ReturnType<typeof setInterval> | null = null;
  interval_id: ReturnType<typeof setInterval> | null = null;
  path: Path2D | null = null;
  mirror_path: Path2D | null = null;
  overlay_transparency: number = 0.9;
  overlay_transparency_decay_factor: number = 0.6;
  overlay_countdown: number = 50;
  prev_coords: number[] | null = null;
  prev_mirror_coords: number[] | null = null;
  texture_canvas: HTMLCanvasElement | null = null;
  renderer: WebglRenderer | null = null;

  constructor(prefered_model_name: string, spinning_speed = 0, pen_color: string | null = null, pen_radius: number | null = null) {
    this.prefered_model_name = prefered_model_name;
    this.model = null;
    this.spinning_speed = 0;
    this.alpha = 0;
    this.pen_color = pen_color || 'green';
    this.pen_radius = pen_radius || 5;
    this.dpr = window.devicePixelRatio;
    this.set_spinning_speed(.035);
    this.is_spinning = true;
    this.cache = localStorage;
  }
  construct_url_for_name(model_name: string): string {
    return `static/models/${model_name}.json`
  }
  warmup_cache(model_names: string[]) {
    const _this = this;
    Array.from(model_names).forEach((model_name: string) => {
      _this.load_model(_this.construct_url_for_name(model_name), (model: any) => {
        this.cache.setItem(model_name, JSON.stringify(model))
      })
    })
  }
  load_spinner_model() {
    const _this = this;
    this.load_model(this.construct_url_for_name('spinner'), (model: any) => {
      _this.spinner_model = model;
    });
  }
  init() {
    const _this = this;
    this.init_canvas_sizes();

    // Initialize WebGL renderer with cached shader programs
    const main_canvas = document.getElementById("mainCanvas") as HTMLCanvasElement;
    const texture_canvas = document.getElementById("textureCanvas") as HTMLCanvasElement;
    if (main_canvas && texture_canvas) {
      this.renderer = new WebglRenderer(main_canvas, texture_canvas);
    }

    this.clear();
    const spinBtn = document.getElementById('spin-toggle');
    spinBtn?.addEventListener('click', () => {
      this.is_spinning = !this.is_spinning;
      if (spinBtn) spinBtn.textContent = this.is_spinning ? '⏸' : '▶';
    });
    this.init_palette();
    this.init_texture_sketcher();
    this.init_overlay_opacity_throttle();
    this.init_actions();
    const model_entries: { name: string }[] = [];
    let prefered_model_name_there = false;
    this.load_model_names((model_names: string[]) => {
      this.model_names = model_names;
      this.cache.setItem('all_model_names', JSON.stringify(model_names));
      for (const model_name of model_names) {
        model_entries.push({ name: model_name });
        if (model_name == this.prefered_model_name) {
          prefered_model_name_there = true
        }
      }
      const first_model = prefered_model_name_there ?
        this.prefered_model_name :
        model_names[0]

      // Warmup cache
      _this.warmup_cache(model_names);
      _this.load_spinner_model();

      // Create the Vue app
      const app = createApp({
        data() {
          return {
            model_entries
          };
        },
        render() {
          return h('select',
            {
              name: 'Models',
              id: 'model-select',
              value: first_model, // Bind the value of the select box
              onInput: (event: Event) => (this as any).selectedModel = (event.target as HTMLSelectElement).value
            },
            this.model_entries.map((model_entry: { name: string }) =>
              h('option', {
                id: 'model-option', // Unique ID for options (optional)
                class: 'model-select',
                key: model_entry.name,
                value: model_entry.name
              }, model_entry.name)
            )
          );
        }

      });
      app.mount('#model-select-container');
      const model_select_element = document.getElementById('model-select') as HTMLSelectElement;
      model_select_element?.addEventListener('change', () => {
        this.load_and_set_model(model_select_element.value, () => { });
      });
      this.load_and_set_model(first_model, () => {

        const clear_btn = document.getElementById('clear-canvas-button');
        clear_btn?.addEventListener('click', () => _this.clear());
        // const cache_clear_btn = document.getElementById('clear-cache');
        // cache_clear_btn.addEventListener('click', () => localStorage.clear());
        for (const id of ['model', 'all-mirrors', 'no-mirrors', 'generating-mirrors']) {
          document.getElementById(id)?.addEventListener('change', () => { _this.is_dirty = true; })
        }
        _this.is_dirty = true;
        _this.init_animation_loop();
      });


    })
  }
  init_animation_loop() {
    const _this = this
    let last_time: number | null = null;
    const animate = (timestamp: number) => {
      if (last_time !== null && _this.is_spinning) {
        const dt = timestamp - last_time;
        _this.alpha += _this.spinning_speed * (dt / 100);
        _this.is_dirty = true;
      }
      last_time = timestamp;
      if (_this.model) {
        _this.draw_model()
      }
      requestAnimationFrame(animate)
    }
    requestAnimationFrame(animate)
  }
  load_model(model_url: string, callback: (model: any) => void) {
    const cached = this.cache.getItem(model_url);
    if (cached) {
      callback(JSON.parse(cached));
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
  load_model_names(callback: (model_names: string[]) => void) {
    const cache_key = 'model_list';
    const cached = this.cache.getItem(cache_key);
    if (cached) {
      callback(JSON.parse(cached));
      return
    }
    fetch(`static/models/models.txt#'${Date.now()}`)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.text();
      })
      .then(data => {
        const model_names = data.split(',');
        this.cache.setItem(cache_key, JSON.stringify(model_names))
        callback(model_names);
      })
      .catch(error => {
        console.error('Error fetching data:', error); // Handle errors
      });
  }

  load_and_set_model(model_name: string, ready_callback: () => void) {
    if (this.interval_id) {
      window.clearInterval(this.interval_id);
    }
    const shape_name_element = document.getElementById('shape-name');
    if (shape_name_element) {
      shape_name_element.innerHTML = 'Loading...';
    }
    if (this.spinner_model) {
      this.set_model(this.spinner_model);
    }
    //this.set_spinning_speed(.035);
    const _this = this
    this.load_model(this.construct_url_for_name(model_name),
      (model: any) => {
        _this.cache.setItem(model_name, JSON.stringify(model));
        _this.set_model(model)
        ready_callback()
      })
  }
  set_spinning_speed(spinning_speed: number) {
    this.spinning_speed = spinning_speed || 0
    this.is_spinning = this.spinning_speed > 0
    //this.spin_and_draw();
  }
  set_model(model: any) {
    this.model = model;
    this.path = null;
    this.mirror_path = null;

    this.is_dirty = true;
  }
  init_and_draw() {
    const main_canvas = document.getElementById("mainCanvas") as HTMLCanvasElement;
    this.init_canvas_sizes();

    this.init_palette();
    this.init_texture_sketcher();
    this.init_actions();
    this.is_dirty = true
    const _this = this;
    main_canvas?.addEventListener("click", () => {
      _this.is_spinning = !_this.is_spinning
    })
  }
  reset_opacity_to_opaque() {
    this.overlay_transparency = 0.9
    this.overlay_transparency_decay_factor = 0.6
    this.overlay_countdown = 50

  }
  init_overlay_opacity_throttle() {
    this.reset_opacity_to_opaque()
    this.overlay_transparency = 0.9
    this.overlay_countdown = 1000
    setInterval(() => {
      if (this.overlay_countdown > 0) {
        this.overlay_countdown = this.overlay_countdown - 10
      } else {
        this.overlay_transparency = this.overlay_transparency *
          this.overlay_transparency_decay_factor
        this.is_dirty = true;
      }
    }, 100)



  }
  init_canvas_sizes() {
    const dpr = this.dpr;
    const _this = this;
    const set_size = () => {
      const main_canvas_element = document.getElementById('mainCanvas') as HTMLCanvasElement;
      if (!main_canvas_element) return;
      const main_rect = main_canvas_element.getBoundingClientRect();
      main_canvas_element.width = main_rect.width * dpr;
      main_canvas_element.height = main_rect.height * dpr;
      this.is_dirty = true

      const texture_canvas_element = document.getElementById('textureCanvas') as HTMLCanvasElement;
      if (!texture_canvas_element) return;
      const texture_rect = texture_canvas_element.getBoundingClientRect();
      const texture_canvas_context = texture_canvas_element.getContext('2d', { 'willReadFrequently': true });
      const offscreen_canvas_element = document.createElement('canvas');
      offscreen_canvas_element.width = texture_rect.width * dpr;
      offscreen_canvas_element.height = texture_rect.height * dpr;
      const offscreen_context = offscreen_canvas_element.getContext('2d', { 'willReadFrequently': true });
      offscreen_context?.drawImage(texture_canvas_element, 0, 0,
        offscreen_canvas_element.width,
        offscreen_canvas_element.height)
      texture_canvas_element.width = texture_rect.width * dpr;
      texture_canvas_element.height = texture_rect.height * dpr;
      texture_canvas_context?.drawImage(offscreen_canvas_element, 0, 0,
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
    const color_divs = document.getElementsByClassName('color') as HTMLCollectionOf<HTMLElement>;
    const controlsPanel = document.getElementById('controls-panel');
    for (let color_div of color_divs) {
      color_div.onclick = () => {
        const color = getComputedStyle(color_div).backgroundColor;
        this.pen_color = color;
        controlsPanel?.classList.add('hidden');
      }
    }

    // Color picker
    const colorPicker = document.getElementById('color-picker') as HTMLInputElement;
    if (colorPicker) {
      colorPicker.addEventListener('change', () => {
        this.pen_color = colorPicker.value;
        controlsPanel?.classList.add('hidden');
      });
    }
  }
  init_actions() {
    const pen_size_divs = document.getElementsByClassName('pen-size') as HTMLCollectionOf<HTMLElement>;
    for (let pen_size_div of pen_size_divs) {
      pen_size_div.onclick = () => {
        const classes = pen_size_div.classList;
        for (let class_name of classes) {
          const m = class_name.match(/pen-size-(\d+)/);
          if (m) {
            const pen_size = Number(m[1]);
            console.log(pen_size)
            this.pen_radius = pen_size;
          }
        }
      }
    }
    // TODO: fix floodfill later
    const floodfill_div = document.getElementById('floodfill')
    floodfill_div?.addEventListener('click', (event) => {
      const texture_canvas_element = document.getElementById('textureCanvas') as HTMLCanvasElement;
      if (!texture_canvas_element) return;
      const texture_canvas_context = texture_canvas_element.getContext('2d', { 'willReadFrequently': true });
      if (!texture_canvas_context) return;
      const coords = this.pointer_event_to_coordinates(event as PointerEvent);
      const w = texture_canvas_element.width;
      const h = texture_canvas_element.height;
      const replaced_color = texture_canvas_context.getImageData(coords[0], coords[1], 1, 1).data;
      const parsed_fore_color = parse_RGBA(this.pen_color);
      _floodfill(texture_canvas_context, texture_canvas_context, replaced_color, parsed_fore_color, coords[0], coords[1], w, h);
    })
  }
  // const pen_size = pen_size_div).backgroundpen_size;
  // console.log(pen_size)
  // this.pen_pen_size = pen_size;


  draw_pen_selector() {
    const pen_canvas = document.getElementById("penCanvas") as HTMLCanvasElement;
    if (!pen_canvas) return;
    const pen_context = pen_canvas.getContext('2d', { willReadFrequently: true });
    if (!pen_context) return;
    const pen_canvas_rect = pen_canvas.getBoundingClientRect();
    const width = pen_canvas_rect.width * this.dpr;
    const height = pen_canvas_rect.height * this.dpr;

    (pen_context as any).clearColor = 'black'
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
    const pen_canvas = document.getElementById("penCanvas") as HTMLCanvasElement;
    if (!pen_canvas) return;
    const pen_canvas_rect = pen_canvas.getBoundingClientRect();
    const dpr = this.dpr;
    pen_canvas.width = pen_canvas_rect.width * dpr;
    pen_canvas.height = pen_canvas_rect.height * dpr;
    this.draw_pen_selector();
    const slope = pen_canvas_rect.width / 2 / pen_canvas_rect.height;
    const _this = this;
    pen_canvas.addEventListener("pointermove", (event) => {
      if (event.buttons) {
        const pen_canvas_y = event.offsetY;
        this.pen_radius = pen_canvas_y * slope / 2;
        _this.draw_pen_selector()
      }
    });
  }
  clear() {
    const texture_canvas = document.getElementById("textureCanvas") as HTMLCanvasElement;
    if (!texture_canvas) return;
    const texture_context = texture_canvas.getContext('2d', { willReadFrequently: true });
    if (!texture_context) return;
    texture_context.clearRect(0, 0,
      texture_canvas.width, texture_canvas.height);
    this.is_dirty = true;
    this.renderer?.mark_texture_dirty();
  }
  pointer_event_to_coordinates = (event: PointerEvent): [number, number] => {
    const canvas_x = event.offsetX;
    const canvas_y = event.offsetY;
    return [canvas_x * this.dpr, canvas_y * this.dpr];
  }
  init_texture_sketcher() {
    const texture_canvas = document.getElementById("textureCanvas") as HTMLCanvasElement;
    const model_canvas = document.getElementById("mainCanvas") as HTMLCanvasElement;
    if (!texture_canvas || !model_canvas) return;
    const texture_context = texture_canvas.getContext('2d', { willReadFrequently: true });
    if (!texture_context) return;
    this.clear();

    const w = texture_canvas.width;
    const h = texture_canvas.height;
    const dpr = this.dpr;
    const pointer_event_to_coordinates = (event: PointerEvent): [number, number] => {
      const canvas_x = event.offsetX;
      const canvas_y = event.offsetY;
      return [canvas_x * dpr, canvas_y * dpr];
    }
    const mirror_coordinates = (coords: [number, number]): [number, number] => {
      return [w - coords[1], h - coords[0]]
    }
    const dist2 = (v1: number[], v2: number[]): number => {
      const mn = [v1[0] - v2[0], v1[1] - v2[1]];
      return mn[0] * mn[0] + mn[1] * mn[1];
    }
    const _this = this;

    model_canvas.addEventListener("pointerdown", (event: PointerEvent) => {
      this.overlay_transparency = 0.9
      this.overlay_countdown = 500
      this.path = new Path2D();
      this.mirror_path = new Path2D();
      texture_context.strokeStyle = 'black'
      texture_context.fillStyle = this.pen_color;
      texture_context.lineWidth = 1;
      const coords = this.pointer_event_to_coordinates(event);
      this.prev_coords = [coords[0], coords[1]]
      const mirror_coords = mirror_coordinates(coords);

      texture_context.beginPath();
      //texture_context.ellipse(coords[0], coords[1], this.pen_radius, this.pen_radius, 0, 0, Math.PI * 2)
      texture_context.fill();
      texture_context.beginPath();
      //texture_context.ellipse(mirror_coords[0], mirror_coords[1], this.pen_radius, this.pen_radius, 0, 0, Math.PI * 2)
      texture_context.fill();
      texture_context.beginPath();

      this.path.moveTo(coords[0], coords[1])
      this.mirror_path.moveTo(mirror_coords[0], mirror_coords[1])
    })
    model_canvas.addEventListener("pointerup", (event) => {
      event.preventDefault();
      if (this.path && this.mirror_path) {
        texture_context.lineWidth = this.pen_radius;
        texture_context.beginPath();
        texture_context.stroke(this.path);
        this.path = null;
        texture_context.beginPath();
        texture_context.stroke(this.mirror_path);
        this.mirror_path = null;
        this.renderer?.mark_texture_dirty();
      }
      this.prev_coords = this.pointer_event_to_coordinates(event);
    })
    model_canvas.addEventListener("pointermove", (event) => {
      event.preventDefault();
      const coords = this.pointer_event_to_coordinates(event);
      const mirror_coords = mirror_coordinates(coords);
      if (event.buttons) {
        this.reset_opacity_to_opaque()
        if (!!(this.prev_coords && this.path && this.mirror_path)) {
          if (dist2(coords, this.prev_coords) * dpr * dpr > 10) {
            this.path.lineTo(coords[0], coords[1]);
            this.mirror_path.lineTo(mirror_coords[0], mirror_coords[1]);
            texture_context.strokeStyle = this.pen_color;
            texture_context.lineWidth = this.pen_radius * 2;
            texture_context.stroke(this.path)
            texture_context.stroke(this.mirror_path)
          } else {
            this.path.moveTo(coords[0], coords[1]);
            this.mirror_path.moveTo(mirror_coords[0], mirror_coords[1]);

          }
        }
        this.prev_coords = [coords[0], coords[1]];
        this.prev_mirror_coords = [mirror_coords[0], mirror_coords[1]];

        texture_context.fillStyle = this.pen_color;
        texture_context.beginPath();
        texture_context.ellipse(coords[0], coords[1], this.pen_radius, this.pen_radius, 0, 0, Math.PI * 2)
        //        texture_context.ellipse(coords[0], coords[1], 30, 30, 0, 0, Math.PI * 2)
        texture_context.fill();
        texture_context.lineWidth = 0;
        texture_context.beginPath();
        texture_context.ellipse(mirror_coords[0], mirror_coords[1], this.pen_radius, this.pen_radius, 0, 0, Math.PI * 2)
        texture_context.fill();
        texture_context.beginPath();
        texture_context.lineWidth = this.pen_radius;
        this.is_dirty = true;
        this.renderer?.mark_texture_dirty();
      }

    })

  }
  draw_model() {
    if (!this.is_dirty || !this.renderer) {
      return;
    }
    this.is_dirty = false;

    // Refresh texture from canvas
    this.renderer.refresh_texture();

    // Compute uniforms
    const uniforms = webgl_utils.matrix_uniforms(this.alpha);

    // Begin frame
    this.renderer.begin_frame();

    // Draw main model
    const modelCheckbox = document.getElementById('model') as HTMLInputElement;
    if (modelCheckbox?.checked && this.model) {
      this.renderer.draw_model(this.model, uniforms);
    }

    // Draw mirrors
    const allMirrorsCheckbox = document.getElementById('all-mirrors') as HTMLInputElement;
    const genMirrorsCheckbox = document.getElementById('generating-mirrors') as HTMLInputElement;
    if ((allMirrorsCheckbox?.checked || genMirrorsCheckbox?.checked) && this.model?.mirrors) {
      this.renderer.draw_mirrors({
        vertices: this.model.mirrors,
        normals: this.model.mirror_normals
      }, uniforms);
    }

    // Draw overlay
    this.renderer.draw_overlay({
      vertices: OVERLAY_VERTICES,
      texture: OVERLAY_TEXTURE_COORDS
    }, {
      "uOpacity": { type: "uniform1f", value: this.overlay_transparency }
    });

    // End frame
    this.renderer.end_frame();
  }
  spin_and_draw() {
    if (typeof (this.spinning_speed) === 'number') {
      this.alpha = this.alpha + this.spinning_speed;
    }
    if (this.is_spinning && this.spinning_speed > 0) {
      this.is_dirty = true;
    }
  }
}


localStorage.clear()
window.addEventListener('load', () => {
  const app = new App('stellated_dodecahedron')
  app.init();
});

