import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import { api } from '../../lib/api.ts';
import type { Tenant, AuditLog } from '../../types/database.ts';
import {
  Building2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Plus,
  X,
  ArrowRight,
  PauseCircle,
  PlayCircle,
  Store,
  UserCheck,
  Mail,
} from 'lucide-react';

export const SuperAdminPortal: React.FC = () => {
  const { refresh, switchTenant, tenant: activeTenant } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingTenantId, setUpdatingTenantId] = useState<string | null>(null);

  // Feedback banners
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState<{ message: string; tenantId?: string } | null>(null);

  // Register New Laundry Shop Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [shopName, setShopName] = useState('');
  const [shopSlug, setShopSlug] = useState('');
  const [slugEditedManually, setSlugEditedManually] = useState(false);
  const [tradeName, setTradeName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('+63 917 ');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [branchName, setBranchName] = useState('Main Branch');
  const [branchAddress, setBranchAddress] = useState('');
  const [plan, setPlan] = useState<'starter' | 'growth' | 'enterprise'>('growth');
  const [status, setStatus] = useState<'trial' | 'active'>('active');
  const [creating, setCreating] = useState(false);

  // Assign / Update Owner Google Email Modal state
  const [editingOwnerTenant, setEditingOwnerTenant] = useState<Tenant | null>(null);
  const [editingOwnerEmail, setEditingOwnerEmail] = useState('');
  const [savingOwner, setSavingOwner] = useState(false);

  const fetchAdminData = () => {
    setLoading(true);
    Promise.all([api.getTenants(), api.getAdminAuditLogs()])
      .then(([tenantsData, logsData]) => {
        setTenants(tenantsData);
        setAuditLogs(logsData);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load super admin data:', err);
        setFeedbackError(err instanceof Error ? err.message : 'Failed to load platform tenants');
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchAdminData();
  }, []);

  const toSlug = (val: string) =>
    val
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);

  const handleShopNameChange = (val: string) => {
    setShopName(val);
    if (!slugEditedManually) {
      setShopSlug(toSlug(val));
    }
  };

  const resetForm = () => {
    setShopName('');
    setShopSlug('');
    setSlugEditedManually(false);
    setTradeName('');
    setContactEmail('');
    setContactPhone('+63 917 ');
    setOwnerEmail('');
    setBranchName('Main Branch');
    setBranchAddress('');
    setPlan('growth');
    setStatus('active');
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackError(null);
    setFeedbackSuccess(null);

    if (!shopName.trim() || !contactEmail.trim()) {
      setFeedbackError('Laundry shop name and contact email are required.');
      return;
    }

    try {
      setCreating(true);
      const created = await api.createTenant({
        name: shopName.trim(),
        tradeName: tradeName.trim() || shopName.trim(),
        slug: shopSlug.trim() || toSlug(shopName),
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim(),
        ownerEmail: ownerEmail.trim() || undefined,
        branchName: branchName.trim() || 'Main Branch',
        branchAddress: branchAddress.trim() || 'Philippines',
        plan,
        status,
      });

      setShowCreateModal(false);
      resetForm();
      await refresh();
      fetchAdminData();
      setFeedbackSuccess({
        message: created.tenant.ownerEmail
          ? `Registered "${created.tenant.name}" (${created.tenant.slug}). Owner ${created.tenant.ownerEmail} can now sign in with Google (no password needed).`
          : `Registered "${created.tenant.name}" (${created.tenant.slug}) with ${created.branch.name} and starter Wash & Fold service.`,
        tenantId: created.tenant.id,
      });
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : 'Failed to register new laundry shop');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveOwnerEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOwnerTenant) return;
    setFeedbackError(null);
    setFeedbackSuccess(null);

    try {
      setSavingOwner(true);
      const trimmed = editingOwnerEmail.trim().toLowerCase();
      await api.updateTenantOwner(editingOwnerTenant.id, trimmed);
      const targetName = editingOwnerTenant.name;
      setEditingOwnerTenant(null);
      setEditingOwnerEmail('');
      await refresh();
      fetchAdminData();
      setFeedbackSuccess({
        message: trimmed
          ? `Assigned Google owner "${trimmed}" to "${targetName}". They can now log in via Continue with Google.`
          : `Cleared assigned Google owner email for "${targetName}".`,
      });
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : 'Failed to assign owner Google email');
    } finally {
      setSavingOwner(false);
    }
  };

  const handleToggleStatus = async (target: Tenant) => {
    const nextStatus = target.status === 'suspended' ? 'active' : 'suspended';
    setFeedbackError(null);
    try {
      setUpdatingTenantId(target.id);
      await api.updateTenantStatus(target.id, nextStatus);
      await refresh();
      fetchAdminData();
      setFeedbackSuccess({
        message: `Updated "${target.name}" status to ${nextStatus.toUpperCase()}.`,
      });
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : 'Failed to update shop status');
    } finally {
      setUpdatingTenantId(null);
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 sm:pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Super Admin Platform Portal
            </h2>
            <span className="text-xs font-mono bg-purple-100 text-purple-800 px-2 py-0.5 rounded font-semibold">
              SUPER_ADMIN
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Register New Laundry Shops · Tenant Lifecycle · Subscription Oversight
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0 w-full sm:w-auto">
          <button
            onClick={() => {
              setFeedbackError(null);
              setShowCreateModal(true);
            }}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs active:scale-[0.98] transition-all min-h-[42px]"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>Register New Laundry Shop</span>
          </button>

          <button
            onClick={fetchAdminData}
            disabled={loading}
            className="flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.98] transition-all min-h-[42px]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Inline Feedback Banners */}
      {feedbackError && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{feedbackError}</span>
          </div>
          <button
            onClick={() => setFeedbackError(null)}
            className="text-rose-700 font-semibold px-2 py-1 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {feedbackSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{feedbackSuccess.message}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {feedbackSuccess.tenantId && (
              <button
                onClick={() => switchTenant(feedbackSuccess.tenantId!)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              >
                <span>Switch to Shop</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => setFeedbackSuccess(null)}
              className="text-emerald-700 font-semibold px-2 py-1 hover:underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Tenants Roster */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Registered Laundry Shops ({tenants.length})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Independent businesses operating on LaundryOS with isolated Firestore partitions
            </p>
          </div>
        </div>

        {!loading && tenants.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <p className="text-sm font-semibold text-slate-800">No laundry shops registered yet</p>
            <p className="text-xs text-slate-500">
              Click <strong>Register New Laundry Shop</strong> above to onboard your first business.
            </p>
          </div>
        ) : (
        <>
        {/* Mobile Cards (< 640px) */}
        <div className="block sm:hidden divide-y divide-slate-100">
          {tenants.map((t) => {
            const isCurrent = t.id === activeTenant?.id;
            return (
              <div key={t.id} className="p-4 space-y-2.5 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 flex items-center gap-1.5">
                      <Building2 className="w-4 h-4 text-indigo-600 shrink-0" />
                      <span className="truncate">{t.name}</span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 mt-0.5">{t.slug}</div>
                  </div>
                  <span
                    className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border uppercase shrink-0 ${
                      t.status === 'suspended'
                        ? 'text-rose-700 bg-rose-50 border-rose-200'
                        : t.status === 'trial'
                        ? 'text-amber-700 bg-amber-50 border-amber-200'
                        : 'text-emerald-700 bg-emerald-50 border-emerald-200'
                    }`}
                  >
                    {t.status}
                  </span>
                </div>

                <div className="text-[11px] text-slate-600 font-mono space-y-1">
                  <div className="truncate">{t.contactEmail}</div>
                  <div>{t.contactPhone}</div>
                  <div className="flex items-center gap-1 pt-0.5 font-sans">
                    <UserCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    <span className={t.ownerEmail ? 'text-indigo-700 font-medium truncate' : 'text-slate-400'}>
                      {t.ownerEmail ? `Owner Google: ${t.ownerEmail}` : 'No Google owner assigned'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1 flex-wrap">
                  <button
                    onClick={() => switchTenant(t.id)}
                    className={`flex-1 py-2 px-3 rounded-lg font-semibold text-xs border min-h-[38px] ${
                      isCurrent
                        ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                        : 'bg-slate-900 text-white border-slate-900'
                    }`}
                  >
                    {isCurrent ? 'Active Shop' : 'Open Shop'}
                  </button>
                  <button
                    onClick={() => {
                      setFeedbackError(null);
                      setEditingOwnerTenant(t);
                      setEditingOwnerEmail(t.ownerEmail || '');
                    }}
                    className="py-2 px-3 rounded-lg font-semibold text-xs border border-indigo-200 text-indigo-700 bg-indigo-50 min-h-[38px]"
                  >
                    Owner
                  </button>
                  <button
                    onClick={() => handleToggleStatus(t)}
                    disabled={updatingTenantId === t.id}
                    className="py-2 px-3 rounded-lg font-semibold text-xs border border-slate-300 text-slate-700 bg-white min-h-[38px]"
                  >
                    {t.status === 'suspended' ? 'Activate' : 'Suspend'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop & Tablet Table (>= 640px) */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
                <th className="py-2.5 px-4">Business Name</th>
                <th className="py-2.5 px-4">Slug ID</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Owner Google Email</th>
                <th className="py-2.5 px-4">Contact</th>
                <th className="py-2.5 px-4">Onboarded</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {tenants.map((t) => {
                const isCurrent = t.id === activeTenant?.id;
                return (
                  <tr key={t.id} className="hover:bg-slate-50/50">
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-indigo-600 shrink-0" />
                        <span>{t.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600">{t.slug}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-mono font-medium px-2 py-0.5 rounded border uppercase ${
                          t.status === 'suspended'
                            ? 'text-rose-700 bg-rose-50 border-rose-200'
                            : t.status === 'trial'
                            ? 'text-amber-700 bg-amber-50 border-amber-200'
                            : 'text-emerald-700 bg-emerald-50 border-emerald-200'
                        }`}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {t.ownerEmail ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-mono text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
                          <UserCheck className="w-3 h-3 shrink-0" />
                          <span>{t.ownerEmail}</span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400">Unassigned</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600">
                      <div>{t.contactEmail}</div>
                      <div className="text-[11px] text-slate-400">{t.contactPhone}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                      {new Date(t.createdAt).toLocaleDateString('en-PH', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                      <button
                        onClick={() => switchTenant(t.id)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                          isCurrent
                            ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                            : 'bg-slate-900 hover:bg-slate-800 text-white border-slate-900'
                        }`}
                      >
                        <span>{isCurrent ? 'Active' : 'Open Shop'}</span>
                      </button>
                      <button
                        onClick={() => {
                          setFeedbackError(null);
                          setEditingOwnerTenant(t);
                          setEditingOwnerEmail(t.ownerEmail || '');
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        <span>Assign Owner</span>
                      </button>
                      <button
                        onClick={() => handleToggleStatus(t)}
                        disabled={updatingTenantId === t.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {t.status === 'suspended' ? (
                          <>
                            <PlayCircle className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Activate</span>
                          </>
                        ) : (
                          <>
                            <PauseCircle className="w-3.5 h-3.5 text-amber-600" />
                            <span>Suspend</span>
                          </>
                        )}
                      </button>
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

      {/* Global Platform Audit Logs */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">Platform-Wide Security & Access Audit Stream</h3>
          <span className="text-xs font-mono text-slate-400">Total Events: {auditLogs.length}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-4">Tenant</th>
                <th className="py-2.5 px-4">Action</th>
                <th className="py-2.5 px-4">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {auditLogs.slice(0, 8).map((log) => {
                const isViolation = log.action.includes('VIOLATION') || log.action.includes('BLOCKED');
                return (
                  <tr key={log.id} className={isViolation ? 'bg-rose-50/50' : 'hover:bg-slate-50/50'}>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleTimeString('en-PH', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600">{log.tenantId || 'GLOBAL'}</td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`inline-flex items-center gap-1 font-mono text-[11px] px-2 py-0.5 rounded ${
                          isViolation
                            ? 'bg-rose-100 text-rose-800 font-semibold'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {log.action}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 max-w-sm truncate">
                      {log.metadata ? JSON.stringify(log.metadata) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Register New Laundry Shop Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full p-5 sm:p-6 space-y-4 my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Store className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Register New Laundry Shop</h3>
                  <p className="text-[11px] text-slate-500">
                    Creates isolated Firestore tenant, main branch, owner access & subscription
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTenant} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Laundry Shop Name *</label>
                  <input
                    type="text"
                    required
                    value={shopName}
                    onChange={(e) => handleShopNameChange(e.target.value)}
                    placeholder="e.g. CleanWave Laundry Hub"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[42px]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Shop Slug ID *</label>
                  <input
                    type="text"
                    required
                    value={shopSlug}
                    onChange={(e) => {
                      setSlugEditedManually(true);
                      setShopSlug(toSlug(e.target.value));
                    }}
                    placeholder="cleanwave-laundry"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[42px]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Trade / Business Name (Optional)</label>
                <input
                  type="text"
                  value={tradeName}
                  onChange={(e) => setTradeName(e.target.value)}
                  placeholder="e.g. CleanWave Services Inc."
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[42px]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Contact Email *</label>
                  <input
                    type="email"
                    required
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="owner@cleanwave.ph"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[42px]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Contact Phone</label>
                  <input
                    type="text"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="+63 917 555 0199"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[42px]"
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-200 space-y-1.5">
                <label className="block font-semibold text-indigo-950">
                  Shop Owner Google Email (Optional — No Password Needed)
                </label>
                <input
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="shopowner@gmail.com"
                  className="w-full bg-white border border-indigo-200 rounded-xl px-3 py-2.5 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[42px]"
                />
                <p className="text-[11px] text-indigo-800 leading-relaxed">
                  When this owner signs in via <strong>Continue with Google</strong> with this Gmail/Workspace address,
                  LaundryOS automatically grants them Owner access to this shop.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Main Branch Name</label>
                  <input
                    type="text"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    placeholder="Main Branch"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[42px]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Branch Address</label>
                  <input
                    type="text"
                    value={branchAddress}
                    onChange={(e) => setBranchAddress(e.target.value)}
                    placeholder="Makati City, Metro Manila"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[42px]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">SaaS Subscription Plan</label>
                  <select
                    value={plan}
                    onChange={(e) => setPlan(e.target.value as 'starter' | 'growth' | 'enterprise')}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-slate-900 font-medium min-h-[42px]"
                  >
                    <option value="starter">Starter (₱999/mo · 5 staff)</option>
                    <option value="growth">Growth (₱2,499/mo · 15 staff)</option>
                    <option value="enterprise">Enterprise (₱4,999/mo · 50 staff)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Account Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'trial' | 'active')}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-slate-900 font-medium min-h-[42px]"
                  >
                    <option value="active">Active (Live Operations)</option>
                    <option value="trial">14-Day Free Trial</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium min-h-[42px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-50 min-h-[42px]"
                >
                  {creating ? 'Provisioning Shop...' : 'Create & Provision Shop'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign Shop Owner Google Email Modal */}
      {editingOwnerTenant && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <UserCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Assign Shop Owner Google Email</h3>
                  <p className="text-[11px] text-slate-500">{editingOwnerTenant.name}</p>
                </div>
              </div>
              <button
                onClick={() => setEditingOwnerTenant(null)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveOwnerEmail} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Owner Google Email Address</label>
                <input
                  type="email"
                  value={editingOwnerEmail}
                  onChange={(e) => setEditingOwnerEmail(e.target.value)}
                  placeholder="shopowner@gmail.com"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[42px]"
                />
                <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                  Leave blank and save to remove the assigned email. When this user logs in via{' '}
                  <strong>Continue with Google</strong>, they are automatically granted Owner access to{' '}
                  <strong>{editingOwnerTenant.name}</strong> with no separate password required.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingOwnerTenant(null)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium min-h-[42px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingOwner}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-50 min-h-[42px]"
                >
                  {savingOwner ? 'Saving...' : 'Save Owner Email'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
