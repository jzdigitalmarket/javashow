import { Color, Vector3 } from 'three';

export function createParticlePool(capacity: number) {
  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const lives = new Float32Array(capacity);
  const maxLives = new Float32Array(capacity);
  const velocities = new Float32Array(capacity * 3);
  const baseColors = new Float32Array(capacity * 3);
  const direction = new Vector3();
  const color = new Color();
  let cursor = 0;

  function burst(position: Vector3, hex: number, count: number, force: number,
    visibleCount: number, random: (min: number, max: number) => number) {
    const limit = Math.max(1, Math.min(capacity, visibleCount));
    color.setHex(hex).multiplyScalar(4);
    for (let i = 0; i < count; i++) {
      const index = cursor++ % limit;
      const k = index * 3;
      position.toArray(positions, k);
      direction.randomDirection().multiplyScalar(random(force * .15, force));
      direction.toArray(velocities, k);
      color.toArray(baseColors, k);
      color.toArray(colors, k);
      lives[index] = maxLives[index] = random(.3, 1.3);
    }
  }

  function update(dt: number, visibleCount: number) {
    const damping = Math.exp(-1.7 * dt);
    const limit = Math.min(capacity, visibleCount);
    for (let i = 0; i < limit; i++) {
      if (lives[i] <= 0) continue;
      lives[i] = Math.max(0, lives[i] - dt);
      const k = i * 3;
      const fade = lives[i] / maxLives[i];
      for (let axis = 0; axis < 3; axis++) {
        positions[k + axis] += velocities[k + axis] * dt;
        velocities[k + axis] *= damping;
        colors[k + axis] = baseColors[k + axis] * fade;
      }
    }
  }

  function clear() {
    lives.fill(0);
    colors.fill(0);
    cursor = 0;
  }

  return { positions, colors, lives, burst, update, clear };
}
