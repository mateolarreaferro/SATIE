/**
 * 3D Force-directed knowledge graph of community samples.
 * Uses R3F with InstancedMesh for performance.
 */
import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { GraphNode, GraphEdge } from '../../lib/graphLayout';

interface SampleGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onSelect: (nodeId: string) => void;
  selectedId: string | null;
  highlightIds: Set<string> | null;
  textColor: string;
}

export function SampleGraph({ nodes, edges, onSelect, selectedId, highlightIds, textColor }: SampleGraphProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, 30], fov: 60 }}
      style={{ width: '100%', height: '100%' }}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={0.6} />
      <pointLight position={[20, 20, 20]} intensity={0.8} />
      <GraphContent
        nodes={nodes}
        edges={edges}
        onSelect={onSelect}
        selectedId={selectedId}
        highlightIds={highlightIds}
        textColor={textColor}
      />
      <OrbitControls enableDamping dampingFactor={0.1} />
    </Canvas>
  );
}

// ── Graph content (inside Canvas) ──

function GraphContent({ nodes, edges, onSelect, selectedId, highlightIds, textColor }: SampleGraphProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const hoveredRef = useRef<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const { camera } = useThree();

  // Colors
  const defaultColor = useMemo(() => new THREE.Color(textColor), [textColor]);
  const selectedColor = useMemo(() => new THREE.Color('#1a3a2a'), []);
  const dimColor = useMemo(() => new THREE.Color(textColor).multiplyScalar(0.2), [textColor]);

  // Temp objects for instanced updates
  const tempMatrix = useMemo(() => new THREE.Matrix4(), []);
  const tempColor = useMemo(() => new THREE.Color(), []);

  // Update instanced mesh transforms + colors
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const scale = node.size * (hoveredRef.current === i ? 1.3 : 1);
      tempMatrix.makeTranslation(node.x, node.y, node.z);
      tempMatrix.scale(new THREE.Vector3(scale, scale, scale));
      mesh.setMatrixAt(i, tempMatrix);

      // Color logic
      if (selectedId === node.id) {
        tempColor.copy(selectedColor);
      } else if (highlightIds && !highlightIds.has(node.id)) {
        tempColor.copy(dimColor);
      } else {
        tempColor.copy(defaultColor);
      }
      mesh.setColorAt(i, tempColor);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  // Edge geometry
  const lineGeometry = useMemo(() => {
    const positions: number[] = [];
    for (const edge of edges) {
      const a = nodes[edge.source];
      const b = nodes[edge.target];
      if (a && b) {
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [nodes, edges]);

  // Raycasting for hover/click
  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const instanceId = e.instanceId;
    if (instanceId !== undefined && instanceId !== hoveredRef.current) {
      hoveredRef.current = instanceId;
      setHovered(instanceId);
      document.body.style.cursor = 'pointer';
    }
  }, []);

  const handlePointerOut = useCallback(() => {
    hoveredRef.current = null;
    setHovered(null);
    document.body.style.cursor = 'auto';
  }, []);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined && nodes[e.instanceId]) {
      onSelect(nodes[e.instanceId].id);
    }
  }, [nodes, onSelect]);

  // Fly camera to selected node
  useEffect(() => {
    if (!selectedId) return;
    const node = nodes.find(n => n.id === selectedId);
    if (!node) return;

    const targetPos = new THREE.Vector3(node.x, node.y, node.z + 8);
    const startPos = camera.position.clone();
    let t = 0;
    const animate = () => {
      t += 0.03;
      if (t > 1) return;
      camera.position.lerpVectors(startPos, targetPos, t * t * (3 - 2 * t)); // smoothstep
      camera.lookAt(node.x, node.y, node.z);
      requestAnimationFrame(animate);
    };
    animate();
  }, [selectedId, nodes, camera]);

  return (
    <>
      {/* Edges */}
      <lineSegments geometry={lineGeometry}>
        <lineBasicMaterial color={textColor} opacity={0.08} transparent />
      </lineSegments>

      {/* Nodes (InstancedMesh) */}
      {nodes.length > 0 && (
        <instancedMesh
          ref={meshRef}
          args={[undefined, undefined, nodes.length]}
          onPointerMove={handlePointerMove}
          onPointerOut={handlePointerOut}
          onClick={handleClick}
        >
          <sphereGeometry args={[0.5, 16, 12]} />
          <meshStandardMaterial />
        </instancedMesh>
      )}

      {/* Hover tooltip */}
      {hovered !== null && nodes[hovered] && (
        <Html
          position={[nodes[hovered].x, nodes[hovered].y + nodes[hovered].size + 0.5, nodes[hovered].z]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div style={{
            background: 'rgba(0,0,0,0.8)',
            color: '#fff',
            padding: '4px 10px',
            borderRadius: 8,
            fontSize: 12,
            fontFamily: "'Inter', sans-serif",
            whiteSpace: 'nowrap',
            maxWidth: 200,
          }}>
            <div style={{ fontWeight: 600 }}>{nodes[hovered].name}</div>
            <div style={{ opacity: 0.6, fontSize: 11 }}>
              {nodes[hovered].tags.slice(0, 3).join(', ')}
            </div>
          </div>
        </Html>
      )}
    </>
  );
}
