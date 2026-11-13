import React from 'react';
import type { OrderStatus, PaymentStatus } from '../../types/database.ts';

interface StatusBadgeProps {
  status: OrderStatus | PaymentStatus | string;
  type?: 'order' | 'payment';
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, type = 'order', className = '' }) => {
  // Format human-readable text
  const label = status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  let colorClasses = 'text-slate-600 bg-slate-100 border-slate-200';

  if (type === 'payment') {
    switch (status) {
      case 'paid':
        colorClasses = 'text-emerald-700 bg-emerald-50 border-emerald-200';
        break;
      case 'partial':
        colorClasses = 'text-amber-700 bg-amber-50 border-amber-200';
        break;
      case 'unpaid':
        colorClasses = 'text-rose-700 bg-rose-50 border-rose-200';
        break;
    }
  } else {
    switch (status) {
      case 'received':
        colorClasses = 'text-sky-700 bg-sky-50 border-sky-200';
        break;
      case 'washing':
      case 'drying':
      case 'folding':
        colorClasses = 'text-indigo-700 bg-indigo-50 border-indigo-200';
        break;
      case 'ready_for_pickup':
        colorClasses = 'text-emerald-700 bg-emerald-50 border-emerald-200';
        break;
      case 'released':
        colorClasses = 'text-slate-700 bg-slate-100 border-slate-200';
        break;
      case 'cancelled':
        colorClasses = 'text-rose-700 bg-rose-50 border-rose-200';
        break;
    }
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border ${colorClasses} ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      <span>{label}</span>
    </span>
  );
};
