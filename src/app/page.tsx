import { redirect } from 'next/navigation';
import { pageUser } from '@/server/auth/page';
export default async function Home() { const user = await pageUser(); redirect(user.role === 'DRIVER' ? '/d' : '/m'); }
