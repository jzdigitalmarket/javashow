import { Group } from 'three';
import type { CapitalShip } from './capitalShip.ts';
import mothershipUrl from '../../models/mothership.glb?url';

let modelPromise: Promise<Group> | null = null;

function loadModel(): Promise<Group> {
  modelPromise ??= import('three/addons/loaders/GLTFLoader.js')
    .then(async ({ GLTFLoader }) => {
      const { scene } = await new GLTFLoader().loadAsync(mothershipUrl);
      return scene;
    })
    .catch(error => {
      modelPromise = null;
      throw error;
    });
  return modelPromise;
}

export async function upgradeCapitalShipVisuals(ship: CapitalShip): Promise<void> {
  try {
    const model = await loadModel();
    if (ship.detailModel) return;
    ship.group.add(model);
    ship.detailModel = model;
    setCapitalShipDetail(ship, true);
  } catch (error) {
    console.warn('Modelo detalhado da nave-mãe indisponível; mantendo casco original.', error);
  }
}

export function setCapitalShipDetail(ship: CapitalShip, detailed: boolean): void {
  if (!ship.detailModel) return;
  ship.detailModel.visible = detailed;
  for (const part of ship.legacyHull) part.visible = !detailed;
}
