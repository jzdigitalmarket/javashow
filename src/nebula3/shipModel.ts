import { Color, Group, Mesh, MeshStandardMaterial, Object3D } from 'three';
import interceptorUrl from '../../models/interceptor.glb?url';
import bossUrl from '../../models/boss.glb?url';

export async function loadInterceptor(): Promise<Group> {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { scene } = await new GLTFLoader().loadAsync(interceptorUrl);
  return scene;
}

export async function upgradeShipVisuals(
  player: Group,
  allies: Array<{ group: Group; legacyHull: Object3D[]; tier: number }>
): Promise<void> {
  try {
    const model = await loadInterceptor();
    // Keep the low-poly fallback until the downloaded model is ready.
    player.clear();
    player.add(model);

    for (const ally of allies) {
      if (ally.tier !== 0) continue;
      const friendly = model.clone(true);
      friendly.traverse(object => {
        if (!(object instanceof Mesh)) return;
        const material = (object.material as MeshStandardMaterial).clone();
        if (material.name === 'cyan navigation') {
          material.color.set(0x49ffba);
          material.emissive = new Color(0x14b56a);
        }
        object.material = material;
      });
      for (const old of ally.legacyHull) ally.group.remove(old);
      ally.group.add(friendly);
    }
  } catch (error) {
    console.warn('Modelo 3D indisponível; usando a nave original.', error);
  }
}

export async function upgradeBossVisual(boss: { group: Group; legacyHull: Object3D[] }): Promise<void> {
  try {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { scene } = await new GLTFLoader().loadAsync(bossUrl);
    for (const old of boss.legacyHull) boss.group.remove(old);
    boss.group.add(scene);
  } catch (error) {
    console.warn('Modelo da nave-chefã indisponível; usando a nave original.', error);
  }
}
