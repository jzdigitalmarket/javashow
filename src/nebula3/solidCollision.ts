import { Vector3 } from 'three';

export type SolidSphere = {
  center: Vector3;
  radius: number;
  key: string;
  kind: string;
  source?: unknown;
};

export type SolidContact = { solid: SolidSphere; normal: Vector3 };

// Sweep a moving sphere against solid world objects, then slide along their
// surfaces. This also resolves a spawn or sector load that starts inside one.
export function moveAgainstSolids(
  start: Vector3,
  end: Vector3,
  shipRadius: number,
  solids: SolidSphere[],
): { position: Vector3; contacts: SolidContact[] } {
  const position = start.clone();
  const remaining = end.clone().sub(start);
  const contacts: SolidContact[] = [];

  for (let pass = 0; pass < 5; pass++) {
    let earliest = Infinity;
    let collided: SolidSphere | null = null;
    let inside = false;
    const lengthSquared = remaining.lengthSq();

    for (const solid of solids) {
      const radius = solid.radius + shipRadius;
      const offset = position.clone().sub(solid.center);
      const distanceSquared = offset.lengthSq();
      if (distanceSquared < radius * radius - .0001) {
        earliest = 0;
        collided = solid;
        inside = true;
        break;
      }
      if (lengthSquared < 1e-10) continue;
      const b = offset.dot(remaining);
      if (b >= 0) continue;
      const discriminant = b * b - lengthSquared * (distanceSquared - radius * radius);
      if (discriminant < 0) continue;
      const t = (-b - Math.sqrt(discriminant)) / lengthSquared;
      if (t >= 0 && t <= 1 && t < earliest) {
        earliest = t;
        collided = solid;
        inside = false;
      }
    }

    if (!collided) {
      position.add(remaining);
      break;
    }

    if (!inside) position.addScaledVector(remaining, earliest);
    const normal = position.clone().sub(collided.center);
    if (normal.lengthSq() < 1e-8) normal.copy(remaining).negate();
    if (normal.lengthSq() < 1e-8) normal.set(0, 1, 0);
    normal.normalize();
    position.copy(collided.center).addScaledVector(normal, collided.radius + shipRadius + .02);
    remaining.multiplyScalar(1 - (inside ? 0 : earliest));
    const inward = remaining.dot(normal);
    if (inward < 0) remaining.addScaledVector(normal, -inward);
    contacts.push({ solid: collided, normal });
  }

  return { position, contacts };
}
