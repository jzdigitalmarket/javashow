import { Vector3 } from 'three';

// Shared scratch vectors keep projectile collision checks allocation-free.
const segment = new Vector3();
const closest = new Vector3();

export function segmentDistanceSquared(point: Vector3, start: Vector3, end: Vector3): number {
  segment.subVectors(end, start);
  const lengthSquared = segment.lengthSq();
  const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0,
    closest.subVectors(point, start).dot(segment) / lengthSquared));
  closest.copy(start).addScaledVector(segment, t);
  return closest.distanceToSquared(point);
}
