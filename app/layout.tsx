import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'ORBIT — Personal OS',description:'Your finances, focus, and future. One personal operating system.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="id"><body>{children}</body></html>;}
