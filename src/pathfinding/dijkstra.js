import { MinPriorityQueue } from './bidirectionalDijkstra.js';

function reconstructPath(previous, target) {
  const path = [];
  for (let node = target; node !== -1; node = previous[node]) path.push(node);
  path.reverse();
  return path;
}

export function dijkstraDistances(graph, source) {
  const distances = new Float64Array(graph.adjacency.length);
  distances.fill(Infinity);
  distances[source] = 0;
  const settled = new Uint8Array(graph.adjacency.length);
  const queue = new MinPriorityQueue();
  queue.push(source, 0);
  while (queue.size) {
    const item = queue.pop();
    if (settled[item.node] || item.priority !== distances[item.node]) continue;
    settled[item.node] = 1;
    for (const edge of graph.adjacency[item.node]) {
      const candidate = item.priority + edge.weight;
      if (candidate >= distances[edge.to]) continue;
      distances[edge.to] = candidate;
      queue.push(edge.to, candidate);
    }
  }
  return distances;
}

export function dijkstra(graph, source, target) {
  const count = graph.adjacency.length;
  const distances = new Float64Array(count);
  distances.fill(Infinity);
  distances[source] = 0;
  const previous = new Int32Array(count);
  previous.fill(-1);
  const settled = new Uint8Array(count);
  const queue = new MinPriorityQueue();
  const visited = [];
  queue.push(source, 0);

  while (queue.size) {
    const item = queue.pop();
    if (settled[item.node] || item.priority !== distances[item.node]) continue;
    settled[item.node] = 1;
    visited.push(item.node);
    if (item.node === target) break;
    for (const edge of graph.adjacency[item.node]) {
      if (settled[edge.to]) continue;
      const candidate = distances[item.node] + edge.weight;
      if (candidate >= distances[edge.to]) continue;
      distances[edge.to] = candidate;
      previous[edge.to] = item.node;
      queue.push(edge.to, candidate);
    }
  }

  const found = Number.isFinite(distances[target]);
  return {
    found,
    distance: distances[target],
    path: found ? reconstructPath(previous, target) : [],
    visitedForward: visited,
    visitedBackward: [],
    expanded: visited.length,
  };
}
