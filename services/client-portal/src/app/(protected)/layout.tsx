import { AuthGuard } from '@/components/AuthGuard';
import { Shell } from '@/components/Layout/Shell';
import { OnboardingGuard } from '@/components/Onboarding/OnboardingGuard';

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <OnboardingGuard>
        <Shell>{children}</Shell>
      </OnboardingGuard>
    </AuthGuard>
  );
}
