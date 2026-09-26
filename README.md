# Nebula 3 — Operação Órbita Fantasma

**Nebula 3** é um jogo de combate e exploração espacial em 3D, executado no navegador. Pilote um interceptador experimental, proteja o planeta Aurora e suas três luas mineradoras, enfrente a frota inimiga e mantenha as rotas de abastecimento abertas.

**[Jogar Nebula 3](https://javashow.pages.dev/nebula3)** · [Código-fonte](https://github.com/jzdigitalmarket/javashow)

## Como jogar

1. Abra o jogo, ajuste a dificuldade, a qualidade gráfica e o áudio no painel inicial.
2. Clique em **Iniciar missão**. No celular, ative os controles de toque e use a tela na horizontal.
3. Use o radar para encontrar ameaças, luas, estações e o cargueiro lunar. Destrua os inimigos e proteja a infraestrutura de Aurora.
4. Aproxime-se de uma estação com reservas para recuperar combustível e outros recursos. Se ficar sem combustível, uma nave tanque de apoio poderá ser enviada.

A missão reúne drones com comportamentos diferentes, naves supersônicas, chefão, nave-mãe e esquadrões aliados de três classes. As luas produzem minério; cargueiros escoltados transportam a carga até as estações de apoio. O cargueiro tem um campo defensivo dourado que absorve impactos e se recarrega após um período sem dano. As estações e os aliados também podem ser atingidos.

Aurora tem população, economia, comércio, cultura, tecnologia e estabilidade acompanhados no painel. O planeta e as luas dispõem de baterias defensivas. Em momentos aleatórios, uma invasão pode atingir Aurora, seus satélites e as minas **mesmo que você esteja em outro setor**. O alerta vermelho traz sirene e ordens alternadas do chanceler Mr. Fluffy e do general Perrito; naves aliadas, baterias e estações respondem ao ataque. Também ocorrem combates secundários em setores distantes.

### Controles: teclado e mouse

| Ação | Controle |
| --- | --- |
| Mover a nave | **W A S D** |
| Mirar | **Mouse** ou **setas** |
| Subir / descer | **Espaço** / **Ctrl** |
| Atirar | **Botão esquerdo** ou **J** |
| Míssil teleguiado | **Botão direito**; requer alvo supersônico |
| Bomba | **B** |
| Turbo / salto | **Shift** / **F** |
| Alternar visão | **V** |
| Pausar / abrir configurações | **P** ou **Esc** |
| Reiniciar | **R**; durante a missão, pressione novamente para confirmar |

### Joypad Xbox (layout padrão)

| Ação | Controle |
| --- | --- |
| Mirar / mover | Analógico **esquerdo** / **direito** |
| Avançar / turbo | **RT** / **LT** |
| Atirar | **A** ou **RB** |
| Míssil / bomba | **R3** / **B** |
| Descer / alternar visão | **X** / **Y** |
| Salto | **LB** |
| Pausar / solicitar reinício | **Menu** / **View** |

No celular, há direcionais virtuais, área de mira e botões de tiro, míssil, bomba, turbo, subida, descida, salto e visão. A disponibilidade e o mapeamento do joypad podem variar conforme o navegador e o controle.

## Áudio e gráficos

Os efeitos de combate usam arquivos locais em `audio/` e Web Audio. A trilha padrão usa o player oficial do YouTube e depende da conexão e das permissões do navegador. Você também pode selecionar músicas do próprio dispositivo no painel; esses arquivos são usados na sessão do navegador.

Há três níveis de qualidade: **Econômica**, **Automática** e **Alta**. A opção Automática mede a taxa de quadros e reduz os efeitos quando o desempenho cai. O jogo principal usa Three.js e WebGL 2 com shaders e pós-processamento; `nebula3-webgpu.html` é um laboratório separado de WebGPU com fallback para WebGL 2.

## Desenvolvimento local

Requisitos: Node.js **20.19+** na série 20 ou **22.12+** nas séries posteriores, e npm.

```sh
npm ci
npm run dev
```

Abra `http://localhost:5173/web/nebula3.html` no navegador. O servidor de desenvolvimento acompanha alterações em `web/` e `src/`.

```sh
npm run check  # verificação estática dos módulos TypeScript
npm run build  # check + Vite + cópia da publicação para a raiz
```

Edite `web/nebula3.html` e os módulos em `src/nebula3/`. O build gera `nebula3.html`, `nebula3-webgpu.html` e os arquivos versionados em `assets/`; inclua esses arquivos gerados ao publicar. A base relativa dos assets permite hospedar a página tanto na raiz quanto em um subdiretório, como `/javashow/` no GitHub Pages. Não edite o HTML gerado manualmente.

| Local | Conteúdo |
| --- | --- |
| `web/` | Páginas de entrada e interface |
| `src/nebula3/game.js` | Ciclo principal e sistemas da partida |
| `src/nebula3/*.ts` | Configuração, áudio, colisões, naves, mísseis, partículas e efeitos extraídos gradualmente |
| `models/*.glb` | Modelos 3D das naves; há modelos de reserva caso o carregamento falhe |
| `audio/` | Efeitos sonoros locais |
| `scripts/publish-nebula3.mjs` | Copia o resultado do Vite para os arquivos de publicação na raiz |

Para recriar os modelos da nave do jogador e da nave-chefã, execute `python scripts/generate-nebula-model.py`. Para recriar o casco detalhado da nave-mãe, execute `python scripts/generate-mothership-model.py`. O casco é carregado apenas na primeira aparição da nave-mãe, em qualidade Automática ou Alta; a geometria anterior permanece como reserva e no modo Econômica. Suas torretas, áreas de colisão e partes animadas continuam sob controle do jogo.

A migração para TypeScript é incremental: `npm run check` verifica os módulos TypeScript, enquanto a lógica central ainda está em JavaScript.
