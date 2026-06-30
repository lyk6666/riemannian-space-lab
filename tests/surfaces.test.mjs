import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrainGeometry, getSurfaceDomain, metricData, surfacePosition } from '../src/geometry/surface.js';
import { createObstacleObject, validateObstacleForSurface } from '../src/geometry/obstacles.js';
import { listSurfaces } from '../src/surfaces/registry.js';

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

test('all analytical surfaces produce finite meshes and positive metrics', () => {
  assert.equal(listSurfaces().length, 14);
  for (const surface of listSurfaces()) {
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

test('surface-clipped obstacles work on every analytical parameter domain', () => {
  for (const surface of listSurfaces()) {
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

test('periodic seams close geometrically and reject crossing obstacles', () => {
  for (const surface of listSurfaces()) {
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
