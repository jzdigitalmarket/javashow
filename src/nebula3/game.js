    import * as THREE from "three";
    import { TOUCH_DEVICE, CONFIG } from "./config.ts";
    import { CombatAudio } from "./combatAudio.ts";
    import { upgradeShipVisuals, upgradeBossVisual } from "./shipModel.ts";
    import { createCapitalShip } from "./capitalShip.ts";
    import { segmentDistanceSquared } from "./collision.ts";
    import { moveAgainstSolids } from "./solidCollision.ts";
    import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
    import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
    import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
    import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
    import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

    // ============================================================
    // CONFIGURAÇÃO
    // ============================================================

    const $ = id => document.getElementById(id);
    const rand = (a, b) => a + Math.random() * (b - a);
    const clamp = THREE.MathUtils.clamp;
    const V3 = THREE.Vector3;
    const BULLET_AXIS = new V3(0, 0, 1);
    const UP_AXIS = new V3(0, 1, 0);
    const STORAGE_KEY = "nebula3.preferences.v1";
    let preferences = {};
    try { preferences = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {}; } catch {}
    const settings = {
      effects: $("effectsEnabled"), sensitivity: $("sensitivity"),
      difficulty: $("difficulty"), quality: $("quality"), best: $("bestScore"),
      volume: $("effectsVolume"), preview: $("previewEffects")
    };
    const allowed = (value, values, fallback) => values.includes(value) ? value : fallback;
    settings.difficulty.value = allowed(preferences.difficulty, ["easy", "normal", "hard"], "normal");
    settings.quality.value = allowed(preferences.quality, ["low", "auto", "high"], "auto");
    settings.sensitivity.value = clamp(Number(preferences.sensitivity) || 100, 40, 200);
    settings.effects.checked = preferences.effects !== false;
    settings.volume.value = Number.isFinite(preferences.effectsVolume)
      ? clamp(preferences.effectsVolume, 0, 100) : 60;
    $("effectsVolumeValue").textContent = `${settings.volume.value}%`;
    const bestScore = Number.isFinite(preferences.bestScore) ? Math.max(0, preferences.bestScore) : 0;
    let record = bestScore;
    settings.best.textContent = `RECORDE // ${String(record).padStart(6, "0")} PTS`;
    $("sensitivityValue").textContent = `${settings.sensitivity.value}%`;
    function savePreferences() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          difficulty: settings.difficulty.value, quality: settings.quality.value,
          sensitivity: Number(settings.sensitivity.value), effects: settings.effects.checked,
          effectsVolume: Number(settings.volume.value),
          touch: $("touchEnabled").checked, music: $("musicEnabled").checked,
          track: $("musicSelect").value.startsWith("blob:") ? "" : $("musicSelect").value,
          bestScore: record
        }));
      } catch { /* Armazenamento indisponível: a partida continua. */ }
    }
    for (const input of [settings.difficulty, settings.quality, settings.sensitivity, settings.effects, settings.volume]) {
      input.addEventListener("change", savePreferences);
    }
    settings.sensitivity.addEventListener("input", () => {
      $("sensitivityValue").textContent = `${settings.sensitivity.value}%`;
    });
    settings.volume.addEventListener("input", () => {
      $("effectsVolumeValue").textContent = `${settings.volume.value}%`;
      combatAudio.setVolume();
    });
    let missionDifficulty = settings.difficulty.value;
    const difficultyScale = () => ({ easy: .7, normal: 1, hard: 1.4 })[missionDifficulty];
    const aimSensitivity = () => Number(settings.sensitivity.value) / 100;

    const combatAudio = new CombatAudio(settings, () => camera);
    function wakeAudio() { combatAudio.wake(); }
    function sound(kind, position = null) { combatAudio.play(kind, position); }

    const ui = {
      overlay: $("overlay"), title: $("title"), description: $("description"),
      start: $("start"), status: $("status"), message: $("message"),
      eventFeed: $("eventFeed"),
      civTitle: $("civTitle"), civPopulation: $("civPopulation"),
      civGovernment: $("civGovernment"), civEconomy: $("civEconomy"),
      civTrade: $("civTrade"), civCulture: $("civCulture"),
      civTechnology: $("civTechnology"), civStability: $("civStability"),
      score: $("score"), speed: $("speed"), sector: $("sector"),
      shield: $("shieldBar"), heat: $("heatBar"), warp: $("warpBar"),
      fuel: $("fuelBar"), bomb: $("bombBar"),
      shieldValue: $("shieldValue"), heatValue: $("heatValue"),
      warpValue: $("warpValue"), fuelValue: $("fuelValue"), bombValue: $("bombValue"),
      reticle: $("reticle"), target: $("target")
    };

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance"
    });

    renderer.domElement.id = "world";
    renderer.setPixelRatio(CONFIG.pixelRatio);
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    document.body.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      72, innerWidth / innerHeight, 0.1, 16000
    );
    scene.add(camera);

    scene.add(new THREE.HemisphereLight(0x6aabff, 0x090617, 1.6));

    const sun = new THREE.DirectionalLight(0xc0e9ff, 3.1);
    sun.position.set(400, 300, 500);
    scene.add(sun);

    const violetLight = new THREE.DirectionalLight(0xb448ff, 1.7);
    violetLight.position.set(-300, -80, -300);
    scene.add(violetLight);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    const bloom = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight), 1.05, 0.55, 1.0
    );
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

    // ============================================================
    // MATERIAIS E GEOMETRIAS COMPARTILHADOS
    // ============================================================

    const metal = new THREE.MeshStandardMaterial({
      color: 0x263344, roughness: .42, metalness: .82
    });

    const darkMetal = new THREE.MeshStandardMaterial({
      color: 0x080f1b, roughness: .55, metalness: .75
    });

    const armor = new THREE.MeshStandardMaterial({
      color: 0x70879c, roughness: .38, metalness: .72
    });

    // Material sem emissão para os canhões: mantém a leitura da peça sem halo.
    const weaponAccent = new THREE.MeshStandardMaterial({
      color: 0x35a9ba, roughness: .48, metalness: .62
    });

    // Disparos abaixo do limiar do bloom, sem multiplicação de intensidade.
    const playerShotMaterial = new THREE.MeshBasicMaterial({
      color: 0x8de8ef, toneMapped: false
    });

    const allyShotMaterial = new THREE.MeshBasicMaterial({
      color: 0x63f0a8, toneMapped: false
    });

    const glow = hex => new THREE.MeshBasicMaterial({
      color: new THREE.Color(hex).multiplyScalar(3.5)
    });

    const cyan = glow(0x24dfff);
    const pink = glow(0xff245d);
    const purple = glow(0x903cff);

    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const ballGeo = new THREE.IcosahedronGeometry(1, 2);
    const ringGeo = new THREE.TorusGeometry(1, .035, 8, 96);

    function mesh(geo, mat, parent, position = [0, 0, 0], scale = [1, 1, 1]) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...position);
      m.scale.set(...scale);
      parent.add(m);
      return m;
    }

    // ============================================================
    // NEBULOSA PROCEDURAL
    // ============================================================

    const noiseGLSL = `
      float hash(vec3 p) {
        p = fract(p * .3183099 + vec3(.1, .2, .3));
        p *= 17.;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float noise3(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3. - 2. * f);

        return mix(
          mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
              mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
              mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
          f.z
        );
      }

      float fbm(vec3 p) {
        float value = 0., amplitude = .5;
        for (int i = 0; i < 5; i++) {
          value += noise3(p) * amplitude;
          p = p * 2.03 + 7.1;
          amplitude *= .5;
        }
        return value;
      }
    `;

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(7500, 32, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { time: { value: 0 } },
        vertexShader: `
          varying vec3 vDirection;
          void main() {
            vDirection = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
          }
        `,
        fragmentShader: `
          uniform float time;
          varying vec3 vDirection;
          ${noiseGLSL}

          void main() {
            vec3 d = normalize(vDirection);
            float n = fbm(d * 4. + vec3(time * .003, 0., 0.));
            float detail = fbm(d * 11. + n * 3.);

            float band = pow(max(0., 1. - abs(d.y + d.x * .28)), 5.);
            float cloud = smoothstep(.30, .77, n) * band;

            vec3 color = vec3(.002, .004, .014);
            color += mix(vec3(.025, .08, .22), vec3(.27, .025, .35), detail)
                   * cloud * 1.35;
            color += vec3(.01, .11, .15) * pow(detail, 4.) * band;

            gl_FragColor = vec4(color, 1.);
          }
        `
      })
    );
    scene.add(sky);

    // ============================================================
    // ESTRELAS
    // ============================================================

    const starPositions = new Float32Array(CONFIG.stars * 3);
    const starColors = new Float32Array(CONFIG.stars * 3);

    for (let i = 0; i < CONFIG.stars; i++) {
      const direction = new V3().randomDirection().multiplyScalar(rand(4200, 6500));
      direction.toArray(starPositions, i * 3);

      const color = new THREE.Color().setHSL(rand(.48, .7), .45, rand(.6, 1));
      color.multiplyScalar(rand(.7, 2.8)).toArray(starColors, i * 3);
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    starGeo.setAttribute("color", new THREE.BufferAttribute(starColors, 3));

    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      size: 6,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: .9,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    scene.add(stars);

    // ============================================================
    // PLANETA E ATMOSFERA
    // ============================================================

    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(570, 96, 64),
      new THREE.ShaderMaterial({
        uniforms: {
          civilizationLevel: { value: .16 }
        },
        vertexShader: `
          varying vec3 vNormal, vWorld, vLocal;
          void main() {
            vNormal = normalize(mat3(modelMatrix) * normal);
            vLocal = normalize(position);
            vWorld = (modelMatrix * vec4(position, 1.)).xyz;
            gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
          }
        `,
        fragmentShader: `
          uniform float civilizationLevel;
          varying vec3 vNormal, vWorld, vLocal;
          ${noiseGLSL}

          void main() {
            vec3 n = normalize(vNormal);
            vec3 view = normalize(cameraPosition - vWorld);

            float land = fbm(vLocal * 7.);
            float continents = smoothstep(.46, .55, land);
            float light = max(dot(n, normalize(vec3(.8, .4, .7))), 0.);

            vec3 ocean = vec3(.006, .045, .095);
            vec3 ground = mix(vec3(.025, .12, .13), vec3(.13, .17, .12), land);
            vec3 color = mix(ocean, ground, continents) * (.06 + light * 1.3);

            float clouds = smoothstep(.57, .74, fbm(vLocal * 13. + 15.));
            color = mix(color, vec3(.62, .8, .9) * (.1 + light), clouds * .25);

            float cityThreshold = mix(.72, .57, civilizationLevel);
            float cities = pow(max(0., noise3(vLocal * 210.) - cityThreshold) * 3., 3.5);
            color += vec3(.1, .85, 1.4) * cities * continents * (1. - light)
                   * mix(.55, 1.8, civilizationLevel);

            float rim = pow(1. - max(dot(n, view), 0.), 3.);
            color += vec3(.02, .19, .36) * rim;

            gl_FragColor = vec4(color, 1.);
          }
        `
      })
    );

    planet.position.set(-1050, 270, -2300);
    scene.add(planet);

    // Nuvens orbitam de forma independente da superfície e recortam o terminador.
    const cloudShell = new THREE.Mesh(
      new THREE.SphereGeometry(577, 64, 48),
      new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 } },
        transparent: true,
        depthWrite: false,
        vertexShader: `
          varying vec3 vNormal, vLocal;
          void main() {
            vNormal = normalize(mat3(modelMatrix) * normal);
            vLocal = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
          }
        `,
        fragmentShader: `
          uniform float time;
          varying vec3 vNormal, vLocal;
          ${noiseGLSL}
          void main() {
            vec3 p = vLocal * 13. + vec3(time * .025, 15., 0.);
            float cover = fbm(p) * .75 + fbm(p * 2.1) * .25;
            float alpha = smoothstep(.52, .66, cover) * .78;
            float light = max(dot(normalize(vNormal), normalize(vec3(.8, .4, .7))), 0.);
            vec3 color = mix(vec3(.08, .16, .24), vec3(.77, .88, .95), light);
            gl_FragColor = vec4(color, alpha * (.28 + .72 * light));
          }
        `
      })
    );
    cloudShell.rotation.y = .25;
    planet.add(cloudShell);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(593, 64, 48),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        vertexShader: `
          varying vec3 vNormal, vWorld;
          void main() {
            vNormal = normalize(mat3(modelMatrix) * normal);
            vWorld = (modelMatrix * vec4(position, 1.)).xyz;
            gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
          }
        `,
        fragmentShader: `
          varying vec3 vNormal, vWorld;
          void main() {
            vec3 view = normalize(cameraPosition - vWorld);
            float rim = pow(1. - abs(dot(normalize(vNormal), view)), 3.);
            gl_FragColor = vec4(.08, .48, 1., rim * .65);
          }
        `
      })
    );
    atmosphere.position.copy(planet.position);
    scene.add(atmosphere);

    // ============================================================
    // CIVILIZAÇÃO PLANETÁRIA: COMÉRCIO, POLÍTICA E CULTURA
    // ============================================================

    const civilizationOrbit = new THREE.Group();
    planet.add(civilizationOrbit);

    const tradeRingA = mesh(ringGeo, cyan, civilizationOrbit, [0, 0, 0], [630, 630, 630]);
    tradeRingA.rotation.x = Math.PI / 2.45;
    const tradeRingB = mesh(ringGeo, purple, civilizationOrbit, [0, 0, 0], [675, 675, 675]);
    tradeRingB.rotation.set(Math.PI / 2.9, .55, .2);

    const tradeShips = [];
    for (let i = 0; i < 12; i++) {
      const ship = new THREE.Group();
      mesh(boxGeo, metal, ship, [0, 0, 0], [5, 2, 13]);
      mesh(boxGeo, cyan, ship, [0, 1.7, -1], [2.2, .35, 7]);
      mesh(ballGeo, purple, ship, [0, 0, 8], [1.2, 1.2, 2]);
      ship.visible = false;
      civilizationOrbit.add(ship);
      tradeShips.push({ ship, phase: i / 12 * Math.PI * 2, radius: 625 + (i % 3) * 28 });
    }

    const civilization = {
      name: "AURORA",
      era: "COLÔNIA EMERGENTE",
      population: 1.2,
      economy: 18,
      trade: 8,
      culture: 16,
      technology: 12,
      stability: 72,
      government: "CONSELHO PLANETÁRIO",
      eventTimer: 10
    };

    const civilizationEvents = [
      {
        text: "AURORA // NOVO ACORDO COMERCIAL INTERCONTINENTAL",
        apply: civ => { civ.trade += 6; civ.economy += 4; }
      },
      {
        text: "AURORA // ELEIÇÕES FORMAM UMA ASSEMBLEIA FEDERADA",
        apply: civ => { civ.government = "ASSEMBLEIA FEDERADA"; civ.stability += 5; }
      },
      {
        text: "AURORA // FESTIVAL DAS TRÊS LUAS EXPANDE A CULTURA",
        apply: civ => { civ.culture += 7; civ.stability += 2; }
      },
      {
        text: "AURORA // UNIVERSIDADES INAUGURAM REDE DE PESQUISA",
        apply: civ => { civ.technology += 6; civ.culture += 2; }
      },
      {
        text: "AURORA // CRISE DIPLOMÁTICA REDUZ A ESTABILIDADE",
        apply: civ => { civ.stability -= 8; civ.trade -= 3; }
      },
      {
        text: "AURORA // NOVAS CIDADES COSTEIRAS ENTRAM EM OPERAÇÃO",
        apply: civ => { civ.population += .08; civ.economy += 3; }
      },
      {
        text: "AURORA // MOVIMENTO CÍVICO APROVA REFORMA POLÍTICA",
        apply: civ => { civ.government = "DEMOCRACIA CÍVICA"; civ.stability += 4; civ.culture += 3; }
      },
      {
        text: "AURORA // PRIMEIRA ROTA MERCANTE ORBITAL INAUGURADA",
        apply: civ => { civ.trade += 8; civ.technology += 3; civ.economy += 4; }
      }
    ];

    function affectCivilization(changes, message) {
      for (const [key, amount] of Object.entries(changes)) {
        civilization[key] = clamp(civilization[key] + amount, 0, 100);
      }
      if (message) queueEvent(message, changes.stability < 0 ? "alert" : "ally");
    }

    function resetCivilization() {
      Object.assign(civilization, {
        era: "COLÔNIA EMERGENTE",
        population: 1.2,
        economy: 18,
        trade: 8,
        culture: 16,
        technology: 12,
        stability: 72,
        government: "CONSELHO PLANETÁRIO",
        eventTimer: 10
      });
      planet.material.uniforms.civilizationLevel.value = .16;
    }

    function updateCivilization(dt) {
      const stabilityFactor = clamp(civilization.stability / 70, .35, 1.4);
      civilization.population += civilization.population * .00018 * stabilityFactor * dt;
      civilization.economy += .009 * stabilityFactor * dt;
      civilization.trade += .007 * (civilization.economy / 35) * dt;
      civilization.culture += .006 * stabilityFactor * dt;
      civilization.technology += .005 * (civilization.culture / 30) * dt;
      civilization.stability += (68 - civilization.stability) * .003 * dt;
      const activeDrones = drones.reduce((count, drone) => count + Number(drone.group.visible), 0);
      if (mothership.visible || activeDrones >= 7) {
        civilization.stability -= (mothership.visible ? .16 : .05) * dt;
        civilization.trade -= (mothership.visible ? .08 : .02) * dt;
      }

      civilization.eventTimer -= dt;
      if (civilization.eventTimer <= 0 && eventTimer <= .2) {
        const event = civilizationEvents[Math.floor(Math.random() * civilizationEvents.length)];
        event.apply(civilization);
        queueEvent(event.text, civilization.stability < 45 ? "alert" : "ally");
        civilization.eventTimer = rand(12, 21);
      }

      for (const key of ["economy", "trade", "culture", "technology", "stability"]) {
        civilization[key] = clamp(civilization[key], 0, 100);
      }

      const development = (
        civilization.economy + civilization.trade + civilization.culture +
        civilization.technology + civilization.stability
      ) / 500;

      civilization.era = development > .72 ? "CIVILIZAÇÃO INTERESTELAR" :
        development > .5 ? "ERA PLANETÁRIA" :
        development > .32 ? "MUNDO INDUSTRIAL" : "COLÔNIA EMERGENTE";

      planet.material.uniforms.civilizationLevel.value = clamp(development, .12, 1);

      const visibleShips = clamp(2 + Math.floor((civilization.trade + civilization.technology) / 15), 2, tradeShips.length);
      tradeShips.forEach((entry, i) => {
        entry.ship.visible = i < visibleShips;
        if (!entry.ship.visible) return;
        const angle = time * (.055 + i * .0015) + entry.phase;
        const tilt = .22 + (i % 3) * .18;
        entry.ship.position.set(
          Math.cos(angle) * entry.radius,
          Math.sin(angle * .73) * entry.radius * tilt,
          Math.sin(angle) * entry.radius
        );
        entry.ship.lookAt(planet.position);
      });

      tradeRingA.rotation.z += dt * .018;
      tradeRingB.rotation.y -= dt * .014;
    }

    function updateCivilizationHUD() {
      ui.civTitle.textContent = `PLANETA ${civilization.name} // ${civilization.era}`;
      ui.civPopulation.textContent = `${civilization.population.toFixed(2).replace(".", ",")} BI`;
      ui.civGovernment.textContent = civilization.government;
      ui.civEconomy.textContent = Math.round(civilization.economy);
      ui.civTrade.textContent = Math.round(civilization.trade);
      ui.civCulture.textContent = Math.round(civilization.culture);
      ui.civTechnology.textContent = Math.round(civilization.technology);
      ui.civStability.textContent = `${Math.round(civilization.stability)}%`;
    }

    // ============================================================
    // ESTAÇÃO ORBITAL
    // ============================================================

    const station = new THREE.Group();
    station.position.set(0, 15, -540);
    station.rotation.set(.16, -.25, .1);
    scene.add(station);

    const stationRings = [];

    // Docas e balizas identificam a estação mesmo à distância.
    const stationDetails = new THREE.Group();
    station.add(stationDetails);
    const dockingMaterial = new THREE.MeshStandardMaterial({
      color: 0x426579, metalness: .75, roughness: .35
    });
    const beaconMaterial = new THREE.MeshBasicMaterial({ color: 0xffa052 });
    const dockingGeo = new THREE.CylinderGeometry(5, 8, 3, 8);
    const beaconGeo = new THREE.SphereGeometry(1.7, 8, 6);
    const dockInstances = new THREE.InstancedMesh(dockingGeo, dockingMaterial, 12);
    const beaconInstances = new THREE.InstancedMesh(beaconGeo, beaconMaterial, 12);
    const dockTransform = new THREE.Object3D();
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      const radius = 105;
      dockTransform.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      dockTransform.rotation.set(0, 0, angle - Math.PI / 2);
      dockTransform.updateMatrix();
      dockInstances.setMatrixAt(i, dockTransform.matrix);
      dockTransform.position.set(Math.cos(angle) * (radius + 9), Math.sin(angle) * (radius + 9), 0);
      dockTransform.rotation.set(0, 0, 0);
      dockTransform.updateMatrix();
      beaconInstances.setMatrixAt(i, dockTransform.matrix);
    }
    dockInstances.instanceMatrix.needsUpdate = true;
    beaconInstances.instanceMatrix.needsUpdate = true;
    stationDetails.add(dockInstances, beaconInstances);

    for (let i = 0; i < 3; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.set(i * .52, i * .35, 0);
      station.add(pivot);
      stationRings.push(pivot);

      const radius = 65 + i * 19;

      mesh(ringGeo, metal, pivot, [0, 0, 0], [radius, radius, radius]);

      const line = mesh(ringGeo, i === 1 ? purple : cyan, pivot);
      line.scale.set(radius * 1.015, radius * 1.015, radius * .18);

      for (let j = 0; j < 12; j++) {
        const angle = j / 12 * Math.PI * 2;
        const module = mesh(
          boxGeo, darkMetal, pivot,
          [Math.cos(angle) * radius, Math.sin(angle) * radius, 0],
          [10, 5, 8]
        );
        module.rotation.z = angle;

        const strip = mesh(boxGeo, cyan, module, [0, .56, 0], [.7, .08, .7]);
      }
    }

    mesh(ballGeo, darkMetal, station, [0, 0, 0], [17, 17, 17]);
    mesh(ballGeo, cyan, station, [0, 0, 0], [10, 10, 10]);

    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      arm.rotation.z = i * Math.PI / 2;
      station.add(arm);

      mesh(boxGeo, metal, arm, [35, 0, 0], [58, 3, 4]);

      for (let j = 0; j < 4; j++) {
        mesh(boxGeo, armor, arm, [25 + j * 8, 10, 0], [6, 16, .7]);
        mesh(boxGeo, purple, arm, [25 + j * 8, 10, .5], [.25, 14, .15]);
      }
    }

    // Ondas luminosas curtas tornam os impactos grandes legíveis em movimento.
    const impactGeo = new THREE.RingGeometry(.84, 1, 48);
    const impacts = [];
    function clearImpact(impact) {
      scene.remove(impact.ring);
      impact.ring.material.dispose();
      if (impact.light) scene.remove(impact.light);
    }
    function spawnImpact(position, radius, color) {
      if (impacts.length >= 8) clearImpact(impacts.shift());
      const material = new THREE.MeshBasicMaterial({
        color, side: THREE.DoubleSide, transparent: true, opacity: .8,
        depthWrite: false, blending: THREE.AdditiveBlending
      });
      const ring = new THREE.Mesh(impactGeo, material);
      ring.position.copy(position);
      ring.scale.setScalar(2);
      scene.add(ring);
      const light = settings.quality.value === "high"
        ? new THREE.PointLight(color, 7, Math.min(radius * 2, 450), 2) : null;
      if (light) { light.position.copy(position); scene.add(light); }
      impacts.push({ ring, light, radius, life: 0, duration: .85 });
    }
    function updateImpacts(dt) {
      for (let i = impacts.length - 1; i >= 0; i--) {
        const impact = impacts[i];
        impact.life += dt;
        const progress = Math.min(impact.life / impact.duration, 1);
        impact.ring.scale.setScalar(2 + impact.radius * progress);
        impact.ring.quaternion.copy(camera.quaternion);
        impact.ring.material.opacity = .8 * (1 - progress) ** 2;
        if (impact.light) impact.light.intensity = 7 * (1 - progress) ** 2;
        if (progress === 1) { clearImpact(impact); impacts.splice(i, 1); }
      }
    }

    // ============================================================
    // UNIVERSO PROCEDURAL INFINITO + ASTEROIDES DESTRUTÍVEIS
    // ============================================================

    const rockGeo = new THREE.IcosahedronGeometry(1, 1);
    const rockPosition = rockGeo.attributes.position;

    for (let i = 0; i < rockPosition.count; i++) {
      const x = rockPosition.getX(i);
      const y = rockPosition.getY(i);
      const z = rockPosition.getZ(i);
      const deformation = 1 + .16 * Math.sin(x * 9 + y * 13 + z * 7);
      rockPosition.setXYZ(i, x * deformation, y * deformation, z * deformation);
    }
    rockGeo.computeVertexNormals();

    const rockMaterial = new THREE.MeshStandardMaterial({
      color: 0x424556,
      roughness: .95,
      metalness: .15,
      flatShading: true
    });

    const celestialGeo = new THREE.SphereGeometry(1, 28, 20);
    const sunColors = [0xffc96b, 0xff8b5c, 0xbfd9ff];
    const sunMaterials = sunColors.map(color =>
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2) })
    );
    const sunCoronaMaterials = sunColors.map(color =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(1.5),
        transparent: true, opacity: .10, side: THREE.BackSide,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    const planetMaterials = [0x4a7e8d, 0x79638e, 0x756d4d, 0x3c6f55].map(color =>
      new THREE.MeshStandardMaterial({ color, roughness: .88, metalness: .04 })
    );
    const planetRingGeo = new THREE.TorusGeometry(1, .05, 6, 48);
    const planetRingMaterial = new THREE.MeshStandardMaterial({
      color: 0x9c8f7a, roughness: .9, metalness: 0
    });

    const worldAsteroids = [];
    const refuelStations = [];
    const celestialBodies = [];
    const loadedSectors = new Map();
    const destroyedWorldObjects = new Set();
    const galacticOrigin = new V3();
    const galacticCamera = new V3();
    let currentSectorKey = "";
    let currentSector = { x: 0, y: 0, z: 0 };
    let refuelActive = false;
    let bombRefillTimer = 0;

    // A estação original continua sendo um porto de abastecimento no sistema inicial.
    const starterStation = {
      group: station,
      radius: 104,
      starter: true,
      sectorKey: null,
      id: "S:START",
      maxHp: 90,
      hp: 90,
      destroyed: false,
      lastWarning: 100
    };
    refuelStations.push(starterStation);

    function hash32(x, y, z, salt = 0) {
      let h = (x * 374761393 + y * 668265263 + z * 2147483647 + salt * 1274126177) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return (h ^ (h >>> 16)) >>> 0;
    }

    function seededRandom(seed) {
      let state = seed >>> 0;
      return () => {
        state += 0x6D2B79F5;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function sectorId(x, y, z) {
      return `${x}:${y}:${z}`;
    }

    function localFromGalactic(position) {
      return position.clone().sub(galacticOrigin);
    }

    function createRefuelStation(position, sectorKey, index = 0) {
      const id = `S:${sectorKey}:${index}`;
      if (destroyedWorldObjects.has(id)) return null;

      const group = new THREE.Group();
      group.position.copy(position);

      mesh(ballGeo, darkMetal, group, [0, 0, 0], [8, 8, 8]);
      mesh(ballGeo, cyan, group, [0, 0, 0], [3.8, 3.8, 3.8]);

      for (let i = 0; i < 2; i++) {
        const r = mesh(ringGeo, i ? purple : cyan, group);
        const radius = 18 + i * 7;
        r.scale.set(radius, radius, radius);
        r.rotation.x = i * 1.2;
      }

      for (let i = 0; i < 4; i++) {
        const arm = new THREE.Group();
        arm.rotation.z = i * Math.PI / 2;
        group.add(arm);
        mesh(boxGeo, metal, arm, [17, 0, 0], [25, 2.2, 2.2]);
        mesh(boxGeo, cyan, arm, [29, 0, 0], [2, 5, 5]);
      }

      scene.add(group);
      const entry = {
        group,
        radius: 32,
        sectorKey,
        starter: false,
        index,
        id,
        maxHp: 70,
        hp: 70,
        destroyed: false,
        lastWarning: 100
      };
      refuelStations.push(entry);
      return entry;
    }

    function createCelestial(type, position, radius, sectorKey, seed) {
      const group = new THREE.Group();
      group.position.copy(position);
      const random = seededRandom(seed);

      if (type === "sun") {
        const sunIndex = Math.floor(random() * sunMaterials.length);
        const body = new THREE.Mesh(celestialGeo, sunMaterials[sunIndex]);
        body.scale.setScalar(radius);
        group.add(body);

        const corona = new THREE.Mesh(celestialGeo, sunCoronaMaterials[sunIndex]);
        corona.scale.setScalar(radius * 1.12);
        group.add(corona);
      } else {
        const body = new THREE.Mesh(
          celestialGeo,
          planetMaterials[Math.floor(random() * planetMaterials.length)]
        );
        body.scale.set(radius, radius * (0.92 + random() * .12), radius);
        group.add(body);

        if (random() < .32) {
          const ring = new THREE.Mesh(planetRingGeo, planetRingMaterial);
          ring.scale.setScalar(radius * 1.45);
          ring.rotation.x = Math.PI / 2.6;
          group.add(ring);
        }
      }

      scene.add(group);
      const entry = { group, type, radius, sectorKey, spin: (random() - .5) * .08 };
      celestialBodies.push(entry);
      return entry;
    }

    function createWorldAsteroid(position, radius, sectorKey, id, random) {
      if (destroyedWorldObjects.has(id)) return null;

      const asteroid = new THREE.Mesh(rockGeo, rockMaterial);
      asteroid.position.copy(position);
      asteroid.scale.set(
        radius,
        radius * (.65 + random() * .7),
        radius * (.7 + random() * .6)
      );
      asteroid.rotation.set(random() * 6, random() * 6, random() * 6);
      scene.add(asteroid);

      const entry = {
        mesh: asteroid,
        radius: radius * .9,
        hp: Math.max(1, Math.ceil(radius / 5)),
        sectorKey,
        id,
        spin: new V3((random() - .5) * .3, (random() - .5) * .3, (random() - .5) * .3)
      };
      worldAsteroids.push(entry);
      return entry;
    }

    function generateSector(sx, sy, sz) {
      const key = sectorId(sx, sy, sz);
      if (loadedSectors.has(key)) return;

      const random = seededRandom(hash32(sx, sy, sz, 77));
      const record = { asteroids: [], stations: [], celestial: [] };
      const size = CONFIG.sectorSize;

      const sectorBase = new V3(sx * size, sy * size, sz * size);
      const randomGalacticPosition = (margin = 100) => new V3(
        sectorBase.x + margin + random() * (size - margin * 2),
        sectorBase.y + margin + random() * (size - margin * 2),
        sectorBase.z + margin + random() * (size - margin * 2)
      );

      // Poucos asteroides por setor: colisão e destruição passam a ser individuais.
      const asteroidCount = Math.floor(random() * (CONFIG.asteroidsPerSector + 1));
      for (let i = 0; i < asteroidCount; i++) {
        const id = `A:${key}:${i}`;
        const galacticPos = randomGalacticPosition(120);
        const radius = 4 + random() * 10;
        const asteroid = createWorldAsteroid(
          localFromGalactic(galacticPos), radius, key, id, random
        );
        if (asteroid) record.asteroids.push(asteroid);
      }

      // Estações são raras, mas frequentes o bastante para sustentar viagens longas.
      if (random() < .20) {
        const stationEntry = createRefuelStation(
          localFromGalactic(randomGalacticPosition(220)), key, 0
        );
        if (stationEntry) record.stations.push(stationEntry);
      }

      // Corpos celestes de baixa geometria; grandes o bastante para serem marcos visuais.
      const celestialRoll = random();
      if (celestialRoll < .09) {
        record.celestial.push(createCelestial(
          "sun",
          localFromGalactic(randomGalacticPosition(320)),
          90 + random() * 85,
          key,
          hash32(sx, sy, sz, 11)
        ));
      } else if (celestialRoll < .32) {
        record.celestial.push(createCelestial(
          "planet",
          localFromGalactic(randomGalacticPosition(260)),
          65 + random() * 95,
          key,
          hash32(sx, sy, sz, 19)
        ));
      }

      loadedSectors.set(key, record);
    }

    function removeArrayEntry(array, entry) {
      const index = array.indexOf(entry);
      if (index >= 0) array.splice(index, 1);
    }

    function unloadSector(key) {
      const record = loadedSectors.get(key);
      if (!record) return;

      for (const asteroid of record.asteroids) {
        scene.remove(asteroid.mesh);
        removeArrayEntry(worldAsteroids, asteroid);
      }
      for (const stationEntry of record.stations) {
        scene.remove(stationEntry.group);
        removeArrayEntry(refuelStations, stationEntry);
      }
      for (const body of record.celestial) {
        scene.remove(body.group);
        removeArrayEntry(celestialBodies, body);
      }

      loadedSectors.delete(key);
    }

    function refreshSectors(force = false) {
      galacticCamera.copy(camera.position).add(galacticOrigin);
      const sx = Math.floor(galacticCamera.x / CONFIG.sectorSize);
      const sy = Math.floor(galacticCamera.y / CONFIG.sectorSize);
      const sz = Math.floor(galacticCamera.z / CONFIG.sectorSize);
      const key = sectorId(sx, sy, sz);

      if (!force && key === currentSectorKey) return;
      currentSectorKey = key;
      currentSector = { x: sx, y: sy, z: sz };

      const needed = new Set();
      for (let x = sx - CONFIG.sectorRadiusXZ; x <= sx + CONFIG.sectorRadiusXZ; x++) {
        for (let z = sz - CONFIG.sectorRadiusXZ; z <= sz + CONFIG.sectorRadiusXZ; z++) {
          const sectorKey = sectorId(x, sy, z);
          needed.add(sectorKey);
          generateSector(x, sy, z);
        }
      }

      for (const loadedKey of Array.from(loadedSectors.keys())) {
        if (!needed.has(loadedKey)) unloadSector(loadedKey);
      }
    }

    function destroyAsteroid(asteroid, award = true) {
      destroyedWorldObjects.add(asteroid.id);
      sound("blast", asteroid.mesh.position);
      burst(asteroid.mesh.position, 0xffa45c, 55, 34);
      burst(asteroid.mesh.position, 0x7d8ca8, 35, 18);
      scene.remove(asteroid.mesh);
      removeArrayEntry(worldAsteroids, asteroid);

      const record = loadedSectors.get(asteroid.sectorKey);
      if (record) removeArrayEntry(record.asteroids, asteroid);
      if (award) score += 35;
    }

    function rebaseWorldIfNeeded() {
      if (camera.position.lengthSq() < 4200 * 4200) return;

      const shift = camera.position.clone();
      galacticOrigin.add(shift);
      camera.position.sub(shift);

      planet.position.sub(shift);
      atmosphere.position.sub(shift);
      station.position.sub(shift);

      for (const drone of drones) drone.group.position.sub(shift);
      for (const ally of allies) ally.group.position.sub(shift);
      boss.group.position.sub(shift);
      mothership.group.position.sub(shift);
      for (const bullet of bullets) {
        bullet.mesh.position.sub(shift);
        bullet.previous.sub(shift);
      }
      for (const asteroid of worldAsteroids) asteroid.mesh.position.sub(shift);
      for (const stationEntry of refuelStations) {
        if (!stationEntry.starter) stationEntry.group.position.sub(shift);
      }
      for (const body of celestialBodies) body.group.position.sub(shift);
      for (const bomb of bombs) bomb.mesh.position.sub(shift);
      for (const explosion of stationExplosions) {
        for (const shock of explosion.shocks) shock.mesh.position.sub(shift);
        for (const fragment of explosion.debris) fragment.mesh.position.sub(shift);
      }
      for (const impact of impacts) {
        impact.ring.position.sub(shift);
        if (impact.light) impact.light.position.sub(shift);
      }
      for (const beam of defenseBeams) beam.mesh.position.sub(shift);
      for (const battle of distantBattles) battle.group.position.sub(shift);

      for (let i = 0; i < CONFIG.particles; i++) {
        if (particleLives[i] <= 0) continue;
        const k = i * 3;
        particlePositions[k] -= shift.x;
        particlePositions[k + 1] -= shift.y;
        particlePositions[k + 2] -= shift.z;
      }
      particleGeo.attributes.position.needsUpdate = true;
    }

    // ============================================================
    // COCKPIT
    // ============================================================

    const cockpit = new THREE.Group();
    camera.add(cockpit);

    for (const side of [-1, 1]) {
      const gun = mesh(
        boxGeo, darkMetal, cockpit,
        [side * .95, -.67, -1.6], [.28, .25, 1.35]
      );

      mesh(boxGeo, weaponAccent, gun, [0, .56, -.05], [.45, .07, .7]);

      const support = mesh(
        boxGeo, metal, cockpit,
        [side * 1.55, -.15, -2.2], [.07, 2.4, .1]
      );
      support.rotation.z = -side * .35;

      mesh(boxGeo, weaponAccent, cockpit,
        [side * 1.05, -.91, -1.9], [.5, .018, .05]);
    }

    mesh(boxGeo, darkMetal, cockpit, [0, -1.16, -1.7], [3.2, .35, .65]);

    const cockpitLight = new THREE.PointLight(0x35dcff, 2, 5);
    cockpitLight.position.set(0, -.3, -1);
    camera.add(cockpitLight);

    // ============================================================
    // NAVE EXTERNA / VISÃO EM TERCEIRA PESSOA
    // ============================================================

    const shipExterior = new THREE.Group();
    shipExterior.position.set(0, -1.15, -8.6);
    shipExterior.visible = false;
    camera.add(shipExterior);

    // Fuselagem central
    const shipBody = mesh(boxGeo, armor, shipExterior, [0, 0, 0], [1.05, .42, 2.5]);
    shipBody.rotation.x = -.035;
    mesh(ballGeo, darkMetal, shipExterior, [0, .18, -.15], [.72, .38, 1.15]);
    mesh(boxGeo, cyan, shipExterior, [0, .43, -.2], [.38, .035, 1.18]);

    // Nariz e estabilizadores
    const shipNose = mesh(ballGeo, metal, shipExterior, [0, -.02, -2.42], [.72, .42, 1.1]);
    shipNose.scale.z = 1.35;
    for (const side of [-1, 1]) {
      const wing = mesh(boxGeo, metal, shipExterior, [side * 1.35, -.12, .15], [1.55, .08, 1.2]);
      wing.rotation.z = side * -.13;
      wing.rotation.y = side * .08;
      mesh(boxGeo, cyan, shipExterior, [side * 1.65, -.04, -.15], [.9, .025, .7]);
      mesh(boxGeo, darkMetal, shipExterior, [side * .72, -.14, 1.7], [.32, .3, .62]);
    }

    // Motores traseiros e glow
    for (const side of [-1, 1]) {
      mesh(ballGeo, darkMetal, shipExterior, [side * .58, -.16, 2.05], [.34, .34, .62]);
      const thruster = mesh(ballGeo, cyan, shipExterior, [side * .58, -.16, 2.52], [.18, .18, .28]);
      thruster.userData.baseScale = thruster.scale.clone();
    }

    let thirdPerson = false;
    let viewNoticeTimer = 0;

    function setThirdPerson(enabled) {
      thirdPerson = Boolean(enabled);
      cockpit.visible = !thirdPerson;
      cockpitLight.visible = !thirdPerson;
      shipExterior.visible = thirdPerson;
      viewNoticeTimer = 1.2;
    }

    function toggleView() {
      if (!started) return;
      setThirdPerson(!thirdPerson);
    }

    // ============================================================
    // RASTROS DE HIPERVELOCIDADE
    // ============================================================

    const streakCount = 420;
    const streakData = [];
    const streakPositions = new Float32Array(streakCount * 6);
    const streakGeo = new THREE.BufferGeometry();

    streakGeo.setAttribute(
      "position", new THREE.BufferAttribute(streakPositions, 3)
        .setUsage(THREE.DynamicDrawUsage)
    );

    const streakMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(0x63dfff).multiplyScalar(2),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const streaks = new THREE.LineSegments(streakGeo, streakMaterial);
    streaks.frustumCulled = false;
    camera.add(streaks);

    for (let i = 0; i < streakCount; i++) {
      const a = rand(0, Math.PI * 2), r = rand(8, 90);
      streakData.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, z: rand(-240, -5) });
    }

    // ============================================================
    // PARTÍCULAS: POOL FIXO, SEM CRIAR MESHES EM CADA EXPLOSÃO
    // ============================================================

    const particlePositions = new Float32Array(CONFIG.particles * 3);
    const particleColors = new Float32Array(CONFIG.particles * 3);
    const particleLives = new Float32Array(CONFIG.particles);
    const particleMaxLives = new Float32Array(CONFIG.particles);
    const particleVelocities = new Float32Array(CONFIG.particles * 3);
    const particleBaseColors = new Float32Array(CONFIG.particles * 3);
    let particleCursor = 0;

    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute("position",
      new THREE.BufferAttribute(particlePositions, 3).setUsage(THREE.DynamicDrawUsage));
    particleGeo.setAttribute("color",
      new THREE.BufferAttribute(particleColors, 3).setUsage(THREE.DynamicDrawUsage));
    particleGeo.setAttribute("life",
      new THREE.BufferAttribute(particleLives, 1).setUsage(THREE.DynamicDrawUsage));

    const particleMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { dpr: { value: CONFIG.pixelRatio } },
      vertexShader: `
        attribute vec3 color;
        attribute float life;
        varying vec3 vColor;
        varying float vLife;
        uniform float dpr;

        void main() {
          vColor = color;
          vLife = life;
          vec4 p = modelViewMatrix * vec4(position, 1.);
          gl_PointSize = clamp(190. * dpr / max(1., -p.z), 1., 30.);
          gl_Position = projectionMatrix * p;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vLife;
        void main() {
          if (vLife <= 0.) discard;
          float d = length(gl_PointCoord - .5);
          if (d > .5) discard;
          float alpha = pow(1. - d * 2., 2.);
          gl_FragColor = vec4(vColor, alpha);
        }
      `
    });

    const particles = new THREE.Points(particleGeo, particleMaterial);
    particles.frustumCulled = false;
    scene.add(particles);
    let visibleParticleCount = CONFIG.particles;

    function burst(position, hex, count = 70, force = 30) {
      const color = new THREE.Color(hex).multiplyScalar(4);
      const direction = new V3();

      for (let i = 0; i < count; i++) {
        const index = particleCursor++ % visibleParticleCount;
        const k = index * 3;

        position.toArray(particlePositions, k);
        direction.randomDirection().multiplyScalar(rand(force * .15, force));
        direction.toArray(particleVelocities, k);
        color.toArray(particleBaseColors, k);
        color.toArray(particleColors, k);

        particleLives[index] = particleMaxLives[index] = rand(.3, 1.3);
      }
    }

    function updateParticles(dt) {
      const damping = Math.exp(-1.7 * dt);

      for (let i = 0; i < CONFIG.particles; i++) {
        if (particleLives[i] <= 0) continue;

        particleLives[i] = Math.max(0, particleLives[i] - dt);
        const k = i * 3;
        const fade = particleLives[i] / particleMaxLives[i];

        for (let axis = 0; axis < 3; axis++) {
          particlePositions[k + axis] += particleVelocities[k + axis] * dt;
          particleVelocities[k + axis] *= damping;
          particleColors[k + axis] = particleBaseColors[k + axis] * fade;
        }
      }

      particleGeo.attributes.position.needsUpdate = true;
      particleGeo.attributes.color.needsUpdate = true;
      particleGeo.attributes.life.needsUpdate = true;
    }

    // ============================================================
    // DESTRUIÇÃO DAS ESTAÇÕES
    // ============================================================

    const stationExplosions = [];
    const stationShockGeo = new THREE.SphereGeometry(1, 20, 14);

    function damageStation(entry, amount, impactPosition) {
      if (!entry || entry.destroyed || !entry.group.visible) return false;
      entry.hp = Math.max(0, entry.hp - amount);
      burst(impactPosition || entry.group.position, 0x8ff7ff, 18, 18);

      const integrity = Math.ceil(entry.hp / entry.maxHp * 100);
      const warningStep = Math.floor(integrity / 20) * 20;
      if (warningStep < entry.lastWarning && integrity > 0) {
        entry.lastWarning = warningStep;
        queueEvent(`ESTAÇÃO // INTEGRIDADE ESTRUTURAL EM ${integrity}%`, "alert");
      }

      if (entry.hp <= 0) destroyStation(entry);
      return true;
    }

    function destroyStation(entry) {
      if (!entry || entry.destroyed) return;
      entry.destroyed = true;
      sound("bomb", entry.group.position);
      affectCivilization({ economy: -3, trade: -5, stability: -7 },
        "AURORA // PERDA DE ESTAÇÃO AFETA ABASTECIMENTO E COMÉRCIO");
      const center = entry.group.position.clone();
      spawnImpact(center, 170, 0xffa458);

      burst(center, 0xff542f, 250, 125);
      burst(center, 0xffc34d, 210, 92);
      burst(center, 0x43dcff, 180, 72);

      const shocks = [
        { color: 0xff7042, speed: 105, opacity: .72 },
        { color: 0x50dfff, speed: 76, opacity: .58 },
        { color: 0xc068ff, speed: 52, opacity: .42 }
      ].map(config => {
        const material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(config.color).multiplyScalar(3.2),
          transparent: true,
          opacity: config.opacity,
          wireframe: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        const shock = new THREE.Mesh(stationShockGeo, material);
        shock.position.copy(center);
        shock.scale.setScalar(2);
        scene.add(shock);
        return { mesh: shock, speed: config.speed, opacity: config.opacity };
      });

      const debris = [];
      for (let i = 0; i < 24; i++) {
        const fragment = new THREE.Mesh(boxGeo, i % 3 ? metal : darkMetal);
        fragment.position.copy(center).add(new V3().randomDirection().multiplyScalar(rand(3, 22)));
        fragment.scale.set(rand(.6, 2.8), rand(.25, 1.3), rand(1.2, 5));
        scene.add(fragment);
        debris.push({
          mesh: fragment,
          velocity: new V3().randomDirection().multiplyScalar(rand(28, 105)),
          spin: new V3(rand(-5, 5), rand(-5, 5), rand(-5, 5))
        });
      }

      stationExplosions.push({ shocks, debris, life: 2.8, maxLife: 2.8 });

      if (entry.starter) {
        entry.group.visible = false;
      } else {
        destroyedWorldObjects.add(entry.id);
        scene.remove(entry.group);
        removeArrayEntry(refuelStations, entry);
      }

      if (center.distanceToSquared(camera.position) < 210 * 210) {
        const distance = center.distanceTo(camera.position);
        shield = Math.max(0, shield - Math.max(8, 42 * (1 - distance / 210)));
        sinceDamage = 0;
        damage = 1;
        if (shield <= 0) {
          dead = true;
          pause();
        }
      }

      queueEvent("ALERTA // ESTAÇÃO DESTRUÍDA · REAÇÃO EM CADEIA", "alert");
    }

    function updateStationExplosions(dt) {
      for (let i = stationExplosions.length - 1; i >= 0; i--) {
        const explosion = stationExplosions[i];
        explosion.life -= dt;
        const elapsed = explosion.maxLife - explosion.life;
        const fade = clamp(explosion.life / explosion.maxLife, 0, 1);

        for (const shock of explosion.shocks) {
          shock.mesh.scale.setScalar(2 + elapsed * shock.speed);
          shock.mesh.material.opacity = shock.opacity * fade * fade;
          shock.mesh.rotation.y += dt * .8;
        }

        for (const fragment of explosion.debris) {
          fragment.mesh.position.addScaledVector(fragment.velocity, dt);
          fragment.velocity.multiplyScalar(Math.exp(-.7 * dt));
          fragment.mesh.rotation.x += fragment.spin.x * dt;
          fragment.mesh.rotation.y += fragment.spin.y * dt;
          fragment.mesh.rotation.z += fragment.spin.z * dt;
          fragment.mesh.scale.multiplyScalar(Math.exp(-.35 * dt));
        }

        if (explosion.life <= 0) {
          disposeStationExplosion(explosion);
          stationExplosions.splice(i, 1);
        }
      }
    }

    function disposeStationExplosion(explosion) {
      for (const shock of explosion.shocks) {
        scene.remove(shock.mesh);
        shock.mesh.material.dispose();
      }
      for (const fragment of explosion.debris) scene.remove(fragment.mesh);
    }

    // ============================================================
    // DRONES ROBÓTICOS
    // ============================================================

    const drones = [];

    const interceptorHull = new THREE.ConeGeometry(1, 3.8, 3);
    const fortressHull = new THREE.OctahedronGeometry(1, 0);
    const interceptorArmor = new THREE.MeshStandardMaterial({
      color: 0x8b3147, metalness: .76, roughness: .34
    });
    const fortressArmor = new THREE.MeshStandardMaterial({
      color: 0x584575, metalness: .82, roughness: .46
    });

    function createDrone(index) {
      const group = new THREE.Group();
      const kind = index % 3;
      const arms = [];
      let core, engine;

      if (kind === 0) {
        mesh(boxGeo, metal, group, [0, 0, 0], [3.7, 3.5, 2.4]);
        mesh(ballGeo, armor, group, [0, 2.4, .25], [1.8, 1.25, 1.3]);
        mesh(boxGeo, pink, group, [0, 2.45, 1.48], [2.6, .28, .18]);
        core = mesh(ballGeo, pink, group, [0, 0, 1.5], [.75, .75, .5]);
        for (const side of [-1, 1]) {
          const arm = new THREE.Group();
          arm.position.set(side * 2.5, .7, 0);
          group.add(arm);
          arms.push(arm);
          mesh(ballGeo, armor, arm, [0, 0, 0], [.7, .7, .7]);
          mesh(boxGeo, metal, arm, [side * .6, -1.2, 0], [.85, 2.4, 1]);
          mesh(boxGeo, darkMetal, arm, [side * .6, -2.1, 1.3], [1, 1, 3.8]);
          mesh(ballGeo, pink, arm, [side * .6, -2.1, 3.25], [.35, .35, .2]);
          mesh(boxGeo, armor, group, [side * 1.2, -2.8, 0], [.9, 2.2, 1]);
        }
        engine = mesh(ringGeo, cyan, group, [0, 0, -1.7], [1.3, 1.3, 1.3]);
      } else if (kind === 1) {
        // Interceptor: fuselagem triangular comprida e asas inclinadas.
        const nose = mesh(interceptorHull, interceptorArmor, group, [0, 0, 0], [2.8, 2.4, 1]);
        nose.rotation.x = Math.PI / 2;
        for (const side of [-1, 1]) {
          const wing = mesh(interceptorHull, metal, group, [side * 2.4, -.2, -1.2],
            [1.9, .65, 1.15]);
          wing.rotation.set(Math.PI / 2, 0, side * .22);
          mesh(boxGeo, darkMetal, group, [side * 2.5, -.5, -2.5], [.45, .5, 2.3]);
        }
        core = mesh(ballGeo, pink, group, [0, .38, 1.8], [.65, .35, .85]);
        engine = mesh(ringGeo, pink, group, [0, 0, -3], [1.1, 1.1, 1.1]);
      } else {
        // Fortaleza: casco octogonal largo, placas e duas baterias laterais.
        mesh(fortressHull, fortressArmor, group, [0, 0, 0], [5.4, 2.9, 4]);
        mesh(boxGeo, darkMetal, group, [0, .9, 0], [6, .6, 2]);
        for (const side of [-1, 1]) {
          mesh(boxGeo, metal, group, [side * 4.3, -.45, .25], [1.4, 1.3, 4.5]);
          mesh(boxGeo, fortressArmor, group, [side * 4.4, .8, 0], [1.7, .6, 3]);
          mesh(ballGeo, pink, group, [side * 4.3, -.4, 2.6], [.45, .45, .55]);
        }
        core = mesh(ballGeo, purple, group, [0, .8, 2.5], [1.1, .65, .6]);
        engine = mesh(ringGeo, purple, group, [0, 0, -3.9], [1.9, 1.9, 1.9]);
      }
      scene.add(group);

      return {
        group, arms, core, engine, coreScale: core.scale.clone(), kind,
        maxHp: [3, 2, 7][kind],
        hp: [3, 2, 7][kind], phase: rand(0, Math.PI * 2),
        cooldown: rand(1.2, 3.8), respawn: 0
      };
    }

    function placeDrone(drone, initial = false, index = 0) {
      const local = new V3(
        initial ? (index % 3 - 1) * 32 : rand(-100, 100),
        initial ? (Math.floor(index / 3) - 1) * 24 : rand(-55, 55),
        initial ? -120 - Math.floor(index / 3) * 55 : -rand(150, 280)
      );

      local.applyQuaternion(camera.quaternion).add(camera.position);
      drone.group.position.copy(local);
      drone.group.visible = true;
      drone.hp = drone.maxHp;
      drone.cooldown = rand(1.5, 4);
      drone.respawn = 0;
    }

    for (let i = 0; i < CONFIG.drones; i++) drones.push(createDrone(i));

    // ============================================================
    // ESQUADRÃO ALIADO E NAVE-CHEFÃ
    // ============================================================

    const allyGreen = new THREE.MeshStandardMaterial({
      color: 0x56ffc0,
      emissive: 0x0d6b4a,
      emissiveIntensity: 1.7,
      roughness: .28,
      metalness: .62
    });
    const bossArmor = new THREE.MeshStandardMaterial({
      color: 0x5a263b, roughness: .4, metalness: .82
    });

    function createAlly(index) {
      const group = new THREE.Group();
      group.scale.setScalar(1.55);
      mesh(boxGeo, armor, group, [0, 0, 0], [1.1, .38, 2.7]);
      mesh(ballGeo, darkMetal, group, [0, .25, -.2], [.72, .35, 1.1]);
      mesh(boxGeo, allyGreen, group, [0, .43, -.4], [.32, .035, 1.2]);

      for (const side of [-1, 1]) {
        const wing = mesh(boxGeo, metal, group, [side * 1.35, -.12, .15], [1.5, .09, 1.15]);
        wing.rotation.z = side * -.14;
        mesh(boxGeo, darkMetal, group, [side * 1.12, -.08, -1.45], [.22, .2, 1.45]);
        mesh(ballGeo, allyGreen, group, [side * .58, -.15, 2.5], [.16, .16, .3]);
      }

      const legacyHull = group.children.slice();

      const marker = mesh(ringGeo, allyGreen, group, [0, 0, .2], [2.6, 2.6, 2.6]);
      marker.rotation.x = Math.PI / 2;

      const beacon = new THREE.PointLight(0x55ffb8, 5, 34);
      beacon.position.set(0, .5, 1.2);
      group.add(beacon);

      group.visible = false;
      scene.add(group);
      return {
        group,
        legacyHull,
        beacon,
        index,
        active: false,
        cooldown: rand(.25, .8),
        hp: 28,
        maxHp: 28,
        respawn: 0,
        phase: rand(0, Math.PI * 2),
        velocity: new V3()
      };
    }

    const allies = Array.from({ length: CONFIG.allies }, (_, i) => createAlly(i));
    void upgradeShipVisuals(shipExterior, allies);
    let allySpawnTimer = rand(9, 15);

    function createBoss() {
      const group = new THREE.Group();
      group.scale.setScalar(3);

      const bossHullGeo = new THREE.OctahedronGeometry(1, 0);
      const bossWingGeo = new THREE.TetrahedronGeometry(1, 0);
      const hull = mesh(bossHullGeo, bossArmor, group, [0, 0, 0], [2.8, 1.45, 4.2]);
      hull.rotation.x = Math.PI / 4;
      const legacyHull = [hull];
      mesh(ballGeo, darkMetal, group, [0, 1.15, .35], [1.65, .85, 2.15]);
      const core = mesh(ballGeo, pink, group, [0, .05, -4.15], [.9, .9, .5]);

      const turrets = [];
      for (const side of [-1, 1]) {
        const wing = mesh(bossWingGeo, bossArmor, group, [side * 3.2, -.2, .45], [3.5, 1.0, 3.1]);
        legacyHull.push(wing);
        wing.rotation.set(.25, side * .42, side * -.18);
        const turret = mesh(boxGeo, darkMetal, group, [side * 2.6, .65, -2.5], [.75, .75, 3.2]);
        mesh(ballGeo, pink, turret, [0, 0, -1.75], [.3, .3, .18]);
        turrets.push(turret);
        const engineRing = mesh(ringGeo, purple, group, [side * 1.45, -.1, 3.5], [.85, .85, .85]);
        engineRing.rotation.x = Math.PI / 2;
      }

      const crown = mesh(ringGeo, purple, group, [0, 1.7, .4], [2.3, 2.3, 2.3]);
      crown.rotation.x = Math.PI / 2;

      group.visible = false;
      scene.add(group);
      return {
        group, core, turrets,
        legacyHull,
        visible: false,
        hp: CONFIG.bossHp,
        cooldown: 1.5,
        respawn: rand(38, 52),
        phase: rand(0, Math.PI * 2)
      };
    }

    const boss = createBoss();
    void upgradeBossVisual(boss);

    // ============================================================
    // NAVE-MÃE INIMIGA
    // ============================================================

    function createMothership() {
      const { group, core, commandRing, turrets } = createCapitalShip();
      group.visible = false;
      scene.add(group);
      return {
        group, core, commandRing, turrets,
        visible: false,
        hp: CONFIG.mothershipHp,
        cooldown: 1,
        barrageCooldown: 4.5,
        respawn: rand(68, 88),
        salvo: 0,
        phase: rand(0, Math.PI * 2)
      };
    }

    const mothership = createMothership();

    // Multiple hit zones follow the bow, main hull and engine nacelles.
    const mothershipHitZones = [
      [0, 0, 16, 1.7], [0, 0, 12, 2.4], [0, 0, 7, 3.7],
      [0, 0, 1, 5], [0, 0, -5, 5.5], [0, 0, -10, 4.4],
      [-8.25, -.55, -7.2, 2.2], [8.25, -.55, -7.2, 2.2]
    ];
    function hitsMothership(start, end) {
      mothership.group.updateMatrixWorld(true);
      const localStart = mothership.group.worldToLocal(start.clone());
      const localEnd = mothership.group.worldToLocal(end.clone());
      return mothershipHitZones.some(([x, y, z, radius]) =>
        segmentDistanceSquared(new V3(x, y, z), localStart, localEnd) < radius * radius
      );
    }

    const distantBattles = [];
    let nextDistantBattle = rand(14, 22);
    const battleHullGeo = new THREE.ConeGeometry(1, 3.6, 3);
    const battleBeamGeo = new THREE.CylinderGeometry(.45, .45, 1, 5);
    const battleFriendMaterial = new THREE.MeshStandardMaterial({
      color: 0x67afae, metalness: .65, roughness: .43
    });
    const battleEnemyMaterial = new THREE.MeshStandardMaterial({
      color: 0xa04562, metalness: .67, roughness: .43
    });

    function removeDistantBattle(battle) {
      for (const beam of battle.beams) beam.mesh.material.dispose();
      scene.remove(battle.group);
      removeArrayEntry(distantBattles, battle);
    }

    function spawnDistantBattle() {
      const direction = new V3(rand(-.55, .55), rand(-.22, .22), -1)
        .normalize().applyQuaternion(camera.quaternion);
      const center = camera.position.clone().addScaledVector(direction, rand(850, 1150));
      if (center.distanceTo(planet.position) < 850 ||
        celestialBodies.some(body => center.distanceTo(body.group.position) < body.radius + 240) ||
        refuelStations.some(entry => !entry.destroyed &&
          center.distanceTo(entry.group.position) < entry.radius + 210) ||
        worldAsteroids.some(asteroid =>
          center.distanceTo(asteroid.mesh.position) < asteroid.radius + 150)) {
        return false;
      }
      const group = new THREE.Group();
      group.position.copy(center);
      scene.add(group);
      const actors = [];
      for (let i = 0; i < 5; i++) {
        const friendly = i < 2;
        const craft = new THREE.Group();
        craft.position.set(friendly ? -90 : 90,
          (i % 3 - 1) * 32, (i - 2) * 27);
        craft.scale.setScalar(5);
        const hull = mesh(battleHullGeo,
          friendly ? battleFriendMaterial : battleEnemyMaterial, craft,
          [0, 0, 0], [1.8, 1.6, 1]);
        hull.rotation.x = Math.PI / 2;
        for (const side of [-1, 1]) {
          const wing = mesh(boxGeo, friendly ? armor : darkMetal, craft,
            [side * 1.4, -.2, -.8], [1.7, .18, 2]);
          wing.rotation.z = side * .18;
        }
        group.add(craft);
        actors.push({ group: craft, friendly, hp: friendly ? 5 : 4,
          cooldown: rand(.3, 1.3), phase: rand(0, 7), alive: true });
      }
      const galactic = center.clone().add(galacticOrigin);
      const sector = [galactic.x, galactic.y, galactic.z]
        .map(value => Math.floor(value / CONFIG.sectorSize)).join(".");
      distantBattles.push({ group, actors, beams: [], age: 0, sector });
      queueEvent(`SENSORES // COMBATE ENTRE ESQUADRÕES NO SETOR ${sector}`, "alert");
      return true;
    }

    function hitDistantActor(battle, actor, damageValue, playerAward = false) {
      if (!actor.alive) return;
      actor.hp -= damageValue;
      if (actor.hp > 0) return;
      actor.alive = false;
      actor.group.getWorldPosition(temp);
      burst(temp, actor.friendly ? 0x63f0a8 : 0xff715d, 55, 26);
      actor.group.visible = false;
      if (playerAward && !actor.friendly) score += 120;
    }

    function updateDistantBattles(dt) {
      nextDistantBattle -= dt;
      if (nextDistantBattle <= 0) {
        if (distantBattles.length < 2) spawnDistantBattle();
        nextDistantBattle = rand(36, 54);
      }
      for (const battle of [...distantBattles]) {
        battle.age += dt;
        battle.group.updateMatrixWorld(true);
        for (let i = battle.beams.length - 1; i >= 0; i--) {
          const beam = battle.beams[i];
          beam.life -= dt;
          if (beam.life <= 0) {
            battle.group.remove(beam.mesh);
            beam.mesh.material.dispose();
            battle.beams.splice(i, 1);
          } else beam.mesh.material.opacity = beam.life / .26;
        }
        for (const actor of battle.actors) {
          if (!actor.alive) continue;
          const opponents = battle.actors.filter(other =>
            other.alive && other.friendly !== actor.friendly);
          if (!opponents.length) continue;
          const target = opponents.reduce((closest, other) =>
            other.group.position.distanceToSquared(actor.group.position) <
            closest.group.position.distanceToSquared(actor.group.position) ? other : closest);
          const direction = new V3().subVectors(target.group.position, actor.group.position);
          const distance = direction.length();
          if (distance > 48) actor.group.position.addScaledVector(direction, dt * 16 / distance);
          actor.group.position.y += Math.sin(time * 1.9 + actor.phase) * dt * 4;
          actor.group.lookAt(target.group.getWorldPosition(new V3()));
          actor.cooldown -= dt;
          if (actor.cooldown > 0 || distance > 270) continue;
          const start = actor.group.position.clone();
          const path = target.group.position.clone().sub(start);
          const beam = new THREE.Mesh(battleBeamGeo, new THREE.MeshBasicMaterial({
            color: actor.friendly ? 0x6cffe0 : 0xff638a,
            transparent: true, opacity: 1, depthWrite: false
          }));
          beam.position.copy(start).addScaledVector(path, .5);
          beam.quaternion.setFromUnitVectors(UP_AXIS, path.clone().normalize());
          beam.scale.y = path.length();
          battle.group.add(beam);
          battle.beams.push({ mesh: beam, life: .26 });
          hitDistantActor(battle, target, 1);
          actor.cooldown = rand(1.25, 2.3);
        }
        const friendlies = battle.actors.some(actor => actor.alive && actor.friendly);
        const enemies = battle.actors.some(actor => actor.alive && !actor.friendly);
        if (!friendlies || !enemies || battle.age > 35 ||
          battle.group.position.distanceToSquared(camera.position) > 2200 ** 2) {
          if (!friendlies || !enemies) {
            queueEvent(`SENSORES // COMBATE NO SETOR ${battle.sector} ENCERRADO`,
              friendlies ? "ally" : "alert");
          }
          removeDistantBattle(battle);
        }
      }
    }

    const solidImpactTimes = new Map();
    function collectSolids(start, end, shipRadius, includeShips = false) {
      const solids = [];
      const travel = start.distanceTo(end) + shipRadius + 4;
      const add = (center, radius, key, kind, source = null) => {
        const reach = radius + travel;
        if (center.distanceToSquared(start) <= reach * reach) {
          solids.push({ center, radius, key, kind, source });
        }
      };
      add(planet.position, 570, "home-planet", "planet");
      for (const body of celestialBodies) {
        add(body.group.position, body.radius, body.group.uuid, body.type);
      }
      for (const asteroid of worldAsteroids) {
        add(asteroid.mesh.position, asteroid.radius, asteroid.id, "asteroid", asteroid);
      }
      for (const entry of refuelStations) {
        if (!entry.destroyed && entry.group.visible && entry.group.parent) {
          add(entry.group.position, entry.radius, entry.id, "station");
        }
      }
      if (includeShips) {
        for (const drone of drones) {
          if (drone.group.visible) add(drone.group.position,
            drone.kind === 2 ? 7 : 5, drone.group.uuid, "enemy");
        }
        for (const ally of allies) {
          if (ally.active) add(ally.group.position, 6, ally.group.uuid, "ally");
        }
        if (boss.visible) add(boss.group.position, 19, "boss", "enemy");
        if (mothership.visible) {
          mothership.group.updateMatrixWorld(true);
          const scale = mothership.group.scale.x;
          for (const [index, zone] of mothershipHitZones.entries()) {
            const [x, y, z, radius] = zone;
            add(mothership.group.localToWorld(new V3(x, y, z)), radius * scale,
              `mothership:${index}`, "enemy");
          }
        }
        for (const battle of distantBattles) {
          battle.group.updateMatrixWorld(true);
          for (const actor of battle.actors) {
            if (actor.alive) add(actor.group.getWorldPosition(new V3()), 14,
              actor.group.uuid, actor.friendly ? "ally" : "enemy");
          }
        }
      }
      return solids;
    }

    function keepActorOutOfWorld(group, previous, radius) {
      const solids = collectSolids(previous, group.position, radius);
      group.position.copy(moveAgainstSolids(previous, group.position, radius, solids).position);
    }

    // Baterias de defesa ficam presas à superfície e acompanham a rotação do planeta.
    const defenseTurrets = [];
    const defenseBeams = [];
    const defenseBeamGeo = new THREE.CylinderGeometry(1.3, 1.3, 1, 6);
    const defenseBeamMaterial = new THREE.MeshBasicMaterial({
      color: 0x65e9ff, transparent: true, opacity: .9, depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    for (let i = 0; i < 12; i++) {
      // Distribuição em espiral para cobrir todos os lados do planeta.
      const height = 1 - 2 * (i + .5) / 12;
      const radius = Math.sqrt(1 - height * height);
      const angle = i * Math.PI * (3 - Math.sqrt(5));
      const normal = new V3(radius * Math.cos(angle), height, radius * Math.sin(angle));
      const turret = new THREE.Group();
      turret.position.copy(normal).multiplyScalar(574);
      turret.quaternion.setFromUnitVectors(UP_AXIS, normal);
      mesh(new THREE.CylinderGeometry(10, 14, 6, 8), darkMetal, turret, [0, 0, 0]);
      mesh(boxGeo, armor, turret, [0, 6, 0], [12, 6, 12]);
      mesh(boxGeo, weaponAccent, turret, [0, 15, 0], [4, 18, 4]);
      mesh(ballGeo, cyan, turret, [0, 24, 0], [3, 2, 3]);
      planet.add(turret);
      defenseTurrets.push(turret);
    }
    let defenseCooldown = 1.4;
    let defenseVolley = 0;

    function clearDefenseBeam(beam) {
      scene.remove(beam.mesh);
      beam.mesh.material.dispose();
    }

    function updatePlanetDefenses(dt) {
      for (let i = defenseBeams.length - 1; i >= 0; i--) {
        const beam = defenseBeams[i];
        beam.life -= dt;
        if (beam.life <= 0) {
          clearDefenseBeam(beam);
          defenseBeams.splice(i, 1);
        } else {
          beam.mesh.material.opacity = .9 * beam.life / .26;
        }
      }

      if (!mothership.visible ||
        mothership.group.position.distanceToSquared(planet.position) > 2750 ** 2) return;
      defenseCooldown -= dt;
      if (defenseCooldown > 0) return;
      planet.updateMatrixWorld(true);
      const available = [];
      for (const turret of defenseTurrets) {
        const origin = turret.getWorldPosition(new V3());
        const normal = origin.clone().sub(planet.position).normalize();
        const direction = new V3().subVectors(mothership.group.position, origin).normalize();
        if (normal.dot(direction) > .4) available.push(turret);
      }
      if (!available.length) { defenseCooldown = 1; return; }
      const selected = available[defenseVolley % available.length];

      const origin = selected.localToWorld(new V3(0, 25, 0));
      const target = mothership.group.position.clone()
        .add(new V3(rand(-28, 28), rand(-18, 18), rand(-28, 28)));
      const path = target.sub(origin);
      const beamMesh = new THREE.Mesh(defenseBeamGeo, defenseBeamMaterial.clone());
      beamMesh.position.copy(origin).addScaledVector(path, .5);
      beamMesh.quaternion.setFromUnitVectors(UP_AXIS, path.clone().normalize());
      beamMesh.scale.set(1, path.length(), 1);
      scene.add(beamMesh);
      defenseBeams.push({ mesh: beamMesh, life: .26 });
      burst(mothership.group.position, 0x6de8ff, 22, 14);
      mothership.hp -= 3;
      if (mothership.hp <= 0) destroyMothership();
      if (defenseVolley++ === 0) {
        queueEvent("AURORA // BATERIAS PLANETÁRIAS DISPARAM CONTRA A NAVE-MÃE", "ally");
      }
      defenseCooldown = 1.15;
    }

    // ============================================================
    // ESTADO E PROJÉTEIS
    // ============================================================

    const keys = new Set();

    // Estado do joypad padrão (layout Xbox / Standard Gamepad).
    const gamepadInput = {
      connected: false,
      index: -1,
      moveX: 0,
      moveY: 0,
      aimX: 0,
      aimY: 0,
      up: false,
      down: false,
      boost: false,
      forward: false,
      fire: false,
      previousButtons: []
    };

    const GAMEPAD_DEAD_ZONE = 0.18;

    function normalizeGamepadAxis(value) {
      const magnitude = Math.abs(value);

      if (magnitude <= GAMEPAD_DEAD_ZONE) return 0;

      return Math.sign(value) *
        (magnitude - GAMEPAD_DEAD_ZONE) / (1 - GAMEPAD_DEAD_ZONE);
    }

    function clearGamepadInput(keepConnection = true) {
      gamepadInput.moveX = 0;
      gamepadInput.moveY = 0;
      gamepadInput.aimX = 0;
      gamepadInput.aimY = 0;
      gamepadInput.up = false;
      gamepadInput.down = false;
      gamepadInput.boost = false;
      gamepadInput.forward = false;
      gamepadInput.fire = false;
      gamepadInput.previousButtons = [];

      if (!keepConnection) {
        gamepadInput.connected = false;
        gamepadInput.index = -1;
      }
    }

    const velocity = new V3();
    const desiredVelocity = new V3();
    const forward = new V3();
    const temp = new V3();
    const rotation = new THREE.Euler(0, 0, 0, "YXZ");

    let yaw = 0, pitch = 0;
    let active = false, dead = false, started = false;
    let mouseDown = false, hadPointerLock = false;
    let time = 0, score = 0, shield = 100, heat = 0, charge = 100;
    let fuel = 100, bombCount = CONFIG.maxBombs, bombCooldown = 0;
    let warpTimer = 0, warpVisual = 0, damage = 0, hitTimer = 0;
    let fireCooldown = 0, sinceDamage = 10, overheated = false;
    let eventTimer = 4, nextAmbientMessage = rand(5, 8);

    const ambientMessages = [
      "SENSORES // DESTROÇOS METÁLICOS À DERIVA",
      "COMANDO // PATRULHA INIMIGA DETECTADA NO SETOR",
      "NAVEGAÇÃO // CORREDOR DE SALTO PARCIALMENTE ESTÁVEL",
      "ANÁLISE // ASSINATURAS DE PLASMA EM MOVIMENTO",
      "SISTEMAS // TELEMETRIA DE COMBATE SINCRONIZADA",
      "COMANDO // MANTENHA DISTÂNCIA DOS CAMPOS DE ASTEROIDES",
      "SENSORES // VARREDURA DE LONGO ALCANCE CONCLUÍDA",
      "NAVEGAÇÃO // ROTA ALTERNATIVA CALCULADA"
    ];

    function queueEvent(text, type = "") {
      ui.eventFeed.textContent = text;
      ui.eventFeed.className = type;
      ui.eventFeed.style.opacity = "1";
      eventTimer = 4.2;
      nextAmbientMessage = rand(6, 10);
      if (type === "alert" && active) sound("alert");
    }

    function updateMissionEvents(dt) {
      eventTimer = Math.max(0, eventTimer - dt);
      nextAmbientMessage -= dt;
      ui.eventFeed.style.opacity = eventTimer > 0 ? "1" : ".48";

      if (nextAmbientMessage > 0 || eventTimer > 0) return;

      const nearbyEnemies = drones.filter(drone =>
        drone.group.visible && drone.group.position.distanceToSquared(camera.position) < 260 * 260
      ).length;

      const contextual = mothership.visible
        ? `ALERTA // NAVE-MÃE COM ${Math.ceil(mothership.hp / CONFIG.mothershipHp * 100)}% DE INTEGRIDADE`
        : boss.visible
        ? `ALERTA // CHEFÃO COM ${Math.ceil(boss.hp / CONFIG.bossHp * 100)}% DE INTEGRIDADE`
        : nearbyEnemies >= 5
          ? `SENSORES // FORMAÇÃO HOSTIL COM ${nearbyEnemies} CONTATOS PRÓXIMOS`
          : allies.some(ally => ally.active)
            ? "COMANDO // ESQUADRÃO ALIADO MANTÉM COBERTURA"
            : ambientMessages[Math.floor(Math.random() * ambientMessages.length)];

      queueEvent(contextual, mothership.visible || boss.visible || nearbyEnemies >= 5 ? "alert" : "");
    }

    const bullets = [];
    const bulletPool = [];
    const bulletGeo = new THREE.CylinderGeometry(.11, .11, 4.5, 6);
    bulletGeo.rotateX(Math.PI / 2);

    function removeBullet(index) {
      const bullet = bullets[index];
      bullet.mesh.visible = false;
      bulletPool.push(bullet);
      bullets.splice(index, 1);
    }

    function spawnBullet(
      position, direction, enemy = false, owner = "player", damageValue = 9,
      speedOverride = null
    ) {
      const bullet = bulletPool.pop() || {
        mesh: new THREE.Mesh(bulletGeo, cyan),
        velocity: new V3(),
        previous: new V3(),
        life: 0,
        enemy: false,
        owner: "player",
        damage: 9
      };

      if (!bullet.mesh.parent) scene.add(bullet.mesh);

      bullet.enemy = enemy;
      bullet.owner = owner;
      bullet.damage = damageValue;
      bullet.life = enemy ? 4 : 2.2;
      bullet.mesh.material = enemy
        ? owner === "mothership" ? purple : pink
        : owner === "ally" ? allyShotMaterial : playerShotMaterial;
      bullet.mesh.visible = true;
      bullet.mesh.position.copy(position);
      bullet.mesh.quaternion.setFromUnitVectors(BULLET_AXIS, direction);
      bullet.velocity.copy(direction).multiplyScalar(
        speedOverride ?? (enemy ? 110 : 390)
      );

      if (!enemy && owner === "player") bullet.velocity.add(velocity);
      bullets.push(bullet);
    }

    // ============================================================
    // BOMBA DE EMERGÊNCIA
    // ============================================================

    const bombs = [];
    const bombGeo = new THREE.IcosahedronGeometry(1.15, 1);
    const bombMaterial = glow(0xffa63d);

    function isExtremeDanger() {
      if (shield <= 45) return true;
      if (
        mothership.visible &&
        mothership.group.position.distanceToSquared(camera.position) < 520 * 520
      ) return true;
      if (boss.visible && boss.group.position.distanceToSquared(camera.position) < 360 * 360) {
        return true;
      }

      let threats = 0;
      for (const drone of drones) {
        if (drone.group.visible && drone.group.position.distanceToSquared(camera.position) < 110 * 110) {
          if (++threats >= 4) return true;
        }
      }
      for (const asteroid of worldAsteroids) {
        if (asteroid.mesh.position.distanceToSquared(camera.position) < 90 * 90) {
          if (++threats >= 4) return true;
        }
      }
      return false;
    }

    function launchBomb() {
      if (!active || bombCount <= 0 || bombCooldown > 0 || warpTimer > 0) return false;
      if (!isExtremeDanger()) {
        ui.message.textContent = "BOMBA BLOQUEADA // SOMENTE EM PERIGO EXTREMO";
        return false;
      }

      camera.getWorldDirection(forward);
      const mesh = new THREE.Mesh(bombGeo, bombMaterial);
      mesh.position.copy(camera.position).addScaledVector(forward, 4.5);
      mesh.scale.set(1, 1, 2.2);
      scene.add(mesh);

      bombs.push({
        mesh,
        velocity: forward.clone().multiplyScalar(150).add(velocity),
        life: 1.35,
        pulse: 0
      });

      bombCount--;
      bombCooldown = 2.2;
      cockpit.position.z = .16;
      return true;
    }

    function detonateBomb(index) {
      const bomb = bombs[index];
      if (!bomb) return;
      sound("bomb", bomb.mesh.position);
      const center = bomb.mesh.position.clone();
      const radius = 240;
      const radiusSq = radius * radius;

      burst(center, 0xffc85c, 220, 105);
      burst(center, 0x57e7ff, 160, 80);
      spawnImpact(center, radius, 0x7be8ff);

      for (let i = worldAsteroids.length - 1; i >= 0; i--) {
        const asteroid = worldAsteroids[i];
        if (asteroid.mesh.position.distanceToSquared(center) <= radiusSq) {
          destroyAsteroid(asteroid, true);
        }
      }

      for (const drone of drones) {
        if (!drone.group.visible || drone.group.position.distanceToSquared(center) > radiusSq) continue;
        burst(drone.group.position, 0xff5c39, 90, 45);
        burst(drone.group.position, 0x48eaff, 45, 28);
        drone.group.visible = false;
        drone.respawn = rand(3, 5.5);
        score += 150;
      }

      for (const battle of distantBattles) {
        battle.group.updateMatrixWorld(true);
        for (const actor of battle.actors) {
          if (!actor.alive || actor.friendly) continue;
          if (actor.group.getWorldPosition(new V3()).distanceToSquared(center) <= radiusSq) {
            hitDistantActor(battle, actor, 8, true);
          }
        }
      }

      if (boss.visible && boss.group.position.distanceToSquared(center) <= radiusSq) {
        boss.hp -= 14;
        burst(boss.group.position, 0xff735c, 100, 45);
        queueEvent("BOMBA // IMPACTO DIRETO NA NAVE-CHEFÃ", "alert");
        if (boss.hp <= 0) destroyBoss();
      }

      if (mothership.visible && mothership.group.position.distanceToSquared(center) <= radiusSq) {
        mothership.hp -= 55;
        burst(mothership.group.position, 0xff4f8c, 170, 72);
        burst(mothership.group.position, 0xa84dff, 130, 58);
        queueEvent("BOMBA // IMPACTO CRÍTICO NA NAVE-MÃE · -55", "alert");
        if (mothership.hp <= 0) destroyMothership();
      }

      for (let s = refuelStations.length - 1; s >= 0; s--) {
        const stationEntry = refuelStations[s];
        if (
          !stationEntry.destroyed && stationEntry.group.visible &&
          stationEntry.group.position.distanceToSquared(center) <= radiusSq
        ) {
          damageStation(stationEntry, 24, stationEntry.group.position);
        }
      }

      for (let i = bullets.length - 1; i >= 0; i--) {
        if (bullets[i].enemy && bullets[i].mesh.position.distanceToSquared(center) <= radiusSq) {
          removeBullet(i);
        }
      }

      scene.remove(bomb.mesh);
      bombs.splice(index, 1);
      damage = Math.max(damage, .16);
      hitTimer = .18;
    }

    function updateBombs(dt) {
      bombCooldown = Math.max(0, bombCooldown - dt);

      for (let i = bombs.length - 1; i >= 0; i--) {
        const bomb = bombs[i];
        bomb.life -= dt;
        bomb.pulse += dt;
        bomb.mesh.position.addScaledVector(bomb.velocity, dt);
        bomb.mesh.rotation.z += dt * 5;
        bomb.mesh.rotation.x += dt * 3;
        bomb.mesh.scale.x = bomb.mesh.scale.y = 1 + Math.sin(bomb.pulse * 18) * .12;

        let impact = false;
        for (const asteroid of worldAsteroids) {
          const r = asteroid.radius + 2;
          if (asteroid.mesh.position.distanceToSquared(bomb.mesh.position) < r * r) {
            impact = true;
            break;
          }
        }

        if (!impact && boss.visible) {
          impact = boss.group.position.distanceToSquared(bomb.mesh.position) < 24 * 24;
        }
        if (!impact && mothership.visible) {
          impact = hitsMothership(bomb.mesh.position, bomb.mesh.position);
        }
        if (!impact) impact = bomb.mesh.position.distanceToSquared(planet.position) < 572 ** 2;
        if (!impact) impact = celestialBodies.some(body =>
          bomb.mesh.position.distanceToSquared(body.group.position) < (body.radius + 2) ** 2);

        if (impact || bomb.life <= 0) detonateBomb(i);
      }
    }

    function fire() {
      if (fireCooldown > 0 || overheated || warpTimer > 0) return;

      camera.getWorldDirection(forward);
      const aim = camera.position.clone().addScaledVector(forward, 450);

      for (const side of [-1, 1]) {
        const muzzleLocal = thirdPerson
          ? new V3(side * 1.42, -1.12, -10.15)
          : new V3(side * .95, -.67, -2.4);

        const origin = muzzleLocal
          .applyQuaternion(camera.quaternion)
          .add(camera.position);

        const direction = aim.clone().sub(origin).normalize();
        spawnBullet(origin, direction);
      }

      heat = Math.min(100, heat + 6);
      if (heat >= 100) overheated = true;

      fireCooldown = .14;
      sound("shot");
      cockpit.position.z = .085;
    }

    function updateBullets(dt) {
      for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        bullet.previous.copy(bullet.mesh.position);
        bullet.mesh.position.addScaledVector(bullet.velocity, dt);
        bullet.life -= dt;

        let hit = false;

        if (bullet.enemy) {
          for (const ally of allies) {
            if (!ally.active) continue;
            if (segmentDistanceSquared(
              ally.group.position, bullet.previous, bullet.mesh.position
            ) < 52) {
              ally.hp = Math.max(0, ally.hp - bullet.damage);
              burst(bullet.mesh.position, 0x69ffc5, 22, 20);
              hit = true;
              if (ally.hp <= 0) destroyAlly(ally);
              break;
            }
          }

          if (!hit) {
            for (let s = refuelStations.length - 1; s >= 0; s--) {
              const stationEntry = refuelStations[s];
              if (stationEntry.destroyed || !stationEntry.group.visible) continue;
              if (segmentDistanceSquared(
                stationEntry.group.position, bullet.previous, bullet.mesh.position
              ) < stationEntry.radius * stationEntry.radius) {
                hit = damageStation(stationEntry, bullet.damage, bullet.mesh.position);
                break;
              }
            }
          }

          if (!hit && warpTimer <= 0 && segmentDistanceSquared(
            camera.position, bullet.previous, bullet.mesh.position
          ) < 9) {
            shield = Math.max(0, shield - bullet.damage);
            sound("shield");
            sinceDamage = 0;
            damage = 1;
            hit = true;

            if (shield <= 0) {
              dead = true;
              pause();
            }
          }
        } else {
          for (const drone of drones) {
            if (!drone.group.visible) continue;

            if (
              segmentDistanceSquared(
                drone.group.position, bullet.previous, bullet.mesh.position
              ) < 32
            ) {
              drone.hp--;
              hitTimer = .13;
              hit = true;
              burst(bullet.mesh.position, 0xffb45c, 15, 14);

              if (drone.hp <= 0) {
                sound("blast", drone.group.position);
                burst(drone.group.position, 0xff5c39, 100, 45);
                burst(drone.group.position, 0x48eaff, 55, 28);
                drone.group.visible = false;
                drone.respawn = rand(2, 4.5);
                score += 150;
              }

              break;
            }
          }

          if (!hit && mothership.visible && hitsMothership(bullet.previous, bullet.mesh.position)) {
            mothership.hp--;
            hitTimer = .13;
            hit = true;
            burst(bullet.mesh.position, 0xc65cff, 18, 18);
            if (mothership.hp <= 0) destroyMothership();
          }

          if (!hit && boss.visible && segmentDistanceSquared(
            boss.group.position, bullet.previous, bullet.mesh.position
          ) < 19 * 19) {
            boss.hp--;
            hitTimer = .13;
            hit = true;
            burst(bullet.mesh.position, 0xff805f, 12, 14);

            if (boss.hp <= 0) destroyBoss();
          }

          if (!hit && bullet.owner === "player") {
            for (let s = refuelStations.length - 1; s >= 0; s--) {
              const stationEntry = refuelStations[s];
              if (stationEntry.destroyed || !stationEntry.group.visible) continue;
              if (segmentDistanceSquared(
                stationEntry.group.position, bullet.previous, bullet.mesh.position
              ) < stationEntry.radius * stationEntry.radius) {
                hit = damageStation(stationEntry, 1, bullet.mesh.position);
                break;
              }
            }
          }

          if (!hit) {
            for (let a = worldAsteroids.length - 1; a >= 0; a--) {
              const asteroid = worldAsteroids[a];
              if (segmentDistanceSquared(
                asteroid.mesh.position, bullet.previous, bullet.mesh.position
              ) < asteroid.radius * asteroid.radius) {
                asteroid.hp--;
                hitTimer = .13;
                hit = true;
                burst(bullet.mesh.position, 0xffb45c, 12, 12);

                if (asteroid.hp <= 0) destroyAsteroid(asteroid);
                break;
              }
            }
          }
          if (!hit) {
            for (const battle of distantBattles) {
              battle.group.updateMatrixWorld(true);
              const target = battle.actors.find(actor => actor.alive && !actor.friendly &&
                segmentDistanceSquared(actor.group.getWorldPosition(new V3()),
                  bullet.previous, bullet.mesh.position) < 11 ** 2);
              if (!target) continue;
              hitDistantActor(battle, target, 1, bullet.owner === "player");
              hit = true;
              break;
            }
          }
        }

        if (!hit && (segmentDistanceSquared(planet.position, bullet.previous,
          bullet.mesh.position) < 570 ** 2 || celestialBodies.some(body =>
          segmentDistanceSquared(body.group.position, bullet.previous,
            bullet.mesh.position) < body.radius ** 2))) hit = true;

        if (hit || bullet.life <= 0) removeBullet(i);
        if (hit) sound("hit", bullet.mesh.position);
      }
    }

    // ============================================================
    // TRILHA SONORA
    // ============================================================

    const musicFiles = $("musicFiles");
    const musicSelect = $("musicSelect");
    const musicEnabled = $("musicEnabled");
    const musicStatus = $("musicStatus");
    const bgMusic = $("bgMusic");
    const youtubeMusic = $("youtubeMusic");
    const DEFAULT_YOUTUBE_ID = "huXVnd-QnNs";
    const DEFAULT_YOUTUBE_PREVIEW =
      `https://www.youtube-nocookie.com/embed/${DEFAULT_YOUTUBE_ID}?enablejsapi=1&controls=1&rel=0`;
    const DEFAULT_YOUTUBE_PLAYING =
      `https://www.youtube-nocookie.com/embed/${DEFAULT_YOUTUBE_ID}?autoplay=1&loop=1&playlist=${DEFAULT_YOUTUBE_ID}&enablejsapi=1&controls=1&rel=0`;

    const musicURLs = new Set();
    let musicAttempt = 0;
    musicEnabled.checked = preferences.music !== false;
    musicSelect.value = allowed(preferences.track, ["youtube:huXVnd-QnNs", ""], "youtube:huXVnd-QnNs");

    function stopMusic() {
      musicAttempt++;
      bgMusic.pause();

      if (youtubeMusic.src !== DEFAULT_YOUTUBE_PREVIEW) {
        youtubeMusic.src = DEFAULT_YOUTUBE_PREVIEW;
      }
    }

    async function startMusic() {
      if (!active || !musicEnabled.checked || !musicSelect.value) {
        stopMusic();
        return;
      }

      const selectedMusic = musicSelect.value;

      if (selectedMusic.startsWith("youtube:")) {
        bgMusic.pause();
        bgMusic.hidden = true;
        youtubeMusic.hidden = false;

        if (youtubeMusic.src !== DEFAULT_YOUTUBE_PLAYING) {
          youtubeMusic.src = DEFAULT_YOUTUBE_PLAYING;
        }

        musicStatus.textContent =
          "Tocando a trilha padrão pelo player oficial do YouTube.";
        return;
      }

      youtubeMusic.hidden = true;
      const attempt = ++musicAttempt;

      try {
        await bgMusic.play();

        if (attempt !== musicAttempt) return;

        if (!active || !musicEnabled.checked) {
          stopMusic();
          return;
        }

        musicStatus.textContent =
          `Tocando: ${musicSelect.selectedOptions[0].textContent}`;
      } catch (error) {
        if (attempt !== musicAttempt || error.name === "AbortError") return;

        musicStatus.textContent =
          error.name === "NotAllowedError"
            ? "Abra o menu e toque no player para autorizar o áudio."
            : "Não foi possível reproduzir esta música. Tente outro arquivo.";
      }
    }

    function selectMusic() {
      stopMusic();

      const url = musicSelect.value;

      if (!url) {
        bgMusic.hidden = true;
        youtubeMusic.hidden = true;
        bgMusic.removeAttribute("src");
        bgMusic.load();
        musicStatus.textContent = "Trilha sonora desativada.";
        return;
      }

      if (url.startsWith("youtube:")) {
        bgMusic.hidden = true;
        youtubeMusic.hidden = false;
        youtubeMusic.src = active && musicEnabled.checked
          ? DEFAULT_YOUTUBE_PLAYING
          : DEFAULT_YOUTUBE_PREVIEW;
        musicStatus.textContent =
          active
            ? "Tocando a trilha padrão pelo player oficial do YouTube."
            : "Trilha padrão do YouTube selecionada. Ela começará ao iniciar a missão.";
        return;
      }

      youtubeMusic.hidden = true;
      bgMusic.hidden = false;
      bgMusic.src = url;
      bgMusic.load();

      musicStatus.textContent =
        `Selecionada: ${musicSelect.selectedOptions[0].textContent}. ` +
        "Use o player para ouvir uma prévia ou inicie a missão.";

      if (active) startMusic();
    }

    musicFiles.addEventListener("change", () => {
      const files = Array.from(musicFiles.files || []);

      if (!files.length) return;

      stopMusic();
      bgMusic.removeAttribute("src");
      bgMusic.load();

      for (const url of musicURLs) URL.revokeObjectURL(url);
      musicURLs.clear();

      musicSelect.replaceChildren(
        new Option("Trilha padrão — YouTube", "youtube:huXVnd-QnNs"),
        new Option("Sem trilha sonora", "")
      );

      let firstLocalURL = "";
      for (const file of files) {
        const url = URL.createObjectURL(file);
        if (!firstLocalURL) firstLocalURL = url;
        musicURLs.add(url);
        musicSelect.add(new Option(file.name, url));
      }

      musicSelect.value = firstLocalURL;
      selectMusic();

      // Permite selecionar novamente os mesmos arquivos.
      musicFiles.value = "";
    });

    musicSelect.addEventListener("change", () => { selectMusic(); savePreferences(); });

    musicEnabled.addEventListener("change", () => {
      savePreferences();
      if (musicEnabled.checked && active) {
        startMusic();
      } else {
        stopMusic();
      }
    });
    selectMusic();

    bgMusic.addEventListener("error", () => {
      if (!musicSelect.value) return;

      musicStatus.textContent =
        "Arquivo indisponível ou formato não suportado. Escolha outra música.";
    });


    // ============================================================
    // CONTROLES TOUCH
    // ============================================================

    const touchEnabled = $("touchEnabled");
    const touchControls = $("touchControls");
    const flightMenu = $("flightMenu");

    const movePad = $("movePad");
    const moveKnob = $("moveKnob");
    const aimPad = $("aimPad");

    // Mantém entradas de toque separadas do teclado.
    const moveKeys = new Set();
    const heldTouchKeys = new Map();
    const touchResetters = [];

    function inputDown(code) {
      if (keys.has(code) || moveKeys.has(code)) return true;

      for (const heldCode of heldTouchKeys.values()) {
        if (heldCode === code) return true;
      }

      return false;
    }

    function clearTouchInput() {
      moveKeys.clear();
      heldTouchKeys.clear();

      for (const resetControl of touchResetters) {
        resetControl();
      }
    }

    function syncControlUI() {
      const enabled = touchEnabled.checked;

      document.body.classList.toggle("touch-ui", enabled);

      touchControls.hidden = !active || !enabled;
      flightMenu.hidden = !active;
    }

    touchEnabled.checked = typeof preferences.touch === "boolean" ? preferences.touch : TOUCH_DEVICE;

    touchEnabled.addEventListener("change", () => {
      clearTouchInput();
      syncControlUI();
      savePreferences();
    });

    flightMenu.addEventListener("click", () => {
      if (active) pause();
    });

    function releaseCapture(element, pointerId) {
      if (
        pointerId !== null &&
        element.hasPointerCapture(pointerId)
      ) {
        element.releasePointerCapture(pointerId);
      }
    }


    // ------------------------------------------------------------
    // Direcional esquerdo
    // ------------------------------------------------------------

    let movePointer = null;

    function updateMovePad(event) {
      const rect = movePad.getBoundingClientRect();

      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const radius = rect.width * 0.32;

      let x = (event.clientX - centerX) / radius;
      let y = (event.clientY - centerY) / radius;

      const length = Math.hypot(x, y);

      if (length > 1) {
        x /= length;
        y /= length;
      }

      moveKnob.style.transform =
        `translate(${x * radius}px, ${y * radius}px)`;

      moveKeys.clear();

      const deadZone = 0.2;

      if (x < -deadZone) moveKeys.add("KeyA");
      if (x > deadZone) moveKeys.add("KeyD");

      if (y < -deadZone) moveKeys.add("KeyW");
      if (y > deadZone) moveKeys.add("KeyS");
    }

    function resetMovePad() {
      const pointerId = movePointer;
      movePointer = null;

      moveKeys.clear();
      moveKnob.style.transform = "translate(0, 0)";

      releaseCapture(movePad, pointerId);
    }

    touchResetters.push(resetMovePad);

    movePad.addEventListener("pointerdown", event => {
      if (!active || movePointer !== null || event.button !== 0) return;

      event.preventDefault();

      movePointer = event.pointerId;
      movePad.setPointerCapture(event.pointerId);
      updateMovePad(event);
    });

    movePad.addEventListener("pointermove", event => {
      if (event.pointerId !== movePointer || !active) return;

      event.preventDefault();
      updateMovePad(event);
    });

    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      movePad.addEventListener(type, event => {
        if (event.pointerId === movePointer) resetMovePad();
      });
    }


    // ------------------------------------------------------------
    // Área direita: arraste para mirar
    // ------------------------------------------------------------

    let aimPointer = null;
    let aimX = 0;
    let aimY = 0;

    function resetAimPad() {
      const pointerId = aimPointer;
      aimPointer = null;

      releaseCapture(aimPad, pointerId);
    }

    touchResetters.push(resetAimPad);

    aimPad.addEventListener("pointerdown", event => {
      if (!active || aimPointer !== null || event.button !== 0) return;

      event.preventDefault();

      aimPointer = event.pointerId;
      aimX = event.clientX;
      aimY = event.clientY;

      aimPad.setPointerCapture(event.pointerId);
    });

    aimPad.addEventListener("pointermove", event => {
      if (event.pointerId !== aimPointer || !active) return;

      event.preventDefault();

      const dx = event.clientX - aimX;
      const dy = event.clientY - aimY;

      aimX = event.clientX;
      aimY = event.clientY;

      const sensitivity = 0.006 * aimSensitivity();

      yaw -= dx * sensitivity;
      pitch -= dy * sensitivity;
      pitch = clamp(pitch, -1.48, 1.48);
    });

    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      aimPad.addEventListener(type, event => {
        if (event.pointerId === aimPointer) resetAimPad();
      });
    }


    // ------------------------------------------------------------
    // Botões que permanecem ativos enquanto pressionados
    // ------------------------------------------------------------

    function bindHoldButton(id, code) {
      const button = $(id);
      const pointers = new Set();

      function refreshPressed() {
        button.classList.toggle("pressed", pointers.size > 0);
      }

      function release(event) {
        if (!pointers.delete(event.pointerId)) return;

        heldTouchKeys.delete(event.pointerId);
        releaseCapture(button, event.pointerId);
        refreshPressed();
      }

      button.addEventListener("pointerdown", event => {
        if (!active || event.button !== 0) return;

        event.preventDefault();

        pointers.add(event.pointerId);
        heldTouchKeys.set(event.pointerId, code);

        button.setPointerCapture(event.pointerId);
        refreshPressed();
      });

      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
        button.addEventListener(type, release);
      }

      touchResetters.push(() => {
        const previousPointers = Array.from(pointers);

        pointers.clear();
        refreshPressed();

        for (const pointerId of previousPointers) {
          heldTouchKeys.delete(pointerId);
          releaseCapture(button, pointerId);
        }
      });
    }

    bindHoldButton("touchUp", "Space");
    bindHoldButton("touchDown", "ControlLeft");
    bindHoldButton("touchBoost", "ShiftLeft");
    bindHoldButton("touchFire", "KeyJ");

    $("touchWarp").addEventListener("click", () => {
      if (!active || charge < 100 || warpTimer > 0 || fuel <= 0) return;

      warpTimer = 2.4;
      charge = 0;
    });

    $("touchBomb").addEventListener("click", launchBomb);
    $("touchView").addEventListener("click", toggleView);

    touchControls.addEventListener("contextmenu", event => {
      event.preventDefault();
    });

    window.addEventListener("resize", clearTouchInput);

    syncControlUI();


    // ============================================================
    // INPUT, PAUSA E REINÍCIO
    // ============================================================

    const gamepadStatus = $("gamepadStatus");

    function setGamepadStatus(message) {
      gamepadStatus.textContent = `Joypad: ${message}`;
    }

    function gamepadButtonPressed(gamepad, index, threshold = .5) {
      const button = gamepad.buttons[index];
      return Boolean(button && (button.pressed || button.value > threshold));
    }

    function gamepadButtonDownOnce(gamepad, index) {
      const pressed = gamepadButtonPressed(gamepad, index);
      const wasPressed = Boolean(gamepadInput.previousButtons[index]);
      gamepadInput.previousButtons[index] = pressed;
      return pressed && !wasPressed;
    }

    function findActiveGamepad() {
      if (!navigator.getGamepads) return null;

      const pads = navigator.getGamepads();

      if (gamepadInput.index >= 0 && pads[gamepadInput.index]) {
        return pads[gamepadInput.index];
      }

      return Array.from(pads).find(Boolean) || null;
    }

    function pollGamepad() {
      const gamepad = findActiveGamepad();

      if (!gamepad) {
        if (gamepadInput.connected) {
          clearGamepadInput(false);
          setGamepadStatus("desconectado.");
        }
        return;
      }

      if (!gamepadInput.connected || gamepadInput.index !== gamepad.index) {
        clearGamepadInput();
        gamepadInput.connected = true;
        gamepadInput.index = gamepad.index;
        setGamepadStatus(`conectado — ${gamepad.id}`);
      }

      // Analógico esquerdo: mirar. Analógico direito: movimentar.
      gamepadInput.aimX = normalizeGamepadAxis(gamepad.axes[0] || 0);
      gamepadInput.aimY = normalizeGamepadAxis(gamepad.axes[1] || 0);
      gamepadInput.moveX = normalizeGamepadAxis(gamepad.axes[2] || 0);
      gamepadInput.moveY = normalizeGamepadAxis(gamepad.axes[3] || 0);

      // Xbox padrão: A/RB atirar, B bomba, X descer, LT turbo, RT avançar.
      gamepadInput.up = false;
      gamepadInput.down = gamepadButtonPressed(gamepad, 2);
      gamepadInput.boost = gamepadButtonPressed(gamepad, 6, .12);
      gamepadInput.forward = gamepadButtonPressed(gamepad, 7, .12);
      gamepadInput.fire =
        gamepadButtonPressed(gamepad, 0) ||
        gamepadButtonPressed(gamepad, 5);

      const bombPressed = gamepadButtonDownOnce(gamepad, 1);
      const viewPressed = gamepadButtonDownOnce(gamepad, 3);
      const warpPressed = gamepadButtonDownOnce(gamepad, 4);
      const resetPressed = gamepadButtonDownOnce(gamepad, 8);
      const menuPressed = gamepadButtonDownOnce(gamepad, 9);

      if (menuPressed) {
        if (started && !dead) {
          active ? pause() : play();
        } else {
          play();
        }
        return;
      }

      if (resetPressed && restartPending) {
        reset();
        play();
        return;
      }
      if (!active) return;

      if (bombPressed) launchBomb();
      if (viewPressed) toggleView();

      if (warpPressed && charge >= 100 && warpTimer <= 0 && fuel > 0) {
        warpTimer = 2.4;
        charge = 0;
      }

      if (resetPressed) requestRestart();
    }

    window.addEventListener("gamepadconnected", event => {
      gamepadInput.connected = true;
      gamepadInput.index = event.gamepad.index;
      clearGamepadInput();
      setGamepadStatus(`conectado — ${event.gamepad.id}`);
    });

    window.addEventListener("gamepaddisconnected", event => {
      if (event.gamepad.index !== gamepadInput.index) return;
      clearGamepadInput(false);
      setGamepadStatus("desconectado.");
    });

    function requestMouse() {
      if (touchEnabled.checked) return;

      try {
        const result = renderer.domElement.requestPointerLock?.();
        result?.catch?.(() => {
          ui.status.textContent = "Mouse indisponível: use as setas para mirar.";
        });
      } catch {
        ui.status.textContent = "Use as setas para mirar.";
      }
    }

    function play() {
      if (dead || !started) reset();

      restartPending = false;

      wakeAudio();

      started = true;
      active = true;

      ui.overlay.style.display = "none";

      syncControlUI();
      startMusic();

      // Não captura o mouse ao iniciar pelo joypad ou pela interface touch.
      if (!touchEnabled.checked && !gamepadInput.connected) {
        requestMouse();
      }
    }

    function pause() {
      active = false;
      if (score > record) {
        record = score;
        settings.best.textContent = `RECORDE // ${String(record).padStart(6, "0")} PTS`;
        savePreferences();
      }
      mouseDown = false;

      keys.clear();
      clearTouchInput();

      stopMusic();
      syncControlUI();

      ui.overlay.style.display = "flex";

      ui.title.innerHTML = dead
        ? "SINAL<br><em>PERDIDO.</em>"
        : "MISSÃO<br><em>PAUSADA.</em>";

      ui.description.textContent = dead
        ? `Interceptador destruído. Pontuação: ${score}. Reinicie para voltar ao combate.`
        : "Sistemas em espera. Você pode trocar a trilha sonora e ajustar os controles.";

      ui.start.textContent = dead
        ? "REINICIAR MISSÃO"
        : "CONTINUAR MISSÃO";

      ui.status.textContent = touchEnabled.checked
        ? "Use o direcional para mover e arraste na área direita para mirar."
        : "Mouse ou setas para orientar a nave.";

      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
      }

      ui.start.focus({ preventScroll: true });
    }

    function requestRestart() {
      if (!started || dead || !active) {
        reset();
        play();
        return;
      }
      pause();
      ui.description.textContent = "Missão pausada. Pressione R ou o botão 8 do joypad novamente para confirmar o reinício, ou continue para manter o progresso.";
      restartPending = true;
    }
    let restartPending = false;

    function reset() {
      restartPending = false;
      missionDifficulty = settings.difficulty.value;
      if (score > record) {
        record = score;
        settings.best.textContent = `RECORDE // ${String(record).padStart(6, "0")} PTS`;
        savePreferences();
      }
      clearTouchInput();

      score = 0;
      shield = 100;
      heat = 0;
      charge = 100;
      fuel = 100;
      bombCount = CONFIG.maxBombs;
      bombCooldown = 0;
      bombRefillTimer = 0;
      refuelActive = false;
      warpTimer = 0;
      warpVisual = 0;
      damage = 0;
      hitTimer = 0;
      fireCooldown = 0;
      sinceDamage = 10;
      overheated = false;
      dead = false;
      yaw = pitch = 0;

      keys.clear();
      mouseDown = false;
      velocity.set(0, 0, 0);
      galacticOrigin.set(0, 0, 0);
      camera.position.set(0, 0, 40);
      camera.quaternion.identity();
      camera.fov = 72;
      camera.updateProjectionMatrix();
      cockpit.position.set(0, 0, 0);
      setThirdPerson(false);

      while (bullets.length) removeBullet(bullets.length - 1);
      while (bombs.length) {
        scene.remove(bombs[bombs.length - 1].mesh);
        bombs.pop();
      }
      while (stationExplosions.length) disposeStationExplosion(stationExplosions.pop());
      while (impacts.length) clearImpact(impacts.pop());
      while (defenseBeams.length) clearDefenseBeam(defenseBeams.pop());
      while (distantBattles.length) removeDistantBattle(distantBattles[0]);
      nextDistantBattle = rand(14, 22);
      solidImpactTimes.clear();
      defenseCooldown = 1.4;
      defenseVolley = 0;

      for (const key of Array.from(loadedSectors.keys())) unloadSector(key);
      destroyedWorldObjects.clear();
      currentSectorKey = "";

      // Restaura os marcos do sistema inicial após eventual rebasing.
      planet.position.set(-1050, 270, -2300);
      planet.rotation.y = 0;
      atmosphere.position.copy(planet.position);
      station.position.set(0, 15, -540);
      station.visible = true;
      if (!station.parent) scene.add(station);
      starterStation.destroyed = false;
      starterStation.hp = starterStation.maxHp;
      starterStation.lastWarning = 100;

      particleLives.fill(0);
      particleColors.fill(0);
      particleGeo.attributes.life.needsUpdate = true;
      particleGeo.attributes.color.needsUpdate = true;

      drones.forEach((drone, i) => placeDrone(drone, true, i));
      allies.forEach(ally => {
        ally.active = false;
        ally.group.visible = false;
        ally.hp = ally.maxHp;
        ally.respawn = 0;
      });
      allySpawnTimer = rand(9, 15);
      boss.visible = false;
      boss.group.visible = false;
      boss.hp = Math.round(CONFIG.bossHp * difficultyScale());
      boss.respawn = rand(34, 48) / difficultyScale();
      mothership.visible = false;
      mothership.group.visible = false;
      mothership.hp = Math.round(CONFIG.mothershipHp * difficultyScale());
      mothership.respawn = rand(65, 82) / difficultyScale();
      resetCivilization();
      eventTimer = 4;
      nextAmbientMessage = rand(5, 8);
      queueEvent("COMANDO // CANAL TÁTICO CONECTADO");
      refreshSectors(true);
    }

    ui.start.addEventListener("click", play);

    const handledKeys = new Set([
      "Space", "ControlLeft", "ControlRight",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "KeyW", "KeyA", "KeyS", "KeyD", "KeyJ", "KeyB", "KeyV",
      "KeyF", "KeyP", "KeyR", "ShiftLeft", "ShiftRight"
    ]);

    document.addEventListener("keydown", event => {
      const editingControl = event.target instanceof Element &&
        event.target.closest(
          "input, select, textarea, button, audio, [contenteditable]"
        );

      if (editingControl && !(event.code === "KeyR" && restartPending && event.target === ui.start)) return;

      if (handledKeys.has(event.code)) event.preventDefault();

      if (!event.repeat) {
        if (event.code === "KeyP" && started && !dead) {
          active ? pause() : play();
          return;
        }

        if (event.code === "Escape" && active) {
          pause();
          return;
        }

        if (event.code === "KeyR") {
          if (restartPending) { reset(); play(); }
          else requestRestart();
          return;
        }

        if (event.code === "KeyB" && active) {
          launchBomb();
          return;
        }

        if (event.code === "KeyV" && active) {
          toggleView();
          return;
        }

        if (event.code === "KeyF" && active && charge >= 100 && fuel > 0) {
          warpTimer = 2.4;
          charge = 0;
        }
      }

      if (active) keys.add(event.code);
    });

    document.addEventListener("keyup", event => keys.delete(event.code));

    document.addEventListener("mousemove", event => {
      if (!active || document.pointerLockElement !== renderer.domElement) return;

      yaw -= event.movementX * .002 * aimSensitivity();
      pitch -= event.movementY * .002 * aimSensitivity();
      pitch = clamp(pitch, -1.48, 1.48);
    });

    renderer.domElement.addEventListener("mousedown", event => {
      if (!active) return;

      if (event.button === 2) {
        event.preventDefault();
        launchBomb();
        return;
      }

      if (event.button !== 0) return;
      mouseDown = true;

      if (document.pointerLockElement !== renderer.domElement) requestMouse();
    });

    document.addEventListener("mouseup", event => {
      if (event.button === 0) mouseDown = false;
    });

    renderer.domElement.addEventListener("contextmenu", event => event.preventDefault());

    document.addEventListener("pointerlockchange", () => {
      const locked = document.pointerLockElement === renderer.domElement;
      if (hadPointerLock && !locked && active) pause();
      hadPointerLock = locked;
    });

    window.addEventListener("blur", () => {
      if (active) pause();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && active) pause();
    });

    // ============================================================
    // MOVIMENTO E INTELIGÊNCIA DOS DRONES
    // ============================================================

    function updatePlayer(dt) {
      const axis = (positive, negative) =>
        Number(inputDown(positive)) - Number(inputDown(negative));

      yaw += (
        axis("ArrowLeft", "ArrowRight") * 1.45 +
        -gamepadInput.aimX * 1.9
      ) * dt;

      pitch += (
        axis("ArrowUp", "ArrowDown") * 1.25 +
        -gamepadInput.aimY * 1.65
      ) * dt;
      pitch = clamp(pitch, -1.48, 1.48);

      rotation.set(pitch, yaw, 0);
      camera.quaternion.setFromEuler(rotation);

      const boosting =
        inputDown("ShiftLeft") ||
        inputDown("ShiftRight") ||
        gamepadInput.boost;

      const descending =
        inputDown("ControlLeft") ||
        inputDown("ControlRight") ||
        gamepadInput.down;

      const strafeInput = clamp(
        axis("KeyD", "KeyA") + gamepadInput.moveX,
        -1, 1
      );

      const forwardInput = clamp(
        axis("KeyS", "KeyW") + gamepadInput.moveY - Number(gamepadInput.forward),
        -1, 1
      );

      const verticalInput = clamp(
        Number(inputDown("Space")) +
        Number(gamepadInput.up) -
        Number(descending),
        -1, 1
      );

      desiredVelocity.set(
        strafeInput,
        verticalInput,
        forwardInput
      );

      if (desiredVelocity.lengthSq() > 1) desiredVelocity.normalize();

      if (warpTimer > 0) {
        desiredVelocity.set(0, 0, -CONFIG.warpSpeed);
      } else {
        desiredVelocity.multiplyScalar(
          boosting ? CONFIG.boostSpeed : CONFIG.cruiseSpeed
        );
      }

      if (fuel <= 0 && warpTimer <= 0) {
        desiredVelocity.multiplyScalar(.18);
      }

      desiredVelocity.applyQuaternion(camera.quaternion);
      velocity.lerp(desiredVelocity, 1 - Math.exp(-5 * dt));
      const previousPosition = camera.position.clone();
      camera.position.addScaledVector(velocity, dt);
      const solids = collectSolids(previousPosition, camera.position, 6, true);
      const collision = moveAgainstSolids(previousPosition, camera.position, 6, solids);
      camera.position.copy(collision.position);
      for (const { solid, normal } of collision.contacts) {
        const incomingSpeed = Math.max(0, -velocity.dot(normal));
        if (incomingSpeed > 0) velocity.addScaledVector(normal, incomingSpeed);
        if (solid.kind === "ally" || incomingSpeed < 2) continue;
        const key = solid.key.startsWith("mothership:") ? "mothership" : solid.key;
        if (time - (solidImpactTimes.get(key) ?? -Infinity) < .9) continue;
        solidImpactTimes.set(key, time);
        const impact = clamp(8 + incomingSpeed * .11 + solid.radius * .12, 10, 38);
        shield = Math.max(0, shield - impact);
        sinceDamage = 0;
        damage = 1;
        burst(camera.position, 0xff8c62, 28, 20);
        sound("shield");
        if (solid.kind === "asteroid" && solid.source) {
          solid.source.hp--;
          if (solid.source.hp <= 0) destroyAsteroid(solid.source, false);
        }
        if (shield <= 0) { dead = true; pause(); break; }
      }

      const fuelDrain = warpTimer > 0
        ? CONFIG.fuelDrainWarp
        : boosting ? CONFIG.fuelDrainBoost : CONFIG.fuelDrainCruise;
      if (desiredVelocity.lengthSq() > 4) fuel = Math.max(0, fuel - fuelDrain * dt);

      rebaseWorldIfNeeded();
      refreshSectors();

      warpTimer = Math.max(0, warpTimer - dt);
      if (warpTimer === 0) charge = Math.min(100, charge + dt * 10);

      warpVisual = THREE.MathUtils.lerp(
        warpVisual, warpTimer > 0 ? 1 : 0, 1 - Math.exp(-5 * dt)
      );

      const targetFov = warpTimer > 0 ? 105 : boosting ? 83 : 72;
      camera.fov = THREE.MathUtils.lerp(
        camera.fov, targetFov, 1 - Math.exp(-4 * dt)
      );
      camera.updateProjectionMatrix();

      cockpit.rotation.z = THREE.MathUtils.lerp(
        cockpit.rotation.z, -strafeInput * .08,
        1 - Math.exp(-6 * dt)
      );

      cockpit.position.z *= Math.exp(-16 * dt);
      cockpit.position.y = Math.sin(time * 2) * .008;

      if (thirdPerson) {
        const strafe = strafeInput;
        const vertical = verticalInput;
        shipExterior.rotation.z = THREE.MathUtils.lerp(
          shipExterior.rotation.z, -strafe * .24, 1 - Math.exp(-7 * dt)
        );
        shipExterior.rotation.x = THREE.MathUtils.lerp(
          shipExterior.rotation.x, vertical * .08, 1 - Math.exp(-7 * dt)
        );
        shipExterior.position.y = THREE.MathUtils.lerp(
          shipExterior.position.y, -1.15 + Math.sin(time * 3.1) * .025,
          1 - Math.exp(-6 * dt)
        );
      }

      viewNoticeTimer = Math.max(0, viewNoticeTimer - dt);

      fireCooldown = Math.max(0, fireCooldown - dt);
      heat = Math.max(0, heat - dt * 22);
      if (overheated && heat < 30) overheated = false;

      if (mouseDown || inputDown("KeyJ") || gamepadInput.fire) fire();

      sinceDamage += dt;
      if (sinceDamage > 4) shield = Math.min(100, shield + dt * 5);

      damage = Math.max(0, damage - dt * 1.8);
      hitTimer = Math.max(0, hitTimer - dt);
    }

    function updateWorldObjects(dt) {
      refuelActive = false;

      for (let i = worldAsteroids.length - 1; i >= 0; i--) {
        const asteroid = worldAsteroids[i];
        asteroid.mesh.rotation.x += asteroid.spin.x * dt;
        asteroid.mesh.rotation.y += asteroid.spin.y * dt;
        asteroid.mesh.rotation.z += asteroid.spin.z * dt;
      }

      for (const stationEntry of refuelStations) {
        if (stationEntry.destroyed || !stationEntry.group.parent || !stationEntry.group.visible) continue;
        if (!stationEntry.starter) stationEntry.group.rotation.y += dt * .18;

        const range = stationEntry.radius + 18;
        if (stationEntry.group.position.distanceToSquared(camera.position) > range * range) continue;

        refuelActive = true;
        fuel = Math.min(100, fuel + dt * 30);
        shield = Math.min(100, shield + dt * 16);
        charge = Math.min(100, charge + dt * 32);
        heat = Math.max(0, heat - dt * 45);
        bombRefillTimer += dt;

        if (bombCount < CONFIG.maxBombs && bombRefillTimer >= 2.25) {
          bombCount++;
          bombRefillTimer = 0;
        }
      }

      if (!refuelActive) bombRefillTimer = 0;

      for (const body of celestialBodies) {
        body.group.rotation.y += body.spin * dt;
      }
    }

    function chooseEnemyTarget(origin) {
      const availableAllies = allies.filter(ally => ally.active);
      if (availableAllies.length && Math.random() < .48) {
        const ally = availableAllies[Math.floor(Math.random() * availableAllies.length)];
        return { position: ally.group.position, velocity: ally.velocity, type: "ally" };
      }

      const nearbyStations = refuelStations.filter(entry =>
        !entry.destroyed && entry.group.visible && entry.group.parent &&
        entry.group.position.distanceToSquared(origin) < 520 * 520
      );
      if (nearbyStations.length && Math.random() < .18) {
        const target = nearbyStations[Math.floor(Math.random() * nearbyStations.length)];
        return { position: target.group.position, velocity: new V3(), type: "station" };
      }

      return { position: camera.position, velocity, type: "player" };
    }

    function updateDrones(dt) {
      for (const drone of drones) {
        if (!drone.group.visible) {
          drone.respawn -= dt;
          if (drone.respawn <= 0) placeDrone(drone);
          continue;
        }

        const p = drone.group.position;
        const previous = p.clone();
        temp.subVectors(camera.position, p);
        const distance = temp.length();

        if (distance > 950 && warpTimer === 0) {
          placeDrone(drone);
          continue;
        }

        temp.normalize();

        const approach = distance > 115 ? [22, 37, 13][drone.kind] :
          distance < 48 ? -18 : 0;
        p.addScaledVector(temp, approach * dt);

        p.x += Math.cos(time * .65 + drone.phase) * dt * 7;
        p.y += Math.sin(time * .9 + drone.phase) * dt * 5;
        keepActorOutOfWorld(drone.group, previous, drone.kind === 2 ? 7 : 5);

        drone.group.lookAt(camera.position);
        drone.arms.forEach((arm, i) => {
          arm.rotation.z = Math.sin(time * 2.2 + drone.phase + i) * .18;
        });

        drone.core.scale.copy(drone.coreScale)
          .multiplyScalar(1 + Math.sin(time * 5 + drone.phase) * .1);
        drone.engine.rotation.z += dt * 2;

        drone.cooldown -= dt;

        if (drone.cooldown <= 0 && distance < 330 && warpTimer === 0) {
          const target = chooseEnemyTarget(p);
          drone.group.lookAt(target.position);
          const attackDirection = new V3().subVectors(target.position, p).normalize();
          const origin = p.clone().addScaledVector(attackDirection, 4);
          const aim = target.position.clone()
            .addScaledVector(target.velocity, Math.min(distance / 110, 1) * .55)
            .add(new V3(rand(-3, 3), rand(-3, 3), rand(-3, 3)));

          spawnBullet(origin, aim.sub(origin).normalize(), true,
            "drone", drone.kind === 2 ? 10 : drone.kind === 1 ? 6 : 9);
          drone.cooldown = rand(1.9, 3.6) / difficultyScale() *
            [1, .7, 1.25][drone.kind];
        }
      }
    }

    function spawnAlliedSquadron() {
      const ready = allies.filter(ally => !ally.active && ally.respawn <= 0);
      if (!ready.length) return;

      for (let i = 0; i < ready.length; i++) {
        const ally = ready[i];
        const column = ally.index % 3 - 1;
        const row = Math.floor(ally.index / 3);
        const local = new V3(column * 62, 14 + row * 44, 105 + row * 45 + i * 2)
          .applyQuaternion(camera.quaternion)
          .add(camera.position);

        ally.group.position.copy(local);
        ally.group.quaternion.copy(camera.quaternion);
        ally.group.visible = true;
        ally.active = true;
        ally.hp = ally.maxHp;
        ally.cooldown = rand(.2, .75);
        ally.velocity.copy(velocity);
      }

      queueEvent(`COMANDO // ${ready.length} NAVES ALIADAS ENTRARAM NO SETOR`, "ally");
      allySpawnTimer = 8;
    }

    function destroyAlly(ally) {
      if (!ally.active) return;
      sound("blast", ally.group.position);
      burst(ally.group.position, 0x59ffc0, 95, 48);
      burst(ally.group.position, 0xffa451, 70, 38);
      ally.active = false;
      ally.group.visible = false;
      ally.respawn = rand(20, 32);
      queueEvent(`COMANDO // ALIADO ${ally.index + 1} ABATIDO · REFORÇO SOLICITADO`, "alert");
    }

    function getClosestDrone(position) {
      let selected = null;
      let bestDistance = Infinity;

      for (const drone of drones) {
        if (!drone.group.visible) continue;
        const distance = drone.group.position.distanceToSquared(position);
        if (distance < bestDistance) {
          bestDistance = distance;
          selected = drone;
        }
      }

      return selected;
    }

    function updateAllies(dt) {
      allySpawnTimer -= dt;
      for (const ally of allies) {
        if (!ally.active) ally.respawn = Math.max(0, ally.respawn - dt);
      }

      if (allySpawnTimer <= 0 && allies.some(ally => !ally.active && ally.respawn <= 0)) {
        spawnAlliedSquadron();
      }

      for (const ally of allies) {
        if (!ally.active) continue;

        const droneTarget = getClosestDrone(ally.group.position);
        let targetPosition = mothership.visible
          ? mothership.group.position
          : boss.visible ? boss.group.position
          : droneTarget?.group.position;
        const attackTarget = targetPosition;

        if (ally.group.position.distanceToSquared(camera.position) > 700 * 700) {
          targetPosition = null;
        }

        if (!targetPosition) {
          const escort = new V3(
            (ally.index % 3 - 1) * 55,
            14 + Math.floor(ally.index / 3) * 42 + Math.sin(time + ally.phase) * 4,
            95 + Math.floor(ally.index / 3) * 45
          ).applyQuaternion(camera.quaternion).add(camera.position);
          temp.subVectors(escort, ally.group.position);
          ally.velocity.lerp(temp.clampLength(0, 230), 1 - Math.exp(-2.4 * dt));
        } else {
          const offset = new V3(
            (ally.index % 3 - 1) * 48,
            (Math.floor(ally.index / 3) - .5) * 50,
            0
          ).applyQuaternion(camera.quaternion);
          targetPosition = targetPosition.clone().add(offset);
          temp.subVectors(targetPosition, ally.group.position);
          const distance = temp.length();
          const desiredSpeed = distance > 190 ? 95 : distance < 95 ? -34 : 18;
          temp.normalize().multiplyScalar(desiredSpeed);
          temp.x += Math.sin(time * 1.7 + ally.phase) * 18;
          ally.velocity.lerp(temp, 1 - Math.exp(-2.8 * dt));
          ally.group.lookAt(attackTarget);

          ally.cooldown -= dt;
          if (ally.cooldown <= 0 && distance < 390) {
            const direction = new V3().subVectors(attackTarget, ally.group.position).normalize();
            const origin = ally.group.position.clone().addScaledVector(direction, 4);
            spawnBullet(origin, direction, false, "ally", 1);
            ally.cooldown = rand(.34, .58);
          }
        }

        const previous = ally.group.position.clone();
        for (const other of allies) {
          if (other === ally || !other.active) continue;
          const away = new V3().subVectors(ally.group.position, other.group.position);
          const distance = away.length();
          if (distance > .001 && distance < 48) {
            ally.velocity.addScaledVector(away, (48 - distance) / distance * dt * 2);
          }
        }
        ally.group.position.addScaledVector(ally.velocity, dt);
        keepActorOutOfWorld(ally.group, previous, 6);
        ally.group.rotation.z = Math.sin(time * 2.2 + ally.phase) * .08;
      }
    }

    function spawnBoss() {
      const local = new V3(rand(-80, 80), rand(25, 70), -rand(390, 480))
        .applyQuaternion(camera.quaternion)
        .add(camera.position);

      boss.group.position.copy(local);
      boss.group.visible = true;
      boss.visible = true;
      boss.hp = Math.round(CONFIG.bossHp * difficultyScale());
      boss.cooldown = 2.2;
      queueEvent("ALERTA MÁXIMO // NAVE-CHEFÃ ENTROU NO SETOR", "alert");
    }

    function destroyBoss() {
      if (!boss.visible) return;
      spawnImpact(boss.group.position, 175, 0xff627d);
      burst(boss.group.position, 0xff3f62, 260, 110);
      burst(boss.group.position, 0xb64dff, 190, 85);
      boss.visible = false;
      boss.group.visible = false;
      boss.respawn = rand(70, 105) / difficultyScale();
      score += 3000;
      affectCivilization({ stability: 5, economy: 2 }, "AURORA // VITÓRIA ELEVA A CONFIANÇA DA COLÔNIA");
      sound("bomb", boss.group.position);
      queueEvent("COMANDO // NAVE-CHEFÃ DESTRUÍDA · +3000 PTS", "ally");
    }

    function updateBoss(dt) {
      if (!boss.visible) {
        boss.respawn -= dt;
        if (boss.respawn <= 0) spawnBoss();
        return;
      }

      temp.subVectors(camera.position, boss.group.position);
      const distance = temp.length();

      if (distance > 1250 && warpTimer === 0) {
        boss.visible = false;
        boss.group.visible = false;
        boss.respawn = rand(18, 28) / difficultyScale();
        queueEvent("SENSORES // NAVE-CHEFÃ SAIU DO ALCANCE", "alert");
        return;
      }

      temp.normalize();
      const previous = boss.group.position.clone();
      const approach = distance > 270 ? 31 : distance < 185 ? -20 : 0;
      boss.group.position.addScaledVector(temp, approach * dt);
      boss.group.position.x += Math.sin(time * .42 + boss.phase) * dt * 13;
      boss.group.position.y += Math.cos(time * .55 + boss.phase) * dt * 8;
      keepActorOutOfWorld(boss.group, previous, 19);
      boss.group.lookAt(camera.position);
      boss.core.scale.set(.9 + Math.sin(time * 4.2) * .07, .9 + Math.sin(time * 4.2) * .07, .5);

      boss.cooldown -= dt;
      if (boss.cooldown <= 0 && distance < 620 && warpTimer === 0) {
        const target = chooseEnemyTarget(boss.group.position);
        for (let i = -1; i <= 1; i++) {
          const origin = boss.group.position.clone();
          const aim = target.position.clone()
            .addScaledVector(target.velocity, Math.min(distance / 170, 1) * .6)
            .add(new V3(i * 8, rand(-5, 5), rand(-3, 3)));
          spawnBullet(origin, aim.sub(origin).normalize(), true, "boss", 14);
        }
        boss.cooldown = rand(1.35, 2.15);
      }
    }

    function spawnMothership() {
      const local = new V3(rand(-130, 130), rand(80, 150), -rand(620, 760))
        .applyQuaternion(camera.quaternion)
        .add(camera.position);
      mothership.group.position.copy(local);
      mothership.group.visible = true;
      mothership.visible = true;
      mothership.hp = Math.round(CONFIG.mothershipHp * difficultyScale());
      mothership.cooldown = 1.8;
      mothership.barrageCooldown = 4.2;
      mothership.salvo = 0;
      defenseVolley = 0;
      queueEvent("ALERTA VERMELHO // NAVE-MÃE INIMIGA EM APROXIMAÇÃO", "alert");
    }

    function destroyMothership() {
      if (!mothership.visible) return;
      spawnImpact(mothership.group.position, 265, 0xe18bff);
      burst(mothership.group.position, 0xff315f, 360, 145);
      burst(mothership.group.position, 0xb847ff, 320, 120);
      burst(mothership.group.position, 0x55ddff, 240, 90);
      mothership.visible = false;
      mothership.group.visible = false;
      mothership.respawn = rand(240, 320) / difficultyScale();
      score += 8000;
      affectCivilization({ stability: 12, economy: 4, trade: 5 }, "AURORA // NAVE-MÃE DESTRUÍDA · ROTAS COMERCIAIS REABERTAS");
      sound("bomb", mothership.group.position);
      queueEvent("COMANDO // NAVE-MÃE DESTRUÍDA · +8000 PTS", "ally");
    }

    function updateMothership(dt) {
      if (!mothership.visible) {
        mothership.respawn -= dt;
        if (mothership.respawn <= 0) spawnMothership();
        return;
      }

      temp.subVectors(camera.position, mothership.group.position);
      let distance = temp.length();

      if (distance > 1550 && warpTimer <= 0) {
        const intercept = new V3(0, 120, -720)
          .applyQuaternion(camera.quaternion)
          .add(camera.position);
        mothership.group.position.copy(intercept);
        distance = 720;
        queueEvent("ALERTA // NAVE-MÃE INTERCEPTOU A ROTA DE FUGA", "alert");
      }

      temp.normalize();
      const previous = mothership.group.position.clone();
      const approach = distance > 560 ? 24 : distance < 430 ? -13 : 0;
      mothership.group.position.addScaledVector(temp, approach * dt);
      mothership.group.position.x += Math.sin(time * .22 + mothership.phase) * dt * 11;
      mothership.group.position.y += Math.cos(time * .28 + mothership.phase) * dt * 6;
      keepActorOutOfWorld(mothership.group, previous, 145);
      mothership.group.lookAt(camera.position);
      mothership.commandRing.rotation.z += dt * .55;
      const pulse = 1.5 + Math.sin(time * 3.5) * .14;
      mothership.core.scale.set(pulse, .65, pulse);

      mothership.cooldown -= dt;
      mothership.barrageCooldown -= dt;

      if (mothership.cooldown <= 0 && distance < 850 && warpTimer === 0) {
        const target = chooseEnemyTarget(mothership.group.position);
        mothership.group.updateMatrixWorld(true);

        for (let i = 0; i < 4; i++) {
          const turretIndex = (mothership.salvo * 2 + i * 2) % mothership.turrets.length;
          const origin = mothership.turrets[turretIndex].localToWorld(new V3(0, .2, 2.1));
          const aim = target.position.clone()
            .addScaledVector(target.velocity, Math.min(distance / 210, 1) * .7)
            .add(new V3(rand(-14, 14), rand(-10, 10), rand(-8, 8)));
          spawnBullet(origin, aim.sub(origin).normalize(), true, "mothership", 8, 138);
        }

        mothership.salvo++;
        mothership.cooldown = rand(.72, 1.05);
      }

      if (mothership.barrageCooldown <= 0 && distance < 760 && warpTimer === 0) {
        const target = chooseEnemyTarget(mothership.group.position);
        const origin = mothership.group.position.clone();
        const base = new V3().subVectors(target.position, origin).normalize();
        const right = new V3().crossVectors(base, UP_AXIS);
        if (right.lengthSq() < .01) right.set(1, 0, 0);
        right.normalize();
        const up = new V3().crossVectors(right, base).normalize();

        for (let i = 0; i < 12; i++) {
          const angle = i / 12 * Math.PI * 2;
          const direction = base.clone()
            .addScaledVector(right, Math.cos(angle) * .2)
            .addScaledVector(up, Math.sin(angle) * .2)
            .normalize();
          spawnBullet(origin, direction, true, "mothership", 7, 102);
        }

        queueEvent("ALERTA // NAVE-MÃE DISPAROU UMA SALVA DE SATURAÇÃO", "alert");
        mothership.barrageCooldown = rand(5.2, 7.1);
      }
    }

    // ============================================================
    // RADAR E HUD
    // ============================================================

    const radar = $("radar").getContext("2d");
    const inverseQuaternion = new THREE.Quaternion();
    const radarVector = new V3();
    const projected = new V3();

    function updateHUD() {
      if (score > record) {
        record = score;
        settings.best.textContent = `RECORDE // ${String(record).padStart(6, "0")} PTS`;
        savePreferences();
      }
      ui.score.textContent = `${String(score).padStart(6, "0")} PTS`;
      ui.speed.textContent = `${String(Math.round(velocity.length())).padStart(3, "0")} M/S`;
      ui.sector.textContent = `SETOR ${currentSector.x}.${currentSector.y}.${currentSector.z} // ${thirdPerson ? "3ª PESSOA" : "COCKPIT"}`;

      ui.shield.style.transform = `scaleX(${shield / 100})`;
      ui.heat.style.transform = `scaleX(${heat / 100})`;
      ui.warp.style.transform = `scaleX(${charge / 100})`;
      ui.fuel.style.transform = `scaleX(${fuel / 100})`;
      ui.bomb.style.transform = `scaleX(${bombCount / CONFIG.maxBombs})`;

      ui.shieldValue.textContent = `${Math.ceil(shield)}%`;
      ui.heatValue.textContent = `${Math.round(heat)}%`;
      ui.warpValue.textContent = `${Math.floor(charge)}%`;
      ui.fuelValue.textContent = `${Math.ceil(fuel)}%`;
      ui.bombValue.textContent = `${bombCount}/${CONFIG.maxBombs}`;
      updateCivilizationHUD();

      ui.reticle.classList.toggle("hit", hitTimer > 0);

      ui.message.textContent =
        viewNoticeTimer > 0 ? (thirdPerson ? "VISÃO EXTERNA // 3ª PESSOA" : "VISÃO INTERNA // COCKPIT") :
        refuelActive ? "ESTAÇÃO // REABASTECENDO SISTEMAS" :
        warpTimer > 0 ? "HIPERVELOCIDADE // CAMPO ATIVO" :
        fuel <= 8 ? "ALERTA // COMBUSTÍVEL CRÍTICO" :
        overheated ? "ARMAS SUPERAQUECIDAS" :
        shield < 30 ? `PERIGO EXTREMO // BOMBA [ B ] ${bombCount}/${CONFIG.maxBombs}` :
        charge >= 100 ? "SALTO DISPONÍVEL [ F ]" : "RECARREGANDO NÚCLEO";

      ui.message.style.color = overheated || shield < 30 || fuel <= 8 ? "#ff668b" : "#63f7ff";

      radar.clearRect(0, 0, 240, 240);

      radar.fillStyle = "#021320b0";
      radar.beginPath();
      radar.arc(120, 120, 114, 0, Math.PI * 2);
      radar.fill();

      radar.strokeStyle = "#49d7ff38";
      radar.lineWidth = 1;

      for (const radius of [38, 76, 114]) {
        radar.beginPath();
        radar.arc(120, 120, radius, 0, Math.PI * 2);
        radar.stroke();
      }

      radar.beginPath();
      radar.moveTo(6, 120); radar.lineTo(234, 120);
      radar.moveTo(120, 6); radar.lineTo(120, 234);
      radar.stroke();

      radar.strokeStyle = "#60f5ff88";
      radar.beginPath();
      radar.moveTo(120, 120);
      radar.lineTo(
        120 + Math.cos(time * 1.6) * 114,
        120 + Math.sin(time * 1.6) * 114
      );
      radar.stroke();

      inverseQuaternion.copy(camera.quaternion).invert();

      let bestTarget = null;
      let bestScreenDistance = .18;

      for (const drone of drones) {
        if (!drone.group.visible) continue;

        radarVector.subVectors(drone.group.position, camera.position)
          .applyQuaternion(inverseQuaternion);

        let x = radarVector.x * .42;
        let y = radarVector.z * .42;
        const length = Math.hypot(x, y);

        if (length > 108) {
          x *= 108 / length;
          y *= 108 / length;
        }

        radar.fillStyle = radarVector.y > 10 ? "#ffa763" : "#ff4976";
        radar.beginPath();
        radar.arc(120 + x, 120 + y, 3, 0, Math.PI * 2);
        radar.fill();

        if (radarVector.z < 0) {
          projected.copy(drone.group.position).project(camera);
          const distance = projected.x * projected.x + projected.y * projected.y;

          if (projected.z < 1 && distance < bestScreenDistance) {
            bestScreenDistance = distance;
            bestTarget = {
              x: (projected.x * .5 + .5) * innerWidth,
              y: (-projected.y * .5 + .5) * innerHeight,
              distance: camera.position.distanceTo(drone.group.position),
              label: ["SENTINELA", "INTERCEPTOR", "FORTALEZA"][drone.kind]
            };
          }
        }
      }

      if (mothership.visible) {
        radarVector.subVectors(mothership.group.position, camera.position)
          .applyQuaternion(inverseQuaternion);
        let mx = radarVector.x * .42;
        let my = radarVector.z * .42;
        const ml = Math.hypot(mx, my);
        if (ml > 104) { mx *= 104 / ml; my *= 104 / ml; }
        radar.fillStyle = "#ff2f88";
        radar.beginPath();
        radar.arc(120 + mx, 120 + my, 9, 0, Math.PI * 2);
        radar.fill();
        radar.strokeStyle = "#d78aff";
        radar.strokeRect(112 + mx, 112 + my, 16, 16);

        if (radarVector.z < 0) {
          projected.copy(mothership.group.position).project(camera);
          const screenDistance = projected.x * projected.x + projected.y * projected.y;
          if (projected.z < 1 && screenDistance < bestScreenDistance) {
            bestScreenDistance = screenDistance;
            bestTarget = {
              x: (projected.x * .5 + .5) * innerWidth,
              y: (-projected.y * .5 + .5) * innerHeight,
              distance: camera.position.distanceTo(mothership.group.position),
              label: `NAVE-MÃE ${Math.ceil(mothership.hp / Math.round(CONFIG.mothershipHp * difficultyScale()) * 100)}%`
            };
          }
        }
      }

      if (boss.visible) {
        radarVector.subVectors(boss.group.position, camera.position)
          .applyQuaternion(inverseQuaternion);
        let bx = radarVector.x * .42;
        let by = radarVector.z * .42;
        const bl = Math.hypot(bx, by);
        if (bl > 106) { bx *= 106 / bl; by *= 106 / bl; }
        radar.fillStyle = "#d657ff";
        radar.beginPath();
        radar.arc(120 + bx, 120 + by, 6, 0, Math.PI * 2);
        radar.fill();

        if (radarVector.z < 0) {
          projected.copy(boss.group.position).project(camera);
          const screenDistance = projected.x * projected.x + projected.y * projected.y;
          if (projected.z < 1 && screenDistance < bestScreenDistance) {
            bestScreenDistance = screenDistance;
            bestTarget = {
              x: (projected.x * .5 + .5) * innerWidth,
              y: (-projected.y * .5 + .5) * innerHeight,
              distance: camera.position.distanceTo(boss.group.position),
              label: `CHEFÃO ${Math.ceil(boss.hp / Math.round(CONFIG.bossHp * difficultyScale()) * 100)}%`
            };
          }
        }
      }

      for (const ally of allies) {
        if (!ally.active) continue;
        radarVector.subVectors(ally.group.position, camera.position)
          .applyQuaternion(inverseQuaternion);
        let ax = radarVector.x * .42;
        let ay = radarVector.z * .42;
        const al = Math.hypot(ax, ay);
        if (al > 108) { ax *= 108 / al; ay *= 108 / al; }
        radar.fillStyle = "#63f0a8";
        radar.fillRect(117 + ax, 117 + ay, 6, 6);
      }

      for (const stationEntry of refuelStations) {
        if (stationEntry.destroyed || !stationEntry.group.visible || !stationEntry.group.parent) continue;
        radarVector.subVectors(stationEntry.group.position, camera.position)
          .applyQuaternion(inverseQuaternion);
        let sx = radarVector.x * .42;
        let sy = radarVector.z * .42;
        const sl = Math.hypot(sx, sy);
        if (sl > 108) { sx *= 108 / sl; sy *= 108 / sl; }
        radar.fillStyle = "#5dffb0";
        radar.fillRect(118 + sx, 118 + sy, 4, 4);
      }

      for (const battle of distantBattles) {
        radarVector.subVectors(battle.group.position, camera.position)
          .applyQuaternion(inverseQuaternion);
        let ex = radarVector.x * .12;
        let ey = radarVector.z * .12;
        const length = Math.hypot(ex, ey);
        if (length > 106) { ex *= 106 / length; ey *= 106 / length; }
        radar.fillStyle = "#ffbd69";
        radar.beginPath();
        radar.arc(120 + ex, 120 + ey, 5, 0, Math.PI * 2);
        radar.fill();
      }

      radar.fillStyle = "#9bffff";
      radar.beginPath();
      radar.moveTo(120, 112);
      radar.lineTo(115, 127);
      radar.lineTo(125, 127);
      radar.closePath();
      radar.fill();

      ui.target.style.display = bestTarget && active ? "block" : "none";

      if (bestTarget) {
        ui.target.style.left = `${bestTarget.x}px`;
        ui.target.style.top = `${bestTarget.y}px`;
        ui.target.firstElementChild.textContent =
          `${bestTarget.label} / ${Math.round(bestTarget.distance)} M`;
      }
    }

    // ============================================================
    // ANIMAÇÃO E REDIMENSIONAMENTO
    // ============================================================

    function updateEnvironment(dt) {
      sky.position.copy(camera.position);
      stars.position.copy(camera.position);
      sky.material.uniforms.time.value = time;

      planet.rotation.y += dt * .015;
      cloudShell.rotation.y += dt * .007;
      cloudShell.material.uniforms.time.value = time;

      stationRings.forEach((ring, i) => {
        ring.rotation.z += dt * (i % 2 ? -.16 : .12);
      });
      station.rotation.y += dt * .025;
      beaconMaterial.color.setHex(Math.sin(time * 3.5) > 0 ? 0xffa052 : 0x573a30);

      const speedFactor = clamp(velocity.length() / CONFIG.boostSpeed, 0, 1);
      streakMaterial.opacity = speedFactor * .15 + warpVisual * .65;

      for (let i = 0; i < streakCount; i++) {
        const s = streakData[i];
        s.z += dt * (20 + velocity.length() * .85);

        if (s.z > -3) s.z = -240;

        const k = i * 6;
        const length = .3 + speedFactor * 2 + warpVisual * 38;

        streakPositions[k] = s.x;
        streakPositions[k + 1] = s.y;
        streakPositions[k + 2] = s.z;

        streakPositions[k + 3] = s.x;
        streakPositions[k + 4] = s.y;
        streakPositions[k + 5] = s.z - length;
      }

      streakGeo.attributes.position.needsUpdate = true;

      cinematic.uniforms.time.value = time;
      cinematic.uniforms.warp.value = warpVisual;
      cinematic.uniforms.damage.value = damage;
      bloom.strength = (settings.quality.value === "low" ? .45 : 1.0) + warpVisual * .55;
    }

    function applyQuality() {
      const quality = settings.quality.value;
      const ratio = quality === "low" ? .75 : quality === "high"
        ? Math.min(window.devicePixelRatio || 1, 1.5) : CONFIG.pixelRatio;
      renderer.setPixelRatio(ratio);
      renderer.setSize(innerWidth, innerHeight);
      composer.setPixelRatio(ratio);
      composer.setSize(innerWidth, innerHeight);
      starGeo.setDrawRange(0, quality === "low" ? Math.floor(CONFIG.stars * .4) : CONFIG.stars);
      visibleParticleCount = quality === "low" ? Math.max(100, Math.floor(CONFIG.particles * .4)) : CONFIG.particles;
      particleGeo.setDrawRange(0, visibleParticleCount);
      cloudShell.visible = quality !== "low";
      stationDetails.visible = quality !== "low";
      for (const ally of allies) ally.beacon.visible = quality !== "low";
      if (quality !== "high") {
        for (const impact of impacts) {
          if (impact.light) { scene.remove(impact.light); impact.light = null; }
        }
      }
    }
    settings.quality.addEventListener("change", applyQuality);

    window.addEventListener("resize", () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
      composer.setSize(innerWidth, innerHeight);
    });

    renderer.domElement.addEventListener("webglcontextlost", event => {
      event.preventDefault();
      pause();
      ui.status.textContent =
        "O contexto gráfico foi perdido. Recarregue a página para reiniciar.";
      ui.start.disabled = true;
    });

    applyQuality();
    reset();

    window.spaceReady = true;
    ui.start.disabled = false;
    ui.start.textContent = "INICIAR MISSÃO";
    ui.status.textContent = touchEnabled.checked
      ? "Sistemas prontos. Toque em INICIAR MISSÃO para jogar."
      : "Sistemas prontos. Clique para entrar; use as setas se o mouse não for capturado.";

    let lastTime = performance.now();

    function frame(now) {
      requestAnimationFrame(frame);

      // Delta limitado para evitar saltos após travamentos ou troca de aba.
      const dt = Math.min((now - lastTime) / 1000, .033);
      lastTime = now;

      pollGamepad();

      if (active) {
        time += dt;

        updatePlayer(dt);
        updateWorldObjects(dt);
        updateDrones(dt);
        updateAllies(dt);
        updateBoss(dt);
        updateMothership(dt);
        updateDistantBattles(dt);
        updatePlanetDefenses(dt);
        updateBullets(dt);
        updateBombs(dt);
        updateParticles(dt);
        updateStationExplosions(dt);
        updateImpacts(dt);
        updateEnvironment(dt);
        updateCivilization(dt);
        updateMissionEvents(dt);
      } else if (!started) {
        // Cena de apresentação animada sem iniciar o combate.
        time += dt;
        updateEnvironment(dt);
      }

      camera.updateMatrixWorld();
      updateHUD();
      composer.render(dt);
    }

    requestAnimationFrame(frame);
