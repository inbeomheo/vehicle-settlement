import { AuthForm } from '@/components/auth-form';
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  return <AuthForm token={(await params).token} />;
}
