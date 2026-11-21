/**
 * 关卡搭建：四个主题区域、七座主岛、连接路径、谜题、敌人与收集品。
 * 流程：启程草原(A→B) → 落日遗迹(C→D) → 霜晶极境(E→F) → 风暴祭坛(G)。
 */
import * as THREE from 'three';
import type { Ctx } from '../core/Context';
import type { World } from './World';
import { Island, PALETTES, type IslandPalette } from './Island';
import * as P from './Props';
import {
  Checkpoint, Chest, CrystalPuzzle, Gate, LightBridge, MovingPlatform, Pickup, Pot, PressurePlate, PushBlock,
  RunePuzzle, Shrine, Sign, Spinner, Updraft, type LootKind,
} from './Interactables';
import { Golem, Slime, Wisp, type Enemy } from '../entities/Enemy';
import { Boss } from '../entities/Boss';
import { makeRng, TAU } from '../core/math';

const N = -Math.PI / 2; // 朝 -Z（前进方向）
const S = Math.PI / 2;  // 朝 +Z

export function buildLevel(ctx: Ctx, w: World) {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  let seed = 100;
  let shardN = 0, relicN = 0;
  const enemy = <T extends Enemy>(e: T): T => { w.enemies.push(e); w.hittables.push(e); return e; };
  const shard = (x: number, y: number, z: number) => { w.add(new Pickup(ctx, 'shard_' + shardN++, 'shard', x, y + 1.0, z)); w.totals.shard++; };
  const shardLine = (a: THREE.Vector3, b: THREE.Vector3, n: number, lift = 0) => {
    for (let i = 0; i < n; i++) { const t = n === 1 ? 0.5 : i / (n - 1); shard(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + Math.sin(t * Math.PI) * lift, a.z + (b.z - a.z) * t); }
  };
  const relic = (x: number, y: number, z: number) => { w.add(new Pickup(ctx, 'relic_' + relicN++, 'relic', x, y + 1.1, z)); w.totals.relic++; };
  const item = (id: string, kind: LootKind, x: number, y: number, z: number) => w.add(new Pickup(ctx, id, kind, x, y + 1.1, z));
  const chest = (id: string, x: number, y: number, z: number, rot: number, loot: LootKind, n = 1) => { w.add(new Chest(ctx, id, x, y, z, rot, loot, n)); if (loot === 'shard') w.totals.shard += n; if (loot === 'relic') w.totals.relic += n; };
  const pot = (x: number, y: number, z: number, color?: number) => w.pots.push(w.add(new Pot(ctx, x, y, z, color)));
  /** 小型踏脚浮岛 */
  const stone = (x: number, y: number, z: number, r: number, pal: IslandPalette) =>
    w.addIsland({ x, y, z, r, seed: seed++, palette: pal, edgeVar: 0.08, depth: r * 1.6 + 1 });
  /** 在两点之间等距生成踏脚石（不含端点）；返回各石块中心 */
  const link = (a: THREE.Vector3, b: THREE.Vector3, n: number, r: number, pal: IslandPalette, wobble = 0) => {
    const out: THREE.Vector3[] = [];
    const rng = makeRng(seed * 31);
    const px = -(b.z - a.z), pz = b.x - a.x, pl = Math.hypot(px, pz) || 1;
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1);
      const o = (rng() - 0.5) * 2 * wobble;
      const p = V(a.x + (b.x - a.x) * t + (px / pl) * o, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t + (pz / pl) * o);
      stone(p.x, p.y, p.z, r, pal);
      out.push(p);
    }
    return out;
  };
  /** 在岛面上随机撒点（避开道路 / 指定圆） */
  const scatter = (isl: Island, n: number, rng: () => number, avoid: [number, number, number][], margin: number, fn: (x: number, y: number, z: number) => void) => {
    let placed = 0, tries = 0;
    while (placed < n && tries++ < n * 30) {
      const a = rng() * TAU, r = Math.sqrt(rng()) * isl.r;
      const x = isl.x + Math.cos(a) * r, z = isl.z + Math.sin(a) * r;
      if (!isl.contains(x, z, margin)) continue;
      if (avoid.some((c) => Math.hypot(x - c[0], z - c[1]) < c[2])) continue;
      if ((isl.o.paths ?? []).some((p) => { const dx = p[2] - p[0], dz = p[3] - p[1]; const t = Math.min(1, Math.max(0, ((x - p[0]) * dx + (z - p[1]) * dz) / (dx * dx + dz * dz))); return Math.hypot(x - (p[0] + dx * t), z - (p[1] + dz * t)) < p[4] * 0.5 + 1.2; })) continue;
      const y = isl.heightAt(x, z);
      if (y === null) continue;
      avoid.push([x, z, 2.2]);
      fn(x, y, z);
      placed++;
    }
  };
  const H = (isl: Island, x: number, z: number) => isl.heightAt(x, z) ?? isl.y;

  // =================================================================== A 启程岛
  const M = PALETTES.meadow;
  const A = w.addIsland({ x: 0, y: 0, z: 0, r: 28, seed: 1, palette: M, hill: 1.3, flats: [[0, 14, 6], [-13, 4, 7], [13, -4, 6], [0, -8, 5]], paths: [[0, 16, 0, -27, 3.2], [0, 4, -11, 4, 2.4], [0, -4, 12, -4, 2.4]] });
  {
    const c = w.beginProps(11);
    const avoid: [number, number, number][] = [[0, 14, 5], [-14, 4, 6.5], [14, -5, 6], [0, -8, 4], [-8, -16, 4]];
    P.house(c, -15, H(A, -15, 4), 4, Math.PI / 2);
    const axis = P.windmillBody(c, 15, H(A, 15, -5), -5, -Math.PI / 2);
    const blades = new THREE.Mesh(w.own(P.windmillBlades()), ctx.mats.world);
    blades.position.copy(axis); blades.rotation.y = -Math.PI / 2; blades.castShadow = true;
    w.root.add(blades); w.add(new Spinner(ctx, blades, 0.7));
    P.fence(c, -10, 9, -10, 14, H(A, -10, 11)); P.fence(c, -10, 14, -16, 14, H(A, -13, 14));
    P.crate(c, -11, H(A, -11, 0), 0, 1); P.crate(c, -11.3, H(A, -11.3, -1.3), -1.3, 0.8);
    P.lantern(c, 2.4, H(A, 2.4, 10), 10); P.lantern(c, -2.4, H(A, -2.4, -20), -20);
    scatter(A, 16, c.rng, avoid, 3, (x, y, z) => P.tree(c, x, y, z, 0.85 + c.rng() * 0.5, c.rng() < 0.75 ? 'round' : 'pine'));
    scatter(A, 9, c.rng, avoid, 2, (x, y, z) => P.rock(c, x, y, z, 0.6 + c.rng() * 0.9));
    scatter(A, 14, c.rng, avoid, 2, (x, y, z) => P.bush(c, x, y, z, 0.8 + c.rng() * 0.6));
    scatter(A, 22, c.rng, [], 1.5, (x, y, z) => P.flowers(c, x, y, z, [0xff7090, 0xffe060, 0xffffff, 0xb090ff][Math.floor(c.rng() * 4)], 5));
    w.endProps(c);
    w.addGrass(A, 0.95, 0x58b043, 0x9be063, 21, [[-15, 4, 4.5], [15, -5, 3.5], [0, 14, 2.5]]);
    w.add(new Checkpoint(ctx, 'cp_start', '启程岛', 0, H(A, 0, 14), 14, Math.PI));
    w.add(new Sign(ctx, 3.2, H(A, 3.2, 6), 6, -0.4, '旅人，欢迎来到云垣群岛。WASD 移动，鼠标转动视角，空格跳跃，Shift 冲刺，左键挥剑（可三连击），右键或 Q 翻滚闪避。'));
    w.add(new Sign(ctx, -3, H(A, -3, -22), -22, 0.3, '向北跳过浮石前往牧风丘。坠入云海会损失生命并回到最近的落脚点。按 R 饮用治疗药水。'));
    enemy(new Slime(ctx, 5, H(A, 5, -11), -11, 0));
    enemy(new Slime(ctx, -6, H(A, -6, -15), -15, 0));
    shardLine(V(0, H(A, 0, 6), 6), V(0, H(A, 0, -4), -4), 4);
    shard(14, H(A, 14, 8), 8); shard(-19, H(A, -19, -8), -8);
    chest('chest_a', -19.5, H(A, -19.5, 4), 4, Math.PI / 2, 'shard', 5); // 小屋背后
    pot(-12, H(A, -12, 8), 8); pot(-13.2, H(A, -13.2, 8.6), 8.6); pot(11, H(A, 11, -1), -1);
    // 隐藏：岛东侧下方的悬空小石台
    const hid = stone(31.5, -3.2, 6, 2.6, M);
    relic(hid.x, hid.y, hid.z);
    shard(26.5, -0.6, 6);
  }

  // =================================================================== A → B 浮石
  const B = w.addIsland({ x: 0, y: 3, z: -80, r: 26, seed: 2, palette: M, hill: 1.6, flats: [[0, -80, 7], [0, -96, 8], [-14, -78, 5], [0, -62, 5]], paths: [[0, -56, 0, -103, 3]] });
  {
    const a = A.edgePoint(N, 1.6), b = B.edgePoint(S, 1.6);
    const pts = link(a, b, Math.max(3, Math.ceil(a.distanceTo(b) / 6.2) - 1), 2.5, M, 1.2);
    for (const p of pts) shard(p.x, p.y, p.z);
  }
  {
    const c = w.beginProps(12);
    const avoid: [number, number, number][] = [[0, -62, 5], [0, -80, 8], [0, -97, 9], [-14, -78, 6], [12, -74, 4]];
    const gy = H(B, 0, -90);
    // 石墙 + 闸门，围住北端的祭坛
    for (const sx of [-1, 1]) {
      P.wall(c, sx * 8.5, H(B, sx * 8.5, -90), -90, 11, 4.2, 0, 0xb8b0a0);
      P.pillar(c, sx * 2.6, gy, -90, 4.6, 0.6, 0xc8c0b0);
      P.wall(c, sx * 14.5, H(B, sx * 14.5, -94.5), -94.5, 10, 4.2, sx * 1.15, 0xb8b0a0);
    }
    w.add(new Gate(ctx, 'gate_b', 0, gy, -90, 4.4, 4.2));
    const block = w.add(new PushBlock(ctx, 12, H(B, 12, -74), -74, 0.85));
    w.add(new PressurePlate(ctx, 'gate_b', -14, H(B, -14, -78), -78, [block], '北面的闸门打开了'));
    w.add(new Sign(ctx, -11, H(B, -11, -75), -75, 0.9, '古老的机关需要重量才能保持开启。也许附近有什么沉重的东西可以推过来……（走向石块即可推动它）'));
    w.add(new Shrine(ctx, 'doubleJump', 0, H(B, 0, -98), -98));
    w.add(new Checkpoint(ctx, 'cp_b', '牧风丘', 0, H(B, 0, -62), -62, Math.PI));
    P.lantern(c, 3.4, H(B, 3.4, -86.5), -86.5); P.lantern(c, -3.4, H(B, -3.4, -86.5), -86.5);
    scatter(B, 15, c.rng, avoid, 3, (x, y, z) => { if (z > -88) P.tree(c, x, y, z, 0.9 + c.rng() * 0.5, c.rng() < 0.6 ? 'round' : 'pine'); });
    scatter(B, 8, c.rng, avoid, 2, (x, y, z) => { if (z > -88) P.rock(c, x, y, z, 0.6 + c.rng() * 1.0); });
    scatter(B, 12, c.rng, avoid, 2, (x, y, z) => P.bush(c, x, y, z, 0.8 + c.rng() * 0.6));
    scatter(B, 18, c.rng, [], 1.5, (x, y, z) => P.flowers(c, x, y, z, [0xff7090, 0xffe060, 0xffffff][Math.floor(c.rng() * 3)], 5));
    w.endProps(c);
    w.addGrass(B, 0.95, 0x58b043, 0x9be063, 22, [[0, -98, 3.5], [-14, -78, 2], [0, -62, 2.5]]);
    enemy(new Slime(ctx, 8, H(B, 8, -66), -66, 0)); enemy(new Slime(ctx, -8, H(B, -8, -70), -70, 0));
    enemy(new Slime(ctx, 15, H(B, 15, -82), -82, 0)); enemy(new Slime(ctx, -4, H(B, -4, -82), -82, 0));
    shardLine(V(4, H(B, 4, -70), -70), V(12, H(B, 12, -78), -78), 3);
    chest('chest_b', 19, H(B, 19, -88), -88, -1.2, 'potion');
    item('heart_b', 'heart', -19, H(B, -19, -90), -90);
    pot(5, H(B, 5, -94), -94); pot(-5, H(B, -5, -95), -95);
    // 隐藏：需要二段跳才能登上的高石台
    const hi = stone(-27, 8.2, -68, 2.6, M);
    relic(hi.x, hi.y, hi.z);
  }

  // =================================================================== B → C 高阶浮石（二段跳门槛）
  const R = PALETTES.ruins;
  const C = w.addIsland({ x: 0, y: 16, z: -160, r: 32, seed: 3, palette: R, hill: 1.0, flats: [[0, -160, 13], [0, -136, 6], [-22, -168, 7], [16, -176, 6]], paths: [[0, -130, 0, -160, 3.4], [0, -160, -26, -170, 3]] });
  {
    // 之字形上升的浮石阶梯：相邻两级左右错开，避免上一级挡在头顶；每级抬升约 1.9m，需要二段跳
    const a = B.edgePoint(N, -1), b = C.edgePoint(S, -1);
    const n = 6;
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1);
      const p = stone(a.x + (b.x - a.x) * t + (i % 2 ? 3 : -3), a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t, 2.1, R);
      shard(p.x, p.y + 0.4, p.z);
    }
  }
  let platA: THREE.Vector3, platB: THREE.Vector3;
  const D = w.addIsland({ x: -62, y: 20, z: -185, r: 20, seed: 4, palette: R, hill: 0.7, flats: [[-62, -185, 8], [-62, -198, 5]], paths: [[-48, -180, -62, -185, 2.6], [-62, -185, -62, -203, 2.6]] });
  {
    const c = w.beginProps(13);
    const SC = 0xe0c898;
    const avoid: [number, number, number][] = [[0, -160, 14], [0, -136, 6], [-22, -168, 7], [16, -176, 7]];
    w.add(new Checkpoint(ctx, 'cp_c', '遗迹广场', 0, H(C, 0, -136), -136, Math.PI));
    P.arch(c, 0, H(C, 0, -143), -143, 6, 6.5, 0, SC);
    // 广场地砖与中央祭台
    c.b.cyl(11, 11.4, 0.24, 14, 0xd8c090, 0, H(C, 0, -160) + 0.06, -160, 0, 0, 0, 0xe8d8a8);
    P.block(c, 0, H(C, 0, -160), -160, 3.2, 0.7, 3.2, Math.PI / 4, 0xd0b888, 0xb09868);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.2; P.pillar(c, Math.cos(a) * 12.5, H(C, Math.cos(a) * 12.5, -160 + Math.sin(a) * 12.5), -160 + Math.sin(a) * 12.5, 5.5, 0.55, SC, i % 3 === 1); }
    P.wall(c, 22, H(C, 22, -152), -152, 9, 3.4, 1.2, SC); P.wall(c, -19, H(C, -19, -146), -146, 8, 3, -0.6, SC);
    // 壁画：三颗宝石从左到右即击打顺序（绿 → 橙 → 蓝）
    const my = H(C, 0, -160) + 0.7;
    c.b.box(2.4, 1.5, 0.3, 0xb8a078, 0, my + 0.75, -160, 0, 0, 0, 0xd8c098);
    const ORDER = [0x6dff8a, 0xffa040, 0x60b8ff];
    ORDER.forEach((col, i) => c.glow.add(new THREE.OctahedronGeometry(0.26, 0), col, new THREE.Matrix4().makeTranslation(-0.7 + i * 0.7, my + 0.8, -159.8)));
    w.add(new Sign(ctx, 2.6, H(C, 2.6, -157.6), -157.6, 0, '壁画上的三色宝石自左向右排列。「以剑为槌，循序叩响符文，沉睡的石台将再度启航。」'));
    // 三根符文柱（空间位置打乱）
    w.add(new RunePuzzle(ctx, 'rune_c', [
      { x: 16, y: H(C, 16, -176), z: -176, color: ORDER[0] },
      { x: -14, y: H(C, -14, -150), z: -150, color: ORDER[1] },
      { x: 9, y: H(C, 9, -146), z: -146, color: ORDER[2] },
    ], '西侧的浮空石台开始运转'));
    scatter(C, 9, c.rng, avoid, 3, (x, y, z) => P.tree(c, x, y, z, 0.9 + c.rng() * 0.5, c.rng() < 0.7 ? 'autumn' : 'dead'));
    scatter(C, 10, c.rng, avoid, 2, (x, y, z) => P.rock(c, x, y, z, 0.6 + c.rng() * 1.1, 0xb89868, 0xe0c898));
    scatter(C, 6, c.rng, avoid, 3, (x, y, z) => P.pillar(c, x, y, z, 4 + c.rng() * 2, 0.5, SC, true));
    scatter(C, 8, c.rng, avoid, 2, (x, y, z) => P.bush(c, x, y, z, 0.8, 0xa89040, 0xd8c060));
    P.lantern(c, 4, H(C, 4, -131), -131, 0xffa050); P.lantern(c, -4, H(C, -4, -131), -131, 0xffa050);
    w.endProps(c);
    w.addGrass(C, 0.4, 0xb89a48, 0xe0c870, 23, [[0, -160, 11.5]], 0.9);
    enemy(new Golem(ctx, 0, H(C, 0, -168), -168, 0, 0));
    enemy(new Golem(ctx, -22, H(C, -22, -168), -168, 0, 1.2));
    enemy(new Slime(ctx, 12, H(C, 12, -152), -152, 1)); enemy(new Slime(ctx, -10, H(C, -10, -156), -156, 1)); enemy(new Slime(ctx, 20, H(C, 20, -166), -166, 1));
    shardLine(V(-6, H(C, -6, -160), -160), V(6, H(C, 6, -160), -160), 4);
    shard(24, H(C, 24, -150), -150); shard(-24, H(C, -24, -156), -156); shard(6, H(C, 6, -184), -184);
    chest('chest_c', 25.5, H(C, 25.5, -155), -155, -1.9, 'shard', 6); // 残墙后
    item('dew_c', 'dew', 4, H(C, 4, -187), -187);
    pot(-3, H(C, -3, -146), -146, 0xd09050); pot(18, H(C, 18, -158), -158, 0xd09050); pot(19, H(C, 19, -159.2), -159.2, 0xd09050);
    // 隐藏：广场东侧上方的浮石阶
    const h1 = stone(36.5, 18.4, -172, 2.3, R), h2 = stone(42, 20.8, -178, 2.6, R);
    shard(h1.x, h1.y, h1.z); relic(h2.x, h2.y, h2.z);

    // C → D 移动石台
    const th = Math.atan2(D.z - C.z, D.x - C.x);
    platA = C.edgePoint(th, -3.4).setY(C.y + 0.1);
    platB = D.edgePoint(th + Math.PI, -3.4).setY(D.y + 0.1);
    w.add(new MovingPlatform(ctx, 'rune_c', platA, platB, 5, 5, 6, 2.2));
  }
  {
    const c = w.beginProps(14);
    const SC = 0xe0c898;
    const dy = H(D, -62, -185);
    w.add(new Checkpoint(ctx, 'cp_d', '风刃神殿', -50, H(D, -50, -181), -181, -Math.PI / 2));
    // 神殿：台基 + 立柱 + 横梁
    P.block(c, -62, dy - 0.2, -187, 13, 0.6, 12, 0, 0xd8c090, 0xb8a070);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.pillar(c, -62 + sx * 5.4, dy + 0.4, -187 + sz * 4.8, 5.6, 0.55, SC);
    c.b.box(13, 0.7, 1.4, SC, -62, dy + 6.9, -182.2, 0, 0, 0, 0xb8a070); c.b.box(13, 0.7, 1.4, SC, -62, dy + 6.9, -191.8, 0, 0, 0, 0xb8a070);
    w.add(new Shrine(ctx, 'windBlade', -62, dy + 0.4, -188));
    w.add(new Sign(ctx, -56, H(D, -56, -197), -197, -0.5, '北方悬崖外悬浮着一颗风之水晶。领受风刃的祝福后，按 E 向准星方向放出风刃击中它。'));
    scatter(D, 5, c.rng, [[-62, -187, 9], [-50, -181, 4]], 2.5, (x, y, z) => P.tree(c, x, y, z, 1, 'autumn'));
    scatter(D, 5, c.rng, [[-62, -187, 9], [-50, -181, 4]], 2, (x, y, z) => P.rock(c, x, y, z, 0.6 + c.rng(), 0xb89868, 0xe0c898));
    P.lantern(c, -59, H(D, -59, -200), -200, 0x7dffc0); P.lantern(c, -65, H(D, -65, -200), -200, 0x7dffc0);
    w.endProps(c);
    w.addGrass(D, 0.4, 0xb89a48, 0xe0c870, 24, [[-62, -187, 8]], 0.9);
    enemy(new Golem(ctx, -62, dy + 0.4, -180.5, 1, Math.PI / 2 + 0.6));
    enemy(new Wisp(ctx, -70, H(D, -70, -176), -176, 1)); enemy(new Wisp(ctx, -54, H(D, -54, -194), -194, 1));
    chest('chest_d', -74, H(D, -74, -190), -190, 1.57, 'heart');
    shard(-70, H(D, -70, -196), -196); shard(-52, H(D, -52, -172), -172);
    pot(-68, dy + 0.4, -184, 0xd09050); pot(-56, dy + 0.4, -184, 0xd09050);
    relic(-62, dy + 7.3, -191.8); // 隐藏：神殿横梁之上
  }

  // =================================================================== D → E 光桥
  const F = PALETTES.frost;
  const E = w.addIsland({ x: -62, y: 28, z: -262, r: 30, seed: 5, palette: F, hill: 1.8, hillFreq: 0.07, flats: [[-62, -240, 6], [-62, -262, 8]], paths: [[-62, -234, -62, -262, 3]] });
  {
    const a = D.edgePoint(N, -2.2), b = E.edgePoint(S, -2.0);
    const n = Math.max(6, Math.round(a.distanceTo(b) / 3.3));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) pts.push(a.clone().lerp(b, i / n).setY(D.y + 0.3 + (E.y - D.y - 0.2) * (i / n)));
    w.add(new LightBridge(ctx, 'bridge_d', pts));
    const sw = stone(-45, 23, -214, 1.6, R);
    w.add(new CrystalPuzzle(ctx, 'bridge_d', [{ x: sw.x, y: sw.y, z: sw.z, pedestal: 1.2 }], 0x7dffc0, 0, '一座光桥向北方的霜原延伸'));
    for (let i = 2; i < pts.length - 1; i += 2) shard(pts[i].x, pts[i].y, pts[i].z);
  }
  // E → F：水晶谜题唤醒上升气流
  const thEF = Math.atan2(-44, 42);
  const colP = E.edgePoint(thEF, -5.5);
  const Fi = w.addIsland({ x: colP.x + Math.cos(thEF) * 23.5, y: 50, z: colP.z + Math.sin(thEF) * 23.5, r: 20, seed: 6, palette: F, hill: 0.8, edgeVar: 0.06, flats: [[colP.x + Math.cos(thEF) * 23.5, colP.z + Math.sin(thEF) * 23.5, 8]] });
  {
    const c = w.beginProps(15);
    const avoid: [number, number, number][] = [[-62, -240, 6], [-62, -262, 9], [colP.x, colP.z, 9]];
    w.add(new Checkpoint(ctx, 'cp_e', '霜原', -62, H(E, -62, -240), -240, Math.PI));
    stone(colP.x, 28, colP.z, 3.4, F);
    w.add(new Updraft(ctx, 'updraft_e', colP.x, 28, colP.z, 3.6, 30, 16));
    // 三颗风之水晶：两颗在高冰柱上、一颗悬在崖外，需要风刃且限时
    const cr = [
      { x: -84, y: H(E, -84, -256), z: -256, pedestal: 7 },
      { x: -50, y: H(E, -50, -284), z: -284, pedestal: 6 },
    ];
    const far = stone(-98, 31, -280, 1.6, F);
    w.add(new CrystalPuzzle(ctx, 'updraft_e', [...cr, { x: far.x, y: far.y, z: far.z, pedestal: 1.5 }], 0x8fd8ff, 16, '东北方升起了一道上升气流'));
    w.add(new Sign(ctx, -58, H(E, -58, -258), -258, 0.2, '霜原上散落着三颗风之水晶，它们的光芒只能维持片刻。在光芒消散前用风刃（E）将三颗全部点亮，沉睡的气流便会苏醒。'));
    scatter(E, 16, c.rng, avoid, 3, (x, y, z) => P.tree(c, x, y, z, 0.9 + c.rng() * 0.6, 'frost'));
    scatter(E, 10, c.rng, avoid, 2.5, (x, y, z) => P.iceSpike(c, x, y, z, 0.7 + c.rng() * 0.8));
    scatter(E, 7, c.rng, avoid, 2.5, (x, y, z) => P.crystals(c, x, y, z, 0.7 + c.rng() * 0.6, 0x8fd8ff));
    scatter(E, 8, c.rng, avoid, 2, (x, y, z) => P.rock(c, x, y, z, 0.7 + c.rng(), 0x8fa8c8, 0xe8f4ff));
    P.lantern(c, -59, H(E, -59, -236), -236, 0x8fd8ff); P.lantern(c, -65, H(E, -65, -236), -236, 0x8fd8ff);
    w.endProps(c);
    w.addGrass(E, 0.22, 0xb8d8f0, 0xffffff, 25, [], 0.8);
    enemy(new Wisp(ctx, -72, H(E, -72, -254), -254, 2)); enemy(new Wisp(ctx, -48, H(E, -48, -268), -268, 2)); enemy(new Wisp(ctx, -66, H(E, -66, -280), -280, 2));
    enemy(new Slime(ctx, -56, H(E, -56, -250), -250, 2)); enemy(new Slime(ctx, -74, H(E, -74, -270), -270, 2));
    enemy(new Golem(ctx, -62, H(E, -62, -272), -272, 2, 0));
    shardLine(V(-62, H(E, -62, -246), -246), V(-62, H(E, -62, -256), -256), 4);
    shard(-80, H(E, -80, -244), -244); shard(-44, H(E, -44, -256), -256); shard(-78, H(E, -78, -282), -282);
    chest('chest_e', -84, H(E, -84, -268), -268, 1.2, 'shard', 8);
    item('dew_e', 'dew', -40, H(E, -40, -272), -272);
    pot(-66, H(E, -66, -243), -243, 0x88a8d0); pot(-58, H(E, -58, -243.5), -243.5, 0x88a8d0);
    // 隐藏：霜原西南崖外的下沉浮石
    const hs = stone(-96, 24.5, -246, 2.5, F);
    relic(hs.x, hs.y, hs.z);
  }
  // =================================================================== F 极光台
  const G = w.addIsland({ x: Fi.x + 4, y: 28, z: Fi.z - 96, r: 27, seed: 7, palette: PALETTES.storm, hill: 0, edgeVar: 0.04, depth: 34 });
  {
    const c = w.beginProps(16);
    const fx = Fi.x, fz = Fi.z, fy = Fi.y;
    const cp = Fi.edgePoint(thEF + Math.PI, 6);
    w.add(new Checkpoint(ctx, 'cp_f', '极光台', cp.x, H(Fi, cp.x, cp.z), cp.z, Math.atan2(fx - cp.x, fz - cp.z)));
    w.add(new Shrine(ctx, 'glide', fx, H(Fi, fx, fz), fz));
    const avoid: [number, number, number][] = [[fx, fz, 7], [cp.x, cp.z, 5]];
    scatter(Fi, 8, c.rng, avoid, 2.5, (x, y, z) => P.crystals(c, x, y, z, 0.8 + c.rng() * 0.8, c.rng() < 0.5 ? 0x8fd8ff : 0xc9a8ff));
    scatter(Fi, 6, c.rng, avoid, 2.5, (x, y, z) => P.iceSpike(c, x, y, z, 0.8 + c.rng() * 0.7));
    scatter(Fi, 5, c.rng, avoid, 3, (x, y, z) => P.tree(c, x, y, z, 1, 'frost'));
    P.arch(c, fx + 1, fy, fz - 14, 6, 6.5, 0, 0xa8c0e0);
    w.endProps(c);
    w.addGrass(Fi, 0.2, 0xb8d8f0, 0xffffff, 26, [[fx, fz, 4]], 0.8);
    w.add(new Sign(ctx, fx + 5, H(Fi, fx + 5, fz - 11), fz - 11, 0, '风暴祭坛悬于北方的深空之下。领受滑翔的祝福后，在空中按住空格展开风之翼，乘风而去。'));
    enemy(new Wisp(ctx, fx - 9, H(Fi, fx - 9, fz + 5), fz + 5, 2)); enemy(new Wisp(ctx, fx + 9, H(Fi, fx + 9, fz - 4), fz - 4, 2));
    enemy(new Golem(ctx, fx + 1, H(Fi, fx + 1, fz - 8), fz - 8, 2, Math.PI));
    chest('chest_f', fx - 13, H(Fi, fx - 13, fz - 6), fz - 6, 1.2, 'potion');
    item('heart_f', 'heart', fx + 13, H(Fi, fx + 13, fz + 6), fz + 6);
    // 滑翔航线上的碎片与中途气流
    const a = V(fx + 1, fy - 2, fz - 26), b = V(G.x, G.y + 6, G.z + 30);
    shardLine(a, b, 7);
    const mid = a.clone().lerp(b, 0.5);
    w.add(new Updraft(ctx, null, mid.x, mid.y - 14, mid.z, 4.5, 22, 13, 0xd8b8ff));
    // 隐藏：滑翔途中偏东的浮岛
    const hg = stone(mid.x + 30, mid.y - 6, mid.z - 6, 3.2, PALETTES.storm);
    relic(hg.x, hg.y, hg.z); shard(hg.x + 1.5, hg.y, hg.z + 1);
    link(V(hg.x, hg.y, hg.z), G.edgePoint(Math.atan2(hg.z - G.z, hg.x - G.x), 1), 3, 2.2, PALETTES.storm);
  }
  // =================================================================== G 风暴祭坛
  {
    const c = w.beginProps(17);
    const cp = G.edgePoint(S, 3.5);
    w.add(new Checkpoint(ctx, 'cp_boss', '风暴祭坛', cp.x, G.y, cp.z, Math.PI));
    c.b.cyl(19, 19.5, 0.2, 20, 0x565a7a, G.x, G.y + 0.04, G.z, 0, 0, 0, 0x6a6e92);
    c.b.cyl(7, 7.3, 0.2, 12, 0x6a6e92, G.x, G.y + 0.1, G.z);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + 0.31;
      const x = G.x + Math.cos(a) * 23.5, z = G.z + Math.sin(a) * 23.5;
      if (Math.abs(a - S) < 0.5) continue;
      P.pillar(c, x, G.y, z, 7 + (i % 3) * 1.5, 0.75, 0x6a6e92, i % 4 === 3);
      c.glow.add(new THREE.OctahedronGeometry(0.4, 0), 0xc9a8ff, new THREE.Matrix4().makeTranslation(x, G.y + 9.6 + (i % 3) * 1.5, z));
    }
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; P.crystals(c, G.x + Math.cos(a) * 25, G.y, G.z + Math.sin(a) * 25, 0.9, 0xb080ff); }
    w.endProps(c);
    const boss = enemy(new Boss(ctx, G.x, G.y, G.z, 22));
    w.boss = boss;
    pot(cp.x + 3, G.y, cp.z + 0.5, 0x6a6e92); pot(cp.x - 3, G.y, cp.z + 0.5, 0x6a6e92);
    relic(G.x, G.y - 0.2, G.z - 24.5); // 祭坛最深处
  }
  w.finish();
}
