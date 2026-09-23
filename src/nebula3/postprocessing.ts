import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createPostprocessing(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number
) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 1.05, 0.55, 1.0);
  composer.addPass(bloom);

  const cinematic = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      time: { value: 0 },
      warp: { value: 0 },
      damage: { value: 0 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float time, warp, damage;
      varying vec2 vUv;

      void main() {
        vec2 p = vUv - .5;
        float r = length(p);

        vec2 uv = .5 + p * (1. - warp * .055 * r);
        vec2 offset = p * (.0015 + warp * .025 + damage * .008);

        vec3 color;
        color.r = texture2D(tDiffuse, uv + offset).r;
        color.g = texture2D(tDiffuse, uv).g;
        color.b = texture2D(tDiffuse, uv - offset).b;

        float vignette = 1. - smoothstep(.24, .76, r) * .55;
        color *= vignette;

        float grain = fract(sin(dot(vUv + time,
                      vec2(12.9898, 78.233))) * 43758.5453);
        color += (grain - .5) * .012;
        color += vec3(.5, .015, .035) * damage * smoothstep(.12, .7, r);

        gl_FragColor = vec4(color, 1.);
      }
    `
  });

  composer.addPass(cinematic);
  composer.addPass(new OutputPass());
  return { composer, bloom, cinematic };
}
