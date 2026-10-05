/* 专项：自由批复的「读懂程度」——话不同的人要有不同的结果、不同的人物反应 */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const JS = k => fs.readFileSync(path.join(ROOT, 'js', k), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function assert(c, m) { if (c) pass++; else { fail++; console.error('  ✗ FAIL:', m); } }

const SEED = 77;
function boot() {
  const d = new JSDOM(HTML, { url: 'https://game.test/', runScripts: 'outside-only' });
  const w = d.window;
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.CompressionStream = CompressionStream; w.DecompressionStream = DecompressionStream;
  w.Response = Response; w.Blob = Blob;
  let s = SEED >>> 0;
  w.Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  w.eval(JS('data.js') + ';globalThis.DATA=DATA;');
  w.eval(JS('engine.js') + ';globalThis.Game=Game;');
  w.eval(JS('ui.js') + ';globalThis.UI=UI;');
  w.UI.init();
  return w;
}

/* 在同一个场景里，用不同的话批复，比较结果文本 */
function interprets(w, lines) {
  return lines.map(t => {
    const r = w.eval(`JSON.stringify((function(){
      Game.S.currentScene = { actionId:1, scene:{ id:'rite', text:'丞相沈素执笏出列，请支内帑八万两为太后办寿。太子太傅在一旁不说话。' }, noTurn:true };
      const cs = Game.S.currentScene;
      const actors = Game.bindActors(${JSON.stringify(t)}, { npcId: Game.sceneNpcId(cs.scene.text), fallbackText: cs.scene.text });
      const out = Game.interpretFree(${JSON.stringify(t)}, { kind:'scene', actors, sceneText: cs.scene.text, actionId:1 });
      const topic = Game.topicOf(1, cs.scene.text);
      return { t:${JSON.stringify(t)}, topic, understood: Game.understoodLine(Game.analyzeIntent(${JSON.stringify(t)}), actors, Game.intensityOf(${JSON.stringify(t)})), text: out.text, deltas: out.deltas.map(d=>d.k+':'+d.v) };
    })())`);
    return JSON.parse(r);
  });
}

(async () => {
  const w = boot();
  w.eval(`Game.startNewGame({name:'萧承熙',guohao:'雍',nianhao:'承运',age:22,capital:'神京',bg:'A'}); UI.enterGame();`);
  await sleep(60);

  console.log('▶ 1. 意图识别：正负主张不能混为一谈');
  const cases = [
    ['准了，八万两照拨', 'grant'],
    ['不准，寿辰家宴即可', 'refuse'],
    ['别罚了，放过他们这一次', 'lenient'],
    ['全都给我拿下，从严究办', 'punish'],
    ['先查清楚再说，不要急着定', 'investigate'],
    ['此事容后再议', 'delay'],
  ];
  for (const [txt, want] of cases) {
    const top = JSON.parse(w.eval(`JSON.stringify(Game.analyzeIntent(${JSON.stringify(txt)}))`))[0];
    assert(top && top.name === want, `「${txt}」应读作 ${want}，实际 ${top ? top.name : '未识别'}`);
  }

  console.log('▶ 2. 同一件事，措辞不同 → 结果文字不同');
  const rs = interprets(w, [
    '准了，八万两照拨',
    '驳回，寿辰家宴即可',
    '先派人查一查这用度是怎么算的',
    '别急着定，容后再议',
  ]);
  rs.forEach(r => console.log('   · ' + r.t + '\n     [' + r.topic + '] → ' + r.understood.join(' / ') + '\n     ' + r.text.slice(0, 46) + '…\n     Δ ' + r.deltas.join(',')));
  const bodies = rs.map(r => r.text);
  assert(new Set(bodies).size === bodies.length, '四种批复必须得到四种不同的结果文本');
  assert(rs[0].text.includes('准') && rs[0].deltas.some(d => d.startsWith('npc:shensu:loyal:')), '应允要有应允的说法，并落到人身上');
  assert(rs[1].text.includes('沈素'), '驳回要写沈素的反应');

  console.log('▶ 3. 点名不同人 → 反应的人跟着换');
  const named = JSON.parse(w.eval(`JSON.stringify(['让沈素去办这事，另外也告诉萧破军一声',
    '这件事交给萧破军去办，沈素不必过问'].map(t=>{
      const actors = Game.bindActors(t, { fallbackText:'' });
      return { main: actors.main && actors.main.name, others: actors.others.map(o=>o.name) };
    }))`));
  assert(named[0].main === '沈素' && named[0].others.includes('萧破军'), '第一句以沈素为主，萧破军为旁听');
  assert(named[1].main === '萧破军' && named[1].others.includes('沈素'), '第二句主角换成萧破军');
  console.log('   · 点名切换：' + JSON.stringify(named));

  const who = interprets(w, ['让沈素去办这事，另外也告诉萧破军一声', '这件事交给萧破军去办，沈素不必过问']);
  assert(who[0].text.includes('沈素') && who[1].text.includes('萧破军'), '结果里说话的人要跟着变');
  assert(who[0].text !== who[1].text, '两句话的结果不能是同一段文字');

  console.log('▶ 4. 语气轻重 → 数值不同');
  const twoTones = interprets(w, ['赏他些银子', '重赏加倍，务必要让所有人都看见']);
  const gentle = twoTones[0].deltas.find(d => d.includes('gold')) || '';
  const harsh = twoTones[1].deltas.find(d => d.includes('gold')) || '';
  assert(gentle !== harsh, `轻赏与重赏的数值不应相同（${gentle} vs ${harsh}）`);
  assert(twoTones[1].understood.includes('从重'), '「加倍」要被认出来');

  console.log('▶ 5. 新科进士也有各自的脾气（此前此处是空白）');
  w.eval(`Game.S.courtiers.push({id:'js_test', name:'路不问', role:'监察御史', tag:'court', persona:'gangzhi', loyal:60, favor:undefined, ambition:20, office:'御史台'});`);
  const newcomer = JSON.parse(w.eval(`JSON.stringify((function(){
    const t = '问他几句话，看他答得上来么';
    const a = Game.bindActors(t, { fallbackText:'' });
    const out = Game.interpretFree(t, { kind:'scene', sceneText:'路不问在阶下等着。', actionId:2, npcId:'js_test' });
    return { text: out.text, understood: Game.understoodLine(Game.analyzeIntent(t), Game.bindActors(t,{npcId:'js_test'}), 1) };
  })())`));
  console.log('   · ' + newcomer.text.slice(0, 60) + '…');
  const teased = JSON.parse(w.eval(`JSON.stringify(Game.reactionOf(Game.personOf('js_test'), 'tease', true))`));
  assert(String(teased).includes('路不问'), '刚直之士被撩要有专属反应');
  console.log('   · 他这一撩：' + String(teased).slice(0, 50) + '…');

  console.log('▶ 6. 「朕意已明」摘要卡能落到页面上');
  w.eval("document.querySelector('#story-flow').innerHTML='';");
  await sleep(20);
  interprets(w, ['准了，八万两照拨']);
  const cardCount = w.eval(`document.querySelectorAll('#story-flow .sc-understand').length`);
  assert(cardCount > 0, '页面上要出现摘要卡');
  const cardText = w.eval(`(document.querySelector('#story-flow .sc-understand')||{textContent:''}).textContent`);
  assert(cardText.includes('准其所请'), '摘要要写出识别到的意图，实际：' + cardText);
  console.log('   · 摘要卡：' + cardText);

  console.log('\n════════════════════\n结果：' + pass + ' 通过，' + fail + ' 失败');
  if (fail) process.exit(1);
  console.log('自由批复理解层全部通过 ✓\n');
})();
