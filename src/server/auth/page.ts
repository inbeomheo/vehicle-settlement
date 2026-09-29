import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '../db/client';
import { authenticate } from './session';
export async function pageUser() {
  const cookie = (await cookies()).toString();
  try {
    return (
      await authenticate(
        getDb(),
        new Request('http://localhost', { headers: { cookie } }),
        crypto.randomUUID(),
      )
    ).user;
  } catch {
    redirect('/login');
  }
}
export async function guardPage(area: 'driver' | 'manager') {
  const user = await pageUser();
  if (area === 'driver' && user.role !== 'DRIVER') redirect('/m');
  if (area === 'manager' && user.role === 'DRIVER') redirect('/d');
  return user;
}
