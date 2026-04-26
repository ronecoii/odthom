const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const visitedCount = document.getElementById("visitedCount");
const nectarCount = document.getElementById("nectarCount");
const honeyCount = document.getElementById("honeyCount");
const pollenCount = document.getElementById("pollenCount");
const pollinationScore = document.getElementById("pollinationScore");

const world = {
  width: 2400,
  height: 1700,
  tile: 32,
};

const primaryPigments = {
  red: { name: "Red", rgb: [238, 49, 63] },
  yellow: { name: "Yellow", rgb: [255, 218, 63] },
  blue: { name: "Blue", rgb: [50, 117, 255] },
};

const keys = new Set();
const rand = mulberry32(8675309);
const knownColorRecipes = new Map();

const bee = {
  x: world.width * 0.5,
  y: world.height * 0.5,
  vx: 0,
  vy: 0,
  radius: 15,
  speed: 250,
  dashCooldown: 0,
  dashTime: 0,
  nectar: 0,
  nectarCapacity: 20,
  honey: 0,
  pollen: [],
  wingFrame: 0,
  facing: 1,
};

const hive = {
  x: world.width * 0.5,
  y: world.height * 0.5,
  radius: 38,
};

const camera = {
  x: 0,
  y: 0,
};

const flowers = makeFlowerClusters();
const grass = makeGrass(520);
const roamingBees = makeRoamingBees(14);
const particles = [];
let lastTime = performance.now();

window.addEventListener("keydown", (event) => {
  keys.add(event.key.toLowerCase());
  if (event.code === "Space") {
    event.preventDefault();
    startDash();
  }
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
});

flowers.forEach((flower) => recordColorRecipe(flower.recipe));
requestAnimationFrame(loop);

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.033);
  lastTime = now;

  update(dt);
  draw();
  requestAnimationFrame(loop);
}

function update(dt) {
  const input = movementInput();
  const moveSpeed = bee.dashTime > 0 ? bee.speed * 2.35 : bee.speed;

  bee.vx = input.x * moveSpeed;
  bee.vy = input.y * moveSpeed;
  bee.x = clamp(bee.x + bee.vx * dt, bee.radius, world.width - bee.radius);
  bee.y = clamp(bee.y + bee.vy * dt, bee.radius, world.height - bee.radius);

  if (bee.vx !== 0) {
    bee.facing = Math.sign(bee.vx);
  }

  bee.dashCooldown = Math.max(0, bee.dashCooldown - dt);
  bee.dashTime = Math.max(0, bee.dashTime - dt);
  bee.wingFrame += dt * (input.moving ? 18 : 9);

  flowers.forEach((flower) => {
    const distance = dist(bee.x, bee.y, flower.x, flower.y);
    flower.sway += dt * flower.swaySpeed;
    flower.growth = Math.min(1, flower.growth + dt / flower.growTime);
    flower.glow = Math.max(0, flower.glow - dt * 1.8);

    if (distance < bee.radius + flower.radius + 4 && flower.growth >= 1) {
      visitFlower(flower);
    }
  });

  roamingBees.forEach((roamer) => updateRoamingBee(roamer, dt));

  if (dist(bee.x, bee.y, hive.x, hive.y) < hive.radius + bee.radius && bee.nectar > 0) {
    burst(hive.x, hive.y, "#ffd447", Math.min(24, bee.nectar * 3));
    bee.honey += bee.nectar;
    bee.nectar = 0;
  }

  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 18 * dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
    }
  }

  updateCamera();
  updateHud();
}

function visitFlower(flower) {
  if (flower.nectarTaken || bee.nectar >= bee.nectarCapacity) return;

  flower.nectarTaken = true;
  bee.nectar += 1;
  flower.glow = 1;
  burst(flower.x, flower.y, flower.color, 14);

  if (flower.hasPollen && bee.pollen.length < 2) {
    flower.hasPollen = false;
    bee.pollen.push(flower.recipe);

    if (bee.pollen.length === 2) {
      const blend = blendRecipes(bee.pollen[0], bee.pollen[1]);
      spawnSeedlingNear(flower, blend);
      bee.pollen = [];
    }
  }
}

function updateCamera() {
  camera.x = clamp(bee.x - canvas.width / 2, 0, world.width - canvas.width);
  camera.y = clamp(bee.y - canvas.height / 2, 0, world.height - canvas.height);
}

function updateHud() {
  const mature = flowers.filter((flower) => flower.growth >= 1).length;
  visitedCount.textContent = `${mature} / ${flowers.length}`;
  nectarCount.textContent = `${bee.nectar} / ${bee.nectarCapacity}`;
  honeyCount.textContent = bee.honey.toString();
  pollenCount.textContent = `${bee.pollen.length} / 2`;
  pollinationScore.textContent = calculatePollinationScore().toString();
}

function calculatePollinationScore() {
  let score = 0;
  knownColorRecipes.forEach((recipe) => {
    score += recipe.length;
  });
  return score;
}

function draw() {
  ctx.save();
  ctx.translate(-Math.round(camera.x), -Math.round(camera.y));

  drawGarden();
  drawHive();

  const sortedFlowers = [...flowers].sort((a, b) => a.y - b.y);
  sortedFlowers.forEach(drawFlower);

  drawParticles();
  roamingBees.forEach(drawRoamingBee);
  drawBee();
  ctx.restore();

  drawMiniMap();
}

function drawGarden() {
  ctx.fillStyle = "#7ed957";
  ctx.fillRect(0, 0, world.width, world.height);

  for (let y = 0; y < world.height; y += world.tile) {
    for (let x = 0; x < world.width; x += world.tile) {
      const checker = ((x / world.tile) + (y / world.tile)) % 2 === 0;
      ctx.fillStyle = checker ? "#86df5f" : "#76cd55";
      ctx.fillRect(x, y, world.tile, world.tile);
    }
  }

  ctx.fillStyle = "#5fb746";
  grass.forEach((blade) => {
    ctx.fillRect(blade.x, blade.y, 4, blade.height);
    ctx.fillRect(blade.x + 4, blade.y + 4, 4, 6);
  });

  ctx.strokeStyle = "rgba(48, 108, 42, .18)";
  ctx.lineWidth = 4;
  for (let x = 0; x < world.width; x += world.tile) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, world.height);
    ctx.stroke();
  }
  for (let y = 0; y < world.height; y += world.tile) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(world.width, y + 0.5);
    ctx.stroke();
  }
}

function drawHive() {
  pixelCircle(hive.x, hive.y + 16, 46, "#4f8c35");
  ctx.fillStyle = "#a46a2a";
  ctx.fillRect(hive.x - 42, hive.y - 18, 84, 62);
  ctx.fillStyle = "#d89036";
  ctx.fillRect(hive.x - 34, hive.y - 32, 68, 18);
  ctx.fillRect(hive.x - 46, hive.y - 8, 92, 16);
  ctx.fillRect(hive.x - 38, hive.y + 16, 76, 16);
  ctx.fillStyle = "#7b421e";
  ctx.fillRect(hive.x - 14, hive.y + 12, 28, 30);
  ctx.fillStyle = "#3b2115";
  ctx.fillRect(hive.x - 8, hive.y + 21, 16, 21);
}

function drawFlower(flower) {
  if (!isNearCamera(flower.x, flower.y, 80)) return;

  const bob = Math.round(Math.sin(flower.sway) * 2);
  const x = Math.round(flower.x);
  const y = Math.round(flower.y + bob);
  const scale = flower.growth;

  ctx.fillStyle = "#39823d";
  ctx.fillRect(x - 2, y + 8, 4, Math.max(6, Math.round(18 * scale)));
  ctx.fillRect(x - 12, y + 18, 12, 4);
  ctx.fillRect(x, y + 24, 12, 4);

  if (scale < 1) {
    ctx.fillStyle = "#8d5832";
    ctx.fillRect(x - 8, y + 18, 16, 10);
    ctx.fillStyle = flower.color;
    ctx.fillRect(x - 5, y + 10 - Math.round(scale * 14), 10, 8);
    return;
  }

  if (flower.glow > 0) {
    pixelCircle(x, y, flower.radius + 7 + flower.glow * 6, "rgba(255, 244, 140, .42)");
  }

  ctx.fillStyle = flower.nectarTaken ? lighten(flower.color, 0.28) : flower.color;
  ctx.fillRect(x - 6, y - 18, 12, 14);
  ctx.fillRect(x - 6, y + 4, 12, 14);
  ctx.fillRect(x - 18, y - 6, 14, 12);
  ctx.fillRect(x + 4, y - 6, 14, 12);
  ctx.fillStyle = flower.hasPollen ? "#fff2a0" : "#7b5f2a";
  ctx.fillRect(x - 8, y - 8, 16, 16);
  ctx.fillStyle = "#fff8ca";
  ctx.fillRect(x - 3, y - 3, 6, 6);
}

function drawBee() {
  drawBeeSprite(bee.x, bee.y, bee.wingFrame, bee.facing, 1);
}

function drawRoamingBee(roamer) {
  if (!isNearCamera(roamer.x, roamer.y, 60)) return;
  drawBeeSprite(roamer.x, roamer.y, roamer.wingFrame, roamer.facing, 0.72);
}

function drawBeeSprite(worldX, worldY, wingFrame, facing, scale) {
  const x = Math.round(worldX);
  const y = Math.round(worldY);
  const wingLift = Math.sin(wingFrame) > 0 ? -8 : -3;

  ctx.fillStyle = "rgba(38, 48, 35, .22)";
  ctx.fillRect(x - 18 * scale, y + 22 * scale, 36 * scale, 8 * scale);

  ctx.globalAlpha = 0.74;
  ctx.fillStyle = "#dffaff";
  ctx.fillRect(x - 22 * scale, y + (-18 + wingLift) * scale, 18 * scale, 18 * scale);
  ctx.fillRect(x + 4 * scale, y + (-18 + wingLift) * scale, 18 * scale, 18 * scale);
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#20190e";
  ctx.fillRect(x - 18 * scale, y - 12 * scale, 36 * scale, 28 * scale);
  ctx.fillStyle = "#ffd447";
  ctx.fillRect(x - 14 * scale, y - 10 * scale, 28 * scale, 24 * scale);
  ctx.fillStyle = "#20190e";
  ctx.fillRect(x - 9 * scale, y - 10 * scale, 6 * scale, 24 * scale);
  ctx.fillRect(x + 5 * scale, y - 10 * scale, 6 * scale, 24 * scale);

  ctx.fillStyle = "#20190e";
  ctx.fillRect(x + facing * 14 * scale - 4 * scale, y - 16 * scale, 12 * scale, 12 * scale);
  ctx.fillStyle = "#fff8ca";
  ctx.fillRect(x + facing * 16 * scale - 1 * scale, y - 13 * scale, 4 * scale, 4 * scale);

  ctx.strokeStyle = "#20190e";
  ctx.lineWidth = Math.max(2, 3 * scale);
  ctx.beginPath();
  ctx.moveTo(x + facing * 14 * scale, y - 16 * scale);
  ctx.lineTo(x + facing * 24 * scale, y - 24 * scale);
  ctx.stroke();
}

function drawParticles() {
  particles.forEach((p) => {
    if (!isNearCamera(p.x, p.y, 24)) return;
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
  });
  ctx.globalAlpha = 1;
}

function drawMiniMap() {
  const scale = 0.06;
  const w = Math.round(world.width * scale);
  const h = Math.round(world.height * scale);
  const x = canvas.width - w - 18;
  const y = canvas.height - h - 18;

  ctx.fillStyle = "rgba(34, 50, 31, .72)";
  ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
  ctx.fillStyle = "#72cc52";
  ctx.fillRect(x, y, w, h);

  flowers.forEach((flower) => {
    ctx.fillStyle = flower.color;
    ctx.fillRect(x + flower.x * scale - 1, y + flower.y * scale - 1, 3, 3);
  });

  ctx.fillStyle = "#d89036";
  ctx.fillRect(x + hive.x * scale - 3, y + hive.y * scale - 3, 6, 6);
  ctx.fillStyle = "#20190e";
  ctx.fillRect(x + bee.x * scale - 2, y + bee.y * scale - 2, 4, 4);
  ctx.fillStyle = "#fff8ca";
  roamingBees.forEach((roamer) => {
    ctx.fillRect(x + roamer.x * scale - 1, y + roamer.y * scale - 1, 2, 2);
  });
}

function movementInput() {
  let x = 0;
  let y = 0;

  if (keys.has("arrowleft") || keys.has("a")) x -= 1;
  if (keys.has("arrowright") || keys.has("d")) x += 1;
  if (keys.has("arrowup") || keys.has("w")) y -= 1;
  if (keys.has("arrowdown") || keys.has("s")) y += 1;

  const length = Math.hypot(x, y);
  if (length > 0) {
    x /= length;
    y /= length;
  }

  return { x, y, moving: length > 0 };
}

function startDash() {
  if (bee.dashCooldown > 0) return;
  bee.dashCooldown = 0.65;
  bee.dashTime = 0.13;
  burst(bee.x, bee.y, "#fff5a6", 8);
}

function makeFlowerClusters() {
  const clusters = [
    { recipe: ["red"], x: hive.x - 280, y: hive.y - 210 },
    { recipe: ["yellow"], x: hive.x + 290, y: hive.y - 190 },
    { recipe: ["blue"], x: hive.x + 10, y: hive.y + 310 },
  ];
  const result = [];

  clusters.forEach((cluster) => {
    for (let i = 0; i < 30; i += 1) {
      const angle = randRange(rand, 0, Math.PI * 2);
      const range = Math.sqrt(rand()) * 430;
      const x = clamp(cluster.x + Math.cos(angle) * range, 75, world.width - 75);
      const y = clamp(cluster.y + Math.sin(angle) * range, 80, world.height - 75);

      if (dist(x, y, hive.x, hive.y) > 105 && result.every((flower) => dist(x, y, flower.x, flower.y) > 48)) {
        result.push(createFlower({ x, y, recipe: cluster.recipe, growth: 1 }));
      }
    }
  });

  return result;
}

function makeRoamingBees(count) {
  const result = [];
  for (let i = 0; i < count; i += 1) {
    const angle = randRange(rand, 0, Math.PI * 2);
    result.push({
      x: randRange(rand, hive.x - 520, hive.x + 520),
      y: randRange(rand, hive.y - 440, hive.y + 440),
      angle,
      speed: randRange(rand, 45, 95),
      turnTimer: randRange(rand, 0.2, 2.4),
      wingFrame: randRange(rand, 0, Math.PI * 2),
      facing: Math.cos(angle) >= 0 ? 1 : -1,
    });
  }
  return result;
}

function updateRoamingBee(roamer, dt) {
  roamer.turnTimer -= dt;
  if (roamer.turnTimer <= 0) {
    roamer.angle += randRange(rand, -1.1, 1.1);
    roamer.speed = randRange(rand, 45, 95);
    roamer.turnTimer = randRange(rand, 0.45, 2.2);
  }

  roamer.x += Math.cos(roamer.angle) * roamer.speed * dt;
  roamer.y += Math.sin(roamer.angle) * roamer.speed * dt;

  if (roamer.x < 40 || roamer.x > world.width - 40) {
    roamer.angle = Math.PI - roamer.angle;
  }
  if (roamer.y < 40 || roamer.y > world.height - 40) {
    roamer.angle = -roamer.angle;
  }

  roamer.x = clamp(roamer.x, 40, world.width - 40);
  roamer.y = clamp(roamer.y, 40, world.height - 40);
  roamer.facing = Math.cos(roamer.angle) >= 0 ? 1 : -1;
  roamer.wingFrame += dt * 14;
}

function createFlower({ x, y, recipe, growth = 0, growTime = randRange(rand, 16, 28) }) {
  const id = globalThis.crypto && globalThis.crypto.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
  const color = recipeToColor(recipe);

  return {
    id,
    x,
    y,
    radius: 18,
    recipe: normalizeRecipe(recipe),
    color,
    nectarTaken: false,
    hasPollen: true,
    glow: 0,
    growth,
    growTime,
    sway: randRange(rand, 0, Math.PI * 2),
    swaySpeed: randRange(rand, 1.3, 2.5),
  };
}

function makeGrass(count) {
  const result = [];
  for (let i = 0; i < count; i += 1) {
    result.push({
      x: Math.floor(randRange(rand, 0, world.width) / 4) * 4,
      y: Math.floor(randRange(rand, 0, world.height) / 4) * 4,
      height: Math.floor(randRange(rand, 7, 13)),
    });
  }
  return result;
}

function blendRecipes(a, b) {
  return normalizeRecipe([...a, ...b]).slice(0, 8);
}

function spawnSeedlingNear(parent, recipe) {
  if (flowers.length >= 180) return;

  for (let i = 0; i < 24; i += 1) {
    const angle = randRange(rand, 0, Math.PI * 2);
    const range = randRange(rand, 42, 120);
    const x = clamp(parent.x + Math.cos(angle) * range, 55, world.width - 55);
    const y = clamp(parent.y + Math.sin(angle) * range, 65, world.height - 55);
    const spaced = flowers.every((flower) => dist(x, y, flower.x, flower.y) > 34);

    if (spaced && dist(x, y, hive.x, hive.y) > 100) {
      const seedling = createFlower({ x, y, recipe, growth: 0, growTime: 10 });
      flowers.push(seedling);
      recordColorRecipe(seedling.recipe);
      burst(x, y, seedling.color, 12);
      return;
    }
  }
}

function recordColorRecipe(recipe) {
  knownColorRecipes.set(recipeKey(recipe), normalizeRecipe(recipe));
}

function recipeToColor(recipe) {
  const normalized = normalizeRecipe(recipe);
  const sums = normalized.reduce((total, name) => {
    const rgb = primaryPigments[name].rgb;
    return [total[0] + rgb[0], total[1] + rgb[1], total[2] + rgb[2]];
  }, [0, 0, 0]);

  const mixed = sums.map((value) => Math.round(value / normalized.length));
  const mud = Math.max(0, normalized.length - new Set(normalized).size) * 9;
  const rich = mixed.map((value) => clamp(Math.round(value * 0.92 - mud + 18), 35, 255));
  return rgbToHex(rich);
}

function normalizeRecipe(recipe) {
  return [...recipe].sort((a, b) => a.localeCompare(b));
}

function recipeKey(recipe) {
  return normalizeRecipe(recipe).join("+");
}

function rgbToHex(rgb) {
  return `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function lighten(hex, amount) {
  const rgb = hexToRgb(hex).map((value) => Math.round(value + (255 - value) * amount));
  return rgbToHex(rgb);
}

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function burst(x, y, color, count) {
  for (let i = 0; i < count; i += 1) {
    const angle = randRange(rand, 0, Math.PI * 2);
    const speed = randRange(rand, 42, 150);
    const size = Math.floor(randRange(rand, 3, 7));

    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      size,
      life: randRange(rand, 0.35, 0.75),
      maxLife: 0.75,
    });
  }
}

function pixelCircle(x, y, radius, color) {
  ctx.fillStyle = color;
  const step = 4;
  for (let py = -radius; py <= radius; py += step) {
    for (let px = -radius; px <= radius; px += step) {
      if (px * px + py * py <= radius * radius) {
        ctx.fillRect(Math.round(x + px), Math.round(y + py), step, step);
      }
    }
  }
}

function isNearCamera(x, y, padding) {
  return x > camera.x - padding
    && x < camera.x + canvas.width + padding
    && y > camera.y - padding
    && y < camera.y + canvas.height + padding;
}

function dist(x1, y1, x2, y2) {
  return Math.hypot(x1 - x2, y1 - y2);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randRange(random, min, max) {
  return random() * (max - min) + min;
}

function mulberry32(seed) {
  return function next() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
