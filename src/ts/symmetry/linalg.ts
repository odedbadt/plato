// Minimal 3-vector / 3x3-matrix helpers for the symmetry group construction.
// Matrices are row-major flat arrays: m[row * 3 + col].

export type Vec3 = [number, number, number];
export type Mat3 = number[]; // length 9, row-major

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

export function norm(v: Vec3): number {
    return Math.sqrt(dot(v, v));
}

// Mirrors numpy's `v / np.where(norm, norm, 1)`: a zero vector passes through
// unchanged rather than producing NaN.
export function normalize(v: Vec3): Vec3 {
    const n = norm(v);
    const d = n !== 0 ? n : 1;
    return [v[0] / d, v[1] / d, v[2] / d];
}

export function scale(v: Vec3, s: number): Vec3 {
    return [v[0] * s, v[1] * s, v[2] * s];
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function negate(v: Vec3): Vec3 {
    return [-v[0], -v[1], -v[2]];
}

export function mat_multiply(a: Mat3, b: Mat3): Mat3 {
    const out = new Array<number>(9);
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            out[r * 3 + c] =
                a[r * 3] * b[c] +
                a[r * 3 + 1] * b[3 + c] +
                a[r * 3 + 2] * b[6 + c];
        }
    }
    return out;
}

export function mat_apply(m: Mat3, v: Vec3): Vec3 {
    return [
        m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
        m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
        m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
    ];
}

export function transpose(m: Mat3): Mat3 {
    return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function column(m: Mat3, c: number): Vec3 {
    return [m[c], m[3 + c], m[6 + c]];
}

export function set_column(m: Mat3, c: number, v: Vec3): void {
    m[c] = v[0];
    m[3 + c] = v[1];
    m[6 + c] = v[2];
}

// Squared Frobenius distance between two 3x3 matrices.
export function squared_distance(a: Mat3, b: Mat3): number {
    let sum = 0;
    for (let i = 0; i < 9; i++) {
        const d = a[i] - b[i];
        sum += d * d;
    }
    return sum;
}

export function round_to(x: number, decimals: number): number {
    const f = Math.pow(10, decimals);
    const r = Math.round(x * f) / f;
    return r === 0 ? 0 : r; // collapse -0 so output matches the JSON's 0
}
