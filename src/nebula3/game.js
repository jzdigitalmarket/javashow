    import * as THREE from "three";
    import { TOUCH_DEVICE, CONFIG } from "./config.ts";
    import { CombatAudio } from "./combatAudio.ts";
    import { upgradeShipVisuals, upgradeBossVisual } from "./shipModel.ts";
    import { createCapitalShip } from "./capitalShip.ts";
    import { upgradeCapitalShipVisuals, setCapitalShipDetail } from "./capitalShipModel.ts";
    import { createCivilianConvoy } from "./convoy.ts";
    import { createRescueShip } from "./rescueShip.ts";
    import { createGuidedMissile, steerGuidedMissile } from "./guidedMissile.ts";
    import { createParticlePool } from "./particlePool.ts";
    import fluffyPortrait from "./chancellor.webp";
    import perritoPortrait from "./general-perrito.webp";
    import { createLunarMine } from "./lunarMine.ts";
    import { segmentDistanceSquared } from "./collision.ts";
    import { moveAgainstSolids } from "./solidCollision.ts";

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
    let recordDirty = false;
    let lastRecordSave = performance.now();
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
        recordDirty = false;
      } catch { /* Armazenamento indisponível: a partida continua. */ }
      lastRecordSave = performance.now();
    }
    window.addEventListener("beforeunload", () => {
      if (recordDirty) savePreferences();
    });
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
    settings.effects.addEventListener("change", () => {
      if (settings.effects.checked) wakeAudio();
      else combatAudio.stopSiren();
    });

    const ui = {
      overlay: $("overlay"), title: $("title"), description: $("description"),
      start: $("start"), status: $("status"), message: $("message"),
      eventFeed: $("eventFeed"), chancellorCall: $("chancellorCall"),
      chancellorText: $("chancellorText"),
      chancellorPortrait: $("chancellorPortrait"),
      chancellorSpeaker: $("chancellorSpeaker"),
      chancellorChannel: $("chancellorChannel"),
      civTitle: $("civTitle"), civPopulation: $("civPopulation"),
      civGovernment: $("civGovernment"), civEconomy: $("civEconomy"),
      civTrade: $("civTrade"), civCulture: $("civCulture"),
      civTechnology: $("civTechnology"), civStability: $("civStability"),
      score: $("score"), speed: $("speed"), sector: $("sector"),
      missileValue: $("missileValue"),
      shield: $("shieldBar"), heat: $("heatBar"), warp: $("warpBar"),
      fuel: $("fuelBar"), bomb: $("bombBar"),
      shieldValue: $("shieldValue"), heatValue: $("heatValue"),
      warpValue: $("warpValue"), fuelValue: $("fuelValue"), bombValue: $("bombValue"),
      reticle: $("reticle"), target: $("target"), convoyTag: $("convoyTag")
    };
    settings.difficulty.addEventListener("change", () => {
      if (started) ui.status.textContent =
        "Dificuldade selecionada. Ela será aplicada ao reiniciar a missão.";
    });

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

    let composer = null;
    let bloom = null;
    let cinematic = null;
    let postprocessingLoading = null;

    function requestPostprocessing() {
      if (composer || postprocessingLoading) return;
      postprocessingLoading = import("./postprocessing.ts")
        .then(({ createPostprocessing }) => {
          ({ composer, bloom, cinematic } = createPostprocessing(
            renderer, scene, camera, innerWidth, innerHeight
          ));
          applyQuality();
        })
        .catch(error => {
          postprocessingLoading = null;
          console.warn("Pós-processamento indisponível; renderização direta ativa.", error);
        });
    }

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
            gl_FragColor = vec4(.08, .48, 1., rim * .325);
          }
        `
      })
    );
    atmosphere.position.copy(planet.position);
    scene.add(atmosphere);

    // Satélites geoestacionários: filhos do planeta, acompanham sua rotação.
    const satelliteMetal = new THREE.MeshStandardMaterial({
      color: 0xb2c3cc, metalness: .78, roughness: .35
    });
    const solarPanel = new THREE.MeshStandardMaterial({
      color: 0x245578, metalness: .48, roughness: .3, side: THREE.DoubleSide
    });
    const satellites = [];
    for (let i = 0; i < 5; i++) {
      const longitude = i * Math.PI * 2 / 5;
      const latitude = [-.35, .18, .44, -.12, .31][i];
      const radial = new V3(
        Math.cos(latitude) * Math.cos(longitude),
        Math.sin(latitude),
        Math.cos(latitude) * Math.sin(longitude)
      );
      const craft = new THREE.Group();
      craft.position.copy(radial).multiplyScalar(735);
      craft.quaternion.setFromUnitVectors(UP_AXIS, radial);
      mesh(boxGeo, satelliteMetal, craft, [0, 0, 0], [9, 15, 9]);
      mesh(boxGeo, solarPanel, craft, [-19, 0, 0], [24, .6, 13]);
      mesh(boxGeo, solarPanel, craft, [19, 0, 0], [24, .6, 13]);
      mesh(ballGeo, cyan, craft, [0, 9, 0], [2.5, 2.5, 2.5]);
      const dish = mesh(ballGeo, satelliteMetal, craft, [0, -10, 0], [6, 2, 6]);
      dish.rotation.z = .22;
      planet.add(craft);
      craft.userData.integrity = 36;
      satellites.push(craft);
    }

    // Três luas mineradas; a produção só chega à colônia por cargueiro.
    const moonRock = new THREE.MeshStandardMaterial({
      color: 0x888999, roughness: .92, metalness: .08, flatShading: true
    });
    const moons = [];
    let miningReadyNotified = false;
    for (let i = 0; i < 3; i++) {
      const orbit = new THREE.Group();
      orbit.rotation.set([.16, -.22, .31][i], [.4, 2.5, 4.3][i], 0);
      planet.add(orbit);
      const moon = new THREE.Group();
      const radius = [83, 62, 48][i];
      moon.position.set([1090, 1470, 1840][i], [-70, 95, -125][i], 0);
      orbit.add(moon);
      mesh(ballGeo, moonRock, moon, [0, 0, 0], [radius, radius * .94, radius]);
      const equipment = createLunarMine(moon, radius);
      moons.push({ orbit, moon, radius, ...equipment,
        phase: i * 2.7, ore: 1000, cargo: 0,
        mineIntegrity: 100, defenseCooldown: 1 + i * .3,
        defenseAnnounced: false });
    }

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
    const stationSupply = new Map();
    const celestialBodies = [];
    const loadedSectors = new Map();
    const destroyedWorldObjects = new Set();
    const galacticOrigin = new V3();
    const galacticCamera = new V3();
    let currentSectorKey = "";
    let currentSector = { x: 0, y: 0, z: 0 };
    let refuelActive = false;
    let nearbyStationSupply = null;
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
      supply: 70,
      maxSupply: 100,
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
        supply: stationSupply.get(id) ?? 55,
        maxSupply: 100,
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
        stationSupply.set(stationEntry.id, stationEntry.supply);
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
      for (const missile of guidedMissiles) missile.group.position.sub(shift);
      for (const explosion of stationExplosions) {
        for (const shock of explosion.shocks) shock.mesh.position.sub(shift);
        for (const fragment of explosion.debris) fragment.mesh.position.sub(shift);
      }
      for (const impact of impacts) {
        impact.ring.position.sub(shift);
        if (impact.light) impact.light.position.sub(shift);
      }
      for (const beam of defenseBeams) beam.mesh.position.sub(shift);
      for (const beam of alliedBeams) beam.mesh.position.sub(shift);
      for (const battle of distantBattles) battle.group.position.sub(shift);
      if (convoy) {
        convoy.group.position.sub(shift);
        convoy.destination.sub(shift);
      }
      if (rescueShip) {
        rescueShip.group.position.sub(shift);
        rescueShip.beam.position.sub(shift);
      }

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
    const turboStreakCount = 180;
    let turboStreaks = false;
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

    const particlePool = createParticlePool(CONFIG.particles);
    const particlePositions = particlePool.positions;
    const particleColors = particlePool.colors;
    const particleLives = particlePool.lives;

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
      particlePool.burst(position, hex, count, force, visibleParticleCount, rand);
    }

    function updateParticles(dt) {
      particlePool.update(dt, visibleParticleCount);
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
    let lastSupersonicAlert = -100;

    const interceptorHull = new THREE.ConeGeometry(1, 3.8, 3);
    const fortressHull = new THREE.OctahedronGeometry(1, 0);
    const interceptorArmor = new THREE.MeshStandardMaterial({
      color: 0x8b3147, metalness: .76, roughness: .34
    });
    const fortressArmor = new THREE.MeshStandardMaterial({
      color: 0x584575, metalness: .82, roughness: .46
    });
    const sonicArmor = new THREE.MeshStandardMaterial({
      color: 0x779ba5, metalness: .76, roughness: .31
    });
    const sonicTrail = new THREE.MeshBasicMaterial({
      color: 0xffb46d, transparent: true, opacity: .28, depthWrite: false
    });
    const sonicCore = new THREE.MeshStandardMaterial({
      color: 0xffcd83, emissive: 0xc65b20, emissiveIntensity: .6,
      metalness: .45, roughness: .3
    });

    function createDrone(index) {
      const group = new THREE.Group();
      // Duas supersônicas entre os doze inimigos, mantendo o mesmo limite total.
      const kind = [0, 1, 2, 1, 0, 1, 2, 3, 0, 1, 2, 3][index % 12];
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
      } else if (kind === 2) {
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
      } else {
        // Supersônica: casco estreito, asas enflechadas e rastro leve.
        const hull = mesh(interceptorHull, sonicArmor, group, [0, 0, 0], [1.9, 5.5, 1.3]);
        hull.rotation.x = Math.PI / 2;
        for (const side of [-1, 1]) {
          const wing = mesh(boxGeo, sonicArmor, group,
            [side * 2.4, -.15, -1.1], [3.5, .15, 1.7]);
          wing.rotation.y = side * .36;
          mesh(boxGeo, darkMetal, group, [side * 1.15, .45, -3.1], [.35, 1.4, 2.5]);
        }
        core = mesh(ballGeo, sonicCore, group, [0, .35, 3.1], [.42, .32, .7]);
        engine = mesh(ringGeo, pink, group, [0, 0, -4.1], [1.05, 1.05, 1.05]);
        mesh(boxGeo, sonicTrail, group, [0, 0, -10.8], [.3, .3, 12]);
      }
      scene.add(group);

      return {
        group, arms, core, engine, coreScale: core.scale.clone(), kind,
        maxHp: [3, 2, 7, 3][kind],
        hp: [3, 2, 7, 3][kind], phase: rand(0, Math.PI * 2),
        cooldown: rand(1.2, 3.8), respawn: 0,
        velocity: new V3(), evade: new V3(), evadeTimer: 0, evadeCooldown: 0,
        previous: new V3(), toward: new V3(), desired: new V3(),
        lateral: new V3(), away: new V3(), miss: new V3()
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
      drone.spawnSerial = (drone.spawnSerial || 0) + 1;
      drone.hp = drone.maxHp;
      drone.cooldown = rand(1.5, 4);
      drone.respawn = 0;
      drone.velocity.set(0, 0, 0);
      drone.evadeTimer = 0;
      drone.evadeCooldown = rand(.25, .8);
      if (!initial && drone.kind === 3 && active && time - lastSupersonicAlert > 24) {
        queueEvent("SENSORES // NAVE SUPERSÔNICA EM APROXIMAÇÃO", "alert");
        lastSupersonicAlert = time;
      }
    }

    function aimSiegeRaider(drone) {
      const target = drone.raidTarget;
      const aim = drone.raidAim;
      const standoff = drone.raidStandoff;
      if (target.type === "planet") {
        aim.copy(planet.position).addScaledVector(target.direction, 570);
        standoff.copy(aim).addScaledVector(target.direction, 175);
      } else if (target.type === "satellite") {
        satellites[target.index].getWorldPosition(aim);
        drone.raidNormal.subVectors(aim, planet.position).normalize();
        standoff.copy(aim).addScaledVector(drone.raidNormal, 125);
      } else {
        const moon = moons[target.index];
        moon.mine.getWorldPosition(aim);
        moon.moon.getWorldPosition(drone.raidNormal);
        drone.raidNormal.subVectors(aim, drone.raidNormal).normalize();
        standoff.copy(aim).addScaledVector(drone.raidNormal, 145);
      }
    }

    function startSiege() {
      if (siegeActive) return;
      siegeActive = true;
      siegeElapsed = siegeDamage = 0;
      siegeReportTimer = 0;
      planet.updateMatrixWorld(true);
      const targets = [
        ...[0, 1, 2, 3].map(i => ({ type: "planet", index: i,
          direction: new V3(Math.cos(i * 1.7), .2 + i * .08,
            Math.sin(i * 1.7)).normalize() })),
        ...moons.map((_, index) => ({ type: "mine", index })),
        ...[0, 2].filter(index => satellites[index].visible)
          .map(index => ({ type: "satellite", index }))
      ];
      targets.forEach((target, index) => {
        const drone = createDrone(index % 4 === 0 ? 2 : 1);
        drone.raidTarget = target;
        drone.raidAim = new V3();
        drone.raidStandoff = new V3();
        drone.raidNormal = new V3();
        aimSiegeRaider(drone);
        drone.group.position.copy(drone.raidStandoff)
          .addScaledVector(drone.raidNormal.lengthSq() > 0 ? drone.raidNormal :
            target.direction, rand(220, 350));
        drone.group.position.x += (index % 3 - 1) * 65;
        drone.maxHp = drone.kind === 2 ? 48 : 34;
        drone.hp = drone.maxHp;
        drone.cooldown = rand(.3, 1.4);
        siegeRaiders.push(drone);
        drones.push(drone);
      });
      defenseCooldown = 0;
      moons.forEach(moon => { moon.defenseCooldown = 0; });
      allySpawnTimer = 0;
      queueEvent("ALERTA VERMELHO // HORDAS ATACAM AURORA, SATÉLITES E MINAS", "alert");
      showSiegeReport();
      combatAudio.startSiren();
    }

    function endSiege(defended, silent = false) {
      if (!siegeActive) return;
      siegeActive = false;
      combatAudio.stopSiren();
      for (const raider of siegeRaiders) {
        scene.remove(raider.group);
        const index = drones.indexOf(raider);
        if (index !== -1) drones.splice(index, 1);
      }
      siegeRaiders.length = 0;
      for (let i = bullets.length - 1; i >= 0; i--) {
        if (bullets[i].owner === "raid") removeBullet(i);
      }
      ui.chancellorCall.classList.remove("siege", "visible");
      ui.chancellorCall.setAttribute("aria-hidden", "true");
      chancellorVisible = 0;
      nextChancellor = reportInterval;
      nextSiege = rand(220, 300);
      if (silent) return;
      if (defended) {
        score += 1200;
        affectCivilization({ stability: 3, trade: 1 },
          "AURORA // DEFESA INTEGRAL CONCLUÍDA · +1200 PTS");
      } else queueEvent(`AURORA // ATAQUE REPELIDO · ${siegeDamage} IMPACTOS · REPAROS EM ANDAMENTO`, "ally");
    }

    function updateSiege(dt) {
      if (!siegeActive) {
        nextSiege -= dt;
        if (nextSiege <= 0) startSiege();
        return;
      }
      siegeElapsed += dt;
      combatAudio.startSiren();
      if (siegeElapsed >= 42 || (siegeElapsed >= 10 &&
        siegeRaiders.every(drone => !drone.group.visible))) {
        endSiege(siegeRaiders.every(drone => !drone.group.visible));
      }
    }

    function updateSiegeRaider(drone, dt) {
      const target = drone.raidTarget;
      if (target.type === "satellite" && !satellites[target.index].visible) {
        drone.raidTarget = { type: "planet", direction: new V3(1, .3, 0).normalize() };
      }
      aimSiegeRaider(drone);
      const p = drone.group.position;
      drone.previous.copy(p);
      drone.toward.subVectors(drone.raidStandoff, p);
      const distance = drone.toward.length();
      drone.desired.copy(drone.toward).normalize()
        .multiplyScalar(Math.min(75, distance * 1.8));
      drone.velocity.lerp(drone.desired, 1 - Math.exp(-2.5 * dt));
      p.addScaledVector(drone.velocity, dt);
      keepActorOutOfWorld(drone.group, drone.previous, drone.kind === 2 ? 7 : 5);
      drone.group.lookAt(drone.raidAim);
      drone.cooldown -= dt;
      if (drone.cooldown <= 0 && p.distanceToSquared(drone.raidAim) < 550 ** 2) {
        const direction = drone.toward.subVectors(drone.raidAim, p).normalize();
        spawnBullet(p.clone().addScaledVector(direction, 7), direction, true,
          "raid", 7, 210);
        bullets[bullets.length - 1].raidTarget = drone.raidTarget;
        drone.cooldown = rand(1.7, 2.6);
      }
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
      const tier = index < 5 ? 0 : index < 8 ? 1 : 2;
      const group = new THREE.Group();
      group.scale.setScalar([1.55, 2.8, 5.5][tier]);
      mesh(boxGeo, armor, group, [0, 0, 0], [1.1, .38, 2.7]);
      mesh(ballGeo, darkMetal, group, [0, .25, -.2], [.72, .35, 1.1]);
      mesh(boxGeo, allyGreen, group, [0, .43, -.4], [.32, .035, 1.2]);

      for (const side of [-1, 1]) {
        const wing = mesh(boxGeo, metal, group, [side * 1.35, -.12, .15], [1.5, .09, 1.15]);
        wing.rotation.z = side * -.14;
        mesh(boxGeo, darkMetal, group, [side * 1.12, -.08, -1.45], [.22, .2, 1.45]);
        mesh(ballGeo, allyGreen, group, [side * .58, -.15, 2.5], [.16, .16, .3]);
        if (tier > 0) {
          mesh(boxGeo, armor, group, [side * 2.1, .2, .8], [1.6, .3, 3.1]);
          mesh(boxGeo, darkMetal, group, [side * 1.9, .8, -1.8], [.5, .65, 2]);
        }
        if (tier === 2) {
          mesh(boxGeo, armor, group, [side * 3.2, -.1, 1], [2.2, .4, 4.4]);
          mesh(ballGeo, allyGreen, group, [side * 1.5, -.15, 2.9], [.45, .45, .65]);
        }
      }

      if (tier === 2) {
        mesh(boxGeo, armor, group, [0, .7, -.35], [1.4, .9, 4]);
        mesh(boxGeo, darkMetal, group, [0, 1.4, -.7], [.85, .35, 1.5]);
        mesh(boxGeo, allyGreen, group, [0, .45, -2.75], [.5, .35, 1.7]);
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
        tier,
        radius: [6, 11, 24][tier],
        active: false,
        cooldown: rand(.25, .8),
        hp: [28, 65, 150][tier],
        maxHp: [28, 65, 150][tier],
        respawn: 0,
        phase: rand(0, Math.PI * 2),
        velocity: new V3()
      };
    }

    const allies = Array.from({ length: CONFIG.allies }, (_, i) => createAlly(i));
    let shipVisualsRequested = false;
    let allySpawnTimer = rand(9, 15);
    const alliedBeams = [];
    const alliedBeamGeo = new THREE.CylinderGeometry(.8, .8, 1, 8);
    const alliedBeamMaterial = new THREE.MeshBasicMaterial({
      color: 0xa4ffe3, transparent: true, opacity: .85, depthWrite: false
    });

    function clearAlliedBeams() {
      for (const beam of alliedBeams) scene.remove(beam.mesh);
      alliedBeams.length = 0;
    }

    function updateAlliedBeams(dt) {
      for (let i = alliedBeams.length - 1; i >= 0; i--) {
        const beam = alliedBeams[i];
        beam.life -= dt;
        if (beam.life <= 0) {
          scene.remove(beam.mesh);
          alliedBeams.splice(i, 1);
        } else beam.mesh.scale.x = beam.mesh.scale.z = beam.life / .24 * 1.8;
      }
    }

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
    let bossVisualRequested = false;

    // ============================================================
    // NAVE-MÃE INIMIGA
    // ============================================================

    function createMothership() {
      const { group, core, commandRing, turrets, legacyHull } = createCapitalShip();
      group.visible = false;
      scene.add(group);
      return {
        group, core, commandRing, turrets, legacyHull,
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
    let mothershipVisualRequested = false;

    function requestMothershipVisual() {
      if (mothershipVisualRequested || effectiveQuality() === "low") return;
      mothershipVisualRequested = true;
      void upgradeCapitalShipVisuals(mothership).then(() =>
        setCapitalShipDetail(mothership, effectiveQuality() !== "low"));
    }

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

    let convoy = null;
    let nextConvoy = rand(35, 50);
    let rescueShip = null;
    let rescueCooldown = 0;
    const rescueBeamGeo = new THREE.CylinderGeometry(.35, .35, 1, 8);
    const rescueBeamMaterial = new THREE.MeshBasicMaterial({
      color: 0x89f4d6, transparent: true, opacity: .68, depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    function clearRescueShip() {
      if (!rescueShip) return;
      scene.remove(rescueShip.group, rescueShip.beam);
      rescueShip = null;
    }

    function requestRescueShip() {
      const offsets = [[200, 48, -180], [-200, 55, -180],
        [120, -65, 230], [-130, 90, 240]];
      for (const [x, y, z] of offsets) {
        const start = new V3(x, y, z).applyQuaternion(camera.quaternion)
          .add(camera.position);
        if (collectSolids(start, start, 14).some(solid =>
          start.distanceToSquared(solid.center) < (solid.radius + 14) ** 2)) continue;
        const group = createRescueShip();
        const beam = new THREE.Mesh(rescueBeamGeo, rescueBeamMaterial);
        beam.visible = false;
        group.position.copy(start);
        group.lookAt(camera.position);
        scene.add(group, beam);
        rescueShip = { group, beam, mode: "approach", age: 0,
          dockedOnce: false, departure: 0 };
        queueEvent("SOCORRO // NAVE TANQUE ACIONADA · MANTENHA A POSIÇÃO", "ally");
        return;
      }
      rescueCooldown = 1;
    }

    function updateRescueShip(dt) {
      rescueCooldown = Math.max(0, rescueCooldown - dt);
      if (!rescueShip) {
        if (fuel <= 0 && !refuelActive && rescueCooldown <= 0) requestRescueShip();
        return;
      }
      const ship = rescueShip;
      ship.age += dt;
      if (ship.mode === "depart") {
        ship.departure += dt;
        ship.group.position.addScaledVector(
          new V3(1, .35, -.8).applyQuaternion(camera.quaternion).normalize(), dt * 90);
        if (ship.departure > 4) clearRescueShip();
        return;
      }
      if (refuelActive || ship.age > 90) {
        clearRescueShip();
        rescueCooldown = refuelActive ? 0 : 2;
        return;
      }
      const dock = new V3(16, 1, 0).applyQuaternion(camera.quaternion)
        .add(camera.position);
      const previous = ship.group.position.clone();
      const distance = ship.group.position.distanceTo(dock);
      if (distance > 3) ship.group.position.lerp(dock,
        Math.min(1, dt * 105 / distance));
      keepActorOutOfWorld(ship.group, previous, 13);
      ship.group.lookAt(camera.position);
      const inRange = ship.group.position.distanceToSquared(camera.position) < 27 ** 2;
      ship.beam.visible = inRange;
      if (!inRange) { ship.mode = "approach"; return; }
      ship.mode = "transfer";
      if (!ship.dockedOnce) {
        ship.dockedOnce = true;
        queueEvent("SOCORRO // NAVE TANQUE ACOPLADA · TRANSFERINDO COMBUSTÍVEL", "ally");
        sound("shield");
      }
      const path = camera.position.clone().sub(ship.group.position);
      ship.beam.position.copy(ship.group.position).addScaledVector(path, .5);
      ship.beam.quaternion.setFromUnitVectors(UP_AXIS, path.clone().normalize());
      ship.beam.scale.y = path.length();
      fuel = Math.min(70, fuel + dt * 22);
      if (fuel >= 70) {
        ship.mode = "depart";
        ship.beam.visible = false;
        rescueCooldown = 30;
        queueEvent("SOCORRO // TANQUE REPOSTO A 70% · NAVE DE APOIO RETORNANDO", "ally");
      }
    }

    function distributeLunarOre(tons, receivingStation) {
      const available = refuelStations.filter(entry => !entry.destroyed &&
        entry.group.visible && entry.group.parent &&
        entry.group.position.distanceToSquared(planet.position) < 2500 ** 2);
      const units = tons * 5;
      const others = available.filter(entry => entry !== receivingStation);
      receivingStation.supply = Math.min(receivingStation.maxSupply,
        receivingStation.supply + units * (others.length ? .6 : 1));
      if (others.length) for (const entry of others) {
        entry.supply = Math.min(entry.maxSupply, entry.supply + units * .4 / others.length);
        if (!entry.starter) stationSupply.set(entry.id, entry.supply);
      }
      if (!receivingStation.starter) stationSupply.set(receivingStation.id, receivingStation.supply);
    }

    function clearConvoy() {
      if (!convoy) return;
      scene.remove(convoy.group);
      convoy.cargoShield.material.dispose();
      convoy.cargoShield.ringMaterial.dispose();
      convoy = null;
    }

    function finishConvoy(arrived) {
      if (!convoy) return;
      if (arrived && convoy.ships[0].alive && !convoy.station.destroyed) {
        const escorts = convoy.ships.slice(1).filter(ship => ship.alive).length;
        distributeLunarOre(convoy.tons, convoy.station);
        score += 500 + escorts * 90;
        affectCivilization({ economy: convoy.tons * .18, trade: convoy.tons * .1,
          stability: 1 + escorts },
        `AURORA // ${Math.floor(convoy.tons)} T ENTREGUES · ESTAÇÕES ABASTECIDAS · +${500 + escorts * 90} PTS`);
      } else {
        affectCivilization({ economy: -2, trade: -4, stability: -5 },
          "AURORA // CARGA LUNAR PERDIDA · ESTAÇÕES SEM REPOSIÇÃO");
      }
      clearConvoy();
      nextConvoy = rand(75, 110);
    }

    function spawnConvoy() {
      planet.updateMatrixWorld(true);
      const candidates = moons.map((moon, index) => ({ moon, index,
        position: moon.mine.getWorldPosition(new V3()) }))
        .filter(item => item.moon.cargo >= 8 &&
          item.position.distanceToSquared(camera.position) < 1350 ** 2)
        .sort((a, b) => a.position.distanceToSquared(camera.position) -
          b.position.distanceToSquared(camera.position));
      const stations = refuelStations.filter(entry => !entry.destroyed &&
        entry.group.visible && entry.group.parent &&
        entry.group.position.distanceToSquared(planet.position) < 2500 ** 2);
      for (const { moon, index, position } of candidates) {
        const moonCenter = moon.moon.getWorldPosition(new V3());
        const start = position.clone().addScaledVector(
          position.clone().sub(moonCenter).normalize(), 78);
        for (const stationEntry of stations) {
          const destination = stationEntry.group.position.clone().addScaledVector(
            stationEntry.group.position.clone().sub(planet.position).normalize(),
            stationEntry.radius + 65);
          if (start.distanceTo(destination) > 4100 ||
            collectSolids(start, destination, 48).some(solid =>
              segmentDistanceSquared(solid.center, start, destination) <
              (solid.radius + 48) ** 2)) continue;
          const visual = createCivilianConvoy();
          visual.group.position.copy(start);
          visual.group.lookAt(destination);
          scene.add(visual.group);
          const tons = Math.min(moon.cargo, 36);
          moon.cargo -= tons;
          convoy = { ...visual, destination, station: stationEntry, tons,
            velocity: destination.clone().sub(start).normalize().multiplyScalar(45),
            age: 0, cargoShieldHp: 32, cargoShieldMax: 32,
            cargoShieldDelay: 0, cargoShieldHit: 0 };
          queueEvent(`MINERAÇÃO // LUA ${index + 1}: ${Math.floor(tons)} T CARREGADAS · ESCOLTE O CARGUEIRO`, "ally");
          return true;
        }
      }
      return false;
    }

    function updateConvoy(dt) {
      if (!convoy) {
        nextConvoy -= dt;
        if (nextConvoy <= 0) nextConvoy = spawnConvoy() ? rand(75, 110) : 12;
        return;
      }
      convoy.age += dt;
      convoy.cargoShieldDelay = Math.max(0, convoy.cargoShieldDelay - dt);
      convoy.cargoShieldHit = Math.max(0, convoy.cargoShieldHit - dt * 2.5);
      if (convoy.cargoShieldDelay === 0 && convoy.cargoShieldHp < convoy.cargoShieldMax) {
        convoy.cargoShieldHp = Math.min(convoy.cargoShieldMax,
          convoy.cargoShieldHp + dt * 2.5);
      }
      const shieldVisual = convoy.cargoShield;
      const shieldFraction = convoy.cargoShieldHp / convoy.cargoShieldMax;
      shieldVisual.field.visible = shieldVisual.ring.visible = shieldFraction > 0;
      shieldVisual.material.uniforms.uTime.value = time;
      shieldVisual.material.uniforms.uStrength.value = .35 + shieldFraction * .65;
      shieldVisual.material.uniforms.uHit.value = convoy.cargoShieldHit;
      shieldVisual.ringMaterial.opacity = ((.3 + Math.sin(time * 4) * .1)
        * (.4 + shieldFraction * .6) + convoy.cargoShieldHit * .35) * .5;
      shieldVisual.ring.rotation.z = Math.sin(time * .4) * .06;
      if (convoy.station.destroyed || !convoy.station.group.parent) {
        finishConvoy(false);
        return;
      }
      const remaining = convoy.group.position.distanceTo(convoy.destination);
      if (remaining <= 2) {
        finishConvoy(true);
        return;
      }
      if (convoy.age > 105) {
        queueEvent("SENSORES // ROTA LUNAR INTERROMPIDA", "alert");
        clearConvoy();
        nextConvoy = rand(75, 110);
        return;
      }
      if (convoy.group.position.distanceToSquared(camera.position) > 2250 ** 2) {
        queueEvent("SENSORES // COMBOIO SAIU DO ALCANCE DE ESCOLTA", "alert");
        clearConvoy();
        nextConvoy = rand(75, 110);
        return;
      }
      const previous = convoy.group.position.clone();
      convoy.group.position.addScaledVector(convoy.velocity, Math.min(dt, remaining / 45));
      keepActorOutOfWorld(convoy.group, previous, 48);
      convoy.ships.forEach((ship, index) => {
        ship.group.position.y = (index ? 10 : 0) + Math.sin(time * 2 + index) * 1.2;
        if (!index || !ship.alive) return;
        ship.cooldown -= dt;
        if (ship.cooldown > 0) return;
        const origin = ship.group.getWorldPosition(new V3());
        const target = drones.find(drone => drone.group.visible &&
          drone.group.position.distanceToSquared(origin) < 280 ** 2);
        if (target) {
          spawnBullet(origin, target.group.position.clone().sub(origin).normalize(),
            false, "ally", 5);
          ship.cooldown = 1.3 + index * .18;
        }
      });
      convoy.group.updateMatrixWorld(true);
    }

    const distantBattles = [];
    let nextDistantBattle = rand(8, 16);
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
      const direction = new V3(rand(-.9, .9), rand(-.35, .35), -1)
        .normalize().applyQuaternion(camera.quaternion);
      const center = camera.position.clone().addScaledVector(direction, rand(730, 1390));
      if (center.distanceTo(planet.position) < 850 ||
        moons.some(moon => {
          return center.distanceTo(moon.moon.getWorldPosition(new V3())) < moon.radius + 180;
        }) || distantBattles.some(battle =>
          center.distanceTo(battle.group.position) < 480) ||
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
      for (let i = 0; i < 7; i++) {
        const friendly = i < 3;
        const craft = new THREE.Group();
        craft.position.set(friendly ? -90 : 90,
          (i % 3 - 1) * 42, (i - 3) * 32);
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
        if (distantBattles.length < 3) spawnDistantBattle();
        nextDistantBattle = rand(17, 27);
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
        if (!friendlies || !enemies || battle.age > 45 ||
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
      planet.updateMatrixWorld(true);
      for (const moon of moons) add(moon.moon.getWorldPosition(new V3()),
        moon.radius, moon.moon.uuid, "moon");
      for (const satellite of satellites) if (satellite.visible) {
        add(satellite.getWorldPosition(new V3()), 13, satellite.uuid, "satellite");
      }
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
            drone.kind === 2 ? 7 : drone.kind === 3 ? 6 : 5,
            drone.group.uuid, "enemy");
        }
        for (const ally of allies) {
          if (ally.active) add(ally.group.position, ally.radius, ally.group.uuid, "ally");
        }
        if (rescueShip && rescueShip.mode !== "depart") add(
          rescueShip.group.position, 10, "rescue-ship", "ally");
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
    const moonDefenseTurrets = moons.map((moon, moonIndex) => {
      const turrets = [];
      for (let i = 0; i < 3; i++) {
        const angle = i * Math.PI * 2 / 3 + moonIndex * .6;
        const normal = i === 0 ? new V3(0, 1, 0) :
          new V3(Math.cos(angle), i === 1 ? .24 : -.16,
            Math.sin(angle)).normalize();
        const turret = new THREE.Group();
        turret.position.copy(normal).multiplyScalar(moon.radius * .96 + 2);
        if (i === 0) turret.position.x += 27;
        turret.quaternion.setFromUnitVectors(UP_AXIS, normal);
        mesh(new THREE.CylinderGeometry(4.5, 6, 3, 7), darkMetal, turret, [0, 0, 0]);
        mesh(boxGeo, armor, turret, [0, 4, 0], [7, 4, 7]);
        mesh(boxGeo, weaponAccent, turret, [0, 8, 0], [2.8, 8, 3]);
        mesh(ballGeo, cyan, turret, [0, 13, 0], [2, 1.6, 2]);
        moon.moon.add(turret);
        turrets.push(turret);
      }
      return turrets;
    });
    let defenseCooldown = 1.4;
    let stationDefenseCooldown = 0;
    let defenseVolley = 0;
    let lastDefenseTier = 2;

    function defenseTier() {
      return civilization.stability < 20 ? 0 :
        civilization.stability < 50 ? 1 :
          civilization.stability < 80 ? 2 : 3;
    }

    function clearDefenseBeam(beam) {
      scene.remove(beam.mesh);
      beam.mesh.material.dispose();
    }

    function fireDefenseBeam(origin, position, lunar = false) {
      const path = position.clone().sub(origin);
      const material = defenseBeamMaterial.clone();
      if (lunar) material.color.setHex(0xffba72);
      const beamMesh = new THREE.Mesh(defenseBeamGeo, material);
      beamMesh.position.copy(origin).addScaledVector(path, .5);
      beamMesh.quaternion.setFromUnitVectors(UP_AXIS, path.clone().normalize());
      beamMesh.scale.set(lunar ? .6 : 1, path.length(), lunar ? .6 : 1);
      scene.add(beamMesh);
      defenseBeams.push({ mesh: beamMesh, life: .26 });
    }

    function acquireDefenseTarget(turrets, bodyCenter, range, muzzleHeight) {
      let selected = null;
      let best = Infinity;
      const hostiles = drones.filter(drone => drone.group.visible)
        .map(drone => ({ type: "drone", actor: drone, position: drone.group.position }));
      if (boss.visible) hostiles.push({ type: "boss", actor: boss,
        position: boss.group.position });
      if (mothership.visible) hostiles.push({ type: "mothership", actor: mothership,
        position: mothership.group.position });
      for (const turret of turrets) {
        const origin = turret.localToWorld(new V3(0, muzzleHeight, 0));
        const normal = origin.clone().sub(bodyCenter).normalize();
        for (const target of hostiles) {
          const toTarget = target.position.clone().sub(origin);
          const distance = toTarget.length();
          if (distance > range || normal.dot(toTarget) < distance * .32) continue;
          const priority = target.type === "mothership" ? .78 :
            target.type === "boss" ? .86 : 1;
          if (distance * priority >= best) continue;
          best = distance * priority;
          selected = { origin, target };
        }
      }
      return selected;
    }

    function strikeDefenseTarget(target, tier, lunar) {
      const position = target.position;
      burst(position, lunar ? 0xffb86f : 0x6de8ff, lunar ? 9 : 17, 10);
      if (target.type === "drone") {
        const drone = target.actor;
        drone.hp = Math.max(0, drone.hp - (lunar ? 8 : 10) * tier);
        if (drone.hp <= 0) {
          drone.group.visible = false;
          drone.respawn = rand(3, 5.5);
          burst(position, 0xff9d68, 48, 25);
        }
      } else if (target.type === "boss") {
        boss.hp -= lunar ? tier * 2 : tier * 3;
        if (boss.hp <= 0) destroyBoss();
      } else {
        mothership.hp -= lunar ? tier : tier + 1;
        if (mothership.hp <= 0) destroyMothership();
      }
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

      const tier = siegeActive ? Math.max(2, defenseTier()) : defenseTier();
      if (tier !== lastDefenseTier) {
        queueEvent(tier === 0
          ? "AURORA // REDE DE DEFESA DESATIVADA: ESTABILIDADE CRÍTICA"
          : tier === 1
            ? "AURORA // BATERIAS OPERANDO COM ENERGIA LIMITADA"
            : "AURORA // DEFESAS PLANETÁRIAS RESTABELECIDAS",
          tier < 2 ? "alert" : "ally");
        lastDefenseTier = tier;
      }

      if (tier === 0) return;
      planet.updateMatrixWorld(true);
      defenseCooldown -= dt;
      if (defenseCooldown <= 0) {
        const shot = acquireDefenseTarget(defenseTurrets, planet.position, 1600, 25);
        if (shot) {
          fireDefenseBeam(shot.origin, shot.target.position);
          strikeDefenseTarget(shot.target, tier, false);
          if (defenseVolley++ === 0) queueEvent(
            "AURORA // BATERIAS PLANETÁRIAS INTERCEPTAM NAVES INIMIGAS", "ally");
          defenseCooldown = siegeActive ? .28 : tier === 1 ? 1.15 : tier === 2 ? .58 : .4;
        } else defenseCooldown = .35;
      }
      moons.forEach((moon, index) => {
        moon.defenseCooldown -= dt;
        if (moon.defenseCooldown > 0) return;
        const center = moon.moon.getWorldPosition(new V3());
        const shot = acquireDefenseTarget(moonDefenseTurrets[index], center,
          tier === 1 ? 450 : 780, 14);
        if (!shot) { moon.defenseCooldown = .45; return; }
        fireDefenseBeam(shot.origin, shot.target.position, true);
        strikeDefenseTarget(shot.target, tier, true);
        if (!moon.defenseAnnounced) {
          queueEvent(`LUA ${index + 1} // CANHÕES PROTEGEM A OPERAÇÃO DE MINERAÇÃO`, "ally");
          moon.defenseAnnounced = true;
        }
        moon.defenseCooldown = siegeActive ? .85 : tier === 1 ? 2.4 : tier === 2 ? 1.65 : 1.25;
      });
      if (siegeActive) {
        stationDefenseCooldown -= dt;
        if (stationDefenseCooldown <= 0) {
          for (const stationEntry of refuelStations) {
            if (stationEntry.destroyed || !stationEntry.group.visible ||
              !stationEntry.group.parent || stationEntry.supply < 1) continue;
            const target = siegeRaiders.find(drone => drone.group.visible &&
              drone.group.position.distanceToSquared(stationEntry.group.position) < 650 ** 2);
            if (!target) continue;
            fireDefenseBeam(stationEntry.group.position, target.group.position);
            strikeDefenseTarget({ type: "drone", actor: target,
              position: target.group.position }, 1, false);
            stationEntry.supply = Math.max(0, stationEntry.supply - .15);
            break;
          }
          stationDefenseCooldown = .7;
        }
      }
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
    const reportInterval = 20;
    let nextChancellor = reportInterval, chancellorVisible = 0;
    let lastChancellorTopic = "";
    let nextSpeaker = "fluffy";
    let nextSiege = rand(75, 105), siegeActive = false, siegeElapsed = 0;
    let siegeReportTimer = 0, siegeDamage = 0;
    const siegeRaiders = [];

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

    function chancellorReport() {
      const stability = Math.round(civilization.stability);
      const economy = Math.round(civilization.economy);
      const trade = Math.round(civilization.trade);
      const reports = [
        { topic: "government", lines: [
          `O governo agora é ${civilization.government.toLowerCase()}. Mudamos o nome; a papelada ficou.`,
          `Aurora tem ${civilization.population.toFixed(2).replace(".", ",")} bilhões de cidadãos. Todos querem uma reunião comigo.`,
          `Estamos na fase ${civilization.era.toLowerCase()}. O orçamento continua na fase experimental.`
        ] },
        { topic: "culture", lines: [
          `Cultura em ${Math.round(civilization.culture)} pontos. Os artistas pediram menos invasões no horário da estreia.`,
          `Tecnologia em ${Math.round(civilization.technology)} pontos. A impressora do conselho segue sem funcionar.`
        ] }
      ];
      if (stability < 45) reports.push({ topic: "stability", lines: [
        `Estabilidade em ${stability}%. O conselho chama isso de uma emocionante oportunidade de gestão.`,
        `Com ${stability}% de estabilidade, o prédio do governo ainda está de pé. Por enquanto.`
      ] });
      if (mothership.visible || boss.visible) reports.push({ topic: "battle", lines: [
        `Temos ${mothership.visible ? "uma nave-mãe" : "um chefão"} no setor. A comissão de boas-vindas pediu escudos.`,
        `O inimigo entrou no espaço aéreo. A nota de protesto saiu impressa em papel reforçado.`
      ] });
      if (convoy) reports.push({ topic: "convoy", lines: [
        `O cargueiro traz ${Math.floor(convoy.tons)} toneladas. Se chegar, foi planejamento; se cair, foi auditoria.`,
        `A escolta lunar está a caminho. Favor não converter nossa logística em fogos de artifício.`
      ] });
      const lowestSupply = refuelStations.filter(entry => !entry.destroyed)
        .reduce((min, entry) => Math.min(min, entry.supply), 100);
      if (lowestSupply < 26) reports.push({ topic: "supply", lines: [
        `Uma estação está com ${Math.ceil(lowestSupply)}% de reserva. A reunião sobre isso consumiu o resto do café.`,
        `O minério lunar precisa chegar. As estações não funcionam apenas com otimismo ministerial.`
      ] });
      if (economy < 30 || trade < 20) reports.push({ topic: "economy", lines: [
        `Economia ${economy}, comércio ${trade}. O ministro chamou de crescimento discreto. Bem discreto.`,
        `O comércio está em ${trade}. Proibimos a palavra crise em três memorandos; não resolveu.`
      ] });
      if (moons.some(moon => moon.cargo >= 8)) reports.push({ topic: "mining", lines: [
        `As minas lunares encheram os depósitos. Agora só falta a parte simples: atravessar uma guerra.`,
        `As perfuradoras trabalham sem parar. O departamento de transporte, com sorte, também.`
      ] });
      const choices = reports.filter(report => report.topic !== lastChancellorTopic);
      const selected = choices[Math.floor(Math.random() * choices.length)] || reports[0];
      lastChancellorTopic = selected.topic;
      return selected.lines[Math.floor(Math.random() * selected.lines.length)];
    }

    function generalReport() {
      const reports = [
        `Defesas de Aurora em nível ${defenseTier()}. A burocracia não consta no plano de batalha.`,
        `Contamos ${drones.filter(drone => drone.group.visible).length} drones ativos. Minha paciência conta menos.`,
        "Ordem do dia: proteger a colônia. Ordem do conselho: discutir a ordem do dia."
      ];
      if (fuel <= 15 || rescueShip) reports.push(
        `Combustível em ${Math.ceil(fuel)}%. Acionei a nave tanque. Sim, desta vez antes do formulário.`,
        "A nave de apoio está em missão. A próxima vez que sair sem combustível, leve uma coleira de reboque."
      );
      if (mothership.visible || boss.visible) reports.push(
        "Contato pesado no setor. Minha estratégia oficial é atirar antes de escrever um relatório.",
        "O inimigo quer negociar com lasers. Finalmente uma linguagem que eu entendo."
      );
      if (convoy) reports.push(
        `O cargueiro leva ${Math.floor(convoy.tons)} toneladas. Dois escoltas e zero espaço para desculpas.`,
        "Protejam a carga lunar. As estações não aceitam medalhas como combustível."
      );
      if (civilization.stability < 40) reports.push(
        `Estabilidade em ${Math.round(civilization.stability)}%. Ordenei que os canhões mirassem para fora.`
      );
      return reports[Math.floor(Math.random() * reports.length)];
    }

    function updateChancellor(dt) {
      if (siegeActive) {
        siegeReportTimer -= dt;
        if (siegeReportTimer <= 0) showSiegeReport();
        return;
      }
      if (chancellorVisible > 0) {
        chancellorVisible -= dt;
        if (chancellorVisible <= 0) {
          ui.chancellorCall.classList.remove("visible");
          ui.chancellorCall.setAttribute("aria-hidden", "true");
        }
      }
      nextChancellor -= dt;
      if (nextChancellor > 0 || eventTimer > 1.5 || chancellorVisible > 0) return;
      const general = nextSpeaker === "perrito";
      ui.chancellorCall.classList.toggle("general", general);
      ui.chancellorSpeaker.textContent = general ? "GENERAL PERRITO // DEFESA" :
        "MR. FLUFFY // CHANCELER";
      ui.chancellorChannel.textContent = general ? "CANAL MILITAR ▪ AO VIVO" :
        "CANAL DIPLOMÁTICO ▪ AO VIVO";
      ui.chancellorPortrait.src = general ? perritoPortrait : fluffyPortrait;
      ui.chancellorCall.setAttribute("aria-hidden", "false");
      ui.chancellorText.textContent = general ? generalReport() : chancellorReport();
      ui.chancellorCall.classList.add("visible");
      chancellorVisible = 8;
      nextChancellor = reportInterval;
      nextSpeaker = general ? "fluffy" : "perrito";
    }

    function showSiegeReport() {
      const general = nextSpeaker === "perrito";
      ui.chancellorCall.classList.toggle("general", general);
      ui.chancellorCall.classList.add("siege", "visible");
      ui.chancellorSpeaker.textContent = general ? "GENERAL PERRITO // DEFESA TOTAL" :
        "CHANCELER MR. FLUFFY // EMERGÊNCIA";
      ui.chancellorChannel.textContent = "CANAL DE EMERGÊNCIA ▪ PRIORIDADE MÁXIMA";
      ui.chancellorPortrait.src = general ? perritoPortrait : fluffyPortrait;
      ui.chancellorText.textContent = general
        ? "Todas as naves e postos de contenção: defendam o planeta, os satélites e as minas! Fogo à vontade!"
        : "Invasão em massa! Suspendi as reuniões. Protejam Aurora e as perfuradoras; o orçamento pode esperar!";
      ui.chancellorCall.setAttribute("aria-hidden", "false");
      nextSpeaker = general ? "fluffy" : "perrito";
      siegeReportTimer = 8;
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
      bullet.raidTarget = null;
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

    // Armamento de interceptação: exclusivamente contra naves supersônicas.
    const guidedMissiles = [];
    let missileCooldown = 0;
    let missileNoticeCooldown = 0;

    function findMissileTarget() {
      camera.getWorldDirection(forward);
      let selected = null;
      let best = -Infinity;
      for (const drone of drones) {
        if (!drone.group.visible || drone.kind !== 3) continue;
        const toTarget = drone.group.position.clone().sub(camera.position);
        const distance = toTarget.length();
        if (distance > 900 || distance < 12) continue;
        const alignment = forward.dot(toTarget) / distance;
        if (alignment < .94) continue;
        if (collectSolids(camera.position, drone.group.position, 2).some(solid =>
          segmentDistanceSquared(solid.center, camera.position,
            drone.group.position) < (solid.radius + 2) ** 2)) continue;
        const rating = alignment - distance * .00005;
        if (rating > best) { best = rating; selected = drone; }
      }
      return selected;
    }

    function launchGuidedMissile() {
      if (!active || warpTimer > 0 || missileCooldown > 0 ||
        guidedMissiles.length >= 2) return false;
      const target = findMissileTarget();
      if (!target) {
        if (missileNoticeCooldown <= 0) {
          queueEvent("MÍSSIL // MIRE EM UMA NAVE SUPERSÔNICA PARA FIXAR O ALVO");
          missileNoticeCooldown = 3;
        }
        return false;
      }
      camera.getWorldDirection(forward);
      const group = createGuidedMissile();
      const side = guidedMissiles.length % 2 ? -1 : 1;
      group.position.copy(new V3(side * 2.2, -1.2, -5.5)
        .applyQuaternion(camera.quaternion).add(camera.position));
      group.quaternion.setFromUnitVectors(UP_AXIS, forward);
      scene.add(group);
      guidedMissiles.push({ group, direction: forward.clone(), speed: 185,
        target, spawnSerial: target.spawnSerial, life: 5.5 });
      missileCooldown = 2.8;
      sound("shot");
      queueEvent("MÍSSIL // TRAVA CONFIRMADA · INTERCEPTANDO NAVE SUPERSÔNICA", "ally");
      return true;
    }

    function updateGuidedMissiles(dt) {
      missileCooldown = Math.max(0, missileCooldown - dt);
      missileNoticeCooldown = Math.max(0, missileNoticeCooldown - dt);
      for (let i = guidedMissiles.length - 1; i >= 0; i--) {
        const missile = guidedMissiles[i];
        missile.life -= dt;
        const previous = missile.group.position.clone();
        const target = missile.target;
        const tracking = target.group.visible && target.kind === 3 &&
          target.spawnSerial === missile.spawnSerial;
        if (tracking) missile.direction.copy(steerGuidedMissile(
          missile.direction, previous, target.group.position, target.velocity,
          missile.speed, dt));
        missile.speed = Math.min(460, missile.speed + dt * 210);
        missile.group.position.addScaledVector(missile.direction, missile.speed * dt);
        missile.group.quaternion.setFromUnitVectors(UP_AXIS, missile.direction);
        const blocked = collectSolids(previous, missile.group.position, 3).some(solid =>
          segmentDistanceSquared(solid.center, previous, missile.group.position) <
            (solid.radius + 3) ** 2);
        const hit = tracking && !blocked && segmentDistanceSquared(
          target.group.position, previous, missile.group.position) < 12 ** 2;
        if (hit) {
          target.hp -= 4;
          hitTimer = .2;
          burst(target.group.position, 0xffb577, 85, 35);
          burst(target.group.position, 0x6de9e1, 40, 25);
          sound("blast", target.group.position);
          if (target.hp <= 0) {
            target.group.visible = false;
            target.respawn = rand(3, 5.5);
            score += 150;
            queueEvent("MÍSSIL // NAVE SUPERSÔNICA DESTRUÍDA · +150 PTS", "ally");
          }
        } else if (blocked) {
          burst(missile.group.position, 0xffaa65, 25, 16);
          sound("hit", missile.group.position);
        }
        if (hit || blocked || missile.life <= 0 || !tracking) {
          scene.remove(missile.group);
          guidedMissiles.splice(i, 1);
        }
      }
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
        const previousPosition = bomb.mesh.position.clone();
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
        if (!impact) {
          planet.updateMatrixWorld(true);
          impact = moons.some(moon => segmentDistanceSquared(
            moon.moon.getWorldPosition(new V3()), previousPosition,
            bomb.mesh.position) < (moon.radius + 2) ** 2) ||
            satellites.some(satellite => segmentDistanceSquared(
              satellite.getWorldPosition(new V3()), previousPosition,
              bomb.mesh.position) < 15 ** 2);
        }
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
            ) < ally.radius * ally.radius) {
              ally.hp = Math.max(0, ally.hp - bullet.damage);
              burst(bullet.mesh.position, 0x69ffc5, 22, 20);
              hit = true;
              if (ally.hp <= 0) destroyAlly(ally);
              break;
            }
          }

          if (!hit && convoy) {
            convoy.group.updateMatrixWorld(true);
            const cargoShip = convoy.ships[0];
            if (cargoShip.alive && convoy.cargoShieldHp > 0) {
              const cargoPosition = cargoShip.group.getWorldPosition(radarVector);
              if (segmentDistanceSquared(cargoPosition, bullet.previous,
                bullet.mesh.position) < 23 ** 2) {
                convoy.cargoShieldHp = Math.max(0, convoy.cargoShieldHp - bullet.damage);
                convoy.cargoShieldDelay = 7;
                convoy.cargoShieldHit = 1;
                burst(bullet.mesh.position, 0xffd765, 13, 10);
                sound("shield", cargoPosition);
                hit = true;
              }
            }
            for (const ship of convoy.ships) {
              if (hit) break;
              if (!ship.alive) continue;
              const position = ship.group.getWorldPosition(new V3());
              if (segmentDistanceSquared(position, bullet.previous,
                bullet.mesh.position) >= (ship.role === "cargo" ? 15 : 9) ** 2) continue;
              ship.hp = Math.max(0, ship.hp - bullet.damage);
              burst(position, 0xffc787, 18, 16);
              hit = true;
              if (ship.hp <= 0) {
                ship.alive = false;
                ship.group.visible = false;
                sound("blast", position);
                burst(position, 0xff9a54, 75, 36);
                queueEvent(ship.role === "cargo" ?
                  "COMANDO // CARGUEIRO LUNAR ABATIDO" :
                  "COMANDO // ESCOLTA DO CARGUEIRO ABATIDA", "alert");
                if (ship.role === "cargo") finishConvoy(false);
              }
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
              drone.hp -= bullet.owner === "ally" ? bullet.damage : 1;
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
            mothership.hp -= bullet.owner === "ally" ? bullet.damage : 1;
            hitTimer = .13;
            hit = true;
            burst(bullet.mesh.position, 0xc65cff, 18, 18);
            if (mothership.hp <= 0) destroyMothership();
          }

          if (!hit && boss.visible && segmentDistanceSquared(
            boss.group.position, bullet.previous, bullet.mesh.position
          ) < 19 * 19) {
            boss.hp -= bullet.owner === "ally" ? bullet.damage : 1;
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
              hitDistantActor(battle, target,
                bullet.owner === "ally" ? bullet.damage : 1, bullet.owner === "player");
              hit = true;
              break;
            }
          }
        }

        if (!hit && bullet.owner === "raid" && bullet.raidTarget) {
          const target = bullet.raidTarget;
          planet.updateMatrixWorld(true);
          if (target.type === "planet" && segmentDistanceSquared(planet.position,
            bullet.previous, bullet.mesh.position) < 570 ** 2) {
            hit = true;
            siegeDamage++;
            civilization.stability = Math.max(0, civilization.stability - .25);
            burst(bullet.mesh.position, 0xff624e, 16, 15);
          } else if (target.type === "satellite") {
            const satellite = satellites[target.index];
            if (satellite.visible && segmentDistanceSquared(
              satellite.getWorldPosition(radarVector), bullet.previous,
              bullet.mesh.position) < 15 ** 2) {
              hit = true;
              siegeDamage++;
              satellite.userData.integrity -= bullet.damage;
              burst(bullet.mesh.position, 0xffa568, 24, 17);
              if (satellite.userData.integrity <= 0) {
                satellite.visible = false;
                burst(radarVector, 0xff7452, 65, 35);
                queueEvent(`AURORA // SATÉLITE ${target.index + 1} FORA DE OPERAÇÃO`, "alert");
              }
            }
          } else if (target.type === "mine") {
            const moon = moons[target.index];
            if (segmentDistanceSquared(moon.moon.getWorldPosition(radarVector),
              bullet.previous, bullet.mesh.position) < moon.radius ** 2) {
              hit = true;
              siegeDamage++;
              moon.mineIntegrity = Math.max(0, moon.mineIntegrity - bullet.damage * 1.4);
              civilization.economy = Math.max(0, civilization.economy - .12);
              burst(bullet.mesh.position, 0xffa568, 19, 16);
            }
          }
        }
        if (!hit) {
          planet.updateMatrixWorld(true);
          hit = moons.some(moon => segmentDistanceSquared(
            moon.moon.getWorldPosition(new V3()), bullet.previous,
            bullet.mesh.position) < moon.radius ** 2) ||
            satellites.some(satellite => satellite.visible && segmentDistanceSquared(
              satellite.getWorldPosition(new V3()), bullet.previous,
              bullet.mesh.position) < 13 ** 2);
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
          "Player do YouTube aberto. Se a música não tocar, escolha um arquivo do dispositivo.";
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
            ? "Player do YouTube aberto. Se a música não tocar, escolha um arquivo do dispositivo."
            : "Trilha do YouTube selecionada. Se estiver indisponível, escolha um arquivo do dispositivo.";
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
      // O desktop usa P/Escape ou o botão MENU do controle; toque precisa do botão.
      flightMenu.hidden = !active || !enabled;
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
    $("touchMissile").addEventListener("click", launchGuidedMissile);
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

      // Xbox padrão: A/RB atirar, R3 míssil, B bomba, X descer, LT turbo, RT avançar.
      gamepadInput.up = false;
      gamepadInput.down = gamepadButtonPressed(gamepad, 2);
      gamepadInput.boost = gamepadButtonPressed(gamepad, 6, .12);
      gamepadInput.forward = gamepadButtonPressed(gamepad, 7, .12);
      gamepadInput.fire =
        gamepadButtonPressed(gamepad, 0) ||
        gamepadButtonPressed(gamepad, 5);

      const bombPressed = gamepadButtonDownOnce(gamepad, 1);
      const missilePressed = gamepadButtonDownOnce(gamepad, 11);
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
      if (missilePressed) launchGuidedMissile();
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
      const newMission = dead || !started;
      if (newMission) reset();
      if (!shipVisualsRequested) {
        shipVisualsRequested = true;
        void upgradeShipVisuals(shipExterior, allies);
      }

      restartPending = false;

      wakeAudio();
      if (siegeActive) combatAudio.startSiren();

      started = true;
      active = true;
      if (newMission) queueEvent("SENSORES // BATEDORES E NAVES SUPERSÔNICAS DETECTADOS", "alert");
      if (effectiveQuality() !== "low") requestPostprocessing();

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
      combatAudio.stopSiren();
      if (score > record) {
        record = score;
        settings.best.textContent = `RECORDE // ${String(record).padStart(6, "0")} PTS`;
        recordDirty = true;
      }
      if (recordDirty) savePreferences();
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
      autoReduced = false;
      qualityWarmup = 3;
      qualityWindow = qualityFrames = 0;
      applyQuality();
      if (score > record) {
        record = score;
        settings.best.textContent = `RECORDE // ${String(record).padStart(6, "0")} PTS`;
        recordDirty = true;
      }
      if (recordDirty) savePreferences();
      clearTouchInput();

      score = 0;
      shield = 100;
      heat = 0;
      charge = 100;
      fuel = 100;
      bombCount = CONFIG.maxBombs;
      bombCooldown = 0;
      missileCooldown = 0;
      missileNoticeCooldown = 0;
      bombRefillTimer = 0;
      refuelActive = false;
      nearbyStationSupply = null;
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
      while (guidedMissiles.length) scene.remove(guidedMissiles.pop().group);
      while (stationExplosions.length) disposeStationExplosion(stationExplosions.pop());
      while (impacts.length) clearImpact(impacts.pop());
      while (defenseBeams.length) clearDefenseBeam(defenseBeams.pop());
      clearAlliedBeams();
      while (distantBattles.length) removeDistantBattle(distantBattles[0]);
      endSiege(false, true);
      clearConvoy();
      clearRescueShip();
      rescueCooldown = 0;
      nextConvoy = rand(35, 50);
      nextDistantBattle = rand(8, 16);
      solidImpactTimes.clear();
      defenseCooldown = 1.4;
      stationDefenseCooldown = 0;
      defenseVolley = 0;
      lastDefenseTier = 2;
      lastSupersonicAlert = -100;
      nextSiege = rand(75, 105);

      for (const key of Array.from(loadedSectors.keys())) unloadSector(key);
      destroyedWorldObjects.clear();
      stationSupply.clear();
      currentSectorKey = "";

      // Restaura os marcos do sistema inicial após eventual rebasing.
      planet.position.set(-1050, 270, -2300);
      planet.rotation.y = 0;
      moons.forEach((moon, index) => {
        moon.orbit.rotation.y = [.4, 2.5, 4.3][index];
        moon.ore = 1000;
        moon.cargo = 0;
        moon.mineIntegrity = 100;
        moon.defenseCooldown = 1 + index * .3;
        moon.defenseAnnounced = false;
      });
      miningReadyNotified = false;
      satellites.forEach(satellite => {
        satellite.visible = true;
        satellite.userData.integrity = 36;
      });
      atmosphere.position.copy(planet.position);
      station.position.set(0, 15, -540);
      station.visible = true;
      if (!station.parent) scene.add(station);
      starterStation.destroyed = false;
      starterStation.hp = starterStation.maxHp;
      starterStation.supply = 70;
      starterStation.lastWarning = 100;

      particlePool.clear();
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
      nextChancellor = reportInterval;
      chancellorVisible = 0;
      lastChancellorTopic = "";
      nextSpeaker = "fluffy";
      ui.chancellorCall.classList.remove("visible", "siege");
      ui.chancellorCall.setAttribute("aria-hidden", "true");
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
        launchGuidedMissile();
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
      turboStreaks = boosting && warpTimer <= 0;

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
      nearbyStationSupply = null;

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

        nearbyStationSupply = stationEntry.supply;
        if (stationEntry.supply <= 0) continue;
        refuelActive = true;
        const needsResources = fuel < 99 || shield < 99 || charge < 99 ||
          heat > 1 || bombCount < CONFIG.maxBombs;
        if (needsResources) {
          stationEntry.supply = Math.max(0, stationEntry.supply - dt * 1.3);
          nearbyStationSupply = stationEntry.supply;
          if (!stationEntry.starter) stationSupply.set(stationEntry.id, stationEntry.supply);
          if (stationEntry.supply === 0) queueEvent(
            "ESTAÇÃO // RESERVA ESGOTADA · AGUARDANDO CARGA LUNAR", "alert");
        }
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

    function chooseEnemyTarget(origin, preferAllies = false) {
      if (convoy && Math.random() < .38) {
        convoy.group.updateMatrixWorld(true);
        const inRange = convoy.ships.filter(ship => ship.alive &&
          ship.group.getWorldPosition(new V3()).distanceToSquared(origin) < 560 ** 2);
        if (inRange.length) {
          const ship = inRange[Math.floor(Math.random() * inRange.length)];
          return { position: ship.group.getWorldPosition(new V3()),
            velocity: convoy.velocity, type: "convoy" };
        }
      }
      const availableAllies = allies.filter(ally => ally.active);
      if (availableAllies.length && Math.random() < (preferAllies ? .85 : .48)) {
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

    function incomingShot(drone) {
      const position = drone.group.position;
      const safeRadius = drone.kind === 3 ? 90 : drone.kind === 1 ? 68 : 48;
      for (const bullet of bullets) {
        if (bullet.enemy) continue;
        const toward = temp.subVectors(position, bullet.mesh.position);
        const speedSq = bullet.velocity.lengthSq();
        const projection = toward.dot(bullet.velocity);
        if (projection <= 0 || speedSq < 1) continue;
        const seconds = Math.min(.55, projection / speedSq);
        if (seconds < .04) continue;
        const miss = drone.miss.copy(bullet.mesh.position)
          .addScaledVector(bullet.velocity, seconds);
        if (miss.distanceToSquared(position) < safeRadius * safeRadius) return bullet;
      }
      return null;
    }

    function updateDrones(dt) {
      for (const drone of drones) {
        if (drone.raidTarget) {
          if (drone.group.visible) updateSiegeRaider(drone, dt);
          continue;
        }
        if (!drone.group.visible) {
          drone.respawn -= dt;
          if (drone.respawn <= 0) placeDrone(drone);
          continue;
        }

        const p = drone.group.position;
        const previous = drone.previous.copy(p);
        const distance = p.distanceTo(camera.position);

        if (distance > 950 && warpTimer === 0) {
          placeDrone(drone);
          continue;
        }

        const escortTarget = drone.kind === 1
          ? allies.find(ally => ally.active &&
            ally.group.position.distanceToSquared(p) < 480 ** 2)
          : null;
        const targetPosition = escortTarget?.group.position || camera.position;
        const toward = drone.toward.subVectors(targetPosition, p);
        const targetDistance = toward.length();
        toward.normalize();
        const chaseSpeed = [38, 68, 23, 170][drone.kind];
        const approach = targetDistance > (drone.kind === 3 ? 155 : 115)
          ? chaseSpeed : targetDistance < 55 ? -chaseSpeed * .4 : 0;
        const desired = drone.desired.copy(toward).multiplyScalar(approach);
        const lateral = drone.lateral.crossVectors(toward, UP_AXIS).normalize();
        desired.addScaledVector(lateral,
          Math.sin(time * (drone.kind === 3 ? 3.1 : 1.4) + drone.phase) *
          [17, 34, 9, 85][drone.kind]);
        desired.y += Math.cos(time * 1.8 + drone.phase) * (drone.kind === 3 ? 22 : 8);

        drone.evadeTimer = Math.max(0, drone.evadeTimer - dt);
        drone.evadeCooldown = Math.max(0, drone.evadeCooldown - dt);
        if (drone.evadeCooldown <= 0 && drone.evadeTimer <= 0) {
          const threat = incomingShot(drone);
          if (threat) {
            drone.evade.crossVectors(threat.velocity, UP_AXIS).normalize();
            if (drone.evade.lengthSq() < .1) drone.evade.set(1, 0, 0);
            const away = drone.away.subVectors(p, threat.mesh.position);
            if (drone.evade.dot(away) < 0) drone.evade.negate();
            drone.evade.y = Math.sin(drone.phase + time) * .32;
            drone.evade.normalize();
            drone.evadeTimer = drone.kind === 3 ? .65 : .48;
            drone.evadeCooldown = drone.kind === 2 ? 2 : rand(.7, 1.3);
          }
        }
        if (drone.evadeTimer > 0) desired.addScaledVector(drone.evade,
          drone.kind === 3 ? 190 : drone.kind === 1 ? 100 : 54);
        drone.velocity.lerp(desired,
          1 - Math.exp(-[2.6, 4.2, 1.8, 5.5][drone.kind] * dt));
        drone.velocity.clampLength(0, drone.kind === 3 ? 205 : chaseSpeed * 1.7);
        p.addScaledVector(drone.velocity, dt);
        keepActorOutOfWorld(drone.group, previous, drone.kind === 2 ? 7 : 5);

        drone.group.lookAt(targetPosition);
        drone.group.rotation.z += Math.sin(time * 5 + drone.phase) *
          (drone.kind === 3 ? .18 : .06);
        drone.arms.forEach((arm, i) => {
          arm.rotation.z = Math.sin(time * 2.2 + drone.phase + i) * .18;
        });

        drone.core.scale.copy(drone.coreScale)
          .multiplyScalar(1 + Math.sin(time * 5 + drone.phase) * .1);
        drone.engine.rotation.z += dt * 2;

        drone.cooldown -= dt;

        if (drone.cooldown <= 0 && distance < 380 && warpTimer === 0) {
          const target = chooseEnemyTarget(p, drone.kind === 1);
          drone.group.lookAt(target.position);
          const attackDirection = new V3().subVectors(target.position, p).normalize();
          const origin = p.clone().addScaledVector(attackDirection, 4);
          const aim = target.position.clone()
            .addScaledVector(target.velocity, Math.min(distance / 110, 1) * .55)
            .add(new V3(rand(-3, 3), rand(-3, 3), rand(-3, 3)));

          spawnBullet(origin, aim.sub(origin).normalize(), true,
            "drone", [9, 6, 10, 7][drone.kind]);
          drone.cooldown = rand(1.9, 3.6) / difficultyScale() *
            [1, .7, 1.25, 1.25][drone.kind];
        }
      }
    }

    function spawnAlliedSquadron() {
      const ready = allies.filter(ally => !ally.active && ally.respawn <= 0);
      if (!ready.length) return;

      for (let i = 0; i < ready.length; i++) {
        const ally = ready[i];
        const column = ally.index % 5 - 2;
        const row = Math.floor(ally.index / 5);
        const local = siegeActive
          ? new V3(column * 115, 40 + row * 95, 780 + row * 90 + i * 3)
            .add(planet.position)
          : new V3(column * 115, 18 + row * 95, 140 + row * 110 + i * 3)
            .applyQuaternion(camera.quaternion).add(camera.position);

        ally.group.position.copy(local);
        ally.group.quaternion.copy(camera.quaternion);
        ally.group.visible = true;
        ally.active = true;
        ally.hp = ally.maxHp;
        ally.cooldown = rand(.2, .75);
        ally.velocity.copy(velocity);
      }

      queueEvent(`COMANDO // ${ready.length} ALIADOS: INTERCEPTADORES, FRAGATAS E CRUZADORES`, "ally");
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
      queueEvent(`COMANDO // ${["INTERCEPTADOR", "FRAGATA", "CRUZADOR"][ally.tier]} ${ally.index + 1} ABATIDO · REFORÇO SOLICITADO`, "alert");
    }

    function getClosestDrone(position, raidOnly = false) {
      let selected = null;
      let bestDistance = Infinity;

      for (const drone of drones) {
        if (!drone.group.visible || (raidOnly && !drone.raidTarget)) continue;
        const distance = drone.group.position.distanceToSquared(position);
        if (distance < bestDistance) {
          bestDistance = distance;
          selected = drone;
        }
      }

      return selected;
    }

    function fireCruiserLaser(ally, target, droneTarget) {
      const start = ally.group.position.clone();
      const end = target.clone();
      const length = start.distanceTo(end);
      if (length < 1 || length > 620) return false;
      const blocked = collectSolids(start, end, ally.radius).some(solid =>
        start.distanceTo(solid.center) < length - solid.radius &&
        segmentDistanceSquared(solid.center, start, end) < solid.radius ** 2
      );
      if (blocked) return false;

      const path = end.clone().sub(start);
      const beam = new THREE.Mesh(alliedBeamGeo, alliedBeamMaterial);
      beam.position.copy(start).addScaledVector(path, .5);
      beam.quaternion.setFromUnitVectors(UP_AXIS, path.normalize());
      beam.scale.set(1.8, length, 1.8);
      scene.add(beam);
      alliedBeams.push({ mesh: beam, life: .24 });
      sound("shot", start);
      burst(end, 0xa4ffe3, 15, 12);

      if (mothership.visible) {
        mothership.hp -= 8;
        if (mothership.hp <= 0) destroyMothership();
      } else if (boss.visible) {
        boss.hp -= 7;
        if (boss.hp <= 0) destroyBoss();
      } else if (droneTarget?.group.visible) {
        droneTarget.hp -= 8;
        if (droneTarget.hp <= 0) {
          sound("blast", end);
          burst(end, 0xff6b56, 80, 38);
          droneTarget.group.visible = false;
          droneTarget.respawn = rand(2, 4.5);
          score += 150;
        }
      }
      return true;
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

        const droneTarget = siegeActive
          ? getClosestDrone(ally.group.position, true) || getClosestDrone(ally.group.position)
          : getClosestDrone(ally.group.position);
        let targetPosition = siegeActive && droneTarget?.raidTarget
          ? droneTarget.group.position : mothership.visible
          ? mothership.group.position
          : boss.visible ? boss.group.position
          : droneTarget?.group.position;
        const attackTarget = targetPosition;

        if (!siegeActive && ally.group.position.distanceToSquared(camera.position) > 700 * 700) {
          targetPosition = null;
        }

        if (!targetPosition) {
          const escort = new V3(
            (ally.index % 5 - 2) * 105,
            20 + Math.floor(ally.index / 5) * 90 + Math.sin(time + ally.phase) * 8,
            siegeActive ? 780 + Math.floor(ally.index / 5) * 125 :
              150 + Math.floor(ally.index / 5) * 125
          );
          if (siegeActive) escort.add(planet.position);
          else escort.applyQuaternion(camera.quaternion).add(camera.position);
          temp.subVectors(escort, ally.group.position);
          ally.velocity.lerp(temp.clampLength(0, 230), 1 - Math.exp(-2.4 * dt));
        } else {
          const offset = new V3(
            (ally.index % 5 - 2) * 68,
            (Math.floor(ally.index / 5) - .5) * 110,
            0
          ).applyQuaternion(camera.quaternion);
          targetPosition = targetPosition.clone().add(offset);
          temp.subVectors(targetPosition, ally.group.position);
          const distance = temp.length();
          const desiredSpeed = distance > (ally.tier === 2 ? 280 : 190)
            ? (ally.tier === 2 ? 68 : 95) : distance < 95 ? -34 : 18;
          temp.normalize().multiplyScalar(desiredSpeed);
          temp.x += Math.sin(time * 1.7 + ally.phase) * 18;
          ally.velocity.lerp(temp, 1 - Math.exp(-2.8 * dt));
          ally.group.lookAt(attackTarget);

          ally.cooldown -= dt;
          if (ally.cooldown <= 0 && distance < (ally.tier === 2 ? 620 : 390)) {
            if (ally.tier === 2) {
              if (fireCruiserLaser(ally, attackTarget, droneTarget)) {
                ally.cooldown = rand(2.4, 3.3);
              }
            } else {
              const direction = new V3().subVectors(attackTarget, ally.group.position).normalize();
              const origin = ally.group.position.clone().addScaledVector(direction, 4);
              spawnBullet(origin, direction, false, "ally", ally.tier === 1 ? 2 : 1);
              ally.cooldown = ally.tier === 1 ? rand(.55, .85) : rand(.34, .58);
            }
          }
        }

        const previous = ally.group.position.clone();
        for (const other of allies) {
          if (other === ally || !other.active) continue;
          const away = new V3().subVectors(ally.group.position, other.group.position);
          const distance = away.length();
          const spacing = Math.max(80, ally.radius + other.radius + 46);
          if (distance > .001 && distance < spacing) {
            ally.velocity.addScaledVector(away, (spacing - distance) / distance * dt * 3);
          }
        }
        ally.group.position.addScaledVector(ally.velocity, dt);
        keepActorOutOfWorld(ally.group, previous, ally.radius);
        ally.group.rotation.z = Math.sin(time * 2.2 + ally.phase) * .08;
      }
    }

    function spawnBoss() {
      if (!bossVisualRequested) {
        bossVisualRequested = true;
        void upgradeBossVisual(boss);
      }
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
      requestMothershipVisual();
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
    const convoyPosition = new V3();
    let lastRadarUpdate = -Infinity;

    function updateHUD() {
      if (score > record) {
        record = score;
        settings.best.textContent = `RECORDE // ${String(record).padStart(6, "0")} PTS`;
        recordDirty = true;
      }
      if (recordDirty && performance.now() - lastRecordSave >= 5000) savePreferences();
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
      const missileTarget = active ? findMissileTarget() : null;
      ui.reticle.classList.toggle("locked", Boolean(missileTarget));
      ui.missileValue.textContent = missileCooldown > 0
        ? `MÍSSIL: RECARGA ${missileCooldown.toFixed(1)}S`
        : missileTarget ? "MÍSSIL: ALVO FIXADO" : "MÍSSIL: BUSCANDO";
      updateCivilizationHUD();

      if (active && convoy && convoy.ships[0].alive) {
        convoy.ships[0].group.getWorldPosition(convoyPosition);
        const distance = camera.position.distanceTo(convoyPosition);
        projected.copy(convoyPosition).project(camera);
        const visible = projected.z > -1 && projected.z < 1 &&
          Math.abs(projected.x) < .88 && Math.abs(projected.y) < .76;
        ui.convoyTag.hidden = !visible;
        if (visible) {
          ui.convoyTag.style.left = `${(projected.x * .5 + .5) * innerWidth}px`;
          ui.convoyTag.style.top = `${(-projected.y * .5 + .5) * innerHeight}px`;
          ui.convoyTag.textContent = `◆ MINÉRIO LUNAR · ${Math.round(distance)} M · ESCUDO ${Math.ceil(convoy.cargoShieldHp / convoy.cargoShieldMax * 100)}%`;
        }
      } else ui.convoyTag.hidden = true;

      ui.reticle.classList.toggle("hit", hitTimer > 0);

      ui.message.textContent =
        viewNoticeTimer > 0 ? (thirdPerson ? "VISÃO EXTERNA // 3ª PESSOA" : "VISÃO INTERNA // COCKPIT") :
        refuelActive ? `ESTAÇÃO // REABASTECENDO · RESERVA ${Math.ceil(nearbyStationSupply)}%` :
        rescueShip?.mode === "transfer" ? `SOCORRO // REABASTECENDO · ${Math.ceil(fuel)}%` :
        rescueShip?.mode === "approach" ? "SOCORRO // NAVE TANQUE EM APROXIMAÇÃO" :
        nearbyStationSupply !== null ? "ESTAÇÃO // RESERVA ESGOTADA · ESCOLTE MINÉRIO LUNAR" :
        warpTimer > 0 ? "HIPERVELOCIDADE // CAMPO ATIVO" :
        fuel <= 8 ? "ALERTA // COMBUSTÍVEL CRÍTICO" :
        overheated ? "ARMAS SUPERAQUECIDAS" :
        shield < 30 ? `PERIGO EXTREMO // BOMBA [ B ] ${bombCount}/${CONFIG.maxBombs}` :
        charge >= 100 ? "SALTO DISPONÍVEL [ F ]" : "RECARREGANDO NÚCLEO";

      ui.message.style.color = overheated || shield < 30 || fuel <= 8 ? "#ff668b" : "#63f7ff";

      if (!active) ui.target.style.display = "none";
      else if (time - lastRadarUpdate >= 1 / 30) {
        lastRadarUpdate = time;
        updateRadar(missileTarget);
      }
    }

    function updateRadar(missileTarget) {
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

        radar.fillStyle = drone.kind === 3 ? "#ffbd69" :
          radarVector.y > 10 ? "#ffa763" : "#ff4976";
        radar.beginPath();
        radar.arc(120 + x, 120 + y, drone.kind === 3 ? 5 : 3, 0, Math.PI * 2);
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
              label: ["SENTINELA", "BATEDOR", "FORTALEZA", "SUPERSÔNICA"][drone.kind]
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

      if (missileTarget) {
        projected.copy(missileTarget.group.position).project(camera);
        bestTarget = {
          x: (projected.x * .5 + .5) * innerWidth,
          y: (-projected.y * .5 + .5) * innerHeight,
          distance: camera.position.distanceTo(missileTarget.group.position),
          label: missileCooldown > 0 ? "SUPERSÔNICA / RECARGA" : "SUPERSÔNICA / TRAVA MÍSSIL"
        };
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

      if (!convoy) {
        planet.updateMatrixWorld(true);
        for (const moon of moons) {
          if (moon.cargo < 8) continue;
          radarVector.subVectors(moon.mine.getWorldPosition(new V3()), camera.position)
            .applyQuaternion(inverseQuaternion);
          let lx = radarVector.x * .42;
          let ly = radarVector.z * .42;
          const range = Math.hypot(lx, ly);
          if (range > 103) { lx *= 103 / range; ly *= 103 / range; }
          radar.fillStyle = "#edb36c";
          radar.fillRect(117 + lx, 117 + ly, 6, 6);
        }
      }

      if (convoy) {
        radarVector.subVectors(convoy.group.position, camera.position)
          .applyQuaternion(inverseQuaternion);
        let cx = radarVector.x * .42;
        let cy = radarVector.z * .42;
        const range = Math.hypot(cx, cy);
        if (range > 106) { cx *= 106 / range; cy *= 106 / range; }
        radar.strokeStyle = convoy.cargoShieldHp > 0 ? "#ffd24a" : "#ff8055";
        radar.lineWidth = 2;
        radar.beginPath();
        radar.arc(120 + cx, 120 + cy, 9 + Math.sin(time * 4) * 1.5, 0, Math.PI * 2);
        radar.stroke();
        radar.fillStyle = "#ffe0a0";
        radar.fillRect(115 + cx, 115 + cy, 10, 10);
        radar.fillStyle = "#123b43";
        radar.fillRect(118 + cx, 118 + cy, 4, 4);
      }

      if (rescueShip) {
        radarVector.subVectors(rescueShip.group.position, camera.position)
          .applyQuaternion(inverseQuaternion);
        let rx = radarVector.x * .42;
        let ry = radarVector.z * .42;
        const range = Math.hypot(rx, ry);
        if (range > 105) { rx *= 105 / range; ry *= 105 / range; }
        radar.fillStyle = "#8df4d6";
        radar.fillRect(116 + rx, 116 + ry, 8, 8);
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
      for (const moon of moons) {
        moon.orbit.rotation.y += dt * (moon.radius > 70 ? .008 : -.005);
        moon.moon.rotation.y += dt * .015;
        moon.drill.position.y = 11 + (moon.ore > 0 ? Math.sin(time * 5 + moon.phase) * 2 : 0);
        moon.bit.rotation.y += dt * (moon.ore > 0 ? 6 : .2);
        moon.beltOre.forEach((piece, index) => {
          piece.position.x = ((time * 9 + index * 6 + moon.phase * 3) % 30) - 1;
          piece.visible = moon.ore > 0 && moon.cargo < 60;
        });
        moon.rover.position.set(35 + Math.sin(time * .42 + moon.phase) * 11,
          5, 17);
        moon.rover.rotation.y = Math.sin(time * .42 + moon.phase) > 0 ? Math.PI : 0;
      }
      if (active) {
        moons.forEach((moon, index) => {
          moon.mineIntegrity = Math.min(100, moon.mineIntegrity + dt * .22);
          const extracted = Math.min(moon.ore,
            dt * [.22, .17, .12][index] * (.15 + .85 * moon.mineIntegrity / 100));
          moon.ore -= extracted;
          moon.cargo = Math.min(60, moon.cargo + extracted);
        });
        if (!miningReadyNotified && moons.some(moon => moon.cargo >= 8)) {
          miningReadyNotified = true;
          queueEvent("MINERAÇÃO // CARGA LUNAR PRONTA · APROXIME-SE DAS LUAS NO RADAR", "ally");
        }
      }
      cloudShell.rotation.y += dt * .007;
      cloudShell.material.uniforms.time.value = time;

      stationRings.forEach((ring, i) => {
        ring.rotation.z += dt * (i % 2 ? -.16 : .12);
      });
      station.rotation.y += dt * .025;
      beaconMaterial.color.setHex(Math.sin(time * 3.5) > 0 ? 0xffa052 : 0x573a30);

      const speedFactor = clamp(velocity.length() / CONFIG.boostSpeed, 0, 1);
      streakMaterial.opacity = speedFactor * .15 + warpVisual * .65;
      streakGeo.setDrawRange(0, (turboStreaks ? turboStreakCount : streakCount) * 2);

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

      if (cinematic && bloom) {
        cinematic.uniforms.time.value = time;
        cinematic.uniforms.warp.value = warpVisual;
        cinematic.uniforms.damage.value = damage;
        bloom.strength = 1.0 + warpVisual * .55;
      }
    }

    let autoReduced = false;
    let qualityWarmup = 3;
    let qualityWindow = 0;
    let qualityFrames = 0;
    const effectiveQuality = () => settings.quality.value === "auto" && autoReduced
      ? "low" : settings.quality.value;

    function applyQuality() {
      const quality = effectiveQuality();
      setCapitalShipDetail(mothership, quality !== "low");
      if (quality !== "low" && mothership.visible) requestMothershipVisual();
      const ratio = quality === "low" ? .75 : quality === "high"
        ? Math.min(window.devicePixelRatio || 1, 1.5) : CONFIG.pixelRatio;
      renderer.setPixelRatio(ratio);
      renderer.setSize(innerWidth, innerHeight);
      composer?.setPixelRatio(ratio);
      composer?.setSize(innerWidth, innerHeight);
      if (active && quality !== "low") requestPostprocessing();
      starGeo.setDrawRange(0, quality === "low" ? Math.floor(CONFIG.stars * .4) : CONFIG.stars);
      visibleParticleCount = quality === "low" ? Math.max(100, Math.floor(CONFIG.particles * .4)) : CONFIG.particles;
      if (quality === "low") particleLives.fill(0, visibleParticleCount);
      particleGeo.setDrawRange(0, visibleParticleCount);
      particleGeo.attributes.life.needsUpdate = true;
      particleMaterial.uniforms.dpr.value = ratio;
      cloudShell.visible = quality !== "low";
      stationDetails.visible = quality !== "low";
      for (const ally of allies) ally.beacon.visible = quality !== "low";
      if (quality !== "high") {
        for (const impact of impacts) {
          if (impact.light) { scene.remove(impact.light); impact.light = null; }
        }
      }
    }
    settings.quality.addEventListener("change", () => {
      autoReduced = false;
      qualityWarmup = 3;
      qualityWindow = qualityFrames = 0;
      applyQuality();
    });

    function monitorPerformance(elapsed) {
      if (!active || settings.quality.value !== "auto" || autoReduced) return;
      if (elapsed <= 0 || elapsed > .1) {
        qualityWindow = qualityFrames = 0;
        return;
      }
      if (qualityWarmup > 0) {
        qualityWarmup -= elapsed;
        return;
      }
      qualityWindow += elapsed;
      qualityFrames++;
      if (qualityWindow < 8) return;
      if (qualityFrames / qualityWindow < 45) {
        autoReduced = true;
        applyQuality();
        queueEvent("GRÁFICOS // QUALIDADE AUTOMÁTICA REDUZIDA PARA MANTER A FLUIDEZ");
      }
      qualityWindow = qualityFrames = 0;
    }

    window.addEventListener("resize", () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
      composer?.setSize(innerWidth, innerHeight);
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
      const elapsed = (now - lastTime) / 1000;
      const dt = Math.min(elapsed, .033);
      lastTime = now;

      pollGamepad();
      monitorPerformance(elapsed);

      if (active) {
        time += dt;

        updatePlayer(dt);
        updateWorldObjects(dt);
        updateRescueShip(dt);
        updateConvoy(dt);
        updateSiege(dt);
        updateDrones(dt);
        updateGuidedMissiles(dt);
        updateAllies(dt);
        updateBoss(dt);
        updateMothership(dt);
        updateDistantBattles(dt);
        updateAlliedBeams(dt);
        updatePlanetDefenses(dt);
        updateBullets(dt);
        updateBombs(dt);
        updateParticles(dt);
        updateStationExplosions(dt);
        updateImpacts(dt);
        updateEnvironment(dt);
        updateCivilization(dt);
        updateMissionEvents(dt);
        updateChancellor(dt);
      } else if (!started) {
        // Cena de apresentação animada sem iniciar o combate.
        time += dt;
        updateEnvironment(dt);
      }

      camera.updateMatrixWorld();
      updateHUD();
      if (composer && effectiveQuality() !== "low") composer.render(dt);
      else renderer.render(scene, camera);
    }

    requestAnimationFrame(frame);
