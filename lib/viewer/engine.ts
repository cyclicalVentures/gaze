import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyOffAxis, type EyePosition } from './projection';
import { disposeObject, parseModel, type ModelInfo } from './model';
import { applyModelGesture } from './model-transform';
import type { GestureDelta } from './hand-gestures';

export class ViewerEngine {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera();
  private controls: OrbitControls;
  private chamber = new THREE.Group();
  private model = new THREE.Group();
  private modelContent?: THREE.Group;
  private resizeObserver: ResizeObserver;
  private disposed = false;
  private visible = true;
  private loadId = 0;
  private width = 0.3;
  private height = 0.2;
  private metersPerPixel = 0.34 / 1200;
  private calibrationCenter?: { x: number; y: number };
  private eye: EyePosition = { x: 0, y: 0, z: 0.55 };
  private pose: EyePosition = { ...this.eye };
  private lastFrame = 0;
  private fpsTime = 0;
  private frames = 0;
  private zoom = 1;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  mode: 'window' | 'orbit' = 'window';
  pointerPreview = false;
  tracking = false;
  distance = 0.55;
  depth = 0.28;
  showRoom = true;
  wireframe = false;
  constructor(private host: HTMLElement, private onFps: (fps: number) => void, private onError: (message: string) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x0d0a1f);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D window. Use pointer preview to move the viewpoint, or Orbit mode to rotate the model.');
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.tabIndex = 0;
    host.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.08; this.controls.maxDistance = 3;
    this.controls.enabled = false;
    this.scene.add(this.chamber, this.model, new THREE.HemisphereLight(0xe7e6ff, 0x25123c, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.1);
    key.position.set(-0.25, 0.5, 0.6); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); key.shadow.camera.near = 0.01; key.shadow.camera.far = 3;
    key.shadow.camera.left = key.shadow.camera.bottom = -0.6;
    key.shadow.camera.right = key.shadow.camera.top = 0.6;
    key.shadow.bias = -0.0002; key.shadow.normalBias = 0.001;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xa997ff, 1); fill.position.set(0.5, 0.1, -0.4); this.scene.add(fill);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(host);
    host.addEventListener('pointermove', this.pointerMove);
    host.addEventListener('pointerleave', this.pointerLeave);
    host.addEventListener('pointerdown', this.pointerDown);
    host.addEventListener('pointerup', this.pointerUp);
    host.addEventListener('pointercancel', this.pointerUp);
    host.addEventListener('wheel', this.wheel, { passive: false });
    host.addEventListener('keydown', this.keyDown);
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.contextRestored);
    this.setPhysicalWidth(window.innerWidth < 700 ? 7 : 34);
    this.resize(); this.showCube(); this.renderer.setAnimationLoop(this.render);
  }
  private contextLost = (e: Event) => { e.preventDefault(); this.onError('The graphics context was interrupted. It will recover automatically; reload if the scene stays blank.'); };
  private contextRestored = () => { this.resize(); };
  setPhysicalWidth(cm: number) { this.metersPerPixel = cm / 100 / window.innerWidth; this.resize(); }
  setVisible(visible: boolean) { this.visible = visible; if (visible) this.resize(); }
  calibrateOrigin() { const r = this.host.getBoundingClientRect(); this.calibrationCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; this.eye = { x: 0, y: 0, z: this.distance }; }
  restoreScreenGeometry(screen: { metersPerPixel: number; center: { x: number; y: number } }) { this.metersPerPixel=screen.metersPerPixel; this.calibrationCenter={...screen.center}; this.resize(); this.center(); }
  getScreenGeometry() { const r = this.host.getBoundingClientRect(); return { width: window.innerWidth, height: window.innerHeight, metersPerPixel: this.metersPerPixel, center: this.calibrationCenter ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 } }; }
  setEye(eye: EyePosition) { this.eye = eye; }
  center() { this.eye = { x: 0, y: 0, z: this.distance }; this.pose = { ...this.eye }; this.zoom = 1; this.layoutModel(); if (this.mode === 'orbit') this.configureOrbit(); }
  setMode(mode: 'window' | 'orbit') { this.mode = mode; this.controls.enabled = mode === 'orbit'; if (mode === 'orbit') this.configureOrbit(); else this.center(); }
  private configureOrbit() {
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(this.height / (2 * this.distance)));
    this.camera.aspect = this.width / this.height; this.camera.near = 0.005; this.camera.far = 100;
    this.camera.updateProjectionMatrix(); this.camera.position.set(0, 0, this.distance);
    this.controls.target.set(0, 0, -this.depth * 0.55); this.camera.lookAt(this.controls.target); this.controls.update();
  }
  setDepth(cm: number) { this.depth = cm / 100; this.buildChamber(); this.layoutModel(); }
  setRoom(show: boolean) { this.showRoom = show; this.chamber.visible = show; }
  setWireframe(wire: boolean) {
    this.wireframe = wire;
    this.model.traverse(o => { if (o instanceof THREE.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if ('wireframe' in m) (m as THREE.MeshStandardMaterial).wireframe = wire; });
  }
  scaleBy(factor: number) { this.zoom = THREE.MathUtils.clamp(this.zoom * factor, 0.2, 2.5); this.layoutModel(); }
  rotateModel(axis: 'x' | 'y' | 'z') { this.model.rotateOnWorldAxis(new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0), Math.PI / 2); }
  applyHandGesture(delta:GestureDelta) { this.zoom=applyModelGesture(this.model,this.zoom,delta,this.camera.quaternion);this.layoutModel(); }
  resetModelTransform() {this.model.quaternion.identity();this.zoom=1;this.layoutModel();}
  showCube(): ModelInfo {
    ++this.loadId;
    const root = new THREE.Group();
    const materials = [0x7761b9, 0x393054, 0x8fede0, 0x173c40, 0x2fd6c4, 0x264e58].map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.12 }));
    const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), materials);
    cube.rotation.set(0.16, -0.42, -0.04); root.add(cube);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(cube.geometry), new THREE.LineBasicMaterial({ color: 0xabfff3, transparent: true, opacity: 0.6 })); cube.add(edges);
    root.scale.setScalar(2.7 / new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).length() * Math.sqrt(3));
    this.replace(root);
    return { name: 'Depth cube', bytes: 0, format: 'PLY', vertices: 24, triangles: 12, meshes: 1, points: false, textures: 0 };
  }
  async load(buffer: ArrayBuffer, name: string) {
    const id = ++this.loadId;
    const result = await parseModel(buffer, name);
    if (this.disposed || id !== this.loadId) { disposeObject(result.root); return null; }
    this.replace(result.root); return result.info;
  }
  cancelPendingLoad() { ++this.loadId; }
  private replace(root: THREE.Group) {
    if (this.modelContent) { this.model.remove(this.modelContent); disposeObject(this.modelContent); }
    this.modelContent = root; this.model.add(root);
    root.traverse(o => {
      if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; }
      if (o instanceof THREE.Points && o.material instanceof THREE.PointsMaterial) o.material.size = 0.0012;
    });
    this.resetModelTransform(); this.setWireframe(this.wireframe);
  }
  private layoutModel() {
    const fit = Math.min(this.width, this.height, this.depth * 1.35) * 0.85;
    this.model.scale.setScalar(fit * this.zoom / 2.7);
    this.model.position.set(0, 0, -this.depth * 0.55);
  }
  private resize() {
    if (this.disposed) return;
    const r = this.host.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return;
    this.width = r.width * this.metersPerPixel; this.height = r.height * this.metersPerPixel;
    this.renderer.setSize(r.width, r.height, false); this.buildChamber(); this.layoutModel();
    if (this.mode === 'orbit') this.configureOrbit();
  }
  private buildChamber() {
    disposeObject(this.chamber);
    this.chamber.traverse(o => { if (o instanceof THREE.LineSegments) { o.geometry.dispose(); if (o.material instanceof THREE.Material) o.material.dispose(); } });
    this.chamber.clear();
    const w = this.width, h = this.height, d = this.depth;
    const makeWall = (width: number, height: number, color: number, position: [number, number, number], rotation: [number, number, number]) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }));
      mesh.position.set(...position); mesh.rotation.set(...rotation); mesh.receiveShadow = true; this.chamber.add(mesh);
    };
    makeWall(w, h, 0x120e26, [0, 0, -d], [0, 0, 0]);
    makeWall(w, d, 0x1a1632, [0, -h / 2, -d / 2], [-Math.PI / 2, 0, 0]);
    makeWall(w, d, 0x0f0c20, [0, h / 2, -d / 2], [Math.PI / 2, 0, 0]);
    makeWall(d, h, 0x17112d, [-w / 2, 0, -d / 2], [0, Math.PI / 2, 0]);
    makeWall(d, h, 0x17112d, [w / 2, 0, -d / 2], [0, -Math.PI / 2, 0]);
    const vertices: number[] = [];
    const line = (a: number[], b: number[]) => vertices.push(...a, ...b);
    const inset = 0.0004;
    for (let i = 0; i <= 8; i++) {
      const z = -d * i / 8 + inset;
      line([-w / 2 + inset, -h / 2 + inset, z], [w / 2 - inset, -h / 2 + inset, z]);
      line([-w / 2 + inset, -h / 2, z], [-w / 2 + inset, h / 2, z]);
      line([w / 2 - inset, -h / 2, z], [w / 2 - inset, h / 2, z]);
    }
    for (let i = 0; i <= 10; i++) {
      const x = -w / 2 + w * i / 10;
      line([x, -h / 2 + inset, 0], [x, -h / 2 + inset, -d]);
      line([x, -h / 2, -d + inset], [x, h / 2, -d + inset]);
    }
    for (let i = 0; i <= 6; i++) { const y = -h / 2 + h * i / 6; line([-w / 2, y, -d + inset], [w / 2, y, -d + inset]); }
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    this.chamber.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x665389, transparent: true, opacity: 0.32 })));
    this.chamber.visible = this.showRoom;
  }
  private render = (time: number) => {
    if (this.disposed || !this.visible || document.hidden) return;
    const dt = Math.min((time - this.lastFrame) / 1000, 0.05); this.lastFrame = time;
    if (this.mode === 'window') {
      const a = this.tracking ? 1 : 1 - Math.exp(-dt * 16);
      this.pose.x += (this.eye.x - this.pose.x) * a; this.pose.y += (this.eye.y - this.pose.y) * a; this.pose.z += (this.eye.z - this.pose.z) * a;
      const eye = { ...this.pose };
      if (this.tracking && this.calibrationCenter) {
        const r = this.host.getBoundingClientRect();
        eye.x -= (r.left + r.width / 2 - this.calibrationCenter.x) * this.metersPerPixel;
        eye.y += (r.top + r.height / 2 - this.calibrationCenter.y) * this.metersPerPixel;
      }
      applyOffAxis(this.camera, eye, this.width, this.height);
    } else this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.frames++;
    if (time - this.fpsTime >= 1000) { this.onFps(Math.round(this.frames * 1000 / (time - this.fpsTime))); this.frames = 0; this.fpsTime = time; }
  };
  private pointerDown = (e: PointerEvent) => { if (e.target !== this.renderer.domElement) return; this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); this.renderer.domElement.setPointerCapture(e.pointerId); };
  private pointerUp = (e: PointerEvent) => { this.pointers.delete(e.pointerId); this.pinchDistance = 0; };
  private pointerMove = (e: PointerEvent) => {
    if (e.target !== this.renderer.domElement) return;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.mode !== 'window') return;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]; const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDistance) this.scaleBy(distance / this.pinchDistance);
      this.pinchDistance = distance; return;
    }
    if (!this.pointerPreview || this.tracking) return;
    const r = this.host.getBoundingClientRect();
    this.eye = { x: ((e.clientX - r.left) / r.width - 0.5) * this.width * 1.7, y: (0.5 - (e.clientY - r.top) / r.height) * this.height * 1.7, z: this.distance };
  };
  private pointerLeave = () => { if (!this.tracking && this.mode === 'window') this.eye = { x: 0, y: 0, z: this.distance }; };
  private wheel = (e: WheelEvent) => { if (this.mode === 'window' && e.target === this.renderer.domElement) { e.preventDefault(); this.scaleBy(Math.exp(-e.deltaY * 0.001)); } };
  private keyDown = (e: KeyboardEvent) => {
    if (e.target !== this.renderer.domElement) return;
    if (e.key === '+' || e.key === '=') { this.scaleBy(1.1); e.preventDefault(); }
    if (e.key === '-') { this.scaleBy(1 / 1.1); e.preventDefault(); }
    if (e.key.toLowerCase() === 'r') this.center();
    if (this.mode === 'window' && !this.tracking && e.key.startsWith('Arrow')) {
      e.preventDefault(); this.eye = { ...this.eye, x: this.eye.x + (e.key === 'ArrowRight' ? 0.02 : e.key === 'ArrowLeft' ? -0.02 : 0), y: this.eye.y + (e.key === 'ArrowUp' ? 0.02 : e.key === 'ArrowDown' ? -0.02 : 0) };
    }
  };
  dispose() {
    this.disposed = true; ++this.loadId; this.renderer.setAnimationLoop(null); this.resizeObserver.disconnect(); this.controls.dispose();
    this.host.removeEventListener('pointermove', this.pointerMove); this.host.removeEventListener('pointerleave', this.pointerLeave); this.host.removeEventListener('pointerdown', this.pointerDown); this.host.removeEventListener('pointerup', this.pointerUp); this.host.removeEventListener('pointercancel', this.pointerUp); this.host.removeEventListener('wheel', this.wheel); this.host.removeEventListener('keydown', this.keyDown);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost); this.renderer.domElement.removeEventListener('webglcontextrestored', this.contextRestored);
    disposeObject(this.scene);
    this.scene.traverse(o => { if (o instanceof THREE.LineSegments) { o.geometry.dispose(); if (o.material instanceof THREE.Material) o.material.dispose(); } });
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
