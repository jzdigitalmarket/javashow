import { BoxGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three';

const box = new BoxGeometry(1, 1, 1);
const dome = new SphereGeometry(1, 12, 8);
const hull = new MeshStandardMaterial({ color: 0x8ca7ad, metalness: .68, roughness: .4 });
const cargo = new MeshStandardMaterial({ color: 0xb18a62, metalness: .42, roughness: .57 });
const navigation = new MeshStandardMaterial({
  color: 0x8df4d6, emissive: 0x1c987e, emissiveIntensity: .55,
  metalness: .25, roughness: .38
});

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
  const ships = Array.from({ length: 3 }, (_, index) => {
    const craft = new Group();
    craft.position.set((index - 1) * 32, (index % 2) * 10, (index - 1) * 16);
    part(craft, box, hull, [0, 0, 0], [7, 3, 20]);
    part(craft, dome, hull, [0, 2, 3], [3, 1.8, 5]);
    for (const side of [-1, 1]) {
      part(craft, box, cargo, [side * 6, -.2, -2], [5, 3, 9]);
      part(craft, box, hull, [side * 5, -.3, 6], [6, .5, 4]);
      part(craft, dome, navigation, [side * 2.4, 0, -10], [1, 1, 1.2]);
    }
    group.add(craft);
    return { group: craft, hp: 24, maxHp: 24, alive: true };
  });
  return { group, ships };
}
