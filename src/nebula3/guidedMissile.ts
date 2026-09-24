import { BoxGeometry, ConeGeometry, Group, Mesh, MeshStandardMaterial,
  Quaternion, Vector3 } from 'three';

const cone = new ConeGeometry(1, 3.8, 8);
const box = new BoxGeometry(1, 1, 1);
const nose = new MeshStandardMaterial({ color: 0xf0bd75, metalness: .62, roughness: .38 });
const hull = new MeshStandardMaterial({ color: 0x849cab, metalness: .72, roughness: .34 });
const fin = new MeshStandardMaterial({ color: 0x35586b, metalness: .66, roughness: .4 });
const engine = new MeshStandardMaterial({ color: 0x68e6d0, emissive: 0x238977,
  emissiveIntensity: .75, roughness: .36 });

export function createGuidedMissile() {
  const group = new Group();
  const body = new Mesh(box, hull);
  body.scale.set(.85, 3.8, .85);
  group.add(body);
  const tip = new Mesh(cone, nose);
  tip.position.y = 2.8;
  tip.scale.set(.65, 1.1, .65);
  group.add(tip);
  for (const side of [-1, 1]) {
    const wing = new Mesh(box, fin);
    wing.position.set(side * .9, -1.25, 0);
    wing.scale.set(1.5, 1.2, .18);
    group.add(wing);
  }
  const plume = new Mesh(cone, engine);
  plume.position.y = -2.8;
  plume.rotation.z = Math.PI;
  plume.scale.set(.5, 1.2, .5);
  group.add(plume);
  return group;
}

// Turn at a bounded angular rate; lead the target without snapping instantly.
export function steerGuidedMissile(
  current: Vector3, position: Vector3, target: Vector3, targetVelocity: Vector3,
  speed: number, dt: number, turnRate = 5.4
) {
  const distance = position.distanceTo(target);
  const leadTime = Math.min(.65, distance / Math.max(speed, 1) * .65);
  const desired = target.clone().addScaledVector(targetVelocity, leadTime)
    .sub(position).normalize();
  if (desired.lengthSq() < 1e-8) return current.clone();
  const direction = current.clone().normalize();
  const angle = direction.angleTo(desired);
  if (angle < 1e-5) return desired;
  const rotation = new Quaternion().setFromUnitVectors(direction, desired);
  return direction.applyQuaternion(new Quaternion().slerp(rotation,
    Math.min(1, turnRate * dt / angle))).normalize();
}
