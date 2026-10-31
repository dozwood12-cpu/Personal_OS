const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {AsyncLocalStorage}=require('node:async_hooks');
const contexts=new AsyncLocalStorage(),modules=new Map();
const master='https://master.supabase.co',a='https://alpha.supabase.co',b='https://beta.supabase.co';
process.env.SUPABASE_URL=master;process.env.SUPABASE_SERVICE_ROLE_KEY='master-key';process.env.SESSION_SECRET='x'.repeat(40);process.env.TOKEN_ENCRYPTION_KEY='ab'.repeat(32);
const rows=new Map();
function client(url,key){return {url,key,from(table){let id;return {select(){return this},eq(k,v){if(k==='id')id=v;return this},async maybeSingle(){return {data:rows.get(id)?.active?rows.get(id):null,error:null}}}}};}
function load(file){file=path.resolve(file);if(modules.has(file))return modules.get(file).exports;const m={exports:{}};modules.set(file,m);const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;function req(name){if(name==='server-only')return {};if(name==='next/headers')return {cookies:async()=>({get:k=>contexts.getStore()?.[k]?{value:contexts.getStore()[k]}:undefined})};if(name==='react')return {cache:fn=>fn};if(name==='@supabase/supabase-js')return {createClient:client};if(name.startsWith('@/'))return load(path.resolve(name.slice(2))+'.ts');if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name)+'.ts');return require(name);}new Function('require','module','exports',code)(req,m,m.exports);return m.exports;}
(async()=>{const server=load('lib/server.ts'),crypto=load('lib/storage/crypto.ts'),accounts=load('lib/accounts.ts');
const hash=accounts.hashPassword('correct-password');assert(accounts.verifyPassword('correct-password',hash));assert(!accounts.verifyPassword('wrong',hash));assert.notEqual(hash,accounts.hashPassword('correct-password'));
for(const bad of ['http://localhost','https://127.0.0.1','https://foo.supabase.co.evil.com','https://foo.supabase.co/path','https://user@foo.supabase.co'])assert.throws(()=>accounts.projectUrl(bad));
assert.equal(accounts.projectUrl(a),a);
for(const [id,url] of [['a',a],['b',b]])rows.set(id,{id,username:id,active:true,session_version:1,credentials:crypto.seal(JSON.stringify({url,key:id+'-key'}),'orbit:account:'+id)});
const ta=await server.token('a'),tb=await server.token('b'),admin=await server.token();
async function as(t,fn){return contexts.run({os_session:t},fn)}
const results=await Promise.all(Array.from({length:20},(_,i)=>as(i%2?ta:tb,async()=>{await new Promise(r=>setTimeout(r,i%3));return (await server.db()).url})));results.forEach((url,i)=>assert.equal(url,i%2?a:b));
assert.equal(await as(admin,async()=>(await server.db()).url),master);
await assert.rejects(()=>as(undefined,()=>server.db()));
const api=load('app/api/accounts/route.ts');const memberResponse=await as(ta,()=>api.GET());const memberBody=await memberResponse.json();assert.equal(memberBody.user.role,'member');assert(!JSON.stringify(memberBody).includes('credentials'));assert.equal((await as(ta,()=>api.POST(new Request('https://orbit.test/api/accounts',{method:'POST',headers:{origin:'https://orbit.test',host:'orbit.test'}})))).status,403);
rows.get('a').active=false;assert.equal(await as(ta,()=>server.authorized()),false);rows.get('a').active=true;
rows.get('a').session_version=2;assert.equal(await as(ta,()=>server.authorized()),false);await assert.rejects(()=>as(ta,()=>server.db()));
const fresh=await server.token('a',2);assert.equal(await as(fresh,()=>server.authorized()),true);
rows.delete('a');assert.equal(await as(fresh,()=>server.authorized()),false);
const copied=rows.get('b').credentials;assert.throws(()=>crypto.unseal(copied,'orbit:account:a'));
console.log('PASS: salted password hashes, URL restrictions, concurrent account database isolation, admin routing, unauthenticated denial, session revocation, deleted accounts, credential context authentication.');
})().catch(e=>{console.error(e);process.exit(1)});
