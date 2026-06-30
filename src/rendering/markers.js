import * as THREE from 'three';
import { surfaceHeight } from '../geometry/surface.js';

function makeLabel(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 72;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(5,13,19,.86)';
  context.beginPath();
  context.roundRect(8, 8, 144, 52, 18);
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = 4;
  context.stroke();
  context.fillStyle = '#ffffff';
  context.font = '600 27px Arial';
  context.textAlign = 'center';
  context.fillText(text, 80, 43);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(1.55, 0.7, 1);
  return sprite;
}

export function createMarker(point, color, label, config) {
  const group = new THREE.Group();
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 24, 16),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4 }),
  );
  marker.position.y = 0.12;
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, 0.48, 10),
    new THREE.MeshBasicMaterial({ color }),
  );
  stem.position.y = 0.28;
  const sprite = makeLabel(label, `#${new THREE.Color(color).getHexString()}`);
  sprite.position.y = 0.95;
  group.add(marker, stem, sprite);
  group.position.set(point.x, surfaceHeight(point.x, point.y, config), point.y);
  return group;
}

export function disposeObject(object) {
  if (!object) return;
  object.traverse((child) => {
    child.geometry?.dispose();
    const materials = child.material ? (Array.isArray(child.material) ? child.material : [child.material]) : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value?.isTexture) value.dispose();
      }
      material.dispose();
    }
  });
  object.removeFromParent();
}

