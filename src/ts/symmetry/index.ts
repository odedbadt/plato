export * from './linalg';
export * from './geometry';
export * from './models';

// The two plane kernels are deliberate parallels — same enumeration, same
// view folding, same sweep, differing in what a mirror is and what a point
// is — so they collide on almost every name. Their own namespaces are what
// let them stay parallel instead of one of them having to rename around the
// other.
export * as hyperbolic from './hyperbolic';
export * as euclidean from './euclidean';
