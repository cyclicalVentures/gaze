import * as THREE from 'three';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';

export type ModelInfo = { name: string; bytes: number; format: 'USDZ' | 'PLY'; vertices: number; triangles: number; meshes: number; points: boolean; textures: number };
export const MAX_FILE_BYTES = 150 * 1024 * 1024;

export function validateFile(name: string, size: number) {
  if (!/\.(ply|usdz)$/i.test(name)) throw new Error('Choose a .ply or .usdz file.');
  if (!size) throw new Error('This file is empty. Choose another model.');
  if (size > MAX_FILE_BYTES) throw new Error('This model is larger than 150 MB. Export a smaller model for this browser.');
}
export function disposeObject(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse(o => {
    if (!(o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.LineSegments)) return;
    geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      materials.add(m);
      Object.values(m).forEach(v => { if (v instanceof THREE.Texture) textures.add(v); });
    }
  });
  textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose()); geometries.forEach(g => g.dispose());
}
export async function parseModel(buffer: ArrayBuffer, name: string): Promise<{ root: THREE.Group; info: ModelInfo }> {
  validateFile(name, buffer.byteLength);
  const format = name.toLowerCase().endsWith('.ply') ? 'PLY' : 'USDZ';
  let root: THREE.Group;
  if (format === 'PLY') {
    const header = new TextDecoder().decode(buffer.slice(0, Math.min(buffer.byteLength, 65536)));
    if (!/^ply\r?\n/.test(header) || !/end_header\r?\n/.test(header)) throw new Error('This PLY header is invalid or too large. Export a standard ASCII or binary PLY.');
    const vertexCount = Number(header.match(/element vertex (\d+)/)?.[1]);
    const faceCount = Number(header.match(/element face (\d+)/)?.[1] ?? 0);
    if (!vertexCount || vertexCount > 5_000_000 || faceCount > 5_000_000) throw new Error('Use a PLY with 1–5 million vertices and at most 5 million faces.');
    const geometry = new PLYLoader().parse(buffer);
    const hasFaces = (geometry.index?.count ?? 0) > 0;
    if (hasFaces && !geometry.hasAttribute('normal')) geometry.computeVertexNormals();
    const colored = geometry.hasAttribute('color');
    const object = hasFaces
      ? new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: colored ? 0xffffff : 0xc2bee5, vertexColors: colored, roughness: 0.8, side: THREE.DoubleSide }))
      : new THREE.Points(geometry, new THREE.PointsMaterial({ color: colored ? 0xffffff : 0x2fd6c4, vertexColors: colored, size: 0.009, sizeAttenuation: true }));
    root = new THREE.Group(); root.add(object);
  } else {
    const signature = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4));
    if (signature[0] !== 0x50 || signature[1] !== 0x4b) throw new Error('This file is not a valid USDZ archive. Export the model again.');
    root = await new Promise<THREE.Group>((resolve, reject) => {
      try { new USDLoader().parse(buffer, '', resolve, reject); } catch (error) { reject(error); }
    });
  }
  const info: ModelInfo = { name, bytes: buffer.byteLength, format, vertices: 0, triangles: 0, meshes: 0, points: false, textures: 0 };
  const textures = new Set<THREE.Texture>();
  let invalid = false;
  root.traverse(o => {
    if (!(o instanceof THREE.Mesh || o instanceof THREE.Points)) return;
    const positions = o.geometry.getAttribute('position');
    if (!positions) return;
    info.vertices += positions.count;
    for (let i = 0; i < positions.array.length; i++) if (!Number.isFinite(positions.array[i])) { invalid = true; break; }
    if (o instanceof THREE.Points) info.points = true;
    else { info.meshes++; info.triangles += (o.geometry.index?.count ?? positions.count) / 3; }
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      Object.values(m).forEach(v => { if (v instanceof THREE.Texture) textures.add(v); });
      m.side = THREE.DoubleSide;
    }
  });
  info.textures = textures.size;
  // Avoid uploading an 8K scan texture to a phone's GPU. Keep the original
  // archive intact for Quick Look, but use a bounded texture in the web viewer.
  if (typeof document !== 'undefined') {
    const limit = window.matchMedia('(pointer: coarse)').matches ? 2048 : 4096;
    textures.forEach(texture => {
      const image = texture.image as HTMLImageElement | undefined;
      if (!image || !image.width || !image.height || Math.max(image.width, image.height) <= limit) return;
      const ratio = limit / Math.max(image.width, image.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * ratio));
      canvas.height = Math.max(1, Math.round(image.height * ratio));
      const context = canvas.getContext('2d');
      if (context) { context.drawImage(image, 0, 0, canvas.width, canvas.height); texture.image = canvas; texture.needsUpdate = true; }
    });
  }
  if (invalid) { disposeObject(root); throw new Error('No usable geometry was found. Export a mesh or point cloud and try again.'); }
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (!info.vertices || bounds.isEmpty() || invalid || !Number.isFinite(longest) || longest <= 0) {
    disposeObject(root); throw new Error('No usable geometry was found. Export a mesh or point cloud and try again.');
  }
  // Normalize all model formats to the same inspection volume without changing their proportions.
  const wrapper = new THREE.Group();
  wrapper.add(root); root.position.sub(bounds.getCenter(new THREE.Vector3()));
  wrapper.scale.setScalar(2.7 / longest);
  return { root: wrapper, info };
}
