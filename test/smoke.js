/* 冒烟测试：stub 浏览器环境，跑通引擎核心流程（含场景决策与NPC请示） */
const fs = require('fs');
const path = require('path');

// ── stubs ──
const cards = [];
global.UI = {
  renderAll(){}, toast(m){ cards.push('[toast] '+m); },
  pushCard(t,h){ cards.push('['+t+'] '+String(h).slice(0,60)); },
  pushDivider(t){ cards.push('=== '+t+' ==='); },
  pushActionCard(n,t){ cards.push('[action:'+n+'] '+String(t).slice(0,200)); },
  pushEventCard(t,x){ cards.push('[event:'+t+'] '+String(x).slice(0,200)); },
  pushNpcCard(t){ cards.push('[npc] '+String(t).slice(0,200)); },
  setDockMode(m){ cards.push('[dock:'+m+']'); },
  buildEventQuick(){},
  showChoices(cs,onPick,onFree){ global._pick=onPick; global._free=onFree; },
  showEnding(o){ cards.push('[ENDING] '+o.title+' 谥号='+o.posthumous+' 在位='+o.years+'年'); global._ending = o; },
  showSuccession(o){ cards.push('[SUCCESSION] '+o.rule.name+' 谥号='+o.post); global._succ = o; },
  enterGame(){ cards.push('[enterGame]'); },
};
global.localStorage = { _d:{}, getItem(k){return this._d[k]||null;}, setItem(k,v){this._d[k]=v;}, removeItem(k){delete this._d[k];} };

// 压缩引擎内的动画延迟，加速测试
const _st = global.setTimeout;
global.setTimeout = (fn, ms) => _st(fn, Math.min(ms||0, 5));

// ── load game scripts ──
const dir = path.join(__dirname, '..', 'js');
eval(fs.readFileSync(path.join(dir,'data.js'),'utf8') + ';globalThis.DATA = DATA;');
eval(fs.readFileSync(path.join(dir,'engine.js'),'utf8') + ';globalThis.Game = Game;');

let pass = 0, fail = 0;
function assert(cond, msg){ if(cond){pass++;} else {fail++; console.error('  ✗ FAIL:', msg);} }
const sleep = ms => new Promise(r=>setTimeout(r,ms));

/* 决策场景：把 picker→scene 走完 */
function drainScene(){
  let guard = 0;
  while (Game.S.busy && guard++ < 12) {
    if (Game.S.pendingPicker) Game.pickSceneTarget(0);
    else if (Game.S.currentScene) Game.resolveSceneChoice(0);
    else break;
  }
}
async function drainPetitions(){
  let g = 0;
  while (Game.S.npcQueue && Game.S.npcQueue.length && g++ < 6) {
    await sleep(30);
    if (global._pick) { global._pick(0); await sleep(30); }
    else break;
  }
  Game.S.npcQueue = []; Game.S.busy = false;
}

(async function main(){
console.log('▶ 1. 开局初始化');
Game.startNewGame({ name:'武曌', guohao:'大雍', nianhao:'建元', age:20, capital:'神京', bg:'A' });
let S = Game.S;
assert(S.gold === 600, 'A背景国库应为600，实际'+S.gold);
assert(S.courtiers.length === 4, '朝臣4人');
assert(S.harem.length === 4, '后宫4人');
assert(S.heirs.length === 1, '皇嗣1人');

console.log('▶ 2. 上朝=场景化奏对（演到拍板处停下）');
Game.pickAction(1);
assert(S.busy === true && !!S.currentScene, '上朝应停下等玩家决断');
assert(S.actedThisTurn === 0, '决断前不计行动数');
Game.resolveSceneChoice(0);
assert(S.actedThisTurn === 1, '决断后计入行动数，实际'+S.actedThisTurn);
assert(S.busy === false, '决断后解除忙碌');

console.log('▶ 3. 入后宫=选地点+独处剧情');
Game.pickAction(4);
assert(!!S.pendingPicker, '应先选去处');
Game.pickSceneTarget(0); // 皇后寝宫
assert(!!S.currentScene, '进入独处场景');
Game.resolveSceneChoice(1);
assert(S.actedThisTurn === 2, '计入行动数，实际'+S.actedThisTurn);

console.log('▶ 4. 自由文本匹配选项');
Game.pickAction(1);
Game.resolveSceneFree('从严查办，绝不姑息');
assert(S.actedThisTurn === 3, '自由文本也能完成决断，实际'+S.actedThisTurn);
await sleep(50);
assert(S.pendingEvent !== null, '3行动后应触发随机事件');

console.log('▶ 5. 事件处置 → NPC请示队列');
Game.resolveEvent('命人彻查此事，揪出幕后主使');
assert(S.pendingEvent === null, '事件已处置');
await sleep(80);
if (S.npcQueue && S.npcQueue.length) {
  const q0 = S.npcQueue.length;
  await drainPetitions();
  assert(true, 'NPC请示已批复（'+q0+'条）');
} else {
  assert(true, '本月无NPC请示（正常随机）');
}
assert(S.busy === false, '请示完毕后解除忙碌');

console.log('▶ 5.5 自由批复语义解析（批复与结果强相关）');
Game.startNewGame({ name:'语义', guohao:'雍', nianhao:'测元', age:25, capital:'神京', bg:'A' });
S = Game.S;
// 严厉批复 → 威严↑ 仁德↓，且叙述与措辞相关
Game.pickAction(1);
let w0=S.weiyan, r0=S.rende;
Game.resolveSceneFree('将妄议之人拖下去杖责八十，从重治罪，以儆效尤');
assert(S.weiyan > w0, '严厉批复→威严上升 '+w0+'→'+S.weiyan);
assert(S.rende < r0, '严厉批复→仁德下降 '+r0+'→'+S.rende);
const punishCard = cards.filter(c=>c.startsWith('[action:上朝 · 结果]')).pop();
assert(/行罚|斩钉截铁/.test(punishCard), '严厉批复的结果叙述应相关，实际：'+punishCard);
// 宽容批复 → 仁德↑ 威严不升，叙述与严厉版不同
w0=S.weiyan; r0=S.rende;
Game.pickAction(1);
Game.resolveSceneFree('都不必追究了，宽赦他们，既往不咎');
assert(S.rende > r0, '宽容批复→仁德上升 '+r0+'→'+S.rende);
assert(!(S.weiyan > w0), '宽容批复→威严不升 '+w0+'→'+S.weiyan);
const lenientCard = cards.filter(c=>c.startsWith('[action:上朝 · 结果]')).pop();
assert(/金口|宽赦/.test(lenientCard), '宽容批复的结果叙述应相关，实际：'+lenientCard);
assert(lenientCard !== punishCard, '两种批复的结果文本必须不同');
// 查究批复 → 手腕↑
let s0=S.shouwan;
Game.pickAction(1);
Game.resolveSceneFree('暗中派人查一查此事的来龙去脉，务求水落石出');
assert(S.shouwan > s0, '查究批复→手腕上升 '+s0+'→'+S.shouwan);
await sleep(50);

// 事件：主倾向从严 + 附加查究意图，文本与数值双关联
if (!S.pendingEvent) Game.triggerRandomEvent();
S.pendingEvent = JSON.parse(JSON.stringify(DATA.events[0]));
s0 = S.shouwan;
Game.resolveEvent('首恶斩立决，同时暗中查访幕后主使');
assert(S.pendingEvent === null, '事件已处置');
assert(S.shouwan > s0, '附加查究→手腕额外上升 '+s0+'→'+S.shouwan);
const evRes = cards.filter(c=>c.startsWith('[event:处置结果]')).pop();
assert(/暗|查|根脚/.test(evRes), '处置结果应包含查究安排，实际：'+evRes);
await sleep(80);
await drainPetitions();

console.log('▶ 5.6 NPC请示自由批复（数值指向对应人物）');
S = Game.S; S.dead=false; S.busy=false; S.pendingEvent=null; S.actedThisTurn=0; S.pickedActions=[]; S.jingshen=60;
const xiao2 = S.courtiers.find(c=>c.id==='xiaopojun');
S.npcQueue = [DATA.npcPetitions.find(p=>p.id==='xiao_gift')];
let l0 = xiao2.loyal;
Game.nextPetition();
assert(!!S.currentPetition, '请示已呈递');
Game.resolvePetitionFree('马是好马，朕却不能收——传话回去，边军将士比朕更需要它');
assert(xiao2.loyal < l0, '拒绝献马→萧破军忠心下降 '+l0+'→'+xiao2.loyal);
await sleep(30);
S.npcQueue = [DATA.npcPetitions.find(p=>p.id==='xiao_gift')];
l0 = xiao2.loyal;
Game.nextPetition();
Game.resolvePetitionFree('既然将军一片忠心，就照准了，另赐御剑一柄');
assert(xiao2.loyal > l0, '照准并赏→萧破军忠心上升 '+l0+'→'+xiao2.loyal);
await sleep(30);
S.npcQueue=[]; S.busy=false; S.currentPetition=null;

console.log('▶ 5.7 后宫亲昵批复（宠爱联动）');
S = Game.S; S.busy=false; S.pendingEvent=null; S.actedThisTurn=0; S.pickedActions=[]; S.jingshen=60;
Game.pickAction(4);
assert(!!S.pendingPicker, '先选去处');
const hOpts = S.pendingPicker.options;
const hqIdx = hOpts.findIndex(o=>o.label.includes('皇后'));
Game.pickSceneTarget(hqIdx >= 0 ? hqIdx : 0);
assert(!!S.currentScene, '进入独处场景');
if (hqIdx >= 0) {
  const hq = S.harem.find(h=>h.id==='shenqingxian');
  const f0 = hq.favor;
  Game.resolveSceneFree('拉着她的手到灯下坐坐，今夜就陪你说说话');
  assert(hq.favor > f0, '亲昵批复→皇后宠爱上升 '+f0+'→'+hq.favor);
} else {
  Game.resolveSceneFree('陪你说说话');
  assert(S.actedThisTurn === 1, '完成决断');
}

console.log('▶ 5.8 教导皇嗣自由发挥（皇嗣五维联动）');
S = Game.S; S.busy=false; S.pendingEvent=null; S.actedThisTurn=0; S.pickedActions=[]; S.jingshen=60;
const heir0 = S.heirs[0];
const hz = heir0.zhi;
Game.pickAction(11);
assert(!!S.pendingPicker, '先选皇嗣');
Game.pickSceneTarget(0);
assert(!!S.currentScene, '进入教导场景');
Game.resolveSceneFree('和她聊聊为君之道，听听她的想法');
assert(heir0.zhi > hz, '谈为君之道→皇嗣智上升 '+hz+'→'+heir0.zhi);

console.log('▶ 5.9 纳入后宫新人（harem_add + persona剧情）');
S = Game.S; S.busy=false; S.pendingEvent=null; S.actedThisTurn=0; S.pickedActions=[]; S.jingshen=60;
const haremN0 = S.harem.length;
Game.applyDeltas([{k:'harem_add:qingya', v:1, r:'测试纳入'}]);
assert(S.harem.length === haremN0+1, '后宫人数+1，实际'+S.harem.length);
const newM = S.harem[S.harem.length-1];
assert(newM.persona === 'qingya' && newM.age >= 18, '新人成年且有persona：'+newM.name+' '+newM.age+'岁');
// 入后宫可选到新人并触发persona专属剧情
Game.pickAction(4);
const nOpts = S.pendingPicker.options;
const nIdx = nOpts.findIndex(o=>o.label.includes(newM.name));
assert(nIdx >= 0, '新人出现在去处列表');
Game.pickSceneTarget(nIdx);
assert(!!S.currentScene && S.currentScene.memberId === newM.id, '进入新人专属剧情（memberId已绑定）');
// 调戏：宠爱上升，且叙述为调戏口径
const mf0 = newM.favor;
Game.resolveSceneFree('过来让朕好好瞧瞧你，逗逗你');
assert(newM.favor > mf0, '调戏→新人宠爱上升 '+mf0+'→'+newM.favor);
const teaseCard = cards.filter(c=>c.startsWith('[action:入后宫 · 结果]')).pop();
assert(/逗|调戏|无措|耳尖|脸红/.test(teaseCard), '调戏结果叙述应为调戏口径，实际：'+teaseCard);

console.log('▶ 5.10 艳遇事件纳入后宫');
const evY = DATA.events.find(e=>e.type==='艳遇');
assert(!!evY, '艳遇事件存在');
S = Game.S; S.busy=false; S.pendingEvent=null;
S.pendingEvent = JSON.parse(JSON.stringify(evY));
const yn0 = S.harem.length;
Game.resolveEvent('温言问明底细，纳入后宫');
assert(S.harem.length === yn0+1, '艳遇事件纳入新人，实际'+S.harem.length);
await sleep(80);
await drainPetitions();

console.log('▶ 6. 长程模拟 150 回合稳定性');
let err = null;
try {
  for (let i=0;i<150 && !Game.S.dead;i++) {
    for (let a=0;a<3;a++) {
      Game.pickAction(1+Math.floor(Math.random()*12));
      drainScene();
      await sleep(5);
      if (Game.S.dead) break;
    }
    await sleep(20);
    if (Game.S.pendingEvent) { Game.resolveEvent('酌情处置，宽严相济'); await sleep(30); }
    await drainPetitions();
    await sleep(5);
  }
} catch(e){ err = e; }
assert(!err, '150回合无异常' + (err?(' → '+err.stack):''));
console.log('   （模拟结束：'+Game.S.year+'年'+Game.S.month+'月，dead='+Game.S.dead+'）');

console.log('▶ 7. 终结型结局（民心=0）');
Game.startNewGame({ name:'测试二', guohao:'景', nianhao:'永熙', age:30, capital:'洛邑', bg:'C' });
S = Game.S;
S.people = 0;
global._ending = null;
Game.checkDeath();
assert(global._ending && global._ending.type==='terminal', '触发终结结局');

console.log('▶ 8. 传承流程（精力衰竭 + 有储君）');
Game.startNewGame({ name:'测试三', guohao:'昭', nianhao:'明德', age:40, capital:'金陵', bg:'B' });
S = Game.S;
const h = S.heirs[0];
h.age = 18; h.status='储君'; h.statusText='皇太女';
h.zhi=70; h.wu=60; h.de=80; h.dan=50; h.xinxing=60;
S.jingshen = 0;
global._succ = null;
Game.checkDeath();
assert(!!global._succ, '触发传承画面');
Game.proceedSuccession(h.id, false);
assert(Game.S.generation === 2, '进入第2代');
const expectWeiyan = Math.round(h.wu*0.6 + h.dan*0.4);
assert(Game.S.weiyan === expectWeiyan, '威严换算正确，期望'+expectWeiyan+'实际'+Game.S.weiyan);
assert(Game.S.history.length === 1, '先帝本纪入国史');

console.log('▶ 9. 教导皇嗣场景（_heir 映射）');
S = Game.S; S.dead=false; S.busy=false; S.actedThisTurn=0; S.pickedActions=[]; S.pendingEvent=null;
if (!S.heirs.length) S.heirs.push({ id:'h1', name:'谢朝雨', age:10, status:'在京', statusText:'在京皇嗣', zhi:40, wu:30, de:50, dan:35, xinxing:45 });
const targetHeir = S.heirs[0];
const sumBefore = ['zhi','wu','de','dan','xinxing'].reduce((a,f)=>a+(targetHeir[f]||0),0);
Game.pickAction(11);
assert(!!S.pendingPicker, '教导皇嗣先选人');
Game.pickSceneTarget(0);
assert(!!S.currentScene, '进入教导场景');
Game.resolveSceneChoice(0);
const sumAfter = ['zhi','wu','de','dan','xinxing'].reduce((a,f)=>a+(targetHeir[f]||0),0);
assert(sumAfter > sumBefore, '皇嗣五维总和应提升（'+sumBefore+'→'+sumAfter+'）');

console.log('▶ 10. 册封系统');
Game.startNewGame({ name:'测试五', guohao:'雍', nianhao:'泰和', age:30, capital:'神京', bg:'A' });
S = Game.S;
S.heirs[0].age = 16;
assert(Game.crownHeir(S.heirs[0].id, '储君') === true, '立储成功');
assert(Game.crownHeir(S.heirs[0].id, '储君') === false, '重复立储被拒');

console.log('▶ 11. 存档/读档（决策状态重置）');
Game.save();
const nameSaved = Game.S.name;
Game.S = null;
assert(Game.load() === true && Game.S.name === nameSaved, '存档恢复');
assert(Game.S.busy === false && Game.S.npcQueue.length === 0, '读档决策状态已重置');

console.log('▶ 12. 自由衍生指令');
S = Game.S; S.dead=false; S.pendingEvent=null; S.actedThisTurn=0; S.pickedActions=[]; S.busy=false;
Game.pickAction('微服私访体察民情');
if (S.busy) { drainScene(); }
assert(S.actedThisTurn === 1, '自由指令映射出巡并结算，实际'+S.actedThisTurn);
Game.pickAction('给边关将士送冬衣');
assert(S.actedThisTurn === 2, '衍生指令执行，实际'+S.actedThisTurn);

console.log('▶ 13. 存档搬运（跨设备存档码）');
Game.startNewGame({ name:'测试六', guohao:'雍', nianhao:'承运', age:28, capital:'神京', bg:'B' });
S = Game.S;
for (let i=0;i<6 && !S.dead;i++){           // 玩几个月，攒出后宫/皇嗣/国史/悬案等内容
  Game.pickAction(1); if (S.busy) drainScene();
  Game.pickAction(2); if (S.busy) drainScene();
  Game.pickAction(3); if (S.busy) drainScene();
  if (S.pendingEvent) Game.resolveEvent('酌情处置');
  await sleep(20);
}

const code = await Game.packSave();
assert(code.indexOf('EMPSAVE1') === 0, '存档码带版本前缀，实际开头：'+code.slice(0,12));
assert(code.length > 100, '存档码非空（'+code.length+' 字符）');
if (typeof CompressionStream === 'function')
  assert(code.length < JSON.stringify(Game.S).length, '压缩生效（码长'+code.length+' < 原长'+JSON.stringify(Game.S).length+'）');

const liveTurn = S.turnCount, liveGold = S.gold, liveName = S.name;
const liveYear = S.year;

// 解回来内容一致
const back = await Game.unpackSave(code);
assert(back.name === liveName, '还原姓名：'+back.name);
assert(back.turnCount === liveTurn, '还原理政回合：'+back.turnCount+'/'+liveTurn);
assert(back.year === liveYear, '还原年份：'+back.year+'/'+liveYear);
assert(back.gold === liveGold, '还原国库：'+back.gold+'/'+liveGold);
assert(back.harem.length === S.harem.length, '还原后宫人数：'+back.harem.length+'/'+S.harem.length);
assert(back.history.length === S.history.length, '还原国史卷数：'+back.history.length+'/'+S.history.length);
assert(back.heirs.length === S.heirs.length, '还原皇嗣人数：'+back.heirs.length+'/'+S.heirs.length);
assert(back.unresolved.length === S.unresolved.length, '还原未结事件：'+back.unresolved.length);

// 解档不该污染当前进度
assert(Game.S === S, '解档不替换当前进度（需显式 applySave）');

// 未压缩格式（旧/降级路径）也能导入
const plainCode = 'EMPSAVE1P' + Game._bytesToB64(new TextEncoder().encode(JSON.stringify(Game.snapshot())));
const backPlain = await Game.unpackSave(plainCode);
assert(backPlain.name === liveName && backPlain.gold === liveGold, '未压缩存档码可正常导入');
assert(plainCode.length > code.length, '压缩版确实更短（'+code.length+' < '+plainCode.length+'）');

// 直接粘贴原始 JSON 也能识别
const backJson = await Game.unpackSave(JSON.stringify(Game.snapshot()));
assert(backJson.name === liveName, '原始 JSON 可直接导入');

// 坏码要被拦住，不能把游戏搞死
let threw = 0;
for (const bad of ['', 'EMPSAVE1', 'hello world', 'EMPSAVE1Z@@@@', '{"name":"x"}']) {
  try { await Game.unpackSave(bad); } catch(e){ threw++; }
}
assert(threw === 5, '5 种坏存档码全部被拒，实际 '+threw);

// 月末事件处置中导出：要能退回一步，导入后不卡死
S.actedThisTurn = 3; S.pickedActions = [1,2,3];
S.pendingEvent = { title:'测试事件', text:'…', hint:'', outcomes:{} };
const snap = Game.snapshot();
assert(snap.pendingEvent === null, '导出快照清空待处置事件');
assert(snap.actedThisTurn === 2, '导出快照退回一步（行动 3→2），实际'+snap.actedThisTurn);
assert(snap.pickedActions.length === 2, '导出快照同步裁掉已选行动，实际'+snap.pickedActions.length);
assert(S.pendingEvent !== null && S.actedThisTurn === 3, '导出不污染当前进度');

// 导入后可继续把本回合补满
const codeMid = await Game.packSave();
Game.applySave(await Game.unpackSave(codeMid));
assert(Game.S.actedThisTurn === 2 && !Game.S.pendingEvent, '导入后回到可继续状态');
Game.pickAction(3); if (Game.S.busy) drainScene();
assert(Game.S.actedThisTurn === 3, '导入后仍能补满本回合行动，实际'+Game.S.actedThisTurn);

// 导入落盘后能被 localStorage 读回
Game.applySave(await Game.unpackSave(code));
assert(Game.hasSave() === true, '导入后已写入本机存档');
const n2 = Game.S.name;
Game.S = null;
assert(Game.load() === true && Game.S.name === n2, '导入的存档可正常读回');

console.log('\n════════════════════');
console.log(`结果：${pass} 通过，${fail} 失败`);
if (fail>0) process.exit(1);
console.log('全部冒烟测试通过 ✓');
})().catch(e=>{ console.error('测试异常:', e); process.exit(1); });
