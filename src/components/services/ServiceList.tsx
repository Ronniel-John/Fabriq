import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import { api } from '../../lib/api.ts';
import type { Service } from '../../types/database.ts';
import { CurrencyDisplay } from '../common/CurrencyDisplay.tsx';
import { Sparkles, Plus, Clock, Scale, Tag, RefreshCw } from 'lucide-react';

export const ServiceList: React.FC = () => {
  const { tenant, currentRole, can } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Wash & Fold');
  const [pricingUnit, setPricingUnit] = useState<'kg' | 'piece'>('kg');
  const [unitPricePesos, setUnitPricePesos] = useState('70');
  const [minChargePesos, setMinChargePesos] = useState('210');
  const [minQuantity, setMinQuantity] = useState('3.0');
  const [turnaroundHours, setTurnaroundHours] = useState('24');
  const [saving, setSaving] = useState(false);

  const fetchServices = () => {
    if (!tenant) return;
    setLoading(true);
    api
      .getServices(tenant.id)
      .then((data) => {
        setServices(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load services:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchServices();
  }, [tenant]);

  const handleCreateService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant || !name) return;
    try {
      setSaving(true);
      const unitPriceCentavos = Math.round(parseFloat(unitPricePesos) * 100);
      const minChargeCentavos = Math.round(parseFloat(minChargePesos || '0') * 100);

      await api.createService(tenant.id, {
        name,
        category,
        pricingUnit,
        unitPriceCentavos,
        minChargeCentavos,
        minQuantity: parseFloat(minQuantity) || 1.0,
        defaultTurnaroundHours: parseInt(turnaroundHours, 10) || 24,
      });

      setShowAddModal(false);
      setName('');
      fetchServices();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create service');
    } finally {
      setSaving(false);
    }
  };

  const isAllowedToEdit = can('pricing:edit') || can('services:manage');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 sm:pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Services & Pricing Engine</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Tenant-Specific Pricing · Kilogram vs. Piece-Based · Minimum Charge Rules
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            onClick={fetchServices}
            disabled={loading}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.98] transition-all min-h-[40px]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          {isAllowedToEdit && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-xl hover:bg-slate-800 active:scale-[0.98] transition-all min-h-[40px]"
            >
              <Plus className="w-4 h-4" />
              <span>Configure Service</span>
            </button>
          )}
        </div>
      </div>

      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full p-8 text-center text-xs text-slate-500">Loading service catalog...</div>
        ) : services.length === 0 ? (
          <div className="col-span-full p-8 text-center text-xs text-slate-500">No services configured yet.</div>
        ) : (
          services.map((service) => (
            <div
              key={service.id}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-4"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-medium text-indigo-600 uppercase tracking-wider">
                      {service.category}
                    </span>
                    <h3 className="text-base font-bold text-slate-900 mt-0.5">{service.name}</h3>
                  </div>
                  <span className="text-xs font-mono font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded uppercase">
                    per {service.pricingUnit}
                  </span>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Unit Price:</span>
                    <span className="text-sm font-bold text-slate-900">
                      <CurrencyDisplay amountCentavos={service.unitPriceCentavos} />
                      <span className="text-xs font-normal text-slate-500 font-sans"> / {service.pricingUnit}</span>
                    </span>
                  </div>

                  {service.minChargeCentavos > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Minimum Charge:</span>
                      <span className="font-semibold text-slate-800">
                        <CurrencyDisplay amountCentavos={service.minChargeCentavos} />
                        <span className="text-[11px] font-normal text-slate-400"> (min {service.minQuantity} {service.pricingUnit})</span>
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Standard Turnaround:</span>
                    <span className="font-mono text-slate-700 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>{service.defaultTurnaroundHours} hours</span>
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                <span>Status: Active</span>
                <span>Tenant: {tenant?.slug}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Service Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Add Laundry Service</h3>
              <button onClick={() => setShowAddModal(false)} className="text-xs text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateService} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Service Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Wash Dry & Fold"
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Category</label>
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Pricing Unit *</label>
                  <select
                    value={pricingUnit}
                    onChange={(e) => setPricingUnit(e.target.value as 'kg' | 'piece')}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 font-medium"
                  >
                    <option value="kg">Kilogram (kg)</option>
                    <option value="piece">Per Piece</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Unit Price (₱ PHP) *</label>
                  <input
                    type="number"
                    step="0.5"
                    required
                    value={unitPricePesos}
                    onChange={(e) => setUnitPricePesos(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-mono text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Min Charge (₱ PHP)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={minChargePesos}
                    onChange={(e) => setMinChargePesos(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-mono text-slate-800"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Min Quantity ({pricingUnit})</label>
                  <input
                    type="number"
                    step="0.5"
                    value={minQuantity}
                    onChange={(e) => setMinQuantity(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-mono text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Turnaround (Hours)</label>
                  <input
                    type="number"
                    value={turnaroundHours}
                    onChange={(e) => setTurnaroundHours(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-mono text-slate-800"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-1.5 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800"
                >
                  {saving ? 'Saving...' : 'Save Service'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
