// Headless self-check: boots the REAL engine from index.html under minimal DOM
// stubs and drives the same checks as #test=selfcheck (6 seeded lives to death +
// a fuzz pass + the prison audit), plus an old-save migration test for ensureState.
// Run: node tests/headless.mjs    (exits non-zero on any failure)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const data = fs.readFileSync(path.join(root, "bitlife_data.json"), "utf8");

// Extract the <script type="module"> engine body, drop the auto-boot IIFE block.
const lines = html.split("\n");
const l1 = lines.findIndex(l => l.includes('<script type="module">'));
const l2 = lines.length - 1 - [...lines].reverse().findIndex(l => l.includes("</script>"));
let engine = lines.slice(l1 + 1, l2).join("\n");
engine = engine.slice(0, engine.indexOf("// ── go ──"));   // cut the boot()/loadData IIFE
// Neutralize the AI-library static imports (not present/needed under node).
engine = engine
  .replace(/^\s*import\s+\{[^}]*\}\s+from\s+["']@huggingface\/transformers["'];?\s*$/m,
    "const pipeline = async () => (async () => ({})), TextStreamer = class {}, env = {};")
  .replace(/^\s*import\s+\{[^}]*\}\s+from\s+["']\.\/vendor\/web-txt2img\/index\.js["'];?\s*$/m,
    "const Txt2ImgWorkerClient = class {};");

// ── Minimal browser stubs (a recursive no-op proxy stands in for any DOM node) ──
const prelude = `
const __noop = () => __el;
const __el = new Proxy(function(){}, {
  get(_, k){ if (k === "style") return new Proxy({}, { get: () => "", set: () => true });
             if (k === "classList") return { add(){}, remove(){}, toggle(){}, contains(){return false;} };
             if (k === "dataset") return {};
             if (k === Symbol.toPrimitive) return () => "";
             return __noop; },
  set(){ return true; }, apply(){ return __el; }
});
globalThis.document = {
  getElementById: () => __el, querySelector: () => __el, querySelectorAll: () => [],
  createElement: () => __el, createElementNS: () => __el, createRange: () => ({ selectNode(){}, }),
  addEventListener(){}, removeEventListener(){}, body: __el, head: __el, documentElement: __el,
};
const __store = new Map();
globalThis.localStorage = {
  getItem: k => (__store.has(k) ? __store.get(k) : null),
  setItem: (k, v) => __store.set(k, String(v)), removeItem: k => __store.delete(k), clear: () => __store.clear(),
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.location = { hash: "", href: "", reload(){} };
try { Object.defineProperty(globalThis, "navigator", { value: { serviceWorker: null, clipboard: { writeText: async () => {} }, userAgent: "node" }, configurable: true }); } catch {}
globalThis.getSelection = () => ({ removeAllRanges(){}, addRange(){} });
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0); globalThis.cancelAnimationFrame = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener(){}, addListener(){} });
globalThis.fetch = async () => { throw new Error("offline"); };
globalThis.Image = class { set src(_){} }; globalThis.Audio = class { play(){} pause(){} };
globalThis.CustomEvent = class {}; globalThis.Event = class {};
globalThis.alert = () => {}; globalThis.confirm = () => true; globalThis.prompt = () => null;
`;

// ── Driver: replicate the selfcheck loop against the real engine functions ──
const driver = `
DATA = JSON.parse(${JSON.stringify(data)});   // full content, like a successful loadData()
skipModels = true;
try { launchMiniGame = () => {}; } catch {}   // mini-games need a browser; never launch under node
let pass = 0, fail = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else { fail++; if (fails.length < 40) fails.push(m); } };
const snap = () => JSON.stringify(stripTransient(game));

// 0) Data integrity (mirror of the in-browser asserts)
for (const [st, arr] of Object.entries(DATA.EVENTS || {})) { const ids = arr.map(e => e.id); ok(new Set(ids).size === ids.length, "unique event ids in " + st); }
for (const id of Object.keys(DATA.ACHIEVEMENTS)) ok(!!FALLBACK_DATA.ACHIEVEMENTS[id], "FALLBACK ribbon " + id);
auditBalance(ok);   // BALANCE reasonableness — out-of-range tunable numbers fail CI

// 0b) NL action dispatcher: a fake LLM/keyword result must drive the REAL fn through
//     the existing guards (no real model involved → deterministic, offline).
createNewLife({ first: "Nl", last: "Test", seed: "9100" });
auditCatalog(ok);   // ACTION_CATALOG shape — resolvers need a live game, so audit here
game.character.age = 30; game.character.lifeStage = lifeStageFor(30); game.character.money = 1000000;
const priced = allMarketAssets().filter(a => game.market.prices[a.id] > 0);
ok(priced.length > 0, "market has live prices for NL trades");
const asset = priced[0]; const m0 = game.character.money;
dispatchAction("buyAsset", { id: asset.id, shares: 1 });
ok((game.portfolio || []).some(h => h.assetId === asset.id), "dispatchAction buyAsset added a holding");
ok(game.character.money < m0, "dispatchAction buyAsset spent money through the real fn");
const cheap = priced.filter(a => game.market.prices[a.id] < 1000)[0];
if (cheap) { const m1 = game.character.money; dispatchAction("buyAsset", { id: cheap.id, shares: 1 }); ok(game.character.money < m1, "dispatchAction bought a sub-$1,000 asset (the headline example)"); }
const m2 = game.character.money; dispatchAction("buyAsset", { id: "NOTREAL", shares: 1 }); ok(game.character.money === m2, "dispatchAction rejects an invalid asset id (no-op)");
// confirm-gated (destructive) action must NOT execute without confirmation (modal is stubbed)
const arr0 = game.crimeRecord.arrests, not0 = game.crimeRecord.notoriety;
dispatchAction("commitCrime", { id: DATA.ACTIVITIES.crime[0].id });
ok(game.crimeRecord.arrests === arr0 && game.crimeRecord.notoriety === not0, "confirm-gated action waits for confirmation");
// prison blocks a catalog-dispatched block-action via the fn's own requireFree
sendToPrison(5, "test"); const pm = game.character.money;
dispatchAction("buyAsset", { id: asset.id, shares: 1 });
ok(game.character.money === pm, "in prison, dispatched buyAsset is blocked by requireFree");
// no-AI keyword router resolves a known phrase and rejects nonsense
createNewLife({ first: "Kw", last: "Test", seed: "9103" });
game.character.age = 30; game.character.lifeStage = lifeStageFor(30); game.character.money = 100000;
ok(typeof keywordResolve("go to the gym") === "string", "keywordResolve maps 'go to the gym' to an action");
ok(keywordResolve("zzqq nonsense blarg") === null, "keywordResolve returns null on nonsense");
// regression: typing "age up" must actually advance the year (was a freeform no-op)
createNewLife({ first: "Age", last: "Test", seed: "9104" });
const a0 = game.character.age; dispatchAction("ageUp", {});
ok(game.character.age === a0 + 1, "dispatchAction ageUp advances the year");
const a1 = game.character.age; keywordResolve("next year");
ok(game.character.age === a1 + 1, "keywordResolve 'next year' ages up");
// no-AI coverage: a battery of common phrasings must ALL resolve (the "did age up being
// broken mean a dozen others are too?" check). keywordResolve returns a string when it
// routes (executes or opens the right menu), null when it can't match.
createNewLife({ first: "Cov", last: "Test", seed: "5150" });
game.character.age = 30; game.character.lifeStage = lifeStageFor(30); game.character.money = 500000;
const common = ["go to the gym", "work out", "study", "meditate", "get a job", "buy a car", "buy a house", "buy stocks", "go to the casino", "play blackjack", "rob a bank", "shoplift", "find love", "date someone", "make a friend", "go on vacation", "get a tattoo", "go clubbing", "see a doctor", "get a checkup", "start a business", "take a loan", "buy a pet", "rob a house", "start a fight", "run for office", "post on social media", "write a book", "visit a prostitute", "hire a hitman", "emigrate to canada", "save the game"];
const unresolved = [];
for (const cmd of common) { let r = null; try { r = keywordResolve(cmd); } catch (e) { r = "THREW:" + e.message; } if (!r || String(r).startsWith("THREW")) unresolved.push(cmd + (r ? " " + r : "")); }
ok(unresolved.length === 0, "no-AI keyword router resolves all " + common.length + " common commands (missed: " + unresolved.join(" | ") + ")");
// regression guards: these once mis-fired to the WRONG action
const routesTo = (cmd, needle) => { let r = ""; try { r = keywordResolve(cmd) || ""; } catch (e) { r = "THREW:" + e.message; } ok(String(r).toLowerCase().includes(needle), '"' + cmd + '" routes to ' + needle + ' (got: ' + r + ')'); };
createNewLife({ first: "Reg", last: "Test", seed: "5151" });
game.character.age = 30; game.character.lifeStage = lifeStageFor(30); game.character.money = 500000;
routesTo("run for office", "office");   // was: "Go for a run" activity
routesTo("save the game", "save");      // was: age up
routesTo("rob a bank", "crime");        // was: take a loan
routesTo("see a doctor", "clinic");     // was: apply for a job
routesTo("date someone", "find love");  // was: file a lawsuit
checkInvariants("post-nl-dispatch", ok);
// immediate feedback: a blocked NL action must leave a visible 🚫 reason in the feed
// (the "kill mom at age 4 → nothing happened" bug) and must NOT execute.
createNewLife({ first: "Kid", last: "Test", seed: "9300" });
game.character.age = 4; game.character.lifeStage = lifeStageFor(4);
const mum = addRelationship({ relation: "mother", name: "Mum Test", gender: "female", age: 34, bar: 80 });
let lb = game.log.length;
dispatchAction("hireHitman", { target: "Mum Test", tierId: "street" });
ok(mum.alive, "a 4-year-old cannot hire a hitman (age-gated)");
ok(game.log.slice(lb).some(e => /🚫/.test(e.text)), "blocked age-gated NL action gives a visible feed reason (got: " + JSON.stringify(game.log.slice(lb).map(e => e.text)) + ")");
// incest is refused with feed feedback too, via interact's bail()
game.character.age = 30; game.character.lifeStage = lifeStageFor(30);
lb = game.log.length;
dispatchAction("interact", { target: "Mum Test", action: "propose" });
ok(!mum.flags.married, "cannot marry a blood relative via NL");
ok(game.log.slice(lb).some(e => /🚫/.test(e.text)), "blocked incest NL action gives a visible feed reason");
checkInvariants("post-feedback", ok);
// no-AI relationship/pet targeting: verb + target ("mom", "my wife", "the dog", species)
// resolve deterministically so common commands work instantly without the LLM.
createNewLife({ first: "Tgt", last: "Test", seed: "8801" });
game.character.age = 30; game.character.lifeStage = lifeStageFor(30);
addRelationship({ relation: "mother", name: "Ava T", gender: "female", age: 60, bar: 70 });
const _w = addRelationship({ relation: "spouse", name: "Mia T", gender: "female", age: 29, bar: 80 }); _w.flags.married = true;
addRelationship({ relation: "pet", name: "🐹 Olivia", gender: "female", age: 1, bar: 80, training: 50, species: "hamster" });
addRelationship({ relation: "pet", name: "🐹 Henry", gender: "male", age: 1, bar: 80, training: 50, species: "hamster" });
const _pi = (s) => { const x = parseInteract(s); return x ? x.action : null; };
ok(_pi("give mom a gift") === "gift", "no-AI: 'give mom a gift' → gift");
ok(_pi("give my wife money") === "giveMoney", "no-AI: 'give my wife money' → giveMoney");
ok(_pi("divorce my wife") === "divorce", "no-AI: 'divorce my wife' → divorce");
ok(_pi("breed the hamsters") === "petBreed", "no-AI: 'breed the hamsters' → petBreed");
ok(_pi("walk the dog") === "petWalk", "no-AI: 'walk the dog' → petWalk");
ok(_pi("buy some groceries") === null, "no-AI: non-relationship text → no false interact");
const _mom = resolveRelTarget("compliment mom"); ok(!!_mom && game.relationships.find(r => r.id === _mom).relation === "mother", "resolveRelTarget 'mom' → the mother");

// Semantic router (embeddings) PLUMBING — validated with a deterministic mock embedder
// (keyword-overlap vectors). REAL semantic accuracy is measured in-browser at
// #test=embeddings (the model can't download in this sandbox). Here we check the
// index builds from the catalog, embedMatch returns the nearest intent, and the
// labeled EMBED_TESTSET targets are all valid.
const _mock = (s) => { const d = 96, v = new Array(d).fill(0); for (const w of (String(s).toLowerCase().match(/[a-z]{3,}/g) || [])) { let h = 0; for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0; v[h % d] += 1; } const n = Math.hypot(...v) || 1; return v.map(x => x / n); };
_embedFn = _mock; embedReady = true;
await buildIntentIndex();
ok(Array.isArray(_intentIndex) && _intentIndex.length >= ACTION_CATALOG.length, "embedding intent index builds from catalog + interact verbs (" + (_intentIndex ? _intentIndex.length : 0) + ")");
const _cids = new Set(ACTION_CATALOG.map(e => e.id));
const _m1 = await embedMatch("buy shares of a stock"); ok(!!_m1 && _cids.has(_m1.id) && typeof _m1.score === "number", "embedMatch returns a valid scored catalog intent (mock; real accuracy at #test=embeddings)");
const _m2 = await embedMatch("go to the gym"); ok(!!_m2 && typeof _m2.margin === "number", "embedMatch returns a margin vs 2nd-best");
let _badTS = null;
for (const [q, want] of EMBED_TESTSET) { if (want.indexOf(":") >= 0) { if (want.split(":")[0] !== "interact" || !INTERACT_ACTIONS.includes(want.split(":")[1])) _badTS = q; } else if (!_cids.has(want)) _badTS = q; }
ok(_badTS === null, "EMBED_TESTSET targets are all valid catalog ids / interact actions" + (_badTS ? " (" + _badTS + ")" : ""));
_embedFn = null; embedReady = false; _intentIndex = null;
// death-cause attribution: a sick CHILD must never "die of old age" (live bug: age 6).
createNewLife({ first: "Sick", last: "Child", seed: "6006" });
game.character.age = 6; game.character.lifeStage = lifeStageFor(6); game.character.stats.health = 70;
game.character.conditions = [{ id: "infect", label: "a chest infection", severity: 80, drain: 0 }];
checkDeath();
ok(!game.character.alive, "a severe untreated condition can be fatal");
ok(/complications/.test(game.character.causeOfDeath || "") && !/old age/.test(game.character.causeOfDeath || ""), "child death attributed to the illness, not 'old age' (got: " + game.character.causeOfDeath + ")");
// extreme age still reads as old age
createNewLife({ first: "Old", last: "Timer", seed: "6007" });
game.character.age = 125; game.character.lifeStage = lifeStageFor(125); game.character.stats.health = 70; game.character.conditions = [];
checkDeath();
ok(!game.character.alive && /old age/.test(game.character.causeOfDeath || ""), "extreme age dies of old age (got: " + game.character.causeOfDeath + ")");

// 1) ensureState migrates a synthetic pre-refactor save (missing new subsystem fields)
createNewLife({ first: "Old", last: "Save", seed: "1234" });
const oldSave = JSON.parse(snap());
for (const k of ["obligations","throne","business","social","military","mortgageBalance","loanBalance"]) delete oldSave[k];
delete oldSave.prison.respect; delete oldSave.prison.contraband;
localStorage.setItem("bitlife_save_mig", JSON.stringify(oldSave));
ok(loadLife("mig"), "old save loads");
ok(Object.keys(STATE_SCHEMA).every(k => k in game), "ensureState backfilled every schema field");
ok(Array.isArray(game.obligations) && game.throne === null && game.prison.respect === 0, "migrated defaults correct");
checkInvariants("post-migration", ok);

// 1b) Custody & alimony: marry, have a minor child, divorce → obligations set up,
//     custody assigned, and tickObligations drains cash then ends the obligation.
createNewLife({ first: "Div", last: "Test", seed: "4242" });
game.character.age = 35; game.character.lifeStage = lifeStageFor(35); game.character.money = 500000;
game.character.job = { title: "Engineer", salary: 120000, levelName: "Senior", yearsHeld: 5 };
const spouse = addRelationship({ relation: "spouse", name: "Pat Ex", gender: "female", age: 34, bar: 70 });
spouse.flags.married = true;
const kid = addRelationship({ relation: "child", name: "Kid Test", gender: "male", age: 8, bar: 60, isPlayerChild: true });
interact(spouse.id, "divorce");
ok(spouse.relation === "exspouse", "spouse becomes ex on divorce");
ok(["you","ex","joint"].includes(kid.custody), "minor child gets a custody value");
ok(game.obligations.some(o => o.type === "alimony"), "alimony obligation created (breadwinner, no prenup)");
checkInvariants("post-divorce", ok);
const oblBefore = game.obligations.length, moneyBefore = game.character.money;
tickObligations();
ok(game.character.money < moneyBefore, "tickObligations drains cash");
checkInvariants("post-tickObligations", ok);
// run out the longest term; obligations must all expire (no permanent drain)
for (let y = 0; y < 25; y++) tickObligations();
ok(game.obligations.length === 0, "all obligations expire within their term");
// prenup divorce: no alimony
createNewLife({ first: "Pre", last: "Nup", seed: "4243" });
game.character.age = 35; game.character.lifeStage = lifeStageFor(35); game.character.money = 500000;
game.character.job = { title: "Engineer", salary: 120000, levelName: "Senior", yearsHeld: 5 };
const sp2 = addRelationship({ relation: "spouse", name: "Prenup Ex", gender: "male", age: 36, bar: 65 });
sp2.flags.married = true; sp2.flags.prenup = true;
interact(sp2.id, "divorce");
ok(!game.obligations.some(o => o.type === "alimony"), "prenup blocks alimony");

// 2) Six seeded lives to death; ALL invariants each year
for (let s = 0; s < 6; s++) {
  createNewLife({ first: "Sim", last: "Test", seed: String(7000 + s) });
  let guard = 0;
  while (game.character.alive && guard < 200) {
    if (game.pendingEvent) {
      const ev = game.pendingEvent; let idx = 0; const ch = ev.choices || [];
      for (let i = 0; i < ch.length; i++) { if (!ch[i].minigame) { idx = i; break; } }
      applyChoice(ev.id, idx);
    } else { ageUp(); }
    checkInvariants("seed " + s + " age " + game.character.age, ok);
    guard++;
  }
  ok(guard < 200, "life " + s + " ended within 200y");
  ok(JSON.parse(snap()).character.name === game.character.name, "save round-trips seed " + s);
}

// 3) Fuzz pass
createNewLife({ first: "Fuzz", last: "Test", seed: "8000" });
game.character.age = 25; game.character.lifeStage = lifeStageFor(25); game.character.money = 5000000;
for (let i = 0; i < 200 && game.character.alive; i++) {
  const a = PLAYER_ACTIONS[rngInt(0, PLAYER_ACTIONS.length - 1)];
  try { a.run(); } catch (e) {}
  checkInvariants("fuzz " + a.fn, ok);
  if (i % 7 === 0) { ageUp(); if (game.pendingEvent) game.pendingEvent = null; checkInvariants("fuzz ageUp", ok); }
}

// 4) Prison audit
createNewLife({ first: "Jail", last: "Test", seed: "9000" });
game.character.age = 30; game.character.lifeStage = lifeStageFor(30); game.character.money = 100000;
game.prison = { inPrison: true, sentenceYears: 10, yearsServed: 1, reason: "test" };
game.pendingEvent = null; fireYearlyEvent();
ok(game.pendingEvent == null, "no life event fires in prison");
for (const a of PLAYER_ACTIONS) {
  const before = snap();
  try { a.run(); } catch (e) {}
  if (a.prison === "block") ok(snap() === before, "blocked in prison: " + a.fn + (a.guard ? " (" + a.guard + ")" : ""));
  checkInvariants("prison " + a.fn, ok);
}

// 5) Prison depth: respect stays bounded, contraband never negative, riots/shakedowns
//    keep every invariant across many years inside.
createNewLife({ first: "Pris", last: "Depth", seed: "5150" });
game.character.age = 30; game.character.lifeStage = lifeStageFor(30); game.character.money = 50000;
game.prison = { inPrison: true, sentenceYears: 40, yearsServed: 1, reason: "test", respect: 0, contraband: 0 };
for (let y = 0; y < 60 && game.prison.inPrison; y++) {
  game.yearActions = {};
  joinPrisonGang(); prisonContraband(); prisonYearlyEvent();
  ok(game.prison.respect >= 0 && game.prison.respect <= 100, "respect bounded year " + y);
  ok((game.prison.contraband || 0) >= 0, "contraband >= 0 year " + y);
  ok(game.prison.yearsServed <= game.prison.sentenceYears, "sentence self-consistent year " + y);
  checkInvariants("prison-depth year " + y, ok);
}
// prison-only actions must no-op when free
createNewLife({ first: "Free", last: "Pris", seed: "5151" });
game.character.age = 30; game.character.lifeStage = lifeStageFor(30);
const fb = snap(); prisonContraband(); joinPrisonGang();
ok(snap() === fb, "prison actions no-op when not jailed");

// 6) Monarchy: ascend, rule via decrees, keep approval/treasury bounded; abdicate.
createNewLife({ first: "Reg", last: "Ina", seed: "6160" });
game.character.age = 40; game.character.lifeStage = lifeStageFor(40); game.character.gender = "female";
game.flags.royal = true;
ascendThrone();
ok(game.throne && game.throne.monarch && game.throne.title === "Queen", "ascend creates a reigning Queen");
ok(game.achievements.includes("monarch"), "monarch ribbon granted on ascension");
for (let y = 0; y < 80; y++) {
  game.yearActions = {};
  royalDecree(["taxUp","taxDown","festival","war"][y % 4]);
  ok(game.throne == null || (game.throne.approval >= 0 && game.throne.approval <= 100 && game.throne.treasury >= 0), "throne bounded year " + y);
  checkInvariants("monarchy year " + y, ok);
  if (!game.throne) break;   // overthrown
}
// decrees only personal income is gated royalDuties — a decree must NOT raise money
if (game.throne) {
  game.yearActions = {}; const mBefore = game.character.money; royalDecree("taxUp");
  ok(game.character.money === mBefore, "decrees never touch personal money (no faucet)");
}
// abdication relinquishes the crown
if (game.throne) { game.yearActions = {}; abdicate(); ok(game.throne == null && game.flags.abdicated, "abdicate gives up the throne"); }
// monarchy actions no-op for a commoner
createNewLife({ first: "Com", last: "Moner", seed: "6161" });
game.character.age = 40; game.character.lifeStage = lifeStageFor(40);
const cb = snap(); royalDecree("festival"); nameThroneHeir(); abdicate();
ok(snap() === cb, "monarchy actions no-op without a throne");
// marry-into-royalty grants royal status
createNewLife({ first: "Mar", last: "Ryin", seed: "6162" });
game.character.age = 28; game.character.lifeStage = lifeStageFor(28); game.character.stats.looks = 99; game.character.fame = 50;
const royalPartner = addRelationship({ relation: "partner", name: "Royal Match", gender: "male", age: 30, bar: 95, flags: { dating: true, royal: true } });
interact(royalPartner.id, "propose");
ok(!royalPartner.flags.married || game.flags.royal, "marrying a royal grants royal status");

// 7) Event cond-gating: a royal-only event is hidden from a commoner, shown to royalty.
createNewLife({ first: "Cond", last: "Gate", seed: "7777" });
const royalEv = (DATA.EVENTS.adult || []).find(e => e.cond === "royal");
ok(!!royalEv, "a royal-gated event exists");
ok(royalEv && !eventCondMet(royalEv), "royal event hidden from a commoner");
game.flags.royal = true;
ok(royalEv && eventCondMet(royalEv), "royal event available once royal");
// every event's cond (if any) names a known predicate
let badCond = null;
for (const arr of Object.values(DATA.EVENTS)) for (const e of arr) if (e.cond && !EVENT_CONDS[e.cond]) badCond = e.id;
ok(badCond === null, "no event names an unknown cond" + (badCond ? " (" + badCond + ")" : ""));

// 7b) Action-outcome audit: every ACTION_CATALOG entry must dispatch WITHOUT throwing
//     in a valid state, leaving invariants + plausibility intact (catches crashes /
//     reference errors / nonsensical side-effects across the whole NL surface).
createNewLife({ first: "Act", last: "Audit", seed: "9200" });
game.character.age = 30; game.character.lifeStage = lifeStageFor(30); game.character.money = 1000000;
addRelationship({ relation: "friend", name: "Pal Test", gender: "male", age: 30, bar: 60 });
let actThrew = null;
for (const e of ACTION_CATALOG) {
  try {
    const args = {};
    for (const p of e.params) { if (p.type === "int") args[p.name] = p.min || 1; else { const vals = paramValues(p, args); if (vals.length) args[p.name] = vals[0].id; } }
    dispatchAction(e.id, args);
  } catch (err) { actThrew = e.id + ": " + (err && err.message || err); break; }
  checkInvariants("action " + e.id, ok); checkPlausibility("action " + e.id, ok);
}
ok(actThrew === null, "every catalog action dispatches without throwing" + (actThrew ? " (" + actThrew + ")" : ""));

// 8) Statistical census: simulate many lives to death, running INVARIANTS +
//    PLAUSIBILITY every year, and assert population tolerance bands. This is the
//    net for RATE/semantic bugs ("kids dying young", "old age under 50").
const __census = runCensus(500, ok);
console.log(censusSummary(__census));

const green = fail === 0;
console.log((green ? "ALL PASS \\u2705" : "FAILURES \\u274c") + " — " + pass + " passed, " + fail + " failed (" + INVARIANTS.length + " invariants, " + PLAYER_ACTIONS.length + " actions)");
if (!green) { for (const m of fails) console.log("  FAIL: " + m); }
globalThis.__exit = green ? 0 : 1;
`;

const file = path.join(root, "tests", ".bl_headless.gen.mjs");
fs.writeFileSync(file, prelude + "\n" + engine + "\n" + driver);
try { await import("file://" + file + "?t=" + Date.now()); }
finally { try { fs.unlinkSync(file); } catch {} }
process.exit(globalThis.__exit ?? 1);
