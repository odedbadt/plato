// The guided tour.
//
// A first visit lands on a dark page holding one solid and six unlabelled
// buttons. Nothing on it says that a stroke is painted into a fundamental
// triangle and comes back on all 120 copies of it, or that three numbers in a
// box decide whether you get a solid, a wallpaper or a Poincare disc. Those
// are the two ideas the whole app is made of, and neither is discoverable by
// poking at it. This walks through them.
//
// **A step is a deep link played in place.** `view` is a URL hash in exactly
// the codec `url_state.ts` reads, handed to the app through the same two
// halves a `hashchange` goes through. So a step costs a line of prose and a
// fragment, and nothing in this file knows what any control does or where its
// state lives. That is also why the tour cannot quietly drift out of step with
// the app: anything a shared link can reach, a step can reach the same way,
// and anything it cannot reach is not in the URL either.
//
// What is left over is the three things a link cannot say, because they are
// motions rather than states: a solid turning, a stroke being drawn, a knob
// moving on its own. Those are `demo`, and the app implements them.

// What the tour needs from the app. A narrow interface rather than `App`
// itself, so the dependency runs one way: `app.ts` imports this, and this
// imports nothing of it.
export interface TourHost {
  // Apply a URL hash as if it had just been pasted into the address bar.
  apply_view_hash(hash: string): void;
  // The motions. Each is interruptible — steps are entered forwards and
  // backwards, and a demo must not queue up behind the last one.
  tour_turn(): void;
  tour_stroke(): void;
  tour_stellation(): void;
  tour_seed(): void;
  tour_cancel_animation(): void;
  // Everything the tour disturbs, so it can put it all back on the way out.
  tour_capture(): TourSnapshot;
  tour_restore(snapshot: TourSnapshot): void;
}

export type TourSnapshot = {
  // The view, in the codec the address bar uses.
  hash: string,
  // The drawing, which is not in the URL and so has to travel separately.
  // A canvas rather than ImageData: the texture canvas is resized by the
  // ResizeObserver whenever the window moves, and drawImage rescales where
  // putImageData would refuse.
  texture: HTMLCanvasElement | null,
  panel_open: boolean,
};

export type TourStep = {
  title: string,
  body: string,
  // The state this step is about. Omitted means "leave whatever is there",
  // which is how consecutive steps about the same picture avoid resetting a
  // turn or a stroke the previous one just made.
  view?: string,
  // What to light up. A selector; if it matches several elements the ring
  // goes round all of them, which is how the three layer buttons get one
  // ring instead of three. Omitted means a plain dimmed page and a centred
  // card — for the steps that are about the app rather than a control.
  target?: string,
  demo?: 'turn' | 'stroke' | 'stellation' | 'seed',
};

// The script. Ordered so each step is the reason for the next: you turn it
// before you draw on it, you draw on it before the symmetry has anything to
// carry, and the symmetry is the group before it is the geometry.
export const TOUR_STEPS: TourStep[] = [
  {
    title: 'Turn it',
    body: 'Drag the solid to turn it. This is a stellated dodecahedron, and '
      + 'it was built by reflecting one triangle in three mirrors until the '
      + 'copies closed up — 120 of them here.',
    view: '',
    target: '#mainCanvas',
    demo: 'turn',
  },
  {
    title: 'Draw on it',
    body: 'Draw straight onto the surface. The mark goes into that one '
      + 'triangle, and every copy of the triangle carries the same patch of '
      + 'canvas — so one stroke paints all 120 at once. The pen works over '
      + 'the solid whatever else is or is not being shown.',
    target: '#mainCanvas',
    demo: 'stroke',
  },
  {
    title: 'Pens and colours',
    body: 'Sixteen swatches and a colour picker, three nib sizes, a flood '
      + 'fill and a clear. The button marked with three bars opens and '
      + 'closes this panel.',
    target: '#buttons',
  },
  {
    title: 'Change the symmetry',
    body: 'The grid draws every group with your current shape settings, so '
      + 'it previews the swap rather than listing a fixed catalogue of '
      + 'models.',
    target: '#model-picker-btn',
  },
  {
    title: 'Or type the angles',
    body: 'Three numbers: the mirrors meet at pi/x, pi/y and pi/z, and '
      + 'everything downstream follows from them. This is (4,3,2) — '
      + 'octahedral. Note that your drawing came with it.',
    view: 'g=4,3,2',
    target: '#symmetry-options',
  },
  {
    title: 'Reshape it',
    body: 'Stellation, size, dual and rhombic vary the fundamental triangle '
      + 'and never the group, so the whole solid regenerates in about a '
      + 'fifth of a millisecond and the sliders are live under a drag.',
    target: '#shape-options',
    demo: 'stellation',
  },
  {
    title: 'The seed point',
    body: 'One point in the fundamental triangle, whose orbit under the '
      + 'group is the vertex set. Corners give the regular solids, edges the '
      + 'truncations, the middle the omnitruncated one — the whole uniform '
      + 'family on one pad.',
    view: 'g=4,3,2&sd=1',
    target: '#shape-seed-pad',
    demo: 'seed',
  },
  {
    title: 'Three layers',
    body: 'The lit surface, the drawing on it and the edges switch on '
      + 'separately. Each has one of these buttons and a checkbox under '
      + 'Show, and the two stay in step whichever one you move.',
    view: 'g=4,3,2&w=1',
    target: '#model-btn, #texture-btn, #wireframe-btn',
  },
  {
    title: 'Edges alone',
    body: 'With the surface off there is nothing behind the lines but the '
      + 'page, so the page turns light and they read as ink on it. Weight, '
      + 'the depth cue and hiding the edges round the back are under '
      + 'Wireframe style.',
    view: 'g=4,3,2&m=0&w=1&wb=1',
    target: '#wireframe-options',
  },
  {
    title: 'Leave the sphere',
    body: 'Nothing said the triangle has to fit on a sphere. When '
      + '1/x + 1/y + 1/z comes to exactly 1 it tiles the flat plane instead: '
      + 'this is (6,3,2), the wallpaper group p6m. Dragging now walks you '
      + 'through the tiling rather than turning it.',
    view: 'g=6,3,2',
    target: '#symmetry-options',
  },
  {
    title: 'And the plane',
    body: 'Below 1 the triangle only fits in the hyperbolic plane, drawn '
      + 'here in the Poincare disc. You never chose a geometry: the sign of '
      + 'one determinant in those three numbers picks it, and the group here '
      + 'is infinite, so it is drawn out to a cutoff. Projection, depth and '
      + 'shading are in this panel; Recentre brings you home.',
    view: 'g=7,3,2',
    target: '#plane-options',
  },
  {
    title: 'Every picture is a link',
    body: 'The address bar holds the whole view — the group, the shape of '
      + 'it, where you are standing and what is drawn — so anything you make '
      + 'can be sent to someone. The drawing itself is not in it; a canvas '
      + 'does not fit in a URL. The ? button runs this again.',
  },
];

const SEEN_KEY = 'plato_tour_seen';

// How much room round the lit element, in CSS pixels.
const HOLE_PAD = 6;
// A card narrower than the panel, so there is somewhere for it to sit.
const CARD_MARGIN = 14;
// Below this the card docks to the bottom of the screen instead of beside
// the target — the panel goes full width there and leaves no room at a side.
const NARROW = 720;

class Tour {
  host: TourHost;
  index = 0;
  running = false;
  snapshot: TourSnapshot | null = null;
  private reposition = () => { this.update_docked(); this.place(); };

  // Below the threshold the card docks across the foot of the screen, where
  // the stylesheet owns its position — place() measures and places it only
  // in the other case. The body class is what the panel's extra scroll room
  // hangs off, and it is set here rather than in place() so that it is
  // already in effect when show() scrolls a target into view.
  private update_docked() {
    const docked = this.running && window.innerWidth < NARROW;
    document.body.classList.toggle('tour-docked', docked);
    this.el('tour-card')?.classList.toggle('docked', docked);
  }

  constructor(host: TourHost) {
    this.host = host;
  }

  private el<T extends HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    // Captured before the first step moves anything, restored by both ways
    // out, so a tour run halfway through and abandoned leaves no trace.
    this.snapshot = this.host.tour_capture();
    this.index = 0;
    // The app has been left wherever the user put it since the last run, so
    // the first step's view is always a change even when it is the one the
    // last run ended on.
    this.applied_from = null;
    this.el('tour-overlay')?.classList.remove('hidden');
    this.update_docked();
    window.addEventListener('resize', this.reposition);
    window.addEventListener('keydown', this.on_key);
    this.show();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.host.tour_cancel_animation();
    window.removeEventListener('resize', this.reposition);
    window.removeEventListener('keydown', this.on_key);
    this.el('tour-overlay')?.classList.add('hidden');
    this.update_docked();
    if (this.snapshot) this.host.tour_restore(this.snapshot);
    this.snapshot = null;
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ }
  }

  go(delta: number) {
    const next = this.index + delta;
    if (next < 0) return;
    if (next >= TOUR_STEPS.length) { this.stop(); return; }
    this.index = next;
    this.show();
  }

  private on_key = (event: KeyboardEvent) => {
    if (!this.running) return;
    if (event.key === 'Escape') { event.preventDefault(); this.stop(); }
    else if (event.key === 'ArrowRight' || event.key === 'Enter') {
      event.preventDefault(); this.go(1);
    } else if (event.key === 'ArrowLeft') { event.preventDefault(); this.go(-1); }
  };

  // Puts the app into the state this step is about.
  //
  // A step without a `view` means "whatever is already here", which going
  // forwards is the state the last step that named one left — so the view in
  // force belongs to a step at or before this one, and that step, not this
  // one, is what has to be tracked. Re-applying it every time would undo
  // exactly the things the steps without a view are there to show: the turn
  // of step 1 is still on screen while step 2 draws on it.
  //
  // Going backwards is where the search earns its keep. Stepping from the
  // octahedron back to the stroke has to put the dodecahedron back, or the
  // step would describe one picture over another.
  private applied_from: number | null = null;

  private apply_view() {
    let source = -1;
    for (let i = this.index; i >= 0; i--) {
      if (TOUR_STEPS[i].view !== undefined) { source = i; break; }
    }
    if (source < 0 || source === this.applied_from) return;
    this.applied_from = source;
    this.host.apply_view_hash(TOUR_STEPS[source].view!);
  }

  private show() {
    const step = TOUR_STEPS[this.index];
    this.host.tour_cancel_animation();
    this.apply_view();

    const panel = this.el('controls-panel');
    const targets = step.target
      ? Array.from(document.querySelectorAll<HTMLElement>(step.target)) : [];
    // A target inside the panel is only measurable once the panel is open,
    // and only in view once it has been scrolled to — the panel scrolls, and
    // the shape and wireframe sections are below the fold on a short window.
    const in_panel = !!panel && targets.some(t => panel.contains(t));
    panel?.classList.toggle('hidden', !in_panel);
    // 'center' and not 'nearest': nearest moves a target below the fold up
    // only as far as the panel's own bottom edge, which on a narrow window
    // is behind the docked card. Centring clears it, and on a wide one it
    // simply puts the thing being talked about in the middle of the panel.
    //
    // The docked padding is already in place by now — update_docked() runs
    // on start and on resize, not per step — so this scroll can reach the
    // room it adds.
    if (in_panel) targets[0].scrollIntoView({ block: 'center' });

    const progress = this.el('tour-progress');
    if (progress) {
      progress.textContent = `${this.index + 1} / ${TOUR_STEPS.length}`;
    }
    const title = this.el('tour-title');
    if (title) title.textContent = step.title;
    const body = this.el('tour-body');
    if (body) body.textContent = step.body;
    const back = this.el<HTMLButtonElement>('tour-back');
    if (back) back.disabled = this.index === 0;
    const next = this.el<HTMLButtonElement>('tour-next');
    const last = this.index === TOUR_STEPS.length - 1;
    if (next) next.textContent = last ? 'Done' : 'Next ▸';
    const skip = this.el('tour-skip');
    if (skip) skip.style.visibility = last ? 'hidden' : '';

    // Measured a frame later: the view this step applied may have shown or
    // hidden whole sections of the panel, and the scroll above has not
    // landed yet either.
    requestAnimationFrame(() => {
      this.place();
      if (step.demo === 'turn') this.host.tour_turn();
      else if (step.demo === 'stroke') this.host.tour_stroke();
      else if (step.demo === 'stellation') this.host.tour_stellation();
      else if (step.demo === 'seed') this.host.tour_seed();
    });
  }

  // The union of the targets' boxes, which is what gets lit. Several boxes
  // and one ring, so the three layer buttons read as one thing.
  private target_rect(): DOMRect | null {
    const step = TOUR_STEPS[this.index];
    if (!step.target) return null;
    let box: { l: number, t: number, r: number, b: number } | null = null;
    for (const el of document.querySelectorAll<HTMLElement>(step.target)) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      box = box ? {
        l: Math.min(box.l, rect.left), t: Math.min(box.t, rect.top),
        r: Math.max(box.r, rect.right), b: Math.max(box.b, rect.bottom)
      } : { l: rect.left, t: rect.top, r: rect.right, b: rect.bottom };
    }
    if (!box) return null;
    return new DOMRect(box.l, box.t, box.r - box.l, box.b - box.t);
  }

  private place() {
    if (!this.running) return;
    const overlay = this.el('tour-overlay');
    const hole = this.el('tour-hole');
    const card = this.el('tour-card');
    if (!overlay || !hole || !card) return;

    const rect = this.target_rect();
    overlay.classList.toggle('no-target', !rect);
    if (rect) {
      hole.style.left = `${rect.left - HOLE_PAD}px`;
      hole.style.top = `${rect.top - HOLE_PAD}px`;
      hole.style.width = `${rect.width + 2 * HOLE_PAD}px`;
      hole.style.height = `${rect.height + 2 * HOLE_PAD}px`;
    }

    const vw = window.innerWidth, vh = window.innerHeight;
    if (document.body.classList.contains('tour-docked')) {
      card.style.left = ''; card.style.top = '';
      return;
    }

    // Measured, not assumed: the card is as tall as its prose makes it.
    const cw = card.offsetWidth, ch = card.offsetHeight;

    if (!rect) {
      card.style.left = `${Math.round((vw - cw) / 2)}px`;
      card.style.top = `${Math.round((vh - ch) / 2)}px`;
      return;
    }

    // Beside the target where there is room, under or over it where there is
    // not. Left is tried first because almost everything worth lighting up
    // lives in the panel or the button stack, and both are on the right.
    const fits = (x: number, y: number) =>
      x >= CARD_MARGIN && x + cw <= vw - CARD_MARGIN
      && y >= CARD_MARGIN && y + ch <= vh - CARD_MARGIN;
    const centred_y = clamp(rect.top + rect.height / 2 - ch / 2,
      CARD_MARGIN, vh - ch - CARD_MARGIN);
    const centred_x = clamp(rect.left + rect.width / 2 - cw / 2,
      CARD_MARGIN, vw - cw - CARD_MARGIN);
    const candidates: Array<[number, number]> = [
      [rect.left - HOLE_PAD - CARD_MARGIN - cw, centred_y],
      [rect.right + HOLE_PAD + CARD_MARGIN, centred_y],
      [centred_x, rect.bottom + HOLE_PAD + CARD_MARGIN],
      [centred_x, rect.top - HOLE_PAD - CARD_MARGIN - ch],
    ];
    const spot = candidates.find(([x, y]) => fits(x, y))
      // Nothing fits — a target that fills the window, which on a square
      // window the canvas does. Bottom left, overlapping it: the lit area is
      // large enough that covering a corner of it costs nothing.
      ?? [CARD_MARGIN, vh - ch - CARD_MARGIN];
    card.style.left = `${Math.round(spot[0])}px`;
    card.style.top = `${Math.round(spot[1])}px`;
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

// Hooks up the ? button, and opens the tour of its own accord on a first
// visit — but only on a *plain* first visit. Someone arriving on a shared
// link came for that picture, and a tour would both cover it up and, since
// every step is itself a link, navigate away from it.
export function init_tour(host: TourHost) {
  const tour = new Tour(host);
  document.getElementById('tour-btn')?.addEventListener('click', () => tour.start());
  document.getElementById('tour-next')?.addEventListener('click', () => tour.go(1));
  document.getElementById('tour-back')?.addEventListener('click', () => tour.go(-1));
  document.getElementById('tour-skip')?.addEventListener('click', () => tour.stop());

  let seen = true;
  try { seen = !!localStorage.getItem(SEEN_KEY); } catch { /* private mode */ }
  if (!seen && !location.hash) tour.start();
  return tour;
}
