import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import { api } from '../../lib/api.ts';
import type { AuditLog } from '../../types/database.ts';
import { ShieldAlert, RefreshCw, CheckCircle2 } from 'lucide-react';

export const AuditLogViewer: React.FC = () => {
  const { tenant } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = () => {
    if (!tenant) return;
    setLoading(true);
    api
      .getAuditLogs(tenant.id)
      .then((data) => {
        setLogs(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load audit logs:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchLogs();
  }, [tenant]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 sm:pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Security & Audit Trail</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Immutable Audit History · Access Logs · Financial Mutations
          </p>
        </div>

        <button
          onClick={fetchLogs}
          disabled={loading}
          className="self-start sm:self-auto flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.98] transition-all shrink-0 min-h-[40px]"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Stream</span>
        </button>
      </div>

      {/* Logs Table / Timeline */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700">Audit Events ({logs.length})</span>
          <span className="text-[11px] text-slate-400 truncate max-w-[160px] sm:max-w-none">
            Scoped to {tenant?.name}
          </span>
        </div>

        {logs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">No audit events recorded for this tenant yet.</div>
        ) : (
          <>
            {/* Mobile Timeline Cards (< 640px) */}
            <div className="block sm:hidden divide-y divide-slate-100">
              {logs.map((log) => {
                const isViolation = log.action.includes('VIOLATION') || log.action.includes('BLOCKED');
                return (
                  <div
                    key={log.id}
                    className={`p-3.5 space-y-1.5 ${isViolation ? 'bg-rose-50/60' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                          isViolation ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-800'
                        }`}
                      >
                        {isViolation && <ShieldAlert className="w-3 h-3 text-rose-600" />}
                        <span>{log.action}</span>
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {new Date(log.createdAt).toLocaleTimeString('en-PH', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-700 font-mono">
                      {log.entityType} ({log.entityId?.slice(0, 10)}...)
                    </div>

                    {log.metadata && (
                      <div className="text-[10px] font-mono text-slate-500 bg-white/80 p-1.5 rounded border border-slate-200 truncate">
                        {JSON.stringify(log.metadata)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop & Tablet Table (>= 640px) */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-medium">
                    <th className="py-2.5 px-4">Timestamp</th>
                    <th className="py-2.5 px-4">Action</th>
                    <th className="py-2.5 px-4">Entity</th>
                    <th className="py-2.5 px-4">Details / Metadata</th>
                    <th className="py-2.5 px-4">Origin IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {logs.map((log) => {
                    const isViolation = log.action.includes('VIOLATION') || log.action.includes('BLOCKED');
                    return (
                      <tr key={log.id} className={isViolation ? 'bg-rose-50/50' : 'hover:bg-slate-50/50'}>
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString('en-PH', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium ${
                              isViolation
                                ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                : 'bg-slate-100 text-slate-800'
                            }`}
                          >
                            {isViolation ? (
                              <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5 text-slate-500" />
                            )}
                            <span>{log.action}</span>
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                          {log.entityType} ({log.entityId?.slice(0, 10)}...)
                        </td>
                        <td className="py-3 px-4 text-slate-600 font-mono text-[11px] max-w-xs truncate">
                          {log.metadata ? JSON.stringify(log.metadata) : '—'}
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                          {log.ipAddress || '127.0.0.1'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
