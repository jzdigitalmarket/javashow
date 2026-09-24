import { AdditiveBlending, BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, ShaderMaterial, SphereGeometry, TorusGeometry } from 'three';

const box = new BoxGeometry(1, 1, 1);
const dome = new SphereGeometry(1, 12, 8);
const hull = new MeshStandardMaterial({ color: 0x8ca7ad, metalness: .68, roughness: .4 });
const cargo = new MeshStandardMaterial({ color: 0xb18a62, metalness: .42, roughness: .57 });
const navigation = new MeshStandardMaterial({
  color: 0x8df4d6, emissive: 0x1c987e, emissiveIntensity: .55,
  metalness: .25, roughness: .38
});
const shieldGeometry = new SphereGeometry(1, 28, 18);
const shieldRingGeometry = new TorusGeometry(1, .018, 6, 64);

function makeCargoShield(craft: Group) {
  const material = new ShaderMaterial({
    transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uStrength: { value: 1 }, uHit: { value: 0 } },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      uniform float uTime;
      uniform float uStrength;
      uniform float uHit;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.0);
        float pulse = 0.88 + 0.12 * sin(uTime * 3.5);
        float bands = pow(max(0.0, sin(vNormal.y * 22.0 + uTime * 1.5)), 8.0);
        float alpha = (0.045 + rim * 0.54 + bands * rim * 0.12 + uHit * 0.32)
          * pulse * uStrength;
        gl_FragColor = vec4(1.0, 0.73 + uHit * 0.15, 0.16 + uHit * 0.42, alpha);
      }
    `
  });
  const field = new Mesh(shieldGeometry, material);
  field.scale.set(19, 11, 23);
  field.renderOrder = 2;
  craft.add(field);

  const ringMaterial = new MeshBasicMaterial({
    color: 0xffce4f, transparent: true, opacity: .62,
    depthWrite: false, blending: AdditiveBlending
  });
  const ring = new Mesh(shieldRingGeometry, ringMaterial);
  ring.scale.set(18.5, 21, 1);
  ring.rotation.x = Math.PI / 2;
  ring.renderOrder = 3;
  craft.add(ring);
  return { field, ring, material, ringMaterial };
}

function part(
  parent: Group, geometry: BoxGeometry | SphereGeometry, material: MeshStandardMaterial,
  position: [number, number, number], size: [number, number, number]
) {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...size);
  parent.add(mesh);
}

export function createCivilianConvoy() {
  const group = new Group();
  let cargoShield: ReturnType<typeof makeCargoShield> | null = null;
  const ships = Array.from({ length: 3 }, (_, index) => {
    const craft = new Group();
    const freighter = index === 0;
    craft.position.set(freighter ? 0 : (index === 1 ? -34 : 34),
      freighter ? 0 : 10, freighter ? 0 : -18);
    if (freighter) {
      part(craft, box, hull, [0, 0, 0], [9, 4, 25]);
      part(craft, dome, hull, [0, 2, 7], [3.5, 2, 6]);
      for (const side of [-1, 1]) {
        part(craft, box, cargo, [side * 7, -.3, -3], [7, 4, 13]);
        part(craft, box, hull, [side * 5, -.3, 9], [9, .8, 5]);
        part(craft, dome, navigation, [side * 3, 0, -13], [1.4, 1.4, 1.5]);
      }
      cargoShield = makeCargoShield(craft);
    } else {
      part(craft, box, hull, [0, 0, 0], [5, 2.2, 13]);
      part(craft, box, hull, [0, 0, 7], [3, 2, 5]);
      for (const side of [-1, 1]) {
        part(craft, box, hull, [side * 6, -.4, -2], [9, .8, 6]);
        part(craft, dome, navigation, [side * 1.7, 0, -7], [1, 1, 1.3]);
      }
    }
    group.add(craft);
    return { group: craft, hp: freighter ? 48 : 22,
      maxHp: freighter ? 48 : 22, alive: true, role: freighter ? 'cargo' : 'escort',
      cooldown: index * .8 };
  });
  return { group, ships, cargoShield: cargoShield! };
}
