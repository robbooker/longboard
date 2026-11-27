// #539 Gainer Balloons: the weather you can see. Cloud shapes standing around the field, rain that
// falls in streaks with depth (and rings where it lands), and snow. Each is ONE draw call whose
// every vertex is moved by its shader; the cloud picture is painted here (nothing is fetched).
// Nothing here hazes the balloons: the shapes stand beyond the field and fade out near the camera.
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  LinearFilter,
  Mesh,
  Points,
  ShaderMaterial,
  Vector2,
  type IUniform,
  type Scene,
} from "three";

/** A fixed scatter (the same every time, so one picture can be compared with another). */
function scatter(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/**
 * These shaders write their colours straight to the screen (no tone mapping), as the sky dome does,
 * so a colour is given as it should look: "#5d6f8a" comes out as #5d6f8a.
 */
export function screenColor(hex: string) {
  return new Color(hex).convertLinearToSRGB();
}

const CLOUD_VARIANTS = 4;

/**
 * Four cloud shapes side by side. Red: how lit that part is (bright crown, dark belly).
 * Alpha: how much cloud is there (soft edges, a flatter base).
 */
function createCloudAtlas() {
  const cell = 256;
  const canvas = document.createElement("canvas");
  canvas.width = cell * CLOUD_VARIANTS;
  canvas.height = cell;
  const ctx = canvas.getContext("2d")!;
  const rand = scatter(539);
  for (let v = 0; v < CLOUD_VARIANTS; v++) {
    const part = document.createElement("canvas");
    part.width = cell;
    part.height = cell;
    const c = part.getContext("2d")!;
    const base = cell * 0.7;
    // The body: overlapping soft puffs, tallest towards the middle, sitting on one base line.
    const puffs = 15 + Math.floor(rand() * 6);
    for (let i = 0; i < puffs; i++) {
      const along = 0.16 + 0.68 * ((i + rand() * 0.8) / puffs);
      const mid = 1 - Math.abs(along - (0.42 + v * 0.05)) * 1.9;
      const r = cell * (0.075 + 0.085 * rand() + 0.05 * Math.max(0, mid));
      const x = along * cell;
      const y = base - r * 0.55 - rand() * cell * 0.2 * Math.max(0.15, mid);
      const puff = c.createRadialGradient(x, y, r * 0.1, x, y, r);
      puff.addColorStop(0, "rgba(255,255,255,0.95)");
      puff.addColorStop(0.55, "rgba(255,255,255,0.6)");
      puff.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = puff;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // The belly: darker towards the base, only where there is cloud.
    c.globalCompositeOperation = "source-atop";
    const belly = c.createLinearGradient(0, cell * 0.3, 0, base + cell * 0.04);
    belly.addColorStop(0, "rgba(0,0,0,0)");
    belly.addColorStop(0.55, "rgba(0,0,0,0.5)");
    belly.addColorStop(1, "rgba(0,0,0,0.92)");
    c.fillStyle = belly;
    c.fillRect(0, 0, cell, cell);
    // A ragged, thinning underside.
    c.globalCompositeOperation = "destination-out";
    const under = c.createLinearGradient(0, base - cell * 0.07, 0, base + cell * 0.1);
    under.addColorStop(0, "rgba(0,0,0,0)");
    under.addColorStop(1, "rgba(0,0,0,1)");
    c.fillStyle = under;
    c.fillRect(0, base - cell * 0.07, cell, cell);
    ctx.drawImage(part, v * cell, 0);
    part.width = part.height = 0;
  }
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

const CLOUD_VERTEX = /* glsl */ `
  attribute vec2 aCorner;
  attribute vec2 aSize;
  attribute vec4 aInfo; // which shape, its own opacity, its drift speed, 1 for a mist bank
  uniform float uDrift;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vMist;
  void main() {
    float turn = uDrift * aInfo.z;
    float cs = cos(turn), sn = sin(turn);
    vec3 p = vec3(position.x * cs - position.z * sn, position.y, position.x * sn + position.z * cs);
    vec4 mv = viewMatrix * vec4(p, 1.0);
    // Never over the balloons: a shape the camera has backed into fades away.
    vAlpha = aInfo.y * smoothstep(42.0, 95.0, -mv.z);
    mv.xy += aCorner * aSize * 0.5;
    vUv = vec2((aInfo.x + aCorner.x * 0.5 + 0.5) / ${CLOUD_VARIANTS}.0, aCorner.y * 0.5 + 0.5);
    vMist = aInfo.w;
    gl_Position = projectionMatrix * mv;
  }
`;
const CLOUD_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uCloudLit;
  uniform vec3 uCloudShade;
  uniform vec3 uMistColor;
  uniform float uAlpha;
  uniform float uMistAlpha;
  uniform float uBelly;
  uniform float uFlash;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vMist;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float a = t.a * vAlpha * mix(uAlpha, uMistAlpha, vMist);
    if (a < 0.004) discard;
    vec3 cloud = mix(uCloudShade * (1.0 - uBelly), uCloudLit, smoothstep(0.05, 0.95, t.r));
    cloud += vec3(0.55, 0.6, 0.78) * uFlash * 0.4;
    gl_FragColor = vec4(mix(cloud, uMistColor, vMist), a);
  }
`;

export type CloudShapeUniforms = {
  uCloudLit: IUniform<Color>;
  uCloudShade: IUniform<Color>;
  uFlash: IUniform<number>;
};

/**
 * Cloud shapes on two rings beyond the field (and, for fog, low mist banks), always facing the
 * camera and turning very slowly round the field. They take the sky dome's own cloud colours.
 */
export function createCloudShapes(scene: Scene, count: number, shared: CloudShapeUniforms) {
  const rand = scatter(90210);
  const mistCount = Math.max(4, Math.round(count * 0.5));
  const total = count + mistCount;
  type Shape = { x: number; y: number; z: number; w: number; h: number; info: [number, number, number, number]; r: number };
  const shapes: Shape[] = [];
  for (let i = 0; i < count; i++) {
    const far = i % 2 === 1;
    const angle = ((i + rand() * 0.7) / count) * Math.PI * 2;
    const r = far ? 190 + rand() * 30 : 140 + rand() * 28;
    const w = (far ? 96 : 70) + rand() * 46;
    shapes.push({
      x: Math.sin(angle) * r,
      y: far ? 46 + rand() * 30 : 24 + rand() * 18,
      z: Math.cos(angle) * r,
      w,
      h: w * (0.62 + rand() * 0.16),
      info: [Math.floor(rand() * CLOUD_VARIANTS), 0.72 + rand() * 0.28, (far ? 0.6 : 1) * (0.7 + rand() * 0.6), 0],
      r,
    });
  }
  for (let i = 0; i < mistCount; i++) {
    const angle = ((i + rand() * 0.6) / mistCount) * Math.PI * 2;
    const r = 118 + rand() * 60;
    const w = 130 + rand() * 60;
    shapes.push({
      x: Math.sin(angle) * r,
      y: 3 + rand() * 5,
      z: Math.cos(angle) * r,
      w,
      h: 30 + rand() * 16,
      info: [Math.floor(rand() * CLOUD_VARIANTS), 0.55 + rand() * 0.35, 0.5 + rand() * 0.5, 1],
      r,
    });
  }
  // Farthest first: the nearer shapes are painted over the farther ones from anywhere in the field.
  shapes.sort((a, b) => b.r - a.r);

  const corners = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];
  const pos = new Float32Array(total * 6 * 3);
  const corner = new Float32Array(total * 6 * 2);
  const size = new Float32Array(total * 6 * 2);
  const info = new Float32Array(total * 6 * 4);
  shapes.forEach((shape, i) => {
    for (let v = 0; v < 6; v++) {
      const at = i * 6 + v;
      pos.set([shape.x, shape.y, shape.z], at * 3);
      corner.set([corners[v * 2], corners[v * 2 + 1]], at * 2);
      size.set([shape.w, shape.h], at * 2);
      info.set(shape.info, at * 4);
    }
  });
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  geo.setAttribute("aCorner", new BufferAttribute(corner, 2));
  geo.setAttribute("aSize", new BufferAttribute(size, 2));
  geo.setAttribute("aInfo", new BufferAttribute(info, 4));
  const map = createCloudAtlas();
  const uniforms = {
    ...shared,
    uMap: { value: map },
    uMistColor: { value: new Color("#ffffff") },
    uAlpha: { value: 0 },
    uMistAlpha: { value: 0 },
    uBelly: { value: 0 },
    uDrift: { value: 0 },
  };
  const mat = new ShaderMaterial({
    uniforms,
    vertexShader: CLOUD_VERTEX,
    fragmentShader: CLOUD_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  // Painted before everything else that is see-through (balloons, strings, labels, rain).
  mesh.renderOrder = -9;
  mesh.visible = false;
  scene.add(mesh);

  return {
    count,
    mistCount,
    /** `cloudAlpha` / `mistAlpha` 0..1; `belly`: how much darker the undersides are (rain). */
    set(cloudAlpha: number, mistAlpha: number, belly: number, drift: number, mistColor: Color) {
      mesh.visible = cloudAlpha > 0.01 || mistAlpha > 0.01;
      uniforms.uAlpha.value = cloudAlpha;
      uniforms.uMistAlpha.value = mistAlpha;
      uniforms.uBelly.value = belly;
      uniforms.uDrift.value = drift;
      uniforms.uMistColor.value.copy(mistColor);
      return mesh.visible;
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
      map.dispose();
    },
  };
}

// A streak is a thin ribbon from the drop's head back along its fall, turned to face the camera.
// Its width is in the scene's own units, so a near streak is thicker and longer than a far one, but
// never thinner than about a pixel. Light against the sky, darker against a pale ground.
const RAIN_VERTEX = /* glsl */ `
  attribute vec2 aQuad; // x: -1 / +1 across the streak; y: 0 at the head, 1 at the tail
  attribute float aSeed;
  uniform float uTime;
  uniform float uLen;
  uniform float uWidth;
  uniform float uPointScale;
  uniform vec2 uSlant;
  varying float vFade;
  varying vec2 vQuad;
  varying float vLook;
  void main() {
    float tall = 46.0;
    float s2 = fract(aSeed * 7.31), s3 = fract(aSeed * 13.7), s4 = fract(aSeed * 29.3);
    float y = mod(position.y - uTime * (30.0 + aSeed * 16.0), tall);
    vec3 fall = normalize(vec3(uSlant.x, -1.0, uSlant.y));
    vec3 head = vec3(position.x, y, position.z);
    head.xz += uSlant * (tall - y);
    float len = uLen * (0.55 + 1.15 * s2);
    vec4 mvHead = modelViewMatrix * vec4(head, 1.0);
    vec4 mvTail = modelViewMatrix * vec4(head - fall * len, 1.0);
    vec4 mv = mix(mvHead, mvTail, aQuad.y);
    vec2 along = mvTail.xy - mvHead.xy;
    along = along / max(length(along), 0.0001);
    float dist = max(0.5, -mv.z);
    float want = uWidth * (0.65 + 0.7 * s3);
    float least = 0.55 * dist / uPointScale;
    float halfWidth = max(want, least);
    mv.xy += vec2(-along.y, along.x) * aQuad.x * halfWidth;
    vFade = (1.0 - smoothstep(75.0, 165.0, dist)) * smoothstep(5.0, 16.0, dist) * smoothstep(0.0, 1.2, y)
      * (0.45 + 0.55 * s4) * clamp(want / least, 0.4, 1.0);
    vQuad = aQuad;
    vec3 world = head - fall * len * aQuad.y;
    vLook = normalize(world - cameraPosition).y;
    gl_Position = projectionMatrix * mv;
  }
`;
const RAIN_FRAGMENT = /* glsl */ `
  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  uniform float uAlpha;
  uniform float uGroundAlpha;
  varying float vFade;
  varying vec2 vQuad;
  varying float vLook;
  void main() {
    // What is behind this streak: the sky above the horizon, the ground below it.
    float horizon = -cameraPosition.y / 236.0;
    float sky = smoothstep(horizon - 0.012, horizon + 0.02, vLook);
    float body = (0.6 + 0.4 * (1.0 - abs(vQuad.x))) * smoothstep(0.0, 0.07, vQuad.y) * pow(1.0 - vQuad.y, 0.7);
    gl_FragColor = vec4(mix(uGroundColor, uSkyColor, sky), mix(uGroundAlpha, uAlpha, sky) * vFade * body);
  }
`;
// Rings where the rain lands: flat on the ground, each one opening and fading, then somewhere new.
const SPLASH_VERTEX = /* glsl */ `
  attribute vec2 aCorner;
  attribute float aSeed;
  uniform float uTime;
  varying vec2 vCorner;
  varying float vFade;
  float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
  void main() {
    float beat = uTime * (0.9 + aSeed * 0.7) + aSeed * 31.0;
    float turn = floor(beat), phase = fract(beat);
    vec2 at = position.xz + (vec2(hash(turn + aSeed * 3.0), hash(turn * 1.7 + aSeed * 9.0)) - 0.5) * 16.0;
    float r = (0.18 + 0.82 * phase) * (0.42 + 0.3 * aSeed);
    vec4 mv = modelViewMatrix * vec4(at.x + aCorner.x * r, 0.03, at.y + aCorner.y * r, 1.0);
    vFade = pow(1.0 - phase, 1.4) * (1.0 - smoothstep(55.0, 120.0, -mv.z));
    vCorner = aCorner;
    gl_Position = projectionMatrix * mv;
  }
`;
const SPLASH_FRAGMENT = /* glsl */ `
  uniform vec3 uGroundColor;
  uniform float uGroundAlpha;
  varying vec2 vCorner;
  varying float vFade;
  void main() {
    float d = length(vCorner);
    float ring = smoothstep(0.5, 0.78, d) * (1.0 - smoothstep(0.84, 1.0, d));
    gl_FragColor = vec4(uGroundColor, ring * vFade * uGroundAlpha * 0.9);
  }
`;

const QUAD = [-1, 0, 1, 0, 1, 1, -1, 0, 1, 1, -1, 1];

/** Rain: `count` streaks at full rain, and a quarter as many rings on the ground. */
export function createRain(scene: Scene, count: number, time: IUniform<number>) {
  const rand = scatter(1234567);
  const pos = new Float32Array(count * 6 * 3);
  const quad = new Float32Array(count * 6 * 2);
  const seeds = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const x = (rand() - 0.5) * 116;
    const y = rand() * 46;
    const z = (rand() - 0.5) * 116;
    const s = rand();
    for (let v = 0; v < 6; v++) {
      pos.set([x, y, z], (i * 6 + v) * 3);
      quad.set([QUAD[v * 2], QUAD[v * 2 + 1]], (i * 6 + v) * 2);
      seeds[i * 6 + v] = s;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  geo.setAttribute("aQuad", new BufferAttribute(quad, 2));
  geo.setAttribute("aSeed", new BufferAttribute(seeds, 1));
  const tones = {
    uSkyColor: { value: screenColor("#eef4fb") },
    uGroundColor: { value: screenColor("#5f7088") },
    uAlpha: { value: 0 },
    uGroundAlpha: { value: 0 },
  };
  const uniforms = {
    ...tones,
    uTime: time,
    uLen: { value: 2.4 },
    uWidth: { value: 0.034 },
    uPointScale: { value: 600 },
    uSlant: { value: new Vector2(0.15, 0.05) },
  };
  const mat = new ShaderMaterial({
    uniforms,
    vertexShader: RAIN_VERTEX,
    fragmentShader: RAIN_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const streaks = new Mesh(geo, mat);
  streaks.frustumCulled = false;
  streaks.renderOrder = 4;
  streaks.visible = false;
  scene.add(streaks);

  const splashCount = Math.max(12, Math.round(count / 4));
  const sPos = new Float32Array(splashCount * 6 * 3);
  const sCorner = new Float32Array(splashCount * 6 * 2);
  const sSeed = new Float32Array(splashCount * 6);
  const corners = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];
  for (let i = 0; i < splashCount; i++) {
    // Mostly where the balloons stand and in front of them, where the ground is in view.
    const angle = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 46;
    const s = rand();
    for (let v = 0; v < 6; v++) {
      sPos.set([Math.sin(angle) * r, 0, Math.cos(angle) * r], (i * 6 + v) * 3);
      sCorner.set([corners[v * 2], corners[v * 2 + 1]], (i * 6 + v) * 2);
      sSeed[i * 6 + v] = s;
    }
  }
  const sGeo = new BufferGeometry();
  sGeo.setAttribute("position", new BufferAttribute(sPos, 3));
  sGeo.setAttribute("aCorner", new BufferAttribute(sCorner, 2));
  sGeo.setAttribute("aSeed", new BufferAttribute(sSeed, 1));
  const sMat = new ShaderMaterial({
    uniforms: { uTime: time, uGroundColor: tones.uGroundColor, uGroundAlpha: tones.uGroundAlpha },
    vertexShader: SPLASH_VERTEX,
    fragmentShader: SPLASH_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const splashes = new Mesh(sGeo, sMat);
  splashes.frustumCulled = false;
  splashes.renderOrder = 1;
  splashes.visible = false;
  scene.add(splashes);

  return {
    /**
     * `amount` 0..1 (drizzle 0.4, rain 1). `brightGround` 0..1: how pale the ground is now (a streak
     * over it is then drawn darker, or it could not be seen). `still`: reduced motion, no rings.
     * Answers how many streaks are drawn.
     */
    set(amount: number, brightGround: number, twilight: boolean, still: boolean) {
      const on = amount > 0.03;
      streaks.visible = on;
      splashes.visible = on && !still;
      if (!on) return 0;
      const drawn = Math.max(1, Math.round(count * Math.min(1, amount)));
      geo.setDrawRange(0, drawn * 6);
      sGeo.setDrawRange(0, Math.max(1, Math.round(splashCount * Math.min(1, amount))) * 6);
      const strength = Math.min(1, 0.55 + amount * 0.45);
      uniforms.uAlpha.value = (twilight ? 0.5 : 0.62) * strength;
      uniforms.uGroundAlpha.value = (0.4 + 0.1 * brightGround) * strength;
      uniforms.uLen.value = 1.5 + amount * 1.1;
      tones.uGroundColor.value.copy(DARK_STREAK).lerp(tones.uSkyColor.value, 1 - brightGround);
      return drawn;
    },
    setPointScale(scale: number) {
      uniforms.uPointScale.value = scale;
    },
    dispose() {
      scene.remove(streaks, splashes);
      geo.dispose();
      mat.dispose();
      sGeo.dispose();
      sMat.dispose();
    },
  };
}
const DARK_STREAK = screenColor("#5f7088");

const SNOW_VERTEX = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uPointScale;
  uniform vec2 uWind;
  varying float vFade;
  varying float vLook;
  void main() {
    float tall = 40.0;
    float y = mod(position.y - uTime * (1.7 + aSeed * 1.5), tall);
    vec3 p = vec3(position.x + sin(uTime * 0.6 + aSeed * 40.0) * 1.1, y, position.z + cos(uTime * 0.45 + aSeed * 23.0) * 0.9);
    p.xz += uWind * (tall - y) * 0.12;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vFade = (1.0 - smoothstep(55.0, 150.0, -mv.z)) * smoothstep(0.0, 1.5, y) * smoothstep(2.0, 7.0, -mv.z);
    vLook = normalize(p - cameraPosition).y;
    gl_PointSize = clamp((0.2 + fract(aSeed * 9.7) * 0.22) * uPointScale / -mv.z, 1.6, 12.0);
    gl_Position = projectionMatrix * mv;
  }
`;
// A flake is white; over a pale ground it shades to a soft blue-grey at its edge so it can still be picked out.
const SNOW_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uRimColor;
  uniform float uRim;
  uniform float uAlpha;
  varying float vFade;
  varying float vLook;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float horizon = -cameraPosition.y / 236.0;
    float ground = (1.0 - smoothstep(horizon - 0.012, horizon + 0.02, vLook)) * uRim;
    vec3 col = mix(uColor, uRimColor, smoothstep(0.08, 0.42, r) * ground * 0.8);
    float soft = 1.0 - smoothstep(mix(0.15, 0.22, ground), 0.5, r);
    gl_FragColor = vec4(col, uAlpha * vFade * soft);
  }
`;

/** Snow: `count` flakes at full snow. */
export function createSnow(scene: Scene, count: number, time: IUniform<number>) {
  const rand = scatter(7654321);
  const pos = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos.set([(rand() - 0.5) * 104, rand() * 40, (rand() - 0.5) * 104], i * 3);
    seeds[i] = rand();
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new BufferAttribute(seeds, 1));
  const uniforms = {
    uTime: time,
    uWind: { value: new Vector2(0.6, 0.25) },
    uPointScale: { value: 600 },
    uColor: { value: screenColor("#ffffff") },
    uRimColor: { value: screenColor("#93a4bd") },
    uRim: { value: 0 },
    uAlpha: { value: 0 },
  };
  const mat = new ShaderMaterial({
    uniforms,
    vertexShader: SNOW_VERTEX,
    fragmentShader: SNOW_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  const flakes = new Points(geo, mat);
  flakes.frustumCulled = false;
  flakes.renderOrder = 4;
  flakes.visible = false;
  scene.add(flakes);
  return {
    /** Answers how many flakes are drawn. */
    set(amount: number, brightGround: number) {
      const on = amount > 0.03;
      flakes.visible = on;
      if (!on) return 0;
      const drawn = Math.max(1, Math.round(count * Math.min(1, amount)));
      geo.setDrawRange(0, drawn);
      uniforms.uAlpha.value = 0.92 * Math.min(1, amount);
      uniforms.uRim.value = brightGround;
      return drawn;
    },
    setPointScale(scale: number) {
      uniforms.uPointScale.value = scale;
    },
    dispose() {
      scene.remove(flakes);
      geo.dispose();
      mat.dispose();
    },
  };
}
