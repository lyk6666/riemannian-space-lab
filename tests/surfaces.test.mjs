import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTerrainGeometry, getSurfaceDomain, metricData, surfacePosition } from '../src/geometry/surface.js';
import { createObstacleObject, validateObstacleForSurface } from '../src/geometry/obstacles.js';
import { listSurfaces } from '../src/surfaces/registry.js';
import {
  buildFaceAdjacency,
  createFaceObstacleObject,
  createImportedMeshGeometry,
  facePatch,
  parseMeshContent,
} from '../src/geometry/importedMesh.js';

const parametricSurfaces = () => listSurfaces().filter((surface) => surface.kind !== 'mesh');

function configFor(surface) {
  return {
    surfaceId: surface.id,
    surfaceParams: { ...surface.defaultParams },
    resolution: 12,
    colorMode: 'distortion',
  };
}

function assertFiniteVector(vector, label) {
  assert.ok([vector.x, vector.y, vector.z].every(Number.isFinite), `${label} contains non-finite coordinates`);
}

test('all registered parametric surfaces produce finite meshes and positive metrics', () => {
  assert.equal(parametricSurfaces().length, 16);
  assert.equal(listSurfaces().length, 18);
  for (const surface of parametricSurfaces()) {
    const config = configFor(surface);
    const domain = getSurfaceDomain(config);
    for (const [fu, fv] of [[0.23, 0.31], [0.51, 0.47], [0.78, 0.69]]) {
      const u = domain.uMin + (domain.uMax - domain.uMin) * fu;
      const v = domain.vMin + (domain.vMax - domain.vMin) * fv;
      assertFiniteVector(surfacePosition(u, v, config), surface.name);
      const metric = metricData(u, v, config);
      const determinant = metric.tensor[0][0] * metric.tensor[1][1] - metric.tensor[0][1] ** 2;
      assert.ok(Number.isFinite(determinant) && determinant > 1e-9, `${surface.name} has a degenerate sampled metric`);
    }
    const geometry = createTerrainGeometry(config);
    assert.equal(geometry.getAttribute('position').count, (config.resolution + 1) ** 2);
    assert.ok(Array.from(geometry.getAttribute('position').array).every(Number.isFinite));
    geometry.dispose();
  }
});

test('surface-clipped obstacles work on every registered parameter domain', () => {
  for (const surface of parametricSurfaces()) {
    const config = configFor(surface);
    const domain = getSurfaceDomain(config);
    const centreU = (domain.uMin + domain.uMax) / 2;
    const centreV = (domain.vMin + domain.vMax) / 2;
    const halfU = (domain.uMax - domain.uMin) * 0.08;
    const halfV = (domain.vMax - domain.vMin) * 0.08;
    const polygon = [
      { u: centreU - halfU, v: centreV - halfV },
      { u: centreU + halfU, v: centreV - halfV },
      { u: centreU + halfU, v: centreV + halfV },
      { u: centreU - halfU, v: centreV + halfV },
    ];
    assert.equal(validateObstacleForSurface(polygon, config).valid, true, surface.name);
    const object = createObstacleObject(polygon, config);
    assert.ok(object.geometry.getAttribute('position').count > 0, `${surface.name} obstacle is empty`);
    assert.ok(Array.from(object.geometry.getAttribute('position').array).every(Number.isFinite));
    object.geometry.dispose();
    object.material.dispose();
  }
});

test('Poincaré metric expands toward the boundary and heightmaps affect elevation', () => {
  const poincare = listSurfaces().find((surface) => surface.id === 'poincare-disk');
  const poincareConfig = configFor(poincare);
  assert.ok(metricData(Math.PI, 0.85, poincareConfig).distortion > metricData(Math.PI, 0.2, poincareConfig).distortion);

  const heightmap = listSurfaces().find((surface) => surface.id === 'heightmap');
  const heightmapConfig = configFor(heightmap);
  heightmapConfig.surfaceParams.heightmap = { width: 2, height: 2, values: [0, 1, 0, 1] };
  const domain = getSurfaceDomain(heightmapConfig);
  const low = surfacePosition(domain.uMin, 0, heightmapConfig).y;
  const high = surfacePosition(domain.uMax, 0, heightmapConfig).y;
  assert.ok(high > low);
});

test('periodic seams close geometrically and reject crossing obstacles', () => {
  for (const surface of parametricSurfaces()) {
    const config = configFor(surface);
    const domain = getSurfaceDomain(config);
    const middleU = (domain.uMin + domain.uMax) / 2;
    const middleV = (domain.vMin + domain.vMax) / 2;
    if (domain.uPeriodic) {
      assert.ok(surfacePosition(domain.uMin, middleV, config).distanceTo(surfacePosition(domain.uMax, middleV, config)) < 1e-5, `${surface.name} u seam is open`);
      const crossing = [
        { u: domain.uMin + 0.02, v: middleV - 0.1 },
        { u: domain.uMax - 0.02, v: middleV - 0.1 },
        { u: domain.uMax - 0.02, v: middleV + 0.1 },
      ];
      assert.equal(validateObstacleForSurface(crossing, config).valid, false, `${surface.name} accepted a u-seam obstacle`);
    }
    if (domain.vPeriodic) {
      assert.ok(surfacePosition(middleU, domain.vMin, config).distanceTo(surfacePosition(middleU, domain.vMax, config)) < 1e-5, `${surface.name} v seam is open`);
    }
  }
});

test('OBJ, PLY, and STL import into normalized triangle meshes', () => {
  const obj = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';
  const ply = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
0 0 0
1 0 0
0 1 0
3 0 1 2
`;
  const stl = `solid triangle
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid triangle`;
  const fixtures = [
    ['triangle.obj', obj],
    ['triangle.ply', new TextEncoder().encode(ply).buffer],
    ['triangle.stl', new TextEncoder().encode(stl).buffer],
  ];
  for (const [filename, content] of fixtures) {
    const meshData = parseMeshContent(filename, content);
    assert.equal(meshData.faceCount, 1, filename);
    assert.equal(meshData.positions.length, 9, filename);
    assert.ok(meshData.positions.every(Number.isFinite), filename);
  }
});

test('mesh face adjacency supports connected obstacle painting', () => {
  const meshData = {
    filename: 'square.obj',
    faceCount: 3,
    positions: [
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      1, 0, 0, 1, 1, 0, 0, 1, 0,
      0, 0, 0, -1, 0, 0, 0, -1, 0,
    ],
  };
  const adjacency = buildFaceAdjacency(meshData);
  assert.deepEqual(adjacency, [[1], [0], []]);
  assert.deepEqual(facePatch(0, 1, adjacency).sort(), [0, 1]);
  const terrain = createImportedMeshGeometry(meshData);
  const obstacle = createFaceObstacleObject(meshData, [1]);
  assert.equal(terrain.getAttribute('position').count, 9);
  assert.equal(obstacle.geometry.getAttribute('position').count, 3);
  terrain.dispose();
  obstacle.geometry.dispose();
  obstacle.material.dispose();
});

test('bundled Stanford Bunny parses as a non-empty benchmark mesh', () => {
  const bytes = readFileSync(new URL('../public/models/stanford-bunny.ply', import.meta.url));
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const bunny = parseMeshContent('stanford-bunny.ply', arrayBuffer);
  assert.ok(bunny.faceCount > 10_000);
  assert.ok(bunny.positions.every(Number.isFinite));
});
