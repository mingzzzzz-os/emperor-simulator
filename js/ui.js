/* ═══════════ 帝王模拟器 · UI 渲染层 ═══════════ */

const UI = {
  $: s => document.querySelector(s),
  $$: s => document.querySelectorAll(s),
  peopleTab: 'court',

  /* ─────── 初始化 ─────── */
  init() {
    // 开场按钮
    this.$('#btn-new-game').onclick = () => { Game.clearSave(); this.showScreen('setup'); this.runSetup(); };
    if (Game.hasSave()) {
      this.$('#btn-continue').classList.remove('hidden');
      this.$('#btn-continue').onclick = () => {
        if (Game.load()) { this.enterGame(); this.pushCard('sys','前朝旧档已调阅，江山依旧。请选择本回合 3 项行动。'); this.renderAll(); }
        else this.toast('旧档已损毁，请重新开局。');
      };
    }
    // 存档/重开
    this.$('#btn-save').onclick = () => { Game.save(); this.toast('已存档。'); };
    this.$('#btn-restart').onclick = () => {
      if (confirm('确定要放弃当前进度，重开新局吗？')) { Game.clearSave(); location.reload(); }
    };
    // 开局输入
    this.$('#setup-send').onclick = () => this.setupAnswer();
    this.$('#setup-input').addEventListener('keydown', e=>{ if(e.key==='Enter') this.setupAnswer(); });
    // 自由指令
    this.$('#free-send').onclick = () => {
      const v = this.$('#free-input').value.trim();
      if (!v) return;
      this.$('#free-input').value = '';
      Game.pickAction(v);
    };
    this.$('#free-input').addEventListener('keydown', e=>{
      if(e.key==='Enter'){ this.$('#free-send').click(); }
    });
    // 事件处置
    this.$('#event-send').onclick = () => {
      const v = this.$('#event-input').value;
      this.$('#event-input').value = '';
      Game.resolveEvent(v);
    };
    this.$('#event-input').addEventListener('keydown', e=>{
      if(e.key==='Enter'){ this.$('#event-send').click(); }
    });
    // 决策场景：自由决断输入
    this.$('#choice-send').onclick = () => {
      const v = this.$('#choice-input').value.trim();
      if (!v) return;
      this.$('#choice-input').value = '';
      if (this._choiceFree) this._choiceFree(v);
    };
    this.$('#choice-input').addEventListener('keydown', e=>{
      if(e.key==='Enter'){ this.$('#choice-send').click(); }
    });
    // 人物 tabs
    this.$$('#people-tabs .ptab').forEach(b=>{
      b.onclick = ()=>{ this.peopleTab = b.dataset.tab;
        this.$$('#people-tabs .ptab').forEach(x=>x.classList.toggle('active', x===b));
        this.renderPeople(); };
    });
    // 行动网格
    this.buildActionGrid();
  },

  showScreen(name) {
    ['welcome','setup','game','ending'].forEach(n=>{
      this.$('#screen-'+n).classList.toggle('hidden', n!==name);
    });
  },

  enterGame() {
    this.showScreen('game');
    this.setDockMode(Game.S.pendingEvent ? 'event' : 'actions');
    this.renderAll();
    setTimeout(()=>this.scrollStory(), 60);
  },

  /* ─────── 开局向导（一问一答） ─────── */
  setupSteps: [
    { key:'name',   q:'新君登基，万事伊始。敢问——你的姓名是什么？', validate:v=>v.length>=1 && v.length<=8, err:'请报上姓名（1-8字）。' },
    { key:'guohao', q:'国号为何？（如：大雍、景、昭宁）', validate:v=>v.length>=1 && v.length<=6, err:'国号需为1-6字。' },
    { key:'nianhao',q:'年号为何？（如：建元、永熙、昭明）', validate:v=>v.length>=1 && v.length<=6, err:'年号需为1-6字。' },
    { key:'age',    q:'春秋几何？（登基时的年龄，16-50岁）', validate:v=>{const n=parseInt(v);return n>=16&&n<=50;}, err:'年龄需为16-50之间的数字。' },
    { key:'capital',q:'都城定于何处？（如：神京、洛邑、金陵）', validate:v=>v.length>=1 && v.length<=6, err:'都城需为1-6字。' },
    { key:'bg', q:'你的国家背景是？', type:'choice', options:Object.values(DATA.backgrounds).map(b=>({ value:b.key, label:`${b.key}. ${b.name}`, sub:b.desc })), validate:v=>['A','B','C','D'].includes(v.toUpperCase()), err:'请从 A / B / C / D 中选择。' },
  ],
  setupIdx: 0,
  setupInfo: {},

  runSetup() {
    this.setupIdx = 0; this.setupInfo = {};
    this.$('#setup-chat').innerHTML = '';
    this.askSetup();
  },

  askSetup() {
    const step = this.setupSteps[this.setupIdx];
    this.$('#setup-progress').textContent = `第 ${this.setupIdx+1} 项 / 共 ${this.setupSteps.length} 项`;
    this.appendChat('q', step.q);
    if (step.type === 'choice') {
      const row = document.createElement('div');
      row.className = 'chat-opt-row';
      step.options.forEach(o=>{
        const b = document.createElement('button');
        b.className = 'chat-opt';
        b.innerHTML = `<b>${o.label}</b><br><span style="font-size:12px;opacity:.8">${o.sub}</span>`;
        b.onclick = ()=>{ row.remove(); this.appendChat('a', `${o.label} — ${o.sub}`); this.acceptSetup(o.value); };
        row.appendChild(b);
      });
      this.$('#setup-chat').appendChild(row);
      this.scrollSetup();
    }
    this.$('#setup-input').focus();
  },

  setupAnswer() {
    const step = this.setupSteps[this.setupIdx];
    const v = this.$('#setup-input').value.trim();
    if (!v) { this.appendChat('q', step.err || '请回答后再继续。'); this.$('#setup-input').value=''; return; }
    if (!step.validate(v)) { this.appendChat('q', step.err); this.$('#setup-input').value=''; this.scrollSetup(); return; }
    this.$('#setup-input').value = '';
    this.appendChat('a', v);
    this.acceptSetup(step.key==='bg' ? v.toUpperCase() : v);
  },

  acceptSetup(v) {
    const step = this.setupSteps[this.setupIdx];
    this.setupInfo[step.key] = v;
    this.setupIdx++;
    if (this.setupIdx < this.setupSteps.length) { this.askSetup(); return; }

    // 全部完成 → 开局
    const bg = DATA.backgrounds[this.setupInfo.bg];
    this.appendChat('q',
      `登基大典已成。${bg.name}之主${this.setupInfo.name}，都${this.setupInfo.capital}，改元「${this.setupInfo.nianhao}」。<br>江山万里，自此尽付你手。`);
    setTimeout(()=>{
      Game.startNewGame(this.setupInfo);
      this.enterGame();
      this.pushDivider('登基 · 元年正月');
      this.pushCard('narr',
        `<b>第1年 第1月。</b>你在${this.setupInfo.capital}登基，国号${this.setupInfo.guohao}，年号${this.setupInfo.nianhao}。<br>` +
        `国家背景：${bg.name}（${bg.effectText}）。<br>` +
        `丞相沈素、大将军萧破军、掌印太监怀恩各怀心思；后宫皇后沈清弦、贵君谢兰因、侍君江雪楼与裴镜静待圣眷；七岁的过继公主谢朝雨，是帝脉仅有的皇嗣。<br><br>` +
        `每月为一个回合，每回合可择 <b>3</b> 项行动。行动会引发变动，月末必有事件——处置权，全在你。`, '');
      this.pushCard('sys', '请选择本回合 3 项行动（点下方按钮或直接输入）。');
      this.renderAll();
    }, 1400);
  },

  appendChat(type, html) {
    const d = document.createElement('div');
    d.className = 'chat-' + type;
    d.innerHTML = html;
    this.$('#setup-chat').appendChild(d);
    this.scrollSetup();
  },
  scrollSetup(){ const c = this.$('#setup-chat'); c.scrollTop = c.scrollHeight; },

  /* ─────── 主界面渲染 ─────── */
  buildActionGrid() {
    const grid = this.$('#action-grid');
    grid.innerHTML = '';
    DATA.actions.forEach(a=>{
      const b = document.createElement('button');
      b.className = 'act-btn';
      b.dataset.id = a.id;
      b.innerHTML = `${a.id}. ${a.name}<small>${a.desc}${a.energy<0?' · 精力'+a.energy:(a.energy>0?' · 精力+'+a.energy:'')}</small>`;
      b.onclick = ()=> Game.pickAction(a.id);
      grid.appendChild(b);
    });
  },

  renderAll() {
    if (!Game.S) return;
    this.renderTop();
    this.renderEmperor();
    this.renderPeople();
    this.renderDock();
  },

  renderTop() {
    const S = Game.S;
    this.$('#ui-era').textContent = `${S.eraName}`;
    this.$('#ui-date').textContent = `${S.nianhao}${S.year}年 ${DATA.monthNames[S.month-1]}`;
    this.$('#ui-turn').textContent = S.pendingEvent ? '事件处置中' : `本回合行动 ${S.actedThisTurn}/3`;

    const res = [
      { ico:'💰', label:'国库', val:S.gold, unit:'万两' },
      { ico:'⚔️', label:'军队', val:S.army, unit:'万' },
      { ico:'❤️', label:'民心', val:S.people },
      { ico:'🏛️', label:'权臣', val:S.power_minister },
      { ico:'🌸', label:'后宫', val:S.hougong },
      { ico:'🏰', label:'藩王', val:S.vassals.reduce((a,v)=>a+v.power,0) },
    ];
    const bar = this.$('#ui-resources');
    const oldVals = this._resCache || {};
    bar.innerHTML = res.map(r=>{
      const key = r.label;
      const old = oldVals[key];
      let delta = '';
      if (old !== undefined && old !== r.val) {
        const dv = r.val - old;
        delta = `<span class="float-delta" style="color:${dv>0?'#bfe0ae':'#f0b3a6'}">${dv>0?'+':''}${dv}</span>`;
      }
      oldVals[key] = r.val;
      return `<div class="res"><span class="res-ico">${r.ico}</span><span class="res-label">${r.label}</span><span class="res-val">${r.val}${r.unit||''}</span>${delta}</div>`;
    }).join('');
    this._resCache = oldVals;
  },

  renderEmperor() {
    const S = Game.S;
    this.$('#ui-avatar').textContent = S.name.slice(-1) || '帝';
    this.$('#ui-emp-name').textContent = S.name;
    this.$('#ui-emp-meta').textContent = `${S.guohao} · ${S.age}岁 · 第${['一','二','三','四','五','六','七','八','九','十'][S.generation-1]||S.generation}代`;
    this.$('#ui-emp-tags').innerHTML =
      `<span class="emp-tag ${S.statusName==='明君'?'status-ming':(S.statusName==='暴君'||S.statusName==='傀儡')?'status-bao':''}">${S.statusName}</span>` +
      `<span class="emp-tag">${S.statusDesc}</span>`;

    const attrs = [
      ['威严',S.weiyan],['手腕',S.shouwan],['仁德',S.rende],
      ['韬略',S.taolue],['精力',S.jingshen],['心性',S.xinxing],
    ];
    this.$('#ui-attrs').innerHTML = attrs.map(([k,v])=>`
      <div class="attr-row">
        <div class="attr-head"><span>${k}</span><b style="color:${v<=15?'var(--bad)':'inherit'}">${v}</b></div>
        <div class="attr-bar"><div class="attr-fill ${v<=15?'low':''}" style="width:${v}%"></div></div>
      </div>`).join('');

    const un = this.$('#ui-unresolved');
    if (!S.unresolved.length) un.innerHTML = '<div class="unresolved-empty">天下无事，海晏河清。</div>';
    else un.innerHTML = S.unresolved.map(u=>
      `<div class="unresolved-item"><b>${u.title}</b>（悬而未决 ${u.months} 月）<br>${u.desc}</div>`).join('');
  },

  renderPeople() {
    const S = Game.S, list = this.$('#people-list');
    const relBar = (label, v, cls)=> v===undefined?'':
      `<div class="rel-row"><span class="rel-label">${label}</span><div class="rel-bar"><div class="rel-fill ${cls}" style="width:${v}%"></div></div><span class="rel-val">${v}</span></div>`;

    if (this.peopleTab === 'court') {
      list.innerHTML = S.courtiers.map(c=>`
        <div class="person-card">
          <div class="person-head"><span class="person-name">${c.name}</span><span class="person-role ${c.tag==='eunuch'?'r-eunuch':''}">${c.role}</span></div>
          <div class="person-info">${c.gender} · ${c.age}岁 · ${c.trait}<br>${c.intro}</div>
          ${relBar('忠心',c.loyal,'loyal')}${relBar('野心',c.ambition,'amb')}
        </div>`).join('');
    } else if (this.peopleTab === 'harem') {
      list.innerHTML = S.harem.map(h=>`
        <div class="person-card">
          <div class="person-head"><span class="person-name">${h.name}</span><span class="person-role r-harem">${h.rank||h.role}</span></div>
          <div class="person-info">${h.gender} · ${h.age}岁 · ${h.trait||''}<br>${h.family||h.intro||''}</div>
          ${relBar('宠爱',h.favor,'love')}${relBar('野心',h.ambition,'amb')}
        </div>`).join('') || '<div class="people-empty">后宫无主，六宫虚设。<br>岁月漫长，或可遇新人。</div>';
    } else if (this.peopleTab === 'heir') {
      if (!S.heirs.length) { list.innerHTML = '<div class="people-empty">暂无皇嗣。<br>帝脉无人，国本悬空——宗室每年三月或有过继之女。</div>'; return; }
      list.innerHTML = S.heirs.map(h=>{
        const grown = h.age >= 16;
        const btns = grown && h.status!=='储君' && !S.dead ? `
          <div style="margin-top:7px;display:flex;gap:6px">
            <button class="btn btn-primary" style="padding:4px 12px;font-size:12px" onclick="Game.crownHeir('${h.id}','储君')">册立储君</button>
            <button class="btn" style="padding:4px 12px;font-size:12px;border:1px solid var(--gold);background:#fffdf6" onclick="Game.crownHeir('${h.id}','藩王')">分封藩王</button>
          </div>` : '';
        return `<div class="person-card">
          <div class="person-head"><span class="person-name">${h.name}</span><span class="person-role r-heir">${h.statusText}</span></div>
          <div class="person-info">${h.gender} · ${h.age}岁 · ${h.origin}<br>养父：${h.foster}</div>
          ${relBar('智',h.zhi,'loyal')}${relBar('武',h.wu,'amb')}${relBar('德',h.de,'love')}${relBar('胆',h.dan,'amb')}${relBar('心性',h.xinxing,'loyal')}
          ${btns}
        </div>`;
      }).join('');
    } else if (this.peopleTab === 'vassal') {
      list.innerHTML = S.vassals.map(v=>`
        <div class="person-card">
          <div class="person-head"><span class="person-name">${v.name}</span><span class="person-role r-vassal">藩王 · ${v.fief}</span></div>
          <div class="person-info">月赋税 ${v.tax}万两 · ${v.power>70?'⚠ 势力坐大':'安分守己'}</div>
          ${relBar('忠心',v.loyal,'loyal')}${relBar('势力',v.power,'amb')}
        </div>`).join('') || '<div class="people-empty">尚无分封藩王。<br>皇嗣年满16岁后可分封就藩。</div>';
    } else if (this.peopleTab === 'history') {
      list.innerHTML = Game.S.history.slice().reverse().map(h=>`
        <div class="history-card">
          <div class="history-title">${h.era}帝 · 讳${h.name} · 谥「${h.posthumous}」</div>
          <div class="history-body">在位 ${h.years} 年。${h.summary}</div>
        </div>`).join('') || '<div class="people-empty">国史方开卷。<br>本朝之事，将由你亲笔写就。</div>';
    }
  },

  renderDock() {
    const S = Game.S;
    this.$('#dock-picked').textContent = S.actedThisTurn;
    const lock = S.actedThisTurn >= 3 || !!S.pendingEvent || S.dead || !!S.busy;
    const btns = this.$$('#action-grid .act-btn');
    btns.forEach(b=>{
      const id = parseInt(b.dataset.id);
      b.classList.toggle('picked', S.pickedActions.includes(id));
      b.disabled = lock;
    });
    this.$('#free-input').disabled = lock;
    this.$('#free-send').disabled = lock;
  },

  setDockMode(mode) {
    this.$('#dock-actions').classList.toggle('hidden', mode!=='actions');
    this.$('#dock-event').classList.toggle('hidden', mode!=='event');
    this.$('#dock-choices').classList.toggle('hidden', mode!=='choices');
    if (mode==='event') setTimeout(()=>this.$('#event-input').focus(), 100);
    if (mode==='choices') setTimeout(()=>this.$('#choice-input').focus(), 100);
  },

  /* 决策场景选项面板 */
  showChoices(choices, onPick, onFree) {
    this._choicePick = onPick;
    this._choiceFree = onFree;
    const list = this.$('#choice-list');
    list.innerHTML = '';
    choices.forEach((c, i)=>{
      const b = document.createElement('button');
      b.className = 'choice-btn';
      b.innerHTML = `<b>${i+1}.</b> ${c.label}` + (c.desc?`<small>${c.desc}</small>`:'');
      b.onclick = ()=>{ if (this._choicePick) this._choicePick(i); };
      list.appendChild(b);
    });
  },

  /* 事件快捷倾向按钮 */
  buildEventQuick() {
    const quick = [
      { label:'从严处置', sub:'杀伐立威，但可能伤及无辜', text:'从严处置，绝不姑息' },
      { label:'从宽安抚', sub:'怀柔感化，但可能姑息养奸', text:'从宽安抚，既往不咎' },
      { label:'彻查到底', sub:'查明真相再断，但耗时费力', text:'命人彻查到底，务求水落石出' },
      { label:'暂且搁置', sub:'静观其变，但此事必然发酵', text:'暂且搁置，容后再议' },
    ];
    const wrap = this.$('#event-quick');
    wrap.innerHTML = '';
    quick.forEach(q=>{
      const b = document.createElement('button');
      b.className = 'choice-btn';
      b.innerHTML = `<b>${q.label}</b><small>${q.sub}</small>`;
      b.onclick = ()=> Game.resolveEvent(q.text);
      wrap.appendChild(b);
    });
  },

  /* ─────── 叙事卡片 ─────── */
  pushCard(type, html, headText='') {
    const d = document.createElement('div');
    d.className = `story-card sc-${type}`;
    d.innerHTML = (headText ? `<div class="sc-head">${headText}</div>` : '') + html;
    this.$('#story-flow').appendChild(d);
    this.scrollStory();
  },
  pushDivider(text) {
    const d = document.createElement('div');
    d.className = 'story-card sc-divider';
    d.textContent = `❖ ${text} ❖`;
    this.$('#story-flow').appendChild(d);
    this.scrollStory();
  },
  deltaChipsHtml(chips) {
    if (!chips || !chips.length) return '';
    return `<div class="delta-row">` + chips.map(c=>
      `<span class="delta-chip ${c.up?'up':'down'}">【${c.text}】</span>${c.reason?`<span class="delta-reason">${c.reason}</span>`:''}`
    ).join('') + `</div>`;
  },
  pushActionCard(name, text, chips) {
    const d = document.createElement('div');
    d.className = 'story-card sc-action';
    d.innerHTML = `<div class="sc-head">◈ ${name}</div>${text}${this.deltaChipsHtml(chips)}`;
    this.$('#story-flow').appendChild(d);
    this.scrollStory();
  },
  pushEventCard(title, text, hint, chips) {
    const d = document.createElement('div');
    d.className = 'story-card sc-event';
    d.innerHTML = `<div class="sc-head">⚡ ${title}</div>${text}${hint?`<div style="margin-top:7px;font-size:12px;color:#9c8f7a">💡 处置参考：${hint}（亦可自行决断）</div>`:''}${this.deltaChipsHtml(chips)}`;
    this.$('#story-flow').appendChild(d);
    this.scrollStory();
  },
  pushNpcCard(text, chips) {
    const d = document.createElement('div');
    d.className = 'story-card sc-npc';
    d.innerHTML = `<div class="sc-head">☞ 朝野动向</div>${text}${this.deltaChipsHtml(chips)}`;
    this.$('#story-flow').appendChild(d);
    this.scrollStory();
  },
  scrollStory(){ const f = this.$('#story-flow'); f.scrollTop = f.scrollHeight; },

  toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    this.$('#toast-wrap').appendChild(t);
    setTimeout(()=>{ t.style.opacity='0'; t.style.transition='.4s'; setTimeout(()=>t.remove(), 400); }, 2200);
  },

  /* ─────── 结局画面 ─────── */
  showEnding({ type, title, scene, posthumous, epitaph, years, goods, bads, generation, history }) {
    this.showScreen('ending');
    const S = Game.S;
    this.$('#ending-panel').innerHTML = `
      <div class="ending-title">大 事 去 矣</div>
      <div class="ending-sub">${title} · 第${generation}代 · ${S.nianhao}${years}年</div>
      <div class="ending-scene">${scene}</div>
      <div class="ending-block">
        <h3>谥 号</h3>
        <p style="font-size:22px;letter-spacing:6px;color:var(--cinnabar-deep);font-weight:900">「${posthumous}」</p>
        <p>${epitaph}</p>
      </div>
      <div class="ending-block">
        <h3>生 平 总 结</h3>
        <div class="ending-stats">
          <div class="ending-stat"><b>${years}</b><span>在位年数</span></div>
          <div class="ending-stat"><b>${generation}</b><span>传承世代</span></div>
          <div class="ending-stat"><b>${S.turnCount}</b><span>理政回合</span></div>
        </div>
        <p style="margin-top:12px">${goods.length?'<b style="color:var(--good)">功：</b>'+goods.join('；'):''}${goods.length&&bads.length?'<br>':''}${bads.length?'<b style="color:var(--bad)">过：</b>'+bads.join('；'):''}</p>
      </div>
      ${history.length>1?`<div class="ending-block"><h3>国 史 本 纪</h3>${history.map(h=>`<p>▪ ${h.era}帝讳${h.name}，谥「${h.posthumous}」，在位${h.years}年。</p>`).join('')}</div>`:''}
      <div class="ending-btns">
        <button class="btn btn-primary btn-lg" onclick="Game.clearSave();location.reload()">再开新局</button>
      </div>`;
  },

  /* ─────── 传承画面 ─────── */
  showSuccession({ rule, post, heir, goods, bads }) {
    const S = Game.S;
    this.showScreen('ending');
    const candidates = S.heirs.slice().sort((a,b)=> (b.status==='储君'?1:0)-(a.status==='储君'?1:0) || b.age-a.age);
    const hasAdult = candidates.some(h=>h.age>=16);

    this.$('#ending-panel').innerHTML = `
      <div class="ending-title">龙 驭 上 宾</div>
      <div class="ending-sub">${rule.name} · 国丧 · 谥「${post}」</div>
      <div class="ending-scene">${rule.scene}</div>
      <div class="ending-block">
        <h3>先 帝 本 纪（已入国史）</h3>
        <p>${goods.length?'<b style="color:var(--good)">功：</b>'+goods.join('；'):''}${goods.length&&bads.length?'<br>':''}${bads.length?'<b style="color:var(--bad)">过：</b>'+bads.join('；'):''}</p>
      </div>
      <div class="ending-block">
        <h3>帝 位 传 承</h3>
        ${hasAdult
          ? '<p>国不可一日无主。择立新君，承继大统——新帝将全盘继承先帝留下的国库、军队、民心与朝局。</p>'
          : '<p><b style="color:var(--bad)">主少国疑！</b>继承人皆未年满16岁，需辅政大臣或皇太后临朝——权臣势力将上涨、威严受损。</p>'}
        <div class="choice-list" style="margin-top:14px">
          ${candidates.map(h=>`
            <button class="choice-btn" onclick="Game.proceedSuccession('${h.id}', ${h.age<16})">
              <b>${h.name}</b>${h.status==='储君'?'（在册储君·皇太女）':''} · ${h.age}岁${h.age<16?' ⚠ 冲龄':''}
              <small>智${h.zhi} 武${h.wu} 德${h.de} 胆${h.dan} 心性${h.xinxing} —— 即位后属性将按培养换算</small>
            </button>`).join('')}
        </div>
      </div>`;
  },
};

window.addEventListener('DOMContentLoaded', ()=>UI.init());
