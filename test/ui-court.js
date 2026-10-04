/* 端到端：在真实 DOM 里跑「科举取士 → 召见新进士 → 调戏 → 性格化反应 */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const JS = k => fs.readFileSync(path.join(ROOT, 'js', k), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function assert(c, m) { if (c) pass++; else { fail++; console.error('  ✗ FAIL:', m); } }

function boot() {
  const d = new JSDOM(HTML, { url: 'https://game.test/', runScripts: 'outside-only' });
  const w = d.window;
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.CompressionStream = CompressionStream; w.DecompressionStream = DecompressionStream;
  w.Response = Response; w.Blob = Blob;
  w.eval(JS('data.js') + ';globalThis.DATA=DATA;');
  w.eval(JS('engine.js') + ';globalThis.Game=Game;');
  w.eval(JS('ui.js') + ';globalThis.UI=UI;');
  w.UI.init();
  return w;
}

/* 等到没有待决流程为止 */
async function settle(w, maxMs = 2500) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const s = JSON.parse(w.eval(`JSON.stringify({
      b:!!Game.S.busy, pp:!!Game.S.pendingPicker, cs:!!Game.S.currentScene,
      cp:!!Game.S.currentPetition, ev:!!Game.S.pendingEvent, q:Game.S.npcQueue.length,
      kj:!!Game.S.pendingKeju })`));
    if (s.kj) { w.eval('Game.kejuPickZhuangyuan(0)'); await sleep(30); continue; }
    if (s.ev) { w.eval(`Game.resolveEvent('酌情处置，宽严相济')`); await sleep(30); continue; }
    if (s.pp) { w.eval('Game.pickSceneTarget(0)'); await sleep(30); continue; }
    if (s.cs) { w.eval('Game.resolveSceneChoice(0)'); await sleep(30); continue; }
    if (s.cp) { w.eval('Game.resolvePetitionChoice(0)'); await sleep(30); continue; }
    if (!s.b && !s.q) return true;
    await sleep(50);
  }
  return false;
}

(async () => {
  const w = boot();
  w.eval(`Game.startNewGame({name:'萧承熙',guohao:'雍',nianhao:'承运',age:22,capital:'神京',bg:'A'}); UI.enterGame();`);
  await sleep(60);
  const S = () => w.eval('Game.S');

  console.log('▶ 1. 开局：朝班只有旧臣，无编造之人');
  const s0 = w.eval('Game.S.courtiers.map(c=>c.id+"/"+c.name+"/"+(c.persona||"-")).join(",")');
  assert(w.eval('Game.S.courtiers.length') === 4, '开局 4 名廷臣（沈素/萧破军/怀恩/太后），实际 ' + w.eval('Game.S.courtiers.length'));
  assert(!s0.includes('luzhibai') && !s0.includes('cuixingzhou'), '不再有 hardcoded 的编造廷臣');

  console.log('▶ 2. 推进到三年三月，触发春闱');
  // 直接把时间拨到三年三月，然后跑一个月
  w.eval('Game.S.year=3; Game.S.month=2; Game.S.actedThisTurn=0; Game.S.pickedActions=[]; Game.S.flags={};');
  w.eval('Game.nextMonth()');
  await sleep(80);
  const afterMonth = JSON.parse(w.eval(`JSON.stringify({y:Game.S.year,m:Game.S.month,kj:!!Game.S.pendingKeju,busy:!!Game.S.busy})`));
  assert(afterMonth.y === 3 && afterMonth.m === 3, '已进入三年三月，实际 ' + afterMonth.y + '年' + afterMonth.m + '月');
  assert(afterMonth.kj === true, '春闱已开，进入钦点状元流程');
  assert(afterMonth.busy === true, '流程进行中，锁定操作区');

  const cands = JSON.parse(w.eval(`JSON.stringify(Game.S.pendingKeju.cands.map(c=>({n:c.name,p:c.persona,r:c.region,t:c.tie.type,f:c.family.label})))`));
  assert(cands.length >= 3, '候选进士 ≥3 人，实际 ' + cands.length);
  console.log('   候选：' + cands.map(c => `${c.n}(${c.r}·${c.f}·${c.t})`).join('、'));
  assert(cands.every(c => c.n && c.p && c.r), '每人都有姓名/性格原型/籍贯');

  console.log('▶ 3. 钦点状元 → 定取士规模 → 进士入朝');
  const before = w.eval('Game.S.courtiers.length');
  w.eval('Game.kejuPickZhuangyuan(0)');
  await sleep(50);
  assert(w.eval('!!Game.S.currentScene'), '进入取士规模二段决策');
  w.eval('Game.resolveSceneChoice(0)');
  await sleep(80);
  const joined = w.eval('Game.S.courtiers.length') - before;
  assert(joined === cands.length, `${cands.length} 名进士全部入朝，实际 ${joined}`);
  assert(w.eval('!Game.S.pendingKeju'), '科举流程收尾');
  assert(w.eval('!Game.S.busy'), '操作区解锁');
  const jinshi = JSON.parse(w.eval(`JSON.stringify(Game.S.courtiers.filter(c=>c.isJinshi).map(c=>c.name))`));
  assert(jinshi.length > 0, '朝班出现新科进士：' + jinshi.join('、'));

  console.log('▶ 4. 新进士出现在召见大臣名单里');
  const opts = JSON.parse(w.eval(`JSON.stringify(DATA.scenes[2].picker(Game.S).options.map(o=>o.label))`));
  const hasNew = jinshi.some(n => opts.some(o => o.includes(n)));
  assert(hasNew, '召见名单含新进士，实际：' + opts.join(' | '));

  console.log('▶ 5. 召见一名进士，自由调戏 → 出性格化剧情');
  // 找一个有深度剧情原型（courtFlirt 六原型之一）的进士
  const target = JSON.parse(w.eval(`JSON.stringify((function(){
    const c = Game.S.courtiers.find(x=>x.isJinshi && DATA.courtFlirt[x.persona]);
    return c ? {id:c.id,name:c.name,persona:c.persona} : null;
  })())`));
  if (target) {
    const idx = opts.findIndex(o => o.includes(target.name));
    assert(idx >= 0, '能在名单里定位 ' + target.name);
    w.eval(`Game.S.actedThisTurn=0; Game.S.pickedActions=[]; Game.pickAction(2);`);
    await sleep(60);
    w.eval(`Game.pickSceneTarget(${idx})`);
    await sleep(60);
    assert(w.eval('!!Game.S.currentScene'), '进入召见场景');
    const sceneText = w.eval('(typeof Game.S.currentScene.scene.text==="function"?Game.S.currentScene.scene.text(Game.S):Game.S.currentScene.scene.text)');
    assert(!sceneText.includes('{name}') && !sceneText.includes('{id}'), '剧情无残留占位符');
    assert(sceneText.includes(target.name), '剧情已填入该进士姓名');

    const loyaltyBefore = w.eval(`Game.npc('${target.id}').loyal`);
    w.eval(`Game.resolveSceneFree('过来让朕好好瞧瞧你，你这张脸倒是好看')`);
    await sleep(60);
    const cards = w.eval('document.querySelectorAll("#story-flow .story-card").length');
    assert(cards > 0, '结果卡片已渲染');
    const lastCards = w.eval(`Array.from(document.querySelectorAll("#story-flow .story-card")).slice(-2).map(e=>e.textContent).join(" ")`);
    assert(lastCards.includes(target.name), '结果叙述中出现该进士（' + target.persona + '）');
    console.log('   调戏结果片段：' + lastCards.slice(0, 90).replace(/\s+/g, ' '));
  } else {
    console.log('   （本榜进士无深度剧情原型，跳过调戏验证）');
  }

  console.log('▶ 6. 调戏旧臣（沈素）也有专属反应');
  w.eval(`Game.S.actedThisTurn=0; Game.S.pickedActions=[]; Game.pickAction(2);`);
  await sleep(60);
  const shenIdx = JSON.parse(w.eval(`JSON.stringify(DATA.scenes[2].picker(Game.S).options.map(o=>o.label))`)).findIndex(o => o.includes('沈素'));
  w.eval(`Game.pickSceneTarget(${shenIdx})`);
  await sleep(60);
  const shenBefore = w.eval(`Game.npc('shensu').shame`);
  w.eval(`Game.resolveSceneFree('沈素，过来让朕瞧瞧，你这老臣倒是越活越精神')`);
  await sleep(60);
  const shenAfter = w.eval(`Game.npc('shensu').shame`);
  assert(shenAfter > shenBefore, `沈素被调戏后羞耻上升 ${shenBefore}→${shenAfter}`);
  const shenTxt = w.eval(`Array.from(document.querySelectorAll("#story-flow .story-card")).slice(-1).map(e=>e.textContent).join(" ")`);
  assert(shenTxt.includes('沈素'), '沈素的专属反应已演出');
  console.log('   沈素反应片段：' + shenTxt.slice(0, 80).replace(/\s+/g, ' '));

  console.log('▶ 7. 存档码仍能带走新入朝的进士');
  const code = await w.eval('Game.packSave()');
  const w2 = boot();
  await w2.eval(`(async()=>{ Game.applySave(await Game.unpackSave(${JSON.stringify(code)})); })()`);
  const n2 = w2.eval('Game.S.courtiers.filter(c=>c.isJinshi).length');
  assert(n2 > 0, '换设备后新进士仍在朝，实际 ' + n2);

  console.log('\n════════════════════');
  console.log(`结果：${pass} 通过，${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
