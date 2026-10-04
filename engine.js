// Army Muster — game engine (DOM-free)
// Ported from the simulation (sim.js v1.1) into a step-by-step model: plan a month, run 5 turns, repeat.
// All state lives in one plain object `g` (JSON-serializable, including the RNG state) so it can be saved to localStorage.
(function (root) {
  'use strict';

  const VERSION = '0.3.0';

  // ---------- definitions ----------
  // 9 stats: 3 categories × 3. Each merges two of the former 18 (spec §23):
  //  (endurance+capacity) / (precision+reaction) / (range+perception)
  const STATS = ['POW','DEX','MOB', 'INT','TAC','VIS', 'CMD','ELO','POL'];
  const PER_CAT = 3;
  const IDX = {}; STATS.forEach((s, i) => { IDX[s] = i; });
  const catOf = (i) => Math.floor(i / PER_CAT);
  const ids = (a) => a.map((s) => IDX[s]);
  const CATS = ['PHYSICAL', 'MENTAL', 'SOCIAL'];
  // former 18-stat order → the new stat each one merged into (used to migrate v0.1–0.2 saves)
  const OLD18 = ['VIT','STR','SPD','DEX','AGI','SEN', 'FOC','MEM','VIS','TAC','PRO','INS', 'CHA','CMD','POL','MAN','ELO','EMP'];
  const MERGE = { POW: ['VIT','STR'], DEX: ['DEX','AGI'], MOB: ['SPD','SEN'], INT: ['FOC','MEM'], TAC: ['TAC','PRO'], VIS: ['VIS','INS'], CMD: ['CHA','CMD'], ELO: ['MAN','ELO'], POL: ['POL','EMP'] };

  const BATTLE_MAIN = { Skirmish: ids(['DEX','MOB','POW']), Clash: ids(['CMD','TAC','VIS']), Ambush: ids(['MOB','VIS','TAC']) };
  const BATTLE_TYPES = ['Skirmish', 'Clash', 'Ambush'];   // Duel is not implemented yet
  const GOVERN = [
    { name: 'Develop',    key: 'dev', main: ids(['POL','VIS','TAC']) },
    { name: 'Discipline', key: 'dis', main: ids(['CMD','POW']) },
    { name: 'Pacify',     key: 'pac', main: ids(['CMD','POL','ELO']) },
    { name: 'Negotiate',  key: 'dip', main: ids(['ELO','POL']) },
  ];
  const SCHEDULE = { 0: [], 1: [2], 2: [1, 3], 3: [0, 2, 4] };   // which turn(s) of the month hold a planned battle
  const ROLES = ['commander', 'infantry', 'archer'];
  const ROLE_REQ = { commander: ids(['CMD','TAC']), infantry: ids(['POW','DEX']), archer: ids(['DEX','MOB','VIS']) };
  const ROLE_AFF = {
    Skirmish: { commander: 0.8, infantry: 1.10, archer: 1.00 },
    Clash:    { commander: 0.9, infantry: 1.05, archer: 1.00 },
    Ambush:   { commander: 0.8, infantry: 0.95, archer: 1.15 },
  };
  const RANK_OFF = [0, 6, 12, 20];
  const RANK_TAL = [1.0, 1.1, 1.2, 1.35];
  // retreat judgement (former VIS/TAC/INS/SEN/CMD/ELO/EMP)
  const RET7 = ids(['VIS','TAC','MOB','CMD','ELO','POL']);
  // scouting success (Recruit: former CHA/MAN/EMP)
  const RECRUIT = ids(['CMD','ELO','POL']);
  const TIERS = ['totalVictory', 'majorVictory', 'victory', 'stalemate', 'defeat', 'rout', 'retreat'];
  const PATHS = ['empire', 'instructor', 'bureau', 'general', 'retire'];

  // Numbers follow game-spec.md (v1.1). 【提案】 values are provisional.
  const CFG = {
    squadSize: 5,
    initial: [{ spec: 0, tenure: 48 }, { spec: 1, tenure: 24 }, { spec: 2, tenure: 0 }],
    base: 35, specBonus: 15, leaderBonus: 10, leaderCT: 25, tenureBonusPerYear: 6,
    growth: { focus: [17, 23], other: [2, 8], diminishStart: 100, diminishMin: 0.5 },
    leap: { months: [4, 10], p: 0.15, mvpBonus: 0.30, mult: 2 },
    recruitByClass: [6, 8, 10, 13, 16], recruitClassBonus: 3,
    serviceMonths: 60, empireMean: 75,
    jobSlots: { instructor: 3, bureau: 3, general: 3 },
    empireScoreBase: 60, empireScoreDiv: 10,
    classUpS: [6, 13, 24, 38, 9999], classDownS: [-1, 3, 7, 13, 22],
    capByClass: [30, 45, 60, 80, 100], capPerGeneral: 5, levyYearCapMult: 1.5,
    bigP: 0.06, suddenP: 0.07,
    bigStrength: [1.5, 2.5], bigSize: [1.1, 1.4], suddenStrength: [1.8, 2.8], suddenSize: [1.0, 1.2],
    oppStrength: { weak: [0.6, 0.85], equal: [0.9, 1.2], strong: [1.2, 1.6] },
    randomStrength: [0.95, 1.3],
    oppExp: { weak: 0.5, equal: 1.0, strong: 1.6, big: 2.2, sudden: 2.5, random: 1.0 },
    archerRatio: 0.4,
    randomBattlesPerYear: [1, 2, 2, 3],
    // battle experience per main stat. 0.5 with 9 stats keeps the army-wide growth of the former +1.0 over 18 stats (spec §23)
    levyExtra: 2, battleExp: 0.5,
    tierRatio: [1.8, 1.4, 1.1, 0.9, 0.65],
    ownRate: [[0.002, 0.006], [0.005, 0.012], [0.010, 0.020], [0.025, 0.040], [0.040, 0.070], [0.080, 0.130]],
    enemyRate: [0.60, 0.45, 0.30, 0.15, 0.08, 0.04],
    expMult: [1, 1, 1, 0.7, 0.4, 0.3], retreatExp: 0.3,
    retreatOfferAt: 4, retreatBase: 0.15, retreatCmdWeight: 0.7, retreatLossCut: 0.5,
    retreatRecoverTurns: 2, retreatRefill: 0.5,
    governGain: 2, governDecay: 1,
    // scouting (spec §5.11)
    scoutDistricts: [4, 5, 6, 7, 8], scoutPool: 7,
    scoutVisible: [5, 5, 6, 6, 7],
    scoutSuccess: [1.0, 0.8, 0.5, 0.35], scoutStatRef: 80, scoutPMax: 0.95, scoutClassSucc: 0.1,
    scoutRankP: [[0.22, 0.08, 0.04], [0.24, 0.10, 0.05], [0.26, 0.12, 0.06], [0.28, 0.14, 0.065], [0.30, 0.16, 0.07]],
    scoutTraitP: 0.6,
  };

  // ---------- helpers ----------
  const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  // mulberry32 with its state stored in g.rs (so saves resume the same random stream)
  function rnd(g) {
    let a = g.rs | 0; a = (a + 0x6D2B79F5) | 0; g.rs = a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const U = (g, a, b) => a + (b - a) * rnd(g);
  const pick = (g, arr) => arr[Math.floor(rnd(g) * arr.length)];

  // Japanese surnames (names.js). Avoid names already used by living members when possible.
  const NAMES = root.NAME_LIST && root.NAME_LIST.length ? root.NAME_LIST : [['兵', 'へい']];
  function genName(g) {
    const used = new Set(g.people.filter((p) => p.alive).map((p) => p.name));
    let n = pick(g, NAMES);
    for (let k = 0; k < 12 && used.has(n[0]); k++) n = pick(g, NAMES);
    return n[0];
  }
  const readingOf = (name) => { const n = NAMES.find((x) => x[0] === name); return n ? n[1] : ''; };

  function rankProbs(cls) {
    const t = cls - 1;
    const p4 = 0.01 + 0.005 * t, p3 = 0.07 + 0.010 * t, p2 = 0.22 + 0.015 * t;
    return [1 - p2 - p3 - p4, p2, p3, p4];
  }

  // a recruit's base numbers: rank, specialty category (+15), one favoured stat (+10), one weak stat (−8), talent
  // (with 9 stats, one favoured stat keeps the same share as the former two-of-18)
  function genRecruit(g, cls, probs, specFix) {
    const t = cls - 1;
    const [, p2, p3, p4] = probs || rankProbs(cls);
    const x = rnd(g);
    const rank = x < p4 ? 3 : x < p4 + p3 ? 2 : x < p4 + p3 + p2 ? 1 : 0;
    const sr = Math.floor(rnd(g) * 3);
    const spec = specFix === undefined ? sr : specFix;
    const N = STATS.length;
    const fav = [Math.floor(rnd(g) * N)];
    let weak; do { weak = Math.floor(rnd(g) * N); } while (fav.includes(weak));
    const stats = [], talent = [];
    for (let j = 0; j < N; j++) {
      const v = CFG.base + t * CFG.recruitClassBonus + U(g, -5, 5) + (catOf(j) === spec ? CFG.specBonus : 0) + RANK_OFF[rank] + (fav.includes(j) ? 10 : 0) - (j === weak ? 8 : 0);
      stats.push(clamp(v, 1, 200));
      talent.push((U(g, 0.8, 1.2) + (catOf(j) === spec ? 0.1 : 0)) * RANK_TAL[rank]);
    }
    return { stats, talent, rank, spec, fav, weak };
  }

  // ---------- people & army ----------
  const soldiers = (g) => g.people.filter((p) => p.alive && !p.job);
  const withJob = (g, j) => g.people.filter((p) => p.alive && p.job === j);
  const reqMean = (p, role) => mean(ROLE_REQ[role].map((j) => p.stats[j]));
  const recruitScore = (p) => mean(RECRUIT.map((j) => p.stats[j]));
  const year = (g) => Math.floor(g.month / 12) + 1;
  const cal = (g) => (g.month % 12) + 1;

  function newPerson(g, o) {
    const p = {
      id: g.nextId++, name: genName(g), squad: 0, spec: o.spec, tenure: o.tenure || 0, alive: true, job: null, role: 'infantry',
      focus: -1, contrib: 0, leap: false, stats: [], talent: [], init: [], origin: o.origin || 'init', rank: null, joined: g.month,
    };
    const gen = o.gen || (o.recruit ? genRecruit(g, g.cls) : null);
    if (gen) { p.spec = gen.spec; p.rank = gen.rank; p.stats = gen.stats.slice(); p.talent = gen.talent.slice(); p.fav = gen.fav; p.weak = gen.weak; }
    for (let j = 0; !gen && j < STATS.length; j++) {
      const v = o.stats ? o.stats[j]
        : CFG.base + (o.baseAdd || 0) + U(g, -5, 5) + (catOf(j) === o.spec ? CFG.specBonus : 0)
          + (o.leader ? CFG.leaderBonus + ((j === IDX.CMD || j === IDX.TAC) ? CFG.leaderCT : 0) : 0)
          + (p.tenure / 12) * CFG.tenureBonusPerYear;
      p.stats.push(clamp(v, 1, 200));
      p.talent.push(U(g, 0.8, 1.2) + (catOf(j) === o.spec ? 0.1 : 0));
    }
    p.init = p.stats.slice();
    g.people.push(p);
    return p;
  }

  function squadsOf(g) {
    const by = {};
    soldiers(g).forEach((p) => { (by[p.squad] = by[p.squad] || []).push(p); });
    return by;
  }

  // put a newcomer into the first squad with room; give them a role that fits the squad
  function assignSquad(g, p) {
    const by = squadsOf(g);
    const keys = Object.keys(by).map(Number).filter((s) => s !== 0).sort((a, b) => a - b);
    let best = 0;
    keys.forEach((s) => { const n = by[s].filter((q) => q !== p).length; if (!best && n < CFG.squadSize) best = s; });
    if (!best) best = (keys.length ? Math.max.apply(null, keys) : 0) + 1;
    p.squad = best;
    const mates = (by[best] || []).filter((q) => q !== p);
    if (!mates.some((q) => q.role === 'commander')) p.role = 'commander';
    else p.role = reqMean(p, 'archer') > reqMean(p, 'infantry') + 3 ? 'archer' : 'infantry';
    if (p.focus < 0) p.focus = ROLE_REQ[p.role][0];
  }

  // automatic role assignment (players can override per person)
  function autoRoles(g) {
    const by = squadsOf(g);
    Object.keys(by).forEach((s) => {
      const list = by[s];
      const cmd = list.reduce((a, b) => (reqMean(a, 'commander') >= reqMean(b, 'commander') ? a : b));
      const others = list.filter((p) => p !== cmd);
      const nArch = Math.floor(others.length * CFG.archerRatio);
      others.sort((a, b) => (reqMean(b, 'archer') - reqMean(b, 'infantry')) - (reqMean(a, 'archer') - reqMean(a, 'infantry')));
      cmd.role = 'commander';
      others.forEach((p, i) => { p.role = i < nArch ? 'archer' : 'infantry'; });
    });
  }

  // focus = the lowest of the three stats the role asks for
  function autoFocus(g, list) {
    (list || soldiers(g)).forEach((p) => {
      const req = ROLE_REQ[p.role];
      p.focus = req.reduce((a, j) => (p.stats[j] < p.stats[a] ? j : a), req[0]);
    });
  }

  function leaders(g) {
    const by = squadsOf(g);
    return Object.keys(by).map((s) => by[s].find((p) => p.role === 'commander')
      || by[s].reduce((a, b) => (a.stats[IDX.CMD] + a.stats[IDX.TAC] >= b.stats[IDX.CMD] + b.stats[IDX.TAC] ? a : b)));
  }

  const capacity = (g) => CFG.capByClass[g.cls - 1] + CFG.capPerGeneral * Math.min(3, withJob(g, 'general').length);

  // ---------- new game ----------
  function newGame(seed) {
    const g = {
      v: VERSION, seed: seed >>> 0, rs: seed >>> 0, month: 0, cls: 1, people: [], nextId: 1,
      ind: { dev: 0, dis: 0, pac: 0, dip: 0 }, lossLastYear: 0, recoverTurns: 0, randTurns: [], battleCount: 0,
      ys: null, history: [], reports: [], grads: [],
      phase: 'plan', scout: null, offers: null, plan: null,
    };
    CFG.initial.forEach((sq, k) => {
      for (let i = 0; i < CFG.squadSize; i++) {
        const p = newPerson(g, { spec: sq.spec, tenure: sq.tenure, leader: i === 0 });
        p.squad = k + 1;
      }
    });
    autoRoles(g); autoFocus(g);
    startYear(g);
    startMonth(g);
    return g;
  }

  const freshYear = () => ({ battles: 0, wins: 0, losses: 0, deaths: 0, levied: 0, levyWanted: 0, refilled: 0, recruits: 0, scouted: 0,
    leaps: 0, grads: [], res: [0, 0, 0, 0, 0, 0, 0], scoutRanks: [0, 0, 0, 0], genRanks: [0, 0, 0, 0] });

  function startYear(g) {
    g.ys = freshYear();
    const k = pick(g, CFG.randomBattlesPerYear);
    const set = new Set(); while (set.size < k) set.add(Math.floor(rnd(g) * 60));
    g.randTurns = Array.from(set);
    if (year(g) > 1) openScout(g);
  }

  // ---------- scouting (January from year 2) ----------
  function recruitTotal(g) {
    const base = CFG.recruitByClass[g.cls - 1];
    return Math.round(base * (1 + 0.3 * g.ind.pac / 100) + base * Math.min(0.5, 0.1 * g.lossLastYear));
  }
  function recruiter(g) {
    const pool = leaders(g).concat(withJob(g, 'bureau'));
    if (!pool.length) return null;
    return pool.reduce((a, b) => (recruitScore(a) >= recruitScore(b) ? a : b));
  }
  function scoutP(g, rank) {
    const r = recruiter(g); const R = r ? recruitScore(r) : CFG.base;
    const up = rank >= 2 ? 1 + CFG.scoutClassSucc * (g.cls - 1) : 1;
    return Math.min(CFG.scoutPMax, CFG.scoutSuccess[rank] * R / CFG.scoutStatRef * up);
  }

  function openScout(g) {
    const n = recruitTotal(g);
    const D = CFG.scoutDistricts[g.cls - 1];
    const S = Math.min(D, n);
    const VIS = CFG.scoutVisible[g.cls - 1];
    const sp = CFG.scoutRankP[g.cls - 1];
    const rp = [1 - sp[0] - sp[1] - sp[2]].concat(sp);
    // district traits change every year: PHYSICAL ×3, MENTAL ×3, SOCIAL ×2 shuffled over 8 districts
    const traits = [0, 1, 2, 0, 1, 2, 0, 1].map((t) => ({ t, k: rnd(g) })).sort((a, b) => a.k - b.k).map((x) => x.t);
    const districts = [];
    for (let d = 0; d < D; d++) {
      const cands = [];
      for (let k = 0; k < CFG.scoutPool; k++) {
        const fix = rnd(g) < CFG.scoutTraitP ? traits[d] : undefined;
        cands.push({ gen: genRecruit(g, g.cls, rp, fix), vis: k < VIS, state: 'open', name: genName(g) });
      }
      // shuffle so the hidden ones are not always last
      cands.sort(() => rnd(g) - 0.5);
      districts.push({ trait: traits[d], cands });
    }
    g.scout = { total: n, picks: S, used: 0, districts, results: [] };
    g.phase = 'scout';
  }

  // try to recruit candidate k of district d. Failure sends that slot to open recruitment.
  function scoutPick(g, d, k) {
    const s = g.scout; if (!s || s.used >= s.picks) return null;
    const c = s.districts[d].cands[k]; if (c.state !== 'open') return null;
    const p = scoutP(g, c.gen.rank);
    const ok = rnd(g) < p;
    s.used++;
    c.state = ok ? 'joined' : 'declined';
    let person = null;
    if (ok) {
      person = newPerson(g, { gen: c.gen, origin: 'scout' }); person.name = c.name;
      assignSquad(g, person);
      g.ys.scoutRanks[person.rank]++; g.ys.scouted++;
    }
    c.revealed = true;
    s.results.push({ d, k, ok, rank: c.gen.rank, name: c.name, id: person ? person.id : null });
    return { ok, rank: c.gen.rank, person, p };
  }

  // finish scouting: the rest of the intake (and failed scout slots) come from open recruitment
  function scoutFinish(g) {
    const s = g.scout; if (!s) return;
    const failed = s.results.filter((x) => !x.ok).length;
    const rest = s.total - s.picks + failed + (s.picks - s.used);   // unused picks also fall back to open recruitment
    const joined = [];
    for (let i = 0; i < rest; i++) {
      const p = newPerson(g, { spec: Math.floor(rnd(g) * 3), origin: 'new', recruit: true });
      assignSquad(g, p); g.ys.genRanks[p.rank]++; joined.push(p.id);
    }
    g.ys.recruits = s.total;
    g.reports.unshift({ month: g.month, kind: 'intake', scouted: s.results.filter((x) => x.ok).map((x) => x.id), general: joined, failed });
    g.scout = null;
    g.phase = 'plan';
  }

  // ---------- monthly plan ----------
  function startMonth(g) {
    // offers: for each of the 3 possible battle slots, whether the "strong" option is replaced by a great power
    g.offers = [0, 1, 2].map(() => rnd(g) < CFG.bigP);
    const leapMonth = CFG.leap.months.includes(cal(g));
    // leap (LEAP): decided at the start of April and October; the top contributor of each squad gets +30%
    soldiers(g).forEach((p) => { p.leap = false; });
    if (leapMonth) {
      const best = {};
      soldiers(g).forEach((p) => { if (p.contrib > 0 && (!best[p.squad] || p.contrib > best[p.squad].contrib)) best[p.squad] = p; });
      const mvps = new Set(Object.keys(best).map((s) => best[s].id));
      soldiers(g).forEach((p) => {
        p.leap = rnd(g) < CFG.leap.p + (mvps.has(p.id) ? CFG.leap.mvpBonus : 0);
        if (p.leap) g.ys.leaps++;
        p.contrib = 0;
      });
    }
    if (!g.plan) g.plan = { battles: [{ opp: 'equal', type: 'Clash' }], policy: 'auto', retreat: 'defeat' };
  }

  const plainMean = (list, type) => mean(list.map((p) => mean(BATTLE_MAIN[type].map((j) => p.stats[j]))));
  const powerOf = (p, type) => ROLE_AFF[type][p.role] * (0.5 * mean(BATTLE_MAIN[type].map((j) => p.stats[j])) + 0.5 * reqMean(p, p.role));

  function participants(g, type) {
    const all = soldiers(g);
    const by = squadsOf(g); const sq = Object.keys(by);
    if (type === 'Clash') return all;
    if (type === 'Skirmish') return by[pick(g, sq)];
    let parts = [];
    sq.slice().sort(() => rnd(g) - 0.5).slice(0, Math.ceil(sq.length / 2)).forEach((s) => { parts = parts.concat(by[s]); });
    return parts;
  }

  function armyPower(g, parts, type) {
    const mult = (1 + 0.05 * g.ind.dis / 100) * (1 + Math.min(0.15, 0.03 * withJob(g, 'general').length)) * (type === 'Ambush' ? 1.1 : 1);
    const bySq = {}; parts.forEach((p) => { (bySq[p.squad] = bySq[p.squad] || []).push(p); });
    let sum = 0;
    Object.keys(bySq).forEach((s) => {
      const cm = bySq[s].find((p) => p.role === 'commander');
      const cb = cm ? 1 + 0.15 * ((cm.stats[IDX.CMD] + cm.stats[IDX.TAC]) / 2) / 100 : 1;
      sum += bySq[s].reduce((a, p) => a + powerOf(p, type), 0) * cb;
    });
    return sum * mult;
  }

  // rough odds for the plan screen: expected (own power ÷ enemy power), using the whole army for Clash
  // and a typical half/one-squad share for the others
  function estimate(g, type, opp, big) {
    const all = soldiers(g); if (!all.length) return 0;
    const share = type === 'Clash' ? 1 : type === 'Ambush' ? 0.5 : Math.min(1, CFG.squadSize / all.length);
    const P = armyPower(g, all, type) * share;
    const rg = opp === 'strong' && big ? CFG.bigStrength : CFG.oppStrength[opp];
    const size = opp === 'strong' && big ? mean(CFG.bigSize) : 1;
    const E = all.length * share * 0.85 * size * plainMean(all, type) * mean(rg);
    return P / E;
  }
  const tierOf = (ratio) => { const t = CFG.tierRatio; return ratio >= t[0] ? 0 : ratio >= t[1] ? 1 : ratio >= t[2] ? 2 : ratio >= t[3] ? 3 : ratio >= t[4] ? 4 : 5; };

  // ---------- running a month ----------
  function growTurn(g) {
    const dev = 1 + 0.1 * g.ind.dev / 100;
    const inst = 1 + Math.min(0.15, 0.03 * withJob(g, 'instructor').length);
    soldiers(g).forEach((p) => {
      for (let j = 0; j < STATS.length; j++) {
        const range = j === p.focus ? CFG.growth.focus : CFG.growth.other;
        const annual = U(g, range[0], range[1]);
        const s = p.stats[j];
        const dim = s <= CFG.growth.diminishStart ? 1 : 1 - (1 - CFG.growth.diminishMin) * (s - CFG.growth.diminishStart) / (200 - CFG.growth.diminishStart);
        p.stats[j] = Math.min(200, s + (annual / 60) * p.talent[j] * dim * dev * inst * (p.leap ? CFG.leap.mult : 1));
      }
    });
  }

  function governTurn(g, policy) {
    if (g.recoverTurns > 0) { g.recoverTurns--; return 0; }
    const pool = leaders(g).concat(withJob(g, 'bureau'));
    if (!pool.length) return 0;
    const avg = mean(pool.map((p) => mean(policy.main.map((j) => p.stats[j]))));
    const before = g.ind[policy.key];
    g.ind[policy.key] = Math.min(100, before + CFG.governGain * avg / 100);
    return g.ind[policy.key] - before;
  }

  // one battle. kind: weak/equal/strong/big (planned) or random/sudden (unplanned)
  function doBattle(g, type, kind, retreatAt) {
    const parts = participants(g, type);
    const main = BATTLE_MAIN[type];
    const P = armyPower(g, parts, type) * U(g, 0.9, 1.1);
    const pm = plainMean(parts, type);
    const sSize = kind === 'big' ? U(g, CFG.bigSize[0], CFG.bigSize[1]) : kind === 'sudden' ? U(g, CFG.suddenSize[0], CFG.suddenSize[1]) : 1;
    const rg = kind === 'big' ? CFG.bigStrength : kind === 'sudden' ? CFG.suddenStrength : kind === 'random' ? CFG.randomStrength : CFG.oppStrength[kind];
    const n = Math.max(2, Math.round(parts.length * U(g, 0.6, 1.1) * sSize));
    const eMean = pm * U(g, rg[0], rg[1]);
    const E = n * eMean * U(g, 0.9, 1.1);

    const score7 = (p) => mean(RET7.map((j) => p.stats[j]));
    const cmdrs = soldiers(g).filter((p) => p.role === 'commander');
    const battalion = (cmdrs.length ? cmdrs : parts).reduce((a, b) => (score7(a) >= score7(b) ? a : b));
    const sqLeaders = parts.filter((p) => p.role === 'commander');
    const cs = sqLeaders.length ? (score7(battalion) + mean(sqLeaders.map(score7))) / 2 : score7(battalion);
    const offerP = clamp(CFG.retreatBase + CFG.retreatCmdWeight * cs / 200, 0, 0.95);
    const lossCut = 1 - CFG.retreatLossCut * cs / 200;
    let cumP = 0, cumE = 0, retreatTier = -1, doneRounds = 3, offered = false;
    const rounds = [];
    for (let k = 0; k < 3; k++) {
      cumP += P / 3 * U(g, 0.85, 1.15); cumE += E / 3 * U(g, 0.85, 1.15);
      rounds.push(cumP / cumE);
      if (k < 2) {
        const proj = tierOf(cumP / cumE);
        if (proj >= CFG.retreatOfferAt && rnd(g) < offerP) {
          offered = true;
          if (proj >= retreatAt) { retreatTier = proj; doneRounds = k + 1; break; }
        }
      }
    }
    const retreated = retreatTier >= 0;
    const tier = retreated ? 6 : tierOf(cumP / cumE);
    g.ys.res[tier]++;

    const dis = 1 - 0.3 * g.ind.dis / 100;
    const basis = retreated ? retreatTier : tier;
    const rate = U(g, CFG.ownRate[basis][0], CFG.ownRate[basis][1]) * dis * (retreated ? doneRounds / 3 * lossCut : 1);
    const expM = retreated ? CFG.retreatExp : CFG.expMult[tier];
    const dead = [];
    let mvp = null;
    parts.forEach((p) => {
      const c = powerOf(p, type) * U(g, 0.7, 1.3) / 10;
      p.contrib += c;
      if (!mvp || c > mvp.c) mvp = { id: p.id, name: p.name, c };
      main.forEach((j) => { p.stats[j] = Math.min(200, p.stats[j] + CFG.battleExp * CFG.oppExp[kind] * expM); });
      if (rnd(g) < rate) { p.alive = false; p.fate = 'fallen'; p.leftMonth = g.month; dead.push(p.name); }
    });
    g.ys.deaths += dead.length;
    g.ys.battles++;
    const out = { type, kind, tier, ratio: cumP / cumE, rounds, parts: parts.length, enemy: n, dead, offered, retreated, mvp: mvp && mvp.name, levied: 0, levyWanted: 0, refilled: 0 };

    if (retreated) {
      g.recoverTurns = CFG.retreatRecoverTurns;
      const refill = Math.round(dead.length * CFG.retreatRefill);
      for (let i = 0; i < refill; i++) { const p = newPerson(g, { spec: Math.floor(rnd(g) * 3), origin: 'refill', recruit: true }); assignSquad(g, p); }
      g.ys.refilled += refill; out.refilled = refill;
    } else if (tier <= 2) {
      g.ys.wins++;
      const enemySurvivors = Math.round(n * (1 - CFG.enemyRate[tier]));
      const want = Math.max(0, Math.min(enemySurvivors, dead.length + CFG.levyExtra + Math.floor(rnd(g) * 3) - 1));
      const yearLeft = Math.max(0, Math.round(CFG.recruitByClass[g.cls - 1] * CFG.levyYearCapMult) - g.ys.levied);
      const levy = Math.min(want, Math.max(0, capacity(g) - soldiers(g).length), yearLeft);
      g.ys.levyWanted += want;
      for (let i = 0; i < levy; i++) {
        const st = []; for (let j = 0; j < STATS.length; j++) st.push(clamp(eMean * 0.9 + U(g, -8, 8), 1, 200));
        const p = newPerson(g, { spec: Math.floor(rnd(g) * 3), stats: st, origin: 'levy' });
        assignSquad(g, p);
      }
      g.ys.levied += levy; out.levied = levy; out.levyWanted = want;
    } else if (tier >= 4) { g.ys.losses++; }
    return out;
  }

  function graduate(g, p) {
    const m = mean(p.stats);
    const instr = (p.stats[IDX.CMD] + p.stats[IDX.INT]) / 2;
    const bur = (p.stats[IDX.POL] + p.stats[IDX.TAC] + p.stats[IDX.VIS]) / 3;
    const gen = (p.stats[IDX.CMD] + p.stats[IDX.TAC] + p.stats[IDX.VIS]) / 3;
    let path = 'retire';
    if (m >= CFG.empireMean) path = 'empire';
    else {
      const order = [['instructor', instr], ['bureau', bur], ['general', gen]].sort((a, b) => b[1] - a[1]);
      for (const [job] of order) if (withJob(g, job).length < CFG.jobSlots[job]) { path = job; break; }
    }
    if (path === 'empire' || path === 'retire') { p.alive = false; p.fate = path; p.leftMonth = g.month; } else { p.job = path; p.role = null; p.squad = 0; }
    const rec = { id: p.id, name: p.name, origin: p.origin, rank: p.rank, path, mean: m, maxStat: Math.max.apply(null, p.stats), month: g.month };
    g.grads.push(rec); g.ys.grads.push(rec);
    return rec;
  }

  // run the 5 turns of the current month with the given plan
  function runMonth(g, plan) {
    if (g.phase !== 'plan') throw new Error('not in plan phase');
    g.plan = plan;
    const m = g.month;
    const rep = { month: m, kind: 'month', policy: null, battles: [], govern: 0, grads: [], leaps: soldiers(g).filter((p) => p.leap).map((p) => p.name), cls: null };
    const policy = plan.policy === 'auto' ? GOVERN.slice().sort((a, b) => g.ind[a.key] - g.ind[b.key])[0] : GOVERN.find((x) => x.key === plan.policy);
    rep.policy = policy.key;
    const nb = Math.min(3, plan.battles.length);
    const sched = SCHEDULE[nb];
    const retreatAt = plan.retreat === 'never' ? 9 : plan.retreat === 'stalemate' ? 3 : 4;
    for (let t = 0; t < 5; t++) {
      let res = null;
      const si = sched.indexOf(t);
      if (si >= 0 && soldiers(g).length >= 3) {
        const b = plan.battles[si];
        const kind = b.opp === 'strong' && g.offers[si] ? 'big' : b.opp;
        res = doBattle(g, b.type, kind, retreatAt);
      } else if (g.randTurns.includes((cal(g) - 1) * 5 + t) && rnd(g) >= 0.5 * g.ind.dip / 100 && soldiers(g).length >= 3) {
        res = doBattle(g, pick(g, BATTLE_TYPES), rnd(g) < CFG.suddenP ? 'sudden' : 'random', retreatAt);
      } else rep.govern += governTurn(g, policy);
      if (res) { res.turn = t + 1; rep.battles.push(res); }
      growTurn(g);
    }
    // month end
    soldiers(g).forEach((p) => { p.tenure++; });
    soldiers(g).filter((p) => p.tenure >= CFG.serviceMonths).forEach((p) => rep.grads.push(graduate(g, p)));
    Object.keys(g.ind).forEach((k) => { g.ind[k] = Math.max(0, g.ind[k] - CFG.governDecay); });
    // fill squads that lost their commander
    const by = squadsOf(g);
    Object.keys(by).forEach((s) => { if (!by[s].some((p) => p.role === 'commander')) by[s].reduce((a, b) => (reqMean(a, 'commander') >= reqMean(b, 'commander') ? a : b)).role = 'commander'; });

    // year end: territory class from the quality of those sent to the Empire
    if (cal(g) === 12) {
      const ys = g.ys; const before = g.cls; let score = null;
      if (ys.grads.length) {
        score = ys.grads.filter((x) => x.path === 'empire').reduce((a, x) => a + Math.max(0, (x.mean - CFG.empireScoreBase) / CFG.empireScoreDiv), 0);
        if (score >= CFG.classUpS[g.cls - 1]) g.cls = Math.min(5, g.cls + 1); else if (score < CFG.classDownS[g.cls - 1]) g.cls = Math.max(1, g.cls - 1);
      }
      g.lossLastYear = ys.losses;
      const s = soldiers(g);
      g.history.push({ year: year(g), clsBefore: before, clsAfter: g.cls, score, soldiers: s.length, meanAll: mean(s.map((p) => mean(p.stats))),
        battles: ys.battles, wins: ys.wins, losses: ys.losses, deaths: ys.deaths, levied: ys.levied, recruits: ys.recruits, scouted: ys.scouted,
        leaps: ys.leaps, grads: ys.grads.length, empire: ys.grads.filter((x) => x.path === 'empire').length, scoutRanks: ys.scoutRanks.slice(), genRanks: ys.genRanks.slice() });
      rep.cls = { before, after: g.cls, score };
    }
    g.reports.unshift(rep);
    if (g.reports.length > 120) g.reports.length = 120;

    g.month++;
    if (cal(g) === 1) startYear(g);
    startMonth(g);
    if (g.phase !== 'scout') g.phase = 'plan';
    return rep;
  }

  // upgrade saves from v0.1–0.2 (18 stats, romanized names) to the 9-stat model with Japanese surnames
  function migrate(g) {
    if (!g || !g.people) return g;
    const pos = (s) => OLD18.indexOf(s);
    const merge = (a) => STATS.map((s) => (a[pos(MERGE[s][0])] + a[pos(MERGE[s][1])]) / 2);
    const newIdx = (i) => STATS.findIndex((s) => MERGE[s].includes(OLD18[i]));
    const fix = (o) => {
      if (!o || !o.stats || o.stats.length !== OLD18.length) return;
      o.stats = merge(o.stats); o.talent = merge(o.talent);
      if (o.init) o.init = merge(o.init);
      if (o.fav) o.fav = [newIdx(o.fav[0])];
      if (o.weak !== undefined) o.weak = newIdx(o.weak);
      if (o.focus !== undefined && o.focus >= 0) o.focus = newIdx(o.focus);
    };
    const romanized = (n) => typeof n === 'string' && /^[A-Za-z]/.test(n);
    g.people.forEach((p) => { fix(p); if (romanized(p.name)) p.name = genName(g); });
    if (g.scout) g.scout.districts.forEach((d) => d.cands.forEach((c) => { fix(c.gen); if (romanized(c.name)) c.name = genName(g); }));
    g.v = VERSION;
    return g;
  }

  root.GameEngine = {
    VERSION, CFG, STATS, IDX, CATS, GOVERN, BATTLE_TYPES, ROLES, ROLE_REQ, BATTLE_MAIN, TIERS, PATHS, RECRUIT,
    PER_CAT, MERGE, readingOf, migrate,
    newGame, runMonth, scoutPick, scoutFinish, scoutP, recruiter, recruitScore, estimate, tierOf,
    autoRoles, autoFocus, soldiers, withJob, squadsOf, capacity, reqMean, year, cal, mean, catOf, rankProbs,
  };
})(typeof window !== 'undefined' ? window : globalThis);
