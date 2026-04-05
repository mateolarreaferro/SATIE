/**
 * 3D Community Sample Knowledge Graph.
 * Theme-aware — adapts to light/fade/dark mode.
 * Emissive glowing nodes, fog depth, jewel-tone colors.
 */
import { useRef, useState, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { GraphNode, GraphEdge } from '../../lib/graphLayout';
import type { Theme } from '../hooks/useDayNightCycle';

// ── Color palettes per mode ──
const PALETTE_DARK = [
  '#7eb8da', '#a8d5a2', '#f0b27a', '#c5a3d9', '#f4a6a0',
  '#82d8d5', '#e8c76a', '#89c4b8', '#d4a0b9', '#a0bce0',
  '#c9d4a0', '#e0a07e', '#8fc5e0', '#b8d48a', '#d4b89a',
];

const PALETTE_LIGHT = [
  '#3a7ca5', '#5a9e54', '#c4813a', '#8a5bab', '#c4625a',
  '#3a9e9a', '#b89a2a', '#4a8a7a', '#a45e80', '#5a7cb0',
  '#8a9e50', '#b06a3a', '#4a8ab0', '#7aa040', '#a08a5a',
];

const HIGHLIGHT_COLOR = '#58a6ff';

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
  const bgColor = useMemo(() => hexToInt(theme.bg), [theme.bg]);
  const isDark = theme.mode === 'dark';

  return (
    <Canvas
      camera={{ position: [0, 0, 35], fov: 55 }}
      style={{ width: '100%', height: '100%' }}
      gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: isDark ? 1.2 : 0.9 }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor(0x000000, 0); // transparent background
        scene.fog = new THREE.FogExp2(bgColor, isDark ? 0.012 : 0.008);
      }}
    >
      {/* Lighting adapts to mode */}
      <ambientLight intensity={isDark ? 0.4 : 0.7} />
      <directionalLight position={[80, 150, 100]} intensity={isDark ? 0.5 : 0.4} color="#ffffff" />
      <directionalLight position={[-80, -40, -80]} intensity={isDark ? 0.25 : 0.15} color={isDark ? '#8888cc' : '#aaaadd'} />

      <SceneUpdater bgColor={bgColor} fogDensity={isDark ? 0.012 : 0.008} />

      <GraphScene
        nodes={nodes}
        edges={edges}
        onSelect={onSelect}
        selectedId={selectedId}
        highlightIds={highlightIds}
        theme={theme}
      />
      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        autoRotate
        autoRotateSpeed={0.15}
        minDistance={5}
        maxDistance={80}
      />
    </Canvas>
  );
}

/** Updates scene fog when theme changes */
function SceneUpdater({ bgColor, fogDensity }: { bgColor: number; fogDensity: number }) {
  useFrame(({ scene }) => {
    if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.color.set(bgColor);
      scene.fog.density = fogDensity;
    }
  });
  return null;
}

// ── Assign colors based on first tag + mode ──
function getNodeColor(node: GraphNode, isDark: boolean): string {
  const palette = isDark ? PALETTE_DARK : PALETTE_LIGHT;
  if (!node.tags || node.tags.length === 0) return palette[0];
  let hash = 0;
  for (let i = 0; i < node.tags[0].length; i++) {
    hash = ((hash << 5) - hash + node.tags[0].charCodeAt(i)) | 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

// ── Graph scene ──

function GraphScene({ nodes, edges, onSelect, selectedId, highlightIds, theme }: SampleGraphProps) {
  const isDark = theme.mode === 'dark';

  const neighborMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const node of nodes) map.set(node.id, new Set());
    for (const edge of edges) {
      const srcId = nodes[edge.source]?.id;
      const tgtId = nodes[edge.target]?.id;
      if (srcId && tgtId) {
        map.get(srcId)?.add(tgtId);
        map.get(tgtId)?.add(srcId);
      }
    }
    return map;
  }, [nodes, edges]);

  const selectedNeighbors = useMemo(() => {
    if (!selectedId) return null;
    return neighborMap.get(selectedId) ?? new Set<string>();
  }, [selectedId, neighborMap]);

  return (
    <group>
      <GraphEdges
        nodes={nodes}
        edges={edges}
        selectedId={selectedId}
        selectedNeighbors={selectedNeighbors}
        isDark={isDark}
      />

      {nodes.map(node => (
        <GraphNodeMesh
          key={node.id}
          node={node}
          color={getNodeColor(node, isDark)}
          isSelected={selectedId === node.id}
          isNeighbor={selectedNeighbors?.has(node.id) ?? false}
          isHighlighted={highlightIds ? highlightIds.has(node.id) : true}
          hasSelection={selectedId !== null}
          isDark={isDark}
          labelColor={theme.text}
          onClick={() => onSelect(node.id)}
        />
      ))}
    </group>
  );
}

// ── Single node ──

function GraphNodeMesh({ node, color, isSelected, isNeighbor, isHighlighted, hasSelection, isDark, labelColor, onClick }: {
  node: GraphNode;
  color: string;
  isSelected: boolean;
  isNeighbor: boolean;
  isHighlighted: boolean;
  hasSelection: boolean;
  isDark: boolean;
  labelColor: string;
  onClick: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  const radius = useMemo(() => {
    return Math.max(0.3, Math.min(1.8, 0.3 + Math.log2(node.downloadCount + 1) * 0.3));
  }, [node.downloadCount]);

  const dimmed = hasSelection && !isSelected && !isNeighbor;
  const searchDimmed = !isHighlighted;
  const active = isSelected || hovered;

  const emissiveIntensity = active ? (isDark ? 0.6 : 0.4)
    : isNeighbor ? (isDark ? 0.3 : 0.2)
    : (dimmed || searchDimmed) ? 0.03
    : (isDark ? 0.2 : 0.1);

  const opacity = (dimmed || searchDimmed) ? (isDark ? 0.1 : 0.15) : 1;
  const displayColor = isSelected ? HIGHLIGHT_COLOR : color;

  const showLabel = hovered || isSelected || isNeighbor || (node.downloadCount >= 5 && !dimmed && !searchDimmed);

  useFrame(() => {
    if (!meshRef.current) return;
    const targetScale = hovered ? 1.3 : 1;
    const s = meshRef.current.scale.x;
    meshRef.current.scale.setScalar(s + (targetScale - s) * 0.15);
  });

  return (
    <group position={[node.x, node.y, node.z]}>
      <mesh
        ref={meshRef}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto'; }}
      >
        <sphereGeometry args={[radius, 16, 12]} />
        <meshStandardMaterial
          color={displayColor}
          emissive={displayColor}
          emissiveIntensity={emissiveIntensity}
          roughness={isDark ? 0.4 : 0.6}
          metalness={isDark ? 0.1 : 0.05}
          transparent
          opacity={opacity}
        />
      </mesh>

      {showLabel && (
        <Html
          center
          position={[0, radius + 0.5, 0]}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
          distanceFactor={12}
        >
          <div style={{
            color: isSelected ? HIGHLIGHT_COLOR : labelColor,
            fontSize: 11,
            fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
            fontWeight: isSelected ? 600 : 400,
            whiteSpace: 'nowrap',
            textShadow: isDark
              ? '0 0 6px rgba(0,0,0,0.9), 0 0 12px rgba(0,0,0,0.5)'
              : '0 0 6px rgba(255,255,255,0.9), 0 0 12px rgba(255,255,255,0.5)',
            opacity: dimmed ? 0.3 : 0.9,
          }}>
            {node.name}
          </div>
        </Html>
      )}
    </group>
  );
}

// ── Edges ──

function GraphEdges({ nodes, edges, selectedId, selectedNeighbors, isDark }: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  selectedNeighbors: Set<string> | null;
  isDark: boolean;
}) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];

    const baseAlpha = isDark ? 0.04 : 0.08;
    const selectedAlpha = isDark ? 0.3 : 0.25;
    const fadedAlpha = isDark ? 0.005 : 0.02;

    for (const edge of edges) {
      const a = nodes[edge.source];
      const b = nodes[edge.target];
      if (!a || !b) continue;

      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);

      let r: number, g: number, bv: number, alpha: number;

      if (selectedId) {
        const srcId = a.id;
        const tgtId = b.id;
        const connectedToSelected = srcId === selectedId || tgtId === selectedId;
        const betweenNeighbors = selectedNeighbors?.has(srcId) && selectedNeighbors?.has(tgtId);

        if (connectedToSelected) {
          r = 0.345; g = 0.651; bv = 1.0; alpha = selectedAlpha;
        } else if (betweenNeighbors) {
          r = isDark ? 1 : 0; g = isDark ? 1 : 0; bv = isDark ? 1 : 0; alpha = 0.03;
        } else {
          r = isDark ? 1 : 0; g = isDark ? 1 : 0; bv = isDark ? 1 : 0; alpha = fadedAlpha;
        }
      } else {
        r = isDark ? 1 : 0; g = isDark ? 1 : 0; bv = isDark ? 1 : 0; alpha = baseAlpha;
      }

      colors.push(r * alpha, g * alpha, bv * alpha);
      colors.push(r * alpha, g * alpha, bv * alpha);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }, [nodes, edges, selectedId, selectedNeighbors, isDark]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial vertexColors transparent opacity={1} />
    </lineSegments>
  );
}
