import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import { api } from '../../lib/api.ts';
import type { Branch, Customer, Order, Service } from '../../types/database.ts';
import { CurrencyDisplay } from '../common/CurrencyDisplay.tsx';
import {
  X,
  Plus,
  Trash2,
  Scale,
  UserPlus,
  Users,
  Sparkles,
  Wallet,
  QrCode,
  AlertTriangle,
  Clock,
} from 'lucide-react';

interface NewOrderModalProps {
  initialCustomerId?: string;
  onClose: () => void;
  onCreated: (order: Order) => void;
}

interface DraftLineItem {
  key: string;
  serviceId: string;
  quantityStr: string;
  notes: string;
}

export const NewOrderModal: React.FC<NewOrderModalProps> = ({
  initialCustomerId,
  onClose,
  onCreated,
}) => {
  const { tenant } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  // Customer selection vs inline walk-in creation
  const [customerMode, setCustomerMode] = useState<'existing' | 'new_walkin'>('existing');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(initialCustomerId || '');
  const [walkinName, setWalkinName] = useState('');
  const [walkinMobile, setWalkinMobile] = useState('');
  const [walkinAddress, setWalkinAddress] = useState('');

  // Order details & line items
  const [branchId, setBranchId] = useState('');
  const [lineItems, setLineItems] = useState<DraftLineItem[]>([]);
  const [discountPesos, setDiscountPesos] = useState('0');
  const [expressPesos, setExpressPesos] = useState('0');
  const [expectedHours, setExpectedHours] = useState('24');
  const [orderNotes, setOrderNotes] = useState('');

  // Counter payment at drop-off
  const [paymentTiming, setPaymentTiming] = useState<'later' | 'full' | 'partial'>('later');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'qr_ph'>('cash');
  const [depositPesos, setDepositPesos] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!tenant) return;
    setLoadingCatalog(true);
    Promise.all([
      api.getCustomers(tenant.id),
      api.getServices(tenant.id),
      api.getBranches(tenant.id).catch(() => [] as Branch[]),
    ])
      .then(([custData, servData, branchData]) => {
        setCustomers(custData);
        const activeServices = servData.filter((s) => s.isActive);
        setServices(activeServices);
        setBranches(branchData);

        if (branchData.length > 0) {
          setBranchId(branchData[0].id);
        }

        if (initialCustomerId && custData.some((c) => c.id === initialCustomerId)) {
          setCustomerMode('existing');
          setSelectedCustomerId(initialCustomerId);
        } else if (custData.length > 0) {
          setCustomerMode('existing');
          setSelectedCustomerId(custData[0].id);
        } else {
          setCustomerMode('new_walkin');
        }

        if (activeServices.length > 0) {
          const defaultService = activeServices[0];
          setLineItems([
            {
              key: `line-${Date.now()}`,
              serviceId: defaultService.id,
              quantityStr: String(defaultService.minQuantity || 3),
              notes: '',
            },
          ]);
          setExpectedHours(String(defaultService.defaultTurnaroundHours || 24));
        }
        setLoadingCatalog(false);
      })
      .catch((err) => {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load services & customers');
        setLoadingCatalog(false);
      });
  }, [tenant, initialCustomerId]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId),
    [customers, selectedCustomerId]
  );

  const serviceMap = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);

  // Exact mirror of server pricing engine (POST /api/tenants/:tenantId/orders)
  const calculatedLines = useMemo(() => {
    return lineItems.map((line) => {
      const service = serviceMap.get(line.serviceId);
      const qty = parseFloat(line.quantityStr);
      if (!service || isNaN(qty) || qty <= 0) {
        return { ...line, service, qty: 0, subtotalCentavos: 0, minApplied: false };
      }
      const rawCentavos = Math.round(qty * service.unitPriceCentavos);
      const minApplied = Boolean(service.minChargeCentavos && rawCentavos < service.minChargeCentavos);
      const subtotalCentavos = minApplied ? service.minChargeCentavos : rawCentavos;
      return { ...line, service, qty, subtotalCentavos, minApplied };
    });
  }, [lineItems, serviceMap]);

  const subtotalCentavos = useMemo(
    () => calculatedLines.reduce((sum, l) => sum + l.subtotalCentavos, 0),
    [calculatedLines]
  );

  const discountCentavos = Math.max(0, Math.round((parseFloat(discountPesos) || 0) * 100));
  const expressFeeCentavos = Math.max(0, Math.round((parseFloat(expressPesos) || 0) * 100));
  const totalCentavos = Math.max(0, subtotalCentavos - discountCentavos + expressFeeCentavos);

  const handleAddLine = () => {
    if (services.length === 0) return;
    const nextSvc = services[Math.min(lineItems.length, services.length - 1)];
    setLineItems((prev) => [
      ...prev,
      {
        key: `line-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        serviceId: nextSvc.id,
        quantityStr: String(nextSvc.minQuantity || 1),
        notes: '',
      },
    ]);
  };

  const handleUpdateLine = (key: string, patch: Partial<DraftLineItem>) => {
    setLineItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item;
        const updated = { ...item, ...patch };
        if (patch.serviceId && patch.serviceId !== item.serviceId) {
          const svc = serviceMap.get(patch.serviceId);
          if (svc) {
            updated.quantityStr = String(svc.minQuantity || 1);
          }
        }
        return updated;
      })
    );
  };

  const handleRemoveLine = (key: string) => {
    if (lineItems.length <= 1) return;
    setLineItems((prev) => prev.filter((item) => item.key !== key));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant) return;
    setErrorMsg(null);

    const validItems = calculatedLines.filter((l) => l.service && l.qty > 0);
    if (validItems.length === 0) {
      setErrorMsg('Please select at least one service and enter a valid KG / piece quantity.');
      return;
    }

    if (customerMode === 'existing' && !selectedCustomerId) {
      setErrorMsg('Please select a customer or switch to Quick Walk-In Customer.');
      return;
    }

    if (customerMode === 'new_walkin' && (!walkinName.trim() || !walkinMobile.trim())) {
      setErrorMsg('Please enter the walk-in customer full name and mobile number.');
      return;
    }

    let payNowCentavos = 0;
    if (paymentTiming === 'full') {
      payNowCentavos = totalCentavos;
    } else if (paymentTiming === 'partial') {
      payNowCentavos = Math.round((parseFloat(depositPesos) || 0) * 100);
      if (payNowCentavos <= 0 || payNowCentavos > totalCentavos) {
        setErrorMsg(
          `Deposit amount must be between ₱1.00 and ₱${(totalCentavos / 100).toFixed(2)}.`
        );
        return;
      }
    }

    try {
      setSubmitting(true);

      let targetCustomerId = selectedCustomerId;
      if (customerMode === 'new_walkin') {
        const createdCustomer = await api.createCustomer(tenant.id, {
          name: walkinName.trim(),
          mobile: walkinMobile.trim(),
          address: walkinAddress.trim() || undefined,
          customerType: 'walk_in',
          branchId: branchId || branches[0]?.id,
        });
        targetCustomerId = createdCustomer.id;
      }

      const createdOrder = await api.createOrder(tenant.id, {
        customerId: targetCustomerId,
        branchId: branchId || branches[0]?.id,
        items: validItems.map((l) => ({
          serviceId: l.serviceId,
          quantity: l.qty,
          notes: l.notes.trim() || undefined,
        })),
        discountCentavos,
        expressFeeCentavos,
        expectedHours: parseInt(expectedHours, 10) || 24,
        notes: orderNotes.trim() || undefined,
      });

      let finalOrder = createdOrder;
      if (payNowCentavos > 0) {
        const payRes = await api.recordPayment(tenant.id, createdOrder.id, {
          amountCentavos: payNowCentavos,
          method: paymentMethod,
          notes:
            paymentTiming === 'full'
              ? 'Paid in full at counter drop-off'
              : 'Drop-off deposit collected at counter',
        });
        finalOrder = {
          ...createdOrder,
          ...payRes.order,
          items: createdOrder.items,
          customer: createdOrder.customer,
        };
      }

      onCreated(finalOrder);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create laundry order');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full p-5 sm:p-6 space-y-5 my-auto max-h-[94vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center">
              <Scale className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">New Walk-In / Counter Order (POS)</h3>
              <p className="text-[11px] text-slate-500">
                Weigh clothes (KG / pieces) · Live Pricing Engine · Instant Ticket & Payment
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {loadingCatalog ? (
          <div className="py-12 text-center text-xs text-slate-500">
            Loading customers and service pricing catalog...
          </div>
        ) : services.length === 0 ? (
          <div className="p-6 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-2">
            <div className="font-bold">No Active Services Configured</div>
            <p>
              Please configure at least one service (e.g. Wash & Fold per kg) under{' '}
              <strong>Services & Pricing</strong> before creating counter orders.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 text-xs">
            {/* 1. Customer Selection */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                  1. Customer
                </label>
                <div className="inline-flex rounded-xl bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setCustomerMode('existing')}
                    className={`px-3 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                      customerMode === 'existing'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>Existing Customer ({customers.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomerMode('new_walkin')}
                    className={`px-3 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                      customerMode === 'new_walkin'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Quick Walk-In</span>
                  </button>
                </div>
              </div>

              {customerMode === 'existing' ? (
                <div className="space-y-2">
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[42px]"
                  >
                    {customers.length === 0 ? (
                      <option value="">No saved customers yet — use Quick Walk-In</option>
                    ) : (
                      customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} · {c.mobile}
                          {c.customerType === 'pickup_delivery' ? ' (Pickup & Delivery)' : ''}
                        </option>
                      ))
                    )}
                  </select>

                  {selectedCustomer && (selectedCustomer.washPreferences || selectedCustomer.address) && (
                    <div className="p-2.5 rounded-xl bg-indigo-50/60 border border-indigo-100 text-[11px] text-indigo-900 flex flex-wrap items-center gap-x-4 gap-y-1">
                      {selectedCustomer.washPreferences && (
                        <span className="inline-flex items-center gap-1 font-medium">
                          <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                          Pref: {selectedCustomer.washPreferences}
                        </span>
                      )}
                      {selectedCustomer.address && (
                        <span className="text-slate-600">Addr: {selectedCustomer.address}</span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Full Name *</label>
                    <input
                      type="text"
                      required={customerMode === 'new_walkin'}
                      value={walkinName}
                      onChange={(e) => setWalkinName(e.target.value)}
                      placeholder="Walk-in Customer Name"
                      className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-slate-900 min-h-[38px]"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Mobile *</label>
                    <input
                      type="text"
                      required={customerMode === 'new_walkin'}
                      value={walkinMobile}
                      onChange={(e) => setWalkinMobile(e.target.value)}
                      placeholder="+63 917 000 0000"
                      className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-2 font-mono text-slate-900 min-h-[38px]"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Address (Optional)</label>
                    <input
                      type="text"
                      value={walkinAddress}
                      onChange={(e) => setWalkinAddress(e.target.value)}
                      placeholder="Barangay / Condo"
                      className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-slate-900 min-h-[38px]"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 2. Services & Weight (KG / Pieces) */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                  2. Services, Weight (KG) & Quantity
                </label>
                <button
                  type="button"
                  onClick={handleAddLine}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 font-semibold text-[11px]"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Service Line</span>
                </button>
              </div>

              <div className="space-y-2.5">
                {calculatedLines.map((line) => {
                  const unitLabel = line.service?.pricingUnit || 'kg';
                  return (
                    <div
                      key={line.key}
                      className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                        <div className="sm:col-span-6">
                          <label className="block font-medium text-slate-600 mb-1">Service</label>
                          <select
                            value={line.serviceId}
                            onChange={(e) => handleUpdateLine(line.key, { serviceId: e.target.value })}
                            className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-slate-900 font-medium min-h-[40px]"
                          >
                            {services.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} — ₱{(s.unitPriceCentavos / 100).toFixed(2)}/{s.pricingUnit}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-3">
                          <label className="block font-medium text-slate-600 mb-1">
                            {unitLabel === 'kg' ? 'Weight (KG) *' : 'Qty (Pieces) *'}
                          </label>
                          <div className="relative">
                            <input
                              type="number"
                              step={unitLabel === 'kg' ? '0.1' : '1'}
                              min={unitLabel === 'kg' ? '0.1' : '1'}
                              required
                              value={line.quantityStr}
                              onChange={(e) =>
                                handleUpdateLine(line.key, { quantityStr: e.target.value })
                              }
                              className="w-full bg-white border border-slate-300 rounded-lg pl-2.5 pr-10 py-2 font-mono font-bold text-slate-900 min-h-[40px]"
                            />
                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-mono text-slate-400">
                              {unitLabel}
                            </span>
                          </div>
                        </div>

                        <div className="sm:col-span-3 flex items-center justify-between sm:justify-end gap-2 min-h-[40px]">
                          <div className="text-left sm:text-right">
                            <div className="text-[10px] text-slate-400 uppercase">Line Amount</div>
                            <div className="text-sm font-bold font-mono text-slate-900">
                              <CurrencyDisplay amountCentavos={line.subtotalCentavos} />
                            </div>
                          </div>
                          {lineItems.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveLine(line.key)}
                              className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50"
                              aria-label="Remove service line"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between flex-wrap gap-2 text-[11px]">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {unitLabel === 'kg' &&
                            ['3', '5', '7', '10'].map((w) => (
                              <button
                                key={w}
                                type="button"
                                onClick={() => handleUpdateLine(line.key, { quantityStr: w })}
                                className={`px-2 py-0.5 rounded border font-mono ${
                                  line.quantityStr === w
                                    ? 'bg-slate-900 text-white border-slate-900'
                                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                                }`}
                              >
                                {w} kg
                              </button>
                            ))}
                          {line.minApplied && line.service && (
                            <span className="text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded font-medium">
                              Min charge ₱{(line.service.minChargeCentavos / 100).toFixed(2)} applied (min{' '}
                              {line.service.minQuantity} {unitLabel})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3. Fees, Discount & Notes */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              {branches.length > 0 && (
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Branch</label>
                  <select
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 text-slate-900 font-medium min-h-[40px]"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block font-medium text-slate-700 mb-1">Express Fee (₱)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={expressPesos}
                  onChange={(e) => setExpressPesos(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono text-slate-900 min-h-[40px]"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Discount (₱)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={discountPesos}
                  onChange={(e) => setDiscountPesos(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono text-slate-900 min-h-[40px]"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-400" />
                  <span>Turnaround (hrs)</span>
                </label>
                <input
                  type="number"
                  min="1"
                  value={expectedHours}
                  onChange={(e) => setExpectedHours(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono text-slate-900 min-h-[40px]"
                />
              </div>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Counter / Bag Notes (Optional)</label>
              <input
                type="text"
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                placeholder="e.g. 2 laundry bags, separate white polos, call upon ready"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 min-h-[40px]"
              />
            </div>

            {/* 4. Order Total & Payment Collection */}
            <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">
                    Computed Order Total
                  </div>
                  <div className="text-2xl font-bold font-mono tracking-tight">
                    <CurrencyDisplay amountCentavos={totalCentavos} />
                  </div>
                </div>
                <div className="text-right text-[11px] text-slate-300 font-mono space-y-0.5">
                  <div>
                    Subtotal: <CurrencyDisplay amountCentavos={subtotalCentavos} />
                  </div>
                  {expressFeeCentavos > 0 && (
                    <div>
                      Express: +<CurrencyDisplay amountCentavos={expressFeeCentavos} />
                    </div>
                  )}
                  {discountCentavos > 0 && (
                    <div className="text-emerald-300">
                      Discount: -<CurrencyDisplay amountCentavos={discountCentavos} />
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 space-y-2.5">
                <div className="text-[11px] font-semibold text-slate-300">
                  Counter Payment at Drop-Off
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'later', label: 'Pay on Pickup' },
                    { id: 'full', label: 'Paid Full Now' },
                    { id: 'partial', label: 'Deposit Now' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setPaymentTiming(opt.id as 'later' | 'full' | 'partial')}
                      className={`py-2 px-2.5 rounded-xl text-[11px] font-semibold border transition-colors ${
                        paymentTiming === opt.id
                          ? 'bg-indigo-600 border-indigo-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {paymentTiming !== 'later' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    <div>
                      <label className="block text-[11px] text-slate-300 mb-1">Payment Method</label>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPaymentMethod('cash')}
                          className={`py-2 px-2.5 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 border ${
                            paymentMethod === 'cash'
                              ? 'bg-emerald-600 border-emerald-500 text-white'
                              : 'bg-slate-800 border-slate-700 text-slate-300'
                          }`}
                        >
                          <Wallet className="w-3.5 h-3.5" />
                          <span>Cash</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaymentMethod('qr_ph')}
                          className={`py-2 px-2.5 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 border ${
                            paymentMethod === 'qr_ph'
                              ? 'bg-emerald-600 border-emerald-500 text-white'
                              : 'bg-slate-800 border-slate-700 text-slate-300'
                          }`}
                        >
                          <QrCode className="w-3.5 h-3.5" />
                          <span>QR Ph / GCash</span>
                        </button>
                      </div>
                    </div>

                    {paymentTiming === 'partial' && (
                      <div>
                        <label className="block text-[11px] text-slate-300 mb-1">
                          Deposit Amount (₱)
                        </label>
                        <input
                          type="number"
                          step="1"
                          min="1"
                          required
                          value={depositPesos}
                          onChange={(e) => setDepositPesos(e.target.value)}
                          placeholder={`Max ${(totalCentavos / 100).toFixed(2)}`}
                          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 font-mono text-white min-h-[38px]"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium min-h-[42px]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-50 min-h-[42px]"
              >
                {submitting
                  ? 'Creating Order...'
                  : paymentTiming === 'later'
                  ? 'Create Order Ticket'
                  : 'Create Order & Record Payment'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
