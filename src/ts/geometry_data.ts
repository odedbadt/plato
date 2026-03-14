// Geometry data - flat arrays for models

// Full-screen quad for overlay (2 triangles) - z=0 for middle of clip space
export const OVERLAY_VERTICES = [
  -1, -1, 0,
   1, -1, 0,
  -1,  1, 0,
   1,  1, 0,
   1, -1, 0,
  -1,  1, 0
];

export const OVERLAY_TEXTURE_COORDS = [
  0, 1,
  1, 1,
  0, 0,
  1, 0,
  1, 1,
  0, 0
];
