/**
 * Renders Phosphor icon SVGs to Three.js CanvasTextures for use as sprites.
 * Caches textures by (icon + color) key to avoid redundant rendering.
 */
import * as THREE from 'three';
import type { IconName } from './iconMap';

// ── SVG loading ─────────────────────────────────────────────

const svgCache = new Map<IconName, string>();

/**
 * Load a Phosphor Light icon SVG as a raw string.
 * Uses Vite's dynamic import with ?raw to get the SVG source at build time.
 */
const svgModules = import.meta.glob(
  '/node_modules/@phosphor-icons/core/assets/light/*.svg',
  { query: '?raw', import: 'default' },
);

async function loadSvgString(icon: IconName): Promise<string> {
  if (svgCache.has(icon)) return svgCache.get(icon)!;

  const path = `/node_modules/@phosphor-icons/core/assets/light/${icon}-light.svg`;
  const loader = svgModules[path];
  if (!loader) {
    console.warn(`[iconTexture] No SVG found for icon: ${icon}`);
    return '';
  }

  const raw = (await loader()) as string;
  svgCache.set(icon, raw);
  return raw;
}

// ── Texture rendering ───────────────────────────────────────

const textureCache = new Map<string, THREE.CanvasTexture>();

/** Pending loads — prevents duplicate async work for the same icon+color */
const pendingLoads = new Map<string, Promise<THREE.CanvasTexture | null>>();

function cacheKey(icon: IconName, color: string): string {
  return `${icon}:${color}`;
}

/**
 * Render an icon SVG onto a canvas and return a Three.js texture.
 * The icon is rendered as a colored shape on a transparent background.
 */
function renderSvgToTexture(svgString: string, color: string, size: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Parse SVG to extract path data
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const paths = doc.querySelectorAll('path');

  // Draw paths scaled to canvas size (Phosphor icons are 256x256)
  const scale = size / 256;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = color;

  for (const pathEl of paths) {
    const d = pathEl.getAttribute('d');
    if (!d) continue;
    const path2d = new Path2D(d);
    ctx.fill(path2d);
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/**
 * Get (or create) a cached icon texture.
 * Returns null synchronously if the SVG hasn't loaded yet — call preloadIcon first
 * or use getIconTextureAsync for guaranteed results.
 */
export function getIconTexture(icon: IconName, color: string, size = 256): THREE.CanvasTexture | null {
  const key = cacheKey(icon, color);
  return textureCache.get(key) ?? null;
}

/**
 * Asynchronously load and cache an icon texture.
 * Returns the cached version immediately if available.
 */
export async function getIconTextureAsync(
  icon: IconName,
  color: string,
  size = 256,
): Promise<THREE.CanvasTexture | null> {
  const key = cacheKey(icon, color);

  const cached = textureCache.get(key);
  if (cached) return cached;

  // Deduplicate in-flight loads
  if (pendingLoads.has(key)) return pendingLoads.get(key)!;

  const promise = (async () => {
    const svg = await loadSvgString(icon);
    if (!svg) return null;

    const tex = renderSvgToTexture(svg, color, size);
    textureCache.set(key, tex);
    pendingLoads.delete(key);
    return tex;
  })();

  pendingLoads.set(key, promise);
  return promise;
}

/**
 * Preload icon textures for a list of icons.
 * Call early (e.g. when tracks are created) to avoid frame-time hitches.
 */
export async function preloadIcons(icons: { icon: IconName; color: string }[]): Promise<void> {
  await Promise.all(icons.map(({ icon, color }) => getIconTextureAsync(icon, color)));
}

/**
 * Re-render an existing icon with a new color (e.g. when background changes).
 * Replaces the cached texture in-place.
 */
export async function recolorIcon(
  icon: IconName,
  oldColor: string,
  newColor: string,
  size = 256,
): Promise<THREE.CanvasTexture | null> {
  const oldKey = cacheKey(icon, oldColor);
  const oldTex = textureCache.get(oldKey);
  if (oldTex) {
    oldTex.dispose();
    textureCache.delete(oldKey);
  }
  return getIconTextureAsync(icon, newColor, size);
}

/**
 * Dispose all cached textures — call on unmount.
 */
export function disposeAllIconTextures(): void {
  for (const tex of textureCache.values()) tex.dispose();
  textureCache.clear();
  svgCache.clear();
  pendingLoads.clear();
}
