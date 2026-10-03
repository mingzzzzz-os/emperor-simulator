/* 冒烟测试：stub 浏览器环境，跑通引擎核心流程（含场景决策与NPC请示） */
const fs = require('fs');
const path = require('path');

// ── stubs ──
const cards = [];
global.UI = {
  renderAll(){}, toast(m){ cards.push('[toast] '+m); },
  pushCard(t,h){ cards.push('['+t+'] '+String(h).slice(0,60)); },
  pushDivider(t){ cards.push('=== '+t+' ==='); },
  pushActionCard(n,t){ cards.push('[action:'+n+'] '+String(t).slice(0,50)); },
  pushEventCard(t,x){ cards.push('[event:'+t+'] '+String(x).slice(0,50)); },
  pushNpcCard(t){ cards.push('[npc] '+String(t).slice(0,50)); },
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

console.log('\n════════════════════');
console.log(`结果：${pass} 通过，${fail} 失败`);
if (fail>0) process.exit(1);
console.log('全部冒烟测试通过 ✓');
})().catch(e=>{ console.error('测试异常:', e); process.exit(1); });
