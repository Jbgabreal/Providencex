'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePlatformPlans, useSupportedPaymentRails, useCreatePlatformInvoice, useBillingStatus } from '@/hooks/useBilling';
import { Check, Zap, Crown, ArrowRight } from 'lucide-react';

export default function PricingPage() {
  const router = useRouter();
  const { data: plans, isLoading: plansLoading } = usePlatformPlans();
  const { data: rails } = useSupportedPaymentRails();
  const { data: billingStatus } = useBillingStatus();
  const createInvoice = useCreatePlatformInvoice();

  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [selectedRail, setSelectedRail] = useState<string>('');
  const [showCheckout, setShowCheckout] = useState(false);

  const currentPlanSlug = billingStatus?.entitlements?.platformPlan?.slug || 'free';

  const handleSelectPlan = (planId: string, slug: string) => {
    if (slug === 'free' || slug === currentPlanSlug) return;
    setSelectedPlan(planId);
    setShowCheckout(true);
  };

  const handleCreateInvoice = async () => {
    if (!selectedPlan || !selectedRail) return;
    try {
      const invoice = await createInvoice.mutateAsync({
        platform_plan_id: selectedPlan,
        payment_rail: selectedRail,
      });
      router.push(`/billing/invoice/${invoice.id}`);
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to create invoice');
    }
  };

  const planIcons: Record<string, React.ReactNode> = {
    free: null,
    pro: <Zap className="h-6 w-6 text-blue-600" />,
    premium: <Crown className="h-6 w-6 text-purple-600" />,
  };

  const planColors: Record<string, string> = {
    free: 'border-gray-200',
    pro: 'border-blue-500 ring-2 ring-blue-100',
    premium: 'border-purple-500 ring-2 ring-purple-100',
  };

  if (plansLoading) {
    return <div className="p-6"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto" /></div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Platform Plans</h1>
        <p className="text-gray-500 mt-2">Choose the plan that fits your trading needs</p>
        {currentPlanSlug !== 'free' && (
          <p className="text-sm text-green-600 mt-1 font-medium">
            Current plan: {currentPlanSlug.charAt(0).toUpperCase() + currentPlanSlug.slice(1)}
          </p>
        )}
      </div>

      <div className="grid md:grid-cols-3 gap-6 mb-8">
        {(plans || []).map((plan: any) => {
          const isCurrent = plan.slug === currentPlanSlug;
          return (
            <div
              key={plan.id}
              className={`bg-white rounded-xl border-2 p-6 ${planColors[plan.slug] || 'border-gray-200'} ${
                isCurrent ? 'opacity-75' : ''
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                {planIcons[plan.slug]}
                <h2 className="text-xl font-bold text-gray-900">{plan.name}</h2>
              </div>
              <p className="text-sm text-gray-500 mb-4">{plan.description}</p>

              <div className="mb-6">
                {plan.price_usd > 0 ? (
                  <div className="flex items-baseline">
                    <span className="text-4xl font-bold text-gray-900">${plan.price_usd}</span>
                    <span className="text-gray-500 ml-1">/month</span>
                  </div>
                ) : (
                  <span className="text-4xl font-bold text-gray-900">Free</span>
                )}
              </div>

              <ul className="space-y-3 mb-6">
                {(plan.features || []).map((feature: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <Check className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <div className="w-full px-4 py-2.5 bg-gray-100 text-gray-500 rounded-lg font-medium text-center text-sm">
                  Current Plan
                </div>
              ) : plan.price_usd > 0 ? (
                <button
                  onClick={() => handleSelectPlan(plan.id, plan.slug)}
                  className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 text-sm flex items-center justify-center gap-1"
                >
                  Upgrade <ArrowRight className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Checkout Modal */}
      {showCheckout && selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Select Payment Method</h3>

            <div className="space-y-3 mb-6">
              {(rails || []).map((rail: any) => (
                <label
                  key={rail.rail}
                  className={`flex items-center p-3 border-2 rounded-lg cursor-pointer transition-colors ${
                    selectedRail === rail.rail ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="payment_rail"
                    value={rail.rail}
                    checked={selectedRail === rail.rail}
                    onChange={(e) => setSelectedRail(e.target.value)}
                    className="mr-3"
                  />
                  <div>
                    <p className="font-medium text-sm text-gray-900">{rail.displayName}</p>
                    <p className="text-xs text-gray-500">{rail.chain} network</p>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleCreateInvoice}
                disabled={!selectedRail || createInvoice.isPending}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 text-sm"
              >
                {createInvoice.isPending ? 'Creating...' : 'Continue to Payment'}
              </button>
              <button
                onClick={() => { setShowCheckout(false); setSelectedPlan(null); setSelectedRail(''); }}
                className="px-4 py-2.5 bg-gray-200 text-gray-700 rounded-lg text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
