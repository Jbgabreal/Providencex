'use client';

import { useMt5Accounts } from '@/hooks/useMt5Accounts';
import { OnboardingWizard } from './OnboardingWizard';

export function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { data: accounts, isLoading } = useMt5Accounts();

  // Don't show wizard while loading
  if (isLoading) return <>{children}</>;

  // Show wizard if user has no MT5 accounts at all
  const hasAccounts = accounts && accounts.length > 0;
  if (!hasAccounts) {
    return <OnboardingWizard />;
  }

  return <>{children}</>;
}
