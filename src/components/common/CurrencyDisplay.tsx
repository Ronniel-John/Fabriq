import React from 'react';

interface CurrencyDisplayProps {
  amountCentavos: number;
  className?: string;
}

export const CurrencyDisplay: React.FC<CurrencyDisplayProps> = ({ amountCentavos, className = '' }) => {
  const pesos = (amountCentavos / 100).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <span className={`tabular-nums font-mono font-medium text-slate-900 ${className}`}>
      ₱{pesos}
    </span>
  );
};
