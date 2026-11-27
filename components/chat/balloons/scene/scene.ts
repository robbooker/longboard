// #528 Gainer Balloons: the three.js scene. This file (and everything it imports from three) is
// downloaded only when the app or a balloons card is opened: the React shell loads it with a
// dynamic import, so the ordinary chat bundle carries none of it.
//
// One WebGL context per scene, and dispose() gives it back: every geometry, material and texture is
// released and the context itself is dropped, so opening and closing cards never uses them up
// (browsers allow about 16).
import {
  ACESFilmicToneMapping,
  BackSide,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  TOUCH,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Snapshot, StockMetadata } from "@/lib/gainerBalloons/data";
import type { Anchor } from "@/lib/gainerBalloons/layout";
import type { SkyWeather } from "@/lib/gainerBalloons/weather";
import { createBalloonField, type BalloonMotion, type LabelOptions } from "./balloons";
import { createSkySystem } from "./sky";
import type { SceneQuality } from "./quality";

const CAMERA_TARGET = new Vector3(0, 6.8, -2.5);
/** From the target towards the default camera (0, 16.5, 44.5). */
const CAMERA_DIRECTION = new Vector3(0, 16.5, 44.5).sub(CAMERA_TARGET).normalize();
const MIN_DISTANCE = 10;
const MAX_DISTANCE = 95;
/** Half the width the home view takes in for a full field (60 stocks): both wings and the back arc. */
const FULL_FIELD_HALF_WIDTH = 31;
/** A quiet day's few balloons are framed closer, but never closer than this half width. */
const SMALL_FIELD_HALF_WIDTH = 17;

/** Half the width to frame for these moorings: the outermost one plus room for its balloon and label. */
export function fieldHalfWidth(anchors: readonly { x: number }[]): number {
  let reach = 0;
  for (const anchor of anchors) reach = Math.max(reach, Math.abs(anchor.x));
  return Math.min(FULL_FIELD_HALF_WIDTH, Math.max(SMALL_FIELD_HALF_WIDTH, reach + 6));
}

/** The lens: 44 degrees on a wide canvas, opening to 58 on a tall narrow one (a phone held upright, a slim card). */
export function fieldOfView(aspect: number): number {
  const narrow = Math.min(1, Math.max(0, (1.2 - aspect) / 0.6));
  return 44 + 14 * narrow;
}

/** How far back the camera sits to take the field in: further on a narrow canvas, as far as the zoom limit allows. */
export function defaultCameraDistance(aspect: number, halfWidth = FULL_FIELD_HALF_WIDTH): number {
  const halfTan = Math.tan((fieldOfView(aspect) * Math.PI) / 360) * Math.max(0.2, aspect);
  // Never closer than 46: on a wide, short canvas (a Quad pane) that keeps the tallest balloons under the top edge.
  return Math.min(MAX_DISTANCE - 3, Math.max(46, halfWidth / halfTan));
}

/** A soft studio sky for the balloons' reflections, drawn here: nothing is fetched. */
function buildEnvironment(renderer: WebGLRenderer) {
  const pmrem = new PMREMGenerator(renderer);
  const envScene = new Scene();
  const domeMat = new ShaderMaterial({
    side: BackSide,
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vPos = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        float h = vPos.y;
        vec3 col = mix(vec3(0.42, 0.46, 0.52), vec3(0.86, 0.91, 0.96), smoothstep(-0.2, 0.25, h));
        col = mix(col, vec3(0.55, 0.74, 0.94), smoothstep(0.25, 0.9, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const domeGeo = new SphereGeometry(20, 24, 16);
  envScene.add(new Mesh(domeGeo, domeMat));
  const panels: Array<[PlaneGeometry, MeshBasicMaterial, [number, number, number]]> = [
    [
      new PlaneGeometry(10, 6),
      new MeshBasicMaterial({ color: new Color(2.4, 2.35, 2.25), side: DoubleSide }),
      [-7, 10, 7],
    ],
    [
      new PlaneGeometry(8, 5),
      new MeshBasicMaterial({ color: new Color(1.4, 1.65, 2.0), side: DoubleSide }),
      [9, 7, -6],
    ],
  ];
  for (const [geo, mat, at] of panels) {
    const panel = new Mesh(geo, mat);
    panel.position.set(...at);
    panel.lookAt(0, 0, 0);
    envScene.add(panel);
  }
  const target = pmrem.fromScene(envScene, 0.04);
  pmrem.dispose();
  domeMat.dispose();
  domeGeo.dispose();
  for (const [geo, mat] of panels) {
    geo.dispose();
    mat.dispose();
  }
  return target;
}

export type BalloonSceneOptions = {
  quality: SceneQuality;
  /** A balloon (or its label) was tapped: its stock id, or -1 for a tap on nothing. */
  onSelect: (stockId: number) => void;
  /** The graphics context went away (the browser took it back). */
  onContextLost: () => void;
  /** The viewer touched the scene (orbit, zoom, tap): keeps a card at full frame rate for a moment. */
  onInteract: () => void;
};

export type FrameOptions = {
  reducedMotion: boolean;
  /** Arrive at once instead of easing (the first frame, a jump in time, a new day). */
  snap: boolean;
  weather: SkyWeather;
  labels: Pick<LabelOptions, "budget" | "textPx">;
};

export type BalloonScene = ReturnType<typeof createBalloonScene>;

/** Throws when the browser gives no WebGL context; the caller then shows the plain list. */
export function createBalloonScene(
  container: HTMLElement,
  { quality, onSelect, onContextLost, onInteract }: BalloonSceneOptions,
) {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance", alpha: false });
  const canvas = renderer.domElement;
  let width = Math.max(1, container.clientWidth);
  let height = Math.max(1, container.clientHeight);
  let maxPixelRatio = quality.maxPixelRatio;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
  // false: the stylesheet sizes the canvas (it fills its box); only the drawing buffer is set here.
  renderer.setSize(width, height, false);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = SRGBColorSpace;
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.balloonsCanvas = "";
  container.appendChild(canvas);

  const scene = new Scene();
  const environment = buildEnvironment(renderer);
  scene.environment = environment.texture;

  const camera = new PerspectiveCamera(fieldOfView(width / height), width / height, 0.5, 420);
  let fieldHalf = FULL_FIELD_HALF_WIDTH;
  const homePosition = (aspect: number) =>
    CAMERA_TARGET.clone().addScaledVector(CAMERA_DIRECTION, defaultCameraDistance(aspect, fieldHalf));
  camera.position.copy(homePosition(width / height));

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(CAMERA_TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  controls.minPolarAngle = 0.14;
  controls.maxPolarAngle = Math.PI * 0.475;
  controls.panSpeed = 0.7;
  controls.rotateSpeed = 0.65;
  controls.zoomSpeed = 0.85;
  controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
  controls.update();

  const sky = createSkySystem(scene, quality);
  const setPointScale = () => sky.setPointScale(height / (2 * Math.tan((camera.fov * Math.PI) / 360)));
  setPointScale();

  let field: ReturnType<typeof createBalloonField> | null = null;
  let selectedId = -1;
  /** True until the viewer moves the camera: the home view then follows the canvas's shape. */
  let atHome = true;
  let glide: {
    fromPos: Vector3;
    toPos: Vector3;
    fromTarget: Vector3;
    toTarget: Vector3;
    t: number;
    duration: number;
  } | null = null;

  /** Keeps the camera over the field and above the ground, wherever a pan or pinch tries to take it. */
  function keepInBounds() {
    const target = controls.target;
    const before = target.clone();
    const reach = Math.hypot(target.x, target.z);
    if (reach > 42) target.multiply(new Vector3(42 / reach, 1, 42 / reach));
    target.y = Math.min(24, Math.max(1, target.y));
    if (!target.equals(before)) camera.position.add(target.clone().sub(before));
    if (camera.position.y < 1.2) camera.position.y = 1.2;
  }

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let downX = 0;
  let downY = 0;
  let moved = false;
  const toPointer = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
  };
  const onPointerDown = (event: PointerEvent) => {
    onInteract();
    if (event.pointerType === "mouse" && event.button !== 0) return;
    downX = event.clientX;
    downY = event.clientY;
    moved = false;
  };
  const onPointerMove = (event: PointerEvent) => {
    if (event.buttons > 0) {
      onInteract();
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > 7) moved = true;
      return;
    }
    if (event.pointerType === "mouse" && field) {
      toPointer(event);
      canvas.style.cursor = field.resolveHit(raycaster) >= 0 ? "pointer" : "grab";
    }
  };
  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // A tap is a press that didn't move. How long it took isn't counted: on a slow phone a quick tap can
    // take a while to arrive, and a long press on a balloon may as well select it.
    if (moved || Math.hypot(event.clientX - downX, event.clientY - downY) > 8 || !field) return;
    toPointer(event);
    onSelect(field.resolveHit(raycaster));
  };
  const onWheel = () => onInteract();
  const onLost = (event: Event) => {
    event.preventDefault();
    onContextLost();
  };
  const onControlStart = () => {
    glide = null;
    atHome = false;
    onInteract();
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: true });
  canvas.addEventListener("webglcontextlost", onLost);
  controls.addEventListener("start", onControlStart);

  function glideTo(toPos: Vector3, toTarget: Vector3, instant: boolean) {
    if (instant) {
      camera.position.copy(toPos);
      controls.target.copy(toTarget);
      controls.update();
      glide = null;
      return;
    }
    glide = {
      fromPos: camera.position.clone(),
      toPos,
      fromTarget: controls.target.clone(),
      toTarget,
      t: 0,
      duration: 0.65,
    };
  }

  const stats = {
    frames: 0,
    contextLost: false,
    labelsShown: 0,
    drawCalls: 0,
    target: [0, 0, 0] as [number, number, number],
    pixelRatio: renderer.getPixelRatio(),
    /** #539: what the weather is drawing (cloud shapes, rain streaks, snow flakes, the haze over the field). */
    weather: sky.drawn,
  };

  return {
    canvas,
    stats,
    /** A new list of stocks (or the same stocks re-laid): the balloons already flying keep their places and glide. */
    setStocks(stockMetadata: StockMetadata[], anchors: Anchor[]) {
      const carried: Map<string, BalloonMotion> | undefined = field?.motion();
      field?.dispose();
      field = createBalloonField(scene, stockMetadata, anchors, quality, carried);
      field.setSelectedId(selectedId);
      // Frame the field there is: a few balloons are brought closer, a full field is taken in whole.
      // Only while nobody has moved the camera; the first time it is simply set, afterwards it glides.
      const half = fieldHalfWidth(anchors);
      if (half !== fieldHalf) {
        fieldHalf = half;
        if (atHome) glideTo(homePosition(width / height), CAMERA_TARGET.clone(), !carried);
      }
    },
    setSelectedId(id: number) {
      selectedId = id;
      field?.setSelectedId(id);
    },
    /** Brings a balloon to the middle of the view, a comfortable distance away. */
    focusOn(stockId: number, instant: boolean) {
      if (!field) return;
      const at = field.getBalloonWorldPosition(stockId);
      const offset = camera.position.clone().sub(controls.target);
      offset.setLength(Math.min(offset.length(), 30));
      atHome = false;
      glideTo(at.clone().add(offset), at, instant);
    },
    /** Where a balloon is on the page, in CSS pixels from the canvas's corner (null when off screen). */
    screenPosition(stockId: number): { x: number; y: number } | null {
      if (!field) return null;
      const at = field.getBalloonWorldPosition(stockId).project(camera);
      if (at.z < -1 || at.z > 1 || Math.abs(at.x) > 1 || Math.abs(at.y) > 1) return null;
      return { x: (at.x * 0.5 + 0.5) * width, y: (1 - (at.y * 0.5 + 0.5)) * height };
    },
    resetCamera(instant: boolean) {
      atHome = true;
      glideTo(homePosition(width / height), CAMERA_TARGET.clone(), instant);
    },
    resize(nextWidth: number, nextHeight: number, nextMaxPixelRatio = maxPixelRatio) {
      const w = Math.max(1, Math.round(nextWidth));
      const h = Math.max(1, Math.round(nextHeight));
      const ratio = Math.min(window.devicePixelRatio || 1, nextMaxPixelRatio);
      if (w === width && h === height && ratio === renderer.getPixelRatio()) return;
      width = w;
      height = h;
      maxPixelRatio = nextMaxPixelRatio;
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = fieldOfView(w / h);
      camera.updateProjectionMatrix();
      setPointScale();
      stats.pixelRatio = ratio;
      // Nobody has moved the camera yet: keep the whole field framed in the new shape.
      if (atHome) {
        glide = null;
        camera.position.copy(homePosition(w / h));
        controls.target.copy(CAMERA_TARGET);
        controls.update();
      }
    },
    renderFrame(snapshot: Snapshot, dt: number, elapsedSec: number, options: FrameOptions) {
      if (stats.contextLost) return { darkSky: false };
      if (glide) {
        glide.t = Math.min(1, glide.t + dt / glide.duration);
        const ease = 1 - Math.pow(1 - glide.t, 3);
        camera.position.lerpVectors(glide.fromPos, glide.toPos, ease);
        controls.target.lerpVectors(glide.fromTarget, glide.toTarget, ease);
        if (glide.t >= 1) glide = null;
      }
      controls.update();
      keepInBounds();
      const skyState = sky.update(snapshot.progress, options.weather, dt, elapsedSec, options.reducedMotion);
      field?.update(snapshot, camera, dt, elapsedSec, options.reducedMotion, skyState.sunDir, options.snap, {
        ...options.labels,
        width,
        height,
      });
      renderer.render(scene, camera);
      stats.frames++;
      stats.drawCalls = renderer.info.render.calls;
      stats.labelsShown = field?.labelsShown() ?? 0;
      controls.target.toArray(stats.target);
      return { darkSky: skyState.darkSky };
    },
    markContextLost() {
      stats.contextLost = true;
    },
    dispose() {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("webglcontextlost", onLost);
      controls.removeEventListener("start", onControlStart);
      controls.dispose();
      field?.dispose();
      field = null;
      sky.dispose();
      scene.environment = null;
      environment.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
      // Hands the context back now instead of whenever the canvas is garbage collected.
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
