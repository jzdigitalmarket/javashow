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
  return { group, ships };
}
