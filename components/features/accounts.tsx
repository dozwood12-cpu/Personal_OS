'use client';
import { useEffect,useState,type FormEvent } from 'react';
export default function Accounts(){
 const [data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(){const r=await fetch('/api/accounts',{cache:'no-store'});const d=await r.json();setData(d);if(!r.ok)setError(d.error);}
 useEffect(()=>{void load().catch(()=>setError('Daftar akun gagal dimuat'));},[]);
 async function send(body:unknown){setBusy(true);setError('');try{const r=await fetch('/api/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error);await load();return true;}catch(e){setError((e as Error).message);return false;}finally{setBusy(false);}}
 async function create(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget;const values=Object.fromEntries(new FormData(form));if(await send({action:'create',...values}))form.reset();}
 if(data?.user?.role!=='admin'&&!error)return null;
 return <section className="panel"><h3>Kelola akun</h3>{error&&<p role="alert" className="error">{error}</p>}
 <p className="muted">Setiap akun memakai proyek Supabase terpisah. Jalankan seluruh migrasi ORBIT pada proyek pengguna terlebih dahulu. Gunakan TOKEN_ENCRYPTION_KEY yang tetap di Vercel untuk melindungi kredensial database.</p>
 <form onSubmit={create} className="settings-grid" autoComplete="off">
 <label>Username<input name="username" required pattern="[a-z0-9_.-]{3,64}" minLength={3} maxLength={64}/></label>
 <label>Password<input name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password"/></label>
 <label>URL Supabase pengguna<input name="url" type="url" required placeholder="https://project.supabase.co"/></label>
 <label>Service role key pengguna<input name="key" type="password" required autoComplete="new-password"/></label>
 <button className="primary" disabled={busy}>Tambah akun</button></form>
 <div className="table-scroll"><table><thead><tr><th>Username</th><th>Database</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{data?.accounts?.map((a:any)=><tr key={a.id}><td>{a.username}</td><td>{a.project_url}</td><td>{a.active?'Aktif':'Nonaktif'}</td><td><div className="toolbar"><button disabled={busy} onClick={()=>void send({action:'active',id:a.id,active:!a.active})}>{a.active?'Nonaktifkan':'Aktifkan'}</button><button disabled={busy} onClick={()=>{const password=prompt('Password baru (minimal 10 karakter)');if(password)void send({action:'password',id:a.id,password});}}>Reset password</button></div></td></tr>)}</tbody></table></div>
 </section>;
}
