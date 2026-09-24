# javashow

## Nebula 3

O jogo continua disponível em `nebula3.html`. O código de desenvolvimento fica em `web/nebula3.html` e `src/nebula3/`; Vite gera a página e os arquivos versionados em `assets/` para publicação estática no diretório raiz. A migração é gradual: configuração, áudio, modelos, colisões, mísseis e partículas usam módulos TypeScript, enquanto a lógica central permanece em `game.js`.

Use Node.js `20.19+` na série 20 ou `22.12+` nas séries posteriores. A qualidade **Automática** mede o FPS durante a missão e reduz os efeitos se ficar abaixo de 45 FPS durante oito segundos, após um aquecimento inicial de três segundos. A qualidade volta ao nível inicial na próxima missão; **Econômica** mantém o custo reduzido desde o início.

```sh
npm ci
npm run check
npm run dev
npm run build
```

`npm run build` gera `nebula3.html` e `nebula3-webgpu.html` no diretório raiz. Inclua os arquivos gerados em `assets/` no commit. Os assets são referenciados relativamente à página, permitindo publicar o jogo na raiz do Cloudflare Pages ou no subdiretório `/javashow/` do GitHub Pages. Edite as fontes em `web/` e `src/`, não o HTML gerado.

O modelo da nave do jogador e aliados e o modelo da nave-chefã estão em `models/*.glb`. Para recriá-los, execute `python scripts/generate-nebula-model.py`. O jogo usa o modelo anterior como reserva caso um GLB não carregue.

`nebula3-webgpu.html` é um laboratório separado com WebGPU e fallback para WebGL 2. A partida principal continua em WebGL 2, pois os shaders GLSL personalizados e os passes de pós-processamento exigem migração específica antes de mudar de renderizador.
