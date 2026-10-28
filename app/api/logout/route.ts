import {sameOrigin} from '@/lib/server';
export async function POST(req:Request){if(!sameOrigin(req))return new Response('Forbidden',{status:403});return Response.json({ok:true},{headers:{'Set-Cookie':'os_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'}});}
