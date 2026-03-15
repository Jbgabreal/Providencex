'use client';

import { useState } from 'react';
import { useMentorProfile, useCreateMentorProfile } from '@/hooks/useMentorProfile';
import { useMentorSignals, usePublishSignal, useSignalUpdate } from '@/hooks/useMentorSignals';
import { Send, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';

export default function MentorDashboardPage() {
  const { data: profile, isLoading: profileLoading } = useMentorProfile();
  const { data: signalsData } = useMentorSignals();
  const createProfile = useCreateMentorProfile();
  const publishSignal = usePublishSignal();
  const signalUpdate = useSignalUpdate();

  const [profileName, setProfileName] = useState('');
  const [profileBio, setProfileBio] = useState('');
  const [showSignalForm, setShowSignalForm] = useState(false);
  const [expandedSignal, setExpandedSignal] = useState<string | null>(null);

  // Signal form state
  const [signal, setSignal] = useState({
    symbol: 'XAUUSD', direction: 'BUY', order_kind: 'market',
    entry_price: '', stop_loss: '', tp1: '', tp2: '', tp3: '', tp4: '', notes: '',
  });

  const handleCreateProfile = async () => {
    if (!profileName) return;
    await createProfile.mutateAsync({ display_name: profileName, bio: profileBio });
  };

  const handlePublishSignal = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await publishSignal.mutateAsync({
        symbol: signal.symbol,
        direction: signal.direction,
        order_kind: signal.order_kind,
        entry_price: Number(signal.entry_price),
        stop_loss: Number(signal.stop_loss),
        tp1: signal.tp1 ? Number(signal.tp1) : undefined,
        tp2: signal.tp2 ? Number(signal.tp2) : undefined,
        tp3: signal.tp3 ? Number(signal.tp3) : undefined,
        tp4: signal.tp4 ? Number(signal.tp4) : undefined,
        notes: signal.notes || undefined,
        idempotency_key: `sig_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      });
      setShowSignalForm(false);
      setSignal({ symbol: 'XAUUSD', direction: 'BUY', order_kind: 'market',
        entry_price: '', stop_loss: '', tp1: '', tp2: '', tp3: '', tp4: '', notes: '' });
    } catch (err) {
      console.error('Publish failed:', err);
    }
  };

  const handleUpdate = async (signalId: string, updateType: string, extra?: any) => {
    try {
      await signalUpdate.mutateAsync({
        signalId,
        update_type: updateType,
        idempotency_key: `upd_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        ...extra,
      });
    } catch (err) {
      console.error('Update failed:', err);
    }
  };

  if (profileLoading) {
    return <div className="p-6"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div></div>;
  }

  // No mentor profile yet — show creation form
  if (!profile) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Become a Signal Provider</h1>
        <p className="text-sm text-gray-500 mb-6">Share your trade ideas with followers who can auto-copy your signals.</p>
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Display Name *</label>
            <input type="text" value={profileName} onChange={(e) => setProfileName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="Your trading name" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bio</label>
            <textarea value={profileBio} onChange={(e) => setProfileBio(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md" rows={3}
              placeholder="Describe your trading style..." />
          </div>
          <button onClick={handleCreateProfile} disabled={!profileName || createProfile.isPending}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
            {createProfile.isPending ? 'Creating...' : 'Create Mentor Profile'}
          </button>
          {!profile && <p className="text-xs text-gray-500 text-center">An admin must approve your profile before followers can subscribe.</p>}
        </div>
      </div>
    );
  }

  // Mentor dashboard
  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mentor Dashboard</h1>
          <p className="text-sm text-gray-500">
            {profile.display_name} &middot; {profile.total_followers} follower(s)
            {!profile.is_approved && (
              <span className="ml-2 px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded text-xs">Pending Approval</span>
            )}
          </p>
        </div>
        <button onClick={() => setShowSignalForm(!showSignalForm)}
          disabled={!profile.is_approved}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">
          <Send className="mr-2 h-4 w-4" /> New Signal
        </button>
      </div>

      {!profile.is_approved && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start">
          <AlertCircle className="h-5 w-5 text-yellow-600 mr-3 mt-0.5" />
          <div>
            <p className="font-medium text-yellow-800">Awaiting Admin Approval</p>
            <p className="text-sm text-yellow-700">You can prepare signals, but they won&apos;t be copied until your profile is approved.</p>
          </div>
        </div>
      )}

      {/* Signal Compose Form */}
      {showSignalForm && (
        <div className="mb-6 bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Publish Trade Signal</h2>
          <form onSubmit={handlePublishSignal} className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Symbol</label>
                <input type="text" required value={signal.symbol}
                  onChange={(e) => setSignal({ ...signal, symbol: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Direction</label>
                <select value={signal.direction} onChange={(e) => setSignal({ ...signal, direction: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Entry Price *</label>
                <input type="number" step="any" required value={signal.entry_price}
                  onChange={(e) => setSignal({ ...signal, entry_price: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Stop Loss *</label>
                <input type="number" step="any" required value={signal.stop_loss}
                  onChange={(e) => setSignal({ ...signal, stop_loss: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((tp) => (
                <div key={tp}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">TP{tp}</label>
                  <input type="number" step="any"
                    value={(signal as any)[`tp${tp}`]}
                    onChange={(e) => setSignal({ ...signal, [`tp${tp}`]: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    placeholder="Optional" />
                </div>
              ))}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
              <textarea value={signal.notes} onChange={(e) => setSignal({ ...signal, notes: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" rows={2}
                placeholder="Trade rationale..." />
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={publishSignal.isPending}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium">
                {publishSignal.isPending ? 'Publishing...' : 'Publish Signal'}
              </button>
              <button type="button" onClick={() => setShowSignalForm(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Signals List */}
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Your Signals</h2>
      {signalsData?.signals && signalsData.signals.length > 0 ? (
        <div className="space-y-3">
          {signalsData.signals.map((s: any) => (
            <div key={s.id} className="bg-white rounded-lg shadow p-4">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    s.direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>{s.direction}</span>
                  <span className="font-semibold text-gray-900">{s.symbol}</span>
                  <span className="text-sm text-gray-500">@ {s.entry_price}</span>
                  <span className="text-xs text-gray-400">SL: {s.stop_loss}</span>
                  {s.tp1 && <span className="text-xs text-gray-400">TP1: {s.tp1}</span>}
                  {s.tp2 && <span className="text-xs text-gray-400">TP2: {s.tp2}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    s.status === 'active' ? 'bg-green-100 text-green-800' :
                    s.status === 'closed' ? 'bg-gray-100 text-gray-800' : 'bg-red-100 text-red-800'
                  }`}>{s.status}</span>
                  <button onClick={() => setExpandedSignal(expandedSignal === s.id ? null : s.id)}
                    className="text-gray-400 hover:text-gray-600">
                    {expandedSignal === s.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {expandedSignal === s.id && s.status === 'active' && (
                <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-2">
                  <button onClick={() => handleUpdate(s.id, 'breakeven')}
                    className="px-3 py-1 text-xs bg-blue-100 text-blue-800 rounded hover:bg-blue-200">Breakeven</button>
                  <button onClick={() => {
                    const newSl = prompt('New SL price:');
                    if (newSl) handleUpdate(s.id, 'move_sl', { new_sl: Number(newSl) });
                  }}
                    className="px-3 py-1 text-xs bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200">Move SL</button>
                  {[1, 2, 3, 4].map((tp) => s[`tp${tp}`] && (
                    <button key={tp} onClick={() => handleUpdate(s.id, 'partial_close', { close_tp_level: tp })}
                      className="px-3 py-1 text-xs bg-orange-100 text-orange-800 rounded hover:bg-orange-200">Close TP{tp}</button>
                  ))}
                  <button onClick={() => { if (confirm('Close ALL copied trades?')) handleUpdate(s.id, 'close_all'); }}
                    className="px-3 py-1 text-xs bg-red-100 text-red-800 rounded hover:bg-red-200">Close All</button>
                  <button onClick={() => { if (confirm('Cancel this signal?')) handleUpdate(s.id, 'cancel'); }}
                    className="px-3 py-1 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200">Cancel</button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 bg-white rounded-lg shadow">
          <p className="text-gray-500">No signals published yet.</p>
        </div>
      )}
    </div>
  );
}
