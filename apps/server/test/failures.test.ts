import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDb,seed} from '../src/db.ts';
import {hosts,projects} from '../src/store.ts';
import {createRemoteService} from '../src/remote.ts';
test('failed control restores maintenance and records uncertainty without replay',async()=>{
 const db=openDb(':memory:');seed(db);const host=hosts(db)[0];
 db.prepare('UPDATE hosts SET config=? WHERE id=1').run(JSON.stringify({...host,fingerprint:'SHA256:'+'a'.repeat(43)}));
 let actions=0;
 const remote=createRemoteService(db,async(_host,request)=>{
  if(request.operation==='status')return{projects:{oilorder:{runtime:'partial',composeProject:'categoryb-order',controlledServices:['frontend','api','worker','beat']}}};
  actions++;throw new Error('SSH 连接中断；结果需重新核对');
 });
 await remote.collect();const id=remote.queue(1,1,'restart');
 await new Promise(r=>setTimeout(r,30));
 assert.equal(db.prepare('SELECT status FROM tasks WHERE id=?').get(id)!.status,'uncertain');
 assert.equal(projects(db)[0].maintenance,false);
 assert.equal(projects(db)[0].runtime,'partial');remote.recover();assert.equal(actions,1);db.close();
});
test('control refuses mismatched remote allowlist even with fresh SSH status',async()=>{
 const db=openDb(':memory:');seed(db);const host=hosts(db)[0];
 db.prepare('UPDATE hosts SET config=? WHERE id=1').run(JSON.stringify({...host,fingerprint:'SHA256:'+'a'.repeat(43)}));
 const remote=createRemoteService(db,async()=>({projects:{oilorder:{runtime:'running',composeProject:'categoryb-order',controlledServices:['db','redis']}}}));
 await remote.collect();assert.throws(()=>remote.queue(1,1,'stop'),/不一致/);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tasks').get()!.n,0);db.close();
});
