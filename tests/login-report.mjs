import assert from 'node:assert/strict';
import {loginReport,networkLoginReport} from '../lib/login-client.ts';
assert.equal(await loginReport(Response.json({ok:true})),null);
for(const [status,code] of [[401,'LOGIN_INVALID_CREDENTIALS'],[403,'LOGIN_ORIGIN_REJECTED'],[429,'LOGIN_RATE_LIMITED'],[500,'LOGIN_SESSION_CONFIG'],[500,'LOGIN_SESSION_FAILED']]){
 const r=await loginReport(Response.json({code,error:'secret-value-do-not-display',hint:'password-do-not-display',requestId:'12345678-1234-1234-1234-123456789abc'},{status}));
 assert.match(r,new RegExp(code));assert.match(r,new RegExp(`HTTP: ${status}`));assert.match(r,/12345678-1234-1234-1234-123456789abc/);assert.doesNotMatch(r,/do-not-display/);
}
const html=await loginReport(new Response('<html>private upstream details</html>',{status:502}));assert.match(html,/LOGIN_NON_JSON_RESPONSE/);assert.doesNotMatch(html,/private upstream details/);
const unexpected=await loginReport(Response.json({ok:false,code:'private-code',requestId:'private-id'}));assert.match(unexpected,/LOGIN_UNEXPECTED_RESPONSE/);assert.doesNotMatch(unexpected,/private-/);
assert.match(networkLoginReport(),/LOGIN_NETWORK_ERROR/);
console.log('PASS: structured errors, HTTP codes, request ID, HTML response, unexpected JSON, network failure, sensitive response redaction.');
