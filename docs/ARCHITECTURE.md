# 云垣遗歌 · 架构与设计备忘

## 目录结构
- `src/core`：math（damp/rng/noise）、Input（按键映射+指针锁）、Physics（Rapier 封装，碰撞组 G_WORLD/G_PLAYER/G_ENEMY/G_DYNAMIC）、Save（SaveData/Settings）、Audio（程序化 SFX + 生成式配乐）、Game（状态机 + 主循环）
- `src/gfx`：geo（MeshBuilder 合并顶点色几何 / Materials）、Renderer（Composer：Bloom + Final 调色/暗角/受击）、Sky（Atmosphere 预设插值、天穹、云、太阳/半球光、闪电）、Particles（两层池化 Points）、Effects（刀光/环/预警圈/光柱/爆裂球 + SwordTrail）、CameraRig
- `src/world`：Island（极坐标浮岛网格 + trimesh）、Props（实例化植被/岩石/草）、Interactables（检查点/能力祭坛/宝箱/拾取物/推箱+压板/符文柱/水晶开关/移动平台/闸门/上升气流/告示牌/陶罐）、Level（四个区域的布置）、World（容器 + 更新 + 查询）
- `src/entities`：Humanoid（程序化骨架 + 姿态阻尼动画）、Player、Enemy 基类、Slime、Golem、Wisp、Boss、Projectiles
- `src/ui`：UI（主菜单/暂停/设置/HUD/死亡/通关，全部 DOM）

## 约定
- 角色模型朝 +Z；`facing = atan2(dx, dz)`；角色左侧为 +X。相机 yaw=0 时位于 +Z 看向 -Z；forward=(-sin yaw, -cos yaw)，right=(cos yaw, -sin yaw)。关卡沿 -Z 推进。
- 手臂关节：x 负=前摆；右臂 z 负=外展，左臂 z 正=外展；躯干 y 正=向左转。
- 主循环：dt≤0.1，切成 ≤1/50 的子步（最多 5 步）；`timeScale` 实现顿帧。
- 玩家：胶囊 halfH 0.45 r 0.35；走 6 / 跑 9；跳 v0=10、g=28（顶点 1.8m）；二段跳 v=9；滑翔下落 -2.4、前进 10；土狼时间 0.12、跳跃缓冲 0.12。
- 单跳可过 ≤3.5m 间隙 / ≤1.2m 高差；二段跳门槛用 2.5m 高差；滑翔门槛 44m 间隙。
- 体力：冲刺 12/s、闪避 22、风刃 30；停用 0.8s 后 28/s 回复。攻击不耗体力。
- 按键：WASD 移动，鼠标视角（方向键备用），Space 跳/二段跳/按住滑翔，Shift 冲刺，左键攻击（三连），右键或 Q 闪避，E 风刃，F 互动，R 药水，Esc 暂停。

## 关卡坐标（x, y, z）
- 区域按玩家 z 判定：z>-118 草原 meadow；>-222 废墟 ruins；>-352 霜晶 frost；否则 storm。
- A 起始岛 (0,0,0) R28：出生 (0,·,14) 朝 -Z；cp_start；风车、小屋、池塘；史莱姆×2。
- 踏石 A→B；B 牧风丘 (0,3,-80) R26：cp_b；史莱姆×4；推箱+压板谜题开闸 → 祭坛「二段跳」。
- B→C 高踏石（每级 +2.5m）；C 遗迹广场 (0,16,-160) R32：cp_c；石像×2 + 沙史莱姆×3；按壁画顺序击打 3 根符文柱 → 移动平台启动。
- 移动平台 → D 神殿岛 (-62,20,-185) R20：cp_d；精英石像 + 幽灵；祭坛「风刃」；风刃击中远处水晶开关 → 光桥通向 E。
- E 霜原 (-62,28,-262) R30：cp_e；幽灵×3、霜史莱姆×2、霜石像×1；风刃点亮 3 颗远处水晶 → 大上升气流送到 F。
- F 极光台 (-20,50,-310) R20：cp_f；幽灵×2 + 霜石像；祭坛「滑翔」。
- 滑翔 → G 风暴祭坛 (-20,28,-400) R26：cp_boss；Boss「苍穹守卫·岚」三阶段（砸地冲击波 / 横扫；+光球齐射、冲撞、召唤；+落雷、连砸）。
- 收集：星辉碎片（固定总数，阈值升级剑）、远古遗物×9（每区 3）、生命之心×3、体力之露×2、药水上限。
- 存档：检查点激活/休息、拾取、解谜时自动写入 localStorage。死亡回检查点，普通敌人重置。

## 敌人
- 苔灵 Slime：idle/wander → chase（跳跃追击）→ windup（压扁预警）→ lunge → recover；受击 stagger。
- 石像卫士 Golem：dormant → awaken → chase → slam（预警圈 + 冲击波）/ sweep → recover；霸体，累计受击才硬直。
- 幽光灵 Wisp：悬浮远程；strafe 保持距离 → charge → fire（弱追踪光球）；玩家贴近时 blink 闪现。
- 敌人对象在建世界时一次性创建，死亡/重生只重置状态（无运行时分配）。

## 已约定的跨模块 API（实现时保持一致）
- `Ctx`（core/Context.ts）：scene/physics/input/audio/particles/fx/cam/mats/settings/save/player/world/projectiles/ui/time + hitStop/saveGame/hasFlag/setFlag/isCollected/collect/unlockAbility/setCheckpoint/onPlayerDeath/onBossDefeated/flash。
- `Hittable`：hitPos/hitRadius/hitHeight/aimable/canBeHit()/onHit(HitInfo)。
- Player 依赖：`world.hittables: Hittable[]`、`world.updraftAt(pos): number`（上升目标速度）、`world.pushOut(pos, radius, out: Vector3)`、`world.platformDelta(colliderHandle): Vector3 | undefined`、`projectiles.spawnBlade(x,y,z,dx,dy,dz,damage)`。
- Player 对外：pos/vel/facing/hp/stamina/potions/weaponLevel/state/grounded/gliding/iframe/skillCd/frozen/lastSafe、teleport/revive/heal/takeDamage(amount, fromX, fromZ, knock)/die/update/dispose、center（临时向量）。
- UIHooks：toast/banner/damageNumber/setPrompt/setObjective/setBoss/abilityCard。

## 模块 API 速查
### World API（world/World.ts）
root / islands / things / hittables / enemies: EnemyLike[] / boss: BossLike|null / pots / platforms / updrafts / signals / checkpoints(id→{x,y,z,facing,name}) / totals{relic,shard}
geo(key, make) / own(geo) / addIsland(opts): Island / beginProps(seed): PropCtx / endProps(pc) / addGrass(isl, density, c1, c2, seed, avoid, scale) / add(thing) / finish()
groundAt(x,z,yHint?) / updraftAt(pos) / platformDelta(handle) / pushOut / zoneAt(z) / grant(kind, amount, id) / spawnDrop(x,y,z) / resetEncounters() / update(dt) / dispose()
EnemyLike: pos, radius, alive, solid, update(dt), respawn(), dispose()；BossLike 额外 started/defeated。
导出：WEAPON_THRESHOLDS、WEAPON_NAMES、weaponLevelFor(shards)、ZONE_NAMES。
### Island（world/Island.ts）
new Island(opts{x,y,z,r,seed,palette,depth?,hill?,hillFreq?,edgeVar?,flats?,mounds?,paths?})；edgeR(th)、edgePoint(th, inset, out)、heightAt(x,z)、contains(x,z,margin)、o；PALETTES.{meadow,ruins,frost,storm}。角度 th：x=cos, z=sin。
### Props（world/Props.ts，全部接收 PropCtx c）
tree(c,x,y,z,s,kind: round|pine|autumn|dead|frost)、rock(c,x,y,z,s,color,color2,collide)、bush、flowers(c,x,y,z,color,n)、pillar(c,x,y,z,h,r,color,broken)、arch(c,x,y,z,width,h,rotY,color)、
block(c,x,y,z,w,h,d,rotY,color,color2)、wall(c,x,y,z,len,h,rotY,color)、fence(c,x1,z1,x2,z2,y)、house(c,x,y,z,rotY,roof)、crate、lantern(c,x,y,z,color,h)、crystals(c,x,y,z,s,color,glow)、iceSpike、windmillBody(c,x,y,z,rotY)→轴心、windmillBlades()→geo。
### Interactables（world/Interactables.ts，构造函数首参均为 ctx）
Checkpoint(id,name,x,y,z,facing)、Shrine(ability,x,y,z)、Chest(id,x,y,z,rotY,loot,amount)、Pickup(id|null,kind,x,y,z,amount)、PushBlock(x,y,z,half)、PressurePlate(flag,x,y,z,blocks[],solvedText)、
Gate(flag,x,y,z,w,h,rotY)、RunePuzzle(flag,defs[{x,y,z,color}] 顺序即答案,solvedText)、CrystalPuzzle(flag,defs[{x,y,z,pedestal?}],color,window 秒(0=常亮),solvedText)、
MovingPlatform(flag|null,a:Vector3,b:Vector3,w,d,travel,pause)、LightBridge(flag,pts:Vector3[],color)、Updraft(flag|null,x,y,z,radius,height,strength,color)、Sign(x,y,z,rotY,text)、Pot(x,y,z,color)（需 push 到 world.pots）、Spinner(mesh,speed)。
LootKind = shard|heart|dew|potion|relic|health。
### Projectiles（entities/Projectiles.ts）
new Projectiles(ctx)；spawnBlade(x,y,z,dx,dy,dz,dmg)、spawnOrb(x,y,z,dx,dy,dz,speed,dmg,homing,color,life)、spawnWave(x,y,z,r0,maxR,speed,dmg)（贴地冲击波，跳起可躲）、spawnStrike(x,y,z,r,delay,dmg,color)（预警圈+落雷）、update(dt)、clear()、dispose()。
### Enemy（entities/Enemy.ts）
abstract Enemy(ctx,x,y,z,tint)：实现 Hittable+EnemyLike；子类实现 think(dt)/color()；可用 initBody(halfH,r)、part(key,make,parent,mat)、move(vx,vz,dt)、jump(v)、face(dt,rate)、hitPlayer(dmg,knock)、setState、dist/dx/dz、onDamaged(h,dmg)、modifyDamage(h)、knockScale、dropChance、flying、hp/maxHp。
Slime(ctx,x,y,z,tier 0-2)、Golem(ctx,x,y,z,tier 0-2,facing)、Wisp(ctx,x,y,z,tier 0-2)。创建后需 push 到 world.enemies 和 world.hittables。
### Boss（entities/Boss.ts）
new Boss(ctx,x,y,z,arenaR)；导出 BOSS_NAME；BossLike(started/defeated)；phase 1-3；玩家靠近 17m 开战；死亡演出后调用 ctx.onBossDefeated()；respawn() 重置（已击败则不重置）。需 push 到 world.enemies / world.hittables 并赋给 world.boss。

## 验证记录
- `npm run typecheck`、`npm run build` 通过。
- 用注入页面的脚本机器人（接管主循环、以 60Hz 固定步长写入按键状态，走的是与玩家相同的输入 → Player → Rapier 路径）逐段跑通全流程：
  启程岛战斗 → 浮石 → 牧风丘推箱/压板/闸门/二段跳祭坛 → 之字浮石阶梯 → 遗迹战斗/符文谜题/移动平台 → 神殿战斗/风刃祭坛/风刃点亮水晶/光之阶梯
  → 霜原战斗/三水晶限时谜题/上升气流 → 极光台战斗/滑翔祭坛/滑翔 → 风暴祭坛 Boss 三阶段 → 通关界面。
- 真实点击验证：新游戏、继续、死亡重试、通关后继续探索、Esc 暂停、设置即时生效并持久化、操作说明、返回主菜单。
- 反复“继续 → 返回主菜单”三轮，GPU geometry / texture / program 数量与 Rapier 刚体、碰撞体数量保持不变。
- 未覆盖：七件遗物的收集路线、真实显卡上的帧率（开发机只有软件渲染）。

## 着色器与后期的数值安全

真实显卡上，片元着色器里一个 NaN 像素写进 HalfFloat 缓冲后，会被 Bloom 的分离式模糊扩散成一大块黑色矩形
（用 `sqrt(负 uniform)` 注入几个像素即可复现：关掉清理 pass 整屏变黑，打开后只剩一个小点）。因此约定：

- `pow()` 的底数必须先 `clamp` / `max(0)`：MSAA 边缘像素的 varying 会被外插到 [0,1] 之外。
- `smoothstep(e0, e1, x)` 必须 `e0 < e1`；需要反向时写 `1.0 - smoothstep(lo, hi, x)`。
- 片元输出的 alpha 钳制到 [0,1]，颜色不小于 0。
- `Renderer` 在 Bloom 之前有一个 `SanitizeShader` pass，把 NaN / Inf / 负值收回安全范围，作为最后一道保险。
- 粒子池里已熄灭的粒子在顶点着色器中被移出裁剪空间，不依赖 `gl_PointSize = 0`。

## 脱离卡死

暂停菜单 →「脱离卡死」→ 选择一座已唤醒的风之碑（`Game.unstuckTargets()` / `Game.unstuck(id)`）。
流程与死亡重试相同但不计死亡：清空弹幕与特效 → `world.resetEncounters()` → `world.unstick()`（各 `Thing.unstick()`，
目前 `PushBlock` 会回到初始位置）→ `spawnAtCheckpoint()` → 写存档。能力、收集品、flags 均不改动。
新增可能被玩家“玩坏”的机关时，请实现 `unstick()`。
