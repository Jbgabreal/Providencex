'use client';

import { useState } from 'react';
import {
  useImportSources, useCreateImportSource, useToggleImportSource,
  useImportedMessages, useIngestMessage,
  useImportedCandidates, useUpdateImportedCandidate,
  useApproveImportedCandidate, useRejectImportedCandidate,
} from '@/hooks/useIngestion';
import { MessageSquare, Plus, Check, X, Edit3, Send, ChevronDown, ChevronUp, Zap } from 'lucide-react';

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  edited: 'bg-blue-100 text-blue-800',
  parsed: 'bg-green-100 text-green-800',
  no_signal: 'bg-gray-100 text-gray-600',
  error: 'bg-red-100 text-red-800',
};

export default function MentorImportsPage() {
  const { data: sources } = useImportSources();
  const createSource = useCreateImportSource();
  const toggleSource = useToggleImportSource();
  const { data: candidates } = useImportedCandidates('pending');
  const { data: allCandidates } = useImportedCandidates();
  const approveCandidate = useApproveImportedCandidate();
  const rejectCandidate = useRejectImportedCandidate();
  const updateCandidate = useUpdateImportedCandidate();
  const ingestMessage = useIngestMessage();

  const [tab, setTab] = useState<'queue' | 'sources' | 'history'>('queue');
  const [showNewSource, setShowNewSource] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [editingCandidate, setEditingCandidate] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<any>({});
  const [pasteText, setPasteText] = useState('');
  const [pasteSourceId, setPasteSourceId] = useState('');
  const [sourceForm, setSourceForm] = useState({ source_type: 'telegram', source_name: '', source_identifier: '' });

  const handleCreateSource = async () => {
    if (!sourceForm.source_name || !sourceForm.source_identifier) return;
    await createSource.mutateAsync(sourceForm as any);
    setShowNewSource(false);
    setSourceForm({ source_type: 'telegram', source_name: '', source_identifier: '' });
  };

  const handlePaste = async () => {
    if (!pasteSourceId || !pasteText) return;
    await ingestMessage.mutateAsync({ source_id: pasteSourceId, raw_text: pasteText });
    setPasteText('');
    setShowPaste(false);
  };

  const startEdit = (c: any) => {
    setEditingCandidate(c.id);
    setEditFields({
      parsed_symbol: c.parsed_symbol || '',
      parsed_direction: c.parsed_direction || 'BUY',
      parsed_entry_price: c.parsed_entry_price || '',
      parsed_stop_loss: c.parsed_stop_loss || '',
      parsed_tp1: c.parsed_tp1 || '',
      parsed_tp2: c.parsed_tp2 || '',
      parsed_tp3: c.parsed_tp3 || '',
      parsed_tp4: c.parsed_tp4 || '',
    });
  };

  const saveEdit = async (id: string) => {
    await updateCandidate.mutateAsync({ id, ...editFields });
    setEditingCandidate(null);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <MessageSquare className="h-6 w-6" /> Signal Imports
        </h1>
        <div className="flex gap-2">
          <button onClick={() => setShowPaste(!showPaste)}
            className="flex items-center px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700">
            <Send className="h-3 w-3 mr-1" /> Paste Signal
          </button>
        </div>
      </div>

      {/* Paste Signal */}
      {showPaste && (
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <h3 className="text-sm font-semibold mb-2">Paste a Signal Message</h3>
          <select value={pasteSourceId} onChange={e => setPasteSourceId(e.target.value)}
            className="w-full mb-2 px-3 py-2 border border-gray-300 rounded-md text-sm">
            <option value="">Select source...</option>
            {(sources || []).map((s: any) => <option key={s.id} value={s.id}>{s.source_name} ({s.source_type})</option>)}
          </select>
          <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" rows={4}
            placeholder="Paste the raw signal message here..." />
          <div className="flex gap-2 mt-2">
            <button onClick={handlePaste} disabled={!pasteSourceId || !pasteText || ingestMessage.isPending}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">
              {ingestMessage.isPending ? 'Processing...' : 'Parse & Import'}
            </button>
            <button onClick={() => setShowPaste(false)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm">Cancel</button>
          </div>
          {ingestMessage.data?.candidate && (
            <p className="text-xs text-green-600 mt-2">Signal detected! Check the review queue.</p>
          )}
          {ingestMessage.data && !ingestMessage.data.candidate && ingestMessage.data.message && (
            <p className="text-xs text-gray-500 mt-2">Message saved but no signal detected.</p>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1">
        {[
          { key: 'queue' as const, label: `Review Queue (${candidates?.length || 0})` },
          { key: 'sources' as const, label: 'Sources' },
          { key: 'history' as const, label: 'All Candidates' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>{t.label}</button>
        ))}
      </div>

      {/* Review Queue */}
      {tab === 'queue' && (
        <div className="space-y-3">
          {(!candidates || candidates.length === 0) ? (
            <div className="text-center py-12 bg-white rounded-lg shadow">
              <Zap className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No pending signals to review</p>
              <p className="text-xs text-gray-400 mt-1">Paste a signal message or connect a Telegram source</p>
            </div>
          ) : candidates.map((c: any) => (
            <div key={c.id} className="bg-white rounded-lg shadow p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${c.candidate_type === 'new_signal' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}`}>
                    {c.candidate_type === 'new_signal' ? 'New Signal' : 'Signal Update'}
                  </span>
                  <span className="text-xs text-gray-400 ml-2">Confidence: {c.parse_confidence?.toFixed(0) || '?'}%</span>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[c.review_status] || 'bg-gray-100'}`}>
                  {c.review_status}
                </span>
              </div>

              {/* Parsed Fields */}
              {editingCandidate === c.id ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-xs">
                  <div>
                    <label className="text-gray-500">Symbol</label>
                    <input value={editFields.parsed_symbol} onChange={e => setEditFields({ ...editFields, parsed_symbol: e.target.value })}
                      className="w-full px-2 py-1 border rounded text-sm" />
                  </div>
                  <div>
                    <label className="text-gray-500">Direction</label>
                    <select value={editFields.parsed_direction} onChange={e => setEditFields({ ...editFields, parsed_direction: e.target.value })}
                      className="w-full px-2 py-1 border rounded text-sm">
                      <option value="BUY">BUY</option><option value="SELL">SELL</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-gray-500">Entry</label>
                    <input type="number" step="any" value={editFields.parsed_entry_price}
                      onChange={e => setEditFields({ ...editFields, parsed_entry_price: e.target.value })}
                      className="w-full px-2 py-1 border rounded text-sm" />
                  </div>
                  <div>
                    <label className="text-gray-500">Stop Loss</label>
                    <input type="number" step="any" value={editFields.parsed_stop_loss}
                      onChange={e => setEditFields({ ...editFields, parsed_stop_loss: e.target.value })}
                      className="w-full px-2 py-1 border rounded text-sm" />
                  </div>
                  {[1, 2, 3, 4].map(n => (
                    <div key={n}>
                      <label className="text-gray-500">TP{n}</label>
                      <input type="number" step="any" value={editFields[`parsed_tp${n}`]}
                        onChange={e => setEditFields({ ...editFields, [`parsed_tp${n}`]: e.target.value })}
                        className="w-full px-2 py-1 border rounded text-sm" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-4 md:grid-cols-8 gap-2 mb-3 text-xs">
                  <div><span className="text-gray-500">Symbol</span><p className="font-medium">{c.parsed_symbol || '—'}</p></div>
                  <div><span className="text-gray-500">Dir</span><p className={`font-medium ${c.parsed_direction === 'BUY' ? 'text-green-600' : 'text-red-600'}`}>{c.parsed_direction || '—'}</p></div>
                  <div><span className="text-gray-500">Entry</span><p className="font-medium">{c.parsed_entry_price || '—'}</p></div>
                  <div><span className="text-gray-500">SL</span><p className="font-medium">{c.parsed_stop_loss || '—'}</p></div>
                  <div><span className="text-gray-500">TP1</span><p className="font-medium">{c.parsed_tp1 || '—'}</p></div>
                  <div><span className="text-gray-500">TP2</span><p className="font-medium">{c.parsed_tp2 || '—'}</p></div>
                  <div><span className="text-gray-500">TP3</span><p className="font-medium">{c.parsed_tp3 || '—'}</p></div>
                  <div><span className="text-gray-500">TP4</span><p className="font-medium">{c.parsed_tp4 || '—'}</p></div>
                </div>
              )}

              {/* Raw text preview */}
              <p className="text-xs text-gray-400 bg-gray-50 rounded p-2 mb-3 line-clamp-2">{c.parsed_notes}</p>

              {/* Actions */}
              <div className="flex gap-2">
                {editingCandidate === c.id ? (
                  <>
                    <button onClick={() => saveEdit(c.id)} className="flex items-center px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">
                      <Check className="h-3 w-3 mr-1" /> Save
                    </button>
                    <button onClick={() => setEditingCandidate(null)} className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded text-xs">Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => approveCandidate.mutate(c.id)} disabled={approveCandidate.isPending}
                      className="flex items-center px-3 py-1.5 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-50">
                      <Check className="h-3 w-3 mr-1" /> Approve & Publish
                    </button>
                    <button onClick={() => startEdit(c)}
                      className="flex items-center px-3 py-1.5 bg-blue-100 text-blue-800 rounded text-xs hover:bg-blue-200">
                      <Edit3 className="h-3 w-3 mr-1" /> Edit
                    </button>
                    <button onClick={() => rejectCandidate.mutate({ id: c.id })}
                      className="flex items-center px-3 py-1.5 bg-red-100 text-red-800 rounded text-xs hover:bg-red-200">
                      <X className="h-3 w-3 mr-1" /> Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sources */}
      {tab === 'sources' && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Signal Sources</h2>
            <button onClick={() => setShowNewSource(!showNewSource)}
              className="flex items-center px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700">
              <Plus className="h-3 w-3 mr-1" /> Add Source
            </button>
          </div>

          {showNewSource && (
            <div className="mb-4 p-4 bg-gray-50 rounded-lg space-y-2">
              <select value={sourceForm.source_type} onChange={e => setSourceForm({ ...sourceForm, source_type: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                <option value="telegram">Telegram</option>
                <option value="discord">Discord</option>
                <option value="webhook">Webhook</option>
              </select>
              <input value={sourceForm.source_name} onChange={e => setSourceForm({ ...sourceForm, source_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Source name (e.g. Gold Signals VIP)" />
              <input value={sourceForm.source_identifier} onChange={e => setSourceForm({ ...sourceForm, source_identifier: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Chat ID or channel identifier" />
              <div className="flex gap-2">
                <button onClick={handleCreateSource} disabled={createSource.isPending}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm disabled:opacity-50">Create</button>
                <button onClick={() => setShowNewSource(false)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm">Cancel</button>
              </div>
            </div>
          )}

          {(!sources || sources.length === 0) ? (
            <p className="text-sm text-gray-500">No sources connected. Add a Telegram channel to start importing signals.</p>
          ) : (
            <div className="space-y-2">
              {sources.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-sm">{s.source_name}</p>
                    <p className="text-xs text-gray-500">{s.source_type} &middot; {s.source_identifier}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${s.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                      {s.is_active ? 'Active' : 'Paused'}
                    </span>
                    <button onClick={() => toggleSource.mutate(s.id)} className="text-xs text-blue-600 hover:underline">
                      {s.is_active ? 'Pause' : 'Enable'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* History */}
      {tab === 'history' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">All Imported Candidates</h2>
          {(!allCandidates || allCandidates.length === 0) ? (
            <p className="text-sm text-gray-500">No imported candidates yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase">
                    <th className="pb-2">Type</th><th className="pb-2">Symbol</th><th className="pb-2">Direction</th>
                    <th className="pb-2">Entry</th><th className="pb-2">SL</th><th className="pb-2">Status</th>
                    <th className="pb-2">Confidence</th><th className="pb-2">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {allCandidates.map((c: any) => (
                    <tr key={c.id}>
                      <td className="py-2 text-xs">{c.candidate_type === 'new_signal' ? 'Signal' : 'Update'}</td>
                      <td className="py-2 font-medium">{c.parsed_symbol || '—'}</td>
                      <td className="py-2"><span className={c.parsed_direction === 'BUY' ? 'text-green-600' : 'text-red-600'}>{c.parsed_direction || '—'}</span></td>
                      <td className="py-2">{c.parsed_entry_price || '—'}</td>
                      <td className="py-2">{c.parsed_stop_loss || '—'}</td>
                      <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs ${statusColors[c.review_status] || 'bg-gray-100'}`}>{c.review_status}</span></td>
                      <td className="py-2">{c.parse_confidence?.toFixed(0) || '?'}%</td>
                      <td className="py-2 text-gray-400">{new Date(c.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
