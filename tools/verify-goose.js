// Offline rules checks: node tools/verify-goose.js
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../games/goose/index.html'), 'utf8');
class Element {
  constructor() { this.style = {}; this.dataset = {}; this.classList = { toggle() {}, add() {} }; this.hidden = true; }
  querySelectorAll() { return []; }
  setAttribute() {}
  focus() {}
  replaceChildren() {}
  append() {}
  addEventListener() {}
}
const nodes = new Map();
const document = {
  activeElement: new Element(),
  getElementById(id) { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); },
  createElement() { return new Element(); },
  querySelector() { return new Element(); },
};
const ctx = vm.createContext({ document, console, assert });
vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], ctx);
vm.runInContext(`
function checkInvariant(){
 assert.equal(tiles.length+tray.length+cleared,total);
 const counts=Array(ITEMS.length).fill(0);
 for(const t of [...tiles,...tray]){ assert.ok(Number.isInteger(t.type)); counts[t.type]++; }
 assert.ok(counts.every(n=>n%3===0));
}
function solve(){
 const order=solution.slice();
 for(const id of order){assert.equal(phase,'playing');const tile=tiles.find(t=>t.id===id);assert.ok(available(tile));pick(id);checkInvariant();}
 assert.equal(phase,'won');assert.equal(tiles.length,0);assert.equal(tray.length,0);
}
// The conservative deal grid must not reject a visible front-surface 3D hit.
start(0);
const exposed3D=tiles.find(t=>!available(t));
const gridState=JSON.stringify(snapshot());
pick(exposed3D.id,true);
assert.ok(!tiles.some(t=>t.id===exposed3D.id));
assert.equal(tray[0].id,exposed3D.id);
undo();assert.equal(JSON.stringify(snapshot()),gridState);
for(let round=0;round<100;round++) for(let stage=0;stage<3;stage++){
 start(stage);checkInvariant();
 const blocked=tiles.find(t=>!available(t));const before=JSON.stringify(snapshot());pick(blocked.id);assert.equal(JSON.stringify(snapshot()),before);
 const first=solution[0];pick(first);assert.equal(tray.length,1);undo();assert.equal(tray.length,0);assert.equal(uses.undo,2);assert.equal(tiles.length,total);
 // Shuffle with one or two already-held pieces must preserve triples and remain solvable.
 pick(solution[0]);if(round%2)pick(solution[1]);
 $('shuffle').onclick();checkInvariant();assert.equal(uses.shuffle,1);assert.equal(history.length,0);solve();
}
// Find a legal sequence that fills the tray, then verify loss recovery.
let lost=false;
for(let attempt=0;attempt<200&&!lost;attempt++){
 start(2);
 while(phase==='playing'){
  const free=tiles.filter(t=>available(t));
  free.sort((a,b)=>tray.filter(t=>t.type===a.type).length-tray.filter(t=>t.type===b.type).length);
  pick(free[0].id);
 }
 if(phase==='lost'){lost=true;assert.equal(tray.length,7);undo();assert.equal(phase,'playing');assert.ok(tray.length<7);checkInvariant();}
}
assert.ok(lost,'loss state must be reachable');
console.log('PASS: 300 generated levels, blocking, visible 3D hits, triples, solvable shuffles, undo, victory and loss recovery');
`, ctx);
