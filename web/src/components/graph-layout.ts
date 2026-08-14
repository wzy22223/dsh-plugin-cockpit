import type {
  VaultGraph,
  VaultGraphNode,
} from "../../shared/contracts/vault";

export interface GraphSceneNode extends VaultGraphNode {
  index: number;
  x: number;
  y: number;
  z: number;
}

export interface GraphSceneLink {
  source: number;
  target: number;
}

export interface GraphScene {
  nodes: GraphSceneNode[];
  links: GraphSceneLink[];
  indexByPath: Map<string, number>;
  adjacency: Array<Set<number>>;
}

export interface GraphVelocity {
  x: number;
  y: number;
  z: number;
}

export interface GraphMotionState {
  velocity: GraphVelocity[];
  alpha: number;
}

export interface GraphCamera {
  rotationX: number;
  rotationY: number;
  zoom: number;
  panX: number;
  panY: number;
}

export interface ProjectedNode {
  index: number;
  screenX: number;
  screenY: number;
  depth: number;
  radius: number;
  perspective: number;
}

export interface GraphMotionOptions {
  ambient?: boolean;
  phase?: number;
  pinnedIndex?: number | null;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(seed: number): number {
  let value = seed + 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function initialPosition(node: VaultGraphNode, rank: number, count: number): [number, number, number] {
  const seed = hashString(node.path);
  const longitude = seededUnit(seed) * Math.PI * 2;
  const latitude = Math.acos(2 * seededUnit(seed ^ 0x9e3779b9) - 1) - Math.PI / 2;
  const degreePull = 1 - Math.min(node.degree, 24) / 36;
  const shell = 0.44 + seededUnit(seed ^ 0x85ebca6b) * 0.74 * degreePull;
  const rankNudge = count > 1 ? (rank / (count - 1) - 0.5) * 0.08 : 0;
  const horizontal = Math.cos(latitude) * shell;
  return [
    Math.cos(longitude) * horizontal,
    Math.sin(latitude) * shell + rankNudge,
    Math.sin(longitude) * horizontal,
  ];
}

/** 构建可复现的初始 3D 场景；后续运动由轻量力导向迭代接管。 */
export function createGraphScene(graph: VaultGraph): GraphScene {
  const ordered = [...graph.nodes].sort((left, right) =>
    right.degree - left.degree || left.path.localeCompare(right.path, "zh-CN"),
  );
  const nodes = ordered.map<GraphSceneNode>((node, index) => {
    const [x, y, z] = initialPosition(node, index, ordered.length);
    return { ...node, index, x, y, z };
  });
  const indexByPath = new Map(nodes.map((node) => [node.path, node.index]));
  const adjacency = nodes.map(() => new Set<number>());
  const links: GraphSceneLink[] = [];
  const seenLinks = new Set<string>();

  for (const link of graph.links) {
    const source = indexByPath.get(link.source);
    const target = indexByPath.get(link.target);
    if (source === undefined || target === undefined || source === target) {
      continue;
    }
    const key = source < target ? `${source}:${target}` : `${target}:${source}`;
    if (seenLinks.has(key)) {
      continue;
    }
    seenLinks.add(key);
    links.push({ source, target });
    adjacency[source]!.add(target);
    adjacency[target]!.add(source);
  }

  // 只做少量预热，避免首帧挤成球；保留可见的后续动态收敛过程。
  const warmupIterations = nodes.length <= 500 ? 12 : nodes.length <= 900 ? 8 : 5;
  const warmup = createGraphMotionState({ nodes, links, indexByPath, adjacency }, 0.76);
  for (let iteration = 0; iteration < warmupIterations; iteration += 1) {
    stepGraphMotion({ nodes, links, indexByPath, adjacency }, warmup, { ambient: false });
  }

  let maximumRadius = 1;
  for (const node of nodes) {
    maximumRadius = Math.max(maximumRadius, Math.hypot(node.x, node.y, node.z));
  }
  const normalization = 1.2 / maximumRadius;
  for (const node of nodes) {
    node.x *= normalization;
    node.y *= normalization;
    node.z *= normalization;
  }

  return { nodes, links, indexByPath, adjacency };
}

export function createGraphMotionState(scene: GraphScene, alpha = 0.62): GraphMotionState {
  return {
    velocity: scene.nodes.map(() => ({ x: 0, y: 0, z: 0 })),
    alpha,
  };
}

export function reheatGraphMotion(state: GraphMotionState, amount = 0.72): void {
  state.alpha = Math.max(state.alpha, amount);
  for (let index = 0; index < state.velocity.length; index += 1) {
    const velocity = state.velocity[index]!;
    const kick = amount * 0.0018;
    velocity.x += Math.sin((index + 1) * 12.9898) * kick;
    velocity.y += Math.cos((index + 1) * 7.233) * kick;
    velocity.z += Math.sin((index + 1) * 4.117 + 0.8) * kick;
  }
}

/**
 * 一帧 3D 力导向。当前知识库规模下直接两两斥力更稳定；帧率由视图层限制，
 * 动效关闭或 reduced-motion 时不会持续运行。
 */
export function stepGraphMotion(
  scene: GraphScene,
  state: GraphMotionState,
  options: GraphMotionOptions = {},
): number {
  if (state.velocity.length !== scene.nodes.length) {
    state.velocity = scene.nodes.map(() => ({ x: 0, y: 0, z: 0 }));
    state.alpha = Math.max(state.alpha, 0.62);
  }

  const ambient = options.ambient ?? false;
  const phase = options.phase ?? 0;
  const pinnedIndex = options.pinnedIndex ?? null;
  const alpha = Math.max(state.alpha, ambient ? 0.045 : 0);
  if (alpha < 0.002) {
    state.alpha = 0;
    return 0;
  }

  const nodes = scene.nodes;
  const velocity = state.velocity;
  const repulsion = 0.00024 * alpha;

  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = nodes[rightIndex]!;
      const dx = left.x - right.x;
      const dy = left.y - right.y;
      const dz = left.z - right.z;
      const distanceSquared = dx * dx + dy * dy + dz * dz + 0.022;
      const force = repulsion / distanceSquared;
      velocity[leftIndex]!.x += dx * force;
      velocity[leftIndex]!.y += dy * force;
      velocity[leftIndex]!.z += dz * force;
      velocity[rightIndex]!.x -= dx * force;
      velocity[rightIndex]!.y -= dy * force;
      velocity[rightIndex]!.z -= dz * force;
    }
  }

  for (const link of scene.links) {
    const source = nodes[link.source]!;
    const target = nodes[link.target]!;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dz = target.z - source.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const force = (distance - 0.31) * 0.012 * alpha;
    const fx = dx / distance * force;
    const fy = dy / distance * force;
    const fz = dz / distance * force;
    velocity[link.source]!.x += fx;
    velocity[link.source]!.y += fy;
    velocity[link.source]!.z += fz;
    velocity[link.target]!.x -= fx;
    velocity[link.target]!.y -= fy;
    velocity[link.target]!.z -= fz;
  }

  let totalMovement = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    const movement = velocity[index]!;
    const centerPull = (0.008 + Math.min(node.degree, 20) * 0.0002) * alpha;
    movement.x -= node.x * centerPull;
    movement.y -= node.y * centerPull;
    movement.z -= node.z * centerPull;

    if (ambient) {
      const breeze = 0.00011 * alpha;
      movement.x += Math.sin(phase * 0.73 + index * 1.91) * breeze;
      movement.y += Math.cos(phase * 0.61 + index * 1.37) * breeze;
      movement.z += Math.sin(phase * 0.49 + index * 2.17) * breeze;
    }

    movement.x *= 0.81;
    movement.y *= 0.81;
    movement.z *= 0.81;
    const speed = Math.hypot(movement.x, movement.y, movement.z);
    if (speed > 0.032) {
      const limit = 0.032 / speed;
      movement.x *= limit;
      movement.y *= limit;
      movement.z *= limit;
    }

    if (index === pinnedIndex) {
      movement.x = 0;
      movement.y = 0;
      movement.z = 0;
      continue;
    }
    node.x += movement.x;
    node.y += movement.y;
    node.z += movement.z;
    const radius = Math.hypot(node.x, node.y, node.z);
    if (radius > 2.2) {
      const containment = 2.2 / radius;
      node.x *= containment;
      node.y *= containment;
      node.z *= containment;
      movement.x *= 0.35;
      movement.y *= 0.35;
      movement.z *= 0.35;
    }
    totalMovement += Math.hypot(movement.x, movement.y, movement.z);
  }

  state.alpha = ambient ? Math.max(alpha * 0.988, 0.045) : alpha * 0.91;
  return totalMovement;
}

export function projectGraphNode(
  node: GraphSceneNode,
  camera: GraphCamera,
  width: number,
  height: number,
): ProjectedNode {
  const cosY = Math.cos(camera.rotationY);
  const sinY = Math.sin(camera.rotationY);
  const xAfterY = node.x * cosY + node.z * sinY;
  const zAfterY = -node.x * sinY + node.z * cosY;
  const cosX = Math.cos(camera.rotationX);
  const sinX = Math.sin(camera.rotationX);
  const yAfterX = node.y * cosX - zAfterY * sinX;
  const depth = node.y * sinX + zAfterY * cosX;
  const perspective = 3.6 / Math.max(1.8, 3.6 - depth);
  const scale = Math.min(width, height) * 0.37 * camera.zoom;
  return {
    index: node.index,
    screenX: width / 2 + camera.panX + xAfterY * scale * perspective,
    screenY: height / 2 + camera.panY + yAfterX * scale * perspective,
    depth,
    radius: (3.35 + Math.min(node.degree, 18) * 0.23) * perspective,
    perspective,
  };
}

export function moveGraphNodeByScreenDelta(
  node: GraphSceneNode,
  camera: GraphCamera,
  deltaX: number,
  deltaY: number,
  width: number,
  height: number,
): void {
  const projected = projectGraphNode(node, camera, width, height);
  const scale = Math.max(1, Math.min(width, height) * 0.37 * camera.zoom * projected.perspective);
  const horizontal = deltaX / scale;
  const vertical = deltaY / scale;
  const cosY = Math.cos(camera.rotationY);
  const sinY = Math.sin(camera.rotationY);
  const cosX = Math.cos(camera.rotationX);
  const sinX = Math.sin(camera.rotationX);

  node.x += horizontal * cosY + vertical * sinY * sinX;
  node.y += vertical * cosX;
  node.z += horizontal * sinY - vertical * cosY * sinX;
}

export function pickProjectedNode(
  projected: ProjectedNode[],
  x: number,
  y: number,
  padding = 7,
): number | null {
  let best: { index: number; distance: number; depth: number } | null = null;
  for (const node of projected) {
    const distance = Math.hypot(node.screenX - x, node.screenY - y);
    if (distance > node.radius + padding) {
      continue;
    }
    if (
      best === null ||
      distance < best.distance - 1 ||
      (Math.abs(distance - best.distance) <= 1 && node.depth > best.depth)
    ) {
      best = { index: node.index, distance, depth: node.depth };
    }
  }
  return best?.index ?? null;
}

export function cameraForNode(node: GraphSceneNode, zoom: number): GraphCamera {
  const rotationY = Math.atan2(-node.x, node.z || 0.0001);
  const frontDepth = Math.hypot(node.x, node.z);
  const rotationX = Math.atan2(node.y, frontDepth || 0.0001);
  return {
    rotationX,
    rotationY,
    zoom: Math.max(zoom, 1.18),
    panX: 0,
    panY: 0,
  };
}
