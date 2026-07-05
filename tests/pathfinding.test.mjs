import test from 'node:test';
import assert from 'node:assert/strict';
import { bidirectionalDijkstra } from '../src/pathfinding/bidirectionalDijkstra.js';
import { dijkstra, dijkstraDistances } from '../src/pathfinding/dijkstra.js';
import { buildLandmarkIndex, createLandmarkHeuristic, landmarkAStar } from '../src/pathfinding/landmarkIndex.js';
import { attachQueryPoints, buildBaseGraph, buildSearchGraph } from '../src/pathfinding/meshGraph.js';
import { createSceneState, selectSurface } from '../src/state/sceneState.js';

function undirectedGraph(nodeCount, edges) {
  const adjacency = Array.from({ length: nodeCount }, () => []);
  for (const [a, b, weight] of edges) {
    adjacency[a].push({ to: b, weight });
    adjacency[b].push({ to: a, weight });
  }
  return { adjacency };
}

test('bidirectional Dijkstra returns an exact weighted-graph shortest path', () => {
  const graph = undirectedGraph(5, [
    [0, 1, 2], [0, 2, 1], [2, 1, 1], [1, 3, 2], [2, 3, 10], [3, 4, 3],
  ]);
  const result = bidirectionalDijkstra(graph, 0, 4);
  assert.equal(result.found, true);
  assert.equal(result.distance, 7);
  assert.equal(result.path[0], 0);
  assert.equal(result.path.at(-1), 4);
  assert.ok(result.expanded < graph.adjacency.length * 2);
});

test('bidirectional Dijkstra reports disconnected queries', () => {
  const graph = undirectedGraph(4, [[0, 1, 1], [2, 3, 1]]);
  const result = bidirectionalDijkstra(graph, 0, 3);
  assert.equal(result.found, false);
  assert.equal(result.distance, Infinity);
  assert.deepEqual(result.path, []);
});

test('parametric mesh graph connects arbitrary query points and detours around obstacles', () => {
  const state = createSceneState();
  state.resolution = 24;
  state.source = { u: -5, v: 0 };
  state.destination = { u: 5, v: 0 };

  const openGraph = buildSearchGraph(state);
  const openResult = bidirectionalDijkstra(openGraph, openGraph.source, openGraph.target);
  assert.equal(openResult.found, true);

  state.obstacles = [[
    { u: -1.2, v: -1.5 },
    { u: 1.2, v: -1.5 },
    { u: 1.2, v: 1.5 },
    { u: -1.2, v: 1.5 },
  ]];
  const blockedGraph = buildSearchGraph(state);
  const blockedResult = bidirectionalDijkstra(blockedGraph, blockedGraph.source, blockedGraph.target);
  assert.equal(blockedResult.found, true);
  assert.ok(blockedResult.distance > openResult.distance);
});

test('Dijkstra, bidirectional Dijkstra, and Landmark A* return the same path length', () => {
  const state = createSceneState();
  state.resolution = 28;
  state.source = { u: -5, v: -2 };
  state.destination = { u: 5, v: 2 };
  state.obstacles = [[
    { u: -1.1, v: -2.4 },
    { u: 1.1, v: -2.4 },
    { u: 1.1, v: 1.3 },
    { u: -1.1, v: 1.3 },
  ]];
  const baseGraph = buildBaseGraph(state);
  const graph = attachQueryPoints(baseGraph, state.source, state.destination, state);
  const index = buildLandmarkIndex(baseGraph, 8);
  assert.equal(index.landmarks.length, 8);
  const classic = dijkstra(graph, graph.source, graph.target);
  const bidirectional = bidirectionalDijkstra(graph, graph.source, graph.target);
  const landmark = landmarkAStar(graph, graph.source, graph.target, index);
  assert.equal(classic.found, true);
  assert.ok(Math.abs(classic.distance - bidirectional.distance) < 1e-9);
  assert.ok(Math.abs(classic.distance - landmark.distance) < 1e-9);
  assert.ok(landmark.expanded <= classic.expanded);
});

test('ALT landmark heuristic is admissible for base and temporary query nodes', () => {
  const state = createSceneState();
  state.resolution = 20;
  state.source = { u: -4.5, v: -1.7 };
  state.destination = { u: 4.2, v: 2.1 };
  const baseGraph = buildBaseGraph(state);
  const graph = attachQueryPoints(baseGraph, state.source, state.destination, state);
  const index = buildLandmarkIndex(baseGraph, 8);
  const heuristic = createLandmarkHeuristic(graph, graph.target, index);
  const exact = dijkstraDistances(graph, graph.target);
  for (let node = 0; node < graph.nodes.length; node += 1) {
    assert.ok(heuristic(node) <= exact[node] + 1e-8, `heuristic overestimated at node ${node}`);
  }
});

test('periodic surfaces connect matching seam vertices', () => {
  const state = createSceneState();
  selectSurface(state, 'torus');
  state.resolution = 24;
  state.source = { u: 0.04, v: Math.PI };
  state.destination = { u: Math.PI * 2 - 0.04, v: Math.PI };
  const graph = buildSearchGraph(state);
  const result = bidirectionalDijkstra(graph, graph.source, graph.target);
  assert.equal(result.found, true);
  assert.ok(result.distance < 1, `seam path was unexpectedly long: ${result.distance}`);
});

test('imported triangle meshes use welded vertices and blocked faces', () => {
  const state = createSceneState();
  selectSurface(state, 'imported-mesh');
  state.meshData = {
    filename: 'square.obj',
    faceCount: 2,
    positions: [
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      1, 0, 0, 1, 1, 0, 0, 1, 0,
    ],
  };
  state.source = { faceIndex: 0, position: [0.1, 0.1, 0] };
  state.destination = { faceIndex: 1, position: [0.9, 0.9, 0] };
  const graph = buildSearchGraph(state);
  const result = bidirectionalDijkstra(graph, graph.source, graph.target);
  assert.equal(result.found, true);
  assert.ok(result.distance > 0);

  state.blockedFaces = [1];
  assert.throws(() => buildSearchGraph(state), /blocked face/);
});
