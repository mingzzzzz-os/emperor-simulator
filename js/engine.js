/* ═══════════ 帝王模拟器 · 游戏引擎 ═══════════ */

const SAVE_KEY = 'emperor_sim_save_v1';

const Game = {
  /* ─────── 状态 ─────── */
  S: null,

  newState() {
    return {
      // 开局信息
      name:'', guohao:'', nianhao:'', age:20, capital:'', bg:'A',
      // 时间
      year:1, month:1, generation:1, eraName:'',
      // 帝王属性
      weiyan:50, shouwan:50, rende:50, taolue:50, jingshen:50, xinxing:50,
      // 国力
      gold:500, army:20, people:50, power_minister:60, hougong:20, zongshi:50,
      // 人物
      courtiers:[], harem:[], heirs:[], vassals:[],
      // 流程
      pickedActions:[], actedThisTurn:0,
      pendingEvent:null, unresolved:[], history:[],
      flags:{}, dead:false, turnCount:0,
      statusName:'庸主', statusDesc:'',
      achieved:{},  // 功过统计
    };
  },

  /* ─────── 工具 ─────── */
  clamp(v, lo=0, hi=100){ return Math.max(lo, Math.min(hi, v)); },
  rand(arr){ return arr[Math.floor(Math.random()*arr.length)]; },
  chance(p){ return Math.random() < p; },
  npc(id){ return this.S.courtiers.find(c=>c.id===id) || this.S.harem.find(h=>h.id===id); },
  heir(id){ return this.S.heirs.find(h=>h.id===id); },

  attrLabel(k){
    return { weiyan:'威严', shouwan:'手腕', rende:'仁德', taolue:'韬略', jingshen:'精力', xinxing:'心性',
      gold:'国库', army:'军队', people:'民心', power_minister:'权臣', hougong:'后宫', zongshi:'宗室',
      loyal:'忠心', ambition:'野心', favor:'宠爱',
      zhi:'智', wu:'武', de:'德', dan:'胆' }[k] || k;
  },

  /* ─────── 数值结算 ─────── */
  applyDeltas(deltas, { silent=false } = {}) {
    const S = this.S, chips = [];
    for (const d of deltas) {
      const { k, v, r } = d;
      let label = this.attrLabel(k), shown = v, npcName = '', heirName = '';

      if (k.startsWith('npc:')) {
        const [, id, field] = k.split(':');
        const t = this.npc(id); if (!t) continue;
        t[field] = this.clamp((t[field]||0) + v);
        npcName = t.name;
        label = this.attrLabel(field);
      } else if (k.startsWith('heir:')) {
        const [, id, field] = k.split(':');
        const t = this.heir(id); if (!t) continue;
        t[field] = this.clamp((t[field]||0) + v);
        heirName = t.name;
        label = this.attrLabel(field);
      } else if (k.startsWith('flag_')) {
        this.S.flags[k.slice(5)] = v; continue;
      } else if (k === 'gold') {
        S.gold = Math.max(0, S.gold + v);
        shown = v;
      } else if (k === 'army') {
        S.army = Math.max(0, S.army + v);
      } else if (k === 'jingshen_extra') { continue;
      } else {
        S[k] = this.clamp((S[k]||0) + v);
      }

      if (!silent && v !== 0) {
        const prefix = npcName ? `${npcName}·` : (heirName ? `${heirName}·` : '');
        const unit = (k==='gold') ? '万两' : (k==='army' ? '万' : '');
        chips.push({ text:`${prefix}${label}${v>0?'+':''}${v}${unit}`, up:v>0, reason:r });
      }
    }
    if (!silent) UI.renderAll();
    return chips;
  },

  /* ─────── 开局 ─────── */
  startNewGame(info) {
    const S = this.S = this.newState();
    Object.assign(S, info);
    S.eraName = `${S.nianhao}`;
    // 背景加成
    const bg = DATA.backgrounds[S.bg];
    S.gold += bg.effect.gold || 0;
    S.army += bg.effect.army || 0;
    S.people += bg.effect.people || 0;
    S.power_minister += bg.effect.power_minister || 0;
    // 人物
    S.courtiers = JSON.parse(JSON.stringify(DATA.initialCourtiers));
    S.harem = JSON.parse(JSON.stringify(DATA.initialHarem));
    S.heirs = JSON.parse(JSON.stringify(DATA.initialHeirs));
    S.age = parseInt(S.age) || 20;
    this.evaluateStatus();
    this.save();
  },

  /* ─────── 回合：行动 ─────── */
  pickAction(idOrText) {
    const S = this.S;
    if (S.dead || S.pendingEvent) return;
    let id = null;

    if (/^\d{1,2}$/.test(String(idOrText).trim())) {
      id = parseInt(idOrText);
    } else {
      const t = String(idOrText).trim();
      const byName = DATA.actions.find(a=>a.name===t);
      if (byName) id = byName.id;
      else {
        const mapped = DATA.freeActionMap.find(m=>m.words.some(w=>t.includes(w)));
        if (mapped) id = mapped.id;
        else { this.playFreeDerivative(t); return; }
      }
    }
    if (!DATA.actions.find(a=>a.id===id)) { UI.toast('该行动无法执行，请从可做之事里选择。'); return; }
    this.runAction(id);
  },

  runAction(id) {
    const S = this.S, act = DATA.actions.find(a=>a.id===id);

    // 精力预检
    if (act.energy < 0 && S.jingshen + act.energy < -10) {
      UI.pushCard('sys', '你已精疲力竭，实在无法支撑这项行动了。（精力过低，请先修养）');
      return;
    }

    const story = this.rand(DATA.actionStories[id]);
    const chips = this.applyDeltas([{k:'jingshen', v:act.energy, r: act.energy<0?'行动耗神':'静养回神'}, ...story.deltas]);

    // 特殊处理：批阅奏折可调阅国史 / 修养得丹药后可能服丹
    let extra = '';
    if (id === 5 && S.history.length > 0 && this.chance(0.35)) {
      const h = this.rand(S.history);
      extra = `<div class="sc-head" style="margin-top:8px">📜 调阅国史 · ${h.era}帝本纪</div>先帝${h.name}，谥「${h.posthumous}」，在位${h.years}年。${h.summary}`;
    }
    if (S.flags.dan && !S.flags.danpoison && this.chance(0.25)) {
      S.flags.danpoison = true;
      extra += `<div class="sc-head" style="margin-top:8px">☠ 祸起丹药</div>你服下了那丸丹药。初时只觉燥热，继而五脏如焚——太医诊罢，面色惨白。`;
    }

    UI.pushActionCard(act.name, story.text + (extra||''), chips);

    S.pickedActions.push(id);
    S.actedThisTurn++;
    UI.renderAll();

    // 死亡即时判定（精力衰竭/丹毒）
    if (this.checkDeath()) return;

    if (S.actedThisTurn >= 3) {
      setTimeout(()=>this.triggerRandomEvent(), 350);
    } else {
      UI.toast(`本回合还可选择 ${3 - S.actedThisTurn} 项行动`);
    }
  },

  /* 自由衍生行动 */
  playFreeDerivative(text) {
    const S = this.S;
    if (text.length < 2) { UI.toast('请描述得更具体一些。'); return; }
    const cost = 5;
    if (S.jingshen - cost < -10) { UI.toast('你已精疲力竭，无力再为此事。（请先修养）'); return; }
    const chips = this.applyDeltas([
      {k:'jingshen', v:-cost, r:'衍生之举，亦耗心神'},
      {k:'shouwan', v:+1, r:'临机专断，手腕见长'},
    ]);
    UI.pushActionCard('临机专断',
      `你下了一道旨意：「${text}」。此事不在常例之内，六宫与朝堂揣摩圣意，各自观望。事虽办了，成效如何，还要再看。`,
      chips);
    S.pickedActions.push(0);
    S.actedThisTurn++;
    if (this.checkDeath()) return;
    if (S.actedThisTurn >= 3) setTimeout(()=>this.triggerRandomEvent(), 350);
    else UI.toast(`本回合还可选择 ${3 - S.actedThisTurn} 项行动`);
  },

  /* ─────── 回合：随机事件 ─────── */
  triggerRandomEvent() {
    const S = this.S;
    // 兵变特殊事件（萧破军野心过高）
    if (!S.flags.bingbianDone && !S.flags.bingbian) {
      const xiao = this.npc('xiaopojun');
      if (xiao && xiao.ambition >= 92 && this.chance(0.5)) {
        S.flags.bingbian = true;
        this.checkDeath();
        return;
      }
    }

    // 过滤可用事件
    let pool = DATA.events.filter(e=>{
      if (e.type==='皇嗣夺嫡') return S.heirs.length>=1 && S.year>=2;
      if (e.type==='藩王异动') return S.vassals.length>=1;
      return true;
    });
    const ev = JSON.parse(JSON.stringify(this.rand(pool)));
    ev.stamp = `${S.year}年${DATA.monthNames[S.month-1]}`;
    S.pendingEvent = ev;
    UI.pushEventCard(ev.title, ev.text, ev.hint);
    UI.setDockMode('event');
    UI.renderAll();
  },

  /* 处置随机事件 */
  resolveEvent(input) {
    const S = this.S, ev = S.pendingEvent;
    if (!ev) return;
    input = (input||'').trim();
    if (!input) { UI.toast('请写下你的处置，此事不可回避。'); return; }

    // 关键词判定
    let tendency = 'ignore', best = 0;
    for (const [t, words] of Object.entries(DATA.resolveKeywords)) {
      const score = words.filter(w=>input.includes(w)).length;
      if (score > best) { best = score; tendency = t; }
    }
    const oc = ev.outcomes[tendency] || ev.outcomes.ignore;

    UI.pushCard('narr', `<b>你的处置：</b>${input}`, '');
    const chips = this.applyDeltas(oc.deltas);
    UI.pushEventCard('处置结果', oc.text, null, chips);

    // 未了结判定：soft/ignore 处置有概率留尾巴
    const unresolved = (tendency==='soft' && this.chance(0.3)) || tendency==='ignore';
    if (unresolved) {
      S.unresolved.push({ title: ev.title, desc: ev.text.slice(0,42)+'……', months: 0, type: ev.type });
      UI.pushCard('sys', `⚠ 【${ev.title}】未能彻底了结，已记入未结事件，将持续发酵。`);
    }

    S.pendingEvent = null;
    UI.setDockMode('actions');
    UI.renderAll();

    if (this.checkDeath()) return;
    setTimeout(()=>this.nextMonth(), 500);
  },

  /* ─────── 月度结算 ─────── */
  nextMonth() {
    const S = this.S;
    S.turnCount++;
    S.month++; S.age += 0; // 年龄按年加
    if (S.month > 12) { S.month = 1; S.year++; S.age++; }
    S.actedThisTurn = 0; S.pickedActions = [];

    UI.pushDivider(`${S.eraName}${S.year}年 ${DATA.monthNames[S.month-1]}`);

    // 1) 皇嗣成长
    for (const h of S.heirs) {
      if (S.month === 1) {
        h.age++;
        if (h.age === 16) UI.pushCard('npc', `🎂 皇嗣${h.name}年已及笄（16岁），可择日册封储君、藩王，或留京另行安排。（在「教导皇嗣」中安排）`, '');
      }
    }

    // 2) 宗室过继新皇嗣（小概率，需玩家有行动触发更好——此处每年小概率）
    if (S.month === 3 && S.heirs.length < 4 && this.chance(0.5)) {
      this.addAdoptedHeir();
    }

    // 3) 藩王月度结算
    let fiefTax = 0;
    for (const v of S.vassals) {
      if (v.loyal > 70) fiefTax += v.tax;
      else if (v.loyal >= 50) fiefTax += Math.round(v.tax * 0.7);
      else fiefTax += Math.round(v.tax * 0.1);
      if (v.power > 80 && !v.warned) {
        v.warned = true;
        UI.pushCard('event', `⚠ 藩王警讯：${v.name}在封地${v.fief}势力已成（势力${v.power}），朝中已有「削藩之议」。`, '');
      }
      v.power = this.clamp(v.power + (v.loyal<50?2:0) + (this.chance(0.3)?1:0));
    }
    if (fiefTax > 0) {
      S.gold += fiefTax;
      UI.pushCard('sys', `藩王赋税解运入库 +${fiefTax}万两。`);
    }

    // 4) 未结事件发酵
    for (const u of S.unresolved) {
      u.months++;
      if (u.months === 2) UI.pushCard('sys', `未结之事【${u.title}】仍在暗中发酵，朝野已有风议……`);
      if (u.months >= 3) {
        S.people = this.clamp(S.people - 2);
        S.power_minister = this.clamp(S.power_minister + 1);
        UI.pushCard('sys', `未结之事【${u.title}】发酵日深：民心-2、权臣+1。`);
      }
    }

    // 5) NPC 主动行为
    this.runNpcActions();

    // 6) 精力自然恢复少许 + 耗竭判定
    S.jingshen = this.clamp(S.jingshen + 4);
    if (S.jingshen <= 5) {
      UI.pushCard('sys', '⚠ 你已精力枯竭，太医令跪请节劳。若精力归零，恐有不测。');
    }

    // 7) 半年评估
    if (S.month % 6 === 1) this.evaluateStatus(true);

    // 8) 萧破军野心滋长
    const xiao = this.npc('xiaopojun');
    if (xiao && S.turnCount % 4 === 0 && xiao.ambition < 95) {
      xiao.ambition = this.clamp(xiao.ambition + 1);
    }

    UI.renderAll();
    this.save();
    this.checkDeath();
    if (!S.dead) UI.pushCard('sys', '新的一月开始。请选择本回合 3 项行动。');
  },

  addAdoptedHeir() {
    const S = this.S;
    const surname = this.rand(DATA.heirSurnames);
    const name = surname + this.rand(DATA.heirNames);
    const h = {
      id:'heir_'+Date.now(), name, gender:'女', age: Math.floor(Math.random()*4)+1, tag:'heir',
      origin:'宗室旁支之女，过继帝脉', foster:'待择养父',
      zhi:20+Math.floor(Math.random()*20), wu:20+Math.floor(Math.random()*20),
      de:20+Math.floor(Math.random()*20), dan:20+Math.floor(Math.random()*20),
      xinxing:25+Math.floor(Math.random()*20),
      status:'在京', statusText:'在京皇嗣',
      intro:'宗室新生之女，按祖制过继帝脉。', isNew:true,
    };
    S.heirs.push(h);
    UI.pushCard('npc', `👶 宗室来报：${surname}氏旁支新添一女，依祖制过继帝脉，赐名${name}，录入玉牒。你多了${S.heirs.length-1===0?'一位':'又一位'}皇嗣。`, '');
  },

  runNpcActions() {
    const S = this.S;
    const pool = DATA.npcActions.filter(a=>{
      if (a.cond==='xiao_alive') return !!this.npc('xiaopojun');
      if (a.cond==='harem_multi') return S.harem.filter(h=>!h.cold).length >= 2;
      return true;
    });
    // 加权随机 1-2 条
    const n = this.chance(0.6) ? 1 : 2;
    for (let i=0;i<n;i++){
      const a = this.rand(pool);
      const chips = this.applyDeltas(a.deltas);
      UI.pushNpcCard(a.text, chips);
    }
    // 后宫争宠小动作
    if (this.chance(0.3) && S.harem.length>1) {
      const a = this.rand(S.harem), b = this.rand(S.harem.filter(x=>x!==a));
      a.favor = this.clamp(a.favor + 2); b.favor = this.clamp(b.favor - 2);
    }
  },

  /* ─────── 册封（立储/封藩，经「教导皇嗣」后的扩展指令） ─────── */
  crownHeir(heirId, mode) {
    const S = this.S, h = this.heir(heirId);
    if (!h || h.age < 16) { UI.toast('皇嗣需年满 16 方可册封。'); return false; }
    if (mode === '储君') {
      if (S.heirs.some(x=>x.status==='储君')) { UI.toast('已有储君在册，需先废储。'); return false; }
      h.status = '储君'; h.statusText = '皇太女（储君）';
      const chips = this.applyDeltas([
        {k:'people', v:+5, r:'立嫡定储，国本安稳'},{k:'zongshi', v:+5, r:'宗室认可'}]);
      UI.pushEventCard('立储大典', `你于大朝会上颁诏，册立${h.name}为皇太女，开东宫、设属官。百官伏拜，国本遂定。`, null, chips);
      return true;
    }
    if (mode === '藩王') {
      const fief = this.rand(['陇西','云中','江南','岭南','代郡','蜀中']);
      h.status = '藩王'; h.statusText = `藩王（封地${fief}）`;
      const v = { id:h.id, name:h.name, fief, loyal:65, power:35, tax:15, warned:false };
      S.vassals.push(v);
      S.heirs = S.heirs.filter(x=>x!==h);
      UI.pushEventCard('分封藩王', `你颁诏分封${h.name}于${fief}，赐府兵三千、食邑万户。就藩之日，车马连绵十里。`, null,
        this.applyDeltas([{k:'zongshi', v:+3, r:'分封建藩，宗室得所'}]));
      return true;
    }
    return false;
  },

  /* ─────── 帝王状态评估 ─────── */
  evaluateStatus(announce=false) {
    const S = this.S;
    const rule = DATA.statusRules.find(r=>r.cond(S));
    const changed = rule.name !== S.statusName;
    S.statusName = rule.name; S.statusDesc = rule.desc;
    if (announce && changed) {
      UI.pushCard('sys', `📊 半年朝局评估：如今世人眼中的你，是一位【${rule.name}】——${rule.desc}。`);
    }
  },

  /* ─────── 死亡 / 结局判定 ─────── */
  checkDeath() {
    const S = this.S;
    if (S.dead) return true;
    const rule = DATA.deathRules.find(r=>r.cond(S));
    if (!rule) return false;

    S.dead = true;
    const hasHeir = S.heirs.some(h=>h.status==='储君') || S.heirs.some(h=>h.age>=0);
    const canInherit = rule.type==='inherit' && (S.heirs.some(h=>h.status==='储君') || S.heirs.length>0);

    if (rule.type==='terminal' || !canInherit) {
      this.doTerminalEnding(rule);
    } else {
      this.doInheritance(rule);
    }
    this.save();
    return true;
  },

  posthumousFor(rule){
    const S = this.S;
    if (rule.posthumous) return this.rand(rule.posthumous);
    return S.rende>=60?'文':(S.weiyan>=70?'武':'平');
  },

  buildSummary() {
    const S = this.S;
    const goods=[], bads=[];
    if (S.people>=60) goods.push('爱惜民力，民心归附'); else if (S.people<=25) bads.push('民心尽失，怨声载道');
    if (S.gold>=600) goods.push('国库充盈，府库殷实'); else if (S.gold<=150) bads.push('府库空虚，用度窘迫');
    if (S.power_minister<=40) goods.push('裁抑权臣，乾纲独断'); else if (S.power_minister>=75) bads.push('权臣坐大，朝纲不振');
    if (S.rende>=65) goods.push('仁德广播，贤名远扬'); if (S.weiyan>=75&&S.people<40) bads.push('威刑过甚，朝野股栗');
    if (S.history.length>0) goods.push('承前启后，国祚绵延');
    return { goods, bads };
  },

  doTerminalEnding(rule) {
    const S = this.S;
    const post = this.posthumousFor(rule);
    const { goods, bads } = this.buildSummary();
    const level = goods.length > bads.length ? 'good' : (goods.length === bads.length ? 'mid' : 'bad');
    const years = (S.year - 1) + (S.generation-1)*0; // 本帝在位年数
    const record = {
      era:S.eraName, name:S.name, posthumous:post, years:Math.max(1,S.year),
      summary:`${goods.join('；')||'无可称道者'}。${bads.length?'然'+bads.join('；')+'。':''}`,
    };
    S.history.push(record);
    this.save();
    UI.showEnding({
      type:'terminal', title:rule.name, scene:rule.scene,
      posthumous:post, epitaph:DATA.epitaph[level],
      years:Math.max(1,S.year), goods, bads, generation:S.generation,
      history:S.history,
    });
  },

  doInheritance(rule) {
    const S = this.S;
    const post = this.posthumousFor(rule);
    const { goods, bads } = this.buildSummary();
    S.history.push({
      era:S.eraName, name:S.name, posthumous:post, years:Math.max(1,S.year),
      summary:`${goods.join('；')||'守成而已'}。${bads.length?'然'+bads.join('；')+'。':''}`,
    });

    // 选继承人
    let heir = S.heirs.find(h=>h.status==='储君') || S.heirs.slice().sort((a,b)=>b.age-a.age)[0];
    UI.showSuccession({ rule, post, heir, goods, bads });
  },

  /* 执行传承（玩家点击后） */
  proceedSuccession(heirId, regent=false) {
    const S = this.S;
    let h = this.heir(heirId);
    if (!h) { UI.toast('继承人无效。'); return; }

    const oldGen = S.generation;
    const young = h.age < 16;

    // 新帝属性换算
    const nw = Math.round(h.wu*0.6 + h.dan*0.4);
    const ns = Math.round(h.zhi*0.7 + h.xinxing*0.3);
    const nr = Math.round(h.de*0.8 + h.xinxing*0.2);
    const nt = Math.round(h.zhi*0.4 + h.wu*0.6);
    const nj = Math.round(40 + h.dan*0.2);
    const nx = h.xinxing;

    // 世代累积
    const lastRecord = S.history[S.history.length-1];
    let peopleAdj = 0, zongshiAdj = 0, note = '';
    const good = /文|景|惠/.test(lastRecord.posthumous);
    const bad = /厉|荒|哀|献|闵/.test(lastRecord.posthumous);
    if (good) { peopleAdj = 5; zongshiAdj = 5; note = '先帝余荫犹在，新帝民心+5、宗室+5。'; }
    if (bad)  { peopleAdj = -8; note = '先帝失德，民间流言四起，新帝民心-8。'; }

    // 保留国力
    const keep = { gold:S.gold, army:S.army, power_minister:S.power_minister, hougong:20, zongshi:S.zongshi };
    const oldHarem = S.harem;

    // 重置为新一代
    S.generation++;
    S.year = 1; S.month = 1; S.eraName = `${S.nianhao}·${['','二','三','四','五','六','七','八','九','十'][S.generation]||S.generation}世`;
    S.name = h.name; S.age = h.age;
    S.weiyan=nw; S.shouwan=ns; S.rende=nr; S.taolue=nt; S.jingshen=nj; S.xinxing=nx;
    S.gold=keep.gold; S.army=keep.army; S.power_minister=keep.power_minister; S.hougong=keep.hougong;
    S.people = this.clamp(S.people + peopleAdj);
    S.zongshi = this.clamp(keep.zongshi + zongshiAdj);
    S.dead=false; S.pendingEvent=null; S.actedThisTurn=0; S.pickedActions=[];
    S.flags={}; S.unresolved = S.unresolved.slice(0,2); // 旧案部分延续

    // 后宫更替
    S.harem = [];
    // 其余皇嗣转宗室
    S.heirs = S.heirs.filter(x=>x.id!==h.id).map(x=>({...x, status:'宗室', statusText:'宗室'+(x.gender==='女'?'长公主':'亲王')}));
    S.heirs = S.heirs.filter(x=>x.status==='宗室');

    if (young) {
      S.power_minister = this.clamp(S.power_minister + 10);
      S.weiyan = this.clamp(S.weiyan - 5);
      UI.pushCard('event', `👑 主少国疑：新帝${S.name}年仅${S.age}岁，由${regent?'皇太后临朝':'辅政大臣'}辅政。权臣势力+10、威严-5，朝局进入微妙时期。`, '');
    }

    this.evaluateStatus();
    this.save();

    UI.enterGame();
    UI.pushDivider(`改元 · ${S.eraName}元年`);
    UI.pushCard('narr',
      `<b>大行皇帝谥「${lastRecord.posthumous}」，本纪已入国史。</b><br>` +
      `新帝${S.name}即位于柩前，改元大赦。先帝留下的国库、军队、民心、朝局，尽数落在这副年轻的肩膀上。${note}<br>` +
      `旧臣尚在，旧案未消——属于${S.name}的时代，开始了。`, '');
    UI.renderAll();
  },

  /* ─────── 存档 ─────── */
  save(){ try{ localStorage.setItem(SAVE_KEY, JSON.stringify(this.S)); }catch(e){} },
  load(){ try{ const s = localStorage.getItem(SAVE_KEY); if(!s) return false; this.S = JSON.parse(s); return true; }catch(e){ return false; } },
  clearSave(){ localStorage.removeItem(SAVE_KEY); },
  hasSave(){ return !!localStorage.getItem(SAVE_KEY); },
};
