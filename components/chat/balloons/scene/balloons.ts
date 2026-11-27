// #528 Gainer Balloons: the balloons themselves, their strings, moorings, shadows, burst ripples
// and ticker labels.
//   - one balloon shape for every stock; two instanced meshes (2 draw calls): glossy latex that
//     strains as the float turns over, and matte frosted balloons for stocks whose float isn't known;
//   - one line batch for every string, one instanced mesh each for moorings, shadows and ripples;
//   - one small sprite per ticker label. Labels are a fixed size on screen (so a small card stays
//     readable), limited to the biggest stories by volume, and never drawn over one another: the
//     rest appear when their balloon is tapped.
// Everything made here is released by dispose(), so a card can be opened and closed all day.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  LineBasicMaterial,
  LineSegments,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  type PerspectiveCamera,
  type Raycaster,
  type Scene,
} from "three";
import { SCALES } from "@/lib/gainerBalloons/config";
import { mapPctChangeToY, type Snapshot, type StockMetadata } from "@/lib/gainerBalloons/data";
import type { Anchor } from "@/lib/gainerBalloons/layout";
import type { SceneQuality } from "./quality";

type SharedUniforms = {
  uTime: { value: number };
  uReducedMotion: { value: number };
  uSunDir: { value: Vector3 };
};

/** A balloon's eased state. Kept by ticker when the list of stocks changes, so nothing jumps. */
export type BalloonMotion = {
  ax: number;
  az: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  elongation: number;
  strain: number;
  liftLoss: number;
  tiltX: number;
  tiltZ: number;
  burst: number;
  phase: number;
  leanAngle: number;
  labelShown: number;
};

/** The latex teardrop with its neck and knot. Widest radius 1, crown about +1.1, knot about -1.24. */
function createBalloonGeometry(segments: number) {
  const pts = [
    [0.001, -1.24],
    [0.095, -1.23],
    [0.042, -1.14],
    [0.11, -1.04],
    [0.28, -0.88],
    [0.5, -0.66],
    [0.72, -0.4],
    [0.89, -0.12],
    [0.985, 0.14],
    [1.0, 0.36],
    [0.95, 0.58],
    [0.83, 0.78],
    [0.64, 0.94],
    [0.4, 1.04],
    [0.16, 1.085],
    [0.001, 1.095],
  ].map(([x, y]) => new Vector2(x, y));
  const geo = new LatheGeometry(pts, segments);
  geo.computeVertexNormals();
  return geo;
}

/** The frosted, chalky skin of a balloon whose float isn't known. */
function createUnknownFloatTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#e7edf3";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(130, 148, 168, 0.22)";
  ctx.lineWidth = 5;
  for (let i = -size; i < size * 2; i += 22) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + size, size);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255, 255, 255, 0.38)";
  for (let y = 4; y < size; y += 10)
    for (let x = y % 20 === 0 ? 4 : 9; x < size; x += 12) ctx.fillRect(x, y, 2, 2);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function createShadowTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(18, 28, 44, 0.42)");
  g.addColorStop(0.55, "rgba(18, 28, 44, 0.16)");
  g.addColorStop(1, "rgba(18, 28, 44, 0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

const LABEL_W = 192;
const LABEL_H = 64;
const LABEL_FONT_PX = 30;
const LABEL_PILL_H = 44;

/**
 * The ticker's pill: near-white letters on a dark pill, so it reads over a dawn, noon, evening,
 * snowy or foggy sky alike (at least 6:1 even over white). A filled dot for a known float, a hollow
 * one for an unknown float. Returns the pill's share of the picture's width, for the overlap check.
 */
function createTickerTexture(ticker: string, colorHex: string, floatKnown: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = LABEL_W;
  canvas.height = LABEL_H;
  const ctx = canvas.getContext("2d")!;
  ctx.font = `700 ${LABEL_FONT_PX}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
  const tw = ctx.measureText(ticker).width;
  const pillW = Math.min(LABEL_W - 8, Math.max(88, tw + 44 + 20));
  const px = (LABEL_W - pillW) / 2;
  const py = (LABEL_H - LABEL_PILL_H) / 2;
  ctx.beginPath();
  ctx.roundRect(px, py, pillW, LABEL_PILL_H, LABEL_PILL_H / 2);
  ctx.fillStyle = "rgba(16, 22, 34, 0.82)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = floatKnown ? "rgba(255, 255, 255, 0.24)" : "rgba(215, 226, 238, 0.44)";
  ctx.stroke();
  const dotX = px + 18;
  ctx.beginPath();
  ctx.arc(dotX, LABEL_H / 2, 5.5, 0, Math.PI * 2);
  if (floatKnown) {
    ctx.fillStyle = colorHex;
    ctx.fill();
  } else {
    ctx.strokeStyle = "#cfd8e3";
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }
  ctx.fillStyle = "#f6f8fb";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  // Long tickers are squeezed into the pill instead of running out of it.
  ctx.fillText(ticker, dotX + 13, LABEL_H / 2 + 1, pillW - 44);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  return { tex, pillShare: pillW / LABEL_W };
}

function createKnownBalloonMaterial(sharedUniforms: SharedUniforms) {
  const mat = new MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.22,
    metalness: 0.0,
    clearcoat: 0.96,
    clearcoatRoughness: 0.08,
    sheen: 0.25,
    sheenRoughness: 0.55,
    sheenColor: new Color("#fff4e8"),
    envMapIntensity: 1.05,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uReducedMotion = sharedUniforms.uReducedMotion;
    shader.uniforms.uSunDir = sharedUniforms.uSunDir;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        attribute float aStrain;
        attribute vec3 aStrainTint;
        attribute float aBurst;
        attribute float aSelected;
        attribute float aPhase;
        uniform float uTime;
        uniform float uReducedMotion;
        varying float vStrain;
        varying vec3 vStrainTint;
        varying float vBurst;
        varying float vSelected;
        varying vec3 vWorldNorm;
        varying vec3 vWorldPosition;
        `,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        vStrain = aStrain;
        vStrainTint = aStrainTint;
        vBurst = aBurst;
        vSelected = aSelected;

        // Subtle elastic tension vibration on over-inflated skin (zero at knot)
        float bodyMask = smoothstep(-0.95, -0.25, transformed.y);
        if (aStrain > 0.04 && uReducedMotion < 0.5) {
          float freq = 3.2 + aStrain * 3.8;
          float wave = sin(uTime * freq + aPhase + transformed.y * 4.5) *
                       cos(uTime * (freq * 0.7) + aPhase * 1.3 + transformed.x * 3.2);
          float amp = aStrain * aStrain * 0.022 * bodyMask;
          transformed += objectNormal * (wave * amp);
        }
        // Subtle radial inhale on fresh volume burst
        if (aBurst > 0.01) {
          transformed.xz *= (1.0 + aBurst * 0.055 * bodyMask);
        }
        `,
      )
      .replace(
        "#include <worldpos_vertex>",
        /* glsl */ `
        #include <worldpos_vertex>
        vec4 wpInst = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wpInst = instanceMatrix * wpInst;
        #endif
        wpInst = modelMatrix * wpInst;
        vWorldPosition = wpInst.xyz;
        mat3 nMat = mat3(modelMatrix);
        #ifdef USE_INSTANCING
          nMat = nMat * mat3(instanceMatrix);
        #endif
        vWorldNorm = normalize(nMat * objectNormal);
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform vec3 uSunDir;
        varying float vStrain;
        varying vec3 vStrainTint;
        varying float vBurst;
        varying float vSelected;
        varying vec3 vWorldNorm;
        varying vec3 vWorldPosition;
        `,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `
        #include <color_fragment>
        // Subtle warming as latex stretches thin while preserving rich core latex color
        diffuseColor.rgb = mix(diffuseColor.rgb, vStrainTint, vStrain * 0.14);
        // Gently soften unselected balloons when one is focused
        if (vSelected < -0.5) {
          float luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(luma), 0.22);
        }
        `,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `
        #include <roughnessmap_fragment>
        // Stretched latex pulls tighter and glossier
        roughnessFactor = mix(0.24, 0.055, vStrain);
        `,
      )
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `
        #include <emissivemap_fragment>
        vec3 N = normalize(vWorldNorm);
        vec3 V = normalize(cameraPosition - vWorldPosition);
        float ndotv = clamp(abs(dot(N, V)), 0.0, 1.0);
        float fresnel = pow(1.0 - ndotv, 2.2);
        float backlit = pow(clamp(dot(-N, normalize(uSunDir)) * 0.55 + 0.45, 0.0, 1.0), 1.8);

        // Thin-skin translucent rim glow + backlit subsurface scatter when over-inflated
        float thinGlow = vStrain * (0.04 + 0.68 * fresnel + 0.22 * backlit * (0.35 + 0.65 * fresnel));
        totalEmissiveRadiance += vStrainTint * thinGlow * 0.78;

        // Fresh volume burst warm internal bloom
        totalEmissiveRadiance += mix(vStrainTint, vec3(1.0, 0.96, 0.86), 0.5) * vBurst * (0.24 + 0.48 * fresnel);

        // Selected balloon crisp rim highlight
        if (vSelected > 0.5) {
          totalEmissiveRadiance += vec3(0.95, 0.98, 1.0) * (0.06 + 0.58 * fresnel);
        }
        `,
      );
  };

  return mat;
}

/**
 * Honest matte frosted-vellum material for unknown-float balloons:
 * Zero gloss clearcoat, zero fake strain, clear visual honesty.
 */
function createUnknownBalloonMaterial(sharedUniforms: SharedUniforms, frostedTex: CanvasTexture) {
  const mat = new MeshPhysicalMaterial({
    color: 0xffffff,
    map: frostedTex,
    roughness: 0.84,
    metalness: 0.0,
    clearcoat: 0.0,
    sheen: 0.45,
    sheenRoughness: 0.88,
    sheenColor: new Color("#eef3f8"),
    envMapIntensity: 0.55,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDir = sharedUniforms.uSunDir;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        attribute float aBurst;
        attribute float aSelected;
        varying float vBurst;
        varying float vSelected;
        varying vec3 vWorldNorm;
        varying vec3 vWorldPosition;
        `,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        vBurst = aBurst;
        vSelected = aSelected;
        float bodyMask = smoothstep(-0.95, -0.25, transformed.y);
        if (aBurst > 0.01) {
          transformed.xz *= (1.0 + aBurst * 0.045 * bodyMask);
        }
        `,
      )
      .replace(
        "#include <worldpos_vertex>",
        /* glsl */ `
        #include <worldpos_vertex>
        vec4 wpInst = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wpInst = instanceMatrix * wpInst;
        #endif
        wpInst = modelMatrix * wpInst;
        vWorldPosition = wpInst.xyz;
        mat3 nMat = mat3(modelMatrix);
        #ifdef USE_INSTANCING
          nMat = nMat * mat3(instanceMatrix);
        #endif
        vWorldNorm = normalize(nMat * objectNormal);
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        varying float vBurst;
        varying float vSelected;
        varying vec3 vWorldNorm;
        varying vec3 vWorldPosition;
        `,
      )
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `
        #include <emissivemap_fragment>
        vec3 N = normalize(vWorldNorm);
        vec3 V = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 2.4);

        // Soft chalky backlit translucency (subtle, never glossy strained latex)
        totalEmissiveRadiance += vec3(0.86, 0.90, 0.95) * fresnel * 0.14;

        // Fresh volume burst pulse
        totalEmissiveRadiance += vec3(0.98, 0.95, 0.88) * vBurst * (0.24 + 0.38 * fresnel);

        if (vSelected > 0.5) {
          totalEmissiveRadiance += vec3(0.95, 0.98, 1.0) * (0.12 + 0.52 * fresnel);
        }
        `,
      );
  };

  return mat;
}

function createBurstRings(count: number) {
  const ringGeo = new RingGeometry(0.88, 1.0, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const alphas = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  ringGeo.setAttribute("aAlpha", new InstancedBufferAttribute(alphas, 1));
  ringGeo.setAttribute("aRingColor", new InstancedBufferAttribute(colors, 3));
  const ringMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      attribute vec3 aRingColor;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vAlpha = aAlpha;
        vColor = aRingColor;
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        if (vAlpha < 0.005) discard;
        gl_FragColor = vec4(vColor, vAlpha);
      }
    `,
  });
  const mesh = new InstancedMesh(ringGeo, ringMat, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return { mesh, alphas, colors, ringGeo, ringMat };
}

export type LabelOptions = {
  /** The most labels shown at once (the selected balloon's is always one of them). */
  budget: number;
  /** The label's text height in CSS pixels. */
  textPx: number;
  /** The canvas's size in CSS pixels. */
  width: number;
  height: number;
};

export function createBalloonField(
  scene: Scene,
  stockMetadata: StockMetadata[],
  anchors: Anchor[],
  quality: SceneQuality,
  /** Where the balloons were before the list of stocks changed, by ticker. */
  carried?: Map<string, BalloonMotion>,
) {
  const count = stockMetadata.length;
  const TETHER_SEGMENTS = quality.tether;
  const sharedUniforms: SharedUniforms = {
    uTime: { value: 0 },
    uReducedMotion: { value: 0 },
    uSunDir: { value: new Vector3(0, 1, 0) },
  };

  const knownIds: number[] = [];
  const unknownIds: number[] = [];
  const stockSlot: Array<{ known: boolean; idx: number }> = new Array(count);
  for (let i = 0; i < count; i++) {
    const known = stockMetadata[i].floatKnown;
    stockSlot[i] = { known, idx: (known ? knownIds : unknownIds).length };
    (known ? knownIds : unknownIds).push(i);
  }

  const baseGeo = createBalloonGeometry(quality.lathe);
  const knownGeo = baseGeo.clone();
  const unknownGeo = baseGeo.clone();
  baseGeo.dispose();

  // At least one slot each so the buffers are never empty; a mesh with no stocks draws nothing.
  const kCount = Math.max(1, knownIds.length);
  const kStrain = new Float32Array(kCount);
  const kStrainTint = new Float32Array(kCount * 3);
  const kBurst = new Float32Array(kCount);
  const kSelected = new Float32Array(kCount);
  const kPhase = new Float32Array(kCount);
  knownGeo.setAttribute("aStrain", new InstancedBufferAttribute(kStrain, 1));
  knownGeo.setAttribute("aStrainTint", new InstancedBufferAttribute(kStrainTint, 3));
  knownGeo.setAttribute("aBurst", new InstancedBufferAttribute(kBurst, 1));
  knownGeo.setAttribute("aSelected", new InstancedBufferAttribute(kSelected, 1));
  knownGeo.setAttribute("aPhase", new InstancedBufferAttribute(kPhase, 1));
  const uCount = Math.max(1, unknownIds.length);
  const uBurst = new Float32Array(uCount);
  const uSelected = new Float32Array(uCount);
  unknownGeo.setAttribute("aBurst", new InstancedBufferAttribute(uBurst, 1));
  unknownGeo.setAttribute("aSelected", new InstancedBufferAttribute(uSelected, 1));

  const frostedTex = createUnknownFloatTexture();
  const knownMat = createKnownBalloonMaterial(sharedUniforms);
  const unknownMat = createUnknownBalloonMaterial(sharedUniforms, frostedTex);
  const knownMesh = new InstancedMesh(knownGeo, knownMat, kCount);
  const unknownMesh = new InstancedMesh(unknownGeo, unknownMat, uCount);
  knownMesh.count = knownIds.length;
  unknownMesh.count = unknownIds.length;
  knownMesh.frustumCulled = false;
  unknownMesh.frustumCulled = false;

  const tmpColor = new Color();
  const unknownBase = new Color(SCALES.strain.unknownBaseColor);
  for (let idx = 0; idx < knownIds.length; idx++) {
    const s = stockMetadata[knownIds[idx]];
    knownMesh.setColorAt(idx, tmpColor.set(s.colorHex));
    tmpColor.set(s.strainTintHex);
    kStrainTint.set([tmpColor.r, tmpColor.g, tmpColor.b], idx * 3);
    kPhase[idx] = (knownIds[idx] * 2.39996) % (Math.PI * 2);
  }
  for (let idx = 0; idx < unknownIds.length; idx++) {
    // Frosted alabaster with only a whisper of the country's colour.
    unknownMesh.setColorAt(
      idx,
      tmpColor
        .copy(unknownBase)
        .lerp(new Color(stockMetadata[unknownIds[idx]].colorHex), SCALES.strain.unknownCountryTintMix),
    );
  }
  if (knownMesh.instanceColor) knownMesh.instanceColor.needsUpdate = true;
  if (unknownMesh.instanceColor) unknownMesh.instanceColor.needsUpdate = true;
  scene.add(knownMesh, unknownMesh);

  const instances = Math.max(1, count);
  const anchorGeo = new CylinderGeometry(0.18, 0.24, 0.08, 12);
  const anchorMat = new MeshStandardMaterial({ color: "#6e7b8a", roughness: 0.65, metalness: 0.25 });
  const anchorMesh = new InstancedMesh(anchorGeo, anchorMat, instances);
  anchorMesh.count = count;
  anchorMesh.frustumCulled = false;
  scene.add(anchorMesh);

  const shadowGeo = new PlaneGeometry(2.6, 2.6);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowTex = createShadowTexture();
  const shadowMat = new MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
  });
  const shadowMesh = new InstancedMesh(shadowGeo, shadowMat, instances);
  shadowMesh.count = count;
  shadowMesh.frustumCulled = false;
  scene.add(shadowMesh);

  const burstRings = createBurstRings(instances);
  burstRings.mesh.count = count;
  for (let i = 0; i < count; i++) {
    const s = stockMetadata[i];
    tmpColor.set(s.floatKnown ? s.strainTintHex : "#eef4fa");
    burstRings.colors.set([tmpColor.r, tmpColor.g, tmpColor.b], i * 3);
  }
  scene.add(burstRings.mesh);

  const tetherPositions = new Float32Array(instances * TETHER_SEGMENTS * 2 * 3);
  const tetherColors = new Float32Array(instances * TETHER_SEGMENTS * 2 * 3);
  const tetherGeo = new BufferGeometry();
  tetherGeo.setAttribute("position", new BufferAttribute(tetherPositions, 3));
  tetherGeo.setAttribute("color", new BufferAttribute(tetherColors, 3));
  tetherGeo.setDrawRange(0, count * TETHER_SEGMENTS * 2);
  const tetherMat = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.62 });
  const tetherLines = new LineSegments(tetherGeo, tetherMat);
  tetherLines.frustumCulled = false;
  scene.add(tetherLines);

  const labels: Array<Sprite & { material: SpriteMaterial }> = [];
  const labelPillShare: number[] = [];
  for (let i = 0; i < count; i++) {
    const s = stockMetadata[i];
    const { tex, pillShare } = createTickerTexture(s.ticker, s.colorHex, s.floatKnown);
    const sprite = new Sprite(
      new SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false }),
    ) as Sprite & { material: SpriteMaterial };
    sprite.userData.stockId = i;
    sprite.visible = false;
    scene.add(sprite);
    labels.push(sprite);
    labelPillShare.push(pillShare);
  }

  const dyn: BalloonMotion[] = stockMetadata.map((s, i) => {
    const before = carried?.get(s.ticker);
    if (before) return { ...before };
    return {
      ax: anchors[i].x,
      az: anchors[i].z,
      x: anchors[i].x,
      y: SCALES.altitude.zeroPctY,
      z: anchors[i].z,
      radius: SCALES.volume.untradedRadius,
      elongation: 1.0,
      strain: 0,
      liftLoss: 0,
      tiltX: 0,
      tiltZ: 0,
      burst: 0,
      phase: (i * 1.6180339) % (Math.PI * 2),
      leanAngle: (i * 2.39996) % (Math.PI * 2),
      labelShown: 0,
    };
  });
  // A stock that just joined the field arrives in place; the ones already there glide.
  const fresh = stockMetadata.map((s) => !carried?.has(s.ticker));

  const mat4 = new Matrix4();
  const quat = new Quaternion();
  const euler = new Euler();
  const posVec = new Vector3();
  const scaleVec = new Vector3();
  const knotLocal = new Vector3();
  const knotWorld = new Vector3();
  const projected = new Vector3();
  const dummy = new Object3D();

  let selectedId = -1;
  let frame = 0;
  let labelsShown = 0;
  // Which labels the last overlap pass chose.
  const labelWanted = new Uint8Array(instances);
  const order: number[] = stockMetadata.map((_, i) => i);
  const placed: number[] = [];
  const rects = new Float32Array(instances * 4);

  function setSelectedId(id: number) {
    selectedId = id;
  }

  /** Chooses the labels to show: the selected one, then the biggest volume first, none overlapping. */
  function chooseLabels(snapshot: Snapshot, camera: PerspectiveCamera, options: LabelOptions) {
    const stocks = snapshot.stocks;
    order.sort(
      (a, b) =>
        (b === selectedId ? 1 : 0) - (a === selectedId ? 1 : 0) ||
        stocks[b].cumVolume - stocks[a].cumVolume ||
        a - b,
    );
    const pxH = (options.textPx * LABEL_H) / LABEL_FONT_PX;
    placed.length = 0;
    labelWanted.fill(0);
    for (const i of order) {
      if (placed.length >= options.budget && i !== selectedId) break;
      const label = labels[i];
      projected.copy(label.position).project(camera);
      if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1.05 || Math.abs(projected.y) > 1.05)
        continue;
      const cx = (projected.x * 0.5 + 0.5) * options.width;
      const cy = (1 - (projected.y * 0.5 + 0.5)) * options.height;
      // A label already showing keeps its place a little more easily than a new one takes it.
      const pad = dyn[i].labelShown > 0.5 ? 0 : 3;
      const halfW = (labelPillShare[i] * 3 * pxH) / 2 + pad;
      const halfH = (pxH * LABEL_PILL_H) / LABEL_H / 2 + pad;
      let clear = true;
      if (i !== selectedId) {
        for (const j of placed) {
          if (
            Math.abs(cx - rects[j * 4]) < halfW + rects[j * 4 + 2] &&
            Math.abs(cy - rects[j * 4 + 1]) < halfH + rects[j * 4 + 3]
          ) {
            clear = false;
            break;
          }
        }
      }
      if (!clear) continue;
      rects.set([cx, cy, halfW - pad, halfH - pad], i * 4);
      placed.push(i);
      labelWanted[i] = 1;
    }
  }

  function update(
    snapshot: Snapshot,
    camera: PerspectiveCamera,
    dt: number,
    elapsedSec: number,
    reducedMotion: boolean,
    sunDir: Vector3 | null,
    snapImmediately: boolean,
    labelOptions: LabelOptions,
  ) {
    sharedUniforms.uTime.value = elapsedSec;
    sharedUniforms.uReducedMotion.value = reducedMotion ? 1.0 : 0.0;
    if (sunDir) sharedUniforms.uSunDir.value.copy(sunDir);

    const stocks = snapshot.stocks;
    const motionScale = reducedMotion ? 0.0 : 1.0;
    const hasSelection = selectedId >= 0;
    const windAngle = elapsedSec * 0.14;
    const windX = Math.cos(windAngle);
    const windZ = Math.sin(windAngle) * 0.6;
    // World units per CSS pixel at distance 1 (labels keep their size on screen).
    const perPx = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, labelOptions.height);
    const labelPxH = (labelOptions.textPx * LABEL_H) / LABEL_FONT_PX;
    let tetherVertIdx = 0;

    for (let i = 0; i < count; i++) {
      const st = stocks[i];
      const d = dyn[i];
      const anchor = anchors[i];
      const snap = snapImmediately || fresh[i];
      fresh[i] = false;

      const targetRadius = st.radius;
      const targetElong = st.elongation;
      const targetY = st.hasTraded ? mapPctChangeToY(st.pctChange, targetRadius * targetElong) : 1.25;

      // Low float = lighter: a wider drift in the breeze and a quicker reaction.
      const agility = st.agility;
      const driftAmp =
        (SCALES.agility.minDriftRadius +
          (SCALES.agility.maxDriftRadius - SCALES.agility.minDriftRadius) * agility) *
        motionScale *
        (st.hasTraded ? 1.0 : 0.15);
      const freq = 0.42 + agility * 0.68;
      const driftX = (Math.sin(elapsedSec * freq + d.phase) * 0.65 + windX * 0.35) * driftAmp;
      const driftZ = (Math.cos(elapsedSec * freq * 0.83 + d.phase * 1.4) * 0.65 + windZ * 0.35) * driftAmp;
      // A small bob, quieter as the balloon loses lift.
      const bobAmp =
        (0.08 + agility * 0.14) * (1.0 - st.liftLoss * 0.72) * motionScale * (st.hasTraded ? 1.0 : 0.1);
      const bobY = Math.sin(elapsedSec * (0.9 + agility * 0.9) + d.phase * 2.1) * bobAmp;
      // A burst of volume gives a small lift, more for a light balloon.
      const burstKickY = st.burst * (0.28 + agility * 0.55) * (reducedMotion ? 0.25 : 1.0);

      const responseRate =
        SCALES.agility.minResponseRate +
        (SCALES.agility.maxResponseRate - SCALES.agility.minResponseRate) * agility;
      const alpha = snap ? 1.0 : 1 - Math.exp(-responseRate * Math.min(dt, 0.1));
      // The mooring glides too when the field is re-laid for a new stock.
      const anchorAlpha = snap ? 1.0 : 1 - Math.exp(-2.2 * Math.min(dt, 0.1));
      d.ax += (anchor.x - d.ax) * anchorAlpha;
      d.az += (anchor.z - d.az) * anchorAlpha;

      const desiredY = Math.max(targetRadius * targetElong + 0.45, targetY + bobY + burstKickY);
      d.x += (d.ax + driftX - d.x) * alpha;
      d.y += (desiredY - d.y) * alpha;
      d.z += (d.az + driftZ - d.z) * alpha;
      d.radius += (targetRadius - d.radius) * alpha;
      d.elongation += (targetElong - d.elongation) * alpha;
      d.strain += (st.strain - d.strain) * alpha;
      d.liftLoss += (st.liftLoss - d.liftLoss) * alpha;
      d.burst += (st.burst - d.burst) * Math.min(1, alpha * 1.6);

      // Tilt: the breeze's sway, and a weary lean when losing lift (up to about 14 degrees).
      const leanMag = d.liftLoss * 0.24;
      const targetTiltX = (d.z - d.az) * 0.08 * motionScale + Math.sin(d.leanAngle) * leanMag;
      const targetTiltZ = -(d.x - d.ax) * 0.08 * motionScale + Math.cos(d.leanAngle) * leanMag;
      d.tiltX += (targetTiltX - d.tiltX) * alpha;
      d.tiltZ += (targetTiltZ - d.tiltZ) * alpha;

      const rx = d.radius;
      const ry = d.radius * d.elongation;
      posVec.set(d.x, d.y, d.z);
      quat.setFromEuler(euler.set(d.tiltX, 0, d.tiltZ));
      mat4.compose(posVec, quat, scaleVec.set(rx, ry, rx));

      const selVal = !hasSelection ? 0.0 : i === selectedId ? 1.0 : -1.0;
      const slot = stockSlot[i];
      if (slot.known) {
        knownMesh.setMatrixAt(slot.idx, mat4);
        kStrain[slot.idx] = d.strain;
        kBurst[slot.idx] = d.burst;
        kSelected[slot.idx] = selVal;
      } else {
        unknownMesh.setMatrixAt(slot.idx, mat4);
        uBurst[slot.idx] = d.burst;
        uSelected[slot.idx] = selVal;
      }

      dummy.position.set(d.ax, 0.04, d.az);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      anchorMesh.setMatrixAt(i, dummy.matrix);

      // The string: from the mooring to the knot, sagging and bowing more as lift is lost.
      knotWorld.copy(posVec).add(knotLocal.set(0, -1.22 * ry, 0).applyQuaternion(quat));
      const slack = (0.12 + d.liftLoss * 1.35) * Math.min(1.3, Math.max(0.25, knotWorld.y / 6));
      const bowX = Math.cos(d.leanAngle) * slack + windX * 0.22 * motionScale;
      const bowZ = Math.sin(d.leanAngle) * slack + windZ * 0.22 * motionScale;
      const sagY = d.liftLoss * 1.55;
      const isSel = i === selectedId;
      const tint = isSel ? 0.98 : hasSelection ? 0.36 : 0.65;
      const rMul = isSel ? 1.0 : 0.72;
      const gMul = isSel ? 0.96 : 0.78;
      const bMul = isSel ? 0.88 : 0.86;
      let prevX = d.ax;
      let prevY = 0.06;
      let prevZ = d.az;
      for (let sIdx = 1; sIdx <= TETHER_SEGMENTS; sIdx++) {
        const u = sIdx / TETHER_SEGMENTS;
        const arc = Math.sin(u * Math.PI);
        const windRipple = Math.sin(elapsedSec * 1.6 + u * 4.2 + d.phase) * 0.06 * arc * motionScale;
        const curX = d.ax + (knotWorld.x - d.ax) * u + bowX * arc + windRipple;
        const curZ = d.az + (knotWorld.z - d.az) * u + bowZ * arc;
        const curY = Math.max(0.05, 0.06 + (knotWorld.y - 0.06) * u - sagY * arc * arc);
        const pOff = tetherVertIdx * 3;
        tetherPositions[pOff] = prevX;
        tetherPositions[pOff + 1] = prevY;
        tetherPositions[pOff + 2] = prevZ;
        tetherPositions[pOff + 3] = curX;
        tetherPositions[pOff + 4] = curY;
        tetherPositions[pOff + 5] = curZ;
        const shade0 = (0.35 + 0.55 * ((sIdx - 1) / TETHER_SEGMENTS)) * tint;
        const shade1 = (0.35 + 0.55 * u) * tint;
        tetherColors[pOff] = shade0 * rMul;
        tetherColors[pOff + 1] = shade0 * gMul;
        tetherColors[pOff + 2] = shade0 * bMul;
        tetherColors[pOff + 3] = shade1 * rMul;
        tetherColors[pOff + 4] = shade1 * gMul;
        tetherColors[pOff + 5] = shade1 * bMul;
        tetherVertIdx += 2;
        prevX = curX;
        prevY = curY;
        prevZ = curZ;
      }

      const shadowScale = d.radius * (1.0 + Math.min(0.65, d.y * 0.032));
      dummy.position.set(d.x, 0.02, d.z);
      dummy.scale.set(shadowScale, 1, shadowScale);
      dummy.updateMatrix();
      shadowMesh.setMatrixAt(i, dummy.matrix);

      // A burst's ring, spreading as it fades.
      if (st.burst > 0.015) {
        const ringRadius = d.radius * (1.12 + st.burstAge * 2.15);
        dummy.position.set(d.x, d.y + 0.1 * ry, d.z);
        dummy.rotation.set(d.tiltX * 0.5, 0, d.tiltZ * 0.5);
        dummy.scale.set(ringRadius, 1, ringRadius);
        burstRings.alphas[i] = Math.min(0.88, st.burst * 0.92);
      } else {
        dummy.position.set(0, -100, 0);
        dummy.scale.set(0.001, 0.001, 0.001);
        burstRings.alphas[i] = 0;
      }
      dummy.updateMatrix();
      burstRings.mesh.setMatrixAt(i, dummy.matrix);

      // The label floats just above the crown, the same size on screen wherever the balloon is.
      const label = labels[i];
      label.position.set(d.x, d.y + ry * 1.12 + 0.58, d.z);
      const worldH = labelPxH * perPx * camera.position.distanceTo(label.position) * (isSel ? 1.15 : 1.0);
      label.scale.set(worldH * (LABEL_W / LABEL_H), worldH, 1);
      label.renderOrder = isSel ? 12 : 6;
    }

    // Choose the labels a few times a second; fade them in and out every frame.
    if (frame % 6 === 0 || snapImmediately) chooseLabels(snapshot, camera, labelOptions);
    frame++;
    labelsShown = 0;
    const fade = snapImmediately || reducedMotion ? 1 : 1 - Math.exp(-9 * Math.min(dt, 0.1));
    for (let i = 0; i < count; i++) {
      const d = dyn[i];
      d.labelShown += ((labelWanted[i] ? 1 : 0) - d.labelShown) * fade;
      const label = labels[i];
      label.visible = d.labelShown > 0.02;
      label.material.opacity = d.labelShown * (!hasSelection ? 0.96 : i === selectedId ? 1.0 : 0.72);
      if (labelWanted[i]) labelsShown++;
    }

    knownMesh.instanceMatrix.needsUpdate = true;
    knownGeo.attributes.aStrain.needsUpdate = true;
    knownGeo.attributes.aBurst.needsUpdate = true;
    knownGeo.attributes.aSelected.needsUpdate = true;
    unknownMesh.instanceMatrix.needsUpdate = true;
    unknownGeo.attributes.aBurst.needsUpdate = true;
    unknownGeo.attributes.aSelected.needsUpdate = true;
    anchorMesh.instanceMatrix.needsUpdate = true;
    shadowMesh.instanceMatrix.needsUpdate = true;
    burstRings.mesh.instanceMatrix.needsUpdate = true;
    burstRings.ringGeo.attributes.aAlpha.needsUpdate = true;
    tetherGeo.attributes.position.needsUpdate = true;
    tetherGeo.attributes.color.needsUpdate = true;
  }

  /** The stock under a ray (a balloon first, then a visible label), or -1. */
  function resolveHit(raycaster: Raycaster): number {
    // The balloons move every frame; the meshes' bounds must be worked out again before each test.
    const meshes = [knownMesh, unknownMesh].filter((mesh) => mesh.count > 0);
    for (const mesh of meshes) mesh.computeBoundingSphere();
    const meshHit = raycaster.intersectObjects(meshes, false)[0];
    if (meshHit && meshHit.instanceId != null)
      return (meshHit.object === knownMesh ? knownIds : unknownIds)[meshHit.instanceId] ?? -1;
    const labelHit = raycaster.intersectObjects(
      labels.filter((label) => label.visible),
      false,
    )[0];
    const sid = labelHit?.object.userData.stockId;
    return typeof sid === "number" ? sid : -1;
  }

  function getBalloonWorldPosition(stockId: number, target = new Vector3()) {
    const d = dyn[stockId];
    return d ? target.set(d.x, d.y, d.z) : target.set(0, 6, 0);
  }

  /** Every balloon's eased state by ticker, to hand to the next field. */
  function motion() {
    return new Map(stockMetadata.map((s, i) => [s.ticker, dyn[i]]));
  }

  function dispose() {
    scene.remove(knownMesh, unknownMesh, anchorMesh, shadowMesh, burstRings.mesh, tetherLines, ...labels);
    for (const mesh of [knownMesh, unknownMesh, anchorMesh, shadowMesh, burstRings.mesh]) mesh.dispose();
    for (const item of [
      knownGeo,
      unknownGeo,
      knownMat,
      unknownMat,
      frostedTex,
      anchorGeo,
      anchorMat,
      shadowGeo,
      shadowTex,
      shadowMat,
      burstRings.ringGeo,
      burstRings.ringMat,
      tetherGeo,
      tetherMat,
    ])
      item.dispose();
    for (const label of labels) {
      label.material.map?.dispose();
      label.material.dispose();
    }
  }

  return {
    update,
    resolveHit,
    setSelectedId,
    getBalloonWorldPosition,
    motion,
    dispose,
    labelsShown: () => labelsShown,
  };
}
