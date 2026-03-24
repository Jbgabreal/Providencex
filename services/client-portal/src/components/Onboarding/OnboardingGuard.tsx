'use client';

import { useMt5Accounts } from '@/hooks/useMt5Accounts';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { OnboardingWizard } from './OnboardingWizard';

export function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { data: accounts, isLoading } = useMt5Accounts();
  const { isMentor, isLoading: userLoading } = useCurrentUser();

  // Don't show wizard while loading
  if (isLoading || userLoading) return <>{children}</>;

  const hasAccounts = accounts && accounts.length > 0;

  // Mentors without MT5 accounts can skip onboarding — they don't need to trade
  if (!hasAccounts && isMentor) {
    return <>{children}</>;
  }

  // Traders without MT5 accounts must complete onboarding
  if (!hasAccounts) {
    return <OnboardingWizard />;
  }

  return <>{children}</>;
}
