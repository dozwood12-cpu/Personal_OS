import {authorized} from '@/lib/server';
import Workspace from '@/components/workspace';
export default async function Page(){return <Workspace initialAuth={await authorized()}/>;}
