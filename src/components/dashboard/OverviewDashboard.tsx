import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import { api } from '../../lib/api.ts';
import type { Order, Payment } from '../../types/database.ts';
import { CurrencyDisplay } from '../common/CurrencyDisplay.tsx';
import { StatusBadge } from '../common/StatusBadge.tsx';
import {
  TrendingUp,
  Clock,
  CheckCircle,
  AlertCircle,
  ShieldCheck,
  Building2,
  ArrowRight,
  Package,
  QrCode,
  Plus,
} from 'lucide-react';

interface DashboardProps {
  onNavigate: (tab: string) => void;
  onNewOrder?: () => void;
}

export const OverviewDashboard: React.FC<DashboardProps> = ({ onNavigate, onNewOrder }) => {
  const { tenant, currentRole } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenant) return;
    setLoading(true);

    Promise.all([api.getOrders(tenant.id), api.getPayments(tenant.id)])
      .then(([ordersData, paymentsData]) => {
        setOrders(ordersData);
        setPayments(paymentsData);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load dashboard data:', err);
        setLoading(false);
      });
  }, [tenant]);

  // Compute metrics from real confirmed transactions
  const totalRevenueCentavos = payments.reduce((sum, p) => sum + p.amountCentavos, 0);
  const activeOrdersCount = orders.filter((o) => !['released', 'cancelled'].includes(o.status)).length;
  const readyOrdersCount = orders.filter((o) => o.status === 'ready_for_pickup').length;
  const outstandingBalanceCentavos = orders.reduce((sum, o) => sum + o.balanceCentavos, 0);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Top Banner / Responsive Context Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 sm:pb-4 border-b border-slate-200">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight truncate">
              {tenant?.name}
            </h1>
            <span className="text-[11px] font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200 uppercase font-semibold">
              {tenant?.status}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mt-1 flex-wrap">
            <span>Branch: Main Hub</span>
            <span aria-hidden="true">·</span>
            <span>PHP (₱)</span>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-indigo-600 uppercase">Role: {currentRole}</span>
          </div>
        </div>

        {/* Action Buttons - Wrap Cleanly, Never Clip */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0 w-full sm:w-auto">
          {onNewOrder && (
            <button
              onClick={onNewOrder}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 active:scale-[0.98] transition-all text-center min-h-[42px] shadow-xs"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span className="whitespace-nowrap">New Counter Order</span>
            </button>
          )}
          <button
            onClick={() => onNavigate('payments')}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-xl hover:bg-indigo-100 active:scale-[0.98] transition-all text-center min-h-[42px]"
          >
            <QrCode className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
            <span className="whitespace-nowrap">Show QR Pay</span>
          </button>
          <button
            onClick={() => onNavigate('orders')}
            className="flex-1 sm:flex-initial px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.98] transition-all text-center min-h-[42px] flex items-center justify-center"
          >
            Orders Queue
          </button>
          <button
            onClick={() => onNavigate('security')}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-xl hover:bg-slate-800 active:scale-[0.98] transition-all text-center min-h-[42px]"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="whitespace-nowrap">Verify Security</span>
          </button>
        </div>
      </div>

      {/* KPI Metrics Strip - Responsive 2-Col on Mobile/Tablet, 4-Col on Desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Metric 1: Revenue Collected */}
        <div className="bg-white p-3.5 sm:p-5 rounded-2xl border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span className="truncate pr-1">Total Collected</span>
            <TrendingUp className="w-4 h-4 text-emerald-600 shrink-0" />
          </div>
          <div className="text-lg sm:text-2xl font-bold tracking-tight text-slate-900 truncate">
            <CurrencyDisplay amountCentavos={totalRevenueCentavos} />
          </div>
          <div className="text-[11px] text-slate-400 pt-0.5 truncate">
            {payments.length} verified payments
          </div>
        </div>

        {/* Metric 2: Active Orders */}
        <div className="bg-white p-3.5 sm:p-5 rounded-2xl border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span className="truncate pr-1">In Processing</span>
            <Clock className="w-4 h-4 text-indigo-600 shrink-0" />
          </div>
          <div className="text-lg sm:text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
            {activeOrdersCount}
          </div>
          <div className="text-[11px] text-slate-400 pt-0.5 truncate">Wash, dry, or fold</div>
        </div>

        {/* Metric 3: Ready for Pickup */}
        <div className="bg-white p-3.5 sm:p-5 rounded-2xl border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span className="truncate pr-1">Ready for Pickup</span>
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
          </div>
          <div className="text-lg sm:text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
            {readyOrdersCount}
          </div>
          <div className="text-[11px] text-slate-400 pt-0.5 truncate">Ready for collection</div>
        </div>

        {/* Metric 4: Outstanding Balance */}
        <div className="bg-white p-3.5 sm:p-5 rounded-2xl border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span className="truncate pr-1">Receivables</span>
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          </div>
          <div className="text-lg sm:text-2xl font-bold tracking-tight text-slate-900 truncate">
            <CurrencyDisplay amountCentavos={outstandingBalanceCentavos} />
          </div>
          <div className="text-[11px] text-slate-400 pt-0.5 truncate">Unpaid balances</div>
        </div>
      </div>

      {/* Recent Orders Section - Responsive Card View on Mobile, Data Table on Tablet/Desktop */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-100 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Recent Tenant Orders</h3>
            <p className="text-xs text-slate-500 mt-0.5 hidden xs:block">
              Real-time processing queue with snapshot pricing
            </p>
          </div>
          <button
            onClick={() => onNavigate('orders')}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1 shrink-0 p-1"
          >
            <span>View All ({orders.length})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Loading order queue...</div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">No orders created in this tenant yet.</div>
        ) : (
          <>
            {/* Mobile Card List (Visible on phones < 640px) */}
            <div className="block sm:hidden divide-y divide-slate-100">
              {orders.slice(0, 5).map((order) => (
                <div
                  key={order.id}
                  onClick={() => onNavigate('orders')}
                  className="p-3.5 hover:bg-slate-50 active:bg-slate-100 transition-colors cursor-pointer space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-xs text-slate-900">
                      {order.orderNumber}
                    </span>
                    <StatusBadge status={order.status} type="order" />
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700">{order.customer?.name || 'Walk-in'}</span>
                    <StatusBadge status={order.paymentStatus} type="payment" />
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100/80 font-mono">
                    <span className="text-slate-500">
                      Total: <CurrencyDisplay amountCentavos={order.totalCentavos} />
                    </span>
                    {order.balanceCentavos > 0 ? (
                      <span className="text-amber-600 font-semibold">
                        Due: <CurrencyDisplay amountCentavos={order.balanceCentavos} />
                      </span>
                    ) : (
                      <span className="text-emerald-600 font-medium">Fully Paid</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop & Tablet Table (Visible on screens >= 640px) */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-medium">
                    <th className="py-2.5 px-4">Order #</th>
                    <th className="py-2.5 px-4">Customer</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Payment</th>
                    <th className="py-2.5 px-4 text-right">Total (₱)</th>
                    <th className="py-2.5 px-4 text-right">Balance (₱)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {orders.slice(0, 5).map((order) => (
                    <tr
                      key={order.id}
                      onClick={() => onNavigate('orders')}
                      className="hover:bg-slate-50/50 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                        {order.orderNumber}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-800">
                        {order.customer?.name || 'Walk-in Client'}
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={order.status} type="order" />
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={order.paymentStatus} type="payment" />
                      </td>
                      <td className="py-3 px-4 text-right font-medium">
                        <CurrencyDisplay amountCentavos={order.totalCentavos} />
                      </td>
                      <td className="py-3 px-4 text-right font-semibold">
                        {order.balanceCentavos > 0 ? (
                          <span className="text-amber-600">
                            <CurrencyDisplay amountCentavos={order.balanceCentavos} />
                          </span>
                        ) : (
                          <span className="text-slate-400 font-mono">₱0.00</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Tenant Isolation Proof Notice */}
      <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-100/70 border border-slate-200 text-xs text-slate-600 flex items-start gap-3">
        <Building2 className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
        <div className="space-y-1 min-w-0">
          <div className="font-semibold text-slate-800">Multi-Tenant Partition Guarantee</div>
          <p className="leading-relaxed text-[11px] sm:text-xs">
            Data belongs strictly to <strong>{tenant?.name}</strong>. Switching roles or operating tenants immediately isolates all orders, customer records, and financial balances with zero cross-tenant contamination.
          </p>
        </div>
      </div>
    </div>
  );
};
