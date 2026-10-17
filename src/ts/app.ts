import * as Glsl from './glsl'
import * as webgl_utils from './webgl_utils'
import { WebglRenderer, WireframeOptions, DEFAULT_WIREFRAME_OPTIONS } from './webgl_renderer'
import {
  ModelSpec, SymmetryFamily, Vec3, corner_orders, family_label,
  generate_model, generate_model_from_spec, get_model_spec, stellation_factor,
  SYMMETRY_FAMILIES
} from './symmetry'
function parse_RGBA(color: string): [number, number, number, number] {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const data = ctx.getImageData(0, 0, 1, 1).data;
  return [data[0], data[1], data[2], data[3]];
}

function hsl_to_rgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function _floodfill(
  read_ctx: CanvasRenderingContext2D,
  write_ctx: CanvasRenderingContext2D,
  replaced_color: Uint8ClampedArray,
  new_color: [number, number, number, number],
  x: number, y: number, w: number, h: number
): void {
  const image_data = read_ctx.getImageData(0, 0, w, h);
  const data = image_data.data;
  const [tr, tg, tb, ta] = replaced_color;
  const [nr, ng, nb, na] = new_color;
  if (tr === nr && tg === ng && tb === nb && ta === na) return;
  const visited = new Uint8Array(w * h);
  const stack: number[] = [];

  const enqueue = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= w || py >= h) return;
    const idx = py * w + px;
    if (!visited[idx]) stack.push(idx);
  };

  enqueue(Math.round(x), Math.round(y));

  while (stack.length > 0) {
    const idx = stack.pop()!;
    if (visited[idx]) continue;
    visited[idx] = 1;
    const pixel_offset = idx * 4;
    if (data[pixel_offset] !== tr || data[pixel_offset + 1] !== tg ||
      data[pixel_offset + 2] !== tb || data[pixel_offset + 3] !== ta) continue;
    data[pixel_offset] = nr; data[pixel_offset + 1] = ng;
    data[pixel_offset + 2] = nb; data[pixel_offset + 3] = na;
    const px = idx % w, py = Math.floor(idx / w);

    enqueue(px - 1, py);
    enqueue(px + 1, py);
    enqueue(px, py - 1);
    enqueue(px, py + 1);
  }

  write_ctx.putImageData(image_data, 0, 0);
}

import * as glMatrix from 'gl-matrix'

// Maps a 2D point in [-1,1] onto the surface of a unit hemisphere (arcball projection)
function project_to_sphere(x: number, y: number): glMatrix.vec3 {
  const r2 = x * x + y * y;
  if (r2 <= 1.0) {
    return glMatrix.vec3.fromValues(x, y, Math.sqrt(1.0 - r2));
  }
  const r = Math.sqrt(r2);
  return glMatrix.vec3.fromValues(x / r, y / r, 0);
}

// Shape controls, by the kind of event they report changes with.
const SHAPE_SLIDERS = ['shape-stellation', 'shape-size', 'shape-mirror-size'];
const SHAPE_TOGGLES = ['shape-dual', 'shape-rhombic', 'shape-seed-on'];

// Where each corner of the fundamental triangle sits on the seed pad, as
// fractions of its box. Corner k of the triangle is PAD_CORNERS[k].
const PAD_CORNERS: Array<[number, number]> = [[0.15, 0.80], [0.85, 0.80], [0.50, 0.17]];
const DEFAULT_SEED: Vec3 = [1, 1, 1];   // the middle: the omnitruncated solid

// Barycentric weights of a point on the pad. Clamping the negatives away and
// renormalising pins a drag that leaves the triangle to the nearest edge,
// which is where the truncations live — a useful place to land rather than
// somewhere to be stopped from reaching.
function pad_to_barycentric(x: number, y: number): Vec3 {
  const [[x0, y0], [x1, y1], [x2, y2]] = PAD_CORNERS;
  const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  const raw: Vec3 = [
    ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / d,
    ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / d,
    0
  ];
  raw[2] = 1 - raw[0] - raw[1];
  const clamped: Vec3 = [Math.max(raw[0], 0), Math.max(raw[1], 0), Math.max(raw[2], 0)];
  const sum = clamped[0] + clamped[1] + clamped[2] || 1;
  return [clamped[0] / sum, clamped[1] / sum, clamped[2] / sum];
}

function barycentric_to_pad(seed: Vec3): [number, number] {
  const sum = seed[0] + seed[1] + seed[2] || 1;
  let x = 0, y = 0;
  for (let k = 0; k < 3; k++) {
    x += PAD_CORNERS[k][0] * seed[k] / sum;
    y += PAD_CORNERS[k][1] * seed[k] / sum;
  }
  return [x, y];
}

function input_of(id: string): HTMLInputElement | null {
  return document.getElementById(id) as HTMLInputElement | null;
}

function input_value(id: string, fallback: number): number {
  const parsed = parseFloat(input_of(id)?.value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

function input_checked(id: string): boolean {
  return !!input_of(id)?.checked;
}

function set_input_value(id: string, value: number) {
  const input = input_of(id);
  if (input) input.value = String(value);
}

function set_input_checked(id: string, value: boolean) {
  const input = input_of(id);
  if (input) input.checked = value;
}

// Models used to be fetched and cached in localStorage. They are all generated
// now, so anything left under these keys is dead weight against a quota the
// app no longer uses at all — around 350KB of it in a browser that ran the old
// version. Swept once on startup; harmless after the first run.
function drop_stale_model_cache() {
  const stale = ['all_model_names', 'model_list',
    'cube', 'dodecahedron', 'dodecahedron_a', 'icosahedron', 'icosahedron_a',
    'octahedron', 'spinner', 'tetra_b',
    'random_colored_st_dodec', 'random_colored_st_octa',
    'sellated_dodecahedron', 'sellated_octahedron',
    'stellated_dodecahedron', 'stellated_octahedron'];
  for (const key of stale) {
    localStorage.removeItem(key);
    localStorage.removeItem(`static/models/${key}.json`);
  }
}

export class App {
  prefered_model_name: string;
  model: any;
  spinning_speed: number;
  rotation: glMatrix.quat;
  pen_color: string;
  pen_radius: number;
  dpr: number;
  is_spinning: boolean;
  model_names: string[] | null = null;
  spinner_model: any = null;
  is_dirty: boolean = false;
  spinning_interval: ReturnType<typeof setInterval> | null = null;
  interval_id: ReturnType<typeof setInterval> | null = null;
  path: Path2D | null = null;
  mirror_path: Path2D | null = null;
  prev_coords: [number, number] | null = null;
  active_tool: 'sketch' | 'fill' = 'sketch';
  prev_mirror_coords: number[] | null = null;
  texture_canvas: HTMLCanvasElement | null = null;
  renderer: WebglRenderer | null = null;
  // Which model `this.model` is, so the wireframe can ask the generator for
  // its edges instead of measuring them off the mesh.
  model_name: string | null = null;
  // The parameters `this.model` was generated from, as loaded (base_spec) and
  // as the shape controls currently have them (live_spec). Null for the legacy
  // JSON models, which have no generator to vary.
  base_spec: ModelSpec | null = null;
  live_spec: ModelSpec | null = null;
  // Barycentric position of the Wythoff seed on the fundamental triangle.
  seed: Vec3 = [...DEFAULT_SEED] as Vec3;
  // Multi-touch state
  active_pointers: Map<number, { x: number, y: number }> = new Map();
  rotating: boolean = false;

  constructor(prefered_model_name: string, spinning_speed = 0, pen_color: string | null = null, pen_radius: number | null = null) {
    this.prefered_model_name = prefered_model_name;
    this.model = null;
    this.spinning_speed = 0;
    this.rotation = glMatrix.quat.create();
    glMatrix.quat.rotateX(this.rotation, this.rotation, Math.PI / 3);
    this.pen_color = pen_color || 'green';
    this.pen_radius = pen_radius || 5;
    this.dpr = window.devicePixelRatio;
    this.spinning_speed = 0;
    this.is_spinning = false;
  }
  load_spinner_model() {
    this.spinner_model = generate_model('spinner');
  }
  init() {
    const _this = this;
    drop_stale_model_cache();
    this.init_canvas_sizes();

    // Initialize WebGL renderer with cached shader programs
    const main_canvas = document.getElementById("mainCanvas") as HTMLCanvasElement;
    const texture_canvas = document.getElementById("textureCanvas") as HTMLCanvasElement;
    if (main_canvas && texture_canvas) {
      this.renderer = new WebglRenderer(main_canvas, texture_canvas);
    }

    this.clear();
    this.init_palette();
    this.init_texture_sketcher();
    this.init_actions();
    {
      this.model_names = SYMMETRY_FAMILIES.slice();
      _this.load_spinner_model();

      const container = document.getElementById('model-select-container');
      const model_select_element = document.createElement('select');
      model_select_element.id = 'model-select';
      model_select_element.name = 'Symmetry';
      for (const family of SYMMETRY_FAMILIES) {
        const option = document.createElement('option');
        option.value = family;
        option.textContent = family_label(family);
        model_select_element.appendChild(option);
      }
      container?.appendChild(model_select_element);
      model_select_element.addEventListener('change', () => {
        this.set_symmetry(model_select_element.value as SymmetryFamily);
      });
      this.load_preset(this.prefered_model_name, () => {
        model_select_element.value = _this.base_spec?.family ?? SYMMETRY_FAMILIES[0];

        const clear_btn = document.getElementById('clear-canvas-button');
        clear_btn?.addEventListener('click', () => _this.clear());
        // const cache_clear_btn = document.getElementById('clear-cache');
        // cache_clear_btn.addEventListener('click', () => localStorage.clear());
        for (const id of ['model', 'all-mirrors', 'no-mirrors', 'generating-mirrors',
                          'wireframe', 'wireframe-mode', 'wf-hide-back']) {
          document.getElementById(id)?.addEventListener('change', () => { _this.is_dirty = true; })
        }
        for (const id of ['wf-weight']) {
          document.getElementById(id)?.addEventListener('input', () => { _this.is_dirty = true; })
        }
        _this.is_dirty = true;
        _this.init_animation_loop();
      });
    }
  }
  init_animation_loop() {
    const _this = this;
    const animate = () => {
      if (_this.model) {
        _this.draw_model()
      }
      requestAnimationFrame(animate)
    }
    requestAnimationFrame(animate)
  }
  // Loads one of the named presets in MODEL_SPECS, shape controls and all.
  // Only the opening view uses this now; the picker chooses a symmetry group
  // and leaves the shape alone.
  load_preset(model_name: string, ready_callback: () => void) {
    if (this.interval_id) {
      window.clearInterval(this.interval_id);
    }
    this.set_model(generate_model(model_name), model_name);
    this.base_spec = get_model_spec(model_name);
    this.live_spec = this.base_spec ? { ...this.base_spec } : null;
    this.sync_shape_controls();
    ready_callback();
  }

  // Swaps the reflection group under whatever the shape controls currently
  // say, so a stellation or a seed position carries from one symmetry to the
  // next instead of being reset by the change.
  set_symmetry(family: SymmetryFamily) {
    if (!this.base_spec) return;
    this.base_spec = { ...this.base_spec, family };
    this.model_name = family;
    this.regenerate_shape();
  }
  set_spinning_speed(spinning_speed: number) {
    this.spinning_speed = spinning_speed || 0
    this.is_spinning = this.spinning_speed > 0
    //this.spin_and_draw();
  }
  set_model(model: any, model_name: string | null = null) {
    this.model = model;
    this.model_name = model_name;
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
    // no-op: overlay removed
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
    floodfill_div?.addEventListener('click', () => {
      this.active_tool = this.active_tool === 'fill' ? 'sketch' : 'fill';
      const is_fill = this.active_tool === 'fill';
      floodfill_div.classList.toggle('active', is_fill);
      const model_canvas = document.getElementById('mainCanvas') as HTMLCanvasElement;
      if (model_canvas) model_canvas.style.cursor = is_fill ? 'cell' : 'crosshair';
      this.is_dirty = true;
    })

    // Floating clear button (outside controls panel)
    document.getElementById('clear-btn')?.addEventListener('click', () => this.clear());

    // Model picker open button
    document.getElementById('model-picker-btn')?.addEventListener('click', () => this.open_model_picker());

    // Floating wireframe toggle, mirroring the checkbox in the controls panel
    const wireframe_btn = document.getElementById('wireframe-btn');
    const wireframe_checkbox = document.getElementById('wireframe') as HTMLInputElement;
    const sync_wireframe_btn = () => {
      const on = !!wireframe_checkbox?.checked;
      wireframe_btn?.classList.toggle('active', on);
      // Ink on paper: the ground goes light while the wireframe is up.
      document.body.classList.toggle('paper', on);
      // The style, weight and hide-back controls do nothing while it is off.
      document.getElementById('wireframe-options')?.classList.toggle('off', !on);
    };
    wireframe_btn?.addEventListener('click', () => {
      if (!wireframe_checkbox) return;
      wireframe_checkbox.checked = !wireframe_checkbox.checked;
      sync_wireframe_btn();
      this.is_dirty = true;
    });
    wireframe_checkbox?.addEventListener('change', sync_wireframe_btn);
    sync_wireframe_btn();

    this.init_shape_controls();

    // Close modal when clicking the backdrop
    const overlay = document.getElementById('model-picker-overlay');
    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  }
  // const pen_size = pen_size_div).backgroundpen_size;
  // console.log(pen_size)
  // this.pen_pen_size = pen_size;



  async open_model_picker() {
    const overlay = document.getElementById('model-picker-overlay');
    const grid = document.getElementById('model-picker-grid');
    if (!overlay || !grid) return;
    overlay.classList.remove('hidden');

    // Rebuilt on every open: the cards show each symmetry carrying whatever
    // the shape controls currently say, so the grid is a preview of the swap
    // rather than a fixed catalogue.
    grid.innerHTML = '';
    const spec = this.live_spec ?? this.base_spec;
    if (!spec) return;

    // Single shared offscreen renderer reused for every thumbnail.
    const size = 128;
    const thumb_canvas = document.createElement('canvas');
    thumb_canvas.width = size; thumb_canvas.height = size;
    const thumb_tex = document.createElement('canvas');
    thumb_tex.width = 1; thumb_tex.height = 1;
    const thumb_renderer = new WebglRenderer(thumb_canvas, thumb_tex, true);

    const rot = glMatrix.quat.create();
    glMatrix.quat.rotateX(rot, rot, Math.PI / 4);
    glMatrix.quat.rotateY(rot, rot, Math.PI / 5);
    const uniforms = webgl_utils.matrix_uniforms(rot);

    for (const family of SYMMETRY_FAMILIES) {
      const model = generate_model_from_spec({ ...spec, family });

      thumb_renderer.begin_frame();
      thumb_renderer.draw_model(model, uniforms);
      thumb_renderer.end_frame();
      const url = thumb_canvas.toDataURL();

      const label = family_label(family);
      const card = document.createElement('div');
      card.className = 'model-thumb-card';
      const img = document.createElement('img');
      img.src = url;
      img.alt = label;
      card.appendChild(img);
      const caption = document.createElement('div');
      caption.className = 'model-thumb-label';
      caption.textContent = label;
      card.appendChild(caption);
      card.addEventListener('click', () => {
        this.set_symmetry(family);
        const select = document.getElementById('model-select') as HTMLSelectElement | null;
        if (select) select.value = family;
        overlay.classList.add('hidden');
      });
      grid.appendChild(card);
    }

    thumb_renderer.renderer.dispose();
  }

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
    texture_context.clearRect(0, 0, texture_canvas.width, texture_canvas.height);
    this.is_dirty = true;
    this.renderer?.mark_texture_dirty();
  }
  pointer_event_to_coordinates = (event: PointerEvent): [number, number] => {
    const canvas_x = event.offsetX;
    const canvas_y = event.offsetY;
    return [canvas_x * this.dpr, canvas_y * this.dpr];
  }
  // Returns texture-canvas pixel coordinates for the surface point under the pointer,
  // or null if the pointer is not over the model (or model has no UV data).
  pointer_event_to_texture_coords = (event: PointerEvent): [number, number] | null => {
    if (!this.model) return null;
    const texture_canvas = document.getElementById("textureCanvas") as HTMLCanvasElement;
    const model_canvas = document.getElementById("mainCanvas") as HTMLCanvasElement;
    if (!texture_canvas || !model_canvas) return null;
    const rect = model_canvas.getBoundingClientRect();
    return webgl_utils.pick_uv(
      event.offsetX, event.offsetY,
      rect.width, rect.height,
      texture_canvas.width, texture_canvas.height,
      this.model,
      this.rotation
    );
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
    const pointer_event_to_coordinates = (event: PointerEvent): [number, number] | null => {
      return this.pointer_event_to_texture_coords(event);
    }
    const mirror_coordinates = (coords: [number, number]): [number, number] => {
      return [w - coords[1], h - coords[0]]
    }
    const dist2 = (v1: number[], v2: number[]): number => {
      const mn = [v1[0] - v2[0], v1[1] - v2[1]];
      return mn[0] * mn[0] + mn[1] * mn[1];
    }

    // Prevent right-click context menu over the canvas at the document level
    document.addEventListener("contextmenu", (event) => {
      if (event.target === model_canvas) event.preventDefault();
    });
    model_canvas.addEventListener("mousedown", (event) => {
      if (event.button === 2) event.preventDefault();
    });

    const arcball_rotate = (from_x: number, from_y: number, to_x: number, to_y: number,
      rect: DOMRect) => {
      const scale = 2.0 / Math.min(rect.width, rect.height);
      const v_from = project_to_sphere(
        (from_x - rect.width / 2) * scale, -(from_y - rect.height / 2) * scale);
      const v_to = project_to_sphere(
        (to_x - rect.width / 2) * scale, -(to_y - rect.height / 2) * scale);
      const axis = glMatrix.vec3.cross(glMatrix.vec3.create(), v_from, v_to);
      const angle = Math.acos(Math.min(1.0, glMatrix.vec3.dot(v_from, v_to)));
      if (glMatrix.vec3.length(axis) > 1e-6) {
        glMatrix.vec3.normalize(axis, axis);
        const delta = glMatrix.quat.setAxisAngle(glMatrix.quat.create(), axis, angle);
        glMatrix.quat.multiply(this.rotation, delta, this.rotation);
        glMatrix.quat.normalize(this.rotation, this.rotation);
        this.is_dirty = true;
      }
    };

    const commit_stroke = () => {
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
      this.prev_coords = null;
    };

    model_canvas.addEventListener("pointerdown", (event: PointerEvent) => {
      model_canvas.setPointerCapture(event.pointerId);
      this.active_pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      // Desktop right-click: rotation handled in pointermove
      if (event.button === 2) { event.preventDefault(); return; }

      // Second finger arriving: switch to rotation, cancel any active stroke
      if (this.active_pointers.size >= 2) {
        this.rotating = true;
        this.path = null;
        this.mirror_path = null;
        this.prev_coords = null;
        return;
      }

      // Coming out of a rotation gesture: wait for a fresh single-touch
      if (this.rotating) return;

      const coords = pointer_event_to_coordinates(event);
      if (!coords) return;

      if (this.active_tool === 'fill') {
        const tw = texture_canvas.width;
        const th = texture_canvas.height;
        const replaced_color = texture_context.getImageData(coords[0], coords[1], 1, 1).data;
        const parsed_fore_color = parse_RGBA(this.pen_color);
        _floodfill(texture_context, texture_context, replaced_color, parsed_fore_color, coords[0], coords[1], tw, th);
        const mx = tw - 1 - coords[1];
        const my = th - 1 - coords[0];
        _floodfill(texture_context, texture_context, replaced_color, parsed_fore_color, mx, my, tw, th);
        this.renderer?.mark_texture_dirty();
        this.is_dirty = true;
        return;
      }

      this.path = new Path2D();
      this.mirror_path = new Path2D();
      texture_context.strokeStyle = 'black';
      texture_context.fillStyle = this.pen_color;
      texture_context.lineWidth = 1;
      this.prev_coords = [coords[0], coords[1]];
      const mirror_coords = mirror_coordinates(coords);
      this.path.moveTo(coords[0], coords[1]);
      this.mirror_path.moveTo(mirror_coords[0], mirror_coords[1]);
    });

    const on_pointer_end = (event: PointerEvent) => {
      this.active_pointers.delete(event.pointerId);
      if (this.active_pointers.size === 0) this.rotating = false;
      if (event.button === 2) return;
      commit_stroke();
    };
    model_canvas.addEventListener("pointerup", on_pointer_end);
    // pointercancel fires on iOS when the system interrupts (e.g. notification)
    model_canvas.addEventListener("pointercancel", (event: PointerEvent) => {
      this.active_pointers.delete(event.pointerId);
      if (this.active_pointers.size === 0) this.rotating = false;
      commit_stroke();
    });

    model_canvas.addEventListener("pointermove", (event) => {
      event.preventDefault();

      // Two-finger rotation (multi-touch)
      if (this.active_pointers.size >= 2 && this.active_pointers.has(event.pointerId)) {
        const rect = model_canvas.getBoundingClientRect();
        let sx = 0, sy = 0;
        for (const pt of this.active_pointers.values()) { sx += pt.x; sy += pt.y; }
        const n = this.active_pointers.size;
        const bx = sx / n - rect.left, by = sy / n - rect.top;
        this.active_pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        sx = 0; sy = 0;
        for (const pt of this.active_pointers.values()) { sx += pt.x; sy += pt.y; }
        const ax = sx / n - rect.left, ay = sy / n - rect.top;
        arcball_rotate(bx, by, ax, ay, rect);
        return;
      }

      // Update stored position for single pointer
      if (this.active_pointers.has(event.pointerId)) {
        this.active_pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      // Desktop right-click rotation (single pointer)
      if (event.buttons & 2) {
        const rect = model_canvas.getBoundingClientRect();
        const cx = event.clientX - rect.left;
        const cy = event.clientY - rect.top;
        arcball_rotate(cx - event.movementX, cy - event.movementY, cx, cy, rect);
        return;
      }

      // Block drawing if we're still coming out of a rotation gesture
      if (this.rotating) return;
      if (!(event.buttons & 1)) return;

      const coords = pointer_event_to_coordinates(event);
      if (!coords) return;
      const mirror_coords = mirror_coordinates(coords);

      if (this.prev_coords && this.path && this.mirror_path) {
        if (dist2(coords, this.prev_coords) > 4) {
          this.path.lineTo(coords[0], coords[1]);
          this.mirror_path.lineTo(mirror_coords[0], mirror_coords[1]);
          texture_context.strokeStyle = this.pen_color;
          texture_context.lineWidth = this.pen_radius * 2;
          texture_context.stroke(this.path);
          texture_context.stroke(this.mirror_path);
        } else {
          this.path.moveTo(coords[0], coords[1]);
          this.mirror_path.moveTo(mirror_coords[0], mirror_coords[1]);
        }
      }
      this.prev_coords = [coords[0], coords[1]];
      this.prev_mirror_coords = [mirror_coords[0], mirror_coords[1]];

      texture_context.fillStyle = this.pen_color;
      texture_context.beginPath();
      texture_context.ellipse(coords[0], coords[1], this.pen_radius, this.pen_radius, 0, 0, Math.PI * 2);
      texture_context.fill();
      texture_context.lineWidth = 0;
      texture_context.beginPath();
      texture_context.ellipse(mirror_coords[0], mirror_coords[1], this.pen_radius, this.pen_radius, 0, 0, Math.PI * 2);
      texture_context.fill();
      this.is_dirty = true;
      this.renderer?.mark_texture_dirty();
    });

  }
  // Translate the wireframe controls into renderer options. The panel exposes
  // a style, a single weight, and whether to hide what is round the back; the
  // rest of the doc's parameters keep their recommended values.
  // Shape controls. Everything here varies the fundamental triangle only, so
  // the reflection group is never re-enumerated and a drag regenerates the
  // whole solid in well under a frame.
  init_shape_controls() {
    const regenerate = () => this.regenerate_shape();
    for (const id of SHAPE_SLIDERS) {
      document.getElementById(id)?.addEventListener('input', regenerate);
    }
    for (const id of SHAPE_TOGGLES) {
      document.getElementById(id)?.addEventListener('change', regenerate);
    }
    document.getElementById('shape-reset')?.addEventListener('click', () => {
      this.sync_shape_controls();
      this.regenerate_shape();
    });
    this.init_seed_pad();
  }

  // The seed pad is the fundamental triangle drawn flat: dragging the dot
  // moves the point whose orbit under the group is the solid's vertex set.
  init_seed_pad() {
    const pad = document.getElementById('shape-seed-pad') as HTMLCanvasElement | null;
    if (!pad) return;
    const seed_from_event = (event: PointerEvent) => {
      const rect = pad.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.seed = pad_to_barycentric(
        (event.clientX - rect.left) / rect.width,
        (event.clientY - rect.top) / rect.height);
      this.draw_seed_pad();
      this.regenerate_shape();
    };
    pad.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      pad.setPointerCapture(event.pointerId);
      seed_from_event(event);
    });
    pad.addEventListener('pointermove', (event) => {
      if (event.buttons & 1) seed_from_event(event);
    });
  }

  draw_seed_pad() {
    const pad = document.getElementById('shape-seed-pad') as HTMLCanvasElement | null;
    if (!pad || !this.base_spec) return;
    const rect = pad.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pad.width = Math.round(rect.width * this.dpr);
    pad.height = Math.round(rect.height * this.dpr);
    const context = pad.getContext('2d');
    if (!context) return;
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);

    const at = (k: number): [number, number] =>
      [PAD_CORNERS[k][0] * rect.width, PAD_CORNERS[k][1] * rect.height];

    context.beginPath();
    context.moveTo(...at(0));
    context.lineTo(...at(1));
    context.lineTo(...at(2));
    context.closePath();
    context.fillStyle = 'rgba(255,255,255,0.06)';
    context.fill();
    context.strokeStyle = '#777';
    context.lineWidth = 1;
    context.stroke();

    // Each corner is a rotation axis; its order says which regular solid the
    // seed collapses onto there.
    const orders = corner_orders(this.base_spec.family);
    context.font = '11px monospace';
    context.fillStyle = '#aaa';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const centre: [number, number] = [rect.width / 2, rect.height / 2];
    for (let k = 0; k < 3; k++) {
      const [cx, cy] = at(k);
      const dx = cx - centre[0], dy = cy - centre[1];
      const length = Math.hypot(dx, dy) || 1;
      context.fillText(`${orders[k]}`, cx + 11 * dx / length, cy + 11 * dy / length);
    }

    const [sx, sy] = barycentric_to_pad(this.seed);
    context.beginPath();
    context.arc(sx * rect.width, sy * rect.height, 5, 0, Math.PI * 2);
    context.fillStyle = '#448AFF';
    context.fill();
    context.strokeStyle = '#fff';
    context.lineWidth = 1.5;
    context.stroke();
  }

  // Put the controls back to what the loaded model asks for, and hide them
  // entirely for the legacy models there is no generator behind.
  sync_shape_controls() {
    const spec = this.base_spec;
    const section = document.getElementById('shape-options');
    if (section) section.style.display = spec ? '' : 'none';
    if (!spec) return;
    set_input_value('shape-stellation', stellation_factor(spec));
    set_input_value('shape-size', spec.factor ?? 1);
    set_input_value('shape-mirror-size', spec.mirror_factor ?? 1);
    set_input_checked('shape-dual', !!spec.dual);
    set_input_checked('shape-rhombic', !!spec.rhombic);
    set_input_checked('shape-seed-on', !!spec.seed);
    this.seed = (spec.seed ?? [...DEFAULT_SEED]) as Vec3;
    this.sync_seed_mode();
  }

  // Seed mode and the classic controls are two descriptions of the same solid,
  // so the panel shows which one is live.
  sync_seed_mode() {
    const on = input_checked('shape-seed-on');
    document.getElementById('shape-options')?.classList.toggle('wythoff', on);
    if (on) this.draw_seed_pad();
  }

  regenerate_shape() {
    if (!this.base_spec) return;
    this.sync_seed_mode();
    const seed_mode = input_checked('shape-seed-on');
    const spec: ModelSpec = {
      ...this.base_spec,
      factor: input_value('shape-size', this.base_spec.factor ?? 1),
      mirror_factor: input_value('shape-mirror-size', this.base_spec.mirror_factor ?? 1),
      // Where the seed sits already says whether the solid is dual, truncated
      // or stellated-looking, so the classic knobs step aside in seed mode.
      ...(seed_mode ? { seed: this.seed } : {
        stellation: input_value('shape-stellation', stellation_factor(this.base_spec)),
        dual: input_checked('shape-dual'),
        rhombic: input_checked('shape-rhombic')
      }),
      // Nothing downstream of here needs the JSON models' rounding, and it
      // costs more than the sweep itself.
      round: false
    };
    this.live_spec = spec;
    // Keeps the drawing: every fundamental triangle carries the same UVs
    // whatever the geometry does, so the texture never has to be reset.
    this.set_model(generate_model_from_spec(spec), this.model_name);
  }

  wireframe_options(): WireframeOptions {
    const style = (document.getElementById('wireframe-mode') as HTMLSelectElement)?.value
      || 'depth-halo';
    const weight_input = document.getElementById('wf-weight') as HTMLInputElement;
    const parsed = weight_input ? parseFloat(weight_input.value) : NaN;
    // One knob scales the whole ink range, keeping the near:far ratio — and so
    // the strength of the depth cue — fixed while the drawing gets lighter or
    // heavier overall.
    const weight = Number.isFinite(parsed) ? parsed : 1;

    const halo = style === 'depth-halo';
    const halo_gain = 1.5;   // the doc's middle of the 1-2 range that reads best

    return {
      ...DEFAULT_WIREFRAME_OPTIONS,
      // Paper mode means the ground is always light, so the ink is always dark.
      color: [0.09, 0.10, 0.12],
      flat: style === 'uniform',
      halo,
      hide_back: !!(document.getElementById('wf-hide-back') as HTMLInputElement)?.checked,
      w_min: 0.25 * weight,
      w_max: 3.0 * weight,
      halo_gain: halo ? halo_gain : 0,
      halo_px: 0.5 + 10 * halo_gain,
    };
  }

  draw_model() {
    if (!this.is_dirty || !this.renderer) {
      return;
    }
    this.is_dirty = false;

    // Refresh texture from canvas
    this.renderer.refresh_texture();

    // Compute uniforms
    const uniforms = webgl_utils.matrix_uniforms(this.rotation);

    // Begin frame
    this.renderer.begin_frame();

    // Draw main model
    const modelCheckbox = document.getElementById('model') as HTMLInputElement;
    if (modelCheckbox?.checked && this.model) {
      this.renderer.draw_model(this.model, uniforms);
    }

    // Draw wireframe. After the model so solid faces hide the edges behind them,
    // before the mirrors so the mirror planes don't cull half the edges (the
    // halo prepass does leave faint hairlines on the planes in return).
    const wireframeCheckbox = document.getElementById('wireframe') as HTMLInputElement;
    if (wireframeCheckbox?.checked && this.model) {
      const wireframe_options = this.wireframe_options();
      // With the solid hidden, its depth alone still removes the back edges.
      if (wireframe_options.hide_back && !modelCheckbox?.checked) {
        this.renderer.draw_model_depth_only(this.model, uniforms);
      }
      this.renderer.draw_wireframe(
        this.model, uniforms, wireframe_options,
        this.live_spec ?? this.model_name ?? undefined);
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

    // End frame
    this.renderer.end_frame();
  }
  spin_and_draw() {
    if (this.is_spinning && this.spinning_speed > 0) {
      this.is_dirty = true;
    }
  }
}


