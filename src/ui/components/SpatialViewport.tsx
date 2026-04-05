import { useRef, useEffect, useCallback, useState, useMemo, memo, createContext, useContext } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Trail } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { TrackState } from '../../engine';
import { useHeadTracking } from '../hooks/useHeadTracking';
import { useFaceTracking, type FaceMeshData } from '../hooks/useFaceTracking';

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
  // Unknown visual keyword — treat as sphere
  return 'sphere';
}

// ── Shared useFrame logic for a single voice ─────────────────

function useAudioSourceFrame(
  trackRef: React.RefObject<TrackState | null>,
  meshRef: React.RefObject<THREE.Mesh | null>,
  matRef: React.RefObject<THREE.MeshStandardMaterial | null>,
  labelRef: React.RefObject<THREE.Sprite | null>,
) {
  const labelTexRef = useRef<THREE.CanvasTexture | null>(null);
  const prevLabel = useRef<string>('');
  const isDarkBg = useContext(DarkBgContext);

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

    if (labelRef.current) {
      const yOff = meshRef.current ? 0.55 : 0.3;
      labelRef.current.position.set(track.position.x, track.position.y + yOff, track.position.z);

      // Clean label: strip path prefix, generation indices, underscores → spaces
      const raw = track.statement.clip.split('/').pop() ?? '';
      const label = raw
        .replace(/_\d+$/g, '')      // strip trailing _0, _1 indices
        .replace(/_\d+$/g, '')      // strip second level _0 (e.g. _0_0)
        .replace(/_/g, ' ')         // underscores → spaces
        .trim();

      if (label !== prevLabel.current) {
        prevLabel.current = label;
        if (labelTexRef.current) labelTexRef.current.dispose();

        // Render at 3× resolution for crisp text on retina displays
        const SCALE = 3;
        const H = 48 * SCALE;
        const FONT_SIZE = 22 * SCALE;
        const PADDING_X = 18 * SCALE;
        const PADDING_Y = 10 * SCALE;

        // Measure text first to size canvas
        const offscreen = document.createElement('canvas');
        const offCtx = offscreen.getContext('2d')!;
        offCtx.font = `600 ${FONT_SIZE}px Inter, system-ui, sans-serif`;
        const textW = offCtx.measureText(label).width;

        const W = textW + PADDING_X * 2;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d')!;

        // Background pill
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

        // Text
        ctx.font = `600 ${FONT_SIZE}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, W / 2, H / 2);

        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        labelTexRef.current = tex;

        // Scale sprite to match canvas aspect ratio; world height = 0.28
        const worldH = 0.28;
        const worldW = worldH * (W / H);
        labelRef.current.scale.set(worldW, worldH, 1);

        (labelRef.current.material as THREE.SpriteMaterial).map = tex;
        (labelRef.current.material as THREE.SpriteMaterial).needsUpdate = true;
      }
    }
  });
}

// ── Geometry components ──────────────────────────────────────

function SphereGeo({ meshRef, matRef }: {
  meshRef: React.RefObject<THREE.Mesh | null>;
  matRef: React.RefObject<THREE.MeshStandardMaterial | null>;
}) {
  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1, 48, 48]} />
      <meshPhysicalMaterial
        ref={matRef as any}
        emissiveIntensity={0.4}
        transparent
        opacity={0.92}
        roughness={0.15}
        metalness={0.1}
        clearcoat={0.8}
        clearcoatRoughness={0.1}
      />
    </mesh>
  );
}

function CubeGeo({ meshRef, matRef }: {
  meshRef: React.RefObject<THREE.Mesh | null>;
  matRef: React.RefObject<THREE.MeshStandardMaterial | null>;
}) {
  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[1, 1, 1]} />
      <meshPhysicalMaterial
        ref={matRef as any}
        emissiveIntensity={0.4}
        transparent
        opacity={0.92}
        roughness={0.15}
        metalness={0.1}
        clearcoat={0.8}
        clearcoatRoughness={0.1}
      />
    </mesh>
  );
}

function LabelSprite({ labelRef }: { labelRef: React.RefObject<THREE.Sprite | null> }) {
  return (
    <sprite ref={labelRef} scale={[2.0, 0.28, 1]} renderOrder={999}>
      <spriteMaterial transparent depthTest={false} toneMapped={false} />
    </sprite>
  );
}

// ── Voice with no visual — sphere + label ────────────────────

function AudioSourceNone({ trackRef }: { trackRef: React.RefObject<TrackState | null> }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const labelRef = useRef<THREE.Sprite>(null);

  useAudioSourceFrame(trackRef, meshRef, matRef, labelRef);

  return (
    <>
      <SphereGeo meshRef={meshRef} matRef={matRef} />
      <LabelSprite labelRef={labelRef} />
    </>
  );
}

// ── Voice with mesh (sphere or cube), no trail ───────────────

function AudioSourceMesh({ trackRef, shape }: { trackRef: React.RefObject<TrackState | null>; shape: 'sphere' | 'cube' }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const labelRef = useRef<THREE.Sprite>(null);

  useAudioSourceFrame(trackRef, meshRef, matRef, labelRef);

  return (
    <>
      {shape === 'cube'
        ? <CubeGeo meshRef={meshRef} matRef={matRef} />
        : <SphereGeo meshRef={meshRef} matRef={matRef} />
      }
      <LabelSprite labelRef={labelRef} />
    </>
  );
}

// ── Voice with trail only (trail wraps a small sphere for the trail point) ──

function AudioSourceTrailOnly({ trackRef }: { trackRef: React.RefObject<TrackState | null> }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const labelRef = useRef<THREE.Sprite>(null);
  const trailRef = useRef<any>(null);
  const overlayMode = useContext(OverlayModeContext);
  const isDarkBg = useContext(DarkBgContext);

  useAudioSourceFrame(trackRef, meshRef, matRef, labelRef);

  useFrame(() => {
    const track = trackRef.current;
    if (!track || !trailRef.current) return;
    const displayColor = remapColor(track.color, isDarkBg, track.seed);
    const mat = trailRef.current.material as any;
    if (mat?.uniforms?.color) {
      mat.uniforms.color.value.set(displayColor);
    } else if (mat?.color) {
      mat.color.set(displayColor);
    }
  });

  const trailWidth = overlayMode ? 6 : 2.5;
  const trailLength = overlayMode ? 140 : 80;

  return (
    <>
      <Trail ref={trailRef} width={trailWidth} length={trailLength} decay={1} attenuation={(w) => w * w}>
        <mesh ref={meshRef}>
          <sphereGeometry args={[1, 48, 48]} />
          <meshPhysicalMaterial
            ref={matRef as any}
            emissiveIntensity={0.4}
            transparent
            opacity={0.92}
            roughness={0.15}
            metalness={0.1}
            clearcoat={0.8}
            clearcoatRoughness={0.1}
          />
        </mesh>
      </Trail>
      <LabelSprite labelRef={labelRef} />
    </>
  );
}

// ── Voice with trail + mesh ──────────────────────────────────

function AudioSourceTrailMesh({ trackRef, shape }: { trackRef: React.RefObject<TrackState | null>; shape: 'sphere' | 'cube' }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const labelRef = useRef<THREE.Sprite>(null);
  const trailRef = useRef<any>(null);
  const overlayMode = useContext(OverlayModeContext);
  const isDarkBg = useContext(DarkBgContext);

  useAudioSourceFrame(trackRef, meshRef, matRef, labelRef);

  useFrame(() => {
    const track = trackRef.current;
    if (!track || !trailRef.current) return;
    const displayColor = remapColor(track.color, isDarkBg, track.seed);
    const mat = trailRef.current.material as any;
    if (mat?.uniforms?.color) {
      mat.uniforms.color.value.set(displayColor);
    } else if (mat?.color) {
      mat.color.set(displayColor);
    }
  });

  const trailWidth = overlayMode ? 6 : 2.5;
  const trailLength = overlayMode ? 140 : 80;

  return (
    <>
      <Trail ref={trailRef} width={trailWidth} length={trailLength} decay={1} attenuation={(w) => w * w}>
        <mesh ref={meshRef}>
          {shape === 'cube'
            ? <boxGeometry args={[1, 1, 1]} />
            : <sphereGeometry args={[1, 48, 48]} />
          }
          <meshPhysicalMaterial
            ref={matRef as any}
            emissiveIntensity={0.4}
            transparent
            opacity={0.92}
            roughness={0.15}
            metalness={0.1}
            clearcoat={0.8}
            clearcoatRoughness={0.1}
          />
        </mesh>
      </Trail>
      <LabelSprite labelRef={labelRef} />
    </>
  );
}

// ── Pool ─────────────────────────────────────────────────────

const MAX_VOICES = 128;

function AudioSourcePool({ tracksRef }: { tracksRef: React.RefObject<TrackState[]> }) {
  const trackRefs = useMemo(() => {
    const refs: React.RefObject<TrackState | null>[] = [];
    for (let i = 0; i < MAX_VOICES; i++) {
      refs.push({ current: null });
    }
    return refs;
  }, []);

  const [slotInfo, setSlotInfo] = useState<{ count: number; kinds: VisualKind[] }>({ count: 0, kinds: [] });

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
          case 'none':         return <AudioSourceNone key={i} trackRef={ref} />;
          case 'sphere':       return <AudioSourceMesh key={i} trackRef={ref} shape="sphere" />;
          case 'cube':         return <AudioSourceMesh key={i} trackRef={ref} shape="cube" />;
          case 'trail':        return <AudioSourceTrailOnly key={i} trackRef={ref} />;
          case 'trail+sphere': return <AudioSourceTrailMesh key={i} trackRef={ref} shape="sphere" />;
          case 'trail+cube':   return <AudioSourceTrailMesh key={i} trackRef={ref} shape="cube" />;
          default:             return <AudioSourceNone key={i} trackRef={ref} />;
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

// Overlay fly controls — WASD + right-click when no text input is focused
/** FPS controls for overlay: click anywhere to toggle mouse-look, WASD to move.
 *  Camera IS the listener — spatial audio follows your perspective.
 *  Dispatches 'satie-mouselook' CustomEvent so the Chat UI can show the lock state. */
function OverlayFlyControls() {
  const { camera } = useThree();
  const listenerSync = useContext(ListenerSyncContext);
  const listenerSyncRef = useRef(listenerSync);
  listenerSyncRef.current = listenerSync;
  const keysDown = useRef(new Set<string>());
  const mouseLocked = useRef(false);
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const flySpeed = 6;
  const lookSensitivity = 0.003;

  const isInputFocused = useCallback(() => {
    const el = document.activeElement;
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ||
           el?.closest('header') != null || el?.closest('nav') != null;
  }, []);

  const setLocked = useCallback((v: boolean) => {
    mouseLocked.current = v;
    window.dispatchEvent(new CustomEvent('satie-mouselook', { detail: v }));
  }, []);

  // Initialize euler from camera
  useEffect(() => {
    euler.current.setFromQuaternion(camera.quaternion, 'YXZ');
  }, [camera]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (isInputFocused()) return;
    const key = e.key.toLowerCase();
    // ESC unlocks mouse look
    if (key === 'escape' && mouseLocked.current) {
      setLocked(false);
      return;
    }
    keysDown.current.add(key);
    if (['w', 'a', 's', 'd', 'q', 'e', ' '].includes(key)) {
      e.preventDefault();
    }
  }, [isInputFocused, setLocked]);

  const onKeyUp = useCallback((e: KeyboardEvent) => {
    keysDown.current.delete(e.key.toLowerCase());
  }, []);

  const onClick = useCallback((e: MouseEvent) => {
    // Don't toggle if clicking on interactive UI elements
    const target = e.target as HTMLElement;
    if (target.closest('header') || target.closest('button') || target.closest('a') || target.closest('input') || target.closest('details')) return;
    setLocked(!mouseLocked.current);
  }, [setLocked]);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!mouseLocked.current) return;
    euler.current.y -= e.movementX * lookSensitivity;
    euler.current.x -= e.movementY * lookSensitivity;
    euler.current.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, euler.current.x));
    camera.quaternion.setFromEuler(euler.current);
  }, [camera]);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('click', onClick);
    window.addEventListener('mousemove', onMouseMove);
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('click', onClick);
      window.removeEventListener('mousemove', onMouseMove);
      setLocked(false);
    };
  }, [onKeyDown, onKeyUp, onClick, onMouseMove, setLocked]);

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

// Unity-style fly camera: WASD when viewport focused
function FlyControls() {
  const { camera, gl } = useThree();
  const { focused } = useContext(ViewportFocusContext);
  const listenerSync = useContext(ListenerSyncContext);
  // Ref to keep useFrame closure in sync with latest context value
  const listenerSyncRef = useRef(listenerSync);
  listenerSyncRef.current = listenerSync;
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const keysDown = useRef(new Set<string>());
  const rightMouseDown = useRef(false);
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const flySpeed = 5;
  const resetRef = useContext(CameraResetContext);
  const zoomRef = useContext(CameraZoomContext);
  const fitRef = useContext(CameraFitContext);

  useEffect(() => {
    resetRef.current = () => {
      camera.position.set(4, 6, 8);
      if (controlsRef.current) {
        controlsRef.current.target.set(0, 0, 0);
        controlsRef.current.update();
      }
    };
    return () => { resetRef.current = null; };
  }, [camera, resetRef]);

  useEffect(() => {
    zoomRef.current = (dir: number) => {
      // Dolly camera toward/away from orbit target
      const target = controlsRef.current?.target ?? new THREE.Vector3();
      const offset = camera.position.clone().sub(target);
      const factor = dir > 0 ? 0.75 : 1.33;
      offset.multiplyScalar(factor);
      camera.position.copy(target).add(offset);
      controlsRef.current?.update();
    };
    return () => { zoomRef.current = null; };
  }, [camera, zoomRef]);

  useEffect(() => {
    fitRef.current = () => {
      // Compute AABB of all voice positions
      const sync = listenerSync;
      // Access scene children to find voice positions
      const scene = gl.domElement.parentElement;
      if (!controlsRef.current) return;
      // We'll read positions from the tracksRef via closure — but we don't have it here.
      // Instead, scan all meshes in the scene
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
        // Default: frame the origin area
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
      camera.position.set(center.x + dist * 0.5, center.y + dist * 0.5, center.z + dist);
      controlsRef.current.target.copy(center);
      controlsRef.current.update();
    };
    return () => { fitRef.current = null; };
  }, [camera, fitRef, gl, listenerSync]);

  const _forward = useMemo(() => new THREE.Vector3(), []);
  const _right = useMemo(() => new THREE.Vector3(), []);
  const _move = useMemo(() => new THREE.Vector3(), []);
  const _up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  const MOVE_KEYS = useMemo(() => new Set(['w', 'a', 's', 'd', 'q', 'e', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']), []);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    keysDown.current.add(key);
    if (focusedRef.current && MOVE_KEYS.has(key)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, [MOVE_KEYS]);

  const onKeyUp = useCallback((e: KeyboardEvent) => {
    keysDown.current.delete(e.key.toLowerCase());
  }, []);

  const onMouseDown = useCallback((e: MouseEvent) => {
    if (e.button === 2) rightMouseDown.current = true;
  }, []);

  const onMouseUp = useCallback((e: MouseEvent) => {
    if (e.button === 2) rightMouseDown.current = false;
  }, []);

  useEffect(() => {
    const el = gl.domElement;
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp);
    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [gl, onKeyDown, onKeyUp, onMouseDown, onMouseUp]);

  useEffect(() => {
    if (!focused) keysDown.current.clear();
  }, [focused]);

  useFrame((_, delta) => {
    const ls = listenerSyncRef.current;
    // Always sync AudioContext.listener to the triangle position
    const lp = ls.listenerPosRef.current;
    if (ls.onMove) {
      ls.onMove(lp.x, lp.y, lp.z);
    }
    if (!ls.externalTrackingActive) {
      // Default: orientation from camera direction
      camera.getWorldDirection(_forward);
      ls.listenerForwardRef.current.set(_forward.x, _forward.y, _forward.z);
      if (ls.onRotate) {
        ls.onRotate(_forward.x, _forward.y, _forward.z, _up.x, _up.y, _up.z);
      }
    }

    const active = focused || rightMouseDown.current;

    if (ls.linked) {
      // 3rd-person mode: WASD moves the listener, camera follows behind
      if (active) {
        const keys = keysDown.current;
        if (keys.size > 0) {
          const speed = delta * flySpeed;
          // Movement relative to camera direction (projected to XZ for ground movement)
          camera.getWorldDirection(_forward);
          _forward.y = 0;
          _forward.normalize();
          _right.crossVectors(_forward, _up).normalize();
          _move.set(0, 0, 0);

          if (keys.has('w') || keys.has('arrowup')) _move.addScaledVector(_forward, speed);
          if (keys.has('s') || keys.has('arrowdown')) _move.addScaledVector(_forward, -speed);
          if (keys.has('a') || keys.has('arrowleft')) _move.addScaledVector(_right, -speed);
          if (keys.has('d') || keys.has('arrowright')) _move.addScaledVector(_right, speed);
          if (keys.has('e') || keys.has(' ')) _move.y += speed;
          if (keys.has('q')) _move.y -= speed;

          if (_move.lengthSq() > 0) {
            lp.add(_move);
          }
        }
      }

      // Keep orbit target locked on the listener
      if (controlsRef.current) {
        controlsRef.current.target.copy(lp);
      }
    } else {
      // Free camera mode: WASD moves the camera
      if (!active) return;

      const keys = keysDown.current;
      if (keys.size === 0) return;
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
        if (controlsRef.current) {
          controlsRef.current.target.add(_move);
        }
      }
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.05}
      mouseButtons={{
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.ROTATE,
      }}
    />
  );
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
        {!overlayMode && <Listener color={listenerColor} faceTrackingActive={listenerSync.externalTrackingActive} />}
        {!overlayMode && <HearingCone color={listenerColor} />}
        <AudioSourcePool tracksRef={tracksRef} />
        {overlayMode ? <OverlayFlyControls /> : <FlyControls />}
        {!overlayMode && <AxisGizmo />}
        {!overlayMode && (
          <EffectComposer>
            <Bloom
              luminanceThreshold={0.4}
              luminanceSmoothing={0.9}
              intensity={0.6}
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

export const SpatialViewport = memo(function SpatialViewport({ tracksRef, bgColor = '#f4f3ee', onBgColorChange, onListenerMove, onListenerRotate, overlayMode }: SpatialViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  // Listener always follows camera orientation (linked mode removed — it was confusing)
  const [gridVisible, setGridVisible] = useState(true);
  const listenerPosRef = useRef(new THREE.Vector3(0, 0, 0));
  const listenerForwardRef = useRef(new THREE.Vector3(0, 0, -1));
  const cameraResetRef = useRef<(() => void) | null>(null);
  const cameraZoomRef = useRef<((dir: number) => void) | null>(null);
  const cameraFitRef = useRef<(() => void) | null>(null);

  // Wrap the orientation callback to also update the forward ref for triangle rotation
  const handleOrientationChange = useCallback((fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => {
    listenerForwardRef.current.set(fx, fy, fz);
    onListenerRotate?.(fx, fy, fz, ux, uy, uz);
  }, [onListenerRotate]);

  const headTracking = useHeadTracking(handleOrientationChange);
  const faceTracking = useFaceTracking(handleOrientationChange);

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
    externalTrackingActive: faceTracking.enabled || headTracking.enabled,
    faceMeshRef: faceTracking.meshRef,
  }), [onListenerMove, handleOrientationChange, faceTracking.enabled, headTracking.enabled, faceTracking.meshRef]);

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
      {!overlayMode && <HeadingIndicator forwardRef={listenerForwardRef} color={uiColor} faceTrackingActive={faceTracking.enabled} />}

      <Canvas
        camera={overlayMode
          ? { position: [0, 3, 12], fov: 65 }
          : { position: [4, 6, 8], fov: 55 }
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
            listenerPosRef.current.set(0, 0, 0);
            cameraResetRef.current?.();
          }}
          title="Reset listener to origin"
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
        {/* Webcam face tracking toggle + error display */}
        <div style={{ position: 'relative' }}>
          {faceTracking.error && (
            <div style={{
              position: 'absolute',
              bottom: 26,
              right: 0,
              background: '#8b0000',
              color: '#fff',
              fontSize: 12,
              fontFamily: "'SF Mono', monospace",
              padding: '3px 6px',
              borderRadius: 4,
              whiteSpace: 'nowrap',
              maxWidth: 200,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {faceTracking.error}
            </div>
          )}
          {faceTracking.loading && (
            <div style={{
              position: 'absolute',
              bottom: 26,
              right: 0,
              background: uiColor,
              color: bgColor,
              fontSize: 12,
              fontFamily: "'SF Mono', monospace",
              padding: '3px 6px',
              borderRadius: 4,
              whiteSpace: 'nowrap',
            }}>
              Loading model...
            </div>
          )}
          <button
            onClick={faceTracking.toggle}
            title={faceTracking.enabled ? 'Disable face tracking' : faceTracking.loading ? 'Loading...' : 'Enable face tracking (webcam)'}
            disabled={faceTracking.loading}
            style={{
              width: 28,
              height: 28,
              borderRadius: 4,
              background: faceTracking.error ? '#8b0000' : faceTracking.enabled ? uiColor : 'none',
              border: `1.5px solid ${faceTracking.error ? '#8b0000' : uiColor + '40'}`,
              cursor: faceTracking.loading ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              opacity: faceTracking.enabled ? 1 : faceTracking.loading ? 0.4 : 0.7,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={faceTracking.enabled || faceTracking.error ? bgColor : uiColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="10" r="3" />
              <path d="M2 8l3-3h4l2-2 2 2h4l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8z" />
            </svg>
          </button>
        </div>
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
