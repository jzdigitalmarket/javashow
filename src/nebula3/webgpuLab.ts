import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadInterceptor } from './shipModel';

const canvas = document.querySelector<HTMLCanvasElement>('#preview')!;
const status = document.querySelector<HTMLElement>('#backend')!;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060c1a);
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, .1, 200);
camera.position.set(7, 3.5, 9);
scene.add(new THREE.HemisphereLight(0x94caff, 0x090919, 2.1));
const key = new THREE.DirectionalLight(0xd7edff, 4);
key.position.set(-4, 6, 5);
scene.add(key);
const rim = new THREE.PointLight(0x338aff, 65, 25);
rim.position.set(4, -2, -5);
scene.add(rim);

const stars = new Float32Array(600 * 3);
for (let i = 0; i < stars.length; i += 3) {
  const theta = Math.random() * Math.PI * 2;
  const altitude = Math.acos(2 * Math.random() - 1);
  stars[i] = Math.sin(altitude) * Math.cos(theta) * 60;
  stars[i + 1] = Math.cos(altitude) * 60;
  stars[i + 2] = Math.sin(altitude) * Math.sin(theta) * 60;
}
const starGeometry = new THREE.BufferGeometry();
starGeometry.setAttribute('position', new THREE.BufferAttribute(stars, 3));
scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0x87caff, size: .12 })));

const requestedWebGL = new URLSearchParams(location.search).has('webgl');
let renderer: WebGPURenderer | THREE.WebGLRenderer;
try {
  const modern = new WebGPURenderer({ canvas, antialias: true, forceWebGL: requestedWebGL });
  await modern.init();
  renderer = modern;
  status.textContent = 'isWebGPUBackend' in modern.backend && modern.backend.isWebGPUBackend
    ? 'WebGPU ativo' : 'WebGL 2 ativo (fallback)';
} catch (error) {
  console.warn('WebGPU indisponível; usando WebGL.', error);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  status.textContent = 'WebGL ativo (compatibilidade)';
}
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = .5;
controls.minDistance = 5;
controls.maxDistance = 30;

try {
  const model = await loadInterceptor();
  model.rotation.y = Math.PI;
  scene.add(model);
} catch (error) {
  console.error('Modelo indisponível.', error);
  status.textContent += ' · modelo indisponível';
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
