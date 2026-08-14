import {
  Focus,
  Hand,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type { VaultGraph } from "../../shared/contracts/vault";
import {
  cameraForNode,
  createGraphMotionState,
  createGraphScene,
  moveGraphNodeByScreenDelta,
  pickProjectedNode,
  projectGraphNode,
  reheatGraphMotion,
  stepGraphMotion,
  type GraphCamera,
  type ProjectedNode,
} from "./graph-layout";

interface GraphViewProps {
  graph: VaultGraph;
  focusedPath: string | null;
  filteredPaths?: string[];
  onSelect: (path: string | null) => void;
  onOpen: (path: string) => void;
}

type InteractionMode = "orbit" | "pan";
type PointerAction = "node" | "orbit" | "pan";

interface PointerState {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  action: PointerAction;
  nodeIndex: number | null;
}

interface GraphColors {
  edge: string;
  edgeActive: string;
  glow: string;
  text: string;
  muted: string;
  label: string;
  labelBorder: string;
  nodeStroke: string;
  grid: string;
  palette: string[];
}

const INITIAL_CAMERA: GraphCamera = {
  rotationX: -0.16,
  rotationY: 0.52,
  zoom: 1,
  panX: 0,
  panY: 0,
};

function cssVariable(style: CSSStyleDeclaration, name: string, fallback: string): string {
  return style.getPropertyValue(name).trim() || fallback;
}

function readGraphColors(element: HTMLElement): GraphColors {
  const style = getComputedStyle(element);
  return {
    edge: cssVariable(style, "--graph-edge", "rgba(148, 163, 184, 0.32)"),
    edgeActive: cssVariable(style, "--graph-edge-active", "#a78bfa"),
    glow: cssVariable(style, "--graph-glow", "rgba(139, 92, 246, 0.42)"),
    text: cssVariable(style, "--graph-text", "#f8fafc"),
    muted: cssVariable(style, "--graph-muted", "#94a3b8"),
    label: cssVariable(style, "--graph-label", "rgba(9, 12, 23, 0.86)"),
    labelBorder: cssVariable(style, "--graph-label-border", "rgba(255, 255, 255, 0.12)"),
    nodeStroke: cssVariable(style, "--graph-node-stroke", "rgba(255, 255, 255, 0.86)"),
    grid: cssVariable(style, "--graph-grid", "rgba(109, 40, 217, 0.05)"),
    palette: [
      cssVariable(style, "--graph-node-1", "#a78bfa"),
      cssVariable(style, "--graph-node-2", "#38bdf8"),
      cssVariable(style, "--graph-node-3", "#34d399"),
      cssVariable(style, "--graph-node-4", "#fbbf24"),
      cssVariable(style, "--graph-node-5", "#fb7185"),
    ],
  };
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function folderColorIndex(path: string, colorCount: number): number {
  const slashIndex = path.lastIndexOf("/");
  const folder = slashIndex > 0 ? path.slice(0, slashIndex) : "root";
  return hashString(folder) % colorCount;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const corner = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + corner, y);
  context.arcTo(x + width, y, x + width, y + height, corner);
  context.arcTo(x + width, y + height, x, y + height, corner);
  context.arcTo(x, y + height, x, y, corner);
  context.arcTo(x, y, x + width, y, corner);
  context.closePath();
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

export function GraphView({
  graph,
  focusedPath,
  filteredPaths = [],
  onSelect,
  onOpen,
}: GraphViewProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const motionFrameRef = useRef<number | null>(null);
  const cameraAnimationRef = useRef<number | null>(null);
  const pointerRef = useRef<PointerState | null>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const projectedRef = useRef<ProjectedNode[]>([]);
  const sizeRef = useRef({ width: 800, height: 560, dpr: 1 });
  const cameraRef = useRef<GraphCamera>({ ...INITIAL_CAMERA });
  const drawRef = useRef<() => void>(() => undefined);
  const reducedMotionRef = useRef(prefersReducedMotion());
  const motionEnabledRef = useRef(!reducedMotionRef.current);
  const suppressAutoFocusRef = useRef<string | null | undefined>(undefined);
  const colorCacheRef = useRef<{ colors: GraphColors; readAt: number } | null>(null);

  const [interactionMode, setInteractionMode] = useState<InteractionMode>("orbit");
  const [expanded, setExpanded] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(!reducedMotionRef.current);

  const runtime = useMemo(() => {
    const scene = createGraphScene(graph);
    return {
      scene,
      motion: createGraphMotionState(scene),
      initialPositions: scene.nodes.map(({ x, y, z }) => ({ x, y, z })),
    };
  }, [graph]);
  const scene = runtime.scene;
  const motionRef = useRef(runtime.motion);

  const filteredSet = useMemo(() => new Set(filteredPaths), [filteredPaths]);
  const focusedIndex = focusedPath === null ? undefined : scene.indexByPath.get(focusedPath);
  const focusedNode = focusedIndex === undefined ? null : scene.nodes[focusedIndex] ?? null;

  useEffect(() => {
    motionRef.current = runtime.motion;
    reheatGraphMotion(motionRef.current, 0.72);
  }, [runtime]);

  useEffect(() => {
    motionEnabledRef.current = motionEnabled;
  }, [motionEnabled]);

  const draw = useCallback((): void => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const context = canvas.getContext("2d");
    if (context === null) {
      return;
    }
    const { width, height, dpr } = sizeRef.current;
    const now = performance.now();
    if (colorCacheRef.current === null || now - colorCacheRef.current.readAt > 900) {
      colorCacheRef.current = { colors: readGraphColors(canvas), readAt: now };
    }
    const colors = colorCacheRef.current.colors;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    // 背景：极淡空间网格（呼应航迹光场，提升纵深感）
    const gridStep = 58;
    context.strokeStyle = colors.grid;
    context.lineWidth = 1;
    context.globalAlpha = 1;
    context.beginPath();
    for (let gx = gridStep / 2; gx < width; gx += gridStep) {
      context.moveTo(gx, 0);
      context.lineTo(gx, height);
    }
    for (let gy = gridStep / 2; gy < height; gy += gridStep) {
      context.moveTo(0, gy);
      context.lineTo(width, gy);
    }
    context.stroke();

    const projected = scene.nodes.map((node) =>
      projectGraphNode(node, cameraRef.current, width, height),
    );
    projectedRef.current = projected;
    const focusedNeighbors = focusedIndex === undefined
      ? null
      : scene.adjacency[focusedIndex] ?? null;
    const hasFilter = filteredSet.size > 0;

    const linksByDepth = scene.links
      .map((link, index) => ({ ...link, index }))
      .sort((left, right) => {
        const leftDepth = projected[left.source]!.depth + projected[left.target]!.depth;
        const rightDepth = projected[right.source]!.depth + projected[right.target]!.depth;
        return leftDepth - rightDepth;
      });

    context.lineCap = "round";
    for (const link of linksByDepth) {
      const source = projected[link.source]!;
      const target = projected[link.target]!;
      const focusedEdge = focusedIndex !== undefined && (link.source === focusedIndex || link.target === focusedIndex);
      const filterEdge = !hasFilter || filteredSet.has(scene.nodes[link.source]!.path) || filteredSet.has(scene.nodes[link.target]!.path);
      context.beginPath();
      context.moveTo(source.screenX, source.screenY);
      context.lineTo(target.screenX, target.screenY);
      if (focusedEdge) {
        // 聚焦边：两端渐变描边（普通色 → 强调色），强化"光束"感
        const gradient = context.createLinearGradient(
          source.screenX, source.screenY, target.screenX, target.screenY,
        );
        gradient.addColorStop(0, colors.edge);
        gradient.addColorStop(1, colors.edgeActive);
        context.strokeStyle = gradient;
      } else {
        context.strokeStyle = colors.edge;
      }
      context.globalAlpha = focusedIndex !== undefined
        ? focusedEdge ? 0.94 : 0.075
        : filterEdge ? 0.66 : 0.05;
      context.lineWidth = focusedEdge ? 2.1 : 1.0 + Math.max(0, (source.depth + target.depth) * 0.1);
      if (focusedEdge) {
        context.shadowColor = colors.glow;
        context.shadowBlur = 8;
      }
      context.stroke();
      context.shadowBlur = 0;
    }

    if (motionEnabledRef.current) {
      const phase = now * 0.00018;
      for (const link of linksByDepth) {
        const focusedEdge = focusedIndex !== undefined && (link.source === focusedIndex || link.target === focusedIndex);
        if (!focusedEdge && (focusedIndex !== undefined || link.index % 13 !== 0)) {
          continue;
        }
        const source = projected[link.source]!;
        const target = projected[link.target]!;
        const progress = (phase + link.index * 0.173) % 1;
        const x = source.screenX + (target.screenX - source.screenX) * progress;
        const y = source.screenY + (target.screenY - source.screenY) * progress;
        context.beginPath();
        context.arc(x, y, focusedEdge ? 2.1 : 1.35, 0, Math.PI * 2);
        context.fillStyle = focusedEdge ? colors.text : colors.edgeActive;
        context.globalAlpha = focusedEdge ? 0.92 : 0.56;
        context.shadowColor = colors.glow;
        context.shadowBlur = focusedEdge ? 8 : 5;
        context.fill();
        context.shadowBlur = 0;
      }
    }

    const orderedNodes = [...projected].sort((left, right) => left.depth - right.depth);
    const hoverIndex = hoverIndexRef.current;
    for (const point of orderedNodes) {
      const node = scene.nodes[point.index]!;
      const focused = point.index === focusedIndex;
      const neighbor = focusedNeighbors?.has(point.index) ?? false;
      const hovered = point.index === hoverIndex;
      const matchesFilter = !hasFilter || filteredSet.has(node.path);
      const dimmed = focusedIndex !== undefined ? !focused && !neighbor : !matchesFilter;
      // 节点呼吸：未聚焦/未悬停时缓慢脉动，增强"活"感（动效关闭时静止）
      const breathe = motionEnabledRef.current && !focused && !hovered
        ? 1 + Math.sin(now * 0.0016 + point.index * 1.7) * 0.06
        : 1;
      const radius = Math.max(3.1, point.radius * (focused ? 1.65 : hovered ? 1.4 : neighbor ? 1.16 : 1) * breathe);
      const nodeColor = colors.palette[folderColorIndex(node.path, colors.palette.length)]!;
      const depthAlpha = clamp((point.depth + 1.65) / 2.6, 0.52, 1);

      if (focused || hovered || neighbor) {
        context.beginPath();
        context.arc(point.screenX, point.screenY, radius + (focused ? 9 : 6), 0, Math.PI * 2);
        context.fillStyle = focused ? colors.edgeActive : nodeColor;
        context.globalAlpha = focused ? 0.2 : 0.11;
        context.shadowColor = focused ? colors.glow : nodeColor;
        context.shadowBlur = focused ? 18 : 10;
        context.fill();
        context.shadowBlur = 0;
      }

      context.beginPath();
      context.arc(point.screenX, point.screenY, radius, 0, Math.PI * 2);
      context.fillStyle = focused ? colors.text : nodeColor;
      context.globalAlpha = dimmed ? 0.18 : depthAlpha;
      context.shadowColor = focused ? colors.glow : nodeColor;
      context.shadowBlur = focused ? 14 : hovered ? 10 : 3;
      context.fill();
      context.shadowBlur = 0;
      context.strokeStyle = focused ? colors.edgeActive : colors.nodeStroke;
      context.lineWidth = focused ? 2 : 0.75;
      context.globalAlpha = dimmed ? 0.1 : focused ? 0.95 : 0.62;
      context.stroke();
    }

    const labelLimit = width < 560 ? 7 : expanded ? 22 : width < 900 ? 12 : 17;
    const labelCandidates = orderedNodes
      .filter((point) => {
        const node = scene.nodes[point.index]!;
        return point.index === focusedIndex || point.index === hoverIndex ||
          (focusedNeighbors?.has(point.index) ?? false) || node.degree >= 8;
      })
      .sort((left, right) => {
        const leftPriority = (left.index === focusedIndex || left.index === hoverIndex ? 100 : 0) + scene.nodes[left.index]!.degree;
        const rightPriority = (right.index === focusedIndex || right.index === hoverIndex ? 100 : 0) + scene.nodes[right.index]!.degree;
        return rightPriority - leftPriority;
      })
      .slice(0, labelLimit);

    context.font = "600 12px Inter, system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "bottom";
    for (const point of labelCandidates) {
      const node = scene.nodes[point.index]!;
      const label = node.title.length > 20 ? `${node.title.slice(0, 19)}…` : node.title;
      const measured = context.measureText(label).width;
      const labelY = point.screenY - point.radius - 9;
      const highlighted = point.index === focusedIndex || point.index === hoverIndex;
      context.globalAlpha = highlighted ? 0.98 : 0.82;
      context.fillStyle = colors.label;
      roundedRect(context, point.screenX - measured / 2 - 7, labelY - 18, measured + 14, 20, 6);
      context.fill();
      context.strokeStyle = colors.labelBorder;
      context.lineWidth = 0.75;
      context.stroke();
      context.fillStyle = highlighted ? colors.text : colors.muted;
      context.fillText(label, point.screenX, labelY - 1.5);
    }
    context.globalAlpha = 1;
  }, [expanded, filteredSet, focusedIndex, scene]);

  drawRef.current = draw;

  const scheduleDraw = useCallback((): void => {
    if (frameRef.current !== null) {
      return;
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      drawRef.current();
    });
  }, []);

  const resizeCanvas = useCallback((): void => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const mobile = rect.width < 720;
    const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.6);
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    sizeRef.current = { width, height, dpr };
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    colorCacheRef.current = null;
    scheduleDraw();
  }, [scheduleDraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas);
    resizeCanvas();
    return () => {
      resizeObserver.disconnect();
    };
  }, [resizeCanvas]);

  useEffect(() => {
    scheduleDraw();
  }, [expanded, filteredSet, focusedPath, scene, scheduleDraw]);

  useEffect(() => {
    if (!motionEnabled) {
      scheduleDraw();
      return;
    }
    let lastDrawAt = 0;
    const animate = (now: number): void => {
      motionFrameRef.current = requestAnimationFrame(animate);
      if (document.hidden) {
        lastDrawAt = now;
        return;
      }
      const mobile = sizeRef.current.width < 720;
      const frameInterval = 1000 / (mobile ? 12 : 26);
      if (now - lastDrawAt < frameInterval) {
        return;
      }
      lastDrawAt = now;
      const pointer = pointerRef.current;
      const pinnedIndex = pointer?.action === "node" ? pointer.nodeIndex : null;
      stepGraphMotion(scene, motionRef.current, {
        ambient: false,
        phase: now / 1000,
        pinnedIndex,
      });
      drawRef.current();
    };
    motionFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (motionFrameRef.current !== null) {
        cancelAnimationFrame(motionFrameRef.current);
        motionFrameRef.current = null;
      }
    };
  }, [motionEnabled, scene, scheduleDraw]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (media === undefined) {
      return;
    }
    const handleChange = (): void => {
      reducedMotionRef.current = media.matches;
      if (media.matches) {
        setMotionEnabled(false);
      }
    };
    media.addEventListener?.("change", handleChange);
    return () => media.removeEventListener?.("change", handleChange);
  }, []);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [expanded]);

  useEffect(() => {
    if (suppressAutoFocusRef.current === focusedPath) {
      suppressAutoFocusRef.current = undefined;
      scheduleDraw();
      return;
    }
    if (focusedNode === null) {
      scheduleDraw();
      return;
    }
    if (cameraAnimationRef.current !== null) {
      cancelAnimationFrame(cameraAnimationRef.current);
    }
    const start = { ...cameraRef.current };
    const target = cameraForNode(focusedNode, cameraRef.current.zoom);
    if (reducedMotionRef.current || sizeRef.current.width < 720) {
      cameraRef.current = target;
      scheduleDraw();
      return;
    }
    const startedAt = performance.now();
    const animate = (now: number): void => {
      const progress = clamp((now - startedAt) / 420, 0, 1);
      const eased = easeOutCubic(progress);
      cameraRef.current = {
        rotationX: start.rotationX + (target.rotationX - start.rotationX) * eased,
        rotationY: start.rotationY + (target.rotationY - start.rotationY) * eased,
        zoom: start.zoom + (target.zoom - start.zoom) * eased,
        panX: start.panX + (target.panX - start.panX) * eased,
        panY: start.panY + (target.panY - start.panY) * eased,
      };
      drawRef.current();
      if (progress < 1) {
        cameraAnimationRef.current = requestAnimationFrame(animate);
      } else {
        cameraAnimationRef.current = null;
      }
    };
    cameraAnimationRef.current = requestAnimationFrame(animate);
  }, [focusedNode, focusedPath, scheduleDraw]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    if (motionFrameRef.current !== null) cancelAnimationFrame(motionFrameRef.current);
    if (cameraAnimationRef.current !== null) cancelAnimationFrame(cameraAnimationRef.current);
  }, []);

  function pointerPosition(event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function selectGraphNode(index: number | null): void {
    const path = index === null ? null : scene.nodes[index]!.path;
    suppressAutoFocusRef.current = path;
    onSelect(path);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>): void {
    const point = pointerPosition(event);
    const nodeIndex = pickProjectedNode(projectedRef.current, point.x, point.y);
    const forcedPan = interactionMode === "pan" || event.shiftKey || event.button === 1 || event.button === 2;
    const action: PointerAction = forcedPan ? "pan" : nodeIndex === null ? "orbit" : "node";
    pointerRef.current = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      lastX: point.x,
      lastY: point.y,
      moved: false,
      action,
      nodeIndex,
    };
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("graph-canvas-dragging");
    if (action === "node") {
      event.currentTarget.classList.add("graph-canvas-node-dragging");
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>): void {
    const point = pointerPosition(event);
    const pointer = pointerRef.current;
    if (pointer !== null && pointer.pointerId === event.pointerId) {
      const dx = point.x - pointer.lastX;
      const dy = point.y - pointer.lastY;
      pointer.lastX = point.x;
      pointer.lastY = point.y;
      pointer.moved ||= Math.hypot(point.x - pointer.startX, point.y - pointer.startY) > 3;
      if (pointer.moved) {
        if (pointer.action === "node" && pointer.nodeIndex !== null) {
          moveGraphNodeByScreenDelta(
            scene.nodes[pointer.nodeIndex]!,
            cameraRef.current,
            dx,
            dy,
            sizeRef.current.width,
            sizeRef.current.height,
          );
          reheatGraphMotion(motionRef.current, 0.56);
        } else if (pointer.action === "pan") {
          cameraRef.current.panX += dx;
          cameraRef.current.panY += dy;
        } else {
          cameraRef.current.rotationY += dx * 0.007;
          cameraRef.current.rotationX = clamp(cameraRef.current.rotationX + dy * 0.006, -1.42, 1.42);
        }
        scheduleDraw();
      }
      return;
    }
    const nextHover = pickProjectedNode(projectedRef.current, point.x, point.y);
    if (nextHover !== hoverIndexRef.current) {
      hoverIndexRef.current = nextHover;
      event.currentTarget.style.cursor = nextHover === null
        ? interactionMode === "pan" ? "move" : "grab"
        : "pointer";
      scheduleDraw();
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>): void {
    const pointer = pointerRef.current;
    const point = pointerPosition(event);
    if (pointer !== null && pointer.pointerId === event.pointerId) {
      if (!pointer.moved) {
        selectGraphNode(pickProjectedNode(projectedRef.current, point.x, point.y));
      } else if (pointer.action === "node" && pointer.nodeIndex !== null) {
        selectGraphNode(pointer.nodeIndex);
      }
    }
    pointerRef.current = null;
    event.currentTarget.classList.remove("graph-canvas-dragging", "graph-canvas-node-dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleDoubleClick(event: React.MouseEvent<HTMLCanvasElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    const index = pickProjectedNode(projectedRef.current, event.clientX - rect.left, event.clientY - rect.top);
    if (index !== null) {
      const path = scene.nodes[index]!.path;
      suppressAutoFocusRef.current = path;
      onOpen(path);
    }
  }

  function resetCamera(): void {
    cameraRef.current = { ...INITIAL_CAMERA };
    scheduleDraw();
  }

  function focusCamera(): void {
    if (focusedNode === null) {
      resetCamera();
      return;
    }
    cameraRef.current = cameraForNode(focusedNode, cameraRef.current.zoom);
    scheduleDraw();
  }

  function changeZoom(multiplier: number): void {
    cameraRef.current.zoom = clamp(cameraRef.current.zoom * multiplier, 0.3, 6);
    scheduleDraw();
  }

  function reheatLayout(): void {
    for (let index = 0; index < scene.nodes.length; index += 1) {
      const node = scene.nodes[index]!;
      const initial = runtime.initialPositions[index]!;
      node.x = initial.x;
      node.y = initial.y;
      node.z = initial.z;
    }
    motionRef.current = createGraphMotionState(scene, 0.9);
    reheatGraphMotion(motionRef.current, 0.9);
    setMotionEnabled(true);
    scheduleDraw();
  }

  const filteredCount = filteredSet.size > 0 ? filteredSet.size : scene.nodes.length;

  const graphStage = (
    <div className={`graph-stage ${expanded ? "graph-stage-expanded" : ""}`} aria-label="3D 知识图谱">
      <canvas
        ref={canvasRef}
        className="graph-canvas"
        role="application"
        tabIndex={0}
        aria-label={`3D 知识图谱，${scene.nodes.length} 个节点，${scene.links.length} 条关联`}
        aria-describedby="graph-instructions"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={(event) => {
          if (pointerRef.current === null) {
            hoverIndexRef.current = null;
            event.currentTarget.style.cursor = interactionMode === "pan" ? "move" : "grab";
            scheduleDraw();
          }
        }}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(event) => event.preventDefault()}
        onWheel={(event) => {
          event.preventDefault();
          changeZoom(event.deltaY > 0 ? 0.88 : 1.14);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && focusedPath !== null) onOpen(focusedPath);
          if (event.key === "Escape") {
            if (expanded) setExpanded(false);
            else selectGraphNode(null);
          }
          if (event.key === "0") resetCamera();
          if (event.key === "+" || event.key === "=") changeZoom(1.18);
          if (event.key === "-") changeZoom(1 / 1.18);
          if (event.key.toLowerCase() === "r") reheatLayout();
          if (event.key === " ") {
            event.preventDefault();
            setMotionEnabled((current) => !current);
          }
        }}
      />

      <div className="graph-mode-badge" aria-hidden="true">
        <span className={`graph-mode-dot ${motionEnabled ? "is-live" : ""}`} />
        Force 3D · {motionEnabled ? "动态" : "暂停"}
      </div>

      <div className="graph-toolbar" aria-label="图谱视角与布局控制">
        <button type="button" className={`btn btn-sm ${interactionMode === "orbit" ? "is-active" : ""}`} onClick={() => setInteractionMode("orbit")} aria-pressed={interactionMode === "orbit"} aria-label="旋转与节点拖拽模式" title="旋转 / 拖拽节点">
          <RotateCw size={15} />
        </button>
        <button type="button" className={`btn btn-sm ${interactionMode === "pan" ? "is-active" : ""}`} onClick={() => setInteractionMode("pan")} aria-pressed={interactionMode === "pan"} aria-label="自由平移模式" title="平移画布（也可按 Shift 拖动）">
          <Hand size={15} />
        </button>
        <span className="graph-toolbar-divider" />
        <button type="button" className="btn btn-sm" onClick={() => changeZoom(1.18)} aria-label="放大图谱" title="放大">
          <Plus size={15} />
        </button>
        <button type="button" className="btn btn-sm" onClick={() => changeZoom(1 / 1.18)} aria-label="缩小图谱" title="缩小">
          <Minus size={15} />
        </button>
        <button type="button" className="btn btn-sm" onClick={focusCamera} aria-label="聚焦选中节点" title="聚焦选中节点">
          <Focus size={15} />
        </button>
        <button type="button" className="btn btn-sm" onClick={resetCamera} aria-label="重置图谱视角" title="重置视角">
          <RotateCcw size={15} />
        </button>
        <span className="graph-toolbar-divider" />
        <button type="button" className="btn btn-sm" onClick={reheatLayout} aria-label="重新释放动态布局" title="重新释放动态布局">
          <RefreshCw size={15} />
        </button>
        <button type="button" className={`btn btn-sm ${motionEnabled ? "is-active" : ""}`} onClick={() => setMotionEnabled((current) => !current)} aria-pressed={motionEnabled} aria-label={motionEnabled ? "暂停图谱动效" : "播放图谱动效"} title={motionEnabled ? "暂停动效" : "播放动效"}>
          {motionEnabled ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button type="button" className="btn btn-sm graph-expand-btn" onClick={() => setExpanded((current) => !current)} aria-pressed={expanded} aria-label={expanded ? "退出最大化图谱" : "最大化图谱"} title={expanded ? "退出最大化（Esc）" : "最大化图谱"}>
          {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>

      <p id="graph-instructions" className="graph-legend">
        拖节点重排 · 拖空白旋转 · Shift/手掌平移 · 滚轮缩放 · 双击阅读
      </p>
      <p className="graph-performance-badge">
        {filteredCount} / {scene.nodes.length} 节点 · {scene.links.length} 条关联 · {motionEnabled ? "动态限帧" : "已暂停"}
      </p>

      {focusedNode !== null && (
        <button type="button" className="graph-selection-card" onClick={() => onOpen(focusedNode.path)}>
          <span>当前节点</span>
          <strong>{focusedNode.title}</strong>
          <small>{focusedNode.degree} 条关联 · 点击阅读</small>
        </button>
      )}
    </div>
  );

  return expanded && typeof document !== "undefined"
    ? createPortal(graphStage, document.body)
    : graphStage;
}
