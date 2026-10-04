/* UI 端到端测试：用真实 DOM 跑通「设备A导出 → 设备B导入」的存档搬运链路
   两个独立 jsdom 实例 = 两台设备（各自独立的 localStorage） */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const JS = k => fs.readFileSync(path.join(ROOT, 'js', k), 'utf8');

let pass = 0, fail = 0;
const assert = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', msg); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tick = () => sleep(12);

/* 固定随机种子：游戏内含随机死亡（如服丹中毒），不定种子会让断言偶发飘红 */
const SEED = 22;

/* 起一台「设备」 */
function boot() {
  const dom = new JSDOM(HTML, { url: 'https://game.test/', runScripts: 'outside-only' });
  const w = dom.window;
  // jsdom 不自带编解码/压缩能力，把 Node 的注入进去（与浏览器等价）
  w.TextEncoder = TextEncoder;
  w.TextDecoder = TextDecoder;
  w.CompressionStream = CompressionStream;
  w.DecompressionStream = DecompressionStream;
  w.Response = Response;
  w.Blob = Blob;
  let s = SEED >>> 0;
  w.Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  w.eval(JS('data.js') + ';globalThis.DATA = DATA;');
  w.eval(JS('engine.js') + ';globalThis.Game = Game;');
  w.eval(JS('ui.js') + ';globalThis.UI = UI;');
  w.UI.init();
  w.__dom = dom;
  return w;
}

const $ = (w, sel) => w.document.querySelector(sel);
const btnByText = (w, sel, text) =>
  [...w.document.querySelectorAll(sel)].find(b => b.textContent.includes(text));

/* 把当前一切「等玩家拍板」的流程走完（场景决策 / NPC请示 / 事件处置） */
async function settle(w, maxMs = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const s = JSON.parse(w.eval(
      'JSON.stringify({b:!!Game.S.busy,pp:!!Game.S.pendingPicker,cs:!!Game.S.currentScene,' +
      'cp:!!Game.S.currentPetition,ev:!!Game.S.pendingEvent,q:Game.S.npcQueue.length})'));
    if (s.ev) { w.eval(`Game.resolveEvent('酌情处置，宽严相济')`); await sleep(30); continue; }
    if (s.pp) { w.eval('Game.pickSceneTarget(0)'); await sleep(30); continue; }
    if (s.cs) { w.eval('Game.resolveSceneChoice(0)'); await sleep(30); continue; }
    if (s.cp) { w.eval('Game.resolvePetitionChoice(0)'); await sleep(30); continue; }
    if (!s.b && !s.q) return;
    await sleep(50);
  }
}

/* 玩满一个月：择 3 项行动 → 处置月末事件 → 批复月度请示 → 进入下月
   每月固定选「上朝(-8) / 入后宫(0) / 修养(+15)」，净回精力，避免测试中把自己累死 */
const MONTH_ACTS = [1, 4, 8];
async function playMonth(w) {
  const t0 = w.eval('Game.S.turnCount');
  for (const id of MONTH_ACTS) {
    await settle(w, 300);
    w.eval(`Game.pickAction(${id})`);
    await sleep(20);
    await settle(w, 800);
  }
  // 等月末事件弹出（triggerRandomEvent 有 350ms 延迟）
  for (let g = 0; g < 40 && !w.eval('!!Game.S.pendingEvent') && w.eval('Game.S.turnCount') === t0; g++) await sleep(50);
  if (w.eval('!!Game.S.pendingEvent')) { w.eval(`Game.resolveEvent('酌情处置，宽严相济')`); await sleep(30); }
  // 等真正进入下月（nextMonth 有 500ms 延迟）
  for (let g = 0; g < 50 && w.eval('Game.S.turnCount') === t0; g++) await sleep(60);
  await sleep(900);   // 等月度请示队列上线（400ms + 2×300ms）
  await settle(w, 3000);
}

(async () => {

console.log('▶ 1. 设备A：开局、玩三个月、导出存档码');
const A = boot();
assert($(A, '#btn-continue').classList.contains('hidden'), '新设备上「继续前朝」应隐藏（无本机存档）');
A.eval(`Game.startNewGame({name:'萧承熙',guohao:'雍',nianhao:'承运',age:26,capital:'神京',bg:'A'}); UI.enterGame();`);
await sleep(30);
assert(!$(A, '#screen-game').classList.contains('hidden'), 'A 已进入游戏界面');
for (let m = 0; m < 3; m++) await playMonth(A);

const aTurn = A.eval('Game.S.turnCount');
const aGold = A.eval('Game.S.gold');
const aYear = A.eval('Game.S.year');
const aMonth = A.eval('Game.S.month');
const aHarem = A.eval('Game.S.harem.length');
const aHeirs = A.eval('Game.S.heirs.length');
console.log(`   已玩至 ${aYear}年${aMonth}月 · 理政${aTurn}回合 · 国库${aGold}万两 · 后宫${aHarem}人 · 皇嗣${aHeirs}人`);
assert(A.eval('Game.S.dead') === false, 'A 三个月内未驾崩（每月含修养，精力可控）');
assert(aTurn >= 3, '至少推进了 3 个回合，实际 ' + aTurn);

$(A, '#btn-export').click();
await sleep(250);
assert(!$(A, '#modal-save').classList.contains('hidden'), '导出弹层已打开');
const code = $(A, '#code-out').value;
assert(code.indexOf('EMPSAVE1') === 0, '存档码前缀正确，实际 ' + code.slice(0, 10));
assert(code.length > 200, '存档码有内容（' + code.length + ' 字符，约 ' + (code.length / 1024).toFixed(1) + ' KB）');
assert($(A, '#modal-body').textContent.includes('萧承熙'), '弹层展示了存档摘要');
console.log(`   存档码 ${code.length} 字符（约 ${(code.length / 1024).toFixed(1)} KB，模式 ${code.charAt(8)}）`);

console.log('▶ 2. 设备B：全新环境，用存档码接着玩');
const B = boot();
assert($(B, '#btn-continue').classList.contains('hidden'), 'B 起初没有本机存档');
$(B, '#btn-import-welcome').click();
await sleep(30);
assert(!$(B, '#modal-save').classList.contains('hidden'), '开场页可打开导入弹层');
$(B, '#code-in').value = code;
btnByText(B, '#modal-foot button', '确认导入').click();
await sleep(300);

assert(B.eval('!!Game.S'), 'B 导入后已建立进度');
assert(B.eval('Game.S.name') === '萧承熙', 'B 还原了帝王姓名：' + B.eval('Game.S.name'));
assert(B.eval('Game.S.turnCount') === aTurn, `B 还原理政回合 ${B.eval('Game.S.turnCount')}/${aTurn}`);
assert(B.eval('Game.S.gold') === aGold, 'B 还原国库 ' + B.eval('Game.S.gold'));
assert(B.eval('Game.S.year') === aYear && B.eval('Game.S.month') === aMonth, 'B 还原了年月');
assert(B.eval('Game.S.harem.length') === aHarem, 'B 还原后宫人数');
assert(B.eval('Game.S.heirs.length') === aHeirs, 'B 还原皇嗣人数');
assert(!$(B, '#screen-game').classList.contains('hidden'), 'B 已切到游戏界面');
assert($(B, '#modal-save').classList.contains('hidden'), '导入成功后弹层自动关闭');
assert($(B, '#story-flow').textContent.includes('前朝旧档已从别处搬回'), 'B 有接档叙事');
assert(B.eval('Game.hasSave()') === true, 'B 已把存档写入本机 localStorage');
assert(B.eval('Game.S.actedThisTurn') <= 3, 'B 的回合状态正常，未卡死');

console.log('▶ 3. 设备B：导入后能继续操作');
B.eval('Game.pickAction(3)');
await sleep(20);
await settle(B, 1200);
assert(B.eval('Game.S.actedThisTurn') > 0 || B.eval('Game.S.turnCount') > aTurn, 'B 导入后仍能推进游戏');

console.log('▶ 4. 坏存档码必须被拦下，且不破坏现有进度');
const bName = B.eval('Game.S.name');
const bGold = B.eval('Game.S.gold');
$(B, '#btn-import').click();
await sleep(30);
$(B, '#code-in').value = '这是一段乱码 not-a-real-save';
btnByText(B, '#modal-foot button', '确认导入').click();
await sleep(150);
assert(!$(B, '#modal-save').classList.contains('hidden'), '坏码时弹层保持打开，便于用户重试');
assert(B.eval('Game.S.name') === bName && B.eval('Game.S.gold') === bGold, '坏码没有污染现有进度');

console.log('▶ 5. 设备A 自己的进度未被影响');
assert(A.eval('Game.S.name') === '萧承熙' && A.eval('Game.S.gold') === aGold, 'A 的进度完好');
assert($(A, '#code-out').value === code, 'A 的存档码可重复复制');

console.log('\n════════════════════');
console.log(`结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
console.log('UI 端到端（跨设备存档搬运）全部通过 ✓');

})().catch(e => { console.error('测试异常:', e); process.exit(1); });
