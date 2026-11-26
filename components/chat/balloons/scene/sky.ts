// #528 Gainer Balloons: the sky, the light, the ground and the weather.
// The time of day follows New York (the market's clock): eight keyframes from 4:00 AM to 8:00 PM.
// The conditions come from a weather reading (lib/gainerBalloons/weather.ts): cloud cover pulls the
// sky to grey and paints drifting cloud layers into the dome, the sun dims and the light flattens,
// fog thickens, rain or snow falls (one draw call each, moved in the shader, none in the smallest
// cards or with reduced motion), and a thunderstorm glows softly once every several seconds.
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Line,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Points,
  RingGeometry,
  SRGBColorSpace,
  BackSide,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  type Scene,
} from "three";
import { LAYOUT, MARKET_HOURS, SCALES } from "@/lib/gainerBalloons/config";
import { PLAIN_SKY, type SkyWeather } from "@/lib/gainerBalloons/weather";
import { lightningPulse } from "./lightning";
import type { SceneQuality } from "./quality";

type Keyframe = {
  hour: number;
  zenith: Color;
  mid: Color;
  horizon: Color;
  fog: Color;
  sunCol: Color;
  sunInt: number;
  sunElev: number;
  sunAzim: number;
  hemiSky: Color;
  hemiGnd: Color;
  hemiInt: number;
  groundTint: Color;
};
const key = (
  hour: number,
  zenith: string,
  mid: string,
  horizon: string,
  fog: string,
  sunCol: string,
  sunInt: number,
  sunElev: number,
  sunAzim: number,
  hemiSky: string,
  hemiGnd: string,
  hemiInt: number,
  groundTint: string,
): Keyframe => ({
  hour,
  zenith: new Color(zenith),
  mid: new Color(mid),
  horizon: new Color(horizon),
  fog: new Color(fog),
  sunCol: new Color(sunCol),
  sunInt,
  sunElev,
  sunAzim,
  hemiSky: new Color(hemiSky),
  hemiGnd: new Color(hemiGnd),
  hemiInt,
  groundTint: new Color(groundTint),
});

// Hours in New York time.
const SKY_KEYFRAMES: Keyframe[] = [
  key(
    4.0,
    "#131b32",
    "#273152",
    "#5a4b66",
    "#393750",
    "#ffb899",
    0.65,
    4,
    -72,
    "#5c6c9c",
    "#252333",
    0.78,
    "#2b3042",
  ), // pre-market twilight
  key(
    6.5,
    "#3b5f94",
    "#7f94b8",
    "#f0c2a4",
    "#d9c2b8",
    "#ffd3a8",
    1.45,
    14,
    -58,
    "#b6c8e4",
    "#6b5e58",
    0.95,
    "#8e8987",
  ), // sunrise
  key(
    9.0,
    "#5c8ec4",
    "#a4c4df",
    "#e6edf2",
    "#dbe5ee",
    "#fff5e4",
    1.95,
    36,
    -35,
    "#d4e5f7",
    "#8c9296",
    1.05,
    "#c5ced6",
  ), // the open
  key(
    12.75,
    "#4c84be",
    "#97bee0",
    "#e8eff5",
    "#dde7f0",
    "#fffaf0",
    2.1,
    52,
    10,
    "#dcebfb",
    "#9aa0a6",
    1.12,
    "#cdd5dc",
  ), // midday
  key(
    15.75,
    "#4d79ad",
    "#98b0cf",
    "#f0d8be",
    "#e4d6c8",
    "#ffe0b5",
    1.85,
    26,
    48,
    "#d2dceb",
    "#867e78",
    1.02,
    "#beb9b2",
  ), // towards the close
  key(
    17.25,
    "#2d4270",
    "#6a6c94",
    "#e3a27d",
    "#9c848a",
    "#ffb580",
    1.25,
    9,
    68,
    "#8c92ba",
    "#49404b",
    0.88,
    "#635c66",
  ), // golden hour
  key(
    19.0,
    "#121a30",
    "#222e4f",
    "#43486b",
    "#2a314a",
    "#b8ccff",
    0.85,
    22,
    76,
    "#5a6e9e",
    "#242938",
    0.85,
    "#283042",
  ), // after-hours evening
  key(
    20.0,
    "#0e1528",
    "#1c2642",
    "#343c5c",
    "#22283d",
    "#adc4ff",
    0.8,
    26,
    82,
    "#506494",
    "#1e2230",
    0.82,
    "#222838",
  ), // the end of after hours
];

function createGroundTexture() {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2;
  const cy = size / 2;
  const pxPerUnit = size / 130; // the ground disc is 130 across

  const bg = ctx.createRadialGradient(cx, cy, 40, cx, cy, size * 0.5);
  bg.addColorStop(0, "#eef2f6");
  bg.addColorStop(0.55, "#e2e8ee");
  bg.addColorStop(1, "#cfd7e0");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  // Faint rings where the rows stand.
  ctx.strokeStyle = "rgba(42, 56, 78, 0.11)";
  ctx.lineWidth = 1.5;
  for (let row = 0; row < 5; row++) {
    const r = LAYOUT.innerRadius + row * LAYOUT.rowSpacing;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * pxPerUnit, r * LAYOUT.zStretch * pxPerUnit, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Spokes between the wings.
  ctx.strokeStyle = "rgba(42, 56, 78, 0.14)";
  ctx.lineWidth = 1.6;
  for (const deg of [-152, -66, 34, 152]) {
    const rad = (deg * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(rad) * 7.2 * pxPerUnit, cy - Math.cos(rad) * 7.2 * LAYOUT.zStretch * pxPerUnit);
    ctx.lineTo(cx + Math.sin(rad) * 35 * pxPerUnit, cy - Math.cos(rad) * 35 * LAYOUT.zStretch * pxPerUnit);
    ctx.stroke();
  }
  // Each wing's name, etched at the inner rim.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const sector of Object.values(LAYOUT.sectors)) {
    const mid = (((sector.startDeg + sector.endDeg) / 2) * Math.PI) / 180;
    ctx.save();
    ctx.translate(
      cx + Math.sin(mid) * 7.2 * pxPerUnit,
      cy - Math.cos(mid) * 7.2 * LAYOUT.zStretch * pxPerUnit,
    );
    ctx.fillStyle = "rgba(32, 46, 68, 0.38)";
    ctx.font = "600 11px system-ui, -apple-system, sans-serif";
    ctx.fillText(sector.label, 0, -5);
    ctx.fillStyle = "rgba(32, 46, 68, 0.24)";
    ctx.font = "500 9px system-ui, -apple-system, sans-serif";
    ctx.fillText(sector.subtitle, 0, 7);
    ctx.restore();
  }
  const tex = new CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunGlow;
  uniform float uCloud;
  uniform vec3 uCloudLit;
  uniform vec3 uCloudShade;
  uniform float uCloudTime;
  uniform float uFlash;
  varying vec3 vWorldDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < OCTAVES; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.3, 9.1); a *= 0.5; }
    return v;
  }
  // One flat cloud layer seen from below: thicker with more cover, thinning out at the horizon.
  float layer(vec3 d, float scale, vec2 drift, float cover) {
    vec2 uv = d.xz / (d.y + 0.16) * scale + drift;
    float n = fbm(uv);
    float edge = 1.02 - cover * 0.86;
    return smoothstep(edge, edge + 0.3, n + cover * 0.28);
  }

  void main() {
    vec3 d = normalize(vWorldDir);
    float h = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.26, h));
    col = mix(col, uZenith, smoothstep(0.20, 0.82, h));

    float sunAmt = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSunColor * pow(sunAmt, 10.0) * 0.26 * uSunGlow;
    col += uSunColor * pow(sunAmt, 96.0) * 0.45 * uSunGlow;

    if (uCloud > 0.01 && d.y > -0.02) {
      float c = layer(d, 0.55, vec2(uCloudTime * 0.012, uCloudTime * 0.004), uCloud);
      #ifdef TWO_LAYERS
        float c2 = layer(d, 1.25, vec2(-uCloudTime * 0.02, uCloudTime * 0.009) + 31.0, uCloud * 0.9);
        c = clamp(c + c2 * 0.55, 0.0, 1.0);
      #endif
      float fade = smoothstep(-0.02, 0.07, d.y);
      vec3 cloudCol = mix(uCloudShade, uCloudLit, clamp(0.35 + 0.65 * (1.0 - c) + sunAmt * 0.25, 0.0, 1.0));
      cloudCol += vec3(0.55, 0.6, 0.78) * uFlash * 0.55;
      col = mix(col, cloudCol, c * fade * (0.55 + 0.4 * uCloud));
    }
    col += vec3(0.3, 0.33, 0.45) * uFlash * 0.22;

    col = mix(uHorizon, col, smoothstep(-0.08, 0.02, d.y));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const RAIN_VERTEX = /* glsl */ `
  attribute float aEnd;
  attribute float aSeed;
  uniform float uTime;
  uniform float uLen;
  uniform vec2 uWind;
  varying float vFade;
  void main() {
    float tall = 44.0;
    float y = mod(position.y - uTime * (26.0 + aSeed * 12.0), tall);
    vec3 p = vec3(position.x, y + aEnd * uLen, position.z);
    p.xz += uWind * (aEnd * uLen * 0.3 + (tall - y) * 0.06);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vFade = (1.0 - smoothstep(60.0, 150.0, -mv.z)) * smoothstep(0.0, 2.5, y);
    gl_Position = projectionMatrix * mv;
  }
`;
const RAIN_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vFade;
  void main() { gl_FragColor = vec4(uColor, uAlpha * vFade); }
`;
const SNOW_VERTEX = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uPointScale;
  uniform vec2 uWind;
  varying float vFade;
  void main() {
    float tall = 40.0;
    float y = mod(position.y - uTime * (1.7 + aSeed * 1.5), tall);
    vec3 p = vec3(position.x + sin(uTime * 0.6 + aSeed * 40.0) * 1.1, y, position.z + cos(uTime * 0.45 + aSeed * 23.0) * 0.9);
    p.xz += uWind * (tall - y) * 0.12;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vFade = (1.0 - smoothstep(50.0, 140.0, -mv.z)) * smoothstep(0.0, 1.5, y);
    gl_PointSize = clamp((0.16 + aSeed * 0.12) * uPointScale / -mv.z, 1.0, 9.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const SNOW_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vFade;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    gl_FragColor = vec4(uColor, uAlpha * vFade * (1.0 - smoothstep(0.15, 0.5, r)));
  }
`;

export type SkyState = { sunDir: Vector3; darkSky: boolean };

export function createSkySystem(scene: Scene, quality: SceneQuality) {
  const skyUniforms = {
    uZenith: { value: new Color("#5c8ec4") },
    uMid: { value: new Color("#a4c4df") },
    uHorizon: { value: new Color("#e6edf2") },
    uSunDir: { value: new Vector3(0.3, 0.5, -0.8).normalize() },
    uSunColor: { value: new Color("#fff5e4") },
    uSunGlow: { value: 0.45 },
    uCloud: { value: 0 },
    uCloudLit: { value: new Color("#ffffff") },
    uCloudShade: { value: new Color("#9aa4b2") },
    uCloudTime: { value: 0 },
    uFlash: { value: 0 },
  };
  const skyMat = new ShaderMaterial({
    uniforms: skyUniforms,
    defines: {
      OCTAVES: quality.cloudLayers === 2 ? 4 : 3,
      ...(quality.cloudLayers === 2 ? { TWO_LAYERS: 1 } : {}),
    },
    side: BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: SKY_FRAGMENT,
  });
  const skyGeo = new SphereGeometry(240, 32, 20);
  const skyDome = new Mesh(skyGeo, skyMat);
  skyDome.renderOrder = -10;
  scene.add(skyDome);

  const fog = new FogExp2("#dbe5ee", PLAIN_SKY.fogDensity);
  scene.fog = fog;

  const hemiLight = new HemisphereLight("#d4e5f7", "#8c9296", 1.05);
  const sunLight = new DirectionalLight("#fff5e4", 1.95);
  sunLight.position.set(-28, 36, 22);
  // A cool fill from the other side, so a balloon in shadow never goes muddy.
  const rimLight = new DirectionalLight("#b9d4f2", 0.55);
  rimLight.position.set(30, 18, -32);
  scene.add(hemiLight, sunLight, rimLight);

  const groundTex = createGroundTexture();
  const groundMat = new MeshStandardMaterial({
    map: groundTex,
    color: new Color("#c5ced6"),
    roughness: 0.94,
    metalness: 0,
  });
  const groundGeo = new CircleGeometry(65, 72);
  const ground = new Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // The ground carries on to the horizon, so there is no rim to see.
  const skirtBase = new Color("#cfd7e0");
  const skirtMat = new MeshStandardMaterial({ color: new Color("#c5ced6"), roughness: 0.94, metalness: 0 });
  const skirtGeo = new RingGeometry(64.8, 238, 72);
  const skirt = new Mesh(skirtGeo, skirtMat);
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.y = -0.01;
  scene.add(skirt);

  // A dashed ring at the height of 0% change.
  const ringPoints: Vector3[] = [];
  const rx = 34.5;
  for (let i = 0; i <= 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    ringPoints.push(
      new Vector3(Math.sin(a) * rx, SCALES.altitude.zeroPctY, -Math.cos(a) * rx * LAYOUT.zStretch),
    );
  }
  const zeroRingGeo = new BufferGeometry().setFromPoints(ringPoints);
  const zeroRingMat = new LineDashedMaterial({
    color: "#6b829c",
    dashSize: 1.2,
    gapSize: 1.4,
    transparent: true,
    opacity: 0.28,
  });
  const zeroRing = new Line(zeroRingGeo, zeroRingMat);
  zeroRing.computeLineDistances();
  scene.add(zeroRing);

  // Rain and snow: one draw call each, every drop moved by the shader. None at all when the
  // quality level has no particles (the smallest cards).
  const count = quality.particles;
  const fxUniforms = { uTime: { value: 0 }, uWind: { value: new Vector2(0.6, 0.25) } };
  let rain: LineSegments<BufferGeometry, ShaderMaterial> | null = null;
  let snow: Points<BufferGeometry, ShaderMaterial> | null = null;
  if (count > 0) {
    // A fixed scatter (the same every time, so a picture can be compared with another).
    let seed = 1234567;
    const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const rainPos = new Float32Array(count * 2 * 3);
    const rainEnd = new Float32Array(count * 2);
    const rainSeed = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = (rand() - 0.5) * 110;
      const y = rand() * 44;
      const z = (rand() - 0.5) * 110;
      const s = rand();
      for (let v = 0; v < 2; v++) {
        rainPos.set([x, y, z], (i * 2 + v) * 3);
        rainEnd[i * 2 + v] = v;
        rainSeed[i * 2 + v] = s;
      }
    }
    const rainGeo = new BufferGeometry();
    rainGeo.setAttribute("position", new BufferAttribute(rainPos, 3));
    rainGeo.setAttribute("aEnd", new BufferAttribute(rainEnd, 1));
    rainGeo.setAttribute("aSeed", new BufferAttribute(rainSeed, 1));
    rain = new LineSegments(
      rainGeo,
      new ShaderMaterial({
        uniforms: {
          ...fxUniforms,
          uLen: { value: 1.3 },
          uColor: { value: new Color("#dfe8f4") },
          uAlpha: { value: 0 },
        },
        vertexShader: RAIN_VERTEX,
        fragmentShader: RAIN_FRAGMENT,
        transparent: true,
        depthWrite: false,
      }),
    );
    rain.frustumCulled = false;
    rain.renderOrder = 4;
    rain.visible = false;
    scene.add(rain);

    const snowPos = new Float32Array(count * 3);
    const snowSeed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      snowPos.set([(rand() - 0.5) * 100, rand() * 40, (rand() - 0.5) * 100], i * 3);
      snowSeed[i] = rand();
    }
    const snowGeo = new BufferGeometry();
    snowGeo.setAttribute("position", new BufferAttribute(snowPos, 3));
    snowGeo.setAttribute("aSeed", new BufferAttribute(snowSeed, 1));
    snow = new Points(
      snowGeo,
      new ShaderMaterial({
        uniforms: {
          ...fxUniforms,
          uPointScale: { value: 600 },
          uColor: { value: new Color("#ffffff") },
          uAlpha: { value: 0 },
        },
        vertexShader: SNOW_VERTEX,
        fragmentShader: SNOW_FRAGMENT,
        transparent: true,
        depthWrite: false,
      }),
    );
    snow.frustumCulled = false;
    snow.renderOrder = 4;
    snow.visible = false;
    scene.add(snow);
  }

  const sunDirOut = new Vector3();
  const grey = new Color();
  const tmp = new Color();
  // The weather the sky is showing now; it eases towards each new reading.
  const shown: SkyWeather = { ...PLAIN_SKY };
  let first = true;
  let cloudTime = 0;

  /** Pulls a colour towards the grey of the same brightness. */
  function overcast(color: Color, amount: number) {
    const lum = color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
    grey.setRGB(lum * 0.94 + 0.01, lum * 0.97 + 0.012, lum * 1.02 + 0.018);
    color.lerp(grey, amount);
  }

  function update(
    progress: number,
    weather: SkyWeather,
    dt: number,
    elapsedSec: number,
    reducedMotion: boolean,
  ): SkyState {
    const ease = first ? 1 : 1 - Math.exp(-1.4 * Math.min(dt, 0.2));
    first = false;
    shown.cloud += (weather.cloud - shown.cloud) * ease;
    shown.dim += (weather.dim - shown.dim) * ease;
    shown.fogDensity += (weather.fogDensity - shown.fogDensity) * ease;
    shown.rain += (weather.rain - shown.rain) * ease;
    shown.snow += (weather.snow - shown.snow) * ease;
    shown.thunder = weather.thunder;
    if (!reducedMotion) cloudTime += dt;

    const hour =
      (MARKET_HOURS.dayStartMin + progress * (MARKET_HOURS.dayEndMin - MARKET_HOURS.dayStartMin)) / 60;
    let k0 = SKY_KEYFRAMES[0];
    let k1 = SKY_KEYFRAMES[SKY_KEYFRAMES.length - 1];
    for (let i = 0; i < SKY_KEYFRAMES.length - 1; i++) {
      if (hour >= SKY_KEYFRAMES[i].hour && hour <= SKY_KEYFRAMES[i + 1].hour) {
        k0 = SKY_KEYFRAMES[i];
        k1 = SKY_KEYFRAMES[i + 1];
        break;
      }
    }
    const t = Math.min(1, Math.max(0, (hour - k0.hour) / Math.max(0.0001, k1.hour - k0.hour)));
    const st = t * t * (3 - 2 * t);
    const { cloud, dim } = shown;

    const zenith = skyUniforms.uZenith.value.copy(k0.zenith).lerp(k1.zenith, st);
    const mid = skyUniforms.uMid.value.copy(k0.mid).lerp(k1.mid, st);
    const horizon = skyUniforms.uHorizon.value.copy(k0.horizon).lerp(k1.horizon, st);
    // Overcast: less colour, and the top and bottom of the sky closer to its middle.
    overcast(zenith, cloud * 0.8);
    overcast(mid, cloud * 0.8);
    overcast(horizon, cloud * 0.75);
    zenith.lerp(mid, cloud * 0.45);
    horizon.lerp(mid, cloud * 0.3);
    fog.color.copy(k0.fog).lerp(k1.fog, st);
    overcast(fog.color, cloud * 0.75);
    fog.color.lerp(horizon, cloud * 0.35);
    fog.density = shown.fogDensity;

    const elev = ((k0.sunElev + (k1.sunElev - k0.sunElev) * st) * Math.PI) / 180;
    const azim = ((k0.sunAzim + (k1.sunAzim - k0.sunAzim) * st) * Math.PI) / 180;
    sunDirOut
      .set(Math.cos(elev) * Math.sin(azim), Math.sin(elev), Math.cos(elev) * Math.cos(azim) * 0.65 - 0.35)
      .normalize();
    skyUniforms.uSunDir.value.copy(sunDirOut);
    skyUniforms.uSunColor.value.copy(k0.sunCol).lerp(k1.sunCol, st);
    skyUniforms.uSunGlow.value = (0.25 + 0.65 * Math.max(0, Math.sin(elev * 1.4))) * (1 - cloud * 0.9);

    const flash = shown.thunder && !reducedMotion ? lightningPulse(elapsedSec) : 0;
    skyUniforms.uFlash.value = flash;
    skyUniforms.uCloud.value = cloud;
    skyUniforms.uCloudTime.value = cloudTime;

    sunLight.position.copy(sunDirOut).multiplyScalar(68);
    sunLight.color.copy(skyUniforms.uSunColor.value);
    overcast(sunLight.color, dim * 0.7);
    // Under cloud the sun is dimmer and the sky's own light does more of the work: flatter, softer.
    sunLight.intensity = (k0.sunInt + (k1.sunInt - k0.sunInt) * st) * (1 - dim * 0.62);
    hemiLight.color.copy(k0.hemiSky).lerp(k1.hemiSky, st);
    overcast(hemiLight.color, cloud * 0.6);
    hemiLight.groundColor.copy(k0.hemiGnd).lerp(k1.hemiGnd, st);
    hemiLight.intensity = (k0.hemiInt + (k1.hemiInt - k0.hemiInt) * st) * (1 + dim * 0.14) + flash * 0.3;

    // The clouds take the sky's light: bright by day, slate at night, darker when it rains.
    skyUniforms.uCloudLit.value
      .copy(hemiLight.color)
      .lerp(tmp.set("#ffffff"), 0.35)
      .multiplyScalar(Math.min(1, 0.55 + hemiLight.intensity * 0.42) * (1 - dim * 0.3));
    skyUniforms.uCloudShade.value.copy(skyUniforms.uCloudLit.value).multiplyScalar(0.62).lerp(mid, 0.25);

    groundMat.color.copy(k0.groundTint).lerp(k1.groundTint, st);
    overcast(groundMat.color, cloud * 0.5);
    groundMat.color.multiplyScalar(1 - dim * 0.14 + shown.snow * 0.1);
    groundMat.roughness = 0.94 - shown.rain * 0.3;
    skirtMat.color.copy(groundMat.color).multiply(skirtBase);
    skirtMat.roughness = groundMat.roughness;

    const isTwilight = hour < 6.1 || hour > 17.0;
    rimLight.intensity = (isTwilight ? 0.72 : 0.48) * (1 - dim * 0.25);
    rimLight.color.set(isTwilight ? "#9bb8f0" : "#c6dff5");
    zeroRingMat.opacity = isTwilight ? 0.22 : 0.3;

    fxUniforms.uTime.value = elapsedSec;
    if (rain) {
      const on = !reducedMotion && shown.rain > 0.03;
      rain.visible = on;
      if (on) {
        rain.geometry.setDrawRange(0, Math.max(2, Math.round(count * Math.min(1, shown.rain)) * 2));
        rain.material.uniforms.uAlpha.value =
          (isTwilight ? 0.26 : 0.34) * Math.min(1, 0.5 + shown.rain * 0.5);
        rain.material.uniforms.uLen.value = 0.7 + shown.rain * 0.8;
      }
    }
    if (snow) {
      const on = !reducedMotion && shown.snow > 0.03;
      snow.visible = on;
      if (on) {
        snow.geometry.setDrawRange(0, Math.max(1, Math.round(count * Math.min(1, shown.snow))));
        snow.material.uniforms.uAlpha.value = 0.82 * Math.min(1, shown.snow);
      }
    }
    return { sunDir: sunDirOut, darkSky: isTwilight || dim > 0.75 };
  }

  /** Flakes keep their size on screen: `scale` is the canvas height in pixels over 2·tan(fov/2). */
  function setPointScale(scale: number) {
    if (snow) snow.material.uniforms.uPointScale.value = scale;
  }

  function dispose() {
    scene.fog = null;
    scene.remove(skyDome, hemiLight, sunLight, rimLight, ground, skirt, zeroRing);
    for (const item of [
      skyGeo,
      skyMat,
      groundTex,
      groundMat,
      groundGeo,
      skirtMat,
      skirtGeo,
      zeroRingGeo,
      zeroRingMat,
    ])
      item.dispose();
    for (const fx of [rain, snow]) {
      if (!fx) continue;
      scene.remove(fx);
      fx.geometry.dispose();
      fx.material.dispose();
    }
    hemiLight.dispose();
    sunLight.dispose();
    rimLight.dispose();
  }

  return { update, setPointScale, dispose };
}
