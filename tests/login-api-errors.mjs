// Run against a production test instance with SESSION_SECRET unset.
import assert from 'node:assert/strict';
const base=process.env.TEST_BASE_URL||'http://localhost:3101';
for(const [body,origin,status,code] of [
 ['{}','https://other.example',403,'LOGIN_ORIGIN_REJECTED'],
 ['{',base,400,'LOGIN_INVALID_REQUEST'],
 [JSON.stringify({username:'admin',password:'wrong'}),base,401,'LOGIN_INVALID_CREDENTIALS'],
 [JSON.stringify({username:'admin',password:'admin'}),base,500,'LOGIN_SESSION_CONFIG'],
]){
 const r=await fetch(base+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body});
 assert.equal(r.status,status);const data=await r.json();assert.equal(data.code,code);assert.ok(data.requestId);assert.equal(typeof data.hint,'string');assert.equal(r.headers.get('cache-control'),'no-store');
 assert.doesNotMatch(JSON.stringify(data),/"password"\s*:|"stack"\s*:/);
}
console.log('PASS: JSON origin, invalid body, invalid credentials and missing session configuration errors, request IDs, no-store.');
