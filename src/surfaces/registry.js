import { analyticSurfaces } from './analytic.js';
import { specialSurfaces } from './special.js';

const surfaces = [...analyticSurfaces, ...specialSurfaces];
const surfaceMap = new Map(surfaces.map((surface) => [surface.id, surface]));

export function listSurfaces() {
  return surfaces;
}

export function getSurface(id) {
  const surface = surfaceMap.get(id);
  if (!surface) throw new Error(`Unknown surface: ${id}`);
  return surface;
}
