import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

function extensionOf(name) {
  return name.split('.').pop()?.toLowerCase();
}

function collectObjPositions(text) {
  const object = new OBJLoader().parse(text);
  object.updateMatrixWorld(true);
  const positions = [];
  object.traverse((child) => {
    if (!child.isMesh || !child.geometry?.getAttribute('position')) return;
    let geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);
    if (geometry.index) geometry = geometry.toNonIndexed();
    positions.push(...geometry.getAttribute('position').array);
    geometry.dispose();
  });
  return positions;
}

function positionsFromGeometry(inputGeometry) {
  let geometry = inputGeometry;
  if (geometry.index) geometry = geometry.toNonIndexed();
  const positions = Array.from(geometry.getAttribute('position').array);
  if (geometry !== inputGeometry) geometry.dispose();
  inputGeometry.dispose();
  return positions;
}

function normalizePositions(rawPositions) {
  if (rawPositions.length < 9 || rawPositions.length % 9 !== 0) throw new Error('The file does not contain complete triangle faces');
  const box = new THREE.Box3();
  for (let index = 0; index < rawPositions.length; index += 3) {
    box.expandByPoint(new THREE.Vector3(rawPositions[index], rawPositions[index + 1], rawPositions[index + 2]));
  }
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const scale = 9 / Math.max(size.x, size.y, size.z, 1e-8);
  const positions = [];
  for (let index = 0; index < rawPositions.length; index += 3) {
    positions.push(
      (rawPositions[index] - centre.x) * scale,
      (rawPositions[index + 1] - centre.y) * scale,
      (rawPositions[index + 2] - centre.z) * scale,
    );
  }
  return positions;
}

export function parseMeshContent(filename, content) {
  const extension = extensionOf(filename);
  let rawPositions;
  if (extension === 'obj') rawPositions = collectObjPositions(String(content));
  else if (extension === 'ply') rawPositions = positionsFromGeometry(new PLYLoader().parse(content));
  else if (extension === 'stl') rawPositions = positionsFromGeometry(new STLLoader().parse(content));
  else throw new Error('Supported mesh formats are OBJ, PLY, and STL');
  const positions = normalizePositions(rawPositions);
  return { filename, positions, faceCount: positions.length / 9 };
}

export async function loadMeshFile(file) {
  const extension = extensionOf(file.name);
  const content = extension === 'obj' ? await file.text() : await file.arrayBuffer();
  return parseMeshContent(file.name, content);
}

export async function loadMeshUrl(url, filename) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Mesh request failed with status ${response.status}`);
  const extension = extensionOf(filename);
  const content = extension === 'obj' ? await response.text() : await response.arrayBuffer();
  return parseMeshContent(filename, content);
}

function palette(value) {
  return new THREE.Color(0x0b4f65).lerp(new THREE.Color(0x5eead4), THREE.MathUtils.clamp(value, 0, 1));
}

export function createImportedMeshGeometry(meshData, colorMode = 'distortion') {
  const positions = meshData.positions;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal').array;
  const yValues = [];
  for (let index = 1; index < positions.length; index += 3) yValues.push(positions[index]);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const rangeY = Math.max(maxY - minY, 1e-8);
  const colors = [];
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const value = colorMode === 'slope'
      ? 1 - Math.abs(normals[vertex * 3 + 1])
      : (positions[vertex * 3 + 1] - minY) / rangeY;
    const color = palette(value);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function vertexKey(positions, offset) {
  return `${Math.round(positions[offset] * 1e5)},${Math.round(positions[offset + 1] * 1e5)},${Math.round(positions[offset + 2] * 1e5)}`;
}

export function buildFaceAdjacency(meshData) {
  const adjacency = Array.from({ length: meshData.faceCount }, () => new Set());
  const owners = new Map();
  for (let face = 0; face < meshData.faceCount; face += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const key = vertexKey(meshData.positions, face * 9 + corner * 3);
      if (!owners.has(key)) owners.set(key, []);
      owners.get(key).push(face);
    }
  }
  for (const faces of owners.values()) {
    for (const a of faces) for (const b of faces) if (a !== b) adjacency[a].add(b);
  }
  return adjacency.map((neighbors) => [...neighbors]);
}

export function facePatch(seedFace, rings, adjacency) {
  const visited = new Set([seedFace]);
  let frontier = [seedFace];
  for (let ring = 0; ring < rings; ring += 1) {
    const next = [];
    for (const face of frontier) {
      for (const neighbor of adjacency[face] || []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return [...visited];
}

export function createFaceObstacleObject(meshData, blockedFaces) {
  const positions = [];
  for (const face of blockedFaces) {
    positions.push(...meshData.positions.slice(face * 9, face * 9 + 9));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: 0xff5147,
    emissive: 0x5a0906,
    emissiveIntensity: 0.7,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }));
}

