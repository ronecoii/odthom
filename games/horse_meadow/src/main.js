import * as THREE from "../vendor/three.module.js";

const canvas = document.querySelector("#world");
const startButton = document.querySelector("#start");
const staminaBar = document.querySelector("#stamina");
const regionLabel = document.querySelector("#region");
const interactionLabel = document.querySelector("#interaction");
const controllerLabel = document.querySelector("#controller");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x89c6dc);
scene.fog = new THREE.Fog(0x9fcfd4, 60, 250);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 500);

const sun = new THREE.DirectionalLight(0xfff1c2, 2.25);
sun.position.set(-32, 64, 24);
sun.castShadow = true;
sun.shadow.camera.left = -80;
sun.shadow.camera.right = 80;
sun.shadow.camera.top = 80;
sun.shadow.camera.bottom = -80;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xdcefff, 0x64775c, 1.85));

const keys = new Set();
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const gamepadState = {
  forward: 0,
  turn: 0,
  cameraX: 0,
  cameraY: 0,
  gallop: false,
  hop: false,
  interact: false,
  feed: false,
  capture: false,
};
const worldSize = 260;
const terrainSegments = 156;
const waterCenterZ = -12;
const waterDepth = 20;
const waterSurfaceY = -1.55;
const stableSpot = { x: 18, z: 54, rotation: Math.PI + 0.08 };
const stablePadHeight = rawGroundHeight(stableSpot.x, stableSpot.z);
const terrain = createTerrain();
let horse = createHorse(0x7a4a2b, 0x2a2018);
const player = createWalker();
const mountedPlayerOffset = new THREE.Vector3(-0.12, 2.08, 0);
const herd = [];
const trees = [];
const flowers = [];
const clouds = [];
const critters = [];
const objectColliders = [];
const gateState = {
  group: undefined,
  collider: undefined,
  open: false,
  openness: 0,
  hingeLocal: { x: 11.2, z: 13.2 },
  latchLocal: { x: 11.2, z: 1.2 },
};

let yaw = 0;
let cameraYaw = 0;
let cameraPitch = 0.42;
let stamina = 1;
let verticalVelocity = 0;
let isDragging = false;
let lastPointer = { x: 0, y: 0 };
let audioStarted = false;
let audioContext;
let breathOsc;
let activeGamepadIndex = undefined;
let isMounted = true;
let playerYaw = 0;
let careNoticeTime = 0;
let lastGamepadInteract = false;
let lastGamepadFeed = false;
let lastGamepadCapture = false;
let lastControllerLabel = "";
let lastControllerStatusTime = -1;

scene.add(terrain.mesh, terrain.water);
scene.add(horse.root);
horse.root.position.set(0, horseGroundHeight(0, 34), 34);
player.root.visible = true;
scene.add(player.root);
scene.add(createStable());
registerStableColliders();
scatterTrees();
scatterFlowers();
scatterHorses();
scatterCritters();
createSky();
resize();
requestAnimationFrame(tick);

window.addEventListener("resize", resize);
window.addEventListener("keydown", (event) => {
  keys.add(event.key.toLowerCase());
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(event.key.toLowerCase())) {
    event.preventDefault();
  }
  if (event.key.toLowerCase() === "e" && !event.repeat) handleInteract();
  if (event.key.toLowerCase() === "f" && !event.repeat) handleFeed();
  if (event.key.toLowerCase() === "c" && !event.repeat) handleCapture();
});
window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));

canvas.addEventListener("pointerdown", (event) => {
  canvas.focus();
  isDragging = true;
  lastPointer = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!isDragging) return;
  const dx = event.clientX - lastPointer.x;
  const dy = event.clientY - lastPointer.y;
  cameraYaw = normalizeAngle(cameraYaw - dx * 0.006);
  cameraPitch = THREE.MathUtils.clamp(cameraPitch + dy * 0.004, 0.12, 0.9);
  lastPointer = { x: event.clientX, y: event.clientY };
});

canvas.addEventListener("pointerup", () => {
  isDragging = false;
});

canvas.addEventListener("dblclick", switchToClickedHorse);

startButton.addEventListener("click", () => {
  startGame();
});

window.addEventListener("gamepadconnected", (event) => {
  activeGamepadIndex = event.gamepad.index;
  updateControllerLabel(`Controller connected: ${controllerName(event.gamepad)}`);
});

window.addEventListener("gamepaddisconnected", (event) => {
  if (activeGamepadIndex === event.gamepad.index) activeGamepadIndex = undefined;
  updateControllerLabel("Controller disconnected");
});

function updateGamepadState(dt) {
  const gamepad = getActiveGamepad();
  if (!gamepad) {
    gamepadState.forward = 0;
    gamepadState.turn = 0;
    gamepadState.cameraX = 0;
    gamepadState.cameraY = 0;
    gamepadState.gallop = false;
    gamepadState.hop = false;
    gamepadState.interact = false;
    gamepadState.feed = false;
    gamepadState.capture = false;
    updateNoControllerStatus();
    return;
  }

  if (padHasInput(gamepad)) startGame();

  const leftStick = readLeftStick(gamepad);
  const rightStick = readRightStick(gamepad, leftStick);
  const dpadX = Number(gamepad.buttons[15]?.pressed) - Number(gamepad.buttons[14]?.pressed);
  const dpadY = Number(gamepad.buttons[12]?.pressed) - Number(gamepad.buttons[13]?.pressed);

  gamepadState.turn = strongestInput(leftStick.x, dpadX);
  gamepadState.forward = strongestInput(-leftStick.y, dpadY);
  gamepadState.cameraX = rightStick.x;
  gamepadState.cameraY = rightStick.y;
  gamepadState.hop = isButtonDown(gamepad, 0);
  gamepadState.interact = isButtonDown(gamepad, 2);
  gamepadState.feed = isButtonDown(gamepad, 3);
  gamepadState.capture = isButtonDown(gamepad, 1);
  gamepadState.gallop = isButtonDown(gamepad, 7, 0.35) || isButtonDown(gamepad, 5, 0.35);
  updateControllerStatus(gamepad, leftStick, rightStick);

  cameraYaw = normalizeAngle(cameraYaw - gamepadState.cameraX * dt * 2.25);
  cameraPitch = THREE.MathUtils.clamp(cameraPitch + gamepadState.cameraY * dt * 1.45, 0.12, 0.9);
}

function getActiveGamepad() {
  if (!navigator.getGamepads) return undefined;
  const pads = Array.from(navigator.getGamepads()).filter((pad) => pad?.connected);
  const current = pads.find((pad) => pad.index === activeGamepadIndex);
  if (current) return current;

  const active = pads.find((pad) => padHasInput(pad));
  activeGamepadIndex = active?.index ?? pads[0]?.index;
  return active ?? pads[0];
}

function connectedGamepadCount() {
  if (!navigator.getGamepads) return 0;
  return Array.from(navigator.getGamepads()).filter((pad) => pad?.connected).length;
}

function applyDeadZone(value) {
  const deadZone = 0.18;
  const magnitude = Math.abs(value);
  if (magnitude < deadZone) return 0;
  return Math.sign(value) * ((magnitude - deadZone) / (1 - deadZone));
}

function readLeftStick(gamepad) {
  const fallback = readAxisPair(gamepad, 0, 1);
  if (fallback.active || gamepad.mapping === "standard") return fallback;

  const activePair = [
    [0, 1],
    [1, 2],
  ].map(([xIndex, yIndex]) => readAxisPair(gamepad, xIndex, yIndex)).find((pair) => pair.active);

  return activePair ?? fallback;
}

function readRightStick(gamepad, leftStick) {
  const axisPairs = gamepad.mapping === "standard" || gamepad.axes.length <= 4 ? [[2, 3]] : [[3, 4], [2, 3], [2, 5]];
  for (const [xIndex, yIndex] of axisPairs) {
    const pair = readAxisPair(gamepad, xIndex, yIndex);
    if (pair.active && (pair.xIndex !== leftStick.xIndex || pair.yIndex !== leftStick.yIndex)) return pair;
  }

  const [xIndex, yIndex] = axisPairs[0];
  return readAxisPair(gamepad, xIndex, yIndex);
}

function readAxisPair(gamepad, xIndex, yIndex) {
  const x = applyDeadZone(gamepad.axes[xIndex] ?? 0);
  const y = applyDeadZone(gamepad.axes[yIndex] ?? 0);
  return { x, y, xIndex, yIndex, active: Math.abs(x) > 0 || Math.abs(y) > 0 };
}

function strongestInput(primary, fallback) {
  return Math.abs(primary) >= Math.abs(fallback) ? primary : fallback;
}

function isButtonDown(gamepad, index, threshold = 0.5) {
  const button = gamepad.buttons[index];
  return Boolean(button?.pressed || button?.value > threshold);
}

function padHasInput(gamepad) {
  return gamepad.axes.some((axis) => Math.abs(axis) > 0.2) || gamepad.buttons.some((button) => button.pressed || button.value > 0.25);
}

function startGame() {
  startButton.classList.add("hidden");
  canvas.focus();
  startAudio();
}

function controllerName(gamepad) {
  return gamepad.id ? gamepad.id.replace(/\s*\([^)]*\)/g, "").slice(0, 36) : "gamepad";
}

function updateControllerLabel(text, ready = false) {
  if (!controllerLabel || text === lastControllerLabel) return;
  lastControllerLabel = text;
  controllerLabel.textContent = text;
  controllerLabel.classList.toggle("controller-ready", ready);
}

function updateControllerStatus(gamepad, leftStick, rightStick) {
  const timeSlice = Math.floor(clock.elapsedTime * 2);
  if (timeSlice === lastControllerStatusTime) return;
  lastControllerStatusTime = timeSlice;

  const buttons = gamepad.buttons
    .map((button, index) => (button.pressed || button.value > 0.25 ? index : undefined))
    .filter((index) => index !== undefined)
    .join(",");
  const label = [
    `Controller ready: ${controllerName(gamepad)}`,
    `Move ${leftStick.xIndex}/${leftStick.yIndex}  Camera ${rightStick.xIndex}/${rightStick.yIndex}`,
    buttons ? `Buttons ${buttons}` : "Press a button if sticks do not move",
  ].join("\n");
  updateControllerLabel(label, true);
}

function updateNoControllerStatus() {
  const timeSlice = Math.floor(clock.elapsedTime * 2);
  if (timeSlice === lastControllerStatusTime) return;
  lastControllerStatusTime = timeSlice;

  if (!navigator.getGamepads) {
    updateControllerLabel("Controller unavailable: this browser does not expose the Gamepad API");
    return;
  }

  const count = connectedGamepadCount();
  updateControllerLabel(count ? `Chrome sees ${count} controller, press any button` : "Chrome sees 0 controllers\nClick Ride, then press a controller button");
}

function createTerrain() {
  const geometry = new THREE.PlaneGeometry(worldSize, worldSize, terrainSegments, terrainSegments);
  geometry.rotateX(-Math.PI / 2);
  const colors = [];
  const position = geometry.attributes.position;

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = groundHeight(x, z);
    position.setY(i, y);
    const tint = THREE.MathUtils.clamp((y + 5) / 24, 0, 1);
    const base = new THREE.Color(0x5f8f55).lerp(new THREE.Color(0xb3bf6a), tint * 0.7);
    if (nearRiver(x, z)) base.lerp(new THREE.Color(0x6d9a62), 0.38);
    colors.push(base.r, base.g, base.b);
  }

  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    map: createGrassTexture(),
    roughness: 0.92,
    vertexColors: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;

  const waterGeometry = createRiverGeometry();
  const water = new THREE.Mesh(
    waterGeometry,
    new THREE.MeshStandardMaterial({
      color: 0x5aa8b4,
      roughness: 0.38,
      metalness: 0.05,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
    }),
  );
  water.receiveShadow = true;

  return { mesh, water };
}

function createRiverGeometry() {
  const lengthSegments = 168;
  const widthSegments = 8;
  const halfWidth = waterDepth / 2;
  const vertices = [];
  const uvs = [];
  const indices = [];

  for (let ix = 0; ix <= lengthSegments; ix += 1) {
    const x = -worldSize / 2 + (ix / lengthSegments) * worldSize;
    const centerZ = riverCenterZ(x);
    for (let iz = 0; iz <= widthSegments; iz += 1) {
      const t = iz / widthSegments;
      const edge = t * 2 - 1;
      const z = centerZ + edge * halfWidth;
      const bankLift = Math.abs(edge) * 0.08;
      vertices.push(x, riverWaterHeight(x, z) + bankLift, z);
      uvs.push(ix / 12, t);
    }
  }

  const row = widthSegments + 1;
  for (let ix = 0; ix < lengthSegments; ix += 1) {
    for (let iz = 0; iz < widthSegments; iz += 1) {
      const a = ix * row + iz;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

function createGrassTexture() {
  const size = 256;
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = size;
  textureCanvas.height = size;
  const context = textureCanvas.getContext("2d");

  context.fillStyle = "#7d9d58";
  context.fillRect(0, 0, size, size);

  for (let i = 0; i < 1800; i += 1) {
    const x = rand(0, size);
    const y = rand(0, size);
    const length = rand(3, 12);
    const angle = rand(-0.7, 0.7);
    const shade = pick(["#5d7f43", "#6f9552", "#92ad63", "#b2bc72", "#486b38"]);
    context.strokeStyle = shade;
    context.globalAlpha = rand(0.18, 0.48);
    context.lineWidth = rand(0.45, 1.25);
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + Math.sin(angle) * length, y - Math.cos(angle) * length);
    context.stroke();
  }

  for (let i = 0; i < 420; i += 1) {
    context.globalAlpha = rand(0.12, 0.28);
    context.fillStyle = pick(["#e0d479", "#d9ecb6", "#c78970", "#8ec1cf"]);
    context.fillRect(rand(0, size), rand(0, size), rand(0.8, 1.8), rand(0.8, 1.8));
  }

  context.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(34, 34);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  return texture;
}

function createHorse(bodyColor, maneColor) {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.68 });
  const darkMat = new THREE.MeshStandardMaterial({ color: maneColor, roughness: 0.82 });
  const creamMat = new THREE.MeshStandardMaterial({ color: 0xf1e1bc, roughness: 0.74 });

  const body = ellipsoid(2.55, 1.16, 0.9, bodyMat, 0, 1.55, 0);
  body.castShadow = true;
  root.add(body);

  const chest = ellipsoid(0.82, 0.98, 0.8, bodyMat, 1.05, 1.62, 0);
  chest.rotation.z = -0.18;
  root.add(chest);

  const neck = ellipsoid(0.68, 1.28, 0.62, bodyMat, 1.42, 2.17, 0);
  neck.rotation.z = -0.55;
  root.add(neck);

  const head = ellipsoid(0.92, 0.58, 0.52, bodyMat, 2.03, 2.49, 0);
  root.add(head);

  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0d0b08, roughness: 0.45 });
  const eyeA = ellipsoid(0.08, 0.1, 0.055, eyeMat, 2.28, 2.58, -0.27);
  const eyeB = ellipsoid(0.08, 0.1, 0.055, eyeMat, 2.28, 2.58, 0.27);
  root.add(eyeA, eyeB);

  const muzzle = ellipsoid(0.38, 0.34, 0.4, creamMat, 2.5, 2.42, 0);
  root.add(muzzle);

  const nostrilA = ellipsoid(0.055, 0.04, 0.035, eyeMat, 2.68, 2.44, -0.13);
  const nostrilB = ellipsoid(0.055, 0.04, 0.035, eyeMat, 2.68, 2.44, 0.13);
  root.add(nostrilA, nostrilB);

  const mane = box(0.22, 1.22, 0.12, darkMat, 1.44, 2.25, 0.31);
  mane.rotation.z = -0.55;
  root.add(mane);

  const tail = cone(0.2, 1.18, darkMat, -1.42, 1.42, 0);
  tail.rotation.z = 0.78;
  tail.rotation.y = Math.PI / 2;
  root.add(tail);

  const legs = [];
  for (const x of [-0.72, 0.78]) {
    for (const z of [-0.28, 0.28]) {
      const upperLeg = ellipsoid(0.22, 0.72, 0.2, bodyMat, x, 0.94, z);
      const lowerLeg = ellipsoid(0.18, 0.62, 0.16, bodyMat, x + 0.03, 0.38, z);
      const hoof = box(0.32, 0.16, 0.3, darkMat, x + 0.04, 0.08, z);
      root.add(upperLeg, lowerLeg, hoof);
      legs.push({ leg: upperLeg, lowerLeg, hoof, x, z });
    }
  }

  const earA = cone(0.14, 0.35, bodyMat, 1.88, 2.9, -0.16);
  const earB = cone(0.14, 0.35, bodyMat, 1.88, 2.9, 0.16);
  root.add(earA, earB);

  const careIndicator = createCareIndicator();
  careIndicator.visible = false;
  root.add(careIndicator);
  const feedIndicator = createFeedIndicator();
  feedIndicator.visible = false;
  root.add(feedIndicator);

  root.scale.setScalar(1.25);
  root.position.y = horseGroundHeight(0, 0);
  root.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });

  const model = {
    root,
    body,
    chest,
    bodyBaseScale: body.scale.clone(),
    chestBaseScale: chest.scale.clone(),
    legs,
    tail,
    head,
    careIndicator,
    feedIndicator,
    care: 0.35,
    fed: 0.35,
    carePulse: 0,
    feedPulse: 0,
    baseScale: 1.25,
    growth: 0,
    maxGrowth: 2.2,
    owned: false,
    affection: 0,
    followsPlayer: false,
    isFoal: false,
    rideable: true,
    phase: rand(0, Math.PI * 2),
    speed: rand(0.25, 0.55),
  };
  root.userData.horse = model;
  root.traverse((child) => {
    child.userData.horse = model;
  });

  return model;
}

function createFoal(bodyColor, maneColor) {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.72 });
  const darkMat = new THREE.MeshStandardMaterial({ color: maneColor, roughness: 0.84 });
  const creamMat = new THREE.MeshStandardMaterial({ color: 0xf2dfbd, roughness: 0.78 });

  const body = ellipsoid(1.42, 0.74, 0.54, bodyMat, 0, 1.04, 0);
  const chest = ellipsoid(0.46, 0.62, 0.5, bodyMat, 0.62, 1.08, 0);
  chest.rotation.z = -0.12;
  const neck = ellipsoid(0.36, 0.72, 0.34, bodyMat, 0.96, 1.46, 0);
  neck.rotation.z = -0.45;
  const head = ellipsoid(0.56, 0.4, 0.36, bodyMat, 1.32, 1.72, 0);
  const muzzle = ellipsoid(0.24, 0.22, 0.26, creamMat, 1.64, 1.68, 0);
  root.add(body, chest, neck, head, muzzle);

  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0d0b08, roughness: 0.45 });
  root.add(
    ellipsoid(0.055, 0.07, 0.04, eyeMat, 1.48, 1.79, -0.19),
    ellipsoid(0.055, 0.07, 0.04, eyeMat, 1.48, 1.79, 0.19),
    ellipsoid(0.035, 0.025, 0.025, eyeMat, 1.78, 1.69, -0.09),
    ellipsoid(0.035, 0.025, 0.025, eyeMat, 1.78, 1.69, 0.09),
  );

  const mane = box(0.14, 0.7, 0.08, darkMat, 0.95, 1.5, 0.22);
  mane.rotation.z = -0.45;
  const tail = cone(0.12, 0.66, darkMat, -0.82, 0.96, 0);
  tail.rotation.z = 0.72;
  tail.rotation.y = Math.PI / 2;
  root.add(mane, tail);

  const legs = [];
  for (const x of [-0.42, 0.48]) {
    for (const z of [-0.18, 0.18]) {
      const upperLeg = ellipsoid(0.13, 0.45, 0.12, bodyMat, x, 0.63, z);
      const lowerLeg = ellipsoid(0.1, 0.44, 0.09, bodyMat, x + 0.02, 0.28, z);
      const hoof = box(0.18, 0.1, 0.18, darkMat, x + 0.03, 0.07, z);
      root.add(upperLeg, lowerLeg, hoof);
      legs.push({ leg: upperLeg, lowerLeg, hoof, x, z });
    }
  }

  root.add(cone(0.09, 0.24, bodyMat, 1.22, 2.0, -0.11), cone(0.09, 0.24, bodyMat, 1.22, 2.0, 0.11));

  const careIndicator = createCareIndicator();
  careIndicator.visible = false;
  careIndicator.position.set(0.42, 2.75, 0);
  root.add(careIndicator);
  const feedIndicator = createFeedIndicator();
  feedIndicator.visible = false;
  feedIndicator.position.set(0.32, 2.62, 0);
  root.add(feedIndicator);

  root.scale.setScalar(rand(0.92, 1.05));
  root.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });

  const model = {
    root,
    body,
    chest,
    bodyBaseScale: body.scale.clone(),
    chestBaseScale: chest.scale.clone(),
    legs,
    tail,
    head,
    careIndicator,
    feedIndicator,
    care: 0.55,
    fed: 0.45,
    carePulse: 0,
    feedPulse: 0,
    baseScale: root.scale.x,
    adultScale: 1.9,
    growth: 0,
    maxGrowth: 1,
    owned: false,
    affection: 0,
    followsPlayer: false,
    isFoal: true,
    rideable: false,
    phase: rand(0, Math.PI * 2),
    speed: rand(0.38, 0.72),
  };
  root.userData.horse = model;
  root.traverse((child) => {
    child.userData.horse = model;
  });

  return model;
}

function createWalker() {
  const root = new THREE.Group();
  const skinMat = new THREE.MeshStandardMaterial({ color: pick([0xd6a87a, 0xb9825f, 0xf0c7a0]), roughness: 0.72 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: pick([0x2f6f7e, 0x8e5f3f, 0x576f3a, 0x72578e]), roughness: 0.78 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pick([0x263447, 0x3e3a32, 0x4c5f73]), roughness: 0.82 });
  const hairMat = new THREE.MeshStandardMaterial({ color: pick([0x2b1c14, 0x5a3824, 0xe4c073]), roughness: 0.85 });

  const torso = ellipsoid(0.38, 0.82, 0.28, shirtMat, 0, 1.52, 0);
  const head = ellipsoid(0.28, 0.34, 0.28, skinMat, 0.05, 2.28, 0);
  const hair = ellipsoid(0.3, 0.16, 0.29, hairMat, 0.02, 2.48, 0);
  const hat = cone(0.24, 0.24, hairMat, 0, 2.68, 0);
  hat.rotation.z = 0;
  root.add(torso, head, hair, hat);

  const arms = [];
  for (const z of [-0.26, 0.26]) {
    const arm = box(0.13, 0.68, 0.13, skinMat, 0.08, 1.5, z);
    arm.rotation.z = z < 0 ? -0.28 : 0.28;
    root.add(arm);
    arms.push(arm);
  }

  const legs = [];
  for (const z of [-0.13, 0.13]) {
    const leg = box(0.17, 0.74, 0.16, pantsMat, 0, 0.68, z);
    const boot = box(0.22, 0.14, 0.2, pantsMat, 0.08, 0.16, z);
    root.add(leg, boot);
    legs.push(leg);
  }

  root.scale.setScalar(1.15);
  root.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });

  return { root, arms, legs };
}

function createCareIndicator() {
  const root = new THREE.Group();
  const careMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8 });
  const leafMat = new THREE.MeshBasicMaterial({ color: 0x9fda8d });
  const left = ellipsoid(0.12, 0.12, 0.08, careMat, -0.08, 0, 0);
  const right = ellipsoid(0.12, 0.12, 0.08, careMat, 0.08, 0, 0);
  const drop = cone(0.15, 0.22, careMat, 0, -0.14, 0);
  drop.rotation.z = Math.PI;
  const leaf = ellipsoid(0.08, 0.04, 0.03, leafMat, 0.22, 0.08, 0);
  root.add(left, right, drop, leaf);
  root.position.set(0.7, 3.95, 0);
  return root;
}

function createFeedIndicator() {
  const root = new THREE.Group();
  const hayMat = new THREE.MeshBasicMaterial({ color: 0xf0ce69 });
  const carrotMat = new THREE.MeshBasicMaterial({ color: 0xf28a32 });
  const leafMat = new THREE.MeshBasicMaterial({ color: 0x79c56e });

  const hayA = box(0.42, 0.08, 0.08, hayMat, -0.08, 0, 0);
  hayA.rotation.z = 0.25;
  const hayB = box(0.42, 0.08, 0.08, hayMat, 0.08, 0.12, 0);
  hayB.rotation.z = -0.22;
  const carrot = cone(0.1, 0.38, carrotMat, 0.28, -0.02, 0);
  carrot.rotation.z = -Math.PI / 2;
  const leaf = ellipsoid(0.08, 0.04, 0.03, leafMat, 0.1, 0.03, 0);
  root.add(hayA, hayB, carrot, leaf);
  root.position.set(0.72, 3.55, 0);
  return root;
}

function scatterTrees() {
  for (let i = 0; i < 135; i += 1) {
    const x = rand(-125, 125);
    const z = rand(-125, 125);
    if (Math.hypot(x, z) < 16 || Math.hypot(x, z - 28) < 34 || isUnderWater(x, z) || nearRiver(x, z) || nearStable(x, z)) continue;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.36, rand(2.5, 4.2), 7),
      new THREE.MeshStandardMaterial({ color: 0x73563c, roughness: 0.9 }),
    );
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(rand(1.2, 2.1), rand(3.3, 5.4), 8),
      new THREE.MeshStandardMaterial({ color: pick([0x2f6544, 0x3d7a4c, 0x5b7d46]), roughness: 0.78 }),
    );
    trunk.position.y = trunk.geometry.parameters.height / 2;
    crown.position.y = trunk.geometry.parameters.height + crown.geometry.parameters.height * 0.36;
    tree.add(trunk, crown);
    tree.position.set(x, groundHeight(x, z), z);
    tree.rotation.y = rand(0, Math.PI);
    tree.scale.setScalar(rand(0.75, 1.5));
    tree.traverse((child) => {
      if (child.isMesh) child.castShadow = true;
    });
    trees.push(tree);
    objectColliders.push({ type: "circle", x, z, radius: 0.75 * tree.scale.x });
    scene.add(tree);
  }
}

function scatterFlowers() {
  const mats = [0xf3d166, 0xe8858d, 0xf8f2e0, 0x7eb6d9].map(
    (color) => new THREE.MeshBasicMaterial({ color }),
  );
  for (let i = 0; i < 420; i += 1) {
    const x = rand(-80, 80);
    const z = rand(-88, 92);
    if (nearRiver(x, z) || nearStable(x, z, 4)) continue;
    const flower = new THREE.Mesh(new THREE.OctahedronGeometry(rand(0.055, 0.1), 0), pick(mats));
    flower.position.set(x, groundHeight(x, z) + rand(0.08, 0.22), z);
    flower.scale.y = rand(0.55, 1.4);
    flowers.push(flower);
    scene.add(flower);
  }
}

function scatterHorses() {
  const coats = [
    [0x99653b, 0x1f1a14],
    [0xd5b487, 0x463124],
    [0x352a23, 0x0f0d0b],
    [0xb76d42, 0xeadfcb],
    [0xc9c6b9, 0x2a2926],
  ];
  for (let i = 0; i < 8; i += 1) {
    const [coat, mane] = coats[i % coats.length];
    const other = createHorse(coat, mane);
    placeHerdHorse(other, 92);
    other.root.position.y = horseGroundHeight(other.root.position.x, other.root.position.z);
    other.root.rotation.y = rand(-Math.PI, Math.PI);
    herd.push(other);
    scene.add(other.root);
  }

  for (let i = 0; i < 5; i += 1) {
    const [coat, mane] = coats[(i + 1) % coats.length];
    const foal = createFoal(coat, mane);
    placeFoal(foal, i);
    foal.root.rotation.y = rand(-Math.PI, Math.PI);
    herd.push(foal);
    scene.add(foal.root);
  }
}

function scatterCritters() {
  for (let i = 0; i < 18; i += 1) {
    const critter = i % 2 === 0 ? createRabbit() : createSquirrel();
    placeCritter(critter, 110);
    critter.root.rotation.y = rand(-Math.PI, Math.PI);
    critter.phase = rand(0, Math.PI * 2);
    critter.pause = rand(0, 1.8);
    critters.push(critter);
    scene.add(critter.root);
  }
}

function placeCritter(critter, range) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const x = rand(-range, range);
    const z = rand(-range, range);
    if (Math.hypot(x, z - 34) < 18 || nearRiver(x, z) || isUnderWater(x, z) || nearStable(x, z, 5)) continue;
    critter.root.position.set(x, groundHeight(x, z), z);
    return;
  }
  critter.root.position.set(rand(-35, 35), groundHeight(0, 48), 48);
}

function placeHerdHorse(other, range) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const x = rand(-range, range);
    const z = rand(-range, range);
    if (nearRiver(x, z) || isUnderWater(x, z) || nearStable(x, z, 6)) continue;
    other.root.position.set(x, 0, z);
    return;
  }
  other.root.position.set(rand(-28, 28), 0, 42);
}

function placeFoal(foal, index) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const angle = rand(0, Math.PI * 2);
    const distance = rand(12, 28);
    const x = stableSpot.x + Math.cos(angle) * distance;
    const z = stableSpot.z + Math.sin(angle) * distance + index * 1.4;
    if (nearRiver(x, z) || isUnderWater(x, z)) continue;
    foal.root.position.set(x, horseGroundHeight(x, z), z);
    return;
  }
  foal.root.position.set(stableSpot.x + index * 2.4 - 4.8, horseGroundHeight(stableSpot.x, stableSpot.z + 18), stableSpot.z + 18);
}

function createStable() {
  const root = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.9 });
  const plankMat = new THREE.MeshStandardMaterial({ color: 0x734724, roughness: 0.94 });
  const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x3f2818, roughness: 0.92 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a3128, roughness: 0.9 });
  const roofEdgeMat = new THREE.MeshStandardMaterial({ color: 0x2f211b, roughness: 0.94 });
  const hayMat = new THREE.MeshStandardMaterial({ color: 0xd3ae57, roughness: 0.96 });
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x6b5330, roughness: 0.98 });
  const troughMat = new THREE.MeshStandardMaterial({ color: 0x283738, roughness: 0.78 });
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x75bdd2, roughness: 0.2, metalness: 0.05 });
  const lanternMat = new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xff9c36, emissiveIntensity: 1.15, roughness: 0.35 });

  const floor = box(19, 0.3, 13.6, darkWoodMat, 0, 0.15, -0.25);
  floor.receiveShadow = true;
  root.add(floor);

  for (const x of [-8.75, -3.05, 3.05, 8.75]) {
    for (const z of [-6.15, 5.65]) {
      const post = box(0.48, 5.9, 0.48, darkWoodMat, x, 2.95, z);
      root.add(post);
    }
  }

  addPlankWall(root, "back", 0, -6.28, 18.0, 3.75, woodMat, plankMat);
  addPlankWall(root, "left", -8.95, -0.3, 11.4, 3.35, woodMat, plankMat);
  addPlankWall(root, "right", 8.95, -0.3, 11.4, 3.35, woodMat, plankMat);
  addGable(root, 6.02, woodMat, darkWoodMat);
  addGable(root, -6.52, woodMat, darkWoodMat);

  for (const x of [-2.9, 2.9]) {
    const divider = box(0.28, 2.3, 8.6, darkWoodMat, x, 1.35, -0.2);
    root.add(divider);
  }

  for (const stallX of [-5.85, 0, 5.85]) {
    addStallFront(root, stallX, darkWoodMat);
  }

  const roofLeft = box(10.8, 0.46, 15.0, roofMat, -4.95, 5.62, -0.25);
  roofLeft.rotation.z = 0.34;
  const roofRight = box(10.8, 0.46, 15.0, roofMat, 4.95, 5.62, -0.25);
  roofRight.rotation.z = -0.34;
  root.add(roofLeft, roofRight);

  const frontEave = box(20.2, 0.32, 0.38, roofEdgeMat, 0, 4.95, 6.95);
  const backEave = box(20.2, 0.32, 0.38, roofEdgeMat, 0, 4.95, -7.45);
  const loftBeam = box(18.7, 0.38, 0.36, darkWoodMat, 0, 4.2, 5.68);
  const ridgeBeam = box(0.46, 0.46, 15.2, roofEdgeMat, 0, 6.72, -0.25);
  root.add(frontEave, backEave, loftBeam, ridgeBeam);

  for (const x of [-6.3, -5.05, 4.8, 6.15]) {
    const bale = box(1.8, 0.72, 1.1, hayMat, x, 0.66, -4.35 + rand(-0.15, 0.15));
    bale.rotation.y = rand(-0.25, 0.25);
    const twineA = box(0.08, 0.78, 1.16, ropeMat, x - 0.45, 0.67, bale.position.z);
    const twineB = box(0.08, 0.78, 1.16, ropeMat, x + 0.45, 0.67, bale.position.z);
    twineA.rotation.y = bale.rotation.y;
    twineB.rotation.y = bale.rotation.y;
    root.add(bale, twineA, twineB);
  }

  addTrough(root, 11.1, 2.7, troughMat, waterMat);
  addBarrel(root, -10.7, -3.2, darkWoodMat);

  const lantern = ellipsoid(0.18, 0.24, 0.18, lanternMat, 0, 4.55, 5.45);
  const lanternFrame = box(0.52, 0.08, 0.52, darkWoodMat, 0, 4.28, 5.45);
  const lanternHook = box(0.08, 0.55, 0.08, darkWoodMat, 0, 4.88, 5.45);
  root.add(lantern, lanternFrame, lanternHook);

  createFenceRun(root, -11.8, 6.2, -11.8, 18.2, darkWoodMat);
  createFenceRun(root, -11.8, 18.2, 11.2, 18.2, darkWoodMat);
  createFenceRun(root, 11.2, 18.2, 11.2, gateState.hingeLocal.z, darkWoodMat);
  createGate(root, darkWoodMat);

  root.scale.y = 1.22;
  root.position.set(stableSpot.x, groundHeight(stableSpot.x, stableSpot.z), stableSpot.z);
  root.rotation.y = stableSpot.rotation;
  root.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return root;
}

function addPlankWall(root, side, x, z, length, height, woodMat, plankMat) {
  const plankCount = Math.floor(length / 0.95);
  for (let i = 0; i < plankCount; i += 1) {
    const offset = -length / 2 + (i + 0.5) * (length / plankCount);
    const material = i % 3 === 0 ? plankMat : woodMat;
    const boardHeight = height + rand(-0.12, 0.12);
    const board =
      side === "back"
        ? box(length / plankCount - 0.08, boardHeight, 0.18, material, offset, boardHeight / 2 + 0.32, z)
        : box(0.18, boardHeight, length / plankCount - 0.08, material, x, boardHeight / 2 + 0.32, z + offset);
    root.add(board);
  }

  if (side === "back") {
    root.add(box(length + 0.45, 0.22, 0.24, plankMat, x, 1.2, z - 0.03));
    root.add(box(length + 0.45, 0.22, 0.24, plankMat, x, 2.55, z - 0.03));
    root.add(box(length + 0.45, 0.24, 0.24, plankMat, x, height + 0.42, z - 0.03));
  } else {
    root.add(box(0.24, 0.22, length + 0.45, plankMat, x, 1.2, z));
    root.add(box(0.24, 0.22, length + 0.45, plankMat, x, 2.55, z));
    root.add(box(0.24, 0.24, length + 0.45, plankMat, x, height + 0.42, z));
  }
}

function addGable(root, z, woodMat, darkWoodMat) {
  for (let i = -4; i <= 4; i += 1) {
    const x = i * 1.05;
    const height = 1.0 + Math.max(0, 4.5 - Math.abs(i)) * 0.38;
    const plank = box(0.82, height, 0.2, woodMat, x, 4.18 + height / 2, z);
    root.add(plank);
  }

  const beamA = box(10.5, 0.22, 0.24, darkWoodMat, -2.5, 5.7, z + 0.02);
  beamA.rotation.z = 0.34;
  const beamB = box(10.5, 0.22, 0.24, darkWoodMat, 2.5, 5.7, z + 0.02);
  beamB.rotation.z = -0.34;
  const loftWindow = box(1.25, 0.9, 0.24, darkWoodMat, 0, 5.25, z + 0.04);
  root.add(beamA, beamB, loftWindow);
}

function addStallFront(root, x, material) {
  const railWidth = 4.75;
  root.add(box(railWidth, 0.22, 0.24, material, x, 1.55, 5.68));
  root.add(box(railWidth, 0.22, 0.24, material, x, 2.45, 5.68));
  root.add(box(0.24, 2.35, 0.24, material, x - railWidth / 2, 1.32, 5.68));
  root.add(box(0.24, 2.35, 0.24, material, x + railWidth / 2, 1.32, 5.68));

  const braceA = box(2.95, 0.16, 0.22, material, x - 0.72, 1.95, 5.72);
  braceA.rotation.z = 0.52;
  const braceB = box(2.95, 0.16, 0.22, material, x + 0.72, 1.95, 5.72);
  braceB.rotation.z = -0.52;
  root.add(braceA, braceB);
}

function addTrough(root, x, z, troughMat, waterMat) {
  root.add(box(3.8, 0.22, 1.28, troughMat, x, 0.2, z));
  root.add(box(3.8, 0.8, 0.22, troughMat, x, 0.62, z - 0.62));
  root.add(box(3.8, 0.8, 0.22, troughMat, x, 0.62, z + 0.62));
  root.add(box(0.22, 0.8, 1.28, troughMat, x - 1.9, 0.62, z));
  root.add(box(0.22, 0.8, 1.28, troughMat, x + 1.9, 0.62, z));
  root.add(box(3.3, 0.04, 0.88, waterMat, x, 1.04, z));
}

function addBarrel(root, x, z, material) {
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.55, 1.1, 10), material);
  barrel.position.set(x, 0.78, z);
  const bandA = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.025, 6, 16), material);
  const bandB = bandA.clone();
  bandA.position.set(x, 0.52, z);
  bandB.position.set(x, 1.02, z);
  bandA.rotation.x = Math.PI / 2;
  bandB.rotation.x = Math.PI / 2;
  root.add(barrel, bandA, bandB);
}

function createFenceRun(root, x1, z1, x2, z2, material) {
  const length = Math.hypot(x2 - x1, z2 - z1);
  const angle = Math.atan2(z2 - z1, x2 - x1);
  const midX = (x1 + x2) / 2;
  const midZ = (z1 + z2) / 2;
  const railHeights = [0.95, 1.75];

  railHeights.forEach((height) => {
    const rail = box(length, 0.18, 0.24, material, midX, height, midZ);
    rail.rotation.y = -angle;
    root.add(rail);
  });

  const postCount = Math.max(2, Math.ceil(length / 3.4));
  for (let i = 0; i <= postCount; i += 1) {
    const t = i / postCount;
    const post = box(0.34, 2.35, 0.34, material, THREE.MathUtils.lerp(x1, x2, t), 1.18, THREE.MathUtils.lerp(z1, z2, t));
    root.add(post);
  }
}

function createGate(root, material) {
  const gate = new THREE.Group();
  const gateLength = Math.hypot(gateState.latchLocal.x - gateState.hingeLocal.x, gateState.latchLocal.z - gateState.hingeLocal.z);
  gate.position.set(gateState.hingeLocal.x, 0, gateState.hingeLocal.z);

  for (const height of [0.85, 1.55, 2.25]) {
    gate.add(box(0.26, 0.22, gateLength, material, 0, height, -gateLength / 2));
  }
  gate.add(box(0.46, 2.95, 0.46, material, 0, 1.48, 0));
  gate.add(box(0.42, 2.65, 0.42, material, 0, 1.32, -gateLength));

  const braceA = box(0.24, 0.18, gateLength * 1.12, material, 0, 1.35, -gateLength / 2);
  braceA.rotation.x = -0.54;
  const braceB = box(0.24, 0.18, gateLength * 1.12, material, 0, 1.75, -gateLength / 2);
  braceB.rotation.x = 0.54;
  gate.add(braceA, braceB);

  const latch = box(0.24, 0.36, 0.42, material, -0.26, 1.62, -gateLength);
  gate.add(latch);
  root.add(gate);
  gateState.group = gate;
}

function createRabbit() {
  const root = new THREE.Group();
  const furMat = new THREE.MeshStandardMaterial({ color: pick([0xb8aa93, 0xd6c9b2, 0x8f8170]), roughness: 0.9 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x17130f, roughness: 0.65 });
  const bellyMat = new THREE.MeshStandardMaterial({ color: 0xeadfcd, roughness: 0.86 });

  const body = ellipsoid(0.72, 0.42, 0.38, furMat, 0, 0.38, 0);
  const chest = ellipsoid(0.28, 0.28, 0.26, bellyMat, 0.3, 0.42, 0);
  const head = ellipsoid(0.34, 0.3, 0.3, furMat, 0.58, 0.62, 0);
  const eyeA = ellipsoid(0.045, 0.05, 0.035, darkMat, 0.72, 0.68, -0.16);
  const eyeB = ellipsoid(0.045, 0.05, 0.035, darkMat, 0.72, 0.68, 0.16);
  const tail = ellipsoid(0.18, 0.18, 0.18, bellyMat, -0.42, 0.5, 0);
  root.add(body, chest, head, eyeA, eyeB, tail);

  for (const z of [-0.16, 0.16]) {
    const ear = ellipsoid(0.1, 0.46, 0.07, furMat, 0.48, 1.0, z);
    ear.rotation.z = z < 0 ? -0.12 : 0.12;
    const foreleg = ellipsoid(0.09, 0.26, 0.08, furMat, 0.34, 0.16, z);
    const hindleg = ellipsoid(0.14, 0.26, 0.11, furMat, -0.22, 0.16, z);
    root.add(ear, foreleg, hindleg);
  }

  root.scale.setScalar(rand(0.75, 1.05));
  root.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  return { root, kind: "rabbit", speed: rand(1.3, 2.2), turnRate: rand(1.5, 2.4) };
}

function createSquirrel() {
  const root = new THREE.Group();
  const furMat = new THREE.MeshStandardMaterial({ color: pick([0x9c5f32, 0x7d4b2c, 0xb0743f]), roughness: 0.86 });
  const creamMat = new THREE.MeshStandardMaterial({ color: 0xe6cda4, roughness: 0.86 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x16100c, roughness: 0.64 });

  const body = ellipsoid(0.54, 0.34, 0.3, furMat, 0, 0.44, 0);
  const belly = ellipsoid(0.28, 0.26, 0.24, creamMat, 0.14, 0.43, 0);
  const head = ellipsoid(0.28, 0.26, 0.24, furMat, 0.45, 0.65, 0);
  const eyeA = ellipsoid(0.04, 0.045, 0.03, darkMat, 0.58, 0.7, -0.12);
  const eyeB = ellipsoid(0.04, 0.045, 0.03, darkMat, 0.58, 0.7, 0.12);
  const tail = ellipsoid(0.28, 0.9, 0.22, furMat, -0.48, 0.85, 0);
  tail.rotation.z = -0.55;
  root.add(body, belly, head, eyeA, eyeB, tail);

  for (const z of [-0.12, 0.12]) {
    const ear = cone(0.07, 0.18, furMat, 0.42, 0.86, z);
    ear.rotation.z = 0;
    const foreleg = ellipsoid(0.07, 0.24, 0.06, furMat, 0.28, 0.2, z);
    const hindleg = ellipsoid(0.1, 0.22, 0.08, furMat, -0.18, 0.2, z);
    root.add(ear, foreleg, hindleg);
  }

  root.scale.setScalar(rand(0.7, 0.95));
  root.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  return { root, kind: "squirrel", speed: rand(1.8, 3.0), turnRate: rand(2.4, 3.4) };
}

function createSky() {
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xf6faf2, roughness: 0.95 });
  for (let i = 0; i < 18; i += 1) {
    const cloud = new THREE.Group();
    for (let p = 0; p < 5; p += 1) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(rand(1.6, 3.5), 12, 8), cloudMat);
      puff.scale.y = rand(0.38, 0.62);
      puff.position.set(rand(-4, 4), rand(-0.8, 0.8), rand(-1.6, 1.6));
      cloud.add(puff);
    }
    cloud.position.set(rand(-150, 150), rand(36, 58), rand(-150, 150));
    cloud.scale.setScalar(rand(0.75, 1.8));
    clouds.push(cloud);
    scene.add(cloud);
  }
}

function tick() {
  const dt = Math.min(clock.getDelta(), 0.033);
  updateGamepadState(dt);
  if (gamepadState.interact && !lastGamepadInteract) handleInteract();
  lastGamepadInteract = gamepadState.interact;
  if (gamepadState.feed && !lastGamepadFeed) handleFeed();
  lastGamepadFeed = gamepadState.feed;
  if (gamepadState.capture && !lastGamepadCapture) handleCapture();
  lastGamepadCapture = gamepadState.capture;

  if (isMounted) {
    updateHorse(dt);
    syncMountedPlayer();
  } else {
    updatePlayer(dt);
    idleHorse(dt);
  }
  updateCamera(dt);
  updateHerd(dt);
  updateCritters(dt);
  updateCareIndicators(dt);
  updateInteractionPrompt(dt);
  updateAtmosphere(dt);
  updateGate(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

function updateHorse(dt) {
  const previousPosition = horse.root.position.clone();
  const keyboardForward = Number(keys.has("w") || keys.has("arrowup")) - Number(keys.has("s") || keys.has("arrowdown"));
  const keyboardTurn = Number(keys.has("a") || keys.has("arrowleft")) - Number(keys.has("d") || keys.has("arrowright"));
  const forward = Math.abs(gamepadState.forward) > 0 ? gamepadState.forward : keyboardForward;
  const turn = Math.abs(gamepadState.turn) > 0 ? gamepadState.turn : keyboardTurn;
  const gallop = (keys.has("shift") || gamepadState.gallop) && stamina > 0.05 && forward > 0;
  const speed = gallop ? 18 : 9;

  yaw += turn * dt * (forward < 0 ? -1.9 : 2.25);
  if (forward > 0 && Math.abs(cameraYaw) > 0.01) {
    const followRate = gallop ? 2.2 : 1.65;
    const turnTowardCamera = THREE.MathUtils.clamp(cameraYaw, -followRate * dt, followRate * dt);
    yaw = normalizeAngle(yaw + turnTowardCamera);
    cameraYaw = normalizeAngle(cameraYaw - turnTowardCamera);
  } else {
    yaw = normalizeAngle(yaw);
  }

  if (forward !== 0) {
    const face = faceDirection(yaw);
    horse.root.position.x += face.x * forward * speed * dt;
    horse.root.position.z += face.z * forward * speed * dt;
  }

  horse.root.position.x = THREE.MathUtils.clamp(horse.root.position.x, -126, 126);
  horse.root.position.z = THREE.MathUtils.clamp(horse.root.position.z, -126, 126);
  resolveMoverCollision(horse.root.position, horseCollisionRadius(horse), { selfHorse: horse, previousPosition });

  const ground = horseGroundHeight(horse.root.position.x, horse.root.position.z);
  const canHop = Math.abs(verticalVelocity) < 0.01 && horse.root.position.y <= ground + 0.05;
  if ((keys.has(" ") || gamepadState.hop) && canHop) verticalVelocity = 7.2;
  verticalVelocity -= 19 * dt;

  horse.root.position.y = Math.max(ground, horse.root.position.y + verticalVelocity * dt);
  if (horse.root.position.y === ground) verticalVelocity = 0;

  const moveEnergy = Math.abs(forward) + Math.abs(turn) * 0.35;
  shrinkHorseFromSteps(horse, moveEnergy, dt);
  stamina = THREE.MathUtils.clamp(stamina + (gallop ? -0.28 : 0.18) * dt, 0, 1);
  staminaBar.style.transform = `scaleX(${stamina})`;

  const stride = clock.elapsedTime * (gallop ? 13 : 8) * moveEnergy;
  horse.legs.forEach((item, index) => {
    const swing = Math.sin(stride + index * Math.PI) * 0.38 * moveEnergy;
    item.leg.rotation.z = swing;
    item.lowerLeg.rotation.z = swing * 0.55;
    item.hoof.rotation.z = swing;
  });
  horse.tail.rotation.z = 0.78 + Math.sin(clock.elapsedTime * 3.2) * 0.1;
  horse.head.rotation.z = Math.sin(clock.elapsedTime * 4.5) * 0.035 * moveEnergy;
  horse.root.rotation.y = yaw;

  const region = getRegion(horse.root.position.x, horse.root.position.z);
  if (regionLabel.textContent !== region) regionLabel.textContent = region;
  updateAudio(moveEnergy, gallop);
}

function updatePlayer(dt) {
  const previousPosition = player.root.position.clone();
  const keyboardForward = Number(keys.has("w") || keys.has("arrowup")) - Number(keys.has("s") || keys.has("arrowdown"));
  const keyboardTurn = Number(keys.has("d") || keys.has("arrowright")) - Number(keys.has("a") || keys.has("arrowleft"));
  const forward = Math.abs(gamepadState.forward) > 0 ? gamepadState.forward : keyboardForward;
  const turn = Math.abs(gamepadState.turn) > 0 ? gamepadState.turn : keyboardTurn;
  const viewYaw = normalizeAngle(playerYaw + cameraYaw);
  const forwardFace = faceDirection(viewYaw);
  const sideFace = faceDirection(viewYaw - Math.PI / 2);
  const move = new THREE.Vector3(
    forwardFace.x * forward + sideFace.x * turn,
    0,
    forwardFace.z * forward + sideFace.z * turn,
  );

  const moveEnergy = Math.min(1, move.length());
  if (moveEnergy > 0.01) {
    move.normalize();
    const speed = keys.has("shift") || gamepadState.gallop ? 6.4 : 4.9;
    player.root.position.x += move.x * speed * dt;
    player.root.position.z += move.z * speed * dt;
    playerYaw = approachAngle(playerYaw, Math.atan2(-move.z, move.x), 9 * dt);
    cameraYaw = normalizeAngle(viewYaw - playerYaw);
  }

  player.root.position.x = THREE.MathUtils.clamp(player.root.position.x, -126, 126);
  player.root.position.z = THREE.MathUtils.clamp(player.root.position.z, -126, 126);
  resolveMoverCollision(player.root.position, 0.78, { previousPosition, ignoreHorses: true });
  player.root.position.y = horseGroundHeight(player.root.position.x, player.root.position.z);
  player.root.rotation.y = playerYaw;

  const walk = clock.elapsedTime * 8.5 * moveEnergy;
  player.legs.forEach((leg, index) => {
    leg.rotation.z = Math.sin(walk + index * Math.PI) * 0.34 * moveEnergy;
  });
  player.arms.forEach((arm, index) => {
    arm.rotation.z = (index === 0 ? -0.28 : 0.28) + Math.sin(walk + index * Math.PI) * 0.22 * moveEnergy;
  });

  const region = getRegion(player.root.position.x, player.root.position.z);
  if (regionLabel.textContent !== region) regionLabel.textContent = region;
  updateAudio(moveEnergy, false);
}

function idleHorse(dt) {
  if (horse.followsPlayer) {
    updateFollowingHorse(horse, 0, dt);
    return;
  }

  const ground = horseGroundHeight(horse.root.position.x, horse.root.position.z);
  horse.root.position.y = ground;
  horse.tail.rotation.z = 0.78 + Math.sin(clock.elapsedTime * 2.3) * 0.08;
  horse.head.rotation.z = Math.sin(clock.elapsedTime * 1.7) * 0.045;
  horse.legs.forEach((item) => {
    item.leg.rotation.z = THREE.MathUtils.lerp(item.leg.rotation.z, 0, 1 - Math.pow(0.001, dt));
    item.lowerLeg.rotation.z = THREE.MathUtils.lerp(item.lowerLeg.rotation.z, 0, 1 - Math.pow(0.001, dt));
    item.hoof.rotation.z = THREE.MathUtils.lerp(item.hoof.rotation.z, 0, 1 - Math.pow(0.001, dt));
  });
  applyHorseGrowth(horse, dt);
}

function handleInteract() {
  const actorPosition = isMounted ? horse.root.position : player.root.position;
  if (nearGate(actorPosition.x, actorPosition.z)) {
    toggleGate();
    return;
  }

  if (isMounted) {
    dismountHorse();
    return;
  }

  const nearest = nearestHorseToPlayer();
  if (nearest && nearest.distance < careRangeFor(nearest.horse)) {
    if (nearest.distance < mountRangeFor(nearest.horse) && canMountHorse(nearest.horse)) {
      mountHorse(nearest.horse);
    } else {
      careForHorse(nearest.horse);
    }
  }
}

function handleFeed() {
  if (isMounted) return;

  const nearest = nearestHorseToPlayer();
  if (nearest && nearest.distance < feedRangeFor(nearest.horse)) {
    feedHorse(nearest.horse);
  }
}

function handleCapture() {
  if (isMounted) return;

  const nearest = nearestHorseToPlayer();
  if (nearest && nearest.distance < captureRangeFor(nearest.horse)) {
    captureHorse(nearest.horse);
  }
}

function dismountHorse() {
  const side = faceDirection(yaw - Math.PI / 2);
  player.root.position.set(
    horse.root.position.x + side.x * 2.5,
    horseGroundHeight(horse.root.position.x + side.x * 2.5, horse.root.position.z + side.z * 2.5),
    horse.root.position.z + side.z * 2.5,
  );
  playerYaw = yaw;
  player.root.rotation.y = playerYaw;
  player.root.visible = true;
  isMounted = false;
  verticalVelocity = 0;
  showCareNotice("On foot");
}

function mountHorse(targetHorse = horse) {
  setActiveHorse(targetHorse);
  player.root.visible = true;
  horse.root.rotation.y = playerYaw;
  yaw = horse.root.rotation.y;
  cameraYaw = 0;
  isMounted = true;
  syncMountedPlayer();
  showCareNotice("Back in the saddle");
}

function setActiveHorse(nextHorse) {
  if (!nextHorse || nextHorse === horse) return;

  const nextIndex = herd.indexOf(nextHorse);
  if (nextIndex === -1) return;

  herd.splice(nextIndex, 1);
  horse.phase = rand(0, Math.PI * 2);
  horse.speed = rand(0.25, 0.55);
  herd.push(horse);
  horse = nextHorse;
  yaw = horse.root.rotation.y;
  cameraYaw = 0;
  verticalVelocity = 0;
  stamina = Math.max(stamina, 0.45);
}

function syncMountedPlayer() {
  const saddlePosition = mountedPlayerOffset.clone();
  horse.root.localToWorld(saddlePosition);
  player.root.position.copy(saddlePosition);
  player.root.rotation.y = horse.root.rotation.y;
  playerYaw = player.root.rotation.y;
  const rideBob = Math.sin(clock.elapsedTime * 8) * 0.04;
  player.root.position.y += rideBob;
  player.legs.forEach((leg, index) => {
    leg.rotation.z = (index === 0 ? 0.28 : -0.28) + rideBob * 2.2;
  });
  player.arms.forEach((arm, index) => {
    arm.rotation.z = (index === 0 ? -0.52 : 0.52) + rideBob * 1.4;
  });
}

function toggleGate() {
  gateState.open = !gateState.open;
  showCareNotice(gateState.open ? "Gate opened" : "Gate closed");
}

function careForHorse(targetHorse) {
  targetHorse.care = THREE.MathUtils.clamp(targetHorse.care + 0.28, 0, 1);
  targetHorse.carePulse = 1;
  targetHorse.head.rotation.z = -0.12;
  if (targetHorse.isFoal) {
    showCareNotice(targetHorse.care > 0.95 ? "Baby horse feels safe" : "Taking care of baby horse");
  } else {
    showCareNotice(targetHorse.care > 0.95 ? "Horse feels wonderful" : "Taking care of horse");
  }
}

function feedHorse(targetHorse) {
  targetHorse.fed = THREE.MathUtils.clamp(targetHorse.fed + 0.34, 0, 1);
  targetHorse.care = THREE.MathUtils.clamp(targetHorse.care + 0.1, 0, 1);
  if (targetHorse.owned) {
    targetHorse.affection = THREE.MathUtils.clamp(targetHorse.affection + (targetHorse.isFoal ? 0.24 : 0.2), 0, 1);
    if (targetHorse.affection >= 1) targetHorse.followsPlayer = true;
  }
  targetHorse.growth = THREE.MathUtils.clamp(targetHorse.growth + (targetHorse.isFoal ? 0.13 : 0.2), 0, targetHorse.maxGrowth);
  targetHorse.feedPulse = 1;
  targetHorse.head.rotation.z = -0.18;
  if (targetHorse.isFoal) {
    if (targetHorse.growth >= targetHorse.maxGrowth) {
      promoteFoalToAdult(targetHorse);
      showCareNotice("Baby horse grew up");
    } else if (targetHorse.followsPlayer) {
      showCareNotice("Baby horse will follow you");
    } else {
      showCareNotice(targetHorse.growth > 0.62 ? "Baby horse is almost grown" : "Feeding baby horse");
    }
  } else {
    if (targetHorse.followsPlayer) {
      showCareNotice("Horse will follow you");
    } else {
      showCareNotice(targetHorse.growth > 1.35 ? "Horse has a huge belly" : "Feeding horse");
    }
  }
}

function captureHorse(targetHorse) {
  if (targetHorse === horse && isMounted) return;

  targetHorse.owned = true;
  targetHorse.affection = THREE.MathUtils.clamp(targetHorse.affection + 0.18, 0, 1);
  targetHorse.carePulse = 1;
  if (targetHorse.followsPlayer) {
    showCareNotice(targetHorse.isFoal ? "Baby horse is already yours" : "Horse is already yours");
  } else {
    showCareNotice(targetHorse.isFoal ? "Captured baby horse" : "Captured horse");
  }
}

function nearestHorseToPlayer() {
  const candidates = [horse, ...herd];
  let nearest;
  candidates.forEach((candidate) => {
    const distance = Math.hypot(candidate.root.position.x - player.root.position.x, candidate.root.position.z - player.root.position.z);
    if (!nearest || distance < nearest.distance) nearest = { horse: candidate, distance };
  });
  return nearest;
}

function updateCareIndicators(dt) {
  [horse, ...herd].forEach((candidate) => {
    applyHorseGrowth(candidate, dt);
    candidate.carePulse = Math.max(0, candidate.carePulse - dt * 0.65);
    candidate.careIndicator.visible = candidate.carePulse > 0.02;
    if (candidate.careIndicator.visible) {
      const pulse = candidate.carePulse;
      const baseHeight = candidate.isFoal ? 2.75 : 3.95;
      candidate.careIndicator.position.y = baseHeight + Math.sin(clock.elapsedTime * 5) * 0.12 + (1 - pulse) * 0.7;
      candidate.careIndicator.scale.setScalar(0.75 + pulse * 0.55);
    }

    candidate.feedPulse = Math.max(0, candidate.feedPulse - dt * 0.7);
    candidate.feedIndicator.visible = candidate.feedPulse > 0.02;
    if (candidate.feedIndicator.visible) {
      const feedPulse = candidate.feedPulse;
      const feedHeight = candidate.isFoal ? 2.62 : 3.55;
      candidate.feedIndicator.position.y = feedHeight + Math.sin(clock.elapsedTime * 6) * 0.1 + (1 - feedPulse) * 0.55;
      candidate.feedIndicator.scale.setScalar(0.72 + feedPulse * 0.52);
    }
  });
}

function updateInteractionPrompt(dt) {
  careNoticeTime = Math.max(0, careNoticeTime - dt);
  let text = "";
  if (careNoticeTime > 0) {
    text = interactionLabel.dataset.notice;
  } else if (isMounted) {
    text = nearGate(horse.root.position.x, horse.root.position.z) ? (gateState.open ? "E / X close gate" : "E / X open gate") : "E / X dismount";
  } else {
    const nearest = nearestHorseToPlayer();
    if (nearGate(player.root.position.x, player.root.position.z)) {
      text = gateState.open ? "E / X close gate" : "E / X open gate";
    } else if (nearest && nearest.distance < mountRangeFor(nearest.horse) && canMountHorse(nearest.horse)) {
      text = "E / X mount";
    } else if (nearest && nearest.distance < captureRangeFor(nearest.horse) && !nearest.horse.owned) {
      text = nearest.horse.isFoal ? "C / B capture baby" : "C / B capture";
    } else if (nearest && nearest.distance < Math.max(careRangeFor(nearest.horse), feedRangeFor(nearest.horse))) {
      if (nearest.horse.owned && !nearest.horse.followsPlayer) {
        text = nearest.horse.isFoal ? "F / Y feed baby to befriend" : "F / Y feed to befriend";
      } else {
        text = nearest.horse.isFoal ? "E care / F feed baby" : "E care / F feed";
      }
    } else {
      text = "Walk to a horse";
    }
  }

  interactionLabel.textContent = text;
  interactionLabel.classList.toggle("visible", Boolean(text));
}

function showCareNotice(text) {
  interactionLabel.dataset.notice = text;
  careNoticeTime = 1.7;
}

function careRangeFor(targetHorse) {
  return targetHorse.isFoal ? 5.4 : 4.8;
}

function feedRangeFor(targetHorse) {
  return targetHorse.isFoal ? 5.7 : 5.0;
}

function captureRangeFor(targetHorse) {
  return targetHorse.isFoal ? 5.8 : 5.2;
}

function mountRangeFor(targetHorse) {
  return targetHorse.isFoal ? 0 : 4.9;
}

function canMountHorse(targetHorse) {
  if (!targetHorse?.rideable) return false;
  return targetHorse === horse || targetHorse.owned;
}

function shrinkHorseFromSteps(targetHorse, stepEnergy, dt) {
  if (stepEnergy <= 0 || targetHorse.growth <= 0) return;
  if (targetHorse.isFoal) {
    targetHorse.growth = Math.max(0, targetHorse.growth - stepEnergy * dt * 0.006);
  } else {
    targetHorse.growth = Math.max(0, targetHorse.growth - stepEnergy * dt * 0.035);
  }
}

function applyHorseGrowth(targetHorse, dt) {
  if (targetHorse.isFoal) {
    const maturity = targetHorse.growth / targetHorse.maxGrowth;
    const targetScale = THREE.MathUtils.lerp(targetHorse.baseScale, targetHorse.adultScale, maturity);
    const nextScale = THREE.MathUtils.lerp(targetHorse.root.scale.x, targetScale, 1 - Math.pow(0.0001, dt));
    targetHorse.root.scale.setScalar(nextScale);
    return;
  }

  const belly = targetHorse.growth / targetHorse.maxGrowth;
  const bodyY = 1 + belly * 0.55;
  const bodyZ = 1 + belly * 0.92;
  const bodyX = 1 + belly * 0.15;
  const chestY = 1 + belly * 0.25;
  const chestZ = 1 + belly * 0.35;
  targetHorse.root.scale.setScalar(targetHorse.baseScale);
  targetHorse.body.scale.set(
    targetHorse.bodyBaseScale.x * bodyX,
    targetHorse.bodyBaseScale.y * bodyY,
    targetHorse.bodyBaseScale.z * bodyZ,
  );
  targetHorse.chest.scale.set(
    targetHorse.chestBaseScale.x * (1 + belly * 0.08),
    targetHorse.chestBaseScale.y * chestY,
    targetHorse.chestBaseScale.z * chestZ,
  );
}

function promoteFoalToAdult(targetHorse) {
  if (!targetHorse.isFoal) return;
  targetHorse.isFoal = false;
  targetHorse.rideable = true;
  targetHorse.baseScale = targetHorse.adultScale;
  targetHorse.maxGrowth = 2.2;
  targetHorse.growth = 0;
  targetHorse.root.scale.setScalar(targetHorse.baseScale);
}

function updateCamera(dt) {
  const focus = isMounted ? horse.root.position : player.root.position;
  const baseYaw = isMounted ? yaw : playerYaw;
  const targetYaw = baseYaw + cameraYaw;
  const face = faceDirection(targetYaw);
  const offset = new THREE.Vector3(
    face.x * (isMounted ? -15 : -9),
    (isMounted ? 7.5 : 4.8) + cameraPitch * (isMounted ? 8 : 5.5),
    face.z * (isMounted ? -15 : -9),
  );
  const desired = focus.clone().add(offset);
  camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
  camera.lookAt(focus.x, focus.y + (isMounted ? 2.8 : 1.7), focus.z);
}

function switchToClickedHorse(event) {
  if (!isMounted) return;

  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(herd.map((other) => other.root), true);
  const nextHorse = hits.find((hit) => canMountHorse(hit.object.userData.horse))?.object.userData.horse;
  if (!nextHorse || nextHorse === horse) return;
  setActiveHorse(nextHorse);
}

function updateHerd(dt) {
  herd.forEach((other, index) => {
    if (other.followsPlayer && updateFollowingHorse(other, index + 1, dt)) return;

    const previousPosition = other.root.position.clone();
    other.phase += dt * other.speed;
    const drift = Math.sin(other.phase * (other.isFoal ? 0.7 : 0.35) + index) * (other.isFoal ? 1.4 : 0.85);
    other.root.rotation.y += drift * dt * (other.isFoal ? 0.34 : 0.22);
    const face = faceDirection(other.root.rotation.y);
    const pace = other.isFoal ? 3.1 : 2.4;
    other.root.position.x += face.x * dt * other.speed * pace;
    other.root.position.z += face.z * dt * other.speed * pace;
    shrinkHorseFromSteps(other, other.speed * (other.isFoal ? 0.95 : 0.65), dt);
    const hop = other.isFoal ? Math.max(0, Math.sin(other.phase * 4.6 + index)) * 0.16 : 0;
    other.root.position.y = horseGroundHeight(other.root.position.x, other.root.position.z) + hop;
    resolveMoverCollision(other.root.position, horseCollisionRadius(other), { selfHorse: other, previousPosition });
    if (Math.abs(other.root.position.x) > 116 || Math.abs(other.root.position.z) > 116 || nearRiver(other.root.position.x, other.root.position.z)) {
      other.root.rotation.y += Math.PI * 0.72;
    }
    other.legs.forEach((item, legIndex) => {
      const swing = Math.sin(clock.elapsedTime * (other.isFoal ? 7 : 4) + legIndex * Math.PI + index) * (other.isFoal ? 0.23 : 0.13);
      item.leg.rotation.z = swing;
      item.lowerLeg.rotation.z = swing * 0.55;
      item.hoof.rotation.z = swing;
    });
    other.tail.rotation.z = 0.75 + Math.sin(clock.elapsedTime * (other.isFoal ? 4.8 : 2.4) + index) * (other.isFoal ? 0.18 : 0.08);
  });
}

function updateFollowingHorse(targetHorse, index, dt) {
  if (targetHorse === horse && isMounted) return false;

  const leader = isMounted ? horse.root.position : player.root.position;
  const dx = leader.x - targetHorse.root.position.x;
  const dz = leader.z - targetHorse.root.position.z;
  const distance = Math.hypot(dx, dz);
  const followDistance = 4.8 + (index % 5) * 1.35 + (targetHorse.isFoal ? 0.4 : 0);
  if (distance <= followDistance) {
    targetHorse.root.position.y = horseGroundHeight(targetHorse.root.position.x, targetHorse.root.position.z);
    targetHorse.tail.rotation.z = 0.75 + Math.sin(clock.elapsedTime * 2.8 + index) * 0.1;
    targetHorse.legs.forEach((item) => {
      item.leg.rotation.z = THREE.MathUtils.lerp(item.leg.rotation.z, 0, 1 - Math.pow(0.001, dt));
      item.lowerLeg.rotation.z = THREE.MathUtils.lerp(item.lowerLeg.rotation.z, 0, 1 - Math.pow(0.001, dt));
      item.hoof.rotation.z = THREE.MathUtils.lerp(item.hoof.rotation.z, 0, 1 - Math.pow(0.001, dt));
    });
    return true;
  }

  const targetYaw = Math.atan2(-dz, dx);
  targetHorse.root.rotation.y = approachAngle(targetHorse.root.rotation.y, targetYaw, dt * (targetHorse.isFoal ? 2.8 : 2.2));
  const face = faceDirection(targetHorse.root.rotation.y);
  const speed = THREE.MathUtils.clamp(distance - followDistance, 0, targetHorse.isFoal ? 8.5 : 7.2);
  const previousPosition = targetHorse.root.position.clone();
  targetHorse.root.position.x += face.x * speed * dt;
  targetHorse.root.position.z += face.z * speed * dt;
  resolveMoverCollision(targetHorse.root.position, horseCollisionRadius(targetHorse), { selfHorse: targetHorse, previousPosition });
  shrinkHorseFromSteps(targetHorse, speed * 0.45, dt);
  targetHorse.root.position.y = horseGroundHeight(targetHorse.root.position.x, targetHorse.root.position.z);
  targetHorse.legs.forEach((item, legIndex) => {
    const swing = Math.sin(clock.elapsedTime * (targetHorse.isFoal ? 8 : 5.8) + legIndex * Math.PI + index) * (targetHorse.isFoal ? 0.3 : 0.22);
    item.leg.rotation.z = swing;
    item.lowerLeg.rotation.z = swing * 0.55;
    item.hoof.rotation.z = swing;
  });
  targetHorse.tail.rotation.z = 0.78 + Math.sin(clock.elapsedTime * 4 + index) * 0.14;
  return true;
}

function resolveMoverCollision(position, radius, options = {}) {
  const previousPosition = options.previousPosition;
  for (let pass = 0; pass < 3; pass += 1) {
    objectColliders.forEach((collider) => resolveObjectCollision(position, radius, collider));
    if (!options.ignoreHorses) {
      [horse, ...herd].forEach((other) => {
        if (other === options.selfHorse) return;
        resolveCircleCollision(position, radius, other.root.position.x, other.root.position.z, horseCollisionRadius(other));
      });
    }
  }

  position.x = THREE.MathUtils.clamp(position.x, -126, 126);
  position.z = THREE.MathUtils.clamp(position.z, -126, 126);
  if (nearRiver(position.x, position.z) || isUnderWater(position.x, position.z)) {
    if (previousPosition) {
      position.x = previousPosition.x;
      position.z = previousPosition.z;
    }
  }
}

function resolveObjectCollision(position, radius, collider) {
  if (collider.disabled) return;

  if (collider.type === "circle") {
    resolveCircleCollision(position, radius, collider.x, collider.z, collider.radius);
  } else if (collider.type === "box") {
    resolveBoxCollision(position, radius, collider);
  } else if (collider.type === "segment") {
    resolveSegmentCollision(position, radius, collider);
  }
}

function resolveCircleCollision(position, radius, x, z, otherRadius) {
  let dx = position.x - x;
  let dz = position.z - z;
  const minDistance = radius + otherRadius;
  const distanceSq = dx * dx + dz * dz;
  if (distanceSq >= minDistance * minDistance) return;

  if (distanceSq < 0.0001) {
    dx = 1;
    dz = 0;
  }
  const distance = Math.sqrt(dx * dx + dz * dz);
  const push = minDistance - distance;
  position.x += (dx / distance) * push;
  position.z += (dz / distance) * push;
}

function resolveSegmentCollision(position, radius, collider) {
  const dx = collider.x2 - collider.x1;
  const dz = collider.z2 - collider.z1;
  const lengthSq = dx * dx + dz * dz || 1;
  const t = THREE.MathUtils.clamp(((position.x - collider.x1) * dx + (position.z - collider.z1) * dz) / lengthSq, 0, 1);
  const closestX = collider.x1 + dx * t;
  const closestZ = collider.z1 + dz * t;
  resolveCircleCollision(position, radius, closestX, closestZ, collider.radius);
}

function resolveBoxCollision(position, radius, collider) {
  const local = toLocalPoint(position.x, position.z, collider.x, collider.z, collider.rotation);
  const closestX = THREE.MathUtils.clamp(local.x, -collider.halfX, collider.halfX);
  const closestZ = THREE.MathUtils.clamp(local.z, -collider.halfZ, collider.halfZ);
  const dx = local.x - closestX;
  const dz = local.z - closestZ;
  const distanceSq = dx * dx + dz * dz;

  if (distanceSq > 0) {
    if (distanceSq >= radius * radius) return;
    const distance = Math.sqrt(distanceSq);
    const push = radius - distance;
    local.x += (dx / distance) * push;
    local.z += (dz / distance) * push;
  } else {
    const pushX = collider.halfX - Math.abs(local.x);
    const pushZ = collider.halfZ - Math.abs(local.z);
    if (pushX < pushZ) {
      local.x = (local.x < 0 ? -1 : 1) * (collider.halfX + radius);
    } else {
      local.z = (local.z < 0 ? -1 : 1) * (collider.halfZ + radius);
    }
  }

  const world = fromLocalPoint(local.x, local.z, collider.x, collider.z, collider.rotation);
  position.x = world.x;
  position.z = world.z;
}

function horseCollisionRadius(targetHorse) {
  return (targetHorse.isFoal ? 1.25 : 2.15) * targetHorse.root.scale.x;
}

function updateCritters(dt) {
  critters.forEach((critter, index) => {
    critter.phase += dt;
    critter.pause -= dt;

    if (critter.pause <= 0) {
      critter.root.rotation.y += rand(-0.9, 0.9);
      critter.pause = rand(1.2, critter.kind === "rabbit" ? 3.0 : 2.2);
    }

    const movePulse =
      critter.kind === "rabbit"
        ? Math.max(0, Math.sin(critter.phase * 5.2 + index))
        : 0.55 + Math.sin(critter.phase * 7.4 + index) * 0.25;
    const speed = critter.speed * movePulse;
    const face = faceDirection(critter.root.rotation.y);
    critter.root.position.x += face.x * speed * dt;
    critter.root.position.z += face.z * speed * dt;

    const x = critter.root.position.x;
    const z = critter.root.position.z;
    if (Math.abs(x) > 120 || Math.abs(z) > 120 || nearRiver(x, z) || isUnderWater(x, z)) {
      critter.root.position.x -= face.x * speed * dt * 2;
      critter.root.position.z -= face.z * speed * dt * 2;
      critter.root.rotation.y += Math.PI * rand(0.65, 1.1);
    }

    const ground = groundHeight(critter.root.position.x, critter.root.position.z);
    const hop = critter.kind === "rabbit" ? movePulse * 0.18 : Math.max(0, Math.sin(critter.phase * 10 + index)) * 0.05;
    critter.root.position.y = ground + hop;
    critter.root.rotation.z = Math.sin(critter.phase * (critter.kind === "rabbit" ? 5 : 9) + index) * 0.035;
  });
}

function updateAtmosphere(dt) {
  terrain.water.material.opacity = 0.66 + Math.sin(clock.elapsedTime * 0.8) * 0.05;
  clouds.forEach((cloud) => {
    cloud.position.x += dt * 1.2;
    if (cloud.position.x > 160) cloud.position.x = -160;
  });
  flowers.forEach((flower, index) => {
    flower.rotation.y = Math.sin(clock.elapsedTime * 2.4 + index) * 0.25;
  });
}

function updateGate(dt) {
  if (!gateState.group) return;

  const target = gateState.open ? 1 : 0;
  gateState.openness = THREE.MathUtils.damp(gateState.openness, target, 7, dt);
  gateState.group.rotation.y = -gateState.openness * Math.PI * 0.58;
  if (gateState.collider) gateState.collider.disabled = gateState.openness > 0.12;
}

function resize() {
  const { innerWidth, innerHeight } = window;
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}

function startAudio() {
  if (audioStarted) return;
  audioStarted = true;
  audioContext = new AudioContext();
  breathOsc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  breathOsc.type = "sine";
  breathOsc.frequency.value = 70;
  gain.gain.value = 0.0001;
  breathOsc.connect(gain).connect(audioContext.destination);
  breathOsc.start();
  breathOsc.gain = gain;
}

function updateAudio(moveEnergy, gallop) {
  if (!audioStarted || !breathOsc) return;
  const target = moveEnergy > 0 ? (gallop ? 0.035 : 0.018) : 0.006;
  breathOsc.frequency.setTargetAtTime(gallop ? 96 : 72, audioContext.currentTime, 0.18);
  breathOsc.gain.gain.setTargetAtTime(target, audioContext.currentTime, 0.16);
}

function groundHeight(x, z) {
  const base = rawGroundHeight(x, z);
  const local = stableLocalCoordinates(x, z);
  const edge = Math.max((Math.abs(local.x) - 22) / 12, (Math.abs(local.z) - 24) / 12);
  if (edge < 1) {
    const blend = THREE.MathUtils.clamp(edge, 0, 1);
    const smooth = blend * blend * (3 - 2 * blend);
    return THREE.MathUtils.lerp(stablePadHeight, base, smooth);
  }
  return base;
}

function rawGroundHeight(x, z) {
  const ridge = Math.sin(x * 0.045) * 3.2 + Math.cos(z * 0.038) * 2.8;
  const rolls = Math.sin((x + z) * 0.027) * 2.4 + Math.cos(Math.hypot(x + 32, z - 25) * 0.05) * 2.1;
  const valley = Math.exp(-Math.pow((z + 12 + Math.sin(x * 0.035) * 10) / 18, 2)) * -5.8;
  return ridge + rolls + valley;
}

function horseGroundHeight(x, z) {
  const ground = groundHeight(x, z);
  return isUnderWater(x, z) ? Math.max(ground, riverWaterHeight(x, z) - 0.08) : ground;
}

function nearRiver(x, z) {
  return Math.abs(z - riverCenterZ(x)) < waterDepth / 2 + 3;
}

function registerStableColliders() {
  addStableBox(0, -0.55, 9.6, 6.9);
  addStableBox(-11.8, 12.2, 0.28, 6.5);
  addStableBox(-0.3, 18.2, 11.8, 0.28);
  addStableBox(11.2, 15.7, 0.28, 2.6);
  addStableSegment(-11.8, 6.2, -11.8, 18.2, 0.5);
  addStableSegment(-11.8, 18.2, 11.2, 18.2, 0.5);
  addStableSegment(11.2, 18.2, 11.2, gateState.hingeLocal.z, 0.5);
  gateState.collider = addStableSegment(gateState.hingeLocal.x, gateState.hingeLocal.z, gateState.latchLocal.x, gateState.latchLocal.z, 0.55);
}

function addStableBox(localX, localZ, halfX, halfZ) {
  const world = fromLocalPoint(localX, localZ, stableSpot.x, stableSpot.z, stableSpot.rotation);
  objectColliders.push({
    type: "box",
    x: world.x,
    z: world.z,
    rotation: stableSpot.rotation,
    halfX,
    halfZ,
  });
}

function addStableSegment(x1, z1, x2, z2, radius) {
  const a = fromLocalPoint(x1, z1, stableSpot.x, stableSpot.z, stableSpot.rotation);
  const b = fromLocalPoint(x2, z2, stableSpot.x, stableSpot.z, stableSpot.rotation);
  const collider = { type: "segment", x1: a.x, z1: a.z, x2: b.x, z2: b.z, radius };
  objectColliders.push(collider);
  return collider;
}

function nearGate(x, z) {
  const latch = fromLocalPoint(gateState.latchLocal.x, gateState.latchLocal.z, stableSpot.x, stableSpot.z, stableSpot.rotation);
  const hinge = fromLocalPoint(gateState.hingeLocal.x, gateState.hingeLocal.z, stableSpot.x, stableSpot.z, stableSpot.rotation);
  const distanceToLatch = Math.hypot(x - latch.x, z - latch.z);
  const distanceToHinge = Math.hypot(x - hinge.x, z - hinge.z);
  return Math.min(distanceToLatch, distanceToHinge) < 7.2;
}

function nearStable(x, z, padding = 0) {
  const local = stableLocalCoordinates(x, z);
  return Math.abs(local.x) < 20 + padding && Math.abs(local.z) < 25 + padding;
}

function stableLocalCoordinates(x, z) {
  return toLocalPoint(x, z, stableSpot.x, stableSpot.z, stableSpot.rotation);
}

function toLocalPoint(x, z, originX, originZ, rotation) {
  const dx = x - originX;
  const dz = z - originZ;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  return {
    x: dx * cos - dz * sin,
    z: dx * sin + dz * cos,
  };
}

function fromLocalPoint(x, z, originX, originZ, rotation) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: originX + x * cos - z * sin,
    z: originZ + x * sin + z * cos,
  };
}

function isUnderWater(x, z) {
  return Math.abs(z - riverCenterZ(x)) <= waterDepth / 2 + 1;
}

function riverCenterZ(x) {
  return waterCenterZ - Math.sin(x * 0.035) * 10;
}

function riverWaterHeight(x, z) {
  const localDepth = Math.max(0, 1 - Math.abs(z - riverCenterZ(x)) / (waterDepth / 2));
  return groundHeight(x, z) + 0.08 + localDepth * 0.18;
}

function getRegion(x, z) {
  if (nearRiver(x, z)) return "Glasswater Ford";
  if (x > 55 && z < -20) return "Sunspire Rise";
  if (x < -50) return "Cedar Vale";
  if (z > 58) return "Longgrass North";
  return "Sage Hills";
}

function faceDirection(rotationY) {
  return {
    x: Math.cos(rotationY),
    z: -Math.sin(rotationY),
  };
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function approachAngle(current, target, maxStep) {
  const delta = normalizeAngle(target - current);
  return normalizeAngle(current + THREE.MathUtils.clamp(delta, -maxStep, maxStep));
}

function box(width, height, depth, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  return mesh;
}

function ellipsoid(width, height, depth, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 14), material);
  mesh.scale.set(width, height, depth);
  mesh.position.set(x, y, z);
  return mesh;
}

function cone(radius, height, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 4), material);
  mesh.position.set(x, y, z);
  mesh.rotation.z = -0.12;
  return mesh;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}
