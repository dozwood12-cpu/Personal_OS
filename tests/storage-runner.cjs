// Supply an authenticated request context to storage unit fixtures; production
// database access now always requires a validated session.
const Module=require('node:module');
const original=Module._load;
Module._load=function(name,...args){if(name==='next/headers')return {cookies:async()=>{const {SignJWT}=require('jose');const token=await new SignJWT({role:'admin'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(new TextEncoder().encode(process.env.SESSION_SECRET));return {get:key=>key==='os_session'?{value:token}:undefined};}};return original.call(this,name,...args)};
require('./storage.test.ts');
