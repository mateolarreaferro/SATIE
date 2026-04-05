/**
 * 3D Community Sample Knowledge Graph.
 * Theme-aware with breathing animations, hover effects, and always-visible labels.
 */
import { useRef, useState, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { GraphNode, GraphEdge } from '../../lib/graphLayout';
import type { Theme } from '../hooks/useDayNightCycle';

// Vibrant palette that reads well on both light and dark backgrounds
const PALETTE = [
  '#4a90d9', '#e07c54', '#6cc477', '#c965d4', '#d4c45a',
  '#54c4c4', '#e06b8f', '#7b8fe0', '#d49a4a', '#5bc49a',
  '#c75b5b', '#8a6dd6', '#5da5e0', '#d68a5a', '#5bb5d4',
];

const HIGHLIGHT = '#3b82f6';

interface SampleGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onSelect: (nodeId: string) => void;
  selectedId: string | null;
  highlightIds: Set<string> | null;
  theme: Theme;
}

function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

export function SampleGraph({ nodes, edges, onSelect, selectedId, highlightIds, theme }: SampleGraphProps) {
  const isDark = theme.mode === 'dark';
  const fogColor = hexToInt(theme.bg);

  return (
    <Canvas
      camera={{ position: [0, 0, 30], fov: 50 }}
      style={{ width: '100%', height: '100%' }}
      gl={{ antialias: true, alpha: true }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor(0x000000, 0);
        scene.fog = new THREE.FogExp2(fogColor, 0.006);
      }}
    >
      <ambientLight intensity={isDark ? 0.5 : 0.8} />
      <directionalLight position={[60, 100, 80]} intensity={isDark ? 0.6 : 0.5} />
      <directionalLight position={[-40, -30, -60]} intensity={0.2} color={isDark ? '#aaaaff' : '#ccccff'} />

      <FogUpdater fogColor={fogColor} />

      <GraphContent
        nodes={nodes}
        edges={edges}
        onSelect={onSelect}
        selectedId={selectedId}
        highlightIds={highlightIds}
        theme={theme}
      />

      <OrbitControls
        enableDamping
        dampingFactor={0.06}
        autoRotate
        autoRotateSpeed={0.12}
        minDistance={8}
        maxDistance={60}
      />
    </Canvas>
  );
}

function FogUpdater({ fogColor }: { fogColor: number }) {
  useFrame(({ scene }) => {
    if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.color.set(fogColor);
    }
  });
  return null;
}

function getColor(node: GraphNode): string {
  if (!node.tags?.length) return PALETTE[0];
  let h = 0;
  for (let i = 0; i < node.tags[0].length; i++) h = ((h << 5) - h + node.tags[0].charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

// ── Main scene ──

function GraphContent({ nodes, edges, onSelect, selectedId, highlightIds, theme }: SampleGraphProps) {
  const isDark = theme.mode === 'dark';

  const neighborMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const n of nodes) m.set(n.id, new Set());
    for (const e of edges) {
      const s = nodes[e.source]?.id, t = nodes[e.target]?.id;
      if (s && t) { m.get(s)?.add(t); m.get(t)?.add(s); }
    }
    return m;
  }, [nodes, edges]);

  const selectedNeighbors = useMemo(() => {
    if (!selectedId) return null;
    return neighborMap.get(selectedId) ?? new Set<string>();
  }, [selectedId, neighborMap]);

  return (
    <group>
      <Edges nodes={nodes} edges={edges} selectedId={selectedId} selectedNeighbors={selectedNeighbors} isDark={isDark} />
      {nodes.map(n => (
        <Node
          key={n.id}
          node={n}
          color={getColor(n)}
          isSelected={selectedId === n.id}
          isNeighbor={selectedNeighbors?.has(n.id) ?? false}
          isHighlighted={highlightIds ? highlightIds.has(n.id) : true}
          hasSelection={selectedId !== null}
          isDark={isDark}
          textColor={theme.text}
          onClick={() => onSelect(n.id)}
        />
      ))}
    </group>
  );
}

// ── Node with breathing + hover ──

function Node({ node, color, isSelected, isNeighbor, isHighlighted, hasSelection, isDark, textColor, onClick }: {
  node: GraphNode; color: string;
  isSelected: boolean; isNeighbor: boolean; isHighlighted: boolean; hasSelection: boolean;
  isDark: boolean; textColor: string; onClick: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const [hovered, setHovered] = useState(false);
  const phaseRef = useRef(Math.random() * Math.PI * 2); // unique breathing phase

  const baseRadius = Math.max(0.4, Math.min(2.0, 0.4 + Math.log2(node.downloadCount + 1) * 0.35));

  const dimmed = (hasSelection && !isSelected && !isNeighbor) || !isHighlighted;
  const active = isSelected || hovered;

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const mesh = meshRef.current;
    const mat = matRef.current;
    if (!mesh || !mat) return;

    // Breathing: subtle scale pulse
    const breathe = 1 + Math.sin(t * 1.2 + phaseRef.current) * 0.06;
    const hoverScale = hovered ? 1.25 : 1;
    const targetScale = baseRadius * breathe * hoverScale;
    const s = mesh.scale.x;
    mesh.scale.setScalar(s + (targetScale - s) * 0.12);

    // Gentle float (Y drift)
    if (groupRef.current) {
      groupRef.current.position.y = node.y + Math.sin(t * 0.4 + phaseRef.current) * 0.15;
    }

    // Material animation
    const targetOpacity = dimmed ? 0.15 : 1;
    mat.opacity += (targetOpacity - mat.opacity) * 0.1;

    const targetEmissive = active ? 0.5 : isNeighbor ? 0.25 : dimmed ? 0.02 : 0.12;
    mat.emissiveIntensity += (targetEmissive - mat.emissiveIntensity) * 0.1;

    if (isSelected) {
      mat.color.lerp(new THREE.Color(HIGHLIGHT), 0.15);
      mat.emissive.lerp(new THREE.Color(HIGHLIGHT), 0.15);
    } else {
      mat.color.lerp(new THREE.Color(color), 0.08);
      mat.emissive.lerp(new THREE.Color(color), 0.08);
    }
  });

  return (
    <group ref={groupRef} position={[node.x, node.y, node.z]}>
      <mesh
        ref={meshRef}
        scale={baseRadius}
        onClick={e => { e.stopPropagation(); onClick(); }}
        onPointerOver={e => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto'; }}
      >
        <sphereGeometry args={[1, 24, 16]} />
        <meshStandardMaterial
          ref={matRef}
          color={color}
          emissive={color}
          emissiveIntensity={0.12}
          roughness={isDark ? 0.35 : 0.5}
          metalness={0.05}
          transparent
          opacity={1}
        />
      </mesh>

      {/* Always show label */}
      <Html
        center
        position={[0, baseRadius * 1.3 + 0.4, 0]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        distanceFactor={10}
      >
        <div style={{
          color: isSelected ? HIGHLIGHT : textColor,
          fontSize: active ? 13 : 11,
          fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
          fontWeight: isSelected ? 600 : 500,
          whiteSpace: 'nowrap',
          textShadow: isDark
            ? '0 1px 8px rgba(0,0,0,0.8), 0 0 2px rgba(0,0,0,0.5)'
            : '0 1px 6px rgba(255,255,255,0.9), 0 0 2px rgba(255,255,255,0.7)',
          opacity: dimmed ? 0.2 : (active ? 1 : 0.7),
          transition: 'opacity 0.3s, font-size 0.2s',
          letterSpacing: '0.01em',
        }}>
          {node.name}
        </div>
        {/* Tags on hover */}
        {hovered && node.tags.length > 0 && (
          <div style={{
            marginTop: 2,
            display: 'flex',
            gap: 3,
            justifyContent: 'center',
          }}>
            {node.tags.slice(0, 3).map(tag => (
              <span key={tag} style={{
                fontSize: 9,
                padding: '1px 5px',
                borderRadius: 4,
                background: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)',
                color: textColor,
                opacity: 0.6,
              }}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </Html>
    </group>
  );
}

// ── Edges with animated opacity ──

function Edges({ nodes, edges, selectedId, selectedNeighbors, isDark }: {
  nodes: GraphNode[]; edges: GraphEdge[];
  selectedId: string | null; selectedNeighbors: Set<string> | null; isDark: boolean;
}) {
  const lineRef = useRef<THREE.LineSegments>(null);

  const geometry = useMemo(() => {
    const pos: number[] = [];
    const col: number[] = [];

    // Edge base color: dark text on light bg, light on dark
    const baseR = isDark ? 1 : 0, baseG = isDark ? 1 : 0, baseB = isDark ? 1 : 0;

    for (const e of edges) {
      const a = nodes[e.source], b = nodes[e.target];
      if (!a || !b) continue;
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);

      let r: number, g: number, bv: number;

      if (selectedId) {
        const connected = a.id === selectedId || b.id === selectedId;
        const neighborEdge = selectedNeighbors?.has(a.id) && selectedNeighbors?.has(b.id);
        if (connected) {
          // Highlight blue
          r = 0.23; g = 0.51; bv = 0.96;
        } else if (neighborEdge) {
          r = baseR * 0.1; g = baseG * 0.1; bv = baseB * 0.1;
        } else {
          r = baseR * 0.02; g = baseG * 0.02; bv = baseB * 0.02;
        }
      } else {
        // Default: subtle but visible
        const alpha = isDark ? 0.08 : 0.12;
        r = baseR * alpha; g = baseG * alpha; bv = baseB * alpha;
      }

      col.push(r, g, bv, r, g, bv);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return geo;
  }, [nodes, edges, selectedId, selectedNeighbors, isDark]);

  // Animate edge positions to follow node breathing
  useFrame(({ clock }) => {
    if (!lineRef.current) return;
    const posAttr = lineRef.current.geometry.getAttribute('position');
    if (!posAttr) return;
    const t = clock.getElapsedTime();
    let idx = 0;
    for (const e of edges) {
      const a = nodes[e.source], b = nodes[e.target];
      if (!a || !b) continue;
      // Match the Y float of the nodes
      const ayOffset = Math.sin(t * 0.4 + a.id.charCodeAt(0)) * 0.15;
      const byOffset = Math.sin(t * 0.4 + b.id.charCodeAt(0)) * 0.15;
      posAttr.setY(idx, a.y + ayOffset);
      posAttr.setY(idx + 1, b.y + byOffset);
      idx += 2;
    }
    posAttr.needsUpdate = true;
  });

  return (
    <lineSegments ref={lineRef} geometry={geometry}>
      <lineBasicMaterial vertexColors transparent opacity={1} />
    </lineSegments>
  );
}
