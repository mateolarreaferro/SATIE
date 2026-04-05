/**
 * Web Worker for graph layout computation.
 * Runs the force-directed simulation off the main thread.
 *
 * Messages IN:
 *   { type: 'compute', samples: SampleInput[] }
 *
 * Messages OUT:
 *   { type: 'progress', nodes: {id,x,y,z,size}[], edges: {source,target,weight}[], iteration: number }
 *   { type: 'done', nodes: ..., edges: ... }
 */
import { buildGraph, stepLayout, type GraphData } from './graphLayout';

interface SampleInput {
  id: string;
  name: string;
  tags: string[];
  downloadCount: number;
  embedding: number[] | null;
}

self.onmessage = (e: MessageEvent) => {
  const { type, samples, threshold } = e.data;

  if (type === 'compute') {
    const graph = buildGraph(samples as SampleInput[], threshold ?? 0.65);
    const maxIterations = 300;
    const reportEvery = 20;

    for (let i = 0; i < maxIterations; i++) {
      const alpha = 0.3 * Math.pow(0.95, i);
      const stable = stepLayout(graph, alpha);

      if (i % reportEvery === 0) {
        postProgress(graph, i);
      }

      if (stable) break;
    }

    self.postMessage({
      type: 'done',
      nodes: graph.nodes.map(n => ({ id: n.id, x: n.x, y: n.y, z: n.z, size: n.size, name: n.name, tags: n.tags, downloadCount: n.downloadCount })),
      edges: graph.edges,
    });
  }
};

function postProgress(graph: GraphData, iteration: number) {
  self.postMessage({
    type: 'progress',
    nodes: graph.nodes.map(n => ({ id: n.id, x: n.x, y: n.y, z: n.z, size: n.size, name: n.name, tags: n.tags, downloadCount: n.downloadCount })),
    edges: graph.edges,
    iteration,
  });
}
