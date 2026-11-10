// Exercise the shipped rigid-body simulation without a browser or GPU.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const THREE = require('../assets/vendor/three.min.js');
const CANNON = require('../assets/vendor/cannon.min.js');
const source = fs.readFileSync(path.join(__dirname, '../games/goose/index.html'), 'utf8');
const start = source.indexOf('  // Rigid bodies use');
const end = source.indexOf('  function sync()', start);
const ctx = vm.createContext({ THREE, CANNON, assert, console });
vm.runInContext(`
let now=0,level=0,phase='playing';const T=THREE,reduced=false;
const objects=new Map(),world=new T.Group(),nodes=new Map();
const $=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,disabled:false});return nodes.get(id)};
const performance={now:()=>now};function requestDraw(){}function say(){}
const LEVELS=${source.match(/const LEVELS=([^;]+);/)[1]};
${source.slice(start, end)}
function advance(seconds){for(let i=0;i<seconds*60;i++){now+=1000/60;stepPhysics(now)}}
function clear(){for(const b of bodies.values())physics.removeBody(b);bodies.clear();objects.clear();previousTime=0;accumulator=0;}
function spawn(id,type,x,y,z){const tile={id,type,z:0};const obj=new T.Group();obj.position.set(x,y,z);objects.set(id,obj);return makeBody(tile,obj);}
for(level=0;level<3;level++){
 clear();let id=0;
 for(const [z,[cols,rows]] of LEVELS[level].layers.entries())for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
  const tile={id:id++,type:id%9,x:(100-cols*15.5)/2+c*15.5,y:(100-rows*18)/2+r*18,z};
  const obj=new T.Group();obj.position.copy(position(tile));objects.set(tile.id,obj);makeBody(tile,obj);
 }
 const initial=[...bodies.values()].map(b=>b.position.clone());advance(10);
 assert.ok([...bodies.values()].some((b,i)=>b.position.distanceTo(initial[i])>.5),'opening must drop objects');
 for(const b of bodies.values()){
  assert.ok([b.position.x,b.position.y,b.position.z,b.quaternion.w].every(Number.isFinite));
  assert.ok(Math.hypot(b.position.x,b.position.z)<=4.851,'objects stay in the bowl');
  assert.ok(b.position.y> -1&&b.position.y<5,'no floor tunnelling or runaway energy');
 }
 const state=motionSnapshot();shake();assert.ok([...bodies.values()].some(b=>b.velocity.y>1));advance(2);
 assert.ok([...bodies.values()].some((b,i)=>b.position.distanceTo(new C.Vec3(...state[i].p))>.1),'shake changes the arrangement');
 pendingMotion=state;applyMotion();assert.equal(JSON.stringify(motionSnapshot()),JSON.stringify(state),'undo restores position, rotation and velocities');
}
clear();level=1;
const lower=new C.Body({mass:0,material:bowlMaterial});lower.addShape(new C.Box(new C.Vec3(1.5,.2,1.5)));lower.position.set(0,.5,0);physics.addBody(lower);bodies.set(100,lower);objects.set(100,new T.Group());
const upper=spawn(101,2,0,1.2,0);upper.velocity.set(0,0,0);upper.angularVelocity.set(0,0,0);advance(6);
const supportedHeight=upper.position.y;physics.removeBody(lower);bodies.delete(100);objects.delete(100);wakePile();advance(3);
assert.ok(upper.position.y<supportedHeight-.4,'removing support makes the upper object fall');
clear();assert.equal(physics.bodies.length,33,'reset removes all dynamic bodies');
console.log('PASS: opening gravity, three pile sizes, containment, shake, exact undo, support removal and body cleanup');
`, ctx);
