# javashow

## Nebula 3

O jogo continua disponível em `nebula3.html`. O código de desenvolvimento fica em `web/nebula3.html` e `src/nebula3/`; Vite gera a página e os arquivos versionados em `assets/` para publicação estática no diretório raiz. A migração é gradual: configuração, áudio e carregamento dos modelos usam TypeScript, enquanto a lógica central permanece em `game.js` para preservar as mecânicas existentes.

```sh
npm ci
npm run check
npm run dev
npm run build
```

`npm run build` gera `nebula3.html` e `nebula3-webgpu.html` no diretório raiz. Inclua os arquivos gerados em `assets/` no commit. Edite as fontes em `web/` e `src/`, não o HTML gerado.

O modelo da nave do jogador e aliados e o modelo da nave-chefã estão em `models/*.glb`. Para recriá-los, execute `python scripts/generate-nebula-model.py`. O jogo usa o modelo anterior como reserva caso um GLB não carregue.

`nebula3-webgpu.html` é um laboratório separado com WebGPU e fallback para WebGL 2. A partida principal continua em WebGL 2, pois os shaders GLSL personalizados e os passes de pós-processamento exigem migração específica antes de mudar de renderizador.
