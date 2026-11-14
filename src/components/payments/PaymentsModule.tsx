import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import { api } from '../../lib/api.ts';
import type { Order, Payment, TenantQrSettings } from '../../types/database.ts';
import { CurrencyDisplay } from '../common/CurrencyDisplay.tsx';
import { StatusBadge } from '../common/StatusBadge.tsx';
import {
  QrCode,
  Upload,
  CheckCircle2,
  Maximize2,
  Minimize2,
  DollarSign,
  CreditCard,
  Building2,
  Phone,
  User,
  AlertCircle,
  RefreshCw,
  Plus,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  Check,
  Image as ImageIcon,
  Smartphone,
} from 'lucide-react';

export const PaymentsModule: React.FC = () => {
  const { tenant, currentRole, can } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState<'presenter' | 'upload' | 'ledger'>('presenter');
  const [qrSettings, setQrSettings] = useState<TenantQrSettings | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  // Presenter state
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [customAmountPesos, setCustomAmountPesos] = useState<string>('');
  const [fullScreenStand, setFullScreenStand] = useState(false);

  // Upload & Edit state
  const [previewImage, setPreviewImage] = useState<string>('');
  const [merchantName, setMerchantName] = useState<string>('');
  const [accountName, setAccountName] = useState<string>('');
  const [accountNumber, setAccountNumber] = useState<string>('');
  const [provider, setProvider] = useState<'qr_ph' | 'gcash' | 'maya' | 'bank' | 'other'>('qr_ph');
  const [notes, setNotes] = useState<string>('');
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Record payment modal
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [recordOrderId, setRecordOrderId] = useState<string>('');
  const [recordAmountPesos, setRecordAmountPesos] = useState<string>('');
  const [recordMethod, setRecordMethod] = useState<'qr_ph' | 'cash'>('qr_ph');
  const [recordRefNumber, setRecordRefNumber] = useState<string>('');
  const [recordNotes, setRecordNotes] = useState<string>('');
  const [recordingPayment, setRecordingPayment] = useState(false);

  const isAllowedToManage = can('tenant:manage_settings') || currentRole === 'owner' || currentRole === 'manager';

  const loadData = () => {
    if (!tenant) return;
    setLoading(true);
    Promise.all([
      api.getQrSettings(tenant.id),
      api.getOrders(tenant.id),
      api.getPayments(tenant.id),
    ])
      .then(([qrData, ordersData, paymentsData]) => {
        const settings = qrData.qrSettings;
        setQrSettings(settings);
        if (settings) {
          setPreviewImage(settings.qrCodeImageUrl);
          setMerchantName(settings.merchantName || tenant.name);
          setAccountName(settings.accountName || '');
          setAccountNumber(settings.accountNumber || '');
          setProvider(settings.provider || 'qr_ph');
          setNotes(settings.notes || '');
        } else {
          setMerchantName(tenant.name);
        }
        setOrders(ordersData);
        setPayments(paymentsData);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load payment module data:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadData();
  }, [tenant]);

  // Compress & resize QR image via offscreen canvas so it stays safely under Firestore 1MB limit
  const compressQrImage = (dataUrl: string, mimeType: string): Promise<string> => {
    if (mimeType === 'image/svg+xml' && dataUrl.length <= 650000) {
      return Promise.resolve(dataUrl);
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 720;
        let width = img.width || maxDim;
        let height = img.height || maxDim;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        // White background keeps black QR modules crisp when converting transparent PNGs to JPEG/WebP
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, width, height);

        // Try crisp PNG first if already small enough
        const pngDataUrl = canvas.toDataURL('image/png');
        if (pngDataUrl.length <= 450000) {
          resolve(pngDataUrl);
          return;
        }

        // Fall back to high-quality WebP/JPEG compression loop
        for (const quality of [0.88, 0.78, 0.65, 0.5]) {
          const compressed = canvas.toDataURL('image/jpeg', quality);
          if (compressed.length <= 650000) {
            resolve(compressed);
            return;
          }
        }
        resolve(canvas.toDataURL('image/jpeg', 0.45));
      };
      img.onerror = () => reject(new Error('Could not decode uploaded image file'));
      img.src = dataUrl;
    });
  };

  // Handle image file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedbackError(null);

    if (!file.type.startsWith('image/')) {
      setFeedbackError('Please upload an image file (PNG, JPG, JPEG, or WEBP).');
      return;
    }

    // Limit raw selection to 10MB before client-side compression
    if (file.size > 10 * 1024 * 1024) {
      setFeedbackError('File size exceeds 10MB. Please choose a smaller image.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const result = event.target?.result as string;
      try {
        const optimized = await compressQrImage(result, file.type);
        if (optimized.length > 740000) {
          setFeedbackError('Compressed image still exceeds storage limit. Please crop closer to the QR code.');
          return;
        }
        setPreviewImage(optimized);
      } catch (err) {
        setFeedbackError(err instanceof Error ? err.message : 'Failed to process QR image.');
      }
    };
    reader.readAsDataURL(file);
  };

  // Save QR Settings to backend
  const handleSaveQrSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant) return;
    setFeedbackError(null);
    if (!previewImage) {
      setFeedbackError('Please select or upload a QR Code picture first.');
      return;
    }

    try {
      setSavingSettings(true);
      const res = await api.updateQrSettings(tenant.id, {
        qrCodeImageUrl: previewImage,
        merchantName: merchantName || tenant.name,
        accountName,
        accountNumber,
        provider,
        notes,
      });

      setQrSettings(res.qrSettings);
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 3000);
      setActiveSubTab('presenter');
    } catch (err: any) {
      setFeedbackError(err.message || 'Failed to update QR Code settings');
    } finally {
      setSavingSettings(false);
    }
  };

  // Preset Template generator
  const handleLoadPreset = (type: 'gcash' | 'maya' | 'universal') => {
    const color = type === 'gcash' ? '#0052cc' : type === 'maya' ? '#059669' : '#0f172a';
    const label = type === 'gcash' ? 'GCASH QR' : type === 'maya' ? 'MAYA QR PH' : 'QR PH INSTAPAY';

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320">
      <rect width="320" height="320" fill="#ffffff" rx="16"/>
      <rect x="25" y="25" width="70" height="70" fill="${color}" rx="8"/>
      <rect x="35" y="35" width="50" height="50" fill="#ffffff" rx="4"/>
      <rect x="45" y="45" width="30" height="30" fill="${color}" rx="2"/>
      <rect x="225" y="25" width="70" height="70" fill="${color}" rx="8"/>
      <rect x="235" y="35" width="50" height="50" fill="#ffffff" rx="4"/>
      <rect x="245" y="45" width="30" height="30" fill="${color}" rx="2"/>
      <rect x="25" y="225" width="70" height="70" fill="${color}" rx="8"/>
      <rect x="35" y="235" width="50" height="50" fill="#ffffff" rx="4"/>
      <rect x="45" y="245" width="30" height="30" fill="${color}" rx="2"/>
      <rect x="110" y="30" width="14" height="14" fill="#0f172a"/>
      <rect x="135" y="30" width="14" height="14" fill="#0f172a"/>
      <rect x="160" y="30" width="14" height="14" fill="#0f172a"/>
      <rect x="185" y="30" width="14" height="14" fill="#0f172a"/>
      <rect x="110" y="55" width="14" height="14" fill="#0f172a"/>
      <rect x="160" y="55" width="14" height="14" fill="#0f172a"/>
      <rect x="185" y="55" width="14" height="14" fill="#0f172a"/>
      <rect x="125" y="80" width="14" height="14" fill="#0f172a"/>
      <rect x="150" y="80" width="14" height="14" fill="#0f172a"/>
      <rect x="175" y="80" width="14" height="14" fill="#0f172a"/>
      <rect x="30" y="110" width="14" height="14" fill="#0f172a"/>
      <rect x="55" y="110" width="14" height="14" fill="#0f172a"/>
      <rect x="80" y="110" width="14" height="14" fill="#0f172a"/>
      <rect x="30" y="135" width="14" height="14" fill="#0f172a"/>
      <rect x="75" y="135" width="14" height="14" fill="#0f172a"/>
      <rect x="45" y="160" width="14" height="14" fill="#0f172a"/>
      <rect x="80" y="160" width="14" height="14" fill="#0f172a"/>
      <rect x="225" y="110" width="14" height="14" fill="#0f172a"/>
      <rect x="250" y="110" width="14" height="14" fill="#0f172a"/>
      <rect x="275" y="110" width="14" height="14" fill="#0f172a"/>
      <rect x="225" y="135" width="14" height="14" fill="#0f172a"/>
      <rect x="265" y="135" width="14" height="14" fill="#0f172a"/>
      <rect x="240" y="160" width="14" height="14" fill="#0f172a"/>
      <rect x="275" y="160" width="14" height="14" fill="#0f172a"/>
      <rect x="110" y="225" width="14" height="14" fill="#0f172a"/>
      <rect x="140" y="225" width="14" height="14" fill="#0f172a"/>
      <rect x="170" y="225" width="14" height="14" fill="#0f172a"/>
      <rect x="125" y="250" width="14" height="14" fill="#0f172a"/>
      <rect x="155" y="250" width="14" height="14" fill="#0f172a"/>
      <rect x="185" y="250" width="14" height="14" fill="#0f172a"/>
      <rect x="110" y="275" width="14" height="14" fill="#0f172a"/>
      <rect x="140" y="275" width="14" height="14" fill="#0f172a"/>
      <rect x="170" y="275" width="14" height="14" fill="#0f172a"/>
      <rect x="225" y="225" width="14" height="14" fill="#0f172a"/>
      <rect x="255" y="225" width="14" height="14" fill="#0f172a"/>
      <rect x="240" y="250" width="14" height="14" fill="#0f172a"/>
      <rect x="275" y="250" width="14" height="14" fill="#0f172a"/>
      <rect x="225" y="275" width="14" height="14" fill="#0f172a"/>
      <rect x="260" y="275" width="14" height="14" fill="#0f172a"/>
      <rect x="105" y="105" width="110" height="110" fill="#ffffff" rx="14" stroke="#cbd5e1" stroke-width="2"/>
      <rect x="112" y="112" width="96" height="96" fill="${color}" rx="10"/>
      <text x="160" y="152" font-family="system-ui, -apple-system, sans-serif" font-weight="900" font-size="16" fill="#ffffff" text-anchor="middle">QR Ph</text>
      <text x="160" y="174" font-family="system-ui, -apple-system, sans-serif" font-weight="700" font-size="10" fill="#e2e8f0" text-anchor="middle">${label}</text>
    </svg>`;
    const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

    setPreviewImage(dataUrl);
    setProvider(type === 'gcash' ? 'gcash' : type === 'maya' ? 'maya' : 'qr_ph');
    if (!accountName) setAccountName(tenant?.name || 'Laundry Owner');
    if (!accountNumber) setAccountNumber(type === 'gcash' ? '0917-123-4567' : '0928-123-4567');
  };

  // Record payment against an order
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant || !recordOrderId || !recordAmountPesos) return;
    setFeedbackError(null);

    try {
      setRecordingPayment(true);
      const amountCentavos = Math.round(parseFloat(recordAmountPesos) * 100);
      if (isNaN(amountCentavos) || amountCentavos <= 0) {
        setFeedbackError('Please enter a valid payment amount greater than ₱0.');
        return;
      }

      await api.recordPayment(tenant.id, recordOrderId, {
        amountCentavos,
        method: recordMethod,
        referenceNumber: recordRefNumber.trim() || undefined,
        notes: recordNotes || '',
      });

      setShowRecordModal(false);
      setRecordOrderId('');
      setRecordAmountPesos('');
      setRecordRefNumber('');
      setRecordNotes('');
      loadData();
    } catch (err: any) {
      setFeedbackError(err.message || 'Payment recording failed');
    } finally {
      setRecordingPayment(false);
    }
  };

  // Filter unpaid orders
  const unpaidOrders = orders.filter((o) => o.balanceCentavos > 0);
  const selectedOrder = orders.find((o) => o.id === selectedOrderId);

  // Computed displayed amount in Presenter
  const displayedAmountPesos = selectedOrder
    ? (selectedOrder.balanceCentavos / 100).toFixed(2)
    : customAmountPesos
    ? parseFloat(customAmountPesos).toFixed(2)
    : null;

  // Financial totals
  const totalQrCollectedCentavos = payments
    .filter((p) => p.method === 'qr_ph')
    .reduce((sum, p) => sum + p.amountCentavos, 0);
  const totalCashCollectedCentavos = payments
    .filter((p) => p.method === 'cash')
    .reduce((sum, p) => sum + p.amountCentavos, 0);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Module Context Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 sm:pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <QrCode className="w-6 h-6 text-indigo-600 shrink-0" />
              <span>Payments & QR Ph Hub</span>
            </h2>
            <span className="text-[11px] font-mono bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-200 uppercase font-semibold">
              QR Ph Verified
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Storefront QR Stand · Customer-Facing Presenter · Merchant QR Upload · Verified Ledger
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0 w-full sm:w-auto">
          <button
            onClick={() => setActiveSubTab('presenter')}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl min-h-[42px] transition-all ${
              activeSubTab === 'presenter'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
            }`}
          >
            <Smartphone className="w-4 h-4 shrink-0" />
            <span>Show QR</span>
          </button>

          <button
            onClick={() => setActiveSubTab('upload')}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl min-h-[42px] transition-all ${
              activeSubTab === 'upload'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
            }`}
          >
            <Upload className="w-4 h-4 shrink-0" />
            <span>Upload QR</span>
          </button>

          <button
            onClick={() => {
              if (unpaidOrders.length > 0) {
                setRecordOrderId(unpaidOrders[0].id);
                setRecordAmountPesos((unpaidOrders[0].balanceCentavos / 100).toFixed(2));
              }
              setShowRecordModal(true);
            }}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-300 hover:bg-emerald-100 rounded-xl min-h-[42px] transition-all active:scale-[0.98]"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span className="whitespace-nowrap">Log Payment</span>
          </button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-full sm:w-max text-xs font-medium">
        <button
          onClick={() => setActiveSubTab('presenter')}
          className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors min-h-[38px] ${
            activeSubTab === 'presenter'
              ? 'bg-white text-slate-900 shadow-xs font-semibold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Smartphone className="w-4 h-4 text-indigo-600" />
          <span>Customer QR Stand</span>
        </button>

        <button
          onClick={() => setActiveSubTab('upload')}
          className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors min-h-[38px] ${
            activeSubTab === 'upload'
              ? 'bg-white text-slate-900 shadow-xs font-semibold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Upload className="w-4 h-4 text-slate-600" />
          <span>Upload QR Picture</span>
        </button>

        <button
          onClick={() => setActiveSubTab('ledger')}
          className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors min-h-[38px] ${
            activeSubTab === 'ledger'
              ? 'bg-white text-slate-900 shadow-xs font-semibold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <CreditCard className="w-4 h-4 text-slate-600" />
          <span>Payment Ledger ({payments.length})</span>
        </button>
      </div>

      {feedbackError && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{feedbackError}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackError(null)}
            className="text-rose-600 hover:text-rose-800 font-semibold px-2 py-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: CUSTOMER-FACING QR STAND (PRESENTER / COUNTERTOP DISPLAY) */}
      {/* ========================================================================= */}
      {activeSubTab === 'presenter' && (
        <div className="space-y-6">
          {/* Quick Order / Amount Selection Bar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-800">
                Countertop Preset: Select Order or Enter Custom Amount
              </span>
              <p className="text-[11px] text-slate-500">
                The QR card will dynamically display the exact Philippine Peso total for the customer to scan
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              {/* Select Unpaid Order */}
              <div className="relative min-w-[220px]">
                <select
                  value={selectedOrderId}
                  onChange={(e) => {
                    setSelectedOrderId(e.target.value);
                    if (e.target.value) setCustomAmountPesos('');
                  }}
                  className="w-full text-xs font-medium text-slate-800 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 min-h-[42px] focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">-- No specific order (General QR) --</option>
                  {unpaidOrders.map((ord) => (
                    <option key={ord.id} value={ord.id}>
                      {ord.orderNumber} · {ord.customer?.name} (₱{(ord.balanceCentavos / 100).toFixed(2)} due)
                    </option>
                  ))}
                </select>
              </div>

              {/* Or Custom Amount */}
              <div className="flex items-center gap-1 bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 min-h-[42px]">
                <span className="text-xs font-bold text-slate-500">₱</span>
                <input
                  type="number"
                  step="1"
                  placeholder="Custom ₱"
                  value={customAmountPesos}
                  onChange={(e) => {
                    setCustomAmountPesos(e.target.value);
                    if (e.target.value) setSelectedOrderId('');
                  }}
                  className="w-24 text-xs font-mono font-semibold text-slate-900 bg-transparent focus:outline-none"
                />
              </div>

              <button
                onClick={() => setFullScreenStand(!fullScreenStand)}
                className="flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 min-h-[42px]"
                title="Toggle Full Screen Counter Stand"
              >
                {fullScreenStand ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                <span className="hidden xs:inline">{fullScreenStand ? 'Exit Stand' : 'Counter Stand'}</span>
              </button>
            </div>
          </div>

          {/* Presenter Card Container */}
          <div
            className={`transition-all duration-300 ${
              fullScreenStand
                ? 'fixed inset-0 z-50 bg-slate-900/95 backdrop-blur-md p-4 sm:p-8 flex items-center justify-center overflow-y-auto'
                : 'max-w-md mx-auto w-full'
            }`}
          >
            {fullScreenStand && (
              <button
                onClick={() => setFullScreenStand(false)}
                className="absolute top-4 right-4 p-2 text-white bg-slate-800 hover:bg-slate-700 rounded-full"
                aria-label="Close Stand Mode"
              >
                <Minimize2 className="w-5 h-5" />
              </button>
            )}

            <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden flex flex-col items-center text-center p-6 sm:p-8 space-y-4 w-full max-w-sm sm:max-w-md">
              {/* QR Ph Standard Top Badge */}
              <div className="flex items-center justify-center gap-2 bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-xs font-semibold tracking-wide uppercase font-mono">
                <QrCode className="w-3.5 h-3.5 text-indigo-600" />
                <span>QR Ph · Person-to-Merchant (P2M)</span>
              </div>

              {/* Merchant / Business Header */}
              <div>
                <h3 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">
                  {qrSettings?.merchantName || tenant?.name}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Scan with GCash, Maya, ShopeePay, or Any Bank
                </p>
              </div>

              {/* Dynamic Amount Pill (If order or custom amount selected) */}
              {displayedAmountPesos && (
                <div className="w-full bg-indigo-50 border border-indigo-200 rounded-2xl py-3 px-4 text-center space-y-0.5">
                  <div className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wider">
                    {selectedOrder ? `Order: ${selectedOrder.orderNumber}` : 'Amount to Pay'}
                  </div>
                  <div className="text-2xl sm:text-3xl font-black font-mono text-indigo-950 tabular-nums">
                    ₱{displayedAmountPesos}
                  </div>
                  {selectedOrder && (
                    <div className="text-[11px] text-indigo-600 truncate">
                      Customer: {selectedOrder.customer?.name}
                    </div>
                  )}
                </div>
              )}

              {/* QR Code Image Picture */}
              <div className="relative p-4 bg-white rounded-2xl border-2 border-slate-200 shadow-sm flex items-center justify-center max-w-[280px] max-h-[280px] sm:max-w-[300px] sm:max-h-[300px] aspect-square">
                {qrSettings?.qrCodeImageUrl ? (
                  <img
                    src={qrSettings.qrCodeImageUrl}
                    alt={`${tenant?.name} QR Code`}
                    className="w-full h-full object-contain rounded-lg"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-400 p-8 space-y-2">
                    <ImageIcon className="w-12 h-12 stroke-1" />
                    <span className="text-xs text-center font-medium">No QR Picture uploaded yet.</span>
                    <button
                      onClick={() => setActiveSubTab('upload')}
                      className="text-xs text-indigo-600 font-semibold underline mt-2"
                    >
                      Upload QR Code Picture
                    </button>
                  </div>
                )}
              </div>

              {/* Merchant Account Details */}
              <div className="w-full pt-1 space-y-1.5 text-xs text-slate-600 font-mono">
                {qrSettings?.accountName && (
                  <div className="flex items-center justify-between px-2">
                    <span className="text-slate-400">Account:</span>
                    <span className="font-semibold text-slate-800">{qrSettings.accountName}</span>
                  </div>
                )}
                {qrSettings?.accountNumber && (
                  <div className="flex items-center justify-between px-2">
                    <span className="text-slate-400">Mobile / Account #:</span>
                    <span className="font-semibold text-slate-900">{qrSettings.accountNumber}</span>
                  </div>
                )}
              </div>

              {/* Supported Wallets Grid / Logos */}
              <div className="w-full pt-2 border-t border-slate-100 space-y-1.5">
                <div className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
                  Accepted Payment Channels
                </div>
                <div className="flex items-center justify-center gap-1.5 flex-wrap text-[10px] font-mono font-medium text-slate-600">
                  <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">GCash</span>
                  <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">Maya</span>
                  <span className="px-2 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-200">ShopeePay</span>
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">QR Ph Banks</span>
                </div>
              </div>

              {/* Customer Instructions */}
              {qrSettings?.notes ? (
                <p className="text-[11px] text-slate-500 bg-slate-50 p-2 rounded-xl border border-slate-100 text-center leading-relaxed">
                  {qrSettings.notes}
                </p>
              ) : (
                <p className="text-[11px] text-slate-400">
                  Please show your payment confirmation or reference number to the counter staff.
                </p>
              )}

              {/* Quick Action: Log Settled Payment */}
              <div className="w-full pt-2">
                <button
                  onClick={() => {
                    if (selectedOrder) {
                      setRecordOrderId(selectedOrder.id);
                      setRecordAmountPesos((selectedOrder.balanceCentavos / 100).toFixed(2));
                    } else if (customAmountPesos && unpaidOrders.length > 0) {
                      setRecordOrderId(unpaidOrders[0].id);
                      setRecordAmountPesos(customAmountPesos);
                    }
                    setShowRecordModal(true);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs transition-colors shadow-xs active:scale-[0.99] min-h-[44px]"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Customer Paid? Settle Order</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: UPLOAD & SETUP STORE QR CODE PICTURE */}
      {/* ========================================================================= */}
      {activeSubTab === 'upload' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 sm:p-6 space-y-6">
            <div>
              <h3 className="text-base font-bold text-slate-900">Configure Tenant QR Code</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Upload your shop's official GCash, Maya, or QR Ph picture. Customers scan this QR to pay at the counter.
              </p>
            </div>

            {uploadSuccess && (
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Store QR code updated successfully and activated for counter presentation!</span>
              </div>
            )}

            {/* Template Presets */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <span className="text-xs font-semibold text-slate-700">Quick Test Templates (Optional):</span>
              <p className="text-[11px] text-slate-500">
                If you don't have an image on your current device right now, load one of these Philippine templates to test immediately:
              </p>
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <button
                  type="button"
                  onClick={() => handleLoadPreset('gcash')}
                  className="px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-semibold transition-colors"
                >
                  Load GCash Template
                </button>
                <button
                  type="button"
                  onClick={() => handleLoadPreset('maya')}
                  className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-semibold transition-colors"
                >
                  Load Maya QR Ph Template
                </button>
                <button
                  type="button"
                  onClick={() => handleLoadPreset('universal')}
                  className="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-semibold transition-colors"
                >
                  Load Universal QR Ph
                </button>
              </div>
            </div>

            <form onSubmit={handleSaveQrSettings} className="space-y-5">
              {/* Image Upload Area */}
              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-2">
                  QR Code Picture (Upload from phone camera or gallery) *
                </label>

                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                  {/* Upload Dropzone */}
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-300 hover:border-indigo-500 bg-slate-50/70 hover:bg-indigo-50/30 rounded-2xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center space-y-2 min-h-[220px]"
                  >
                    <div className="w-12 h-12 rounded-full bg-white shadow-xs flex items-center justify-center text-indigo-600 border border-slate-200">
                      <Upload className="w-6 h-6" />
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-slate-800 block">
                        Tap here to upload QR Picture
                      </span>
                      <span className="text-[11px] text-slate-400 block">
                        PNG, JPG, or WEBP up to 8MB
                      </span>
                    </div>
                    <button
                      type="button"
                      className="mt-2 px-3 py-1 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Browse Files / Take Photo
                    </button>
                  </div>

                  {/* Image Live Preview */}
                  <div className="bg-slate-100 rounded-2xl p-4 flex flex-col items-center justify-center border border-slate-200 min-h-[220px]">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                      Live Presenter Preview
                    </span>
                    {previewImage ? (
                      <div className="relative bg-white p-3 rounded-xl border border-slate-300 shadow-sm max-w-[180px] max-h-[180px] aspect-square flex items-center justify-center">
                        <img
                          src={previewImage}
                          alt="QR Code Preview"
                          className="w-full h-full object-contain rounded"
                        />
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400 text-center">
                        No picture uploaded yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Form Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Store / Merchant Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={merchantName}
                    onChange={(e) => setMerchantName(e.target.value)}
                    placeholder="e.g. BubbleBrite Laundry Hub"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium min-h-[42px]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Primary Provider / Network
                  </label>
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium min-h-[42px]"
                  >
                    <option value="qr_ph">Universal QR Ph (InstaPay)</option>
                    <option value="gcash">GCash (Merchant / Personal)</option>
                    <option value="maya">Maya (Business / Wallet)</option>
                    <option value="bank">Direct Bank QR (BDO, BPI, UB)</option>
                    <option value="other">Other Payment Channel</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Account Name (Registered on QR)
                  </label>
                  <input
                    type="text"
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    placeholder="e.g. Maria Clara Santos"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium min-h-[42px]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Mobile Number / Account #
                  </label>
                  <input
                    type="text"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    placeholder="e.g. 0917-555-0101"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[42px]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Payment Instructions for Customer (Optional)
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Scan to pay with any QR Ph banking app. Show reference number to counter."
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="submit"
                  disabled={savingSettings || !previewImage}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold text-xs transition-colors shadow-xs active:scale-[0.98] min-h-[44px]"
                >
                  <Check className="w-4 h-4" />
                  <span>{savingSettings ? 'Saving Settings...' : 'Save & Activate Store QR'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: PAYMENT LEDGER & SETTLED TRANSACTIONS */}
      {/* ========================================================================= */}
      {activeSubTab === 'ledger' && (
        <div className="space-y-6">
          {/* Metrics summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1">
              <span className="text-xs font-medium text-slate-500">QR Ph Collections</span>
              <div className="text-xl sm:text-2xl font-bold font-mono text-indigo-600">
                <CurrencyDisplay amountCentavos={totalQrCollectedCentavos} />
              </div>
              <div className="text-[11px] text-slate-400">GCash, Maya, and QR Ph</div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1">
              <span className="text-xs font-medium text-slate-500">Cash Collections</span>
              <div className="text-xl sm:text-2xl font-bold font-mono text-emerald-600">
                <CurrencyDisplay amountCentavos={totalCashCollectedCentavos} />
              </div>
              <div className="text-[11px] text-slate-400">Countertop physical cash</div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1">
              <span className="text-xs font-medium text-slate-500">Total Transactions</span>
              <div className="text-xl sm:text-2xl font-bold font-mono text-slate-900">
                {payments.length}
              </div>
              <div className="text-[11px] text-slate-400">Verified immutable records</div>
            </div>
          </div>

          {/* Ledger Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Payment History Ledger</h3>
                <p className="text-xs text-slate-500 mt-0.5">Strict tenant isolation · Scoped to {tenant?.name}</p>
              </div>
              <button
                onClick={loadData}
                disabled={loading}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {loading ? (
              <div className="p-8 text-center text-xs text-slate-500">Loading payment ledger...</div>
            ) : payments.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">No payment records found for this tenant.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-medium">
                      <th className="py-2.5 px-4">Timestamp</th>
                      <th className="py-2.5 px-4">Order #</th>
                      <th className="py-2.5 px-4">Method</th>
                      <th className="py-2.5 px-4">Reference #</th>
                      <th className="py-2.5 px-4 text-right">Amount (₱)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 font-mono text-xs">
                    {payments.map((p) => {
                      const relatedOrder = orders.find((o) => o.id === p.orderId);
                      return (
                        <tr key={p.id} className="hover:bg-slate-50/50">
                          <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                            {new Date(p.createdAt).toLocaleTimeString('en-PH', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-900">
                            <div>{relatedOrder?.orderNumber || p.orderId}</div>
                            {relatedOrder?.customer && (
                              <div className="text-[11px] font-sans text-slate-400">{relatedOrder.customer.name}</div>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] uppercase font-semibold font-mono ${
                                p.method === 'qr_ph'
                                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              }`}
                            >
                              {p.method === 'qr_ph' ? 'QR Ph' : 'Cash'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-600 truncate max-w-xs">{p.referenceNumber}</td>
                          <td className="py-3 px-4 text-right font-bold text-slate-900 whitespace-nowrap">
                            <CurrencyDisplay amountCentavos={p.amountCentavos} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* RECORD PAYMENT MODAL */}
      {/* ========================================================================= */}
      {showRecordModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Record Customer Payment</h3>
              <button
                onClick={() => setShowRecordModal(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRecordPayment} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Select Order to Settle *</label>
                <select
                  required
                  value={recordOrderId}
                  onChange={(e) => {
                    setRecordOrderId(e.target.value);
                    const selected = orders.find((o) => o.id === e.target.value);
                    if (selected) {
                      setRecordAmountPesos((selected.balanceCentavos / 100).toFixed(2));
                    }
                  }}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium min-h-[42px]"
                >
                  <option value="">-- Choose Order --</option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.orderNumber} - {o.customer?.name} (Balance: ₱{(o.balanceCentavos / 100).toFixed(2)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Payment Method *</label>
                  <select
                    value={recordMethod}
                    onChange={(e) => setRecordMethod(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-slate-800 font-medium min-h-[42px]"
                  >
                    <option value="qr_ph">QR Ph (GCash/Maya)</option>
                    <option value="cash">Cash Payment</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Amount (₱ PHP) *</label>
                  <input
                    type="number"
                    step="0.5"
                    required
                    value={recordAmountPesos}
                    onChange={(e) => setRecordAmountPesos(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 font-mono text-slate-900 font-semibold min-h-[42px]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Reference # (GCash / Maya transaction ref)
                </label>
                <input
                  type="text"
                  value={recordRefNumber}
                  onChange={(e) => setRecordRefNumber(e.target.value)}
                  placeholder="e.g. 100482910382"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 font-mono text-slate-800 min-h-[42px]"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Internal Notes</label>
                <textarea
                  rows={2}
                  value={recordNotes}
                  onChange={(e) => setRecordNotes(e.target.value)}
                  placeholder="Optional cashier notes"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-800"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowRecordModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium min-h-[42px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={recordingPayment}
                  className="px-4 py-2.5 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 disabled:opacity-50 min-h-[42px]"
                >
                  {recordingPayment ? 'Recording...' : 'Confirm Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
