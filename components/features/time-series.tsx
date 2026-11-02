'use client';
import {useState} from 'react';
import {DateField} from '@/components/ui/fields';
import {type Dataset,currency,dateToday} from '@/lib/model';
import {cashflow} from '@/lib/finance';
export default function TimeSeries({data,period}:{data:Dataset;period:number}){
 const [until,setUntil]=useState(dateToday);
 const buckets=cashflow(data,period,until);
 const [chosen,setChosen]=useState<string|null>(null);
 const [selected,setSelected]=useState<string[]|null>(null);
 const [showIncome,setShowIncome]=useState(true);
 const expenseCategories=data.categories.filter(c=>c.kind==='expense');
 const cats=new Map(data.categories.map(c=>[c.id,c]));
 const byBucket=new Map(buckets.map(b=>[b.key,[] as Dataset[string]]));
 for(const t of data.transactions){const key=String(t.date).slice(0,period===12?7:10);byBucket.get(key)?.push(t);}
 const series=[...(showIncome?[{id:'income',name:'Pemasukan',color:'var(--text)',dash:false,values:buckets.map(b=>b.income)}]:[]),...expenseCategories.filter(c=>selected===null||selected.includes(c.id)).map((c,i)=>({id:c.id,name:String(c.name),color:i===0?'var(--shu)':`var(--chart-gray-${i%4+1})`,dash:i>0,values:buckets.map(b=>(byBucket.get(b.key)||[]).filter(t=>t.category_id===c.id).reduce((n,t)=>n+Number(t.amount),0))}))];
 const max=Math.max(1,...series.flatMap(s=>s.values));
 const ceiling=max===1?1:Math.pow(10,Math.floor(Math.log10(max)))*Math.ceil(max/Math.pow(10,Math.floor(Math.log10(max))));
 const x=(i:number)=>76+i*640/Math.max(1,buckets.length-1),y=(v:number)=>236-v/ceiling*200;
 const active=buckets.find(b=>b.key===chosen)||buckets[buckets.length-1];
 const index=buckets.indexOf(active);
 const transactions=(byBucket.get(active.key)||[]).filter(t=>cats.get(String(t.category_id))?.kind==='income'?showIncome:selected===null||selected.includes(String(t.category_id))).sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.title).localeCompare(String(b.title)));
 const label=(key:string)=>new Date(key+(period===12?'-01':'')+'T12:00:00Z').toLocaleDateString('id-ID',{day:period===12?undefined:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
 return <section className="time-series" aria-label="Tren transaksi dari waktu ke waktu">
 <div className="section-head"><h3>Tren transaksi</h3><span className="muted">{period===12?'Bulanan':'Harian'} · Rp</span></div>
 <label className="series-period">Akhir periode<DateField aria-label="Akhir periode tren transaksi" value={until} onChange={e=>{if(e.target.value)setUntil(e.target.value);}} /></label>
 <div className="series-filters" role="group" aria-label="Garis yang ditampilkan"><label className="checkbox"><input type="checkbox" checked={showIncome} onChange={e=>setShowIncome(e.target.checked)}/>Pemasukan</label>{expenseCategories.map(c=><label className="checkbox" key={c.id}><input type="checkbox" checked={selected===null||selected.includes(c.id)} onChange={e=>{const all=selected??expenseCategories.map(c=>c.id);setSelected(e.target.checked?[...all,c.id]:all.filter(id=>id!==c.id));}}/>{String(c.name)}</label>)}</div>
 <div className="series-plot"><svg onPointerMove={(e)=>{const rect=e.currentTarget.getBoundingClientRect(); const i=Math.round(((e.clientX-rect.left)/rect.width*750-76)/640*(buckets.length-1));setChosen(buckets[Math.max(0,Math.min(buckets.length-1,i))].key);}} onClick={(e)=>{const rect=e.currentTarget.getBoundingClientRect(); const i=Math.round(((e.clientX-rect.left)/rect.width*750-76)/640*(buckets.length-1));setChosen(buckets[Math.max(0,Math.min(buckets.length-1,i))].key);}} className="series-chart" viewBox="0 0 750 286" role="img" aria-label="Grafik garis pemasukan dan kategori pengeluaran">
 {[0,1,2,3,4].map(i=><g key={i}><line x1="76" x2="716" y1={y(ceiling*i/4)} y2={y(ceiling*i/4)} stroke="var(--line)"/><text x="66" y={y(ceiling*i/4)+4} textAnchor="end">{new Intl.NumberFormat('id-ID',{notation:'compact',maximumFractionDigits:1}).format(ceiling*i/4)}</text></g>)}
 {buckets.map((b,i)=> i%Math.max(1,Math.ceil(buckets.length/6))===0||i===buckets.length-1?<text key={b.key} x={x(i)} y="264" textAnchor={i===buckets.length-1?'end':'middle'}>{label(b.key)}</text>:null)}
 {series.map(s=><polyline key={s.id} points={s.values.map((v,i)=>`${x(i)},${y(v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash?'5 3':undefined} />)}
 <line x1={x(index)} x2={x(index)} y1="28" y2="236" stroke="var(--text-muted)" strokeDasharray="3 4"/>
 {series.map(s=><circle key={s.id} cx={x(index)} cy={y(s.values[index])} r="4" fill={s.color}/>)}
 </svg></div>
 <div className="series-legend">{series.map(s=><span key={s.id}><i style={{background:s.color}}/>{s.name}</span>)}</div>
 <div className="series-dates" role="group" aria-label="Pilih tanggal tren">{buckets.map(b=><button type="button" key={b.key} aria-pressed={b.key===active.key} onClick={()=>setChosen(b.key)}>{label(b.key)}</button>)}</div>
 <div className="series-detail" aria-live="polite"><h4>{label(active.key)}</h4><div className="series-totals">{series.map(s=><span key={s.id}>{s.name}<strong>{currency(s.values[index])}</strong></span>)}</div>
 {transactions.length?<div className="series-events">{transactions.map(t=><div key={t.id}><span><small>{String(t.date)} · {String(cats.get(String(t.category_id))?.name||'')}</small>{String(t.title)}</span><strong>{cats.get(String(t.category_id))?.kind==='income'?'+':'−'}{currency(Number(t.amount))}</strong></div>)}</div>:<p className="muted">Belum ada transaksi pada pilihan ini.</p>}
 </div></section>;
}
