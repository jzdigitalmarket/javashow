import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial,
  SphereGeometry } from 'three';

const box = new BoxGeometry(1, 1, 1);
const cylinder = new CylinderGeometry(1, 1, 1, 10);
const sphere = new SphereGeometry(1, 10, 8);
const hull = new MeshStandardMaterial({ color: 0x597b89, metalness: .7, roughness: .4 });
const armor = new MeshStandardMaterial({ color: 0x243e4c, metalness: .65, roughness: .46 });
const tank = new MeshStandardMaterial({ color: 0x8dc6b4, metalness: .5, roughness: .43 });
const safety = new MeshStandardMaterial({ color: 0xffbc6d, emissive: 0x6b3210,
  emissiveIntensity: .38, metalness: .35, roughness: .5 });

function part(parent: Group, geometry: BoxGeometry | CylinderGeometry | SphereGeometry,
  material: MeshStandardMaterial, position: [number, number, number],
  size: [number, number, number]) {
  const item = new Mesh(geometry, material);
  item.position.set(...position);
  item.scale.set(...size);
  parent.add(item);
  return item;
}

export function createRescueShip() {
  const group = new Group();
  part(group, box, hull, [0, 0, 0], [8, 4, 19]);
  part(group, sphere, armor, [0, 1.6, 6], [3, 2, 5]);
  for (const side of [-1, 1]) {
    part(group, cylinder, tank, [side * 6.4, -.5, -1], [2.8, 11, 2.8])
      .rotation.x = Math.PI / 2;
    part(group, box, armor, [side * 7, -2, -2], [7, .7, 11]);
    part(group, box, safety, [side * 6.4, 2.5, 0], [3, .5, 3.5]);
    part(group, sphere, safety, [side * 2.2, 0, -10], [1.3, 1.3, 1.2]);
  }
  part(group, box, armor, [0, -3.5, 5], [3, 5, 9]);
  part(group, cylinder, tank, [0, -6.5, 9], [.8, 5, .8])
    .rotation.x = Math.PI / 2;
  part(group, sphere, safety, [0, -6.5, 12], [1.8, 1.1, 1.5]);
  return group;
}
