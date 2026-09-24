import { BoxGeometry, ConeGeometry, Group, Mesh, MeshStandardMaterial,
  SphereGeometry } from 'three';

const box = new BoxGeometry(1, 1, 1);
const sphere = new SphereGeometry(1, 8, 6);
const cone = new ConeGeometry(1, 1, 8);
const steel = new MeshStandardMaterial({ color: 0x536777, metalness: .72, roughness: .42 });
const dark = new MeshStandardMaterial({ color: 0x24313b, metalness: .58, roughness: .65 });
const ore = new MeshStandardMaterial({ color: 0xb88145, metalness: .35, roughness: .68 });
const signal = new MeshStandardMaterial({ color: 0xffad50, emissive: 0x8e3908,
  emissiveIntensity: .5, roughness: .48 });

function part(parent: Group, geometry: BoxGeometry | SphereGeometry | ConeGeometry,
  material: MeshStandardMaterial, xyz: [number, number, number],
  scale: [number, number, number]) {
  const item = new Mesh(geometry, material);
  item.position.set(...xyz);
  item.scale.set(...scale);
  parent.add(item);
  return item;
}

export function createLunarMine(moon: Group, radius: number) {
  const mine = new Group();
  mine.position.y = radius * .94 + 3;
  moon.add(mine);

  // Surface anchor, loading pad, storage tanks and a gantry around the drill.
  part(mine, box, dark, [0, -1, 0], [67, 2, 38]);
  part(mine, box, steel, [-21, 2, 4], [25, 5, 20]);
  part(mine, box, dark, [-21, 5, 4], [17, 2, 15]);
  for (const x of [-29, -13]) {
    part(mine, box, steel, [x, 10, -5], [4, 12, 4]);
    part(mine, box, steel, [x, 10, 13], [4, 12, 4]);
  }
  part(mine, box, steel, [-21, 17, 4], [23, 2, 24]);
  part(mine, box, dark, [15, 2, -1], [28, 5, 23]);
  for (const x of [6, 15, 24]) {
    part(mine, box, ore, [x, 6, -1], [7, 5, 17]);
    part(mine, box, steel, [x, 9, -1], [8, 1, 18]);
  }
  part(mine, box, steel, [36, 1, 0], [24, 2, 25]);
  for (const z of [-10, 10]) {
    part(mine, box, signal, [36, 2.3, z], [2, .5, 2]);
    part(mine, box, steel, [-35, 1, z], [4, 4, 4]);
  }

  const drill = new Group();
  drill.position.set(-21, 11, 4);
  mine.add(drill);
  part(drill, box, steel, [0, 0, 0], [8, 18, 8]);
  part(drill, box, dark, [0, -9, 0], [5, 14, 5]);
  part(drill, cone, signal, [0, -19, 0], [3, 9, 3]).rotation.z = Math.PI;
  const bit = part(drill, box, ore, [0, -14, 0], [3, 8, 3]);

  const beltOre = Array.from({ length: 5 }, (_, index) =>
    part(mine, sphere, ore, [index * 6 - 1, 10, -1], [2.4, 1.6, 2.1]));

  const rover = new Group();
  mine.add(rover);
  part(rover, box, steel, [0, 0, 0], [10, 4, 7]);
  part(rover, box, ore, [0, 3, 0], [7, 3, 5]);
  for (const x of [-3, 3]) for (const z of [-4, 4])
    part(rover, sphere, dark, [x, -2, z], [2, 2, 1]);

  return { mine, drill, bit, beltOre, rover };
}
