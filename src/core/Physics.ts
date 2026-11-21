import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export { RAPIER };

/** 碰撞分组（membership） */
export const G_WORLD = 0x0001;
export const G_PLAYER = 0x0002;
export const G_ENEMY = 0x0004;
export const G_DYNAMIC = 0x0008;
export const G_ALL = 0xffff;
export const groups = (member: number, filter: number) => ((member << 16) | filter) >>> 0;

export const CG_WORLD = groups(G_WORLD, G_ALL);
export const CG_PLAYER = groups(G_PLAYER, G_WORLD | G_DYNAMIC);
export const CG_ENEMY = groups(G_ENEMY, G_WORLD | G_DYNAMIC);
export const CG_DYNAMIC = groups(G_DYNAMIC, G_ALL);
/** 查询过滤：只命中静态世界 + 动态箱子 */
export const Q_SOLID = groups(G_ALL, G_WORLD | G_DYNAMIC);
export const Q_WORLD = groups(G_ALL, G_WORLD);

export interface RayHit { dist: number; point: THREE.Vector3; normal: THREE.Vector3; collider: RAPIER.Collider; }

export class Physics {
  world: RAPIER.World;
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private _hit: RayHit = { dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null as unknown as RAPIER.Collider };

  static async init() { await RAPIER.init(); }

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -28, z: 0 });
  }

  staticTrimesh(vertices: Float32Array, indices: Uint32Array) {
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices).setCollisionGroups(CG_WORLD).setFriction(0.9);
    return this.world.createCollider(desc);
  }
  staticBox(x: number, y: number, z: number, hx: number, hy: number, hz: number, rotY = 0) {
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setCollisionGroups(CG_WORLD).setFriction(0.9);
    if (rotY) desc.setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) });
    return this.world.createCollider(desc);
  }
  staticCylinder(x: number, y: number, z: number, halfH: number, r: number) {
    const desc = RAPIER.ColliderDesc.cylinder(halfH, r).setTranslation(x, y, z).setCollisionGroups(CG_WORLD);
    return this.world.createCollider(desc);
  }
  kinematicBox(x: number, y: number, z: number, hx: number, hy: number, hz: number, rotY = 0) {
    const bd = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z);
    if (rotY) bd.setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) });
    const body = this.world.createRigidBody(bd);
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setCollisionGroups(CG_WORLD).setFriction(1.0), body);
    return { body, collider };
  }
  kinematicCylinder(x: number, y: number, z: number, halfH: number, r: number) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z));
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(halfH, r).setCollisionGroups(CG_WORLD).setFriction(1.0), body);
    return { body, collider };
  }
  dynamicBox(x: number, y: number, z: number, h: number, density = 2) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).lockRotations().setLinearDamping(3.5).setCcdEnabled(true));
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(h, h, h).setDensity(density).setFriction(0.6).setCollisionGroups(CG_DYNAMIC), body);
    return { body, collider };
  }
  capsule(x: number, y: number, z: number, halfH: number, r: number, group: number) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(halfH, r).setCollisionGroups(group), body);
    return { body, collider };
  }
  controller(offset: number, stepH: number, snap: number) {
    const c = this.world.createCharacterController(offset);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    c.setMinSlopeSlideAngle((42 * Math.PI) / 180);
    if (stepH > 0) c.enableAutostep(stepH, 0.25, false);
    if (snap > 0) c.enableSnapToGround(snap);
    c.setSlideEnabled(true);
    return c;
  }

  /** 射线检测；返回的对象会被复用，请勿长期持有 */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, filter = Q_SOLID, exclude?: RAPIER.Collider): RayHit | null {
    const r = this.ray;
    r.origin.x = ox; r.origin.y = oy; r.origin.z = oz;
    r.dir.x = dx; r.dir.y = dy; r.dir.z = dz;
    const hit = this.world.castRayAndGetNormal(r, maxDist, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, filter, exclude);
    if (!hit) return null;
    const h = this._hit;
    h.dist = hit.timeOfImpact;
    h.point.set(ox + dx * h.dist, oy + dy * h.dist, oz + dz * h.dist);
    h.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    h.collider = hit.collider;
    return h;
  }
  /** 向下探测地面高度；无地面返回 null */
  groundY(x: number, y: number, z: number, maxDist = 6, filter = Q_SOLID): number | null {
    const h = this.raycast(x, y, z, 0, -1, 0, maxDist, filter);
    return h ? h.point.y : null;
  }

  step(dt: number) {
    this.world.timestep = dt;
    this.world.step();
  }
  dispose() {
    this.world.free();
  }
}
