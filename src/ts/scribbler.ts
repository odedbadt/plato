// A pen that draws by itself: a random walk, hue turning as it goes, with the
// trail behind it desaturating, darkening and fading out.
//
// The walk lives in UV space rather than on the canvas, and inside the
// triangle u + v <= 1 — which is the part of the texture a surface actually
// samples (every fundamental triangle carries the UVs (0,0), (0,1), (1,0),
// and seed mode's barycentrics sum to 1). So one walk comes out on every copy
// of the fundamental domain at once, and a single wandering line reads as a
// scribble all over the solid, in step with its symmetry.
//
// That is also why this knows nothing about geometry. A solid, a tiling, a
// seed-mode truncation, a stellation being dragged — all the same walk, and a
// shape changing underneath it does not disturb it, because the UVs do not
// move when the vertices do.
//
// While it runs, the texture canvas is a *composite*: the drawing with the
// trail laid over it. The drawing itself is held in `backdrop`, and the pen is
// pointed there instead (App.ink_context()), so sketching while it runs works
// and is not wiped by the next frame. The trail is a performance rather than a
// deposit — stop() puts the drawing back exactly as it was.

export interface Mark {
  u: number;
  v: number;
  hue: number;
  t: number;   // when it was laid, in performance.now() ms
}

const LIFE_MS = 7000;     // how long a mark takes to fade out of existence
const HUE_RATE = 40;      // degrees of hue a second
const SPEED = 0.52;       // UV units a second
const WOBBLE = 8;         // kick given to the heading, rad/s^1.5
const TURN_TAU = 0.45;    // seconds the kick dies away over
const APPROACH = 0.06;    // how far off a mirror the walk starts squaring up
const STEER = 55;         // how hard it is turned to meet one square-on, /s
const MARGIN = 0.015;     // keeps the stroke's own width off the triangle's edges
const MAX_DT = 1 / 20;    // a backgrounded tab must not teleport the walk

export class Scribbler {
  canvas: HTMLCanvasElement;
  running = false;
  // The drawing, while the texture canvas is busy being the composite.
  backdrop: HTMLCanvasElement | null = null;
  trail: Mark[] = [];
  u = 0.2; v = 0.2;
  heading = 0; turn = 0;
  hue = 0;
  last_ms = 0;
  // What was painted last frame, in canvas pixels: the region the backdrop
  // has to be put back over before this frame's trail goes down. The walk
  // covers the whole triangle before long, so this only really saves the
  // first second or two — but it is four numbers.
  painted: [number, number, number, number] | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  private live(): CanvasRenderingContext2D | null {
    return this.canvas.getContext('2d', { willReadFrequently: true });
  }

  // Where the pen should write while this is running: the drawing, not the
  // composite. Null when it is not running, meaning "the texture canvas, as
  // always".
  ink_context(): CanvasRenderingContext2D | null {
    if (!this.running || !this.backdrop) return null;
    return this.backdrop.getContext('2d', { willReadFrequently: true });
  }

  toggle(): boolean {
    if (this.running) this.stop(); else this.start();
    return this.running;
  }

  start() {
    if (this.running) return;
    const { width, height } = this.canvas;
    if (!width || !height) return;
    this.backdrop = document.createElement('canvas');
    this.backdrop.width = width;
    this.backdrop.height = height;
    this.backdrop.getContext('2d', { willReadFrequently: true })
      ?.drawImage(this.canvas, 0, 0);
    this.trail = [];
    this.painted = null;
    this.u = MARGIN + Math.random() * 0.3;
    this.v = MARGIN + Math.random() * 0.3;
    this.heading = Math.random() * Math.PI * 2;
    this.turn = 0;
    this.hue = Math.random() * 360;
    this.last_ms = performance.now();
    this.running = true;
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    const context = this.live();
    if (context) {
      context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (this.backdrop) context.drawImage(this.backdrop, 0, 0);
    }
    this.backdrop = null;
    this.trail = [];
    this.painted = null;
  }

  // The clear button, while this is running: the drawing it is drawn over has
  // to go too, or the next frame would put it straight back.
  clear() {
    this.trail = [];
    this.painted = null;
    const context = this.ink_context();
    context?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // The texture canvas has just been rebuilt at the window's size, so the
  // backdrop follows it. Nothing is restored from this frame's box afterwards
  // — the whole canvas is the region that moved.
  resize() {
    if (!this.running || !this.backdrop) return;
    const { width, height } = this.canvas;
    if (!width || !height) return;
    const scaled = document.createElement('canvas');
    scaled.width = width;
    scaled.height = height;
    scaled.getContext('2d', { willReadFrequently: true })
      ?.drawImage(this.backdrop, 0, 0, width, height);
    this.backdrop = scaled;
    this.painted = [0, 0, width, height];
  }

  // Advance the walk and repaint the trail. `pen_radius` is the pen-size
  // buttons' own value, so the scribble is drawn with whatever pen is
  // selected rather than a weight of its own.
  step(now: number, pen_radius: number) {
    if (!this.running) return;
    const context = this.live();
    if (!context) return;
    const dt = Math.min(Math.max((now - this.last_ms) / 1000, 0), MAX_DT);
    this.last_ms = now;

    this.hue = (this.hue + HUE_RATE * dt) % 360;
    this.advance(dt);
    this.trail.push({ u: this.u, v: this.v, hue: this.hue, t: now });

    // The trail is in time order, so the dead marks are a prefix of it.
    let dead = 0;
    while (dead < this.trail.length && now - this.trail[dead].t > LIFE_MS) dead++;
    if (dead) this.trail.splice(0, dead);

    this.repaint(context, now, pen_radius);
  }

  // A damped random walk in the heading rather than in the position: a
  // Brownian point jitters in place, where a point with momentum and a
  // wandering heading draws curls and long runs, which is what a scribble is.
  // The kick scales as sqrt(dt) so the character of the walk does not depend
  // on the frame rate.
  private advance(dt: number) {
    this.turn += (Math.random() * 2 - 1) * WOBBLE * Math.sqrt(dt);
    this.turn *= Math.exp(-dt / TURN_TAU);
    // The wobble is held off while the walk is squaring up to a mirror, or it
    // would undo the aim on the last stride.
    const urgency = this.square_up(dt);
    this.heading += this.turn * dt * (1 - urgency);
    this.u += Math.cos(this.heading) * SPEED * dt;
    this.v += Math.sin(this.heading) * SPEED * dt;
    this.reflect();
  }

  // Turn the walk to meet the mirror it is approaching square-on, returning
  // how committed to that it currently is (0 out in the open, 1 on the line).
  //
  // This is what makes the trail look like it carries on into the next
  // triangle rather than bouncing off the edge of this one. The drawing is
  // the orbit of the walk under the group, so the curve always reaches an
  // edge in company with its own mirror image, and there is no third option:
  // either it is turned back or the picture stops being symmetric. What
  // changes is how the pair reads. At a shallow angle the two arms open into
  // a wide V, and the eye joins them and sees a bounce. Square-on, the mirror
  // image *is* the continuation — the line crosses the edge, and the arm that
  // comes back is a hair off it, so what you see on the far side is the walk
  // going on into the neighbouring triangle.
  //
  // Only while it is actually heading that way: a walk leaving a mirror must
  // not be steered back into it.
  private square_up(dt: number): number {
    const far = 1 - MARGIN;
    // Each side as [distance to it, the direction of leaving by it].
    const sides: Array<[number, number]> = [
      [this.u - MARGIN, Math.PI],
      [this.v - MARGIN, -Math.PI / 2],
      [(far - this.u - this.v) * Math.SQRT1_2, Math.PI / 4]
    ];
    let nearest = -1, distance = APPROACH;
    for (let i = 0; i < 3; i++) {
      if (sides[i][0] < distance) { distance = sides[i][0]; nearest = i; }
    }
    if (nearest < 0) return 0;
    const target = sides[nearest][1];
    if (Math.cos(this.heading - target) <= 0) return 0;
    const urgency = 1 - Math.max(distance, 0) / APPROACH;
    const turn = Math.atan2(Math.sin(target - this.heading),
                            Math.cos(target - this.heading));
    this.heading += turn * Math.min(1, STEER * urgency * dt);
    return urgency;
  }

  // The triangle's three sides, as a billiard: the walk is turned back rather
  // than stopped or wrapped, so it never piles up along an edge and never
  // steps off the sampled half of the canvas. Two reflections can be needed
  // in one step near a corner, hence the loop.
  private reflect() {
    const far = 1 - MARGIN;
    for (let i = 0; i < 4; i++) {
      if (this.u < MARGIN) {
        this.u = 2 * MARGIN - this.u;
        this.heading = Math.PI - this.heading;
      } else if (this.v < MARGIN) {
        this.v = 2 * MARGIN - this.v;
        this.heading = -this.heading;
      } else if (this.u + this.v > far) {
        // The hypotenuse, whose unit normal is (1,1)/sqrt(2): the point comes
        // back by the overshoot in both coordinates, and the direction
        // (dx, dy) reflects to (-dy, -dx).
        const over = this.u + this.v - far;
        this.u -= over;
        this.v -= over;
        const dx = Math.cos(this.heading), dy = Math.sin(this.heading);
        this.heading = Math.atan2(-dx, -dy);
      } else {
        return;
      }
    }
    // A safety net for the corners, where the loop above can run out.
    this.u = Math.min(Math.max(this.u, MARGIN), far);
    this.v = Math.min(Math.max(this.v, MARGIN), far - this.u);
  }

  // Put the backdrop back over last frame's trail, then draw this one.
  //
  // Each mark keeps the hue it was laid with, so the trail is a length of
  // moving rainbow; what age takes off it is saturation, lightness and alpha.
  // The alpha is not decoration: fading the lightness alone ends at black,
  // which disappears into the dark ground but leaves a grey ghost on paper,
  // and the trail has to vanish on both.
  private repaint(context: CanvasRenderingContext2D, now: number, pen_radius: number) {
    const w = this.canvas.width, h = this.canvas.height;
    const width = Math.max(1, pen_radius * 2.2);
    if (this.painted) {
      const [x, y, bw, bh] = this.painted;
      context.clearRect(x, y, bw, bh);
      if (this.backdrop) {
        context.drawImage(this.backdrop, x, y, bw, bh, x, y, bw, bh);
      }
    }
    if (this.trail.length === 0) {
      this.painted = null;
      return;
    }

    const save_alpha = context.globalAlpha;
    const save_cap = context.lineCap;
    const save_join = context.lineJoin;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let i = 1; i < this.trail.length; i++) {
      const from = this.trail[i - 1], to = this.trail[i];
      const life = Math.max(0, 1 - (now - to.t) / LIFE_MS);
      const saturation = (8 + 87 * life).toFixed(0);
      const lightness = (28 + 32 * life).toFixed(0);
      context.strokeStyle =
        `hsla(${to.hue.toFixed(0)}, ${saturation}%, ${lightness}%, ${Math.pow(life, 1.3).toFixed(3)})`;
      context.lineWidth = width * (0.45 + 0.55 * life);
      const ax = from.u * w, ay = from.v * h, bx = to.u * w, by = to.v * h;
      context.beginPath();
      context.moveTo(ax, ay);
      context.lineTo(bx, by);
      context.stroke();
      x0 = Math.min(x0, ax, bx); y0 = Math.min(y0, ay, by);
      x1 = Math.max(x1, ax, bx); y1 = Math.max(y1, ay, by);
    }
    // The head, so the thing doing the drawing is visible as a point and not
    // only as the line it leaves.
    const head = this.trail[this.trail.length - 1];
    const hx = head.u * w, hy = head.v * h, r = width * 0.75;
    context.fillStyle = `hsl(${head.hue.toFixed(0)}, 95%, 72%)`;
    context.beginPath();
    context.ellipse(hx, hy, r, r, 0, 0, Math.PI * 2);
    context.fill();
    x0 = Math.min(x0, hx - r); y0 = Math.min(y0, hy - r);
    x1 = Math.max(x1, hx + r); y1 = Math.max(y1, hy + r);
    context.globalAlpha = save_alpha;
    context.lineCap = save_cap;
    context.lineJoin = save_join;

    // Padded by the widest stroke, since the box above is of the centre lines.
    const pad = width + 2;
    const bx = Math.max(0, Math.floor(x0 - pad)), by = Math.max(0, Math.floor(y0 - pad));
    this.painted = [
      bx, by,
      Math.min(w, Math.ceil(x1 + pad)) - bx,
      Math.min(h, Math.ceil(y1 + pad)) - by
    ];
  }
}
