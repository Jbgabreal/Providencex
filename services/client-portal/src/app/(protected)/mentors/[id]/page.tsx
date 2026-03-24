'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { usePublicMentorProfile } from '@/hooks/usePublicMentors';
import { useFollowerSubscriptions, useSubscribeToMentor } from '@/hooks/useFollowerSubscriptions';
import { useMt5Accounts } from '@/hooks/useMt5Accounts';
import { useMentorPlans, useSupportedPaymentRails, useCreateMentorInvoice } from '@/hooks/useBilling';
import { useMentorBadges, useMentorReviews, useCreateMentorReview, useSimilarMentors } from '@/hooks/useMarketplace';
import { Users, Shield, TrendingUp, TrendingDown, ChevronDown, ChevronUp, ArrowLeft, CreditCard, Star, Award } from 'lucide-react';
import Link from 'next/link';

export default function MentorProfilePage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const { data, isLoading } = usePublicMentorProfile(id);
  const { data: subscriptions } = useFollowerSubscriptions();
  const { data: accounts } = useMt5Accounts();
  const { data: mentorPlans } = useMentorPlans(id);
  const { data: rails } = useSupportedPaymentRails();
  const subscribeMutation = useSubscribeToMentor();
  const createMentorInvoice = useCreateMentorInvoice();
  const { data: badges } = useMentorBadges(id);
  const { data: reviewsData } = useMentorReviews(id);
  const createReview = useCreateMentorReview();
  const { data: similarMentors } = useSimilarMentors(id);

  const [showSubscribe, setShowSubscribe] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [riskAmount, setRiskAmount] = useState(1);
  const [selectedTps, setSelectedTps] = useState([1, 2]);
  const [showMonthly, setShowMonthly] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedRail, setSelectedRail] = useState('');
  const [showCheckout, setShowCheckout] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [showReviewForm, setShowReviewForm] = useState(false);

  const connectedAccounts = accounts?.filter((a) => a.status === 'connected') || [];
  const isSubscribed = subscriptions?.some((s: any) => s.mentor_profile_id === id);

  const handleSubscribe = async () => {
    if (!selectedAccount) return;
    try {
      await subscribeMutation.mutateAsync({
        mentor_profile_id: id,
        mt5_account_id: selectedAccount,
        mode: 'auto_trade',
        risk_mode: 'percentage',
        risk_amount: riskAmount,
        selected_tp_levels: selectedTps,
      });
      setShowSubscribe(false);
    } catch (err) {
      console.error('Subscribe failed:', err);
    }
  };

  if (isLoading) {
    return <div className="p-6"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div></div>;
  }

  if (!data?.mentor) {
    return <div className="p-6"><p className="text-gray-500">Mentor not found.</p></div>;
  }

  const { mentor, analytics: a } = data;

  const riskColors = { low: 'bg-green-100 text-green-800', moderate: 'bg-yellow-100 text-yellow-800', high: 'bg-red-100 text-red-800' };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link href="/mentors" className="flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft className="mr-1 h-4 w-4" /> Back to Mentors
      </Link>

      {/* Profile Header */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{mentor.display_name}</h1>
              {/* Badges */}
              {badges && badges.map((b: any) => (
                <span key={b.badge_type} className={`px-2 py-0.5 rounded text-xs font-medium ${
                  b.badge_type === 'verified' ? 'bg-blue-100 text-blue-700' :
                  b.badge_type === 'top_performer' ? 'bg-yellow-100 text-yellow-800' :
                  b.badge_type === 'featured' ? 'bg-amber-100 text-amber-800' :
                  b.badge_type === 'low_drawdown' ? 'bg-teal-100 text-teal-800' :
                  b.badge_type === 'high_win_rate' ? 'bg-green-100 text-green-800' :
                  'bg-gray-100 text-gray-700'
                }`} title={b.description}>{b.label}</span>
              ))}
              {(!badges || badges.length === 0) && mentor.is_verified && (
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">Verified</span>
              )}
              {a && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${riskColors[a.risk_label as keyof typeof riskColors]}`}>
                  <Shield className="mr-1 h-3 w-3" /> {a.risk_label.charAt(0).toUpperCase() + a.risk_label.slice(1)} Risk
                </span>
              )}
            </div>
            {mentor.bio && <p className="text-gray-600 mt-2">{mentor.bio}</p>}
            <div className="flex gap-2 mt-3">
              {mentor.trading_style?.map((s: string) => (
                <span key={s} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{s}</span>
              ))}
              {mentor.markets_traded?.map((m: string) => (
                <span key={m} className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs">{m}</span>
              ))}
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center text-gray-500 text-sm mb-2">
              <Users className="mr-1 h-4 w-4" /> {mentor.total_followers} followers
            </div>
            {a && <p className="text-xs text-gray-400">{a.active_subscribers} active subscribers</p>}
          </div>
        </div>

        {/* Subscribe CTA */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          {isSubscribed ? (
            <div className="flex items-center text-green-700 bg-green-50 rounded-lg px-4 py-2 text-sm font-medium">
              <TrendingUp className="mr-2 h-4 w-4" /> You&apos;re subscribed to this mentor
            </div>
          ) : showSubscribe ? (
            <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
              <select value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                <option value="">Select trading account...</option>
                {connectedAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>{acc.label || acc.account_number} ({acc.server})</option>
                ))}
              </select>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">Risk %</label>
                  <input type="number" min="0.1" max="5" step="0.1" value={riskAmount}
                    onChange={(e) => setRiskAmount(Number(e.target.value))}
                    className="w-20 px-2 py-1 border border-gray-300 rounded text-sm" />
                </div>
                <div className="flex items-center gap-1">
                  <label className="text-xs text-gray-500">TPs:</label>
                  {[1, 2, 3, 4].map((tp) => (
                    <label key={tp} className="flex items-center text-xs">
                      <input type="checkbox" checked={selectedTps.includes(tp)}
                        onChange={(e) => setSelectedTps(e.target.checked ? [...selectedTps, tp].sort() : selectedTps.filter(t => t !== tp))}
                        className="mr-0.5 h-3 w-3" /> TP{tp}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSubscribe} disabled={!selectedAccount || subscribeMutation.isPending}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {subscribeMutation.isPending ? 'Subscribing...' : 'Start Copying'}
                </button>
                <button onClick={() => setShowSubscribe(false)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowSubscribe(true)} disabled={connectedAccounts.length === 0}
              className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
              {connectedAccounts.length === 0 ? 'Connect an account first' : 'Copy This Trader'}
            </button>
          )}
        </div>
      </div>

      {/* Mentor Subscription Plans */}
      {mentorPlans && mentorPlans.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <CreditCard className="h-5 w-5" /> Subscription Plans
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            {mentorPlans.map((plan: any) => (
              <div key={plan.id} className="border border-gray-200 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900">{plan.name}</h3>
                {plan.description && <p className="text-sm text-gray-500 mt-1">{plan.description}</p>}
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  {Number(plan.price_usd) > 0 ? `$${plan.price_usd}/mo` : 'Free'}
                </p>
                {plan.features && plan.features.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {plan.features.map((f: string, i: number) => (
                      <li key={i} className="text-xs text-gray-600 flex items-center gap-1">
                        <span className="text-green-500">&#10003;</span> {f}
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  onClick={() => {
                    if (Number(plan.price_usd) > 0) {
                      setSelectedPlanId(plan.id);
                      setShowCheckout(true);
                    }
                  }}
                  className="mt-3 w-full px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                >
                  {Number(plan.price_usd) > 0 ? 'Subscribe' : 'Free Access'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Checkout Modal for Mentor Plan */}
      {showCheckout && selectedPlanId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Select Payment Method</h3>
            <div className="space-y-3 mb-6">
              {(rails || []).map((rail: any) => (
                <label key={rail.rail}
                  className={`flex items-center p-3 border-2 rounded-lg cursor-pointer transition-colors ${
                    selectedRail === rail.rail ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}>
                  <input type="radio" name="mentor_rail" value={rail.rail}
                    checked={selectedRail === rail.rail}
                    onChange={(e) => setSelectedRail(e.target.value)} className="mr-3" />
                  <div>
                    <p className="font-medium text-sm text-gray-900">{rail.displayName}</p>
                    <p className="text-xs text-gray-500">{rail.chain} network</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  if (!selectedRail) return;
                  try {
                    const invoice = await createMentorInvoice.mutateAsync({
                      mentor_plan_id: selectedPlanId,
                      payment_rail: selectedRail,
                    });
                    router.push(`/billing/invoice/${invoice.id}`);
                  } catch (err: any) {
                    alert(err?.response?.data?.error || 'Failed to create invoice');
                  }
                }}
                disabled={!selectedRail || createMentorInvoice.isPending}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 text-sm"
              >
                {createMentorInvoice.isPending ? 'Creating...' : 'Continue to Payment'}
              </button>
              <button
                onClick={() => { setShowCheckout(false); setSelectedPlanId(null); setSelectedRail(''); }}
                className="px-4 py-2.5 bg-gray-200 text-gray-700 rounded-lg text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {a && (
        <>
          {/* Performance Overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Win Rate', value: `${a.win_rate.toFixed(1)}%`, color: a.win_rate >= 50 ? 'text-green-700' : 'text-red-600' },
              { label: 'Total PnL', value: `$${a.total_pnl.toFixed(0)}`, color: a.total_pnl >= 0 ? 'text-green-700' : 'text-red-600' },
              { label: 'Profit Factor', value: a.profit_factor.toFixed(2), color: 'text-gray-900' },
              { label: 'Avg R:R', value: a.avg_rr.toFixed(1), color: 'text-gray-900' },
              { label: 'Signals', value: a.total_signals, color: 'text-gray-900' },
              { label: 'W / L', value: `${a.winning_trades} / ${a.losing_trades}`, color: 'text-gray-900' },
              { label: 'Max Drawdown', value: `$${a.max_drawdown_pct.toFixed(0)}`, color: 'text-red-600' },
              { label: 'Avg Hold', value: `${a.avg_hold_time_hours.toFixed(1)}h`, color: 'text-gray-900' },
            ].map((item) => (
              <div key={item.label} className="bg-white rounded-lg shadow p-4">
                <p className="text-xs text-gray-500">{item.label}</p>
                <p className={`text-xl font-bold ${item.color}`}>{item.value}</p>
              </div>
            ))}
          </div>

          {/* Period Performance */}
          <div className="bg-white rounded-lg shadow p-5 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Performance by Period</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase">
                    <th className="pb-2">Period</th><th className="pb-2">Signals</th><th className="pb-2">Trades</th>
                    <th className="pb-2">Win Rate</th><th className="pb-2">PnL</th><th className="pb-2">PF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[
                    { label: 'Last 30 days', d: a.last_30d },
                    { label: 'Last 90 days', d: a.last_90d },
                    { label: 'Last 180 days', d: a.last_180d },
                  ].map((row) => (
                    <tr key={row.label}>
                      <td className="py-2 font-medium">{row.label}</td>
                      <td className="py-2">{row.d.total_signals}</td>
                      <td className="py-2">{row.d.total_trades}</td>
                      <td className="py-2">{row.d.win_rate.toFixed(1)}%</td>
                      <td className={`py-2 font-medium ${row.d.total_pnl >= 0 ? 'text-green-700' : 'text-red-600'}`}>${row.d.total_pnl.toFixed(0)}</td>
                      <td className="py-2">{row.d.profit_factor.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Symbol Breakdown */}
          {a.symbol_breakdown?.length > 0 && (
            <div className="bg-white rounded-lg shadow p-5 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">By Symbol</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase">
                      <th className="pb-2">Symbol</th><th className="pb-2">Signals</th><th className="pb-2">Trades</th>
                      <th className="pb-2">W / L</th><th className="pb-2">Win Rate</th><th className="pb-2">PnL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {a.symbol_breakdown.map((s: any) => (
                      <tr key={s.symbol}>
                        <td className="py-2 font-medium">{s.symbol}</td>
                        <td className="py-2">{s.total_signals}</td>
                        <td className="py-2">{s.total_trades}</td>
                        <td className="py-2">{s.winning} / {s.losing}</td>
                        <td className="py-2">{s.win_rate.toFixed(1)}%</td>
                        <td className={`py-2 font-medium ${s.pnl >= 0 ? 'text-green-700' : 'text-red-600'}`}>${s.pnl.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Monthly Performance */}
          {a.monthly_performance?.length > 0 && (
            <div className="bg-white rounded-lg shadow p-5 mb-6">
              <button onClick={() => setShowMonthly(!showMonthly)}
                className="flex items-center justify-between w-full text-lg font-semibold text-gray-900">
                Monthly Performance
                {showMonthly ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              </button>
              {showMonthly && (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 uppercase">
                        <th className="pb-2">Month</th><th className="pb-2">Signals</th><th className="pb-2">Trades</th>
                        <th className="pb-2">Win Rate</th><th className="pb-2">PnL</th><th className="pb-2">PF</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {a.monthly_performance.map((m: any) => (
                        <tr key={m.month}>
                          <td className="py-2 font-medium">{m.month}</td>
                          <td className="py-2">{m.signals}</td>
                          <td className="py-2">{m.trades}</td>
                          <td className="py-2">{m.win_rate.toFixed(1)}%</td>
                          <td className={`py-2 font-medium ${m.pnl >= 0 ? 'text-green-700' : 'text-red-600'}`}>${m.pnl.toFixed(0)}</td>
                          <td className="py-2">{m.profit_factor.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Recent Signals */}
          {a.recent_signals?.length > 0 && (
            <div className="bg-white rounded-lg shadow p-5">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Recent Signals</h2>
              <div className="space-y-2">
                {a.recent_signals.map((s: any) => (
                  <div key={s.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${s.direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {s.direction}
                      </span>
                      <span className="font-medium text-sm">{s.symbol}</span>
                      <span className="text-xs text-gray-500">@ {s.entry_price}</span>
                      <span className={`px-1.5 py-0.5 rounded text-xs ${s.status === 'active' ? 'bg-green-50 text-green-700' : s.status === 'closed' ? 'bg-gray-100 text-gray-600' : 'bg-red-50 text-red-600'}`}>
                        {s.status}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className={`text-sm font-medium ${s.pnl >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                        ${s.pnl.toFixed(2)}
                      </span>
                      <span className="text-xs text-gray-400 ml-2">{s.total_copies} copies</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Reviews Section */}
      <div className="bg-white rounded-lg shadow p-5 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Star className="h-5 w-5 text-yellow-500" /> Reviews
            {reviewsData?.ratingSummary && reviewsData.ratingSummary.reviewCount > 0 && (
              <span className="text-sm text-gray-500 font-normal">
                ({reviewsData.ratingSummary.avgRating.toFixed(1)} avg, {reviewsData.ratingSummary.reviewCount} reviews)
              </span>
            )}
          </h2>
          {isSubscribed && !showReviewForm && (
            <button onClick={() => setShowReviewForm(true)}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700">
              Write Review
            </button>
          )}
        </div>

        {/* Review Form */}
        {showReviewForm && (
          <div className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Rating:</span>
              {[1, 2, 3, 4, 5].map((star) => (
                <button key={star} onClick={() => setReviewRating(star)}>
                  <Star className={`h-5 w-5 ${star <= reviewRating ? 'text-yellow-500 fill-yellow-500' : 'text-gray-300'}`} />
                </button>
              ))}
            </div>
            <textarea value={reviewText} onChange={(e) => setReviewText(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" rows={3}
              placeholder="Share your experience (optional, max 500 chars)" maxLength={500} />
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  try {
                    await createReview.mutateAsync({ mentorId: id, rating: reviewRating, review_text: reviewText || undefined });
                    setShowReviewForm(false);
                    setReviewText('');
                  } catch (err: any) {
                    alert(err?.response?.data?.error || 'Failed to submit review');
                  }
                }}
                disabled={createReview.isPending}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                {createReview.isPending ? 'Submitting...' : 'Submit Review'}
              </button>
              <button onClick={() => setShowReviewForm(false)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm">Cancel</button>
            </div>
          </div>
        )}

        {/* Reviews List */}
        {reviewsData?.reviews && reviewsData.reviews.length > 0 ? (
          <div className="space-y-3">
            {reviewsData.reviews.map((r: any) => (
              <div key={r.id} className="p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-1 mb-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star key={star} className={`h-3 w-3 ${star <= r.rating ? 'text-yellow-500 fill-yellow-500' : 'text-gray-300'}`} />
                  ))}
                  <span className="text-xs text-gray-400 ml-2">{new Date(r.created_at).toLocaleDateString()}</span>
                </div>
                {r.review_text && <p className="text-sm text-gray-700">{r.review_text}</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No reviews yet. {isSubscribed ? 'Be the first to review!' : ''}</p>
        )}
      </div>

      {/* Similar Mentors */}
      {similarMentors && similarMentors.length > 0 && (
        <div className="bg-white rounded-lg shadow p-5 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Similar Mentors</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {similarMentors.map((m: any) => (
              <Link key={m.id} href={`/mentors/${m.id}`}
                className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                <p className="font-medium text-sm text-gray-900">{m.display_name}</p>
                <div className="flex items-center gap-1 mt-1">
                  {m.badges?.slice(0, 2).map((b: any) => (
                    <span key={b.badge_type} className="px-1 py-0.5 bg-gray-200 text-gray-600 rounded text-xs">{b.label}</span>
                  ))}
                </div>
                {m.analytics && (
                  <div className="mt-1 text-xs text-gray-500">
                    {m.analytics.win_rate?.toFixed(0)}% WR &middot; {m.analytics.total_signals} signals
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
