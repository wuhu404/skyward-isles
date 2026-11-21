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

## 进度备忘（实现状态）
已完成并通过 tsc：core/*（math, Input, Physics, Save, Audio, Context）、gfx/*（geo, Renderer, Sky, Particles, Effects, CameraRig）、
entities/Humanoid、entities/Player、world/Island、world/Props、world/Interactables、world/World。
待写：entities/Enemy(+Slime/Golem/Wisp)、entities/Projectiles、entities/Boss、world/Level、ui/UI(+css)、core/Game、main.ts、README。

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

## 开发测试备忘（非产品内容，交付前可删）
- 已完成：world/Level.ts、ui/UI.ts + ui/style.css、core/Game.ts、main.ts；tsc 通过；`npx vite --port 5173 --host 127.0.0.1` 在 shell `vite` 中运行。
- 浏览器测试工具在 `~/tools/pw`（playwright-core 通过 CDP http://localhost:29229 连接已运行的 Chrome）：`node drive.mjs t/<脚本>.mjs`，截图存 `~/tools/pw/shots`。
  - `t/bot.js`：注入页面的机器人（window.bot）：on()/off() 接管主循环无渲染快进；step(n,down,press)、goto(x,z,opts)、route([[x,z,opts]])、fight(R)、info()、isl()。dev 模式下 window.game 可访问全部私有字段。
  - `t/leg1.mjs`：新游戏 → 打两只史莱姆 → 跳浮石到 B 岛（已验证通过）。
- VM 只有 SwiftShader 软件渲染：高画质约 1.5~3 FPS、低画质约 8 FPS（非游戏问题）；VM 的 Chrome 不识别 CJK 字体，截图里中文显示为方框（非游戏问题）。
- 待办：机器人继续验证 B 岛推箱压板/闸门/二段跳祭坛 → C 符文谜题/移动平台 → D 风刃/水晶光桥 → E 三水晶限时/上升气流 → F 滑翔 → G Boss → 通关界面；
  之后：暂停/设置/死亡重试 UI 验证；按帧率自动降画质 + 软件渲染默认低画质；README；npm run build；git 提交；PR（仓库无远端则直接交付源码压缩包）。
- 进度：t/leg2.mjs（B 岛推箱/闸门/二段跳）与 t/leg3.mjs（之字浮石阶梯 → C 岛战斗 → 符文谜题 → 移动平台 → D 岛 cp_d）均已通过；死亡界面与“从风之碑重试”已验证。
  B→C 浮石已改为之字形（原直线阶梯会被上一级挡头）。机器人按键需同时写 down+pressed（否则触发短跳）。
  每个 leg 脚本开头：goto 页面 → 点 [data-act="continue"] → 注入 bot.js。下一步 leg4：D 战斗 + 风刃祭坛(-62,-188) + 风刃打水晶(-45,24,-214) + 光桥 → E。
- leg4 首次运行：D 岛战斗通过（hp 100→76）；机器人按 F 时离风刃祭坛正好 4m（提示半径 4）没拿到能力 → 脚本改为走到 (-62,-186.3) 再按 F（属脚本问题，非游戏 bug）。光桥 / E 岛尚未验证。
- leg4 第二次：风刃祭坛、风刃击中水晶、bridge_d 已通过并存档（存档在 cp_d，已有 windBlade + bridge_d）。光桥是每级抬升约 0.87m 的光之阶梯（需要跳），机器人用 noJump 走会掉下去 → t/leg4b.mjs 改为逐块跳。
- t/leg4b.mjs 通过：逐块跳过光之阶梯到达 E 岛 cp_e（存档现位于 cp_e）。
  下一步 leg5：E 岛战斗 → 16 秒内用风刃点亮三颗水晶 (-84,-256 高7)、(-50,-284 高6)、(-98,31,-280)（flag updraft_e）→ 气流柱在 (-39.7,28,-285.4) 上升到 50 → 落到 F 岛 (-23.4,50,-302.4) → cp_f、滑翔祭坛在 F 岛中心 → 向北滑翔到 G (-19.4,28,-398.4)，途中气流 → cp_boss → Boss 战 → 通关界面。
  机器人瞄准风刃：b.face(x,z) 并设 game.cam.pitch = -atan2(dy, d)，自动瞄准锥角 0.42 rad、射程 46。
- t/leg5.mjs 首次运行：E 岛战斗通过（hp 100→68）。三水晶谜题未完成（6.6 秒内对三颗 Crystal 各放风刃后 flags 中没有 updraft_e）。
  水晶 hitPos：(-84,36.2,-256)、(-50,35,-284)、(-98,33.5,-280)，玩家站在 (-68,28,-269)。待查：风刃是否真的命中高处水晶（Player.fireBlade 自动瞄准 / dy 钳制、
  Projectiles 风刃命中判定 hitRadius+0.9 与 hitHeight*0.5+0.9、被树或冰柱底座挡住）、Crystal 的 lit 字段名与限时窗口逻辑。存档仍在 cp_e。
- t/dbg2.mjs 结论：水晶谜题逻辑正常（第 2、3 颗从 (-68,-268) 可直接点亮）；第 1 颗 (-84,36.2,-256) 的风刃在 (-72.3,30.9,-264) 被场景物挡住（站位问题，非 bug）。
  leg5 需改为：先走到 (-78,-259) 附近打第 1 颗，再回 (-68,-268) 打第 2、3 颗（16 秒窗口内）。之后验证气流 → F → 滑翔 → G → Boss。
- t/leg5.mjs 通过：E 岛战斗 + 三水晶限时谜题（updraft_e 已置位并存档，存档在 cp_e，hp 逻辑正常）。
  下一步 t/leg6.mjs：走到气流柱 (-39.7,28,-285.4)（E 岛边缘外的小浮石，需跳上去）→ 乘气流升到 y≈50 → 向 F 岛 (-23.4,50,-302.4) 移动落地 → cp_f → 战斗 → 滑翔祭坛(F 岛中心按 F) → 从北缘滑翔到 G(-19.4,28,-398.4) → cp_boss → Boss 战 → 通关界面。
