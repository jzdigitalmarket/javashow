import { readFile, writeFile, readdir, mkdir, copyFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const generated = resolve(root, 'dist-nebula3');
const assetDirectory = resolve(root, 'assets');
const manifestPath = resolve(assetDirectory, 'nebula3-manifest.json');
const newAssets = (await readdir(resolve(generated, 'assets')))
  .filter(name => /^nebula3-[\w-]+\.(js|css|mp3|ogg|webp|png|glb)$/.test(name));

await mkdir(assetDirectory, { recursive: true });
let previous = [];
try { previous = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { /* First build. */ }
for (const name of previous) {
  if (typeof name === 'string' && /^nebula3-[\w-]+\.(js|css|mp3|ogg|webp|png|glb)$/.test(name)) {
    await rm(resolve(assetDirectory, name), { force: true });
  }
}
for (const name of newAssets) {
  await copyFile(resolve(generated, 'assets', name), resolve(assetDirectory, name));
}
await copyFile(resolve(generated, 'nebula3.html'), resolve(root, 'nebula3.html'));
await copyFile(resolve(generated, 'nebula3-webgpu.html'), resolve(root, 'nebula3-webgpu.html'));
await writeFile(manifestPath, JSON.stringify(newAssets, null, 2) + '\n');
console.log(`Nebula 3 publicado no diretório raiz com ${newAssets.length} arquivos gerados.`);
