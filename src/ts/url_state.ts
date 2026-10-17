// What is in the address bar.
//
// The view, and only the view: which group, what shape of it, where the
// viewer stands, and what is drawn. Not the drawing itself — that is a canvas
// and does not fit in a URL — so a shared link reproduces the picture up to
// whatever has been sketched on it.
//
// Two things keep it short enough to read. Fields equal to the opening view
// are not written at all, so the plain app has a bare URL and a link carries
// only what was actually changed; and every write is a `replaceState`, so a
// drag leaves one address rather than a hundred entries in the back button.
//
// Nothing here knows about the app: this file turns a flat record into a
// string and back, and `app.ts` is what maps that record onto the controls.

export type UrlState = {
  // The Coxeter triple — the only field that says which kernel will draw.
  triple: number[],
  // Shape, the classic knobs.
  stellation: number,
  size: number,
  mirror_size: number,
  dual: boolean,
  rhombic: boolean,
  // Shape, the Wythoff knob: where the seed sits, in barycentric coordinates
  // on the fundamental triangle.
  seed_on: boolean,
  seed: number[],
  // Where the viewer stands. A solid turns, so this is a quaternion; a tiling
  // is walked through, so that one is an isometry of the plane, row-major.
  rotation: number[],
  plane_view: number[],
  // The plane kernels' own settings.
  projection: string,
  cutoff: number,
  cell_size: number,
  checker: boolean,
  // What gets drawn.
  solid: boolean,
  mirrors: string,
  wireframe: boolean,
  wireframe_mode: string,
  wireframe_weight: number,
  hide_back: boolean
};

type Field = keyof UrlState;

type Spec = {
  // The name in the URL. Short, because the whole point is a readable link.
  key: string,
  kind: 'bool' | 'number' | 'numbers' | 'text',
  // Numbers: how much precision survives the round trip. A quaternion and a
  // view isometry are read back by code that renormalises or refolds them, so
  // a few decimals cost nothing visible.
  decimals?: number,
  // Lists: how long, exactly. A wrong length is a broken URL, not a shorter
  // state, so it is dropped rather than patched.
  count?: number,
  allowed?: readonly string[]
};

const SCHEMA: Record<Field, Spec> = {
  triple: { key: 'g', kind: 'numbers', count: 3, decimals: 0 },
  stellation: { key: 'st', kind: 'number', decimals: 3 },
  size: { key: 'sz', kind: 'number', decimals: 3 },
  mirror_size: { key: 'mz', kind: 'number', decimals: 3 },
  dual: { key: 'du', kind: 'bool' },
  rhombic: { key: 'rh', kind: 'bool' },
  seed_on: { key: 'sd', kind: 'bool' },
  seed: { key: 'sp', kind: 'numbers', count: 3, decimals: 4 },
  rotation: { key: 'r', kind: 'numbers', count: 4, decimals: 4 },
  plane_view: { key: 'v', kind: 'numbers', count: 9, decimals: 5 },
  projection: { key: 'pj', kind: 'text', allowed: ['disc', 'halfplane'] },
  cutoff: { key: 'cu', kind: 'number', decimals: 3 },
  cell_size: { key: 'cs', kind: 'number', decimals: 3 },
  checker: { key: 'ck', kind: 'bool' },
  solid: { key: 'm', kind: 'bool' },
  mirrors: { key: 'mi', kind: 'text', allowed: ['', 'a', 'g', 'n'] },
  wireframe: { key: 'w', kind: 'bool' },
  wireframe_mode: {
    key: 'wm', kind: 'text', allowed: ['uniform', 'depth', 'depth-halo']
  },
  wireframe_weight: { key: 'ww', kind: 'number', decimals: 2 },
  hide_back: { key: 'wb', kind: 'bool' }
};

// The opening view, which is also what gets left out of the URL. It has to
// agree with the `stellated_dodecahedron` preset and the control defaults in
// index.html; where it drifts the only cost is a redundant field in the link.
export const DEFAULT_URL_STATE: UrlState = {
  triple: [5, 3, 2],
  stellation: 2,
  size: 1,
  mirror_size: 1,
  dual: false,
  rhombic: false,
  seed_on: false,
  seed: [1 / 3, 1 / 3, 1 / 3],
  // quat.rotateX(identity, pi/3), as app.ts starts it.
  rotation: [Math.sin(Math.PI / 6), 0, 0, Math.cos(Math.PI / 6)],
  plane_view: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  projection: 'disc',
  cutoff: 0.95,
  cell_size: 0.22,
  checker: true,
  solid: true,
  mirrors: '',
  wireframe: false,
  wireframe_mode: 'depth-halo',
  wireframe_weight: 1,
  hide_back: false
};

// A number as short as its precision allows. Trailing zeros go, and so does
// the sign of zero — `-0` and `0` are the same view, and a URL that cannot
// decide which it has is a URL that looks like it changed when it did not.
function format_number(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '0';
  const text = value.toFixed(decimals);
  const trimmed = decimals > 0 ? text.replace(/\.?0+$/, '') : text;
  return trimmed === '' || trimmed === '-0' ? '0' : trimmed;
}

function format_field(spec: Spec, value: unknown): string | null {
  switch (spec.kind) {
    case 'bool':
      return value ? '1' : '0';
    case 'number':
      return typeof value === 'number'
        ? format_number(value, spec.decimals ?? 3) : null;
    case 'numbers':
      return Array.isArray(value) && value.length === spec.count
        ? value.map(v => format_number(v, spec.decimals ?? 3)).join(',') : null;
    case 'text':
      return typeof value === 'string'
        && (!spec.allowed || spec.allowed.includes(value)) ? value : null;
  }
}

function parse_field(spec: Spec, text: string): unknown {
  switch (spec.kind) {
    case 'bool':
      return text === '1' ? true : text === '0' ? false : undefined;
    case 'number': {
      const value = Number(text);
      return Number.isFinite(value) ? value : undefined;
    }
    case 'numbers': {
      const parts = text.split(',').map(Number);
      return parts.length === spec.count && parts.every(Number.isFinite)
        ? parts : undefined;
    }
    case 'text':
      return !spec.allowed || spec.allowed.includes(text) ? text : undefined;
  }
}

// `k=v&k=v`, with the fields that are still at their opening value left out.
// The comparison is on the encoded text rather than the value, so a third
// that arrives back as 0.3333 still counts as untouched.
export function encode_url_state(state: UrlState): string {
  const parts: string[] = [];
  for (const field of Object.keys(SCHEMA) as Field[]) {
    const spec = SCHEMA[field];
    const encoded = format_field(spec, state[field]);
    if (encoded === null) continue;
    if (encoded === format_field(spec, DEFAULT_URL_STATE[field])) continue;
    parts.push(`${spec.key}=${encoded}`);
  }
  return parts.join('&');
}

// Whatever of a URL is legible. A field that is missing, misspelled or out of
// range is dropped and the app keeps its own value for it, so a hand-edited
// address degrades to a partial one instead of breaking the view.
export function decode_url_state(raw: string): Partial<UrlState> {
  const by_key = new Map<string, Spec & { field: Field }>();
  for (const field of Object.keys(SCHEMA) as Field[]) {
    by_key.set(SCHEMA[field].key, { ...SCHEMA[field], field });
  }
  const state: Partial<UrlState> = {};
  for (const pair of raw.split('&')) {
    if (!pair) continue;
    const split = pair.indexOf('=');
    const key = split < 0 ? pair : pair.slice(0, split);
    const text = split < 0 ? '' : decodeURIComponent(pair.slice(split + 1));
    const spec = by_key.get(key);
    if (!spec) continue;
    const value = parse_field(spec, text);
    if (value !== undefined) (state as Record<Field, unknown>)[spec.field] = value;
  }
  return state;
}

// The hash is where the state is written; a query string is read as well so a
// link that was tidied up by hand, or copied out of one, still works.
export function read_url_state(): Partial<UrlState> {
  const hash = location.hash.replace(/^#/, '');
  return decode_url_state(hash || location.search.replace(/^\?/, ''));
}

let pending: ReturnType<typeof setTimeout> | null = null;
let last_write_time = 0;
let last_written: string | null = null;

function write_url_state(state: UrlState) {
  const encoded = encode_url_state(state);
  if (encoded === last_written) return;
  // The opening view is the empty URL, and the opening view is also where
  // every session starts, so without this the first frame of a plain visit
  // would rewrite the address to say nothing.
  if (!encoded && !location.hash && last_written === null) return;
  last_written = encoded;
  // The hash and not the query, so the link is plainly app state and a reload
  // of it never reaches the server; replaceState and not pushState, so a pan
  // does not bury the page the visitor came from under its own trail.
  history.replaceState(null, '',
    location.pathname + location.search + (encoded ? `#${encoded}` : ''));
}

// At most one write per window, but the *first* one goes out at once.
//
// The delay is there to coalesce a stream — a pan is tens of changes a second
// and WebKit rate-limits replaceState — and a stream is exactly the case
// where the intermediate states do not matter. A one-off change is the
// opposite: picking a group is a single event, and if the window swallowed it
// the address bar would spend the next 400ms describing the view that was
// just left. That gap is reachable, not theoretical — a reload inside it
// comes back to the old shape — so discrete changes land immediately and
// only a second change inside the window waits, carrying whatever the state
// has become by the time the window closes.
export function schedule_url_write(snapshot: () => UrlState, delay = 400) {
  if (pending) return;
  const since = Date.now() - last_write_time;
  if (since >= delay) {
    last_write_time = Date.now();
    write_url_state(snapshot());
    return;
  }
  pending = setTimeout(() => {
    pending = null;
    last_write_time = Date.now();
    write_url_state(snapshot());
  }, delay - since);
}
