/**
 * First-Order Ambisonics (FOA) encoding using AmbiX convention (ACN/SN3D).
 *
 * Channels: W (omni), Y (left-right), Z (up-down), X (front-back)
 * Normalization: SN3D (Schmidt semi-normalized)
 */

export interface AmbisonicGains {
  w: number;
  y: number;
  z: number;
  x: number;
}

/**
 * Compute FOA encoding gains for a source at Cartesian position (x, y, z)
 * relative to the listener at the origin.
 *
 * Uses AmbiX convention (ACN channel ordering, SN3D normalization):
 *   Channel 0 (W) = 1                                    (omni)
 *   Channel 1 (Y) = sin(azimuth) * cos(elevation)        (left-right)
 *   Channel 2 (Z) = sin(elevation)                       (up-down)
 *   Channel 3 (X) = cos(azimuth) * cos(elevation)        (front-back)
 */
export function computeFOAGains(x: number, y: number, z: number): AmbisonicGains {
  const dist = Math.sqrt(x * x + y * y + z * z);

  if (dist < 1e-8) {
    // Source at listener position — encode as omnidirectional
    return { w: 1, y: 0, z: 0, x: 0 };
  }

  // Normalize direction
  const nx = x / dist;
  const ny = y / dist;
  const nz = z / dist;

  // Spherical coordinates
  // azimuth: angle in XZ plane from +X axis (front), positive toward +Z (right in Web Audio)
  // elevation: angle from XZ plane toward +Y (up)
  const azimuth = Math.atan2(nz, nx);
  const horizontalDist = Math.sqrt(nx * nx + nz * nz);
  const elevation = Math.atan2(ny, horizontalDist);

  const cosElev = Math.cos(elevation);

  return {
    w: 1,                                    // W: omni (SN3D normalization = 1 for order 0)
    y: Math.sin(azimuth) * cosElev,          // Y: left-right
    z: Math.sin(elevation),                  // Z: up-down
    x: Math.cos(azimuth) * cosElev,          // X: front-back
  };
}

/**
 * Distance attenuation using inverse distance model.
 * Returns a gain multiplier in [0, 1].
 */
export function distanceAttenuation(
  distance: number,
  refDistance: number = 1,
  maxDistance: number = 100,
  rolloff: number = 1,
): number {
  const d = Math.max(distance, refDistance);
  const clamped = Math.min(d, maxDistance);
  return refDistance / (refDistance + rolloff * (clamped - refDistance));
}
