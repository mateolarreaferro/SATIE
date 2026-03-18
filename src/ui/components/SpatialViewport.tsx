import { useRef, useEffect, useCallback, useState, useMemo, memo, createContext, useContext } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Trail } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { TrackState } from '../../engine';
import { useHeadTracking } from '../hooks/useHeadTracking';

const ViewportFocusContext = createContext<{ focused: boolean }>({ focused: false });
const CameraResetContext = createContext<React.MutableRefObject<(() => void) | null>>({ current: null });
const CameraZoomContext = createContext<React.MutableRefObject<((dir: number) => void) | null>>({ current: null });
const CameraFitContext = createContext<React.MutableRefObject<(() => void) | null>>({ current: null });

interface ListenerSync {
  onMove?: (x: number, y: number, z: number) => void;
  onRotate?: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void;
  linked: boolean;
  listenerPosRef: React.MutableRefObject<THREE.Vector3>;
}
const ListenerSyncContext = createContext<ListenerSync>({ linked: false, listenerPosRef: { current: new THREE.Vector3() } });

interface SpatialViewportProps {
  tracksRef: React.RefObject<TrackState[]>;
  bgColor?: string;
  onBgColorChange?: (color: string) => void;
  onListenerMove?: (x: number, y: number, z: number) => void;
  onListenerRotate?: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void;
}

function BgColorUpdater({ color }: { color: string }) {
  const { gl } = useThree();
  useEffect(() => {
    gl.setClearColor(color, 1);
  }, [gl, color]);
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

  useFrame(() => {
    const track = trackRef.current;
    if (!track) return;

    if (meshRef.current) {
      meshRef.current.position.set(track.position.x, track.position.y, track.position.z);
      const scale = 0.12 + track.volume * 0.2;
      meshRef.current.scale.setScalar(scale);
    }

    if (matRef.current) {
      matRef.current.color.set(track.color);
      matRef.current.emissive.set(track.color);
      matRef.current.opacity = track.alpha * 0.8;
    }

    if (labelRef.current) {
      const yOff = meshRef.current ? 0.4 : 0.2;
      labelRef.current.position.set(track.position.x, track.position.y + yOff, track.position.z);

      const label = track.statement.clip.split('/').pop() ?? '';
      if (label !== prevLabel.current) {
        prevLabel.current = label;
        if (labelTexRef.current) labelTexRef.current.dispose();
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 32;
        const ctx = canvas.getContext('2d')!;
        ctx.font = '18px Inter, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(26, 58, 42, 0.5)';
        ctx.textAlign = 'center';
        ctx.fillText(label, 128, 22);
        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        labelTexRef.current = tex;
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
      <sphereGeometry args={[1, 24, 24]} />
      <meshStandardMaterial
        ref={matRef}
        emissiveIntensity={0.3}
        transparent
        opacity={0.8}
        roughness={0.6}
        wireframe
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
      <meshStandardMaterial
        ref={matRef}
        emissiveIntensity={0.3}
        transparent
        opacity={0.8}
        roughness={0.6}
        wireframe
      />
    </mesh>
  );
}

function LabelSprite({ labelRef }: { labelRef: React.RefObject<THREE.Sprite | null> }) {
  return (
    <sprite ref={labelRef} scale={[1.2, 0.15, 1]}>
      <spriteMaterial transparent depthTest={false} />
    </sprite>
  );
}

// ── Voice with no visual — audio only, just a label ──────────

function AudioSourceNone({ trackRef }: { trackRef: React.RefObject<TrackState | null> }) {
  const labelRef = useRef<THREE.Sprite>(null);
  const nullMesh = useRef<THREE.Mesh | null>(null);
  const nullMat = useRef<THREE.MeshStandardMaterial | null>(null);

  useAudioSourceFrame(trackRef, nullMesh, nullMat, labelRef);

  // Position the label directly since there's no mesh
  useFrame(() => {
    const track = trackRef.current;
    if (!track || !labelRef.current) return;
    labelRef.current.position.set(track.position.x, track.position.y, track.position.z);
  });

  return <LabelSprite labelRef={labelRef} />;
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

  useAudioSourceFrame(trackRef, meshRef, matRef, labelRef);

  useFrame(() => {
    const track = trackRef.current;
    if (!track || !trailRef.current) return;
    const mat = trailRef.current.material as any;
    if (mat?.uniforms?.color) {
      mat.uniforms.color.value.set(track.color);
    } else if (mat?.color) {
      mat.color.set(track.color);
    }
  });

  return (
    <>
      <Trail ref={trailRef} width={2.5} length={80} decay={1} attenuation={(w) => w * w}>
        <mesh ref={meshRef}>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshStandardMaterial
            ref={matRef}
            emissiveIntensity={0.3}
            transparent
            opacity={0.6}
            roughness={0.6}
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

  useAudioSourceFrame(trackRef, meshRef, matRef, labelRef);

  useFrame(() => {
    const track = trackRef.current;
    if (!track || !trailRef.current) return;
    const mat = trailRef.current.material as any;
    if (mat?.uniforms?.color) {
      mat.uniforms.color.value.set(track.color);
    } else if (mat?.color) {
      mat.color.set(track.color);
    }
  });

  return (
    <>
      <Trail ref={trailRef} width={2.5} length={80} decay={1} attenuation={(w) => w * w}>
        <mesh ref={meshRef}>
          {shape === 'cube'
            ? <boxGeometry args={[1, 1, 1]} />
            : <sphereGeometry args={[1, 24, 24]} />
          }
          <meshStandardMaterial
            ref={matRef}
            emissiveIntensity={0.3}
            transparent
            opacity={0.8}
            roughness={0.6}
            wireframe
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

function Listener({ color }: { color: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const { listenerPosRef } = useContext(ListenerSyncContext);

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.position.set(listenerPosRef.current.x, listenerPosRef.current.y + 0.02, listenerPosRef.current.z);
    }
  });

  return (
    <group ref={groupRef} position={[0, 0.02, 0]}>
      <NoseTriangle color={color} />
    </group>
  );
}

// Unity-style fly camera: WASD when viewport focused
function FlyControls() {
  const { camera, gl } = useThree();
  const { focused } = useContext(ViewportFocusContext);
  const listenerSync = useContext(ListenerSyncContext);
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
    // Always sync AudioContext.listener to the triangle position
    const lp = listenerSync.listenerPosRef.current;
    if (listenerSync.onMove) {
      listenerSync.onMove(lp.x, lp.y, lp.z);
    }
    if (listenerSync.onRotate) {
      // Listener faces toward the orbit target (camera look direction projected onto ground)
      camera.getWorldDirection(_forward);
      listenerSync.onRotate(_forward.x, _forward.y, _forward.z, _up.x, _up.y, _up.z);
    }

    const active = focused || rightMouseDown.current;

    if (listenerSync.linked) {
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

const SceneInner = memo(function SceneInner({ tracksRef, bgColor, listenerSync, showGrid }: { tracksRef: React.RefObject<TrackState[]>; bgColor: string; listenerSync: ListenerSync; showGrid: boolean }) {
  const listenerColor = useMemo(() => contrastColor(bgColor), [bgColor]);
  return (
    <ListenerSyncContext.Provider value={listenerSync}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 15, 10]} intensity={0.3} />
      {showGrid && (
        <Grid
          args={[20, 20]}
          cellColor="#e0ddd4"
          sectionColor="#d0cdc4"
          fadeDistance={25}
          infiniteGrid
        />
      )}
      <Listener color={listenerColor} />
      <AudioSourcePool tracksRef={tracksRef} />
      <FlyControls />
      <AxisGizmo />
      <EffectComposer>
        <Bloom
          luminanceThreshold={0.4}
          luminanceSmoothing={0.9}
          intensity={0.6}
          mipmapBlur
        />
      </EffectComposer>
    </ListenerSyncContext.Provider>
  );
});

export const SpatialViewport = memo(function SpatialViewport({ tracksRef, bgColor = '#f4f3ee', onBgColorChange, onListenerMove, onListenerRotate }: SpatialViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [listenerLinked, setListenerLinked] = useState(false);
  const [gridVisible, setGridVisible] = useState(true);
  const listenerPosRef = useRef(new THREE.Vector3(0, 0, 0));
  const cameraResetRef = useRef<(() => void) | null>(null);
  const cameraZoomRef = useRef<((dir: number) => void) | null>(null);
  const cameraFitRef = useRef<(() => void) | null>(null);
  const headTracking = useHeadTracking(onListenerRotate);

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
    onRotate: onListenerRotate,
    linked: listenerLinked,
    listenerPosRef,
  }), [onListenerMove, onListenerRotate, listenerLinked]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 'inherit',
        overflow: 'hidden',
        outline: focused ? '2px solid #1a3a2a' : 'none',
        outlineOffset: '-2px',
        position: 'relative',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Canvas
        camera={{ position: [4, 6, 8], fov: 55 }}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        gl={{ alpha: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.setClearColor(bgColor, 1);
        }}
      >
        <BgColorUpdater color={bgColor} />
        <CameraResetContext.Provider value={cameraResetRef}>
          <CameraZoomContext.Provider value={cameraZoomRef}>
            <CameraFitContext.Provider value={cameraFitRef}>
              <ViewportFocusContext.Provider value={focusValue}>
                <SceneInner tracksRef={tracksRef} bgColor={bgColor} listenerSync={listenerSync} showGrid={gridVisible} />
              </ViewportFocusContext.Provider>
            </CameraFitContext.Provider>
          </CameraZoomContext.Provider>
        </CameraResetContext.Provider>
      </Canvas>
      {/* Bottom-right controls */}
      <div style={{ position: 'absolute', bottom: 8, right: 8, zIndex: 10, display: 'flex', gap: 6, alignItems: 'flex-end' }}>
        <button
          onClick={() => setGridVisible(v => !v)}
          title={gridVisible ? 'Hide grid' : 'Show grid'}
          style={{
            width: 20,
            height: 20,
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
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={gridVisible ? bgColor : uiColor} strokeWidth="2.5" strokeLinecap="round">
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
            width: 20,
            height: 20,
            borderRadius: 4,
            background: 'none',
            border: `1.5px solid ${uiColor}40`,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            color: uiColor,
            fontSize: '11px',
            fontFamily: "'SF Mono', monospace",
            lineHeight: 1,
            opacity: 0.7,
          }}
        >
          +
        </button>
        <button
          onClick={() => setListenerLinked(v => !v)}
          title={listenerLinked ? 'Unlink listener from camera' : 'Link listener to camera'}
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            background: listenerLinked ? uiColor : 'none',
            border: `1.5px solid ${uiColor}40`,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            opacity: listenerLinked ? 1 : 0.7,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={listenerLinked ? bgColor : uiColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </button>
        {headTracking.available && (
          <button
            onClick={headTracking.toggle}
            title={headTracking.enabled ? 'Disable head tracking' : 'Enable head tracking (device orientation)'}
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              background: headTracking.enabled ? uiColor : 'none',
              border: `1.5px solid ${uiColor}40`,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              opacity: headTracking.enabled ? 1 : 0.7,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={headTracking.enabled ? bgColor : uiColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2C8 2 6 5 6 8c0 2 1 3.5 1 5v1h10v-1c0-1.5 1-3 1-5 0-3-2-6-6-6z" />
              <path d="M9 18h6" />
              <path d="M10 22h4" />
            </svg>
          </button>
        )}
        {onBgColorChange && (
          <div>
            <div
              onClick={() => setShowPicker(!showPicker)}
              style={{
                width: 20,
                height: 20,
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
