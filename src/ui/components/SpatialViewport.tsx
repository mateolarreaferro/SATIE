import { useRef, useEffect, useCallback, useState, useMemo, memo, createContext, useContext } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, Trail } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import type { TrackState } from '../../engine';
import { type FaceMeshData } from '../hooks/useFaceTracking';

const ViewportFocusContext = createContext<{ focused: boolean }>({ focused: false });
const CameraResetContext = createContext<React.MutableRefObject<(() => void) | null>>({ current: null });
const CameraZoomContext = createContext<React.MutableRefObject<((dir: number) => void) | null>>({ current: null });
const CameraFitContext = createContext<React.MutableRefObject<(() => void) | null>>({ current: null });
const OverlayModeContext = createContext<boolean>(false);
/** Whether the viewport background is dark — voices should use lighter colors */
const DarkBgContext = createContext<boolean>(false);

const DEFAULT_VOICE_COLOR = '#1a3a2a';
const LIGHT_BG_VOICE_COLORS = ['#7cb8a4', '#8ec4b0', '#a0d0bc', '#92c8b4', '#86c0aa'];
const DARK_BG_VOICE_COLORS = ['#c8ece0', '#d4f0e8', '#e0f4ee', '#bce4d6', '#b0dccc'];

/** Remap the default dark voice color to lighter alternatives based on background */
function remapColor(trackColor: string, isDarkBg: boolean, seed: number): string {
  if (trackColor.toLowerCase() !== DEFAULT_VOICE_COLOR) return trackColor;
  const palette = isDarkBg ? DARK_BG_VOICE_COLORS : LIGHT_BG_VOICE_COLORS;
  return palette[Math.abs(Math.round(seed * 100)) % palette.length];
}

interface ListenerSync {
  onMove?: (x: number, y: number, z: number) => void;
  onRotate?: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void;
  linked: boolean;
  listenerPosRef: React.MutableRefObject<THREE.Vector3>;
  /** Forward direction vector — updated by face/head tracking or camera */
  listenerForwardRef: React.MutableRefObject<THREE.Vector3>;
  /** True when external tracking (face/head) controls orientation — camera should not override */
  externalTrackingActive: boolean;
  /** Live face mesh data from webcam — null when face tracking is off */
  faceMeshRef: React.MutableRefObject<FaceMeshData | null>;
}
const ListenerSyncContext = createContext<ListenerSync>({
  linked: false,
  listenerPosRef: { current: new THREE.Vector3() },
  listenerForwardRef: { current: new THREE.Vector3(0, 0, -1) },
  externalTrackingActive: false,
  faceMeshRef: { current: null },
});

interface SpatialViewportProps {
  tracksRef: React.RefObject<TrackState[]>;
  bgColor?: string;
  onBgColorChange?: (color: string) => void;
  onListenerMove?: (x: number, y: number, z: number) => void;
  onListenerRotate?: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void;
  /** When true: transparent bg, no grid/controls/pointer-events — for layering over other content */
  overlayMode?: boolean;
  /** External face tracking state — when provided, lights up the listener face mesh and flags external tracking.
   *  If `toggle` is provided, SpatialViewport also renders a built-in camera toggle pill. */
  faceTracking?: {
    enabled: boolean;
    meshRef: React.MutableRefObject<FaceMeshData | null>;
    toggle?: () => void;
    loading?: boolean;
    error?: string | null;
  };
}

function BgColorUpdater({ color, transparent }: { color: string; transparent?: boolean }) {
  const { gl } = useThree();
  useEffect(() => {
    if (transparent) {
      gl.setClearColor(0x000000, 0);
    } else {
      gl.setClearColor(color, 1);
    }
  }, [gl, color, transparent]);
  return null;
}

// ── Visual type helpers ──────────────────────────────────────

type VisualKind = 'none' | 'sphere' | 'cube' | 'trail' | 'trail+sphere' | 'trail+cube';

function resolveVisualKind(visual: string[]): VisualKind {
  if (visual.length === 0) return 'none';
  const hasTrail = visual.includes('trail');
  const hasSphere = visual.includes('sphere');
  const hasCube = visual.includes('cube');
  if (hasTrail && hasCube) return 'trail+cube';
  if (hasTrail && hasSphere) return 'trail+sphere';
  if (hasTrail) return 'trail';
  if (hasCube) return 'cube';
  if (hasSphere) return 'sphere';
  return 'none';
}

// ── Orb shader ──────────────────────────────────────────────

const ORB_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ORB_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec2 c = vUv - 0.5;
  float dist = length(c) * 2.0;
  // Bright inner core
  float core = 1.0 - smoothstep(0.0, 0.35, dist);
  // Soft exponential glow
  float glow = exp(-dist * dist * 3.5);
  // Smooth fade to 0 at the geometry edge so Bloom never sees a hard outline
  float edgeFade = 1.0 - smoothstep(0.78, 1.0, dist);
  float alpha = (core * 0.9 + glow * 0.5) * uOpacity * edgeFade;
  if (alpha < 0.002) discard;
  // Brighten center, tint glow with voice color
  vec3 col = uColor * (1.0 + core * 0.6);
  gl_FragColor = vec4(col, alpha);
}`;

// Circular disc (not a square plane) so the shader's radial falloff matches
// the geometry boundary — avoids Bloom picking up the square plane corners.
const sharedPlaneGeo = new THREE.CircleGeometry(0.5, 64);

function makeOrbMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: ORB_VERTEX,
    fragmentShader: ORB_FRAGMENT,
    uniforms: {
      uColor: { value: new THREE.Color(DEFAULT_VOICE_COLOR) },
      uOpacity: { value: 0.9 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ── Label rendering ─────────────────────────────────────────

function useLabelFrame(
  trackRef: React.RefObject<TrackState | null>,
  labelRef: React.RefObject<THREE.Sprite | null>,
  posRef: React.RefObject<THREE.Object3D | null>,
) {
  const labelTexRef = useRef<THREE.CanvasTexture | null>(null);
  const prevLabel = useRef<string>('');

  useFrame(() => {
    const track = trackRef.current;
    if (!track || !labelRef.current) return;

    const pos = posRef.current;
    const yOff = pos ? 0.55 : 0.3;
    labelRef.current.position.set(track.position.x, track.position.y + yOff, track.position.z);

    const raw = track.statement.clip.split('/').pop() ?? '';
    const label = raw
      .replace(/_\d+$/g, '')
      .replace(/_\d+$/g, '')
      .replace(/_/g, ' ')
      .trim();

    if (label !== prevLabel.current) {
      prevLabel.current = label;
      if (labelTexRef.current) labelTexRef.current.dispose();

      const SCALE = 3;
      const H = 48 * SCALE;
      const FONT_SIZE = 22 * SCALE;
      const PADDING_X = 18 * SCALE;

      const offscreen = document.createElement('canvas');
      const offCtx = offscreen.getContext('2d')!;
      offCtx.font = `600 ${FONT_SIZE}px Inter, system-ui, sans-serif`;
      const textW = offCtx.measureText(label).width;

      const W = textW + PADDING_X * 2;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;

      const r = H * 0.42;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(W - r, 0);
      ctx.quadraticCurveTo(W, 0, W, r);
      ctx.lineTo(W, H - r);
      ctx.quadraticCurveTo(W, H, W - r, H);
      ctx.lineTo(r, H);
      ctx.quadraticCurveTo(0, H, 0, H - r);
      ctx.lineTo(0, r);
      ctx.quadraticCurveTo(0, 0, r, 0);
      ctx.closePath();
      ctx.fill();

      ctx.font = `600 ${FONT_SIZE}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, W / 2, H / 2);

      const tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      labelTexRef.current = tex;

      const worldH = 0.28;
      const worldW = worldH * (W / H);
      labelRef.current.scale.set(worldW, worldH, 1);

      (labelRef.current.material as THREE.SpriteMaterial).map = tex;
      (labelRef.current.material as THREE.SpriteMaterial).needsUpdate = true;
    }
  });
}

function LabelSprite({ labelRef }: { labelRef: React.RefObject<THREE.Sprite | null> }) {
  return (
    <sprite ref={labelRef} scale={[2.0, 0.28, 1]} renderOrder={999}>
      <spriteMaterial transparent depthTest={false} toneMapped={false} />
    </sprite>
  );
}

// ── Orb voice (sphere / none) ───────────────────────────────

function AudioSourceOrb({ trackRef }: { trackRef: React.RefObject<TrackState | null> }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const labelRef = useRef<THREE.Sprite>(null);
  const isDarkBg = useContext(DarkBgContext);
  const { camera } = useThree();

  const orbMat = useMemo(() => makeOrbMaterial(), []);

  useLabelFrame(trackRef, labelRef, meshRef);

  useFrame(() => {
    const track = trackRef.current;
    if (!track || !meshRef.current) return;

    meshRef.current.position.set(track.position.x, track.position.y, track.position.z);
    meshRef.current.quaternion.copy(camera.quaternion);
    const baseScale = 0.3 + track.volume * 0.35;
    const sizeMultiplier = track.statement.visualSize ?? 1;
    meshRef.current.scale.setScalar(baseScale * sizeMultiplier);

    const displayColor = remapColor(track.color, isDarkBg, track.seed);
    orbMat.uniforms.uColor.value.set(displayColor);
    orbMat.uniforms.uOpacity.value = track.alpha * 0.9;
  });

  return (
    <>
      <mesh ref={meshRef} geometry={sharedPlaneGeo} material={orbMat} renderOrder={100} />
      <LabelSprite labelRef={labelRef} />
    </>
  );
}

// ── Cube voice ──────────────────────────────────────────────

function AudioSourceCube({ trackRef }: { trackRef: React.RefObject<TrackState | null> }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const labelRef = useRef<THREE.Sprite>(null);
  const isDarkBg = useContext(DarkBgContext);

  useLabelFrame(trackRef, labelRef, meshRef);

  useFrame(() => {
    const track = trackRef.current;
    if (!track) return;

    if (meshRef.current) {
      meshRef.current.position.set(track.position.x, track.position.y, track.position.z);
      const baseScale = 0.12 + track.volume * 0.2;
      const sizeMultiplier = track.statement.visualSize ?? 1;
      meshRef.current.scale.setScalar(baseScale * sizeMultiplier);
    }

    if (matRef.current) {
      const displayColor = remapColor(track.color, isDarkBg, track.seed);
      matRef.current.color.set(displayColor);
      matRef.current.emissive.set(displayColor);
      matRef.current.opacity = track.alpha * 0.85;
    }
  });

  return (
    <>
      <mesh ref={meshRef}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          ref={matRef}
          emissiveIntensity={0.8}
          transparent
          opacity={0.6}
          roughness={0.3}
          metalness={0}
        />
      </mesh>
      <LabelSprite labelRef={labelRef} />
    </>
  );
}

// ── Trail + orb voice ───────────────────────────────────────

function AudioSourceTrailOrb({ trackRef }: { trackRef: React.RefObject<TrackState | null> }) {
  const anchorRef = useRef<THREE.Mesh>(null);
  const orbRef = useRef<THREE.Mesh>(null);
  const labelRef = useRef<THREE.Sprite>(null);
  const trailRef = useRef<any>(null);
  const overlayMode = useContext(OverlayModeContext);
  const isDarkBg = useContext(DarkBgContext);
  const { camera } = useThree();

  const orbMat = useMemo(() => makeOrbMaterial(), []);

  useLabelFrame(trackRef, labelRef, orbRef);

  useFrame(() => {
    const track = trackRef.current;
    if (!track) return;

    // Move the trail anchor
    if (anchorRef.current) {
      anchorRef.current.position.set(track.position.x, track.position.y, track.position.z);
      const baseScale = 0.12 + track.volume * 0.2;
      const sizeMultiplier = track.statement.visualSize ?? 1;
      anchorRef.current.scale.setScalar(baseScale * sizeMultiplier);
    }

    // Sync the visible orb to anchor position
    if (orbRef.current) {
      orbRef.current.position.set(track.position.x, track.position.y, track.position.z);
      orbRef.current.quaternion.copy(camera.quaternion);
      const baseScale = 0.3 + track.volume * 0.35;
      const sizeMultiplier = track.statement.visualSize ?? 1;
      orbRef.current.scale.setScalar(baseScale * sizeMultiplier);
    }

    const displayColor = remapColor(track.color, isDarkBg, track.seed);
    orbMat.uniforms.uColor.value.set(displayColor);
    orbMat.uniforms.uOpacity.value = track.alpha * 0.9;

    // Trail color
    if (trailRef.current) {
      const tMat = trailRef.current.material as any;
      if (tMat?.uniforms?.color) tMat.uniforms.color.value.set(displayColor);
      else if (tMat?.color) tMat.color.set(displayColor);
    }
  });

  const trailWidth = overlayMode ? 3 : 1.2;
  const trailLength = overlayMode ? 140 : 80;

  return (
    <>
      <Trail ref={trailRef} width={trailWidth} length={trailLength} decay={1} attenuation={(w) => w * w}>
        <mesh ref={anchorRef}>
          <sphereGeometry args={[0.01, 4, 4]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      </Trail>
      <mesh ref={orbRef} geometry={sharedPlaneGeo} material={orbMat} renderOrder={100} />
      <LabelSprite labelRef={labelRef} />
    </>
  );
}

// ── Trail + cube voice ──────────────────────────────────────

function AudioSourceTrailCube({ trackRef }: { trackRef: React.RefObject<TrackState | null> }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const labelRef = useRef<THREE.Sprite>(null);
  const trailRef = useRef<any>(null);
  const overlayMode = useContext(OverlayModeContext);
  const isDarkBg = useContext(DarkBgContext);

  useLabelFrame(trackRef, labelRef, meshRef);

  useFrame(() => {
    const track = trackRef.current;
    if (!track) return;

    if (meshRef.current) {
      meshRef.current.position.set(track.position.x, track.position.y, track.position.z);
      const baseScale = 0.12 + track.volume * 0.2;
      const sizeMultiplier = track.statement.visualSize ?? 1;
      meshRef.current.scale.setScalar(baseScale * sizeMultiplier);
    }

    if (matRef.current) {
      const displayColor = remapColor(track.color, isDarkBg, track.seed);
      matRef.current.color.set(displayColor);
      matRef.current.emissive.set(displayColor);
      matRef.current.opacity = track.alpha * 0.85;
    }

    if (trailRef.current) {
      const displayColor = remapColor(track.color, isDarkBg, track.seed);
      const tMat = trailRef.current.material as any;
      if (tMat?.uniforms?.color) tMat.uniforms.color.value.set(displayColor);
      else if (tMat?.color) tMat.color.set(displayColor);
    }
  });

  const trailWidth = overlayMode ? 3 : 1.2;
  const trailLength = overlayMode ? 140 : 80;

  return (
    <>
      <Trail ref={trailRef} width={trailWidth} length={trailLength} decay={1} attenuation={(w) => w * w}>
        <mesh ref={meshRef}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial
            ref={matRef}
            emissiveIntensity={0.8}
            transparent
            opacity={0.6}
            roughness={0.3}
            metalness={0}
          />
        </mesh>
      </Trail>
      <LabelSprite labelRef={labelRef} />
    </>
  );
}

// ── Pool ─────────────────────────────────────────────────────

const MAX_VOICES = 128;

interface SlotInfo {
  count: number;
  kinds: VisualKind[];
}

function AudioSourcePool({ tracksRef }: { tracksRef: React.RefObject<TrackState[]> }) {
  const overlayMode = useContext(OverlayModeContext);
  const trackRefs = useMemo(() => {
    const refs: React.RefObject<TrackState | null>[] = [];
    for (let i = 0; i < MAX_VOICES; i++) {
      refs.push({ current: null });
    }
    return refs;
  }, []);

  const [slotInfo, setSlotInfo] = useState<SlotInfo>({ count: 0, kinds: [] });

  useFrame(() => {
    const tracks = tracksRef.current ?? [];
    const count = Math.min(tracks.length, MAX_VOICES);

    for (let i = 0; i < count; i++) {
      (trackRefs[i] as { current: TrackState | null }).current = tracks[i];
    }
    for (let i = count; i < MAX_VOICES; i++) {
      (trackRefs[i] as { current: TrackState | null }).current = null;
    }

    // Only re-render when count or visual kinds change
    let needsUpdate = count !== slotInfo.count;
    if (!needsUpdate) {
      for (let i = 0; i < count; i++) {
        if (resolveVisualKind(tracks[i].statement.visual) !== slotInfo.kinds[i]) {
          needsUpdate = true;
          break;
        }
      }
    }

    if (needsUpdate) {
      const kinds: VisualKind[] = [];
      for (let i = 0; i < count; i++) {
        kinds.push(resolveVisualKind(tracks[i].statement.visual));
      }
      setSlotInfo({ count, kinds });
    }
  });

  return (
    <>
      {trackRefs.slice(0, slotInfo.count).map((ref, i) => {
        const kind = slotInfo.kinds[i];
        switch (kind) {
          case 'none':         return <AudioSourceOrb key={i} trackRef={ref} />;
          case 'sphere':       return <AudioSourceOrb key={i} trackRef={ref} />;
          case 'cube':         return <AudioSourceCube key={i} trackRef={ref} />;
          case 'trail':        return <AudioSourceTrailOrb key={i} trackRef={ref} />;
          case 'trail+sphere': return <AudioSourceTrailOrb key={i} trackRef={ref} />;
          case 'trail+cube':   return <AudioSourceTrailCube key={i} trackRef={ref} />;
          default:             return <AudioSourceOrb key={i} trackRef={ref} />;
        }
      })}
    </>
  );
}

// ── Axis gizmo ───────────────────────────────────────────

function AxisGizmo() {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);

  // Create Line objects (THREE.Line, not JSX <line>)
  const lines = useMemo(() => {
    const axisLen = 0.4;
    const makeAxis = (dir: THREE.Vector3, color: string) => {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone().multiplyScalar(axisLen)]);
      const mat = new THREE.LineBasicMaterial({ color });
      return new THREE.Line(geo, mat);
    };
    return [
      makeAxis(new THREE.Vector3(1, 0, 0), '#e74c3c'), // X red
      makeAxis(new THREE.Vector3(0, 1, 0), '#2ecc71'), // Y green
      makeAxis(new THREE.Vector3(0, 0, 1), '#3498db'), // Z blue
    ];
  }, []);

  useFrame(() => {
    if (!groupRef.current) return;
    // Position in bottom-left corner of screen (NDC → world)
    const pos = new THREE.Vector3(-0.85, -0.8, 0.5).unproject(camera);
    const dir = pos.sub(camera.position).normalize();
    groupRef.current.position.copy(camera.position).addScaledVector(dir, 5);
    // Match camera rotation so axes show world orientation
    groupRef.current.quaternion.copy(camera.quaternion).invert();
  });

  return (
    <group ref={groupRef}>
      {lines.map((line, i) => (
        <primitive key={i} object={line} />
      ))}
    </group>
  );
}

// ── Scene furniture ──────────────────────────────────────────

function NoseTriangle({ color }: { color: string }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const verts = new Float32Array([0, 0, -0.45, -0.25, 0, 0.15, 0.25, 0, 0.15]);
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <mesh geometry={geo} position={[0, 0, 0]}>
      <meshBasicMaterial color={color} opacity={0.7} transparent side={THREE.DoubleSide} />
    </mesh>
  );
}

// MediaPipe face contour connections — only indices < 468 (safe for all model variants)
const FACE_CONTOURS = [
  [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109,10],
  [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246,33],
  [362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398,362],
  [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185,61],
  [78,95,88,178,87,14,317,402,318,324,308,415,310,311,312,13,82,81,80,191,78],
  [46,53,52,65,55,107,66,105,63,70],
  [276,283,282,295,285,336,296,334,293,300],
  [168,6,197,195,5,4,1,19],
];

function buildLinePairs(): number[] {
  const pairs: number[] = [];
  for (const c of FACE_CONTOURS) {
    for (let i = 0; i < c.length - 1; i++) pairs.push(c[i], c[i + 1]);
  }
  return pairs;
}
const FACE_LINE_PAIRS = buildLinePairs();

/** Convert a landmark index to local xyz, centered on a reference point */
function landmarkToLocal(
  positions: Float32Array, idx: number, scale: number, zScale: number,
  out: Float32Array, outOffset: number,
  cx: number, cy: number, cz: number,
) {
  out[outOffset]     = -(positions[idx * 3] - cx) * scale;
  out[outOffset + 1] = -(positions[idx * 3 + 1] - cy) * scale;
  out[outOffset + 2] = -(positions[idx * 3 + 2] - cz) * zScale;
}

/**
 * Face mesh visualization — clean contour wireframe only (no dot cloud).
 * Uses <primitive> to bypass R3F reconciler for performance.
 */
function FaceMeshViz({ color }: { color: string }) {
  const { faceMeshRef } = useContext(ListenerSyncContext);

  const lines = useMemo(() => {
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FACE_LINE_PAIRS.length * 3), 3));
    const lm = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
    });
    const ls = new THREE.LineSegments(lg, lm);
    ls.frustumCulled = false;
    ls.renderOrder = 1;
    return ls;
  }, []);

  useEffect(() => {
    (lines.material as THREE.LineBasicMaterial).color.set(color);
  }, [color, lines]);

  useFrame(() => {
    const data = faceMeshRef.current;
    if (!data) return;

    const numLandmarks = Math.min(Math.floor(data.positions.length / 3), 468);
    const scale = 4.0;
    const zScale = 6.0;

    // Center on nose tip (landmark 1)
    const cx = data.positions[1 * 3];
    const cy = data.positions[1 * 3 + 1];
    const cz = data.positions[1 * 3 + 2];

    const lAttr = lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const lArr = lAttr.array as Float32Array;
    for (let i = 0; i < FACE_LINE_PAIRS.length; i++) {
      const li = FACE_LINE_PAIRS[i];
      if (li < numLandmarks) {
        landmarkToLocal(data.positions, li, scale, zScale, lArr, i * 3, cx, cy, cz);
      }
    }
    lAttr.needsUpdate = true;
    lines.geometry.computeBoundingSphere();
  });

  useEffect(() => () => {
    lines.geometry.dispose();
    (lines.material as THREE.Material).dispose();
  }, [lines]);

  return <primitive object={lines} />;
}

function Listener({ color, faceTrackingActive }: { color: string; faceTrackingActive: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const { listenerPosRef, listenerForwardRef, faceMeshRef } = useContext(ListenerSyncContext);

  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.position.set(
      listenerPosRef.current.x,
      listenerPosRef.current.y + 0.02,
      listenerPosRef.current.z,
    );

    if (faceTrackingActive && faceMeshRef.current) {
      // Apply tracked yaw/pitch directly to the group — this IS the rotation visualization
      const { yaw, pitch } = faceMeshRef.current;
      groupRef.current.rotation.order = 'YXZ';
      groupRef.current.rotation.y = yaw;
      groupRef.current.rotation.x = pitch;
    } else {
      const fwd = listenerForwardRef.current;
      groupRef.current.rotation.order = 'YXZ';
      groupRef.current.rotation.y = Math.atan2(-fwd.x, -fwd.z);
      groupRef.current.rotation.x = 0;
    }
  });

  return (
    <group ref={groupRef} position={[0, 0.02, 0]}>
      {faceTrackingActive ? (
        <FaceMeshViz color={color} />
      ) : (
        <NoseTriangle color={color} />
      )}
    </group>
  );
}

// Hearing cone — shows HRTF listening direction
function HearingCone({ color }: { color: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const { listenerPosRef, listenerForwardRef } = useContext(ListenerSyncContext);

  const coneGeo = useMemo(() => {
    // Cone: tip at origin, opens toward -Z (the "forward" direction)
    const geo = new THREE.ConeGeometry(0.45, 1.2, 16, 1, true);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -0.6);
    return geo;
  }, []);

  const _defaultDir = useMemo(() => new THREE.Vector3(0, 0, -1), []);
  const _target = useMemo(() => new THREE.Vector3(), []);
  const _quat = useMemo(() => new THREE.Quaternion(), []);

  useFrame(() => {
    if (!groupRef.current) return;
    const pos = listenerPosRef.current;
    groupRef.current.position.set(pos.x, pos.y + 0.02, pos.z);

    const fwd = listenerForwardRef.current;
    _target.set(fwd.x, fwd.y, fwd.z);
    if (_target.lengthSq() > 0.001) {
      _target.normalize();
      _quat.setFromUnitVectors(_defaultDir, _target);
      groupRef.current.quaternion.copy(_quat);
    }
  });

  return (
    <group ref={groupRef}>
      <mesh geometry={coneGeo}>
        <meshBasicMaterial color={color} transparent opacity={0.035} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** Drag-to-look fly controls used in the chat overlay. Camera IS the listener.
 *  Drag (left or right) anywhere except chat UI to look around; WASD to move,
 *  Q/E to fly, scroll to dolly, double-click empty space to teleport,
 *  R to reset, F to fit. ESC blurs any active drag. */
function OverlayFlyControls() {
  const { camera, gl } = useThree();
  const listenerSync = useContext(ListenerSyncContext);
  const listenerSyncRef = useRef(listenerSync);
  listenerSyncRef.current = listenerSync;
  const keysDown = useRef(new Set<string>());
  const dragging = useRef(false);
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const flySpeed = 6;
  const lookSensitivity = 0.003;

  const isInputFocused = useCallback(() => {
    const el = document.activeElement;
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ||
           el?.closest('.monaco-editor') != null ||
           el?.closest('header') != null || el?.closest('nav') != null ||
           el?.closest('[contenteditable="true"]') != null;
  }, []);

  // Targets that should NOT engage drag-to-look (chat UI, header, buttons, links).
  const isOverlayUITarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return !!(
      target.closest('header') ||
      target.closest('button') ||
      target.closest('a') ||
      target.closest('input') ||
      target.closest('textarea') ||
      target.closest('details') ||
      target.closest('[contenteditable="true"]') ||
      target.closest('[data-no-drag]')
    );
  }, []);

  const setBodyCursor = useCallback((c: string) => {
    document.body.style.cursor = c;
  }, []);

  // Initialize euler from camera
  useEffect(() => {
    euler.current.setFromQuaternion(camera.quaternion, 'YXZ');
  }, [camera]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (isInputFocused()) return;
    const key = e.key.toLowerCase();
    if (key === 'escape' && dragging.current) {
      dragging.current = false;
      setBodyCursor('');
      return;
    }
    keysDown.current.add(key);
    if (['w', 'a', 's', 'd', 'q', 'e', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
      e.preventDefault();
    }
  }, [isInputFocused, setBodyCursor]);

  const onKeyUp = useCallback((e: KeyboardEvent) => {
    keysDown.current.delete(e.key.toLowerCase());
  }, []);

  const onMouseDown = useCallback((e: MouseEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    if (isOverlayUITarget(e.target)) return;
    dragging.current = true;
    setBodyCursor('grabbing');
  }, [isOverlayUITarget, setBodyCursor]);

  const onMouseUp = useCallback((e: MouseEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    if (dragging.current) {
      dragging.current = false;
      setBodyCursor('');
    }
  }, [setBodyCursor]);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) return;
    euler.current.y -= e.movementX * lookSensitivity;
    euler.current.x -= e.movementY * lookSensitivity;
    euler.current.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, euler.current.x));
    camera.quaternion.setFromEuler(euler.current);
  }, [camera]);

  // Scroll wheel = dolly along view direction (only when not over chat UI)
  const onWheel = useCallback((e: WheelEvent) => {
    if (isOverlayUITarget(e.target)) return;
    e.preventDefault();
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const step = Math.max(-1.5, Math.min(1.5, -e.deltaY * 0.01));
    camera.position.addScaledVector(fwd, step);
  }, [camera, isOverlayUITarget]);

  // Double-click empty space = teleport listener (xz only, preserve height)
  const onDblClick = useCallback((e: MouseEvent) => {
    if (isOverlayUITarget(e.target)) return;
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (ray.ray.intersectPlane(plane, hit)) {
      camera.position.set(hit.x, camera.position.y, hit.z);
    }
  }, [camera, gl, isOverlayUITarget]);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('dblclick', onDblClick);
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('dblclick', onDblClick);
      setBodyCursor('');
    };
  }, [onKeyDown, onKeyUp, onMouseDown, onMouseUp, onMouseMove, onWheel, onDblClick, setBodyCursor]);

  const _forward = useMemo(() => new THREE.Vector3(), []);
  const _right = useMemo(() => new THREE.Vector3(), []);
  const _move = useMemo(() => new THREE.Vector3(), []);
  const _up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useFrame((_, delta) => {
    if (isInputFocused()) {
      keysDown.current.clear();
      return;
    }

    // Movement
    const keys = keysDown.current;
    if (keys.size > 0) {
      const speed = delta * flySpeed;
      camera.getWorldDirection(_forward);
      _right.crossVectors(_forward, _up).normalize();
      _move.set(0, 0, 0);

      if (keys.has('w') || keys.has('arrowup')) _move.addScaledVector(_forward, speed);
      if (keys.has('s') || keys.has('arrowdown')) _move.addScaledVector(_forward, -speed);
      if (keys.has('a') || keys.has('arrowleft')) _move.addScaledVector(_right, -speed);
      if (keys.has('d') || keys.has('arrowright')) _move.addScaledVector(_right, speed);
      if (keys.has('e') || keys.has(' ')) _move.y += speed;
      if (keys.has('q')) _move.y -= speed;

      if (_move.lengthSq() > 0) {
        camera.position.add(_move);
      }
    }

    // Always sync audio listener to camera (camera IS the listener)
    const ls = listenerSyncRef.current;
    ls.listenerPosRef.current.copy(camera.position);
    if (ls.onMove) {
      ls.onMove(camera.position.x, camera.position.y, camera.position.z);
    }
    camera.getWorldDirection(_forward);
    ls.listenerForwardRef.current.set(_forward.x, _forward.y, _forward.z);
    if (ls.onRotate) {
      ls.onRotate(_forward.x, _forward.y, _forward.z, 0, 1, 0);
    }
  });

  return null;
}

// FPS-style fly controls for the editor — camera IS the listener.
// Drag (left or right mouse) to look around, WASD to move, Q/E for up/down,
// scroll wheel to dolly, double-click empty space to teleport, F to fit,
// R to reset.
function FlyControls() {
  const { camera, gl } = useThree();
  const { focused } = useContext(ViewportFocusContext);
  const listenerSync = useContext(ListenerSyncContext);
  const listenerSyncRef = useRef(listenerSync);
  listenerSyncRef.current = listenerSync;
  const keysDown = useRef(new Set<string>());
  const dragging = useRef(false);
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const flySpeed = 6;
  const lookSensitivity = 0.003;
  const resetRef = useContext(CameraResetContext);
  const zoomRef = useContext(CameraZoomContext);
  const fitRef = useContext(CameraFitContext);

  // Initialize euler from camera
  useEffect(() => {
    euler.current.setFromQuaternion(camera.quaternion, 'YXZ');
  }, [camera]);

  useEffect(() => {
    resetRef.current = () => {
      camera.position.set(-1, 1, 0);
      euler.current.set(0, 0, 0, 'YXZ');
      camera.quaternion.setFromEuler(euler.current);
    };
    return () => { resetRef.current = null; };
  }, [camera, resetRef]);

  useEffect(() => {
    zoomRef.current = (dir: number) => {
      // Move camera forward/backward along view direction
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      const step = dir > 0 ? 2 : -2;
      camera.position.addScaledVector(fwd, step);
    };
    return () => { zoomRef.current = null; };
  }, [camera, zoomRef]);

  useEffect(() => {
    fitRef.current = () => {
      // Compute AABB of all voice positions and fly camera to see them
      const box = new THREE.Box3();
      let hasPoints = false;
      camera.parent?.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.geometry) {
          const pos = obj.position;
          if (pos.x !== 0 || pos.y !== 0 || pos.z !== 0) {
            box.expandByPoint(pos);
            hasPoints = true;
          }
        }
      });
      if (!hasPoints) {
        box.expandByPoint(new THREE.Vector3(-5, 0, -5));
        box.expandByPoint(new THREE.Vector3(5, 3, 5));
      }
      const center = new THREE.Vector3();
      box.getCenter(center);
      const bSize = new THREE.Vector3();
      box.getSize(bSize);
      const maxDim = Math.max(bSize.x, bSize.y, bSize.z, 2);
      const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
      const dist = maxDim / (2 * Math.tan(fov / 2)) * 1.5;
      camera.position.set(center.x, center.y + dist * 0.3, center.z + dist);
      // Look at center
      const dir = center.clone().sub(camera.position).normalize();
      euler.current.y = Math.atan2(-dir.x, -dir.z);
      euler.current.x = Math.asin(dir.y);
      camera.quaternion.setFromEuler(euler.current);
    };
    return () => { fitRef.current = null; };
  }, [camera, fitRef]);

  const _forward = useMemo(() => new THREE.Vector3(), []);
  const _right = useMemo(() => new THREE.Vector3(), []);
  const _move = useMemo(() => new THREE.Vector3(), []);
  const _up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  const MOVE_KEYS = useMemo(() => new Set(['w', 'a', 's', 'd', 'q', 'e', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']), []);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    // Skip when an editor or input is focused
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ||
        el?.closest('.monaco-editor') != null) return;
    const key = e.key.toLowerCase();
    // F = fit to scene, R = reset to origin (only when viewport is engaged)
    if (focusedRef.current || dragging.current) {
      if (key === 'f') { fitRef.current?.(); e.preventDefault(); return; }
      if (key === 'r') { resetRef.current?.(); e.preventDefault(); return; }
    }
    keysDown.current.add(key);
    if (focusedRef.current && MOVE_KEYS.has(key)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, [MOVE_KEYS, fitRef, resetRef]);

  const onKeyUp = useCallback((e: KeyboardEvent) => {
    keysDown.current.delete(e.key.toLowerCase());
  }, []);

  const onMouseDown = useCallback((e: MouseEvent) => {
    // Left or right drag both rotate the camera. Right kept as muscle-memory alias.
    if (e.button !== 0 && e.button !== 2) return;
    dragging.current = true;
    gl.domElement.style.cursor = 'grabbing';
  }, [gl]);

  const onMouseUp = useCallback((e: MouseEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    dragging.current = false;
    gl.domElement.style.cursor = 'grab';
  }, [gl]);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) return;
    euler.current.y -= e.movementX * lookSensitivity;
    euler.current.x -= e.movementY * lookSensitivity;
    euler.current.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, euler.current.x));
    camera.quaternion.setFromEuler(euler.current);
  }, [camera]);

  // Release drag if mouseup fires off-canvas
  const onWindowMouseUp = useCallback((e: MouseEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    if (dragging.current) {
      dragging.current = false;
      gl.domElement.style.cursor = 'grab';
    }
  }, [gl]);

  // Scroll wheel = dolly along view direction
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    // Trackpad pinch and mouse wheel both come through deltaY; cap step size
    const step = Math.max(-1.5, Math.min(1.5, -e.deltaY * 0.01));
    camera.position.addScaledVector(fwd, step);
  }, [camera]);

  // Double-click empty space = teleport listener (xz only, preserve height)
  const onDblClick = useCallback((e: MouseEvent) => {
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (ray.ray.intersectPlane(plane, hit)) {
      camera.position.set(hit.x, camera.position.y, hit.z);
    }
  }, [camera, gl]);

  useEffect(() => {
    const el = gl.domElement;
    el.style.cursor = 'grab';
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('mouseup', onMouseUp);
    el.addEventListener('mousemove', onMouseMove);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', onDblClick);
    window.addEventListener('mouseup', onWindowMouseUp);
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp);
    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('mousemove', onMouseMove);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onDblClick);
      window.removeEventListener('mouseup', onWindowMouseUp);
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [gl, onKeyDown, onKeyUp, onMouseDown, onMouseUp, onMouseMove, onWindowMouseUp, onWheel, onDblClick]);

  useEffect(() => {
    if (!focused) keysDown.current.clear();
  }, [focused]);

  useFrame((_, delta) => {
    // WASD movement when focused or actively dragging the viewport
    const active = focused || dragging.current;
    if (active) {
      const keys = keysDown.current;
      if (keys.size > 0) {
        const speed = delta * flySpeed;
        camera.getWorldDirection(_forward);
        _right.crossVectors(_forward, _up).normalize();
        _move.set(0, 0, 0);

        if (keys.has('w') || keys.has('arrowup')) _move.addScaledVector(_forward, speed);
        if (keys.has('s') || keys.has('arrowdown')) _move.addScaledVector(_forward, -speed);
        if (keys.has('a') || keys.has('arrowleft')) _move.addScaledVector(_right, -speed);
        if (keys.has('d') || keys.has('arrowright')) _move.addScaledVector(_right, speed);
        if (keys.has('e') || keys.has(' ')) _move.y += speed;
        if (keys.has('q')) _move.y -= speed;

        if (_move.lengthSq() > 0) {
          camera.position.add(_move);
        }
      }
    }

    // Always sync audio listener to camera (camera IS the listener)
    const ls = listenerSyncRef.current;
    ls.listenerPosRef.current.copy(camera.position);
    if (ls.onMove) {
      ls.onMove(camera.position.x, camera.position.y, camera.position.z);
    }
    if (!ls.externalTrackingActive) {
      camera.getWorldDirection(_forward);
      ls.listenerForwardRef.current.set(_forward.x, _forward.y, _forward.z);
      if (ls.onRotate) {
        ls.onRotate(_forward.x, _forward.y, _forward.z, 0, 1, 0);
      }
    }
  });

  return null;
}

/** Compute a contrasting color: invert lightness so it's always visible. */
function contrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Perceived luminance
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.5 ? '#1a1a1a' : '#e8e8e8';
}

const SceneInner = memo(function SceneInner({ tracksRef, bgColor, listenerSync, showGrid, overlayMode }: { tracksRef: React.RefObject<TrackState[]>; bgColor: string; listenerSync: ListenerSync; showGrid: boolean; overlayMode?: boolean }) {
  const listenerColor = useMemo(() => contrastColor(bgColor), [bgColor]);
  // Determine if bg is dark for voice color remapping
  const isDarkBg = useMemo(() => {
    if (overlayMode) return false; // overlay uses page bg (light by default)
    const hex = bgColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) < 128;
  }, [bgColor, overlayMode]);
  return (
    <OverlayModeContext.Provider value={!!overlayMode}>
      <DarkBgContext.Provider value={isDarkBg}>
      <ListenerSyncContext.Provider value={listenerSync}>
        <ambientLight intensity={overlayMode ? 0.8 : 0.5} />
        <directionalLight position={[10, 15, 10]} intensity={overlayMode ? 1.5 : 0.3} />
        {overlayMode && <directionalLight position={[-8, 5, -5]} intensity={0.6} />}
        {overlayMode && <directionalLight position={[0, -5, 8]} intensity={0.3} />}
        {/* Normal grid for editor; subtle grid for overlay to indicate 3D space */}
        {overlayMode ? (
          <Grid
            args={[40, 40]}
            cellColor="#888888"
            sectionColor="#aaaaaa"
            cellSize={2}
            sectionSize={8}
            fadeDistance={35}
            fadeStrength={4}
            infiniteGrid
          />
        ) : (
          showGrid && (
            <Grid
              args={[20, 20]}
              cellColor="#e0ddd4"
              sectionColor="#d0cdc4"
              fadeDistance={25}
              infiniteGrid
            />
          )
        )}
        {/* Camera IS the listener in both modes — no separate listener visual needed */}
        <AudioSourcePool tracksRef={tracksRef} />
        {overlayMode ? <OverlayFlyControls /> : <FlyControls />}
        {!overlayMode && <AxisGizmo />}
        {!overlayMode && (
          <EffectComposer multisampling={8} frameBufferType={THREE.HalfFloatType}>
            <Bloom
              luminanceThreshold={0.2}
              luminanceSmoothing={0.8}
              intensity={0.8}
              mipmapBlur
            />
          </EffectComposer>
        )}
      </ListenerSyncContext.Provider>
      </DarkBgContext.Provider>
    </OverlayModeContext.Provider>
  );
});

/** Inner component to listen for container resize and trigger R3F canvas resize */
function CanvasResizer({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  const { gl, camera } = useThree();
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w > 0 && h > 0) {
        gl.setSize(w, h, false);
        if ('aspect' in camera) {
          (camera as THREE.PerspectiveCamera).aspect = w / h;
          (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [gl, camera, containerRef]);
  return null;
}

/** Small compass/heading indicator in the top-left of the Space panel */
function HeadingIndicator({ forwardRef, color, faceTrackingActive }: {
  forwardRef: React.MutableRefObject<THREE.Vector3>;
  color: string;
  faceTrackingActive: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const draw = () => {
      const fwd = forwardRef.current;
      const yaw = Math.atan2(fwd.x, fwd.z);

      const size = 36;
      const cx = size / 2, cy = size / 2;
      const r = 14;
      ctx.clearRect(0, 0, size, size);

      // Circle
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = color + '30';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Direction arrow (pointing where listener faces)
      const ax = cx + Math.sin(yaw) * r * 0.85;
      const ay = cy - Math.cos(yaw) * r * 0.85;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ax, ay);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Arrow head
      const headLen = 4;
      const angle = -yaw + Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - headLen * Math.cos(angle - 0.4), ay - headLen * Math.sin(angle - 0.4));
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - headLen * Math.cos(angle + 0.4), ay - headLen * Math.sin(angle + 0.4));
      ctx.stroke();

      // Dot at center
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fillStyle = color + '60';
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [forwardRef, color]);

  return (
    <div style={{
      position: 'absolute',
      top: 8,
      left: 8,
      zIndex: 10,
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      pointerEvents: 'none',
    }}>
      <canvas ref={canvasRef} width={36} height={36} style={{ width: 36, height: 36 }} />
      {faceTrackingActive && (
        <div style={{
          fontSize: 12,
          fontFamily: "'SF Mono', monospace",
          color,
          opacity: 0.5,
          letterSpacing: '0.05em',
        }}>
          CAM
        </div>
      )}
    </div>
  );
}

export const SpatialViewport = memo(function SpatialViewport({ tracksRef, bgColor = '#f4f3ee', onBgColorChange, onListenerMove, onListenerRotate, overlayMode, faceTracking }: SpatialViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  // Listener always follows camera orientation (linked mode removed — it was confusing)
  const [gridVisible, setGridVisible] = useState(true);
  const listenerPosRef = useRef(new THREE.Vector3(0, 0, 0));
  const listenerForwardRef = useRef(new THREE.Vector3(0, 0, -1));
  const emptyFaceMeshRef = useRef<FaceMeshData | null>(null);
  const cameraResetRef = useRef<(() => void) | null>(null);
  const cameraZoomRef = useRef<((dir: number) => void) | null>(null);
  const cameraFitRef = useRef<(() => void) | null>(null);

  // Wrap the orientation callback to also update the forward ref for triangle rotation
  const handleOrientationChange = useCallback((fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => {
    listenerForwardRef.current.set(fx, fy, fz);
    onListenerRotate?.(fx, fy, fz, ux, uy, uz);
  }, [onListenerRotate]);

  const faceTrackingEnabled = faceTracking?.enabled ?? false;
  const faceMeshRef = faceTracking?.meshRef ?? emptyFaceMeshRef;

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) {
        setFocused(true);
      } else {
        setFocused(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocused(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const focusValue = useMemo(() => ({ focused }), [focused]);
  const uiColor = useMemo(() => contrastColor(bgColor), [bgColor]);
  const listenerSync = useMemo<ListenerSync>(() => ({
    onMove: onListenerMove,
    onRotate: handleOrientationChange,
    linked: false,
    listenerPosRef,
    listenerForwardRef,
    externalTrackingActive: faceTrackingEnabled,
    faceMeshRef,
  }), [onListenerMove, handleOrientationChange, faceTrackingEnabled, faceMeshRef]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 'inherit',
        overflow: 'hidden',
        outline: overlayMode ? 'none' : (focused ? '2px solid #1a3a2a' : 'none'),
        outlineOffset: '-2px',
        position: 'relative',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Heading indicator — always shows listener direction */}
      {!overlayMode && <HeadingIndicator forwardRef={listenerForwardRef} color={uiColor} faceTrackingActive={faceTrackingEnabled} />}

      {/* Camera (webcam face-tracking) toggle — bottom-left, non-overlay only */}
      {!overlayMode && faceTracking?.toggle && (
        <button
          onClick={faceTracking.toggle}
          disabled={faceTracking.loading}
          title={faceTracking.enabled ? 'Disable camera head tracking' : faceTracking.error ? faceTracking.error : 'Enable camera head tracking (rotate with your head)'}
          style={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px 4px 8px',
            background: faceTracking.enabled ? uiColor : 'transparent',
            color: faceTracking.enabled ? bgColor : uiColor,
            border: `1.5px solid ${faceTracking.error ? '#8b0000' : uiColor + '40'}`,
            borderRadius: 16,
            cursor: faceTracking.loading ? 'wait' : 'pointer',
            fontSize: 12,
            fontFamily: "'Inter', system-ui, sans-serif",
            fontWeight: 500,
            opacity: faceTracking.enabled ? 1 : 0.7,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="10" r="3" />
            <path d="M2 8l3-3h4l2-2 2 2h4l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8z" />
          </svg>
          {faceTracking.loading ? 'Loading…' : 'Camera'}
        </button>
      )}

      <Canvas
        camera={overlayMode
          ? { position: [-1, 1, 0], fov: 65 }
          : { position: [-1, 1, 0], fov: 55 }
        }
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        resize={{ scroll: false, debounce: 0, offsetSize: true }}
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.setClearColor(overlayMode ? 0x000000 : bgColor, overlayMode ? 0 : 1);
        }}
      >
        <BgColorUpdater color={bgColor} transparent={overlayMode} />
        <CameraResetContext.Provider value={cameraResetRef}>
          <CameraZoomContext.Provider value={cameraZoomRef}>
            <CameraFitContext.Provider value={cameraFitRef}>
              <ViewportFocusContext.Provider value={focusValue}>
                <SceneInner tracksRef={tracksRef} bgColor={bgColor} listenerSync={listenerSync} showGrid={gridVisible} overlayMode={overlayMode} />
              </ViewportFocusContext.Provider>
            </CameraFitContext.Provider>
          </CameraZoomContext.Provider>
        </CameraResetContext.Provider>
      </Canvas>
      {/* Bottom-right controls — hidden in overlay mode */}
      <div style={{ position: 'absolute', bottom: 8, right: 8, zIndex: 10, display: overlayMode ? 'none' : 'flex', gap: 6, alignItems: 'flex-end' }}>
        <button
          onClick={() => setGridVisible(v => !v)}
          title={gridVisible ? 'Hide grid' : 'Show grid'}
          style={{
            width: 28,
            height: 28,
            borderRadius: 4,
            background: gridVisible ? uiColor : 'none',
            border: `1.5px solid ${uiColor}40`,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            opacity: gridVisible ? 1 : 0.7,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={gridVisible ? bgColor : uiColor} strokeWidth="2.5" strokeLinecap="round">
            <line x1="3" y1="3" x2="3" y2="21" />
            <line x1="9" y1="3" x2="9" y2="21" />
            <line x1="15" y1="3" x2="15" y2="21" />
            <line x1="21" y1="3" x2="21" y2="21" />
            <line x1="3" y1="3" x2="21" y2="3" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="3" y1="15" x2="21" y2="15" />
            <line x1="3" y1="21" x2="21" y2="21" />
          </svg>
        </button>
        <button
          onClick={() => {
            cameraResetRef.current?.();
          }}
          title="Reset camera to origin"
          style={{
            width: 28,
            height: 28,
            borderRadius: 4,
            background: 'none',
            border: `1.5px solid ${uiColor}40`,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            color: uiColor,
            fontSize: '16px',
            fontFamily: "'SF Mono', monospace",
            lineHeight: 1,
            opacity: 0.7,
          }}
        >
          +
        </button>
        {onBgColorChange && (
          <div>
            <div
              onClick={() => setShowPicker(!showPicker)}
              style={{
                width: 28,
                height: 28,
                borderRadius: 4,
                background: bgColor,
                border: `1.5px solid ${uiColor}40`,
                cursor: 'pointer',
              }}
            />
          {showPicker && (
            <div style={{
              position: 'absolute',
              bottom: 28,
              right: 0,
              background: '#fff',
              borderRadius: 6,
              padding: 8,
              boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
            }}>
              <input
                type="color"
                value={bgColor}
                onChange={(e) => onBgColorChange(e.target.value)}
                style={{ width: 48, height: 32, border: 'none', cursor: 'pointer', padding: 0 }}
              />
            </div>
          )}
          </div>
        )}
      </div>
    </div>
  );
});
