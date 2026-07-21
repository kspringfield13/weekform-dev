import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PointLight,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";

export type CapacitySignalMetrics = {
  available: number;
  committed: number;
};

export type CapacitySignalScene = {
  setMetrics: (metrics: CapacitySignalMetrics) => void;
  dispose: () => void;
};

type CapacitySignalSceneOptions = {
  canvas: HTMLCanvasElement;
  host: HTMLElement;
  metrics: CapacitySignalMetrics;
  onReady: () => void;
  onUnavailable: () => void;
};

type SignalPalette = {
  available: Color;
  availableHighlight: Color;
  committed: Color;
  protected: Color;
  dark: boolean;
};

const U_SEGMENTS = 96;
const V_SEGMENTS = 8;
const SCAN_DURATION_MS = 1_600;
const SCAN_REST_MS = 6_400;
const MAX_DPR = 1.5;

function clampPct(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function signalPoint(u: number, v: number, target = new Vector3()) {
  const x = -2.65 + 5.3 * u;
  const z = -0.58 + 1.16 * v + 0.1 * Math.sin(Math.PI * 2 * u);
  const y =
    0.28 * Math.sin(Math.PI * 8 * u - 0.45) * (0.72 + 0.28 * u) +
    0.045 * Math.cos(Math.PI * (v - 0.5));
  return target.set(x, y, z);
}

function createRibbonGeometry() {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const uValues: number[] = [];

  for (let uIndex = 0; uIndex <= U_SEGMENTS; uIndex += 1) {
    const u = uIndex / U_SEGMENTS;
    for (let vIndex = 0; vIndex <= V_SEGMENTS; vIndex += 1) {
      const v = vIndex / V_SEGMENTS;
      const point = signalPoint(u, v);
      positions.push(point.x, point.y, point.z);
      colors.push(1, 1, 1);
      uValues.push(u);
    }
  }

  for (let uIndex = 0; uIndex < U_SEGMENTS; uIndex += 1) {
    for (let vIndex = 0; vIndex < V_SEGMENTS; vIndex += 1) {
      const row = V_SEGMENTS + 1;
      const a = uIndex * row + vIndex;
      const b = (uIndex + 1) * row + vIndex;
      const c = (uIndex + 1) * row + vIndex + 1;
      const d = uIndex * row + vIndex + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return { geometry, uValues };
}

function createRailGeometry() {
  const positions: number[] = [];
  const colors: number[] = [];
  const uValues: number[] = [];
  const railPositions = [0, 0.25, 0.5, 0.75, 1];

  railPositions.forEach((v) => {
    for (let index = 0; index < U_SEGMENTS; index += 1) {
      const uStart = index / U_SEGMENTS;
      const uEnd = (index + 1) / U_SEGMENTS;
      const start = signalPoint(uStart, v);
      const end = signalPoint(uEnd, v);
      positions.push(start.x, start.y + 0.006, start.z, end.x, end.y + 0.006, end.z);
      colors.push(1, 1, 1, 1, 1, 1);
      uValues.push(uStart, uEnd);
    }
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return { geometry, uValues };
}

function createBoundaryGeometry() {
  const positions = new Float32Array(V_SEGMENTS * 2 * 2 * 3);
  const colors = new Float32Array(V_SEGMENTS * 2 * 2 * 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  return geometry;
}

function createScanGeometry() {
  const positions = new Float32Array((V_SEGMENTS + 1) * 2 * 3);
  const indices: number[] = [];
  for (let index = 0; index < V_SEGMENTS; index += 1) {
    const a = index * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function readCssColor(host: HTMLElement, variable: string, fallback: string) {
  const dashboard = host.closest<HTMLElement>(".capacity-dashboard") ?? host;
  const raw = getComputedStyle(dashboard).getPropertyValue(variable).trim();
  try {
    return new Color(raw || fallback);
  } catch {
    return new Color(fallback);
  }
}

function readPalette(host: HTMLElement): SignalPalette {
  const dark = document.documentElement.dataset.theme === "dark";
  const available = readCssColor(host, "--week-green", dark ? "#4ade80" : "#16a34a");
  const committed = readCssColor(host, "--week-blue", dark ? "#60a5fa" : "#2563eb");
  const surface = readCssColor(host, "--surface", dark ? "#111111" : "#ffffff");
  const muted = readCssColor(host, "--text-subtle", dark ? "#737373" : "#777777");
  const protectedColor = surface.clone().lerp(muted, dark ? 0.56 : 0.34);
  const availableHighlight = available.clone().lerp(new Color("#ffffff"), dark ? 0.5 : 0.3);

  return { available, availableHighlight, committed, protected: protectedColor, dark };
}

function colorForPosition(u: number, committedEnd: number, availableEnd: number, palette: SignalPalette) {
  const feather = 0.012;
  if (u < committedEnd - feather) return palette.committed;
  if (u < committedEnd + feather && availableEnd > committedEnd) {
    const amount = MathUtils.smoothstep(u, committedEnd - feather, committedEnd + feather);
    return palette.committed.clone().lerp(palette.available, amount);
  }
  if (u < availableEnd - feather) return palette.available;
  if (u < availableEnd + feather) {
    const amount = MathUtils.smoothstep(u, availableEnd - feather, availableEnd + feather);
    return palette.available.clone().lerp(palette.protected, amount);
  }
  return palette.protected;
}

function updateColorAttribute(
  attribute: BufferAttribute,
  uValues: number[],
  committedEnd: number,
  availableEnd: number,
  palette: SignalPalette,
) {
  uValues.forEach((u, index) => {
    const color = colorForPosition(u, committedEnd, availableEnd, palette);
    attribute.setXYZ(index, color.r, color.g, color.b);
  });
  attribute.needsUpdate = true;
}

function updateCrossRibbonPositions(
  attribute: BufferAttribute,
  boundaryValues: [number, number],
) {
  let offset = 0;
  boundaryValues.forEach((u) => {
    for (let index = 0; index < V_SEGMENTS; index += 1) {
      const start = signalPoint(u, index / V_SEGMENTS);
      const end = signalPoint(u, (index + 1) / V_SEGMENTS);
      attribute.setXYZ(offset, start.x, start.y + 0.016, start.z);
      attribute.setXYZ(offset + 1, end.x, end.y + 0.016, end.z);
      offset += 2;
    }
  });
  attribute.needsUpdate = true;
}

function updateScanPositions(attribute: BufferAttribute, u: number) {
  const halfWidth = 0.012;
  for (let index = 0; index <= V_SEGMENTS; index += 1) {
    const v = index / V_SEGMENTS;
    const before = signalPoint(Math.max(0, u - halfWidth), v);
    const after = signalPoint(Math.min(1, u + halfWidth), v);
    attribute.setXYZ(index * 2, before.x, before.y + 0.024, before.z);
    attribute.setXYZ(index * 2 + 1, after.x, after.y + 0.024, after.z);
  }
  attribute.needsUpdate = true;
}

function easeInOutCubic(value: number) {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

export function createCapacitySignalScene({
  canvas,
  host,
  metrics: initialMetrics,
  onReady,
  onUnavailable,
}: CapacitySignalSceneOptions): CapacitySignalScene {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
    failIfMajorPerformanceCaveat: true,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new Scene();
  const camera = new OrthographicCamera(-3.1, 3.1, 1.55, -1.55, 0.1, 30);
  camera.position.set(2.8, 2.5, 7.4);
  camera.lookAt(0, -0.05, 0);

  const root = new Group();
  root.rotation.z = -0.015;
  scene.add(root);

  const ribbon = createRibbonGeometry();
  const ribbonMaterial = new MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    side: DoubleSide,
    roughness: 0.36,
    metalness: 0.06,
    clearcoat: 0.5,
    clearcoatRoughness: 0.28,
    transparent: true,
    opacity: 0.84,
  });
  const ribbonMesh = new Mesh(ribbon.geometry, ribbonMaterial);
  root.add(ribbonMesh);

  const rails = createRailGeometry();
  const railMaterial = new LineBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity: 0.62,
  });
  const railLines = new LineSegments(rails.geometry, railMaterial);
  root.add(railLines);

  const nodeGeometry = new IcosahedronGeometry(0.042, 1);
  const nodeMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.28,
    metalness: 0.12,
  });
  const nodeCountU = 8;
  const nodeRailValues = [0, 0.25, 0.5, 0.75, 1];
  const nodes = new InstancedMesh(nodeGeometry, nodeMaterial, nodeCountU * nodeRailValues.length);
  const nodeUValues: number[] = [];
  const nodeMatrix = new Matrix4();
  let nodeIndex = 0;
  nodeRailValues.forEach((v) => {
    for (let index = 0; index < nodeCountU; index += 1) {
      const u = index / (nodeCountU - 1);
      const point = signalPoint(u, v);
      nodeMatrix.makeTranslation(point.x, point.y + 0.028, point.z);
      nodes.setMatrixAt(nodeIndex, nodeMatrix);
      nodeUValues.push(u);
      nodeIndex += 1;
    }
  });
  nodes.instanceMatrix.needsUpdate = true;
  root.add(nodes);

  const boundaryGeometry = createBoundaryGeometry();
  const boundaryMaterial = new LineBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity: 0.86,
  });
  const boundaryLines = new LineSegments(boundaryGeometry, boundaryMaterial);
  root.add(boundaryLines);

  const scanGeometry = createScanGeometry();
  const scanMaterial = new MeshBasicMaterial({
    color: 0xffffff,
    side: DoubleSide,
    transparent: true,
    opacity: 0.78,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const scanMesh = new Mesh(scanGeometry, scanMaterial);
  scanMesh.visible = false;
  root.add(scanMesh);

  const hemisphereLight = new HemisphereLight(0xffffff, 0x101713, 0.72);
  scene.add(hemisphereLight);
  const keyLight = new DirectionalLight(0xffffff, 1.35);
  keyLight.position.set(-3, 4, 5);
  scene.add(keyLight);
  const rimLight = new PointLight(0x4ade80, 1.8, 7);
  rimLight.position.set(2.6, 1.4, -2.5);
  scene.add(rimLight);

  let palette = readPalette(host);
  let committedEnd = 0;
  let availableEnd = 0;
  let disposed = false;
  let contextLost = false;
  let intersecting = true;
  let windowFocused = document.hasFocus();
  let frameId: number | null = null;
  let scanTimer: number | null = null;
  let scanStartedAt: number | null = null;
  let lastFrameAt = 0;
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const compactQuery = window.matchMedia("(max-width: 970px)");

  function canAnimate() {
    return (
      !disposed &&
      !contextLost &&
      intersecting &&
      windowFocused &&
      document.visibilityState === "visible" &&
      !reducedMotionQuery.matches &&
      !compactQuery.matches &&
      availableEnd > committedEnd + 0.005
    );
  }

  function render() {
    if (disposed || contextLost) return;
    renderer.render(scene, camera);
  }

  function stopMotion() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    if (scanTimer !== null) window.clearTimeout(scanTimer);
    frameId = null;
    scanTimer = null;
    scanStartedAt = null;
    scanMesh.visible = false;
  }

  function scheduleScan(delay = 560) {
    if (!canAnimate() || scanTimer !== null || frameId !== null) return;
    scanTimer = window.setTimeout(() => {
      scanTimer = null;
      if (!canAnimate()) return;
      scanStartedAt = performance.now();
      lastFrameAt = 0;
      scanMesh.visible = true;
      frameId = requestAnimationFrame(tick);
    }, delay);
  }

  function tick(now: number) {
    frameId = null;
    if (!canAnimate() || scanStartedAt === null) {
      stopMotion();
      render();
      return;
    }

    const progress = Math.min(1, (now - scanStartedAt) / SCAN_DURATION_MS);
    if (lastFrameAt === 0 || now - lastFrameAt >= 32) {
      const scanU = MathUtils.lerp(committedEnd, availableEnd, easeInOutCubic(progress));
      updateScanPositions(scanGeometry.getAttribute("position") as BufferAttribute, scanU);
      scanMaterial.opacity = 0.36 + Math.sin(progress * Math.PI) * 0.5;
      render();
      lastFrameAt = now;
    }

    if (progress < 1) {
      frameId = requestAnimationFrame(tick);
      return;
    }

    scanMesh.visible = false;
    scanStartedAt = null;
    render();
    scheduleScan(SCAN_REST_MS);
  }

  function syncMotion() {
    stopMotion();
    render();
    if (canAnimate()) scheduleScan();
  }

  function applyTheme() {
    palette = readPalette(host);
    ribbonMaterial.opacity = palette.dark ? 0.76 : 0.86;
    railMaterial.opacity = palette.dark ? 0.7 : 0.54;
    hemisphereLight.intensity = palette.dark ? 0.55 : 0.9;
    keyLight.intensity = palette.dark ? 1.2 : 1.6;
    rimLight.intensity = palette.dark ? 2.4 : 1.35;
    rimLight.color.copy(palette.available);
    scanMaterial.color.copy(palette.availableHighlight);
  }

  function applyMetrics(metrics: CapacitySignalMetrics) {
    committedEnd = clampPct(metrics.committed) / 100;
    availableEnd = Math.min(1, committedEnd + clampPct(metrics.available) / 100);

    updateColorAttribute(
      ribbon.geometry.getAttribute("color") as BufferAttribute,
      ribbon.uValues,
      committedEnd,
      availableEnd,
      palette,
    );
    updateColorAttribute(
      rails.geometry.getAttribute("color") as BufferAttribute,
      rails.uValues,
      committedEnd,
      availableEnd,
      palette,
    );

    nodeUValues.forEach((u, index) => {
      nodes.setColorAt(index, colorForPosition(u, committedEnd, availableEnd, palette));
    });
    if (nodes.instanceColor) nodes.instanceColor.needsUpdate = true;

    const boundaryPosition = boundaryGeometry.getAttribute("position") as BufferAttribute;
    const boundaryColor = boundaryGeometry.getAttribute("color") as BufferAttribute;
    updateCrossRibbonPositions(boundaryPosition, [committedEnd, availableEnd]);
    for (let index = 0; index < V_SEGMENTS * 2; index += 1) {
      const color = index < V_SEGMENTS ? palette.committed : palette.available;
      boundaryColor.setXYZ(index * 2, color.r, color.g, color.b);
      boundaryColor.setXYZ(index * 2 + 1, color.r, color.g, color.b);
    }
    boundaryColor.needsUpdate = true;
    scanMesh.visible = false;
  }

  function resize() {
    if (disposed) return;
    const width = Math.round(host.clientWidth);
    const height = Math.round(host.clientHeight);
    if (width <= 0 || height <= 0) return;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const halfHeight = Math.max(1.55, 3.1 / Math.max(aspect, 0.1));
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    render();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);

  const intersectionObserver = new IntersectionObserver(
    ([entry]) => {
      intersecting = entry?.isIntersecting ?? false;
      syncMotion();
    },
    { rootMargin: "48px" },
  );
  intersectionObserver.observe(host);

  const themeObserver = new MutationObserver(() => {
    applyTheme();
    applyMetrics({ available: (availableEnd - committedEnd) * 100, committed: committedEnd * 100 });
    render();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  function handleVisibility() {
    syncMotion();
  }

  function handleFocus() {
    windowFocused = true;
    syncMotion();
  }

  function handleBlur() {
    windowFocused = false;
    syncMotion();
  }

  function handleContextLost(event: Event) {
    event.preventDefault();
    contextLost = true;
    stopMotion();
    onUnavailable();
  }

  function handleContextRestored() {
    contextLost = false;
    applyTheme();
    resize();
    onReady();
    syncMotion();
  }

  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("focus", handleFocus);
  window.addEventListener("blur", handleBlur);
  reducedMotionQuery.addEventListener("change", syncMotion);
  compactQuery.addEventListener("change", syncMotion);
  canvas.addEventListener("webglcontextlost", handleContextLost);
  canvas.addEventListener("webglcontextrestored", handleContextRestored);

  applyTheme();
  applyMetrics(initialMetrics);
  resize();
  render();
  onReady();
  syncMotion();

  return {
    setMetrics(metrics) {
      if (disposed) return;
      stopMotion();
      applyMetrics(metrics);
      render();
      if (canAnimate()) scheduleScan(280);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopMotion();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      reducedMotionQuery.removeEventListener("change", syncMotion);
      compactQuery.removeEventListener("change", syncMotion);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);

      ribbon.geometry.dispose();
      ribbonMaterial.dispose();
      rails.geometry.dispose();
      railMaterial.dispose();
      nodeGeometry.dispose();
      nodeMaterial.dispose();
      boundaryGeometry.dispose();
      boundaryMaterial.dispose();
      scanGeometry.dispose();
      scanMaterial.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
