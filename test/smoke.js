/* 冒烟测试：stub 浏览器环境，跑通引擎核心流程 */
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

(async function main(){
console.log('▶ 1. 开局初始化');
Game.startNewGame({ name:'武曌', guohao:'大雍', nianhao:'建元', age:20, capital:'神京', bg:'A' });
let S = Game.S;
assert(S.gold === 600, 'A背景国库应为600，实际'+S.gold);
assert(S.courtiers.length === 4, '朝臣4人');
assert(S.harem.length === 4, '后宫4人');
assert(S.heirs.length === 1, '皇嗣1人');
assert(S.jingshen === 50, '精力50');

console.log('▶ 2. 三行动 → 随机事件触发');
Game.pickAction(1);
Game.pickAction('修养');
Game.pickAction(9);
assert(S.actedThisTurn === 3, '已执行3行动，实际'+S.actedThisTurn);
await sleep(50);
assert(S.pendingEvent !== null, '应触发随机事件');
assert(S.pendingEvent.outcomes && S.pendingEvent.outcomes.tough, '事件含处置分支');

console.log('▶ 3. 处置事件 → 进入下月');
Game.resolveEvent('命人彻查此事，揪出幕后主使');
assert(S.pendingEvent === null, '事件已处置');
await sleep(50);

console.log('▶ 4. 长程模拟 120 回合（10年）稳定性');
let err = null;
try {
  for (let i=0;i<120 && !S.dead;i++) {
    Game.pickAction(1+Math.floor(Math.random()*12));
    Game.pickAction(1+Math.floor(Math.random()*12));
    Game.pickAction(1+Math.floor(Math.random()*12));
    await sleep(20);
    if (S.pendingEvent) { Game.resolveEvent('酌情处置，宽严相济'); await sleep(20); }
  }
} catch(e){ err = e; }
assert(!err, '120回合无异常' + (err?(' → '+err.stack):''));

console.log('▶ 5. 终结型结局（民心=0）');
Game.startNewGame({ name:'测试二', guohao:'景', nianhao:'永熙', age:30, capital:'洛邑', bg:'C' });
S = Game.S;
S.people = 0;
global._ending = null;
Game.checkDeath();
assert(global._ending && global._ending.type==='terminal', '触发终结结局');
assert(global._ending.posthumous, '有谥号');

console.log('▶ 6. 传承流程（精力衰竭 + 有储君）');
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
assert(Game.S.generation === 2, '进入第2代，实际'+Game.S.generation);
assert(Game.S.name === h.name, '新帝为储君');
const expectWeiyan = Math.round(h.wu*0.6 + h.dan*0.4);
assert(Game.S.weiyan === expectWeiyan, '威严换算正确，期望'+expectWeiyan+'实际'+Game.S.weiyan);
assert(Game.S.history.length === 1, '先帝本纪入国史');
assert(Game.S.year === 1 && Game.S.month === 1, '时间重置元年正月');

console.log('▶ 7. 主少国疑（储君<16）');
Game.startNewGame({ name:'测试四', guohao:'雍', nianhao:'泰和', age:40, capital:'神京', bg:'D' });
S = Game.S;
S.heirs[0].age = 10;
const pmBefore = S.power_minister;
S.jingshen = 0;
Game.checkDeath();
Game.proceedSuccession(S.heirs[0].id, true);
assert(Game.S.power_minister === Math.min(100, pmBefore+10), '权臣+10，实际'+Game.S.power_minister);

console.log('▶ 8. 册封系统');
Game.startNewGame({ name:'测试五', guohao:'雍', nianhao:'泰和', age:30, capital:'神京', bg:'A' });
S = Game.S;
S.heirs[0].age = 16;
assert(Game.crownHeir(S.heirs[0].id, '储君') === true, '立储成功');
assert(S.heirs[0].status === '储君', '储君身份');
assert(Game.crownHeir(S.heirs[0].id, '储君') === false, '重复立储被拒');
console.log('   （跳过封藩：已有储君在册，属正常分支）');

console.log('▶ 9. 存档/读档');
Game.save();
const nameSaved = Game.S.name;
Game.S = null;
assert(Game.load() === true && Game.S.name === nameSaved, '存档恢复');

console.log('▶ 10. 自由指令');
S = Game.S; S.dead=false; S.pendingEvent=null; S.actedThisTurn=0; S.pickedActions=[];
Game.pickAction('微服私访体察民情');
assert(S.actedThisTurn === 1, '自由指令映射到出巡');
Game.pickAction('给边关将士送冬衣');
assert(S.actedThisTurn === 2, '衍生指令执行');

console.log('\n════════════════════');
console.log(`结果：${pass} 通过，${fail} 失败`);
if (fail>0) process.exit(1);
console.log('全部冒烟测试通过 ✓');
})().catch(e=>{ console.error('测试异常:', e); process.exit(1); });
