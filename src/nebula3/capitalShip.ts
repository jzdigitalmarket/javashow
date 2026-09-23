import * as THREE from 'three';

type CapitalShip = {
  group: THREE.Group;
  core: THREE.Mesh;
  commandRing: THREE.Mesh;
  turrets: THREE.Group[];
};

// The long armored hull is made from octagonal cross sections. It retains a
// recognizable silhouette from far away without loading a large texture.
function hullGeometry(): THREE.BufferGeometry {
  const sections = [
    [18, .16, .16], [15, .85, .5], [11, 1.8, .8], [6, 3.3, 1.4],
    [1, 4.5, 1.85], [-4, 5.1, 2], [-9, 4.4, 1.7], [-13, 2.8, 1.3],
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [z, width, height] of sections) {
    for (let i = 0; i < 8; i++) {
      const angle = (i + .5) * Math.PI / 4;
      positions.push(Math.cos(angle) * width, Math.sin(angle) * height, z);
    }
  }
  for (let s = 0; s < sections.length - 1; s++) {
    for (let i = 0; i < 8; i++) {
      const a = s * 8 + i;
      const b = s * 8 + (i + 1) % 8;
      const c = a + 8;
      const d = b + 8;
      indices.push(a, b, c, b, d, c);
    }
  }
  for (let i = 1; i < 7; i++) {
    indices.push(0, i + 1, i);
    const back = (sections.length - 1) * 8;
    indices.push(back, back + i, back + i + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function wingGeometry(side: number): THREE.BufferGeometry {
  const outline = new THREE.Shape();
  outline.moveTo(side * 2.2, 7);
  outline.lineTo(side * 7.2, 2);
  outline.lineTo(side * 10.8, -8.5);
  outline.lineTo(side * 9.4, -10.5);
  outline.lineTo(side * 4, -8.5);
  outline.lineTo(side * 2.2, 7);
  const geometry = new THREE.ExtrudeGeometry(outline, {
    depth: .36, bevelEnabled: false, curveSegments: 1,
  });
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

export function createCapitalShip(): CapitalShip {
  const group = new THREE.Group();
  group.scale.setScalar(13);

  const hull = new THREE.MeshStandardMaterial({
    color: 0x667582, metalness: .74, roughness: .48, side: THREE.DoubleSide,
  });
  const plate = new THREE.MeshStandardMaterial({
    color: 0x8796a0, metalness: .7, roughness: .5,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x273440, metalness: .65, roughness: .57,
  });
  const shadow = new THREE.MeshStandardMaterial({
    color: 0x111e29, metalness: .46, roughness: .62,
  });
  const lit = new THREE.MeshStandardMaterial({
    color: 0xe39a64, emissive: 0x8a310d, emissiveIntensity: .6,
    metalness: .25, roughness: .5,
  });
  const engine = new THREE.MeshStandardMaterial({
    color: 0x75cad4, emissive: 0x197384, emissiveIntensity: .8,
    metalness: .35, roughness: .38,
  });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const ball = new THREE.IcosahedronGeometry(1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);

  function part(
    geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D,
    position: [number, number, number], scale: [number, number, number] = [1, 1, 1],
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    parent.add(mesh);
    return mesh;
  }

  part(hullGeometry(), hull, group, [0, 0, 0]);
  part(box, dark, group, [0, -1.2, -4], [7.6, .65, 11]);

  for (const side of [-1, 1]) {
    part(wingGeometry(side), plate, group, [0, -.2, 0]);
    const wingInset = part(box, dark, group, [side * 6.4, .17, -4.6], [3.5, .16, 4.6]);
    wingInset.rotation.y = side * -.15;
    part(box, hull, group, [side * 6.1, .32, -4.3], [2.1, .13, 3.4]);

    // Two full-size nacelles give the profile its twin-engine outline.
    const pod = part(cylinder, hull, group, [side * 8.25, -.55, -7.2], [1.55, 10, 1.55]);
    pod.rotation.x = Math.PI / 2;
    const rear = part(cylinder, dark, group, [side * 8.25, -.55, -12.35],
      [1.8, .8, 1.8]);
    rear.rotation.x = Math.PI / 2;
    const nozzle = part(cylinder, engine, group, [side * 8.25, -.55, -12.83],
      [1.05, .24, 1.05]);
    nozzle.rotation.x = Math.PI / 2;
    for (let i = 0; i < 5; i++) {
      const band = part(cylinder, dark, group,
        [side * 8.25, -.55, -10.8 + i * 1.55], [1.63, .13, 1.63]);
      band.rotation.x = Math.PI / 2;
    }

    // Recessed gun ports and navigation marks on the flanks.
    for (let i = 0; i < 6; i++) {
      part(box, shadow, group, [side * 4.6, -.62, -7 + i * 1.6],
        [.13, .43, .8]);
    }
    part(ball, lit, group, [side * 9.6, .2, -7.5], [.25, .25, .25]);
  }

  // Raised bridge and its dark observation band sit behind the long bow.
  part(box, dark, group, [0, 2, -5.5], [5.7, .6, 5]);
  const tower = part(new THREE.CylinderGeometry(1.9, 3, 3.8, 8), plate,
    group, [0, 4.15, -6.6]);
  tower.rotation.y = Math.PI / 8;
  part(box, shadow, group, [0, 5.25, -4.9], [3.7, .58, .18]);
  part(ball, hull, group, [0, 6.65, -6.6], [2.5, 1.25, 2.1]);
  part(box, shadow, group, [0, 6.8, -4.62], [2.8, .5, .22]);
  part(box, dark, group, [0, 8.5, -6.8], [.12, 2.2, .12]);
  part(box, plate, group, [0, 9.6, -6.8], [1.6, .12, .15]);

  // A narrow spine and inset cockpit make the bow readable in silhouette.
  part(box, dark, group, [0, 1.06, 11], [.45, .12, 8]);
  part(box, shadow, group, [0, 1.25, 8.8], [1.15, .12, 2.8]);

  // A single instanced mesh supplies hull plating without hundreds of draw calls.
  const panelCount = 88;
  const panels = new THREE.InstancedMesh(box, plate, panelCount);
  const transform = new THREE.Object3D();
  for (let i = 0; i < panelCount; i++) {
    const row = Math.floor(i / 4);
    const column = i % 4;
    const z = 11 - row * 1.02;
    const width = z > 6 ? 1.8 : z > 1 ? 3.3 : z > -9 ? 5 : 2.8;
    const height = z > 6 ? .82 : z > 1 ? 1.38 : z > -9 ? 1.92 : 1.3;
    const x = (column - 1.5) * width * .37;
    const y = height * (.98 - Math.max(0, Math.abs(x) / width - .36) * 1.3);
    transform.position.set(x, y + .06, z);
    transform.scale.set(width * .27, .055, .78);
    transform.rotation.set(0, 0, x < 0 ? -.04 : .04);
    transform.updateMatrix();
    panels.setMatrixAt(i, transform.matrix);
    panels.setColorAt(i, new THREE.Color(i % 7 === 0 ? 0x687782 : 0x93a2ab));
  }
  panels.instanceMatrix.needsUpdate = true;
  group.add(panels);

  const turrets: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    for (const z of [4, 0, -4, -8]) {
      const turret = new THREE.Group();
      turret.position.set(side * (z > 0 ? 2.6 : 4.1),
        z > 0 ? 1.35 : z > -6 ? .7 : .55, z);
      group.add(turret);
      part(cylinder, dark, turret, [0, 0, 0], [.6, .42, .6]);
      const barrel = part(cylinder, hull, turret, [0, .2, 1.05], [.18, 2.2, .18]);
      barrel.rotation.x = Math.PI / 2;
      part(ball, lit, turret, [0, .2, 2.1], [.15, .15, .15]);
      turrets.push(turret);
    }
  }

  const core = part(ball, engine, group, [0, -2.05, -5], [1.5, .65, 1.5]);
  const commandRing = part(new THREE.TorusGeometry(1.45, .075, 6, 24), lit,
    group, [0, 7.85, -6.6]);
  commandRing.rotation.x = Math.PI / 2;

  return { group, core, commandRing, turrets };
}
