import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import { api } from '../../lib/api.ts';
import type { Order, OrderStatus } from '../../types/database.ts';
import { CurrencyDisplay } from '../common/CurrencyDisplay.tsx';
import { StatusBadge } from '../common/StatusBadge.tsx';
import {
  RefreshCw,
  ArrowRight,
  X,
  Plus,
  QrCode,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { NewOrderModal } from './NewOrderModal.tsx';

interface OrderListProps {
  openNewOrder?: boolean;
  initialCustomerId?: string;
  onClearNewOrderIntent?: () => void;
  onNavigate?: (tab: string) => void;
}

export const OrderList: React.FC<OrderListProps> = ({
  openNewOrder = false,
  initialCustomerId,
  onClearNewOrderIntent,
  onNavigate,
}) => {
  const { tenant } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [showNewOrderModal, setShowNewOrderModal] = useState(openNewOrder);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  useEffect(() => {
    if (openNewOrder) {
      setShowNewOrderModal(true);
    }
  }, [openNewOrder]);

  const fetchOrders = () => {
    if (!tenant) return;
    setLoading(true);
    api
      .getOrders(tenant.id)
      .then((data) => {
        setOrders(data);
        if (selectedOrder) {
          const updated = data.find((o) => o.id === selectedOrder.id);
          if (updated) setSelectedOrder(updated);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load orders:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchOrders();
  }, [tenant]);

  const filteredOrders = orders.filter((o) => {
    if (statusFilter === 'all') return true;
    return o.status === statusFilter;
  });

  const handleStatusChange = async (orderId: string, newStatus: OrderStatus) => {
    if (!tenant) return;
    try {
      setUpdatingStatus(true);
      setErrorBanner(null);
      await api.updateOrderStatus(tenant.id, orderId, newStatus, `Staff updated order status via LaundryOS`);
      fetchOrders();
    } catch (err) {
      console.error('Failed to update order status:', err);
      setErrorBanner(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const nextStatusMap: Record<OrderStatus, OrderStatus | null> = {
    received: 'washing',
    washing: 'drying',
    drying: 'folding',
    folding: 'ready_for_pickup',
    ready_for_pickup: 'released',
    released: null,
    cancelled: null,
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 sm:pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Orders Lifecycle</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {tenant?.name} · Historical Price Snapshots · Status Transition Trail
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            onClick={fetchOrders}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.98] transition-all shrink-0 min-h-[42px]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Queue</span>
          </button>
          <button
            onClick={() => setShowNewOrderModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 active:scale-[0.98] transition-all shrink-0 min-h-[42px] shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>New Counter Order</span>
          </button>
        </div>
      </div>

      {errorBanner && (
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
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successBanner}</span>
          </div>
          <button onClick={() => setSuccessBanner(null)} className="text-emerald-700 font-semibold hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Horizontal Swipeable Filter Tabs */}
      <div className="overflow-x-auto pb-1 -mx-3 px-3 sm:mx-0 sm:px-0">
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl w-max">
          {['all', 'received', 'washing', 'drying', 'folding', 'ready_for_pickup', 'released'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors min-h-[36px] ${
                statusFilter === status
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {status === 'all'
                ? `All (${orders.length})`
                : status
                    .split('_')
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Responsive Orders Container */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Orders Listing */}
        <div className={`space-y-3 ${selectedOrder ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            {/* Mobile Card Layout (< 768px) */}
            <div className="block md:hidden divide-y divide-slate-100">
              {filteredOrders.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">No orders matching current filter.</div>
              ) : (
                filteredOrders.map((order) => {
                  const next = nextStatusMap[order.status];
                  return (
                    <div
                      key={order.id}
                      onClick={() => setSelectedOrder(order)}
                      className={`p-4 hover:bg-slate-50 active:bg-slate-100 transition-colors cursor-pointer space-y-2.5 ${
                        selectedOrder?.id === order.id ? 'bg-indigo-50/50' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-xs text-slate-900">
                          {order.orderNumber}
                        </span>
                        <StatusBadge status={order.status} type="order" />
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <div>
                          <div className="font-medium text-slate-800">{order.customer?.name || 'Walk-in'}</div>
                          <div className="text-[11px] text-slate-400 font-mono">{order.customer?.mobile}</div>
                        </div>
                        <StatusBadge status={order.paymentStatus} type="payment" />
                      </div>

                      <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100/80">
                        <div className="font-mono">
                          <span className="text-slate-500">Total: </span>
                          <span className="font-semibold text-slate-900">
                            <CurrencyDisplay amountCentavos={order.totalCentavos} />
                          </span>
                        </div>

                        {next && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStatusChange(order.id, next);
                            }}
                            disabled={updatingStatus}
                            className="px-2.5 py-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg inline-flex items-center gap-1 active:scale-[0.98] min-h-[36px]"
                          >
                            <span>Move to {next.replace(/_/g, ' ')}</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Desktop & Tablet Dense Data Grid (>= 768px) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-medium">
                    <th className="py-3 px-4">Order #</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Payment</th>
                    <th className="py-3 px-4 text-right">Total</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        No orders matching current filter.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((order) => {
                      const next = nextStatusMap[order.status];
                      return (
                        <tr
                          key={order.id}
                          onClick={() => setSelectedOrder(order)}
                          className={`cursor-pointer transition-colors ${
                            selectedOrder?.id === order.id ? 'bg-indigo-50/60' : 'hover:bg-slate-50/50'
                          }`}
                        >
                          <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                            {order.orderNumber}
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-800">
                            <div>{order.customer?.name || 'Walk-in'}</div>
                            <div className="text-[11px] text-slate-400 font-mono">{order.customer?.mobile}</div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <StatusBadge status={order.status} type="order" />
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <StatusBadge status={order.paymentStatus} type="payment" />
                          </td>
                          <td className="py-3 px-4 text-right font-medium whitespace-nowrap">
                            <CurrencyDisplay amountCentavos={order.totalCentavos} />
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            {next && (
                              <button
                                onClick={() => handleStatusChange(order.id, next)}
                                disabled={updatingStatus}
                                className="px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-200 transition-colors inline-flex items-center gap-1 active:scale-[0.98] min-h-[36px]"
                              >
                                <span>{next.replace(/_/g, ' ')}</span>
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Selected Order Detail (Responsive Side Panel on Desktop, Bottom Sheet on Mobile) */}
        {selectedOrder && (
          <div className="lg:col-span-1 fixed inset-x-0 bottom-0 z-50 lg:static lg:z-auto bg-white p-5 rounded-t-3xl lg:rounded-2xl border border-slate-200 shadow-2xl lg:shadow-xs space-y-4 max-h-[85vh] lg:max-h-none overflow-y-auto">
            {/* Grab handle affordance for mobile */}
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto lg:hidden -mt-1 mb-2" />

            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <span className="text-[11px] font-mono text-slate-400">Order Details Snapshot</span>
                <h3 className="text-base font-bold font-mono text-slate-900">{selectedOrder.orderNumber}</h3>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg min-h-[38px] min-w-[38px] flex items-center justify-center"
                aria-label="Close Order Details"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Customer:</span>
                <span className="font-semibold text-slate-900">{selectedOrder.customer?.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Mobile:</span>
                <span className="font-mono text-slate-700">{selectedOrder.customer?.mobile}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Status:</span>
                <StatusBadge status={selectedOrder.status} type="order" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Payment:</span>
                <StatusBadge status={selectedOrder.paymentStatus} type="payment" />
              </div>
            </div>

            {/* Line Items with Price Snapshots */}
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <div className="text-xs font-semibold text-slate-900">Line Items & Snapshots</div>
              {selectedOrder.items?.map((item) => (
                <div
                  key={item.id}
                  className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs"
                >
                  <div className="pr-2">
                    <div className="font-medium text-slate-800">{item.serviceNameSnapshot}</div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      {item.quantity} {item.pricingUnitSnapshot} @ ₱{(item.unitPriceCentavosSnapshot / 100).toFixed(2)}
                    </div>
                  </div>
                  <div className="font-bold text-slate-900 font-mono">
                    <CurrencyDisplay amountCentavos={item.subtotalCentavos} />
                  </div>
                </div>
              ))}
            </div>

            {/* Financial Summary */}
            <div className="pt-3 border-t border-slate-100 space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>Subtotal:</span>
                <CurrencyDisplay amountCentavos={selectedOrder.subtotalCentavos} />
              </div>
              {selectedOrder.expressFeeCentavos > 0 && (
                <div className="flex justify-between text-slate-500">
                  <span>Express Fee:</span>
                  <CurrencyDisplay amountCentavos={selectedOrder.expressFeeCentavos} />
                </div>
              )}
              {selectedOrder.discountCentavos > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>Discount:</span>
                  <span>
                    -<CurrencyDisplay amountCentavos={selectedOrder.discountCentavos} />
                  </span>
                </div>
              )}
              <div className="flex justify-between font-bold text-sm text-slate-900 pt-1 border-t border-slate-100">
                <span>Total:</span>
                <CurrencyDisplay amountCentavos={selectedOrder.totalCentavos} />
              </div>
              <div className="flex justify-between font-semibold text-amber-700">
                <span>Balance Due:</span>
                <CurrencyDisplay amountCentavos={selectedOrder.balanceCentavos} />
              </div>
            </div>

            {selectedOrder.balanceCentavos > 0 && onNavigate && (
              <button
                onClick={() => onNavigate('payments')}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 min-h-[42px]"
              >
                <QrCode className="w-4 h-4" />
                <span>Collect Payment / Show QR</span>
              </button>
            )}

            {/* Mobile Bottom Sheet Dismiss Button */}
            <button
              onClick={() => setSelectedOrder(null)}
              className="w-full lg:hidden py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs transition-colors min-h-[44px]"
            >
              Done Viewing
            </button>
          </div>
        )}
      </div>

      {showNewOrderModal && (
        <NewOrderModal
          initialCustomerId={initialCustomerId}
          onClose={() => {
            setShowNewOrderModal(false);
            onClearNewOrderIntent?.();
          }}
          onCreated={(created) => {
            setShowNewOrderModal(false);
            onClearNewOrderIntent?.();
            setSelectedOrder(created);
            setSuccessBanner(
              `Order ${created.orderNumber} created for ${created.customer?.name || 'customer'} (Total: ₱${(
                created.totalCentavos / 100
              ).toFixed(2)}).`
            );
            fetchOrders();
          }}
        />
      )}
    </div>
  );
};
