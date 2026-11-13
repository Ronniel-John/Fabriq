import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import { api } from '../../lib/api.ts';
import type { Branch, Customer, CustomerType } from '../../types/database.ts';
import { CurrencyDisplay } from '../common/CurrencyDisplay.tsx';
import {
  Plus,
  Phone,
  Mail,
  RefreshCw,
  MapPin,
  Search,
  Pencil,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  X,
  ShoppingBag,
} from 'lucide-react';

interface CustomerListProps {
  onCreateOrderForCustomer?: (customerId: string) => void;
}

const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  walk_in: 'Walk-in Counter',
  pickup_delivery: 'Pickup & Delivery',
  corporate: 'Corporate / Condo',
};

const QUICK_PREFERENCES = [
  'Hypoallergenic detergent',
  'Extra fabric softener',
  'Fold shirts neatly',
  'Hang polos / blouses',
  'Separate whites',
  'Low heat dry',
];

export const CustomerList: React.FC<CustomerListProps> = ({ onCreateOrderForCustomer }) => {
  const { tenant } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Modal state (shared for Add & Edit)
  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [customerType, setCustomerType] = useState<CustomerType>('walk_in');
  const [branchId, setBranchId] = useState('');
  const [washPreferences, setWashPreferences] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Inline feedback banners
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<{ message: string; customerId?: string } | null>(null);

  const fetchCustomers = () => {
    if (!tenant) return;
    setLoading(true);
    Promise.all([
      api.getCustomers(tenant.id),
      api.getBranches(tenant.id).catch(() => [] as Branch[]),
    ])
      .then(([custData, branchData]) => {
        setCustomers(custData);
        setBranches(branchData);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load customers:', err);
        setErrorBanner(err instanceof Error ? err.message : 'Failed to load customers');
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchCustomers();
  }, [tenant]);

  const branchNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of branches) {
      map.set(b.id, b.name);
    }
    return map;
  }, [branches]);

  const filteredCustomers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.mobile.toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.address || '').toLowerCase().includes(q) ||
        (c.washPreferences || '').toLowerCase().includes(q)
    );
  }, [customers, searchQuery]);

  const openAddModal = () => {
    setEditingCustomer(null);
    setName('');
    setMobile('');
    setEmail('');
    setAddress('');
    setCustomerType('walk_in');
    setBranchId(branches[0]?.id || '');
    setWashPreferences('');
    setNotes('');
    setErrorBanner(null);
    setShowModal(true);
  };

  const openEditModal = (customer: Customer) => {
    setEditingCustomer(customer);
    setName(customer.name);
    setMobile(customer.mobile);
    setEmail(customer.email || '');
    setAddress(customer.address || '');
    setCustomerType(customer.customerType || 'walk_in');
    setBranchId(customer.branchId || branches[0]?.id || '');
    setWashPreferences(customer.washPreferences || '');
    setNotes(customer.notes || '');
    setErrorBanner(null);
    setShowModal(true);
  };

  const toggleQuickPreference = (pref: string) => {
    const current = washPreferences
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const exists = current.some((p) => p.toLowerCase() === pref.toLowerCase());
    const next = exists
      ? current.filter((p) => p.toLowerCase() !== pref.toLowerCase())
      : [...current, pref];
    setWashPreferences(next.join(', '));
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant || !name.trim() || !mobile.trim()) {
      setErrorBanner('Full name and mobile number are required.');
      return;
    }

    try {
      setSaving(true);
      setErrorBanner(null);

      const payload: Partial<Customer> = {
        name: name.trim(),
        mobile: mobile.trim(),
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        customerType,
        branchId: branchId || branches[0]?.id || undefined,
        washPreferences: washPreferences.trim() || undefined,
        notes: notes.trim() || undefined,
      };

      if (editingCustomer) {
        await api.updateCustomer(tenant.id, editingCustomer.id, payload);
        setSuccessBanner({ message: `Updated customer "${name.trim()}".`, customerId: editingCustomer.id });
      } else {
        const created = await api.createCustomer(tenant.id, payload);
        setSuccessBanner({
          message: `Added customer "${name.trim()}" to ${tenant.name}.`,
          customerId: created.id,
        });
      }

      setShowModal(false);
      setEditingCustomer(null);
      fetchCustomers();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to save customer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 sm:pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Customer Directory</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Profiles, Addresses, Wash Preferences & Receivables · {tenant?.name}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            onClick={fetchCustomers}
            disabled={loading}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.98] transition-all min-h-[42px]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={openAddModal}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-xl hover:bg-slate-800 active:scale-[0.98] transition-all min-h-[42px]"
          >
            <Plus className="w-4 h-4" />
            <span>Add Customer</span>
          </button>
        </div>
      </div>

      {/* Feedback Banners */}
      {errorBanner && !showModal && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <button onClick={() => setErrorBanner(null)} className="text-rose-700 font-semibold hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {successBanner && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successBanner.message}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {successBanner.customerId && onCreateOrderForCustomer && (
              <button
                onClick={() => onCreateOrderForCustomer(successBanner.customerId!)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                <span>Create Order (KG)</span>
              </button>
            )}
            <button onClick={() => setSuccessBanner(null)} className="text-emerald-700 font-semibold hover:underline">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search customer by name, phone, email, address, or wash preference..."
          className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[42px]"
        />
      </div>

      {/* Customer Directory */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Loading customer directory...</div>
        ) : filteredCustomers.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            {customers.length === 0
              ? 'No customers registered in this laundry shop yet.'
              : 'No customers match your search filter.'}
          </div>
        ) : (
          <>
            {/* Mobile Cards (< 640px) */}
            <div className="block sm:hidden divide-y divide-slate-100">
              {filteredCustomers.map((c) => {
                const typeLabel = CUSTOMER_TYPE_LABELS[c.customerType || 'walk_in'];
                const bName = branchNameMap.get(c.branchId);
                return (
                  <div key={c.id} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-slate-900 text-sm">{c.name}</span>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            {typeLabel}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 font-mono text-slate-600 text-xs mt-0.5">
                          <Phone className="w-3 h-3 text-slate-400" />
                          <span>{c.mobile}</span>
                        </div>
                        {c.email && (
                          <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-0.5">
                            <Mail className="w-3 h-3 text-slate-400" />
                            <span className="truncate">{c.email}</span>
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] text-slate-400 uppercase font-mono">Orders</div>
                        <div className="font-bold font-mono text-slate-900 text-sm">{c.totalOrders}</div>
                      </div>
                    </div>

                    {c.address && (
                      <div className="flex items-start gap-1.5 text-[11px] text-slate-600">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                        <span>{c.address}</span>
                      </div>
                    )}

                    {(c.washPreferences || c.notes || bName) && (
                      <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100 space-y-1">
                        {bName && (
                          <div className="text-[10px] font-mono text-slate-500">Branch: {bName}</div>
                        )}
                        {c.washPreferences && (
                          <div className="flex items-start gap-1 text-indigo-700 font-medium">
                            <Sparkles className="w-3 h-3 shrink-0 mt-0.5" />
                            <span>{c.washPreferences}</span>
                          </div>
                        )}
                        {c.notes && <div className="text-slate-500">{c.notes}</div>}
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs pt-1.5 border-t border-slate-100/80">
                      <div>
                        <span className="text-slate-500 mr-1.5">Balance:</span>
                        {c.outstandingBalanceCentavos > 0 ? (
                          <span className="text-amber-600 font-bold font-mono">
                            <CurrencyDisplay amountCentavos={c.outstandingBalanceCentavos} />
                          </span>
                        ) : (
                          <span className="text-slate-400 font-mono">₱0.00</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {onCreateOrderForCustomer && (
                          <button
                            onClick={() => onCreateOrderForCustomer(c.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 font-semibold text-[11px]"
                          >
                            <ShoppingBag className="w-3 h-3" />
                            <span>New Order</span>
                          </button>
                        )}
                        <button
                          onClick={() => openEditModal(c)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold text-[11px]"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop & Tablet Table (>= 640px) */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-medium">
                    <th className="py-2.5 px-4">Customer</th>
                    <th className="py-2.5 px-4">Contact & Address</th>
                    <th className="py-2.5 px-4">Preferences & Notes</th>
                    <th className="py-2.5 px-4 text-center">Orders</th>
                    <th className="py-2.5 px-4 text-right">Balance</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {filteredCustomers.map((c) => {
                    const typeLabel = CUSTOMER_TYPE_LABELS[c.customerType || 'walk_in'];
                    const bName = branchNameMap.get(c.branchId);
                    return (
                      <tr key={c.id} className="hover:bg-slate-50/50 align-top">
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="font-semibold text-slate-900">{c.name}</div>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                              {typeLabel}
                            </span>
                            {bName && (
                              <span className="text-[10px] font-mono text-slate-400">{bName}</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 space-y-1 max-w-xs">
                          <div className="flex items-center gap-1 font-mono text-slate-700 whitespace-nowrap">
                            <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                            <span>{c.mobile}</span>
                          </div>
                          {c.email && (
                            <div className="flex items-center gap-1 text-[11px] text-slate-500 truncate">
                              <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                              <span className="truncate">{c.email}</span>
                            </div>
                          )}
                          {c.address && (
                            <div className="flex items-start gap-1 text-[11px] text-slate-500">
                              <MapPin className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
                              <span className="line-clamp-2">{c.address}</span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-[11px] max-w-xs space-y-1">
                          {c.washPreferences && (
                            <div className="flex items-start gap-1 text-indigo-700 font-medium">
                              <Sparkles className="w-3 h-3 shrink-0 mt-0.5" />
                              <span>{c.washPreferences}</span>
                            </div>
                          )}
                          <div className="text-slate-500 line-clamp-2">
                            {c.notes || (!c.washPreferences ? '—' : '')}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-medium text-slate-800 whitespace-nowrap">
                          {c.totalOrders}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {c.outstandingBalanceCentavos > 0 ? (
                            <span className="text-amber-600 font-semibold">
                              <CurrencyDisplay amountCentavos={c.outstandingBalanceCentavos} />
                            </span>
                          ) : (
                            <span className="text-slate-400 font-mono">₱0.00</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                          {onCreateOrderForCustomer && (
                            <button
                              onClick={() => onCreateOrderForCustomer(c.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 font-semibold text-[11px]"
                            >
                              <ShoppingBag className="w-3 h-3" />
                              <span>New Order</span>
                            </button>
                          )}
                          <button
                            onClick={() => openEditModal(c)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold text-[11px]"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>Edit</span>
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

      {/* Add / Edit Customer Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full p-5 sm:p-6 space-y-4 my-auto">
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {editingCustomer ? 'Edit Customer Profile' : 'Add New Customer'}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Saved to {tenant?.name} customer directory
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {errorBanner && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{errorBanner}</span>
              </div>
            )}

            <form onSubmit={handleSaveCustomer} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Maria Clara"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[42px]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Mobile Number (PH) *</label>
                  <input
                    type="text"
                    required
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    placeholder="+63 917 123 4567"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[42px]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Email Address (Optional)</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="client@example.com"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[42px]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Customer Type</label>
                  <select
                    value={customerType}
                    onChange={(e) => setCustomerType(e.target.value as CustomerType)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[42px]"
                  >
                    <option value="walk_in">Walk-in Counter</option>
                    <option value="pickup_delivery">Pickup & Delivery</option>
                    <option value="corporate">Corporate / Condo Account</option>
                  </select>
                </div>
              </div>

              {branches.length > 0 && (
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Assigned Branch</label>
                  <select
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[42px]"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Pickup / Delivery Address (Optional)
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Unit / Street / Barangay / City (for pickup & delivery)"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[42px]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block font-medium text-slate-700">
                  Wash & Detergent Preferences (Optional)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_PREFERENCES.map((pref) => {
                    const selected = washPreferences.toLowerCase().includes(pref.toLowerCase());
                    return (
                      <button
                        key={pref}
                        type="button"
                        onClick={() => toggleQuickPreference(pref)}
                        className={`px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                          selected
                            ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {selected ? '✓ ' : '+ '}
                        {pref}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="text"
                  value={washPreferences}
                  onChange={(e) => setWashPreferences(e.target.value)}
                  placeholder="e.g. Hypoallergenic detergent, separate whites"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[42px]"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Additional Notes (Optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Call 15 mins before delivery, gate code, special care items"
                  rows={2}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium min-h-[42px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2.5 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 disabled:opacity-50 min-h-[42px]"
                >
                  {saving ? 'Saving...' : editingCustomer ? 'Save Changes' : 'Save Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
