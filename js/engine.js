/* ═══════════ 帝王模拟器 · 游戏引擎 ═══════════ */

const SAVE_KEY = 'emperor_sim_save_v1';
const SAVE_CODE_TAG = 'EMPSAVE1';   // 存档码前缀（版本标识）

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
      busy:false, pendingPicker:null, currentScene:null, currentPetition:null, npcQueue:[],
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
      shame:'羞耻', resolve:'心气', attach:'情分',
      zhi:'智', wu:'武', de:'德', dan:'胆' }[k] || k;
  },

  /* ─────── 数值结算 ─────── */
  applyDeltas(deltas, { silent=false } = {}) {
    const S = this.S, chips = [];
    for (const d of deltas) {
      const { k, v, r } = d;
      let label = this.attrLabel(k), shown = v, npcName = '', heirName = '';

      if (k.startsWith('harem_add:')) {
        // 纳入后宫：新增成员（卡片由 addHaremMember 推送）
        const m = this.addHaremMember(k.split(':')[1]);
        if (m && !silent) chips.push({ text:`${m.name}·封${m.rank}`, up:true, reason:r });
        continue;
      } else if (k.startsWith('npc_member:')) {
        // 指向当前场景对象（新人剧情用）
        const field = k.split(':')[1];
        const id = (S.currentScene||{}).memberId;
        const t = id ? this.npc(id) : null; if (!t) continue;
        t[field] = this.clamp((t[field]||0) + v);
        npcName = t.name;
        label = this.attrLabel(field);
      } else if (k.startsWith('npc:')) {
        const [, id, field] = k.split(':');
        const t = this.npc(id); if (!t) continue;
        t[field] = this.clamp((t[field]||0) + v);
        npcName = t.name;
        label = this.attrLabel(field);
      } else if (k.startsWith('heir:') || k.startsWith('_heir:')) {
        const parts = k.split(':');
        let id, field;
        if (k.startsWith('_heir:')) { id = (S.currentScene||{}).heirId; field = parts[1]; }
        else { id = parts[1]; field = parts[2]; }
        const t = this.heir(id) || S.heirs[0]; if (!t) continue;
        t[field] = this.clamp((t[field]||0) + v);
        heirName = t.name;
        label = this.attrLabel(field);
      } else if (k.startsWith('flirt:')) {
        // 廷臣暧昧线推进：flirt:<id>:<阶段>
        const [, id, stage] = k.split(':');
        const t = this.npc(id); if (!t) continue;
        const prev = t.flirtState || 'none';
        t.flirtState = stage;
        if (!silent && stage !== prev) {
          const txt = DATA.flirtStateText[stage] || stage;
          chips.push({ text:`${t.name}·${txt}`, up:stage!=='refused', reason:r });
        }
        continue;
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
    if (S.busy) { UI.toast('请先完成当前的决断。'); return; }
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

    // 场景化行动：演到该拍板处停下，等玩家决定
    const def = DATA.scenes && DATA.scenes[id];
    if (def && (def.always || !DATA.actionStories[id] || this.chance(0.3))) {
      this.startScene(id, def);
      return;
    }

    // 即时行动（巡营/批阅奏折/修养/祭祀）
    const story = this.rand(DATA.actionStories[id]);
    const chips = this.applyDeltas([{k:'jingshen', v:act.energy, r: act.energy<0?'行动耗神':'静养回神'}, ...story.deltas]);

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

    if (this.checkDeath()) return;

    if (S.actedThisTurn >= 3) {
      setTimeout(()=>this.triggerRandomEvent(), 350);
    } else {
      UI.toast(`本回合还可选择 ${3 - S.actedThisTurn} 项行动`);
    }
  },

  /* ─────── 场景化决策 ─────── */
  startScene(id, def) {
    const S = this.S;
    if (def.picker) {
      const p = def.picker(S);
      if (!p.options.length) { UI.pushCard('sys', '眼下无人可往、无事可办。'); return; }
      S.busy = true;
      S.pendingPicker = { actionId:id, options:p.options };
      UI.pushActionCard(DATA.actions.find(a=>a.id===id).name, p.text, null);
      UI.showChoices(p.options.map(o=>({label:o.label})),
        i=>this.pickSceneTarget(i),
        t=>this.pickSceneTargetFree(t));
      UI.setDockMode('choices');
      UI.renderAll();
    } else {
      const pool = def.list.filter(s=>!s.cond || s.cond(S));
      if (!pool.length) { UI.pushCard('sys', '今日无甚要紧事。'); return; }
      this.presentScene(id, this.rand(pool), null);
    }
  },

  pickSceneTarget(i) {
    const S = this.S, pk = S.pendingPicker; if (!pk) return;
    S.pendingPicker = null;
    const opt = pk.options[i];
    const def = DATA.scenes[pk.actionId];
    if (def.poolByHeir) {
      this.presentScene(pk.actionId, this.rand(def.pool._heir), opt.key);
      return;
    }
    let plist = def.pool[opt.key];
    if (!plist && pk.actionId === 4) {
      // 新人：按 persona 匹配专属剧情池
      const hm = S.harem.find(h=>h.id===opt.key);
      if (hm && hm.persona) plist = def.pool['_persona:'+hm.persona];
    }
    let courtier = null, chosen = null;
    if (String(opt.key).startsWith('court:')) {
      // 廷臣暧昧线：按性格 + 当前阶段取专属剧情，再套上这个人的名字
      courtier = this.npc(opt.key.slice(6));
      if (courtier) {
        const pool = this.courtFlirtPool(courtier);
        if (pool && pool.length) { chosen = this.fillScene(this.rand(pool), courtier); plist = [chosen]; }
      }
    }
    if (!plist || !plist.length) {
      S.busy = false;
      UI.pushCard('sys', '今夜不巧，那边宫门已闭，你折返了回去。');
      UI.setDockMode('actions'); UI.renderAll();
      return;
    }
    this.presentScene(pk.actionId, chosen || this.rand(plist), null,
      pk.actionId===4 ? opt.key : (courtier ? courtier.id : null));
  },

  /* ═══════════ 科举取士 ═══════════ */
  /* 生成一榜进士：各有性格原型、籍贯家世，以及与朝中旧臣的关系 */
  rollJinshi(n) {
    const S = this.S, K = DATA.keju;
    const keys = Object.keys(K.archetypes);
    const used = new Set(S.courtiers.map(c=>c.name));
    const out = [];
    for (let i=0;i<n;i++) {
      const persona = this.rand(keys);
      const arch = K.archetypes[persona];
      let surname = this.rand(K.surnames), name = this.rand(K.maleNames);
      let guard = 0;
      while (used.has(surname+name) && guard++ < 40) { surname = this.rand(K.surnames); name = this.rand(K.maleNames); }
      used.add(surname+name);
      // 与旧臣的关系：孤寒者无靠山，其余各依其类
      const seniors = S.courtiers.filter(c=>c.tag==='court' && c.persona && c.persona!=='neishi');
      const tiePool = K.ties.filter(t=> t.type!=='hanmen' ? seniors.length>0 : true);
      const tie = this.rand(tiePool);
      const target = tie.type==='hanmen' ? null : this.rand(seniors);
      out.push({
        id:'js_'+Date.now().toString(36)+i+Math.floor(Math.random()*99),
        name: surname+name, surname, gender:'男',
        age: 19 + Math.floor(Math.random()*14),
        role: arch.role, office: arch.office, persona,
        trait: arch.trait, origin: arch.origin,
        region: this.rand(K.regions),
        family: this.rand(K.family),
        tie: { type:tie.type, label:tie.label, note:tie.note, to: target?target.id:null,
               text: tie.make(surname+name, target || {name:'陛下'}) },
        tag:'court', isJinshi:true, jinshiYear:S.year, flirtState:'none',
        ...JSON.parse(JSON.stringify(arch.base)),
      });
    }
    return out;
  },

  maybeKeju() {
    const S = this.S, K = DATA.keju;
    if (!K || S.dead) return false;
    if (S.year % K.interval !== 0 || S.month !== K.month) return false;
    if (S.flags['keju_'+S.year]) return false;
    S.flags['keju_'+S.year] = 1;
    const cands = this.rollJinshi(3 + Math.floor(Math.random()*3));
    S.pendingKeju = { cands, zhuangyuan:null };
    S.busy = true;
    const list = cands.map((c,i)=>
      `<div class="sc-head">${i+1}. ${c.name} · ${c.age}岁 · ${c.region}${c.family.label}</div>` +
      `${c.origin}，${c.trait}。<br>${c.tie.text}`
    ).join('<br><br>');
    UI.pushCard('narr',
      `<b>📜 春闱放榜</b>（${S.year}年三月）<br>礼部呈上这一科的殿试名录，进士若干，各人底细皆录于后。<br><br>${list}` +
      `<br><br><div class="sc-head">谁来当这一科的状元？</div>状元入翰林，前程最宽；其余分授各部。你点谁，谁便记你这一份恩。`);
    UI.showChoices(
      cands.map(c=>({ label:`钦点状元 · ${c.name}（${c.trait}）`, desc:`${c.region} · ${c.tie.label}` })),
      i => this.kejuPickZhuangyuan(i),
      t => this.kejuPickFree(t));
    UI.setDockMode('choices'); UI.renderAll();
    return true;
  },

  kejuPickFree(text) {
    const S = this.S, pk = S.pendingKeju; if (!pk) return;
    let best = -1, bs = 0;
    pk.cands.forEach((c,i)=>{ if (text.includes(c.name)) { best=i; bs=99; } });
    if (best < 0) {
      pk.cands.forEach((c,i)=>{
        const s = [c.region, c.trait.slice(0,2), c.family.label].filter(w=>text.includes(w)).length;
        if (s > bs) { bs = s; best = i; }
      });
    }
    if (best < 0) best = Math.floor(Math.random()*pk.cands.length);
    this.kejuPickZhuangyuan(best, `「${text}」`);
  },

  kejuPickZhuangyuan(i, labelText) {
    const S = this.S, pk = S.pendingKeju; if (!pk) return;
    const zy = pk.cands[i];
    pk.zhuangyuan = zy.id;
    if (labelText) UI.pushCard('narr', `<b>你的意思：</b>${labelText}`, '');
    else UI.pushCard('narr', `<b>你的钦点：</b>状元 ${zy.name}`, '');

    // 第二步：取士规模
    const scene = { noTurn:true, text:'殿试已毕，接下来是取士的数目。礼部把两份清单都摆在了御案上。',
      choices:[
        { label:'广取人才：一榜尽录，另恩科加取十人', keys:['广','尽录','加取','多'],
          result:{ text:`你朱笔一挥，一榜尽录，又开恩科加取十人。<br>捷报传出，天下读书人欢呼雀跃，都说陛下右文。<br>只是吏部随后呈上的俸册叫人皱眉：这一科新官的俸禄，一年要多支${S.gold>400?'八':'五'}万余两。<br>而其中有个叫<b>${zy.name}</b>的年轻人，站在新科进士的最前排，把你的名字念了三遍。`,
            deltas:[{k:'people',v:+5,r:'右文之主，士林归心'},{k:'gold',v:-18,r:'冗官俸禄'},
              {k:'power_minister',v:+2,r:'新官各投其主'},{k:'shouwan',v:+1,r:'恩出于上'},
              {k:'npc:'+zy.id+':loyal',v:+6,r:'钦点之恩'}] } },
        { label:'从严取士：只留才学最优者三人', keys:['严','三人','少','精简'],
          result:{ text:`你砍去了大半名录，只留三人。<br>落第者怨声载道，有人把落卷贴在了贡院墙上，说主考有私。<br>但留下来的三个，确实都是真才。<b>${zy.name}</b>捧着敕牒退出去时，手指把纸边都攥皱了。<br>吏部暗暗松了口气：今年的俸册，好看多了。`,
            deltas:[{k:'people',v:-2,r:'落第者怨'},{k:'gold',v:+5,r:'省下冗俸'},
              {k:'shouwan',v:+2,r:'铨选得宜'},{k:'npc:'+zy.id+':loyal',v:+4,r:'脱颖而出'}] } },
        { label:'照顾门第：世家子弟优先，以安其心', keys:['门第','世家','优先','照顾'],
          result:{ text:`你把世家子弟往前排了排。<br>朝中几家大族当夜就递了谢表，措辞恭顺得近乎谄媚。可第二天，御史台的折子也到了——有人参你「以门第取人，塞寒门之路」。<br><b>${zy.name}</b>是否真有才学，反倒没人提了。`,
            deltas:[{k:'power_minister',v:+6,r:'世族感恩，势力渐张'},{k:'people',v:-4,r:'寒门失望，物议不平'},
              {k:'weiyan',v:-2,r:'取士不公之名'},{k:'gold',v:+10,r:'世家报效'}] } },
      ],
      free:{ text:'你按部就班点了名录，没有多取，也没有多砍。这一科平平淡淡地过去了。',
        deltas:[{k:'shouwan',v:+1,r:'循例而行'}] } };
    this.presentScene('keju', scene, null, null);
  },

  /* 科举收尾：进士入朝，关系生效 */
  kejuFinish() {
    const S = this.S, pk = S.pendingKeju; if (!pk) return;
    S.pendingKeju = null; S.busy = false;
    const zy = pk.cands.find(c=>c.id===pk.zhuangyuan) || pk.cands[0];
    const lines = [];
    pk.cands.forEach(c=>{
      c.loyal = this.clamp((c.loyal||50) + (c.id===zy.id ? 0 : -2));
      if (c.id === zy.id) { c.role = '翰林修撰（状元）'; c.office = '翰林院'; }
      S.courtiers.push(c);
      lines.push(`<b>${c.name}</b>，${c.age}岁，${c.region}人，授${c.role}${c.id===zy.id?'（<b>状元</b>）':''}`);
    });
    // 关系生效：座师/同乡/举荐/姻亲 → 旧官受益；政敌 → 旧官受损
    const tieEffects = [];
    pk.cands.forEach(c=>{
      const senior = c.tie.to ? this.npc(c.tie.to) : null;
      if (!senior) return;
      if (c.tie.type === 'zhengdi') {
        senior.loyal = this.clamp((senior.loyal||50) - 3);
        tieEffects.push(`${senior.name}得知${c.name}在策论里驳他，冷笑了半晌，什么也没说。`);
      } else {
        const gain = c.id===zy.id ? 6 : 3;
        senior.loyal = this.clamp((senior.loyal||50) + gain);
        senior.ambition = this.clamp((senior.ambition||30) + (c.tie.type==='shicheng'?3:1));
        tieEffects.push(`${senior.name}与${c.name}有${c.tie.label}之谊，朝中又多了一层牵扯。`);
      }
    });
    UI.pushCard('npc', `🎓 <b>新科入朝</b>：${lines.join('；')}。<br>` +
      (tieEffects.length ? tieEffects.join('<br>') + '<br>' : '') +
      `日后召见，他们便在「召见大臣」之列。`);
    this.save();
    UI.setDockMode('actions'); UI.renderAll();
  },

  /* 廷臣被调戏：按性格原型出专属剧情。
     soft = 言语轻佻点到为止；hard = 明示所求、以势相压 */
  courtTeaseOf(c, text) {
    const lib = DATA.courtTease && DATA.courtTease[c.persona];
    if (!lib) return null;
    const hardWords = DATA.courtTeaseHardWords || [];
    const t = String(text||'');
    const hard = hardWords.some(w=>t.includes(w));
    const raw = hard ? (lib.hard||lib.soft) : (lib.soft||lib.hard);
    if (!raw) return null;
    const r = this.fillScene(raw, c);
    if (!c.flirtState || c.flirtState === 'none' || c.flirtState === 'approach') {
      r.deltas = (r.deltas||[]).concat([{ k:'flirt:'+c.id+':'+(hard?'probe':'approach'), v:1, r:hard?'话已挑明':'你已试探' }]);
    }
    return r;
  },

  /* 廷臣的终局：有人撑不住，会走到那一步 */
  checkCourtierEnds() {
    const S = this.S;
    for (const c of S.courtiers) {
      if (!c.persona || c.ended) continue;
      const end = (DATA.courtierEnds||{})[c.persona];
      if (!end || !end.cond(c)) continue;
      c.ended = true;
      const t = this.fillTpl(end.text, c);
      const chips = this.applyDeltas(end.deltas.map(d=>({...d, k:this.fillTpl(d.k, c)})));
      UI.pushCard('narr', `<div class="sc-head">⚫ ${this.fillTpl(end.title, c)}</div>${t}`, chips);
      // 从朝班中除名
      c.gone = true;
      UI.pushCard('sys', `${c.name}自此不在朝班之中。`);
    }
  },

  /* 廷臣暧昧线：按当前状态决定演到哪一段 */
  courtFlirtPool(c) {
    const lib = DATA.courtFlirt[c.persona];
    if (!lib) return null;
    const stage = { none:'talk', approach:'probe', probe:'press' }[c.flirtState||'none'] || 'later';
    return lib[stage] || lib.later || lib.talk;
  },

  pickSceneTargetFree(text) {
    const S = this.S, pk = S.pendingPicker; if (!pk) return;
    let best = -1, bs = 0;
    pk.options.forEach((o, i)=>{
      const words = o.label.replace(/[·（）()]/g,' ').split(/\s+/).filter(w=>w.length>=2);
      const s = words.filter(w=>text.includes(w)).length;
      if (s > bs) { bs = s; best = i; }
    });
    if (best < 0) {
      // 按人物称呼匹配（如「去皇后宫里坐坐」「找裴镜」）
      const npcId = this.sceneNpcId(text);
      if (npcId) {
        const n = this.npc(npcId);
        if (n) {
          const idx = pk.options.findIndex(o=>o.label.includes(n.name));
          if (idx >= 0) best = idx;
        }
      }
    }
    if (best >= 0) { this.pickSceneTarget(best); return; }
    S.pendingPicker = null; S.busy = false;
    UI.pushCard('narr', `<b>你的意思：</b>${text}`, '');
    UI.pushCard('sys', '你没拿定主意，在廊下站了一会儿，回宫了。');
    UI.setDockMode('actions'); UI.renderAll();
  },

  presentScene(actionId, scene, heirId, memberId) {
    const S = this.S;
    S.busy = true;
    S.currentScene = { actionId, scene, heirId, memberId: memberId||null, noTurn: !!scene.noTurn };
    const text = typeof scene.text === 'function' ? scene.text(S) : scene.text;
    const actName = (DATA.actions.find(a=>a.id===actionId)||{name:'朝政'}).name;
    UI.pushActionCard(actName, text, null);
    const choices = typeof scene.choices === 'function' ? scene.choices(S) : scene.choices;
    UI.showChoices(choices.map(c=>({label:c.label, desc:c.desc})),
      i=>this.resolveSceneChoice(i),
      t=>this.resolveSceneFree(t));
    UI.setDockMode('choices');
    UI.renderAll();
  },

  resolveSceneChoice(i) {
    const S = this.S, cs = S.currentScene; if (!cs) return;
    const choices = typeof cs.scene.choices==='function' ? cs.scene.choices(S) : cs.scene.choices;
    const c = choices[i];
    this.finishScene(c.result, c.label);
  },

  resolveSceneFree(text) {
    const S = this.S, cs = S.currentScene; if (!cs) return;
    const choices = typeof cs.scene.choices==='function' ? cs.scene.choices(S) : cs.scene.choices;
    let best = null, bs = 0;
    for (const c of choices) {
      const s = (c.keys||[]).filter(w=>text.includes(w)).length;
      if (s > bs) { bs = s; best = c; }
    }
    // 强匹配（≥2个关键词，或极短的明确指令）才视为选择该项；
    // 否则走语义解析，按你的措辞生成专属结果
    if (best && (bs >= 2 || (bs >= 1 && text.length <= 6))) {
      this.finishScene(best.result, `「${text}」`);
      return;
    }
    const sceneText = typeof cs.scene.text==='function' ? cs.scene.text(S) : cs.scene.text;
    const npcId = this.sceneNpcId(sceneText) || cs.memberId;
    // 调戏廷臣：按对方性格原型演专属剧情，而非套用通用模板
    const target = npcId ? this.npc(npcId) : null;
    const intents = this.analyzeIntent(text);
    const wantsFlirt = intents.length && (intents[0].name === 'tease' || intents[0].name === 'affection');
    if (target && wantsFlirt && target.persona) {
      const r = this.courtTeaseOf(target, text);
      if (r) { this.finishScene(r, `「${text}」`); return; }
    }
    const kind = cs.actionId===11 ? 'heir' : 'scene';
    const dyn = this.interpretFree(text, { npcId, kind });
    this.finishScene(dyn, `「${text}」`);
  },

  /* ─────── 性格原型模板：把 {name}/{role}/{surname}/{id} 填成具体的人 ─────── */
  fillTpl(t, c) {
    if (typeof t !== 'string' || !c) return t;
    return t.replace(/\{name\}/g, c.name)
            .replace(/\{role\}/g, c.role || '')
            .replace(/\{surname\}/g, (c.surname || String(c.name||'').charAt(0)))
            .replace(/\{id\}/g, c.id);
  },

  fillScene(scene, c) {
    const out = JSON.parse(JSON.stringify(scene));
    const walk = o => {
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o && typeof o === 'object') {
        for (const k of Object.keys(o)) {
          const v = o[k];
          if (typeof v === 'string' && (k==='text'||k==='r'||k==='label'||k==='k')) o[k] = this.fillTpl(v, c);
          else walk(v);
        }
      }
    };
    walk(out);
    return out;
  },

  finishScene(result, labelText) {
    const S = this.S, cs = S.currentScene; if (!cs) return;
    const act = DATA.actions.find(a=>a.id===cs.actionId) || { name:'春闱', energy:0 };
    if (labelText) UI.pushCard('narr', `<b>你的决定：</b>${labelText}`, '');
    const rtext = typeof result.text==='function' ? result.text(S) : result.text;
    const energy = cs.noTurn ? [] : [{k:'jingshen', v:act.energy, r:act.energy<0?'行动耗神':'静养回神'}];
    const chips = this.applyDeltas([...energy, ...(result.deltas||[])]);
    UI.pushActionCard(`${act.name} · 结果`, rtext, chips);
    S.currentScene = null; S.busy = false;
    if (cs.noTurn) {   // 科举等流程性决策不消耗回合行动
      if (cs.actionId === 'keju') this.kejuFinish();
      else { UI.setDockMode('actions'); UI.renderAll(); }
      this.checkDeath();
      return;
    }
    S.pickedActions.push(cs.actionId);
    S.actedThisTurn++;
    UI.setDockMode('actions');
    UI.renderAll();
    if (this.checkDeath()) return;
    if (S.actedThisTurn >= 3) setTimeout(()=>this.triggerRandomEvent(), 350);
    else UI.toast(`本回合还可选择 ${3 - S.actedThisTurn} 项行动`);
  },

  /* ─────── 纳入后宫：良家郎君入宫 ─────── */
  addHaremMember(archId) {
    const S = this.S, arch = (DATA.haremArchetypes||{})[archId];
    if (!arch) return null;
    const avail = arch.names.filter(n=>!S.harem.some(h=>h.name===n));
    if (!avail.length) return null;
    const name = this.rand(avail);
    const m = {
      id:'hm_'+archId+'_'+Date.now()+Math.floor(Math.random()*99),
      name, gender:'男',
      age: arch.age[0] + Math.floor(Math.random()*(arch.age[1]-arch.age[0]+1)),
      rank: arch.rank, role: arch.rank, tag:'harem',
      trait: arch.trait, family: arch.family, intro: arch.intro,
      persona: arch.persona,
      favor: 30+Math.floor(Math.random()*12),
      ambition: 8+Math.floor(Math.random()*18),
      cold:false, isNew:true,
    };
    S.harem.push(m);
    S.hougong = this.clamp(S.hougong + 2);
    UI.pushCard('npc',
      `🌸 <b>新人入宫</b>：${m.name}，${m.age}岁，${arch.family}。${arch.intro}<br>` +
      `封为<b>${m.rank}</b>，拨宫人两名、月例从才人格。六宫的风，从此又变了一变。`, '');
    this.save();
    return m;
  },

  /* ─────── 自由批复语义解析 ─────── */
  /* 把玩家的话拆成意图（按强度排序） */
  analyzeIntent(text) {
    const res = [];
    for (const [name, words] of Object.entries(DATA.freeIntents.words)) {
      let score = 0;
      for (const w of words) if (text.includes(w)) score += w.length >= 2 ? 2 : 1;
      if (score > 0) res.push({ name, score });
    }
    // “不准”含“准”：拒绝与应允同时命中时，拒绝优先
    const r = res.find(x=>x.name==='refuse'), g = res.find(x=>x.name==='grant');
    if (r && g) r.score += 2;
    res.sort((a,b)=>b.score-a.score);
    return res;
  },

  /* 语气强度：从重/加倍→1.5x，酌情/减半→0.6x */
  intensityOf(text) {
    let m = 1;
    for (const w of DATA.freeIntents.boost) if (text.includes(w)) { m = 1.5; break; }
    for (const w of DATA.freeIntents.reduce) if (text.includes(w)) { m = Math.min(m, 0.6); break; }
    return m;
  },

  npcAttitudeField(npcId) {
    const p = this.npc(npcId);
    if (p && p.favor !== undefined) return 'favor';  // 后宫成员用宠爱
    return 'loyal';                                   // 朝臣用忠心
  },

  /* 从剧情文本里找涉及的人物（静态称呼表 + 当前在册的朝臣/后宫名） */
  sceneNpcId(text) {
    let found = null, pos = Infinity;
    const all = DATA.freeIntents.npcTitles.concat(
      (this.S ? this.S.harem.concat(this.S.courtiers) : []).map(p=>[p.name, p.id])
    );
    for (const [title, id] of all) {
      const i = String(text).indexOf(title);
      if (i >= 0 && i < pos) { pos = i; found = id; }
    }
    return found;
  },

  /* 核心：把自由批复解读为「专属结果 + 关联数值」 */
  interpretFree(text, ctx) {
    ctx = ctx || {};
    const intents = this.analyzeIntent(text);
    const mult = this.intensityOf(text);
    const top = intents[0] || null;
    const parts = [];
    const deltas = [];

    // 教导皇嗣：意图映射到皇嗣五维
    if (ctx.kind === 'heir') {
      const hm = DATA.freeIntents.heirMap;
      if (top && hm[top.name]) {
        parts.push(this.rand(hm[top.name].lines));
        for (const d of hm[top.name].deltas) deltas.push({...d, v: Math.round(d.v*mult)||d.v});
      } else {
        parts.push(this.rand(DATA.freeIntents.heirFallback));
        deltas.push({k:'_heir:zhi', v:+2, r:'耳提面命'}, {k:'_heir:xinxing', v:+1, r:'耳濡目染'});
      }
      return { text: parts.join(''), deltas };
    }

    if (top) {
      const spec = DATA.freeIntents.deltas[top.name];
      const field = ctx.npcId ? this.npcAttitudeField(ctx.npcId) : null;
      if (spec) {
        for (const d of spec({ npcId: ctx.npcId || null, field })) {
          const v = Math.round(d.v * mult);
          if (v !== 0) deltas.push({ k:d.k, v, r:d.r });
        }
      }
      const pool = DATA.freeIntents.lines[top.name];
      if (pool) parts.push(this.rand(pool));
      // 涉及人物时，按其性格给出反应（调戏有专属口径；新人按persona回退）
      if (ctx.npcId) {
        const person = this.npc(ctx.npcId) || {};
        let reacts = null;
        if (top.name === 'tease') {
          reacts = (DATA.freeIntents.teaseReacts||{})[ctx.npcId]
                || (person.persona ? DATA.freeIntents.teaseReacts['_'+person.persona] : null);
        }
        if (!reacts) {
          const pol = DATA.freeIntents.polarity[top.name] || 'neutral';
          reacts = ((DATA.freeIntents.reacts||{})[ctx.npcId]||{})[pol]
                || (person.persona ? (((DATA.freeIntents.personaReacts||{})[person.persona]||{})[pol]) : null);
        }
        if (reacts) parts.push(this.rand(reacts));
      }
    } else {
      parts.push(this.rand(DATA.freeIntents.lines.fallback));
      deltas.push({k:'shouwan', v:+1, r:'临机专断，自有主张'});
    }

    // 次级明确意图（如“处置之余，再加查访”），按半量结算
    const second = intents.slice(1).find(x=>x.score>=2 && DATA.freeIntents.addons[x.name]);
    if (second) {
      const add = DATA.freeIntents.addons[second.name];
      parts.push(add.text);
      for (const d of add.deltas) {
        const v = Math.round(d.v * 0.5 * mult);
        if (v !== 0) deltas.push({ k:d.k, v, r:d.r });
      }
    }
    return { text: parts.join(''), deltas };
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
      if (e.type==='艳遇') return S.harem.length<=8;
      return true;
    });
    const ev = JSON.parse(JSON.stringify(this.rand(pool)));
    ev.stamp = `${S.year}年${DATA.monthNames[S.month-1]}`;
    S.pendingEvent = ev;
    UI.pushEventCard(ev.title, ev.text, ev.hint);
    UI.buildEventQuick();
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
    const mult = this.intensityOf(input);

    UI.pushCard('narr', `<b>你的处置：</b>${input}`, '');
    // 主结果数值：按语气强度缩放（“从重/加倍”1.5x，“酌情/减半”0.6x）
    const mainDeltas = oc.deltas.map(d => mult===1 ? d : {...d, v:(Math.round(d.v*mult)||d.v)});
    let chips = this.applyDeltas(mainDeltas);

    // 附加意图：你的措辞里超出主倾向的明确安排（如从严之外又命查访）
    const covered = { tough:['punish','force'], soft:['lenient','grant','comfort'], investigate:['investigate'], ignore:['delay'] }[tendency];
    const extras = this.analyzeIntent(input)
      .filter(x=>!covered.includes(x.name) && DATA.freeIntents.addons[x.name])
      .slice(0,2);
    let extraText = '';
    for (const ex of extras) {
      const add = DATA.freeIntents.addons[ex.name];
      extraText += '<br>' + add.text;
      chips = chips.concat(this.applyDeltas(add.deltas.map(d=>({...d, v:(Math.round(d.v*0.5*mult)||d.v)}))));
    }

    UI.pushEventCard('处置结果', oc.text + extraText, null, chips);

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

    // 5) NPC 纯信息动向（无需决策）
    const news = DATA.npcNews.filter(a=>{
      let ok = false; try { ok = a.cond(S); } catch(e){ ok = false; }
      if (!ok) return false;
      // 动态文本（涉及具体人物）可能为 null，表示这一条此刻讲不出名目
      const t = typeof a.text==='function' ? a.text(S) : a.text;
      return !!t;
    });
    if (news.length && this.chance(0.7)) {
      const a = this.rand(news);
      const t = typeof a.text==='function' ? a.text(S) : a.text;
      const chips = this.applyDeltas(a.deltas);
      UI.pushNpcCard(t, chips);
    }
    // 后宫争宠小动作
    if (this.chance(0.3) && S.harem.length>1) {
      const a = this.rand(S.harem), b = this.rand(S.harem.filter(x=>x!==a));
      a.favor = this.clamp(a.favor + 2); b.favor = this.clamp(b.favor - 2);
    }

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

    // 9) 廷臣终局判定（有人撑不住了）
    this.checkCourtierEnds();

    UI.renderAll();
    this.save();
    if (this.checkDeath()) return;

    // 10) 春闱：三年一科，钦点状元、定取士规模
    if (this.maybeKeju()) return;

    // 6) NPC 请示队列（必须玩家批复，不得代为决断）
    const petitions = DATA.npcPetitions.filter(p=>p.cond(S));
    petitions.sort(()=>Math.random()-0.5);
    S.npcQueue = petitions.slice(0, this.chance(0.5) ? 1 : 2);
    setTimeout(()=>this.nextPetition(), 400);
  },

  /* NPC 请示：逐个呈递，玩家亲自批复 */
  nextPetition() {
    const S = this.S;
    if (!S.npcQueue || !S.npcQueue.length) {
      S.currentPetition = null; S.busy = false;
      UI.pushCard('sys', '新的一月开始。请选择本回合 3 项行动。');
      UI.setDockMode('actions');
      UI.renderAll();
      return;
    }
    const p = S.npcQueue[0];
    S.busy = true;
    S.currentPetition = p;
    UI.pushNpcCard(p.text, null);

    UI.showChoices(p.choices.map(c=>({label:c.label})),
      i => this.resolvePetitionChoice(i),
      t => this.resolvePetitionFree(t));
    UI.setDockMode('choices');
    UI.renderAll();
  },

  answerPetition(result, label) {
    const S = this.S;
    S.npcQueue.shift(); S.busy = false; S.currentPetition = null;
    UI.pushCard('narr', `<b>你的批复：</b>${label}`, '');
    const chips = this.applyDeltas(result.deltas || []);
    UI.pushNpcCard(result.text, chips);
    this.save();
    if (this.checkDeath()) return;
    setTimeout(()=>this.nextPetition(), 300);
  },

  resolvePetitionChoice(i) {
    const p = this.S.currentPetition; if (!p) return;
    this.answerPetition(p.choices[i].result, p.choices[i].label);
  },

  resolvePetitionFree(text) {
    const p = this.S.currentPetition; if (!p) return;
    let best = null, bs = 0;
    for (const c of p.choices) {
      const s = (c.keys||[]).filter(w=>text.includes(w)).length;
      if (s > bs) { bs = s; best = c; }
    }
    if (best && (bs >= 2 || (bs >= 1 && text.length <= 6))) {
      this.answerPetition(best.result, `「${text}」`);
      return;
    }
    const npcId = (DATA.freeIntents.petitionNpc||{})[p.id] || this.sceneNpcId(p.text);
    const dyn = this.interpretFree(text, { npcId, kind:'petition' });
    this.answerPetition(dyn, `「${text}」`);
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
  load(){
    try{
      const s = localStorage.getItem(SAVE_KEY); if(!s) return false;
      // 归一化：重置进行中的决策状态，避免读档后流程卡死
      this.S = this._normalizeSave(JSON.parse(s));
      return true;
    }catch(e){ return false; }
  },
  clearSave(){ localStorage.removeItem(SAVE_KEY); },
  hasSave(){ return !!localStorage.getItem(SAVE_KEY); },

  /* ═══════════ 存档搬运（跨设备） ═══════════
     存档写在 localStorage 里，只属于当前设备的当前浏览器。
     想换设备接着玩，就把存档「打包成一段存档码」带走，在新设备上导入。 */

  /* 导出用的纯净快照：倒回到最近一个「可继续」的节点，避免把半截流程带出去 */
  snapshot() {
    const plain = JSON.parse(JSON.stringify(this.S));
    plain.busy = false; plain.pendingPicker = null;
    plain.currentScene = null; plain.currentPetition = null; plain.npcQueue = [];
    // 若正卡在月末事件处置中：退回一步，让新设备能重新择一项行动、重新触发事件
    if (plain.pendingEvent) {
      plain.pendingEvent = null;
      plain.actedThisTurn = Math.max(0, (plain.actedThisTurn || 0) - 1);
      if (Array.isArray(plain.pickedActions) && plain.pickedActions.length > plain.actedThisTurn)
        plain.pickedActions = plain.pickedActions.slice(0, plain.actedThisTurn);
    }
    return plain;
  },

  /* 状态 → 存档码（优先 deflate-raw 压缩；压不了就退化成纯 base64，仍可导入） */
  async packSave() {
    const json = JSON.stringify(this.snapshot());
    const bytes = new TextEncoder().encode(json);
    if (typeof CompressionStream === 'function') {
      try {
        const packed = await this._deflate(bytes);
        const cand = SAVE_CODE_TAG + 'Z' + this._bytesToB64(packed);
        const back = await this.unpackSave(cand);   // 自检：解得回来才用它
        if (back && back.turnCount === this.S.turnCount) return cand;
      } catch (e) { /* 落到下面的纯 base64 */ }
    }
    return SAVE_CODE_TAG + 'P' + this._bytesToB64(bytes);
  },

  /* 存档码 → 状态对象（校验失败直接抛出，由调用方给出提示） */
  async unpackSave(code) {
    const t = String(code == null ? '' : code).trim();

    // 兼容直接粘贴的原始 JSON
    if (t.charAt(0) === '{') return this._normalizeSave(JSON.parse(t));

    const flat = t.replace(/\s+/g, '');
    if (flat.indexOf(SAVE_CODE_TAG) !== 0) throw new Error('这不像是一段存档码，请检查是否复制完整。');
    const mode = flat.charAt(SAVE_CODE_TAG.length);
    const payload = flat.slice(SAVE_CODE_TAG.length + 1);
    if (!payload) throw new Error('存档码是空的，请重新复制。');

    let bytes = this._b64ToBytes(payload);
    if (mode === 'Z') {
      if (typeof DecompressionStream !== 'function') throw new Error('当前浏览器打不开这种存档码，请换用存档文件导入。');
      bytes = await this._inflate(bytes);
    } else if (mode !== 'P') {
      throw new Error('存档码版本无法识别，可能来自更新的版本。');
    }
    return this._normalizeSave(JSON.parse(new TextDecoder().decode(bytes)));
  },

  /* 校验 + 归一化：补上缺失字段、清掉进行中的决策状态 */
  _normalizeSave(st) {
    if (!st || typeof st !== 'object') throw new Error('存档内容无法解析。');
    if (typeof st.turnCount !== 'number' || !st.name || typeof st.gold !== 'number')
      throw new Error('存档内容不完整或已损坏。');
    st.busy = false; st.pendingPicker = null;
    st.currentScene = null; st.currentPetition = null; st.npcQueue = [];
    if (st.pendingEvent) {
      st.pendingEvent = null;
      st.actedThisTurn = Math.max(0, (st.actedThisTurn || 0) - 1);
      if (Array.isArray(st.pickedActions) && st.pickedActions.length > st.actedThisTurn)
        st.pickedActions = st.pickedActions.slice(0, st.actedThisTurn);
    }
    if (!Array.isArray(st.unresolved)) st.unresolved = [];
    if (!Array.isArray(st.history))    st.history = [];
    if (!Array.isArray(st.heirs))      st.heirs = [];
    if (!Array.isArray(st.harem))      st.harem = [];
    if (!Array.isArray(st.vassals))    st.vassals = [];
    if (!Array.isArray(st.courtiers))  st.courtiers = [];
    if (!Array.isArray(st.pickedActions)) st.pickedActions = [];
    if (typeof st.npcQueue === 'undefined') st.npcQueue = [];
    return st;
  },

  /* 导入并落盘：覆盖当前进度 */
  applySave(state) {
    this.S = state;
    this.save();
    return true;
  },

  /* 存档文件默认文件名 */
  saveFileName() {
    const S = this.S;
    const md = (DATA.monthNames && DATA.monthNames[S.month - 1]) || (S.month + '月');
    const safe = String(S.name).replace(/[\\/:*?"<>|]/g, '');
    return `帝王模拟器存档-${safe}-${S.nianhao}${S.year}年${md}-第${S.generation}代.txt`;
  },

  /* ── 编解码底层 ── */
  _deflate(bytes) {
    const st = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Response(st).arrayBuffer().then(b => new Uint8Array(b));
  },
  _inflate(bytes) {
    const st = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(st).arrayBuffer().then(b => new Uint8Array(b));
  },
  _bytesToB64(u8) {
    let s = ''; const CHUNK = 0x8000;
    for (let i = 0; i < u8.length; i += CHUNK)
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    return btoa(s);
  },
  _b64ToBytes(str) {
    let bin;
    try { bin = atob(str); }
    catch (e) { throw new Error('存档码里含有非法字符，请重新完整复制。'); }
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  },
};
