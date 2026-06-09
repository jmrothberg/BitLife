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
checkInvariants("post-nl-dispatch", ok);

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
