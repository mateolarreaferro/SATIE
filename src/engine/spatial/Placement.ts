/**
 * Semantic spatial vocabulary for Satie.
 *
 * Maps human/AI-friendly placement words (sector × depth × height × extent) and
 * motion archetypes (drift, dart, pass, …) onto the engine's existing fields
 * (areaMin/areaMax + wanderType + wanderHz + noise). This is the deterministic
 * "compile" step: the model reasons in these words, the parser turns them into
 * coordinates the same way every time, so related elements stay spatially coherent.
 *
 * Frame: listener at the origin, +Z = ahead/forward, +X = right, +Y = up.
 * Distances are kept inside the ~1–8 m range the engine treats as musical.
 */
import { Vec3, WanderType } from '../core/Statement';

export type Sector =
  | 'ahead' | 'behind' | 'left' | 'right'
  | 'ahead-left' | 'ahead-right' | 'behind-left' | 'behind-right'
  | 'surround' | 'overhead';
export type Depth = 'near' | 'mid' | 'far';
export type Height = 'low' | 'level' | 'high';
export type Extent = 'narrow' | 'wide' | 'surround';

export const SECTORS = new Set<string>([
  'ahead', 'behind', 'left', 'right',
  'ahead-left', 'ahead-right', 'behind-left', 'behind-right',
  'surround', 'overhead',
]);
export const DEPTHS = new Set<string>(['near', 'mid', 'far']);
export const HEIGHTS = new Set<string>(['low', 'level', 'high']);
export const EXTENTS = new Set<string>(['narrow', 'wide', 'surround']);

const DEPTH_RADIUS: Record<Depth, number> = { near: 1.5, mid: 3.5, far: 6.0 };

// Horizontal unit direction of each sector's centre (x, z). `surround`/`overhead`
// are handled specially and not in this table.
const SECTOR_DIR: Record<string, [number, number]> = {
  ahead: [0, 1],
  behind: [0, -1],
  left: [-1, 0],
  right: [1, 0],
  'ahead-left': [-0.707, 0.707],
  'ahead-right': [0.707, 0.707],
  'behind-left': [-0.707, -0.707],
  'behind-right': [0.707, -0.707],
};

function heightBand(height: Height): [number, number] {
  switch (height) {
    case 'low': return [0, 0.4];
    case 'high': return [2, 4];
    case 'level':
    default: return [-0.4, 0.6]; // around ear height (listener at origin)
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Resolve a semantic placement into a coordinate box (areaMin/areaMax).
 * Pure and deterministic — same words always yield the same region.
 */
export function resolvePlacement(
  sector: Sector,
  depth: Depth,
  height: Height = 'level',
  extent: Extent = 'narrow',
): { min: Vec3; max: Vec3 } {
  const depthR = DEPTH_RADIUS[depth] ?? DEPTH_RADIUS.mid;
  const [yMin, yMax] = heightBand(height);

  // Directly overhead — a small patch up high, regardless of depth.
  if (sector === 'overhead') {
    return { min: { x: -1, y: 2.5, z: -1 }, max: { x: 1, y: 4.5, z: 1 } };
  }

  // Enveloping ring around the listener (sector or extent says "surround").
  if (sector === 'surround' || extent === 'surround') {
    return {
      min: { x: r2(-depthR), y: yMin, z: r2(-depthR) },
      max: { x: r2(depthR), y: yMax, z: r2(depthR) },
    };
  }

  const [dx, dz] = SECTOR_DIR[sector] ?? SECTOR_DIR.ahead;
  const cx = dx * depthR;
  const cz = dz * depthR;

  let hx: number, hz: number;
  if (extent === 'wide') {
    if (Math.abs(dx) > 0.3 && Math.abs(dz) > 0.3) {
      // diagonal sector — broaden both axes moderately
      hx = depthR * 0.6;
      hz = depthR * 0.6;
    } else if (Math.abs(dz) >= Math.abs(dx)) {
      // bearing along z (ahead/behind) — broad left-right, thin in depth
      hx = depthR * 0.9;
      hz = depthR * 0.25;
    } else {
      // bearing along x (left/right) — broad front-back, thin sideways
      hx = depthR * 0.25;
      hz = depthR * 0.9;
    }
  } else {
    // narrow point source
    hx = 0.6;
    hz = 0.6;
  }

  return {
    min: { x: r2(cx - hx), y: yMin, z: r2(cz - hz) },
    max: { x: r2(cx + hx), y: yMax, z: r2(cz + hz) },
  };
}

/** A motion archetype: how a voice moves, decoupled from where it sits. */
export interface MotionSpec {
  wanderType: WanderType;
  hz: number;
  noise: number;
  /** For Custom (line) trajectories produced by pass/approach/recede. */
  customName?: string;
  /** Region used when the voice has no explicit `place`. */
  defaultPlace: [Sector, Depth, Height, Extent];
}

/**
 * Semantic motion verbs → engine motion. Bounds come from `place` when present;
 * otherwise `defaultPlace` gives a sensible region for the archetype.
 */
export const SEMANTIC_MOTIONS: Record<string, MotionSpec> = {
  // landmarks — sit still at a clear point
  static: { wanderType: WanderType.Fixed, hz: 0, noise: 0, defaultPlace: ['ahead', 'mid', 'level', 'narrow'] },
  // ambient beds — large, slow, alive
  breathe: { wanderType: WanderType.Fly, hz: 0.05, noise: 0, defaultPlace: ['surround', 'mid', 'level', 'surround'] },
  drift: { wanderType: WanderType.Fly, hz: 0.2, noise: 0.1, defaultPlace: ['surround', 'mid', 'level', 'surround'] },
  // water — slow surge
  swell: { wanderType: WanderType.Fly, hz: 0.1, noise: 0.05, defaultPlace: ['ahead', 'mid', 'low', 'wide'] },
  // ground agents
  wander: { wanderType: WanderType.Walk, hz: 0.3, noise: 0.1, defaultPlace: ['surround', 'near', 'low', 'surround'] },
  // airborne agents — fast, erratic
  dart: { wanderType: WanderType.Fly, hz: 1.5, noise: 0.5, defaultPlace: ['surround', 'mid', 'high', 'surround'] },
  // circling
  circle: { wanderType: WanderType.Orbit, hz: 0.3, noise: 0, defaultPlace: ['ahead', 'mid', 'level', 'wide'] },
  // linear traverses (direction resolved by the parser for `pass`)
  pass: { wanderType: WanderType.Custom, hz: 0.15, noise: 0, customName: 'line_lr', defaultPlace: ['ahead', 'mid', 'low', 'wide'] },
  approach: { wanderType: WanderType.Custom, hz: 0.15, noise: 0, customName: 'line_toward', defaultPlace: ['ahead', 'far', 'low', 'wide'] },
  recede: { wanderType: WanderType.Custom, hz: 0.15, noise: 0, customName: 'line_away', defaultPlace: ['ahead', 'far', 'low', 'wide'] },
};

export function isSemanticMotion(verb: string): boolean {
  return Object.prototype.hasOwnProperty.call(SEMANTIC_MOTIONS, verb);
}

/** The default region for a motion verb when the voice has no explicit `place`. */
export function defaultRegionFor(spec: MotionSpec): { min: Vec3; max: Vec3 } {
  return resolvePlacement(...spec.defaultPlace);
}
