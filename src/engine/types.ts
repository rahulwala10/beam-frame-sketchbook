// Units used throughout: kN, m, s, tonnes. EI in kN·m², EA in kN, mass in t/m.

export type Vec2 = [number, number];

/**
 * fixed      ux uy rz restrained
 * pin        ux uy
 * roller     uy        (rolls horizontally, vertical reaction)
 * wallRoller ux        (rolls vertically against a wall, horizontal reaction)
 * slide      ux rz     (sliding clamp: moves vertically, cannot rotate)
 * spring     nothing rigid, only the springs kx / ky / kr
 */
export type SupportKind = 'fixed' | 'pin' | 'roller' | 'wallRoller' | 'slide' | 'spring';

export interface SupportSpec {
  node: number;
  kind: SupportKind;
  /** Spring stiffness in kN/m (kx, ky) and kN·m/rad (kr). */
  kx?: number;
  ky?: number;
  kr?: number;
  /** Unit vector from the node into the ground. Only used for drawing. */
  face?: Vec2;
}

export type MemberRole = 'beam' | 'column' | 'brace' | 'chord' | 'arch' | 'tie';

export interface MemberSpec {
  a: number;
  b: number;
  EI?: number;
  EA?: number;
  /** Mass per unit length, t/m. */
  mass?: number;
  /** Moment release (hinge) at end a / end b. */
  hingeA?: boolean;
  hingeB?: boolean;
  /** Pin-jointed bar: axial force only. */
  truss?: boolean;
  role?: MemberRole;
}

interface LoadBase {
  label?: string;
  /** Initially applied. Defaults to true. */
  on?: boolean;
}

/** Concentrated force (global components, kN) at fraction t along a member. */
export interface PointLoad extends LoadBase {
  kind: 'point';
  member: number;
  t: number;
  F: Vec2;
  /** Defaults to true. */
  draggable?: boolean;
}

/** Concentrated couple (kN·m, anticlockwise positive) at fraction t along a member. */
export interface MomentLoad extends LoadBase {
  kind: 'moment';
  member: number;
  t: number;
  M: number;
  draggable?: boolean;
}

/** Distributed load over one or more members. */
export interface LineLoad extends LoadBase {
  kind: 'line';
  members: number[];
  /** kN/m. A global vector, or a scalar along the member's local +y axis when `normal` is set. */
  w: Vec2 | number;
  normal?: boolean;
  /** Intensity is per unit horizontal (for wy) or vertical (for wx) projection. */
  projected?: boolean;
  /** Intensity factors at the start and end of the loaded length. Default [1, 1]. */
  ramp?: [number, number];
  /** Loaded part of each member as fractions [t1, t2]. Default [0, 1]. */
  span?: [number, number];
}

/** Prescribed support movement in m (global). Only acts on restrained directions. */
export interface Settlement extends LoadBase {
  kind: 'settle';
  node: number;
  d: Vec2;
}

export type LoadSpec = PointLoad | MomentLoad | LineLoad | Settlement;

export interface Spec {
  nodes: Vec2[];
  members: MemberSpec[];
  supports: SupportSpec[];
  loads: LoadSpec[];
}

/** A load acting on one finite element, in the element's local axes. */
export type ElemLoad =
  | { type: 'dist'; x1: number; x2: number; qx1: number; qx2: number; qy1: number; qy2: number }
  | { type: 'point'; a: number; px: number; py: number }
  | { type: 'moment'; a: number; m: number };

export interface Elem {
  i: number;
  j: number;
  member: number;
  /** Distance of the element start from the member start. */
  x0: number;
  L: number;
  c: number;
  s: number;
  EA: number;
  EI: number;
  m: number;
  relI: boolean;
  relJ: boolean;
  truss: boolean;
  /** Global DOF numbers [ui, vi, ri, uj, vj, rj]. */
  dofs: Int32Array;
  /** Local stiffness without releases. */
  kFull: Float64Array;
  /** Local stiffness after condensing out the released rotations. */
  kc: Float64Array;
  rel: number[];
  kccInv: Float64Array | null;
}

export const DEFAULT_EI = 40_000; // 200 GPa × 2.0e-4 m⁴
export const DEFAULT_EA = 1.6e6; // 200 GPa × 8.0e-3 m²
export const DEFAULT_MASS = 0.063; // 7.85 t/m³ × 8.0e-3 m²
