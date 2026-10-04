/* 手机端布局测试：验证「顶栏 + 三标签页」的结构契约
   （jsdom 不做真实排版，此处校验 DOM 结构与 CSS 断点，确保手机上每块内容都能被翻到） */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
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
  let s = 22 >>> 0;
  w.Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  w.eval(JS('data.js') + ';globalThis.DATA=DATA;');
  w.eval(JS('engine.js') + ';globalThis.Game=Game;');
  w.eval(JS('ui.js') + ';globalThis.UI=UI;');
  w.UI.init();
  return w;
}

(async () => {
  console.log('▶ 1. 页面结构：标签栏存在且默认隐藏');
  assert(HTML.includes('id="mobile-tabs"'), 'index.html 含 #mobile-tabs');
  assert(/<nav id="mobile-tabs">[\s\S]*?<\/nav>/.test(HTML), '标签栏是独立 nav 节点');
  const tabs = [...HTML.matchAll(/class="mtab[^"]*"\s+data-mtab="([^"]+)"/g)].map(m => m[1]);
  assert(tabs.length === 3, '标签栏共 3 个页签，实际 ' + tabs.length);
  assert(tabs.join(',') === 'story,emperor,people', '页签顺序为 朝堂/帝王/人物：' + tabs.join(','));
  // 桌面端必须默认隐藏：媒体查询之外要有一条 display:none
  const baseHide = CSS.indexOf('#mobile-tabs{display:none}');
  const mediaAt = CSS.indexOf('@media (max-width:760px)');
  assert(baseHide > -1 && baseHide < mediaAt, '桌面端默认隐藏 #mobile-tabs（且写在媒体查询之前）');
  assert(mediaAt > -1, 'CSS 含 @media (max-width:760px) 断点');

  console.log('▶ 2. 移动端视口与安全区');
  assert(HTML.includes('viewport-fit=cover'), 'viewport 支持 iPhone 刘海安全区');
  assert(CSS.includes('100dvh'), '使用动态视口高度，避免地址栏遮挡');
  assert(CSS.includes('env(safe-area-inset-bottom)'), '底部操作区预留 Home 条安全距离');

  console.log('▶ 3. 切换页签只改属性，不销毁任何内容');
  const w = boot();
  w.eval("Game.startNewGame({name:'测试',guohao:'雍',nianhao:'承运',age:26,capital:'神京',bg:'A'}); UI.enterGame();");
  await sleep(60);
  const main = w.document.querySelector('#game-main');
  assert(main.dataset.mtab === 'story', '开局默认停在「朝堂」页签，实际 ' + main.dataset.mtab);

  const activeCount = () => w.document.querySelectorAll('#mobile-tabs .mtab.active').length;
  assert(activeCount() === 1, '同时只有一个页签高亮');

  const tabBtn = t => w.document.querySelector(`#mobile-tabs .mtab[data-mtab="${t}"]`);
  tabBtn('emperor').click();
  assert(main.dataset.mtab === 'emperor', '点「帝王」→ data-mtab=emperor');
  assert(tabBtn('emperor').classList.contains('active'), '「帝王」页签高亮');
  assert(activeCount() === 1, '切换后仍只有一个高亮');

  tabBtn('people').click();
  assert(main.dataset.mtab === 'people', '点「人物」→ data-mtab=people');
  tabBtn('story').click();
  assert(main.dataset.mtab === 'story', '点「朝堂」→ data-mtab=story');

  console.log('▶ 4. 三块内容都渲染完整（切页签只是 CSS 显隐，DOM 不丢）');
  assert(w.document.querySelectorAll('#ui-attrs .attr-row').length >= 6,
    '帝王属性六维齐全，实际 ' + w.document.querySelectorAll('#ui-attrs .attr-row').length);
  assert(w.document.querySelectorAll('#people-list .person-card, #people-list .people-empty').length > 0,
    '人物栏已渲染内容');
  assert(!!w.document.querySelector('#story-flow'), '叙事流容器存在');
  w.eval("UI.pushCard('sys','测试了一张卡片')");
  assert(w.document.querySelectorAll('#story-flow .story-card').length > 0, '叙事流能正常承接卡片');
  assert(w.document.querySelectorAll('#ui-resources .res').length === 6, '国力条六项齐全');
  assert(w.document.querySelectorAll('#action-grid .act-btn').length === 12, '行动按钮 12 个齐全');

  console.log('▶ 5. 有待你落笔时，自动切回朝堂（不会漏掉批复）');
  UIStubMobile(w);
  tabBtn('people').click();
  assert(main.dataset.mtab === 'people', '先切到「人物」页签');
  w.eval('Game.S.pendingEvent = { id:1, type:"测试", title:"测试事件", text:"测试", hint:"", outcomes:{} }; UI.scrollStory();');
  assert(main.dataset.mtab === 'story', '事件待处置时自动切回「朝堂」，实际 ' + main.dataset.mtab);

  tabBtn('emperor').click();
  w.eval('Game.S.pendingEvent = null; Game.S.currentScene = { actionId:2, scene:{ text:"x" } }; UI.scrollStory();');
  assert(main.dataset.mtab === 'story', '剧情待决断时自动切回「朝堂」');

  console.log('▶ 6. 桌面端不受影响');
  assert(/@media \(max-width:1100px\)/.test(CSS), '平板断点保留');
  assert(!/#game-main\{flex:1;display:flex/.test(CSS), '桌面主区仍是三栏 grid，未被改成单栏');

  console.log('\n════════════════════');
  console.log(`结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();

/* jsdom 的 matchMedia 恒为 false，这里按移动端口径打桩 */
function UIStubMobile(w) {
  w.UI.isMobile = () => true;
}
