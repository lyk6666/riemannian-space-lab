import test from 'node:test';
import assert from 'node:assert/strict';
import { bidirectionalDijkstra } from '../src/pathfinding/bidirectionalDijkstra.js';
import { buildContractionHierarchy, contractionHierarchyQuery } from '../src/pathfinding/contractionHierarchy.js';
import { dijkstra, dijkstraDistances } from '../src/pathfinding/dijkstra.js';
import { buildLandmarkIndex, createLandmarkHeuristic, landmarkAStar } from '../src/pathfinding/landmarkIndex.js';
import { attachQueryPoints, buildBaseGraph, buildSearchGraph } from '../src/pathfinding/meshGraph.js';
import { buildNestedDissectionHierarchy, createNestedDissectionOrder } from '../src/pathfinding/nestedDissection.js';
import { createSceneState, selectSurface } from '../src/state/sceneState.js';

function undirectedGraph(nodeCount, edges) {
  const adjacency = Array.from({ length: nodeCount }, () => []);
  for (const [a, b, weight] of edges) {
    adjacency[a].push({ to: b, weight });
    adjacency[b].push({ to: a, weight });
  }
  return { adjacency };
}

function attachVertexQuery(baseGraph, sourceVertex, targetVertex) {
  const nodes = baseGraph.nodes.map((node) => ({ position: [...node.position] }));
  const adjacency = baseGraph.adjacency.map((edges) => edges.map((edge) => ({ ...edge })));
  const attach = (vertex) => {
    const node = nodes.length;
    nodes.push({ position: [...nodes[vertex].position] });
    adjacency.push([{ to: vertex, weight: 0 }]);
    adjacency[vertex].push({ to: node, weight: 0 });
    return node;
  };
  const source = attach(sourceVertex);
  const target = attach(targetVertex);
  return { nodes, adjacency, source, target, baseNodeCount: baseGraph.nodes.length };
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

test('Contraction Hierarchies matches Dijkstra and unpacks to original edges', () => {
  let seed = 123456789;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const nodeCount = 18;
  const edges = [];
  for (let node = 0; node < nodeCount - 1; node += 1) edges.push([node, node + 1, 1 + random() * 4]);
  for (let a = 0; a < nodeCount; a += 1) {
    for (let b = a + 2; b < nodeCount; b += 1) {
      if (random() < 0.16) edges.push([a, b, 1 + random() * 8]);
    }
  }
  const baseGraph = {
    nodes: Array.from({ length: nodeCount }, (_, node) => ({ position: [node, 0, 0] })),
    ...undirectedGraph(nodeCount, edges),
  };
  const index = buildContractionHierarchy(baseGraph);
  assert.equal(index.ranks.length, nodeCount);
  assert.ok(index.edges.length >= edges.length);
  for (const [sourceVertex, targetVertex] of [[0, 17], [2, 13], [5, 6], [16, 3]]) {
    const graph = attachVertexQuery(baseGraph, sourceVertex, targetVertex);
    const expected = dijkstra(graph, graph.source, graph.target);
    const actual = contractionHierarchyQuery(graph, index);
    assert.equal(actual.found, true);
    assert.ok(Math.abs(actual.distance - expected.distance) < 1e-9);
    const basePath = actual.path.slice(1, -1);
    for (let step = 1; step < basePath.length; step += 1) {
      assert.ok(baseGraph.adjacency[basePath[step - 1]].some((edge) => edge.to === basePath[step]), 'CH path contains an unpacked shortcut');
    }
  }
});

test('Contraction Hierarchies supports arbitrary surface query points and obstacles', () => {
  const state = createSceneState();
  state.resolution = 22;
  state.source = { u: -5, v: -1 };
  state.destination = { u: 5, v: 1 };
  state.obstacles = [[
    { u: -1, v: -2.2 },
    { u: 1, v: -2.2 },
    { u: 1, v: 1.4 },
    { u: -1, v: 1.4 },
  ]];
  const baseGraph = buildBaseGraph(state);
  const graph = attachQueryPoints(baseGraph, state.source, state.destination, state);
  const index = buildContractionHierarchy(baseGraph);
  const expected = dijkstra(graph, graph.source, graph.target);
  const actual = contractionHierarchyQuery(graph, index);
  assert.equal(actual.found, true);
  assert.ok(Math.abs(actual.distance - expected.distance) < 1e-8);
});

test('nested-dissection order is a separator-last permutation on uniform grids', () => {
  const state = createSceneState();
  state.resolution = 20;
  const baseGraph = buildBaseGraph(state);
  const partition = createNestedDissectionOrder(baseGraph, 5);
  assert.equal(partition.order.length, baseGraph.nodes.length);
  assert.equal(new Set(partition.order).size, baseGraph.nodes.length);
  assert.ok(partition.regionCount > 1);
  assert.ok(partition.separatorCount > 0);
  const ranks = new Int32Array(baseGraph.nodes.length);
  partition.order.forEach((node, rank) => { ranks[node] = rank; });
  const rootSeparators = [...partition.separatorLevel.keys()].filter((node) => partition.separatorLevel[node] === 0);
  const nonRoot = [...partition.separatorLevel.keys()].filter((node) => partition.separatorLevel[node] !== 0);
  assert.ok(Math.min(...rootSeparators.map((node) => ranks[node])) > Math.max(...nonRoot.map((node) => ranks[node])));
});

test('nested-dissection CH remains exact for obstacle-aware surface queries', () => {
  const state = createSceneState();
  state.resolution = 20;
  state.source = { u: -5.2, v: -1.8 };
  state.destination = { u: 4.7, v: 2.3 };
  state.obstacles = [[
    { u: -1.3, v: -2 },
    { u: 1.2, v: -2 },
    { u: 1.2, v: 1.5 },
    { u: -1.3, v: 1.5 },
  ]];
  const baseGraph = buildBaseGraph(state);
  const graph = attachQueryPoints(baseGraph, state.source, state.destination, state);
  const index = buildNestedDissectionHierarchy(baseGraph, { leafSize: 5 });
  const expected = dijkstra(graph, graph.source, graph.target);
  const actual = contractionHierarchyQuery(graph, index);
  assert.equal(index.ordering, 'nested-dissection');
  assert.equal(actual.found, true);
  assert.ok(Math.abs(actual.distance - expected.distance) < 1e-8);
});

test('nested-dissection cuts periodic seams and remains exact on a torus', () => {
  const state = createSceneState();
  selectSurface(state, 'torus');
  state.resolution = 16;
  state.source = { u: 0.08, v: Math.PI };
  state.destination = { u: Math.PI * 2 - 0.08, v: Math.PI };
  const baseGraph = buildBaseGraph(state);
  const partition = createNestedDissectionOrder(baseGraph, 4);
  const gridWidth = state.resolution + 1;
  const seamNodes = new Set();
  for (let j = 0; j <= state.resolution; j += 1) {
    seamNodes.add(baseGraph.partition.gridNodeIds[j * gridWidth]);
  }
  for (let i = 0; i <= state.resolution; i += 1) {
    seamNodes.add(baseGraph.partition.gridNodeIds[i]);
  }
  for (const node of seamNodes) assert.equal(partition.separatorLevel[node], 0);
  const graph = attachQueryPoints(baseGraph, state.source, state.destination, state);
  const index = buildNestedDissectionHierarchy(baseGraph, { leafSize: 4 });
  const expected = dijkstra(graph, graph.source, graph.target);
  const actual = contractionHierarchyQuery(graph, index);
  assert.equal(actual.found, true);
  assert.ok(Math.abs(actual.distance - expected.distance) < 1e-8);
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
