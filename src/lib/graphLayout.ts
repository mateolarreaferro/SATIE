/**
 * Force-directed graph layout for the community sample knowledge graph.
 * Computes node positions in 3D space based on sample similarity.
 */

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  z: number;
  size: number;       // visual size (based on download count)
  // Reference back to sample data
  name: string;
  tags: string[];
  downloadCount: number;
}

export interface GraphEdge {
  source: number;     // index into nodes array
  target: number;
  weight: number;     // similarity score (0–1)
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Compute cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Build the graph from sample data with embeddings.
 * Computes pairwise similarity and creates edges above the threshold.
 */
export function buildGraph(
  samples: { id: string; name: string; tags: string[]; downloadCount: number; embedding: number[] | null }[],
  similarityThreshold = 0.65,
): GraphData {
  const maxDownloads = Math.max(1, ...samples.map(s => s.downloadCount));

  const nodes: GraphNode[] = samples.map(s => ({
    id: s.id,
    x: (Math.random() - 0.5) * 20,
    y: (Math.random() - 0.5) * 20,
    z: (Math.random() - 0.5) * 20,
    size: 0.3 + (s.downloadCount / maxDownloads) * 1.2,
    name: s.name,
    tags: s.tags,
    downloadCount: s.downloadCount,
  }));

  const edges: GraphEdge[] = [];

  // Compute pairwise similarities for samples that have embeddings
  for (let i = 0; i < samples.length; i++) {
    if (!samples[i].embedding) continue;
    for (let j = i + 1; j < samples.length; j++) {
      if (!samples[j].embedding) continue;
      const sim = cosineSimilarity(samples[i].embedding!, samples[j].embedding!);
      if (sim > similarityThreshold) {
        edges.push({ source: i, target: j, weight: sim });
      }
    }
  }

  return { nodes, edges };
}

/**
 * Run one iteration of force-directed layout.
 * Returns true if the layout has stabilized (total displacement < threshold).
 */
export function stepLayout(graph: GraphData, alpha = 0.1): boolean {
  const { nodes, edges } = graph;
  const n = nodes.length;
  if (n === 0) return true;

  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const dz = new Float64Array(n);

  // Repulsion (all pairs, O(n^2))
  const repulsionStrength = 2.0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ex = nodes[i].x - nodes[j].x;
      const ey = nodes[i].y - nodes[j].y;
      const ez = nodes[i].z - nodes[j].z;
      const dist2 = ex * ex + ey * ey + ez * ez + 0.01;
      const force = repulsionStrength / dist2;
      const fx = ex * force;
      const fy = ey * force;
      const fz = ez * force;
      dx[i] += fx; dy[i] += fy; dz[i] += fz;
      dx[j] -= fx; dy[j] -= fy; dz[j] -= fz;
    }
  }

  // Attraction along edges
  const attractionStrength = 0.05;
  for (const edge of edges) {
    const { source, target, weight } = edge;
    const ex = nodes[target].x - nodes[source].x;
    const ey = nodes[target].y - nodes[source].y;
    const ez = nodes[target].z - nodes[source].z;
    const dist = Math.sqrt(ex * ex + ey * ey + ez * ez) + 0.01;
    const force = attractionStrength * weight * dist;
    const fx = (ex / dist) * force;
    const fy = (ey / dist) * force;
    const fz = (ez / dist) * force;
    dx[source] += fx; dy[source] += fy; dz[source] += fz;
    dx[target] -= fx; dy[target] -= fy; dz[target] -= fz;
  }

  // Center gravity
  const gravityStrength = 0.01;
  for (let i = 0; i < n; i++) {
    dx[i] -= nodes[i].x * gravityStrength;
    dy[i] -= nodes[i].y * gravityStrength;
    dz[i] -= nodes[i].z * gravityStrength;
  }

  // Apply forces
  let totalDisplacement = 0;
  for (let i = 0; i < n; i++) {
    const disp = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i] + dz[i] * dz[i]);
    const maxDisp = 1.0; // clamp
    const scale = disp > maxDisp ? (maxDisp / disp) * alpha : alpha;
    nodes[i].x += dx[i] * scale;
    nodes[i].y += dy[i] * scale;
    nodes[i].z += dz[i] * scale;
    totalDisplacement += disp * scale;
  }

  return totalDisplacement / n < 0.001;
}

/**
 * Run the full layout simulation.
 * Returns positions after convergence or maxIterations.
 */
export function computeLayout(graph: GraphData, maxIterations = 300): GraphData {
  for (let i = 0; i < maxIterations; i++) {
    const alpha = 0.3 * Math.pow(0.95, i); // cooling schedule
    const stable = stepLayout(graph, alpha);
    if (stable) break;
  }
  return graph;
}
