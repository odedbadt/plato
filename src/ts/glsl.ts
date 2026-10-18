export const VS_SOURCE = `precision mediump float;

in vec3 aVertexPosition;
in vec3 aNormalDirection;
in vec2 aTextureCoord;
out vec2 vTextureCoord;
out float vectorIndex;
out float fBrightness;

uniform mat3 model_transformer;
uniform mat4 projector;


vec3 lightDirection = vec3(-0.68041382,  0.27216553, -0.68041382);

void main(void) {

  vec4 projected = projector* vec4(model_transformer * aVertexPosition, 1.0);
  vec3 normal_after_rotation = model_transformer * aNormalDirection;
  gl_Position = projected;
  //gl_Position = vec4(aVertexPosition, 1.0);
  vTextureCoord = aTextureCoord;
  fBrightness = 0.7+0.3*dot(normalize(normal_after_rotation), 
                            normalize(lightDirection));
}
`
export const FS_SOURCE = `precision mediump float;
in vec2 vTextureCoord;
in float fBrightness;

out vec4 fragColor;
uniform sampler2D uTexture;
// The surface and the drawing on it are two independent layers of the same
// pass: uSurface is the lit ground's own alpha, uInk scales the drawing's.
// Both at 1 is the classic look; ink alone leaves the drawing standing in
// space where the solid's surface was.
uniform float uSurface;
uniform float uInk;

void main(void) {
    vec4 sampled = texture(uTexture, vTextureCoord);
    float ink = sampled.a * uInk;
    vec3 shaded_back  = 0.3+0.7*vec3(fBrightness);
    vec3 shaded_front = 0.3+0.7*fBrightness * sampled.rgb;
    // Ink over ground, where the ground itself may be transparent. The colour
    // has to come out un-premultiplied for NormalBlending, so the composite is
    // divided back out by its own alpha; at uSurface = 1 that cancels and this
    // is exactly the plain shaded blend.
    float alpha = ink + uSurface * (1.0 - ink);
    if (alpha <= 0.001) discard;
    vec3 rgb = (shaded_front * ink + shaded_back * uSurface * (1.0 - ink)) / alpha;
    fragColor = vec4(rgb, alpha);
}
`

export const FS_SOURCE_MIRRORS = `precision mediump float;
in vec2 vTextureCoord;
in float fBrightness;

out vec4 fragColor;
uniform sampler2D uTexture;

void main(void) {
  fragColor = vec4(vec3(0.5,0.9,1.0)*fBrightness,0.5);
}
`
export const VS_SOURCE_OVERLAY = `in vec3 aVertexPosition;
in vec2 aTextureCoord;

out vec2 vTextureCoord;

void main(void) {

  gl_Position = vec4(aVertexPosition, 1.0);
  vTextureCoord = aTextureCoord;

}
`
export const FS_SOURCE_OVERLAY = `precision mediump float;
in vec2 vTextureCoord;

out vec4 fragColor;
uniform sampler2D uTexture;
uniform float uOpacity;

void main(void) {
  vec4 sampled = texture(uTexture, vTextureCoord);
  fragColor = vec4(sampled.rgb, sampled.a * uOpacity);
}
`
// ---------------------------------------------------------------------------
// Wireframe passes
//
// Depth as *ink* rather than width: a projected line cannot usefully be thinner
// than one pixel, so a target weight below 1px is drawn 1px wide at fractional
// opacity. Perceived weight (width x opacity) then stays continuous across the
// 1px boundary, and distance reads off line heaviness even at the far end.
//
// Both passes share this vertex shader. It expands one instanced quad per edge,
// conservatively sized, and hands the fragment shader the segment in pixel
// space; the fragment shaders evaluate an exact distance field against
// gl_FragCoord, so taper, round caps and antialiasing need no interpolation
// tricks.
// ---------------------------------------------------------------------------

export const VS_SOURCE_WIREFRAME = `precision highp float;

in vec2 aCorner;    // x: lateral side (-1/+1), y: endpoint (0/1)
in vec3 aStart;
in vec3 aEnd;

uniform mat3 model_transformer;
uniform mat4 projector;
uniform vec2 uViewport;           // device pixels
uniform float uWMin;              // target weight at the far end (px)
uniform float uWMax;              // target weight at the near end (px)
uniform float uInkNear;           // view depth of the model's nearest point
uniform float uInkFar;
uniform float uFlat;              // 1.0 = uniform 1px, ignoring depth
uniform float uPad;               // extra quad margin in px (halo reach)

out vec2 vS0;
out vec2 vS1;
out float vW0;                    // view depth at the endpoints
out float vW1;
out float vK0;                    // target ink weight at the endpoints (px)
out float vK1;

// Log ramp over the scene's actual depth range, so the whole weight range gets
// used no matter how shallow the model is.
float ink_weight(float view_z) {
  float t = clamp((uInkFar - view_z) / max(uInkFar - uInkNear, 1e-4), 0.0, 1.0);
  return mix(uWMin * pow(uWMax / uWMin, t), 1.0, uFlat);
}

void main(void) {
  vec4 c0 = projector * vec4(model_transformer * aStart, 1.0);
  vec4 c1 = projector * vec4(model_transformer * aEnd, 1.0);

  // Pixel space, origin bottom-left to match gl_FragCoord
  vec2 s0 = (c0.xy / c0.w * 0.5 + 0.5) * uViewport;
  vec2 s1 = (c1.xy / c1.w * 0.5 + 0.5) * uViewport;

  vS0 = s0; vS1 = s1;
  vW0 = c0.w; vW1 = c1.w;
  vK0 = ink_weight(c0.w);
  vK1 = ink_weight(c1.w);

  float half_px = 0.5 * clamp(max(vK0, vK1), 1.0, uWMax) + 1.5 + uPad;

  vec2 d = s1 - s0;
  float len = length(d);
  vec2 dir = len > 1e-5 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);

  // aCorner.y is exactly 0 or 1, so this selects an endpoint
  vec4 c = mix(c0, c1, aCorner.y);
  vec2 off = nrm * aCorner.x * half_px
           + dir * (aCorner.y * 2.0 - 1.0) * half_px;
  c.xy += off / (0.5 * uViewport) * c.w;
  gl_Position = c;
}
`

// Shared fragment-shader preamble: the distance field and the depth mapping.
const WIREFRAME_FS_COMMON = `precision highp float;

in vec2 vS0;
in vec2 vS1;
in float vW0;
in float vW1;
in float vK0;
in float vK1;

uniform float uWMax;
uniform float uClipNear;
uniform float uClipFar;

// Window depth for a given view depth, matching the perspective matrix that
// built 'projector'. Lets both passes place depth per fragment instead of
// inheriting the quad's interpolated z.
float window_depth(float view_z) {
  float n = uClipNear, f = uClipFar;
  float ndc = (f + n) / (f - n) - 2.0 * f * n / ((f - n) * max(view_z, 1e-4));
  return clamp(ndc * 0.5 + 0.5, 0.0, 1.0);
}
`

export const FS_SOURCE_WIREFRAME = WIREFRAME_FS_COMMON + `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uLineBias;          // view units pulled toward the camera
uniform float uInkGamma;          // 1.0 disables the perceptual correction
uniform float uInkOnDark;         // 1.0 when the ink is lighter than the ground

out vec4 fragColor;

void main(void) {
  vec2 d = vS1 - vS0;
  float len2 = max(dot(d, d), 1e-8);
  float t = clamp(dot(gl_FragCoord.xy - vS0, d) / len2, 0.0, 1.0);
  float dist = length(gl_FragCoord.xy - (vS0 + d * t));

  // Weight is per-vertex, so an edge that recedes tapers along its length and
  // crosses the width/opacity boundary smoothly where it passes 1px.
  float k = mix(vK0, vK1, t);
  float wid = clamp(k, 1.0, uWMax);
  float alpha = min(k, 1.0);

  float coverage = clamp(wid * 0.5 + 0.5 - dist, 0.0, 1.0);
  if (coverage <= 0.0) discard;

  // Interpolate 1/z for perspective correctness
  float view_z = 1.0 / mix(1.0 / vW0, 1.0 / vW1, t);
  gl_FragDepth = window_depth(view_z - uLineBias);

  float a = coverage * alpha * uOpacity;
  // Blending happens in sRGB, so a flat 30% alpha does not read as 30% ink and
  // the depth ramp comes out uneven. A linear framebuffer would be the real
  // fix; short of that, correcting alpha recovers the ramp for a roughly
  // uniform ground, with the sign depending on which way the contrast runs.
  float a_light = pow(a, 1.0 / uInkGamma);              // light ink, dark ground
  float a_dark = 1.0 - pow(1.0 - a, 1.0 / uInkGamma);   // dark ink, light ground
  a = mix(a_dark, a_light, uInkOnDark);
  fragColor = vec4(uColor * a, a);   // premultiplied
}
`

// Occlusion haloes, as a depth-only prepass.
//
// Width tells you how far a line is but not what is in front of it where two
// lines cross. Appel's haloed lines cut a gap in the farther line; here each
// edge first lays down an invisible skirt a few pixels wider than itself,
// writing depth only. Lines then draw with the depth test on, so wherever a
// nearer edge's skirt covers a farther edge, the farther edge is cut away.
//
// Two things fall out of doing it in the depth buffer rather than by finding
// crossings on the CPU. Shallow crossings self-correct: the skirt is a 2D
// region, so a line crossing at a glancing angle stays inside it for longer and
// gets a correspondingly longer gap, which is what the 1/sin(theta) term in a
// crossing-based formulation approximates. And edges meeting at a shared
// polyhedron corner sit at nearly equal depth, so uHaloEps lets them through
// untouched without needing a shared-vertex test.
export const FS_SOURCE_WIREFRAME_HALO = WIREFRAME_FS_COMMON + `
uniform float uHaloPx;            // outer reach of the skirt (px)
uniform float uHaloEps;           // depth nudge protecting corners and self
uniform float uHaloSlope;         // >0 scales gap width by depth separation

out vec4 fragColor;

void main(void) {
  vec2 d = vS1 - vS0;
  float len2 = max(dot(d, d), 1e-8);
  float t = clamp(dot(gl_FragCoord.xy - vS0, d) / len2, 0.0, 1.0);
  float dist = length(gl_FragCoord.xy - (vS0 + d * t));

  float k = mix(vK0, vK1, t);
  float wid = clamp(k, 1.0, uWMax);
  float edge = wid * 0.5 + 0.5;     // the line's own footprint
  if (dist > edge + uHaloPx) discard;

  float view_z = 1.0 / mix(1.0 / vW0, 1.0 / vW1, t);

  // Ramping the written depth outward turns the skirt into a depth gradient: a
  // farther line is cut only out to the radius its own depth separation earns,
  // so wide gaps mean a large separation and narrow gaps mean the lines nearly
  // touch. uHaloSlope = 0 collapses this to a constant-radius halo.
  float push = uHaloEps + uHaloSlope * max(dist - edge, 0.0);
  gl_FragDepth = window_depth(view_z + push);

  fragColor = vec4(0.0);            // color writes are disabled
}
`
