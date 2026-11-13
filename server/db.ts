/**
 * LaundryOS - Server Database Engine
 * Relational model with foreign key validation, tenant isolation, and atomic file persistence.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  Tenant,
  TenantQrSettings,
  Branch,
  User,
  TenantMembership,
  Subscription,
  Customer,
  Service,
  Order,
  OrderItem,
  OrderStatusHistory,
  Payment,
  PaymentAttempt,
  PaymentConnection,
  AuditLog,
} from '../src/types/database.ts';

export interface DatabaseState {
  tenants: Tenant[];
  branches: Branch[];
  users: User[];
  tenant_memberships: TenantMembership[];
  subscriptions: Subscription[];
  customers: Customer[];
  services: Service[];
  orders: Order[];
  order_items: OrderItem[];
  order_status_history: OrderStatusHistory[];
  payments: Payment[];
  payment_attempts: PaymentAttempt[];
  payment_connections: PaymentConnection[];
  audit_logs: AuditLog[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'laundryos-db.json');

function createSampleQrSvg(merchant: string, badge: string, color: string): string {
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
    <text x="160" y="174" font-family="system-ui, -apple-system, sans-serif" font-weight="700" font-size="10" fill="#e2e8f0" text-anchor="middle">${badge}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function generateInitialSeed(): DatabaseState {
  const now = new Date().toISOString();
  const pastHour = new Date(Date.now() - 3600000).toISOString();
  const past2Hours = new Date(Date.now() - 7200000).toISOString();
  const tomorrow = new Date(Date.now() + 86400000).toISOString();

  // Tenants
  const tenant1: Tenant = {
    id: 't-bubblebrite-001',
    slug: 'bubblebrite',
    name: 'BubbleBrite Laundry Hub',
    tradeName: 'BubbleBrite Inc.',
    logoUrl: '',
    status: 'active',
    contactEmail: 'contact@bubblebrite.ph',
    contactPhone: '+63 917 555 0101',
    currency: 'PHP',
    qrSettings: {
      qrCodeImageUrl: createSampleQrSvg('BubbleBrite Laundry Hub', 'GCASH / MAYA', '#0052cc'),
      merchantName: 'BubbleBrite Laundry Hub',
      accountName: 'Maria Clara Santos (Owner)',
      accountNumber: '0917-555-0101',
      provider: 'gcash',
      notes: 'Scan using GCash, Maya, ShopeePay, or any QR Ph banking app. Please show receipt reference.',
      updatedAt: past2Hours,
    },
    createdAt: past2Hours,
    updatedAt: now,
  };

  const tenant2: Tenant = {
    id: 't-washandfold-002',
    slug: 'washandfold',
    name: 'Wash & Fold Express',
    tradeName: 'W&F Laundry Services',
    logoUrl: '',
    status: 'active',
    contactEmail: 'support@washandfold.ph',
    contactPhone: '+63 928 555 0202',
    currency: 'PHP',
    qrSettings: {
      qrCodeImageUrl: createSampleQrSvg('Wash & Fold Express', 'MAYA QR PH', '#059669'),
      merchantName: 'Wash & Fold Express Poblacion',
      accountName: 'Roberto Mendoza',
      accountNumber: '0928-555-0202',
      provider: 'maya',
      notes: 'Maya QR Ph official merchant. Scan with any banking app.',
      updatedAt: past2Hours,
    },
    createdAt: past2Hours,
    updatedAt: now,
  };

  // Branches
  const branch1: Branch = {
    id: 'b-bb-diliman-01',
    tenantId: tenant1.id,
    name: 'Diliman Main Branch',
    code: 'DLM-01',
    address: '92 Maginhawa St., UP Village, Diliman, Quezon City',
    phone: '+63 2 8920 1122',
    isMain: true,
    isActive: true,
    createdAt: past2Hours,
    updatedAt: now,
  };

  const branch2: Branch = {
    id: 'b-wfe-poblacion-01',
    tenantId: tenant2.id,
    name: 'Poblacion Hub',
    code: 'POB-01',
    address: '4928 Enriquez St., Poblacion, Makati City',
    phone: '+63 2 8899 3344',
    isMain: true,
    isActive: true,
    createdAt: past2Hours,
    updatedAt: now,
  };

  // Users
  const userAlex: User = {
    id: 'u-alex-superadmin',
    authUid: 'firebase-uid-alex',
    email: 'alex.admin@laundryos.ph',
    fullName: 'Alex Chen (Platform Admin)',
    phone: '+63 999 000 0001',
    isSuperAdmin: true,
    createdAt: past2Hours,
    updatedAt: now,
  };

  const userMaria: User = {
    id: 'u-maria-owner-bb',
    authUid: 'firebase-uid-maria',
    email: 'maria@bubblebrite.ph',
    fullName: 'Maria Santos',
    phone: '+63 917 111 2233',
    isSuperAdmin: false,
    createdAt: past2Hours,
    updatedAt: now,
  };

  const userJuan: User = {
    id: 'u-juan-cashier-bb',
    authUid: 'firebase-uid-juan',
    email: 'juan@bubblebrite.ph',
    fullName: 'Juan Dela Cruz',
    phone: '+63 918 222 3344',
    isSuperAdmin: false,
    createdAt: past2Hours,
    updatedAt: now,
  };

  const userMark: User = {
    id: 'u-mark-staff-bb',
    authUid: 'firebase-uid-mark',
    email: 'mark@bubblebrite.ph',
    fullName: 'Mark Reyes',
    phone: '+63 919 333 4455',
    isSuperAdmin: false,
    createdAt: past2Hours,
    updatedAt: now,
  };

  const userRoberto: User = {
    id: 'u-roberto-owner-wfe',
    authUid: 'firebase-uid-roberto',
    email: 'roberto@washandfold.ph',
    fullName: 'Roberto Tan',
    phone: '+63 920 444 5566',
    isSuperAdmin: false,
    createdAt: past2Hours,
    updatedAt: now,
  };

  const userElena: User = {
    id: 'u-elena-manager-wfe',
    authUid: 'firebase-uid-elena',
    email: 'elena@washandfold.ph',
    fullName: 'Elena Gomez',
    phone: '+63 921 555 6677',
    isSuperAdmin: false,
    createdAt: past2Hours,
    updatedAt: now,
  };

  // Tenant Memberships
  const memberships: TenantMembership[] = [
    {
      id: 'm-maria-bb',
      tenantId: tenant1.id,
      userId: userMaria.id,
      role: 'owner',
      status: 'active',
      branchId: branch1.id,
      createdAt: past2Hours,
      updatedAt: now,
    },
    {
      id: 'm-juan-bb',
      tenantId: tenant1.id,
      userId: userJuan.id,
      role: 'cashier',
      status: 'active',
      branchId: branch1.id,
      createdAt: past2Hours,
      updatedAt: now,
    },
    {
      id: 'm-mark-bb',
      tenantId: tenant1.id,
      userId: userMark.id,
      role: 'staff',
      status: 'active',
      branchId: branch1.id,
      createdAt: past2Hours,
      updatedAt: now,
    },
    {
      id: 'm-roberto-wfe',
      tenantId: tenant2.id,
      userId: userRoberto.id,
      role: 'owner',
      status: 'active',
      branchId: branch2.id,
      createdAt: past2Hours,
      updatedAt: now,
    },
    {
      id: 'm-elena-wfe',
      tenantId: tenant2.id,
      userId: userElena.id,
      role: 'manager',
      status: 'active',
      branchId: branch2.id,
      createdAt: past2Hours,
      updatedAt: now,
    },
  ];

  // Subscriptions
  const subscriptions: Subscription[] = [
    {
      id: 'sub-bb-01',
      tenantId: tenant1.id,
      plan: 'growth',
      status: 'active',
      trialEndsAt: pastHour,
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
      maxBranches: 2,
      maxStaff: 8,
      monthlyFeeCentavos: 189900, // ₱1,899.00
      createdAt: past2Hours,
      updatedAt: now,
    },
    {
      id: 'sub-wfe-01',
      tenantId: tenant2.id,
      plan: 'starter',
      status: 'active',
      trialEndsAt: pastHour,
      currentPeriodEnd: new Date(Date.now() + 14 * 86400000).toISOString(),
      maxBranches: 1,
      maxStaff: 3,
      monthlyFeeCentavos: 99900, // ₱999.00
      createdAt: past2Hours,
      updatedAt: now,
    },
  ];

  // Services
  const services: Service[] = [
    // Shop 1 Services
    {
      id: 'srv-bb-01',
      tenantId: tenant1.id,
      name: 'Regular Wash & Fold',
      category: 'Wash & Fold',
      pricingUnit: 'kg',
      unitPriceCentavos: 6500, // ₱65.00 / kg
      minChargeCentavos: 19500, // ₱195.00 min (3kg)
      minQuantity: 3.0,
      defaultTurnaroundHours: 24,
      isActive: true,
      createdAt: past2Hours,
      updatedAt: now,
    },
    {
      id: 'srv-bb-02',
      tenantId: tenant1.id,
      name: 'Premium Wash & Press',
      category: 'Ironing',
      pricingUnit: 'kg',
      unitPriceCentavos: 9500, // ₱95.00 / kg
      minChargeCentavos: 28500, // ₱285.00 min (3kg)
      minQuantity: 3.0,
      defaultTurnaroundHours: 36,
      isActive: true,
      createdAt: past2Hours,
      updatedAt: now,
    },
    {
      id: 'srv-bb-03',
      tenantId: tenant1.id,
      name: 'King Comforter / Blanket',
      category: 'Bulky Items',
      pricingUnit: 'piece',
      unitPriceCentavos: 25000, // ₱250.00 / piece
      minChargeCentavos: 25000,
      minQuantity: 1.0,
      defaultTurnaroundHours: 48,
      isActive: true,
      createdAt: past2Hours,
      updatedAt: now,
    },
    // Shop 2 Services
    {
      id: 'srv-wfe-01',
      tenantId: tenant2.id,
      name: 'Express Wash & Tumble Dry',
      category: 'Wash & Fold',
      pricingUnit: 'kg',
      unitPriceCentavos: 7500, // ₱75.00 / kg
      minChargeCentavos: 22500, // ₱225.00 min (3kg)
      minQuantity: 3.0,
      defaultTurnaroundHours: 12,
      isActive: true,
      createdAt: past2Hours,
      updatedAt: now,
    },
    {
      id: 'srv-wfe-02',
      tenantId: tenant2.id,
      name: 'Barong & Delicates Handwash',
      category: 'Special Care',
      pricingUnit: 'piece',
      unitPriceCentavos: 35000, // ₱350.00 / piece
      minChargeCentavos: 35000,
      minQuantity: 1.0,
      defaultTurnaroundHours: 48,
      isActive: true,
      createdAt: past2Hours,
      updatedAt: now,
    },
  ];

  // Customers
  const customer1: Customer = {
    id: 'c-bb-ana',
    tenantId: tenant1.id,
    branchId: branch1.id,
    name: 'Ana Cruz',
    mobile: '+63 917 888 1234',
    email: 'ana.cruz@gmail.com',
    notes: 'Mild hypoallergenic detergent requested.',
    totalOrders: 1,
    outstandingBalanceCentavos: 0,
    createdAt: past2Hours,
    updatedAt: now,
  };

  const customer2: Customer = {
    id: 'c-bb-carlos',
    tenantId: tenant1.id,
    branchId: branch1.id,
    name: 'Carlos Mendoza',
    mobile: '+63 918 777 5678',
    email: 'carlos.m@yahoo.com',
    notes: 'Prefers text message updates.',
    totalOrders: 1,
    outstandingBalanceCentavos: 13000, // ₱130.00 balance
    createdAt: past2Hours,
    updatedAt: now,
  };

  const customer3: Customer = {
    id: 'c-wfe-david',
    tenantId: tenant2.id,
    branchId: branch2.id,
    name: 'David Lim',
    mobile: '+63 920 666 9012',
    email: 'd.lim@corporate.ph',
    notes: 'Regular condo pickup client.',
    totalOrders: 1,
    outstandingBalanceCentavos: 0,
    createdAt: past2Hours,
    updatedAt: now,
  };

  // Orders & Items
  // Order 1 (Shop 1 - Ana Cruz): 5.0 kg Wash & Fold = ₱325.00, fully paid cash
  const order1: Order = {
    id: 'ord-bb-0001',
    tenantId: tenant1.id,
    branchId: branch1.id,
    customerId: customer1.id,
    orderNumber: 'BB-2026-0001',
    status: 'ready_for_pickup',
    paymentStatus: 'paid',
    subtotalCentavos: 32500, // 5kg * 65.00
    discountCentavos: 0,
    expressFeeCentavos: 0,
    totalCentavos: 32500,
    paidCentavos: 32500,
    balanceCentavos: 0,
    notes: 'Fragrance-free softener',
    expectedReadyAt: now,
    createdByUserId: userJuan.id,
    createdAt: past2Hours,
    updatedAt: now,
  };

  const orderItem1: OrderItem = {
    id: 'item-bb-001',
    orderId: order1.id,
    serviceId: services[0].id,
    serviceNameSnapshot: services[0].name,
    pricingUnitSnapshot: 'kg',
    unitPriceCentavosSnapshot: services[0].unitPriceCentavos,
    quantity: 5.0,
    subtotalCentavos: 32500,
    notes: 'Standard colored clothes',
  };

  // Order 2 (Shop 1 - Carlos Mendoza): 6.0 kg Wash & Press = ₱570.00, partial paid ₱440, balance ₱130
  const order2: Order = {
    id: 'ord-bb-0002',
    tenantId: tenant1.id,
    branchId: branch1.id,
    customerId: customer2.id,
    orderNumber: 'BB-2026-0002',
    status: 'washing',
    paymentStatus: 'partial',
    subtotalCentavos: 57000,
    discountCentavos: 0,
    expressFeeCentavos: 0,
    totalCentavos: 57000,
    paidCentavos: 44000,
    balanceCentavos: 13000,
    notes: 'Press collars flat',
    expectedReadyAt: tomorrow,
    createdByUserId: userJuan.id,
    createdAt: pastHour,
    updatedAt: pastHour,
  };

  const orderItem2: OrderItem = {
    id: 'item-bb-002',
    orderId: order2.id,
    serviceId: services[1].id,
    serviceNameSnapshot: services[1].name,
    pricingUnitSnapshot: 'kg',
    unitPriceCentavosSnapshot: services[1].unitPriceCentavos,
    quantity: 6.0,
    subtotalCentavos: 57000,
    notes: 'Polo shirts and slacks',
  };

  // Order 3 (Shop 2 - David Lim): 4.0 kg Express = ₱300.00, paid
  const order3: Order = {
    id: 'ord-wfe-0001',
    tenantId: tenant2.id,
    branchId: branch2.id,
    customerId: customer3.id,
    orderNumber: 'WF-2026-0001',
    status: 'drying',
    paymentStatus: 'paid',
    subtotalCentavos: 30000,
    discountCentavos: 0,
    expressFeeCentavos: 0,
    totalCentavos: 30000,
    paidCentavos: 30000,
    balanceCentavos: 0,
    notes: 'Rush turnaround requested',
    expectedReadyAt: tomorrow,
    createdByUserId: userElena.id,
    createdAt: pastHour,
    updatedAt: pastHour,
  };

  const orderItem3: OrderItem = {
    id: 'item-wfe-001',
    orderId: order3.id,
    serviceId: services[3].id,
    serviceNameSnapshot: services[3].name,
    pricingUnitSnapshot: 'kg',
    unitPriceCentavosSnapshot: services[3].unitPriceCentavos,
    quantity: 4.0,
    subtotalCentavos: 30000,
    notes: 'Bed linens',
  };

  // Payments
  const payment1: Payment = {
    id: 'pay-bb-001',
    tenantId: tenant1.id,
    orderId: order1.id,
    amountCentavos: 32500,
    method: 'cash',
    referenceNumber: 'CASH-REC-001',
    cashierUserId: userJuan.id,
    notes: 'Exact amount paid at counter',
    createdAt: past2Hours,
  };

  const payment2: Payment = {
    id: 'pay-bb-002',
    tenantId: tenant1.id,
    orderId: order2.id,
    amountCentavos: 44000,
    method: 'cash',
    referenceNumber: 'CASH-REC-002',
    cashierUserId: userJuan.id,
    notes: 'Deposit upon drop-off',
    createdAt: pastHour,
  };

  const payment3: Payment = {
    id: 'pay-wfe-001',
    tenantId: tenant2.id,
    orderId: order3.id,
    amountCentavos: 30000,
    method: 'qr_ph',
    referenceNumber: 'PAYMONGO-TEST-001',
    cashierUserId: userElena.id,
    notes: 'QR Ph PayMongo sandbox scan',
    createdAt: pastHour,
  };

  // Order status history
  const history: OrderStatusHistory[] = [
    {
      id: 'hist-bb-01',
      orderId: order1.id,
      tenantId: tenant1.id,
      fromStatus: null,
      toStatus: 'received',
      changedByUserId: userJuan.id,
      notes: 'Initial intake',
      timestamp: past2Hours,
    },
    {
      id: 'hist-bb-02',
      orderId: order1.id,
      tenantId: tenant1.id,
      fromStatus: 'received',
      toStatus: 'washing',
      changedByUserId: userMark.id,
      notes: 'Moved to Machine 3',
      timestamp: pastHour,
    },
    {
      id: 'hist-bb-03',
      orderId: order1.id,
      tenantId: tenant1.id,
      fromStatus: 'washing',
      toStatus: 'ready_for_pickup',
      changedByUserId: userMark.id,
      notes: 'Dried, folded, and bagged on Shelf B2',
      timestamp: now,
    },
    {
      id: 'hist-bb-04',
      orderId: order2.id,
      tenantId: tenant1.id,
      fromStatus: null,
      toStatus: 'received',
      changedByUserId: userJuan.id,
      notes: 'Intake and partial deposit',
      timestamp: pastHour,
    },
    {
      id: 'hist-bb-05',
      orderId: order2.id,
      tenantId: tenant1.id,
      fromStatus: 'received',
      toStatus: 'washing',
      changedByUserId: userMark.id,
      notes: 'In wash cycle',
      timestamp: now,
    },
  ];

  // Payment connections
  const paymentConnections: PaymentConnection[] = [
    {
      id: 'pc-bb-01',
      tenantId: tenant1.id,
      provider: 'paymongo',
      status: 'sandbox',
      publicKey: 'pk_test_sample_bubblebrite_laundry',
      webhookSecret: 'whsec_sample_bubblebrite_secret',
      merchantId: 'merch_bb_91283',
      createdAt: past2Hours,
      updatedAt: now,
    },
    {
      id: 'pc-wfe-01',
      tenantId: tenant2.id,
      provider: 'paymongo',
      status: 'sandbox',
      publicKey: 'pk_test_sample_washandfold_laundry',
      webhookSecret: 'whsec_sample_wfe_secret',
      merchantId: 'merch_wfe_48291',
      createdAt: past2Hours,
      updatedAt: now,
    },
  ];

  // Audit Logs
  const auditLogs: AuditLog[] = [
    {
      id: 'log-001',
      tenantId: tenant1.id,
      userId: userMaria.id,
      action: 'TENANT_ONBOARDED',
      entityType: 'tenant',
      entityId: tenant1.id,
      metadata: { plan: 'growth', branchCode: 'DLM-01' },
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0 (Server Init)',
      createdAt: past2Hours,
    },
    {
      id: 'log-002',
      tenantId: tenant1.id,
      userId: userJuan.id,
      action: 'ORDER_CREATED',
      entityType: 'order',
      entityId: order1.id,
      metadata: { orderNumber: order1.orderNumber, totalCentavos: 32500 },
      ipAddress: '127.0.0.1',
      userAgent: 'LaundryOS POS v1.0',
      createdAt: past2Hours,
    },
    {
      id: 'log-003',
      tenantId: tenant2.id,
      userId: userRoberto.id,
      action: 'TENANT_ONBOARDED',
      entityType: 'tenant',
      entityId: tenant2.id,
      metadata: { plan: 'starter', branchCode: 'POB-01' },
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0 (Server Init)',
      createdAt: past2Hours,
    },
  ];

  return {
    tenants: [tenant1, tenant2],
    branches: [branch1, branch2],
    users: [userAlex, userMaria, userJuan, userMark, userRoberto, userElena],
    tenant_memberships: memberships,
    subscriptions,
    customers: [customer1, customer2, customer3],
    services,
    orders: [order1, order2, order3],
    order_items: [orderItem1, orderItem2, orderItem3],
    order_status_history: history,
    payments: [payment1, payment2, payment3],
    payment_attempts: [],
    payment_connections: paymentConnections,
    audit_logs: auditLogs,
  };
}

class Database {
  private state: DatabaseState;

  constructor() {
    this.state = this.load();
  }

  private load(): DatabaseState {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.warn('Could not read existing database file, initializing seed:', err);
    }

    const seed = generateInitialSeed();
    this.persist(seed);
    return seed;
  }

  private persist(data: DatabaseState): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const tmpFile = `${DB_FILE}.${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmpFile, DB_FILE);
    } catch (err) {
      console.error('Error persisting database:', err);
    }
  }

  private commit(): void {
    this.persist(this.state);
  }

  public commitChanges(): void {
    this.persist(this.state);
  }

  public resetToSeed(): DatabaseState {
    this.state = generateInitialSeed();
    this.commit();
    return this.state;
  }

  // --- QUERY & MUTATION APIS ---

  public getState(): DatabaseState {
    return this.state;
  }

  // Tenants
  public getTenants(): Tenant[] {
    return [...this.state.tenants];
  }

  public getTenantById(id: string): Tenant | undefined {
    return this.state.tenants.find((t) => t.id === id);
  }

  public getTenantBySlug(slug: string): Tenant | undefined {
    return this.state.tenants.find((t) => t.slug === slug);
  }

  public createTenant(data: Omit<Tenant, 'id' | 'createdAt' | 'updatedAt'>): Tenant {
    const now = new Date().toISOString();
    const newTenant: Tenant = {
      ...data,
      id: `t-${data.slug}-${crypto.randomUUID().slice(0, 8)}`,
      createdAt: now,
      updatedAt: now,
    };
    this.state.tenants.push(newTenant);
    this.commit();
    return newTenant;
  }

  public updateTenantQrSettings(tenantId: string, qrSettings: TenantQrSettings): Tenant | undefined {
    const tenant = this.state.tenants.find((t) => t.id === tenantId);
    if (!tenant) return undefined;

    tenant.qrSettings = {
      ...qrSettings,
      updatedAt: new Date().toISOString(),
    };
    tenant.updatedAt = new Date().toISOString();
    this.commit();
    return tenant;
  }

  // Users & Memberships
  public getUsers(): User[] {
    return [...this.state.users];
  }

  public getUserById(id: string): User | undefined {
    return this.state.users.find((u) => u.id === id);
  }

  public getUserByEmail(email: string): User | undefined {
    return this.state.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  }

  public getMembershipsByUser(userId: string): TenantMembership[] {
    return this.state.tenant_memberships.filter((m) => m.userId === userId && m.status === 'active');
  }

  public getMembershipsByTenant(tenantId: string): (TenantMembership & { user?: User })[] {
    return this.state.tenant_memberships
      .filter((m) => m.tenantId === tenantId)
      .map((m) => ({
        ...m,
        user: this.getUserById(m.userId),
      }));
  }

  public findMembership(tenantId: string, userId: string): TenantMembership | undefined {
    return this.state.tenant_memberships.find(
      (m) => m.tenantId === tenantId && m.userId === userId && m.status === 'active'
    );
  }

  // Branches
  public getBranchesByTenant(tenantId: string): Branch[] {
    return this.state.branches.filter((b) => b.tenantId === tenantId);
  }

  // Services
  public getServicesByTenant(tenantId: string): Service[] {
    return this.state.services.filter((s) => s.tenantId === tenantId);
  }

  // Customers (Strict tenant isolation)
  public getCustomersByTenant(tenantId: string): Customer[] {
    return this.state.customers.filter((c) => c.tenantId === tenantId);
  }

  public getCustomerById(tenantId: string, customerId: string): Customer | undefined {
    return this.state.customers.find((c) => c.tenantId === tenantId && c.id === customerId);
  }

  public createCustomer(tenantId: string, customerData: Omit<Customer, 'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'totalOrders' | 'outstandingBalanceCentavos'>): Customer {
    const now = new Date().toISOString();
    const newCustomer: Customer = {
      ...customerData,
      id: `c-${crypto.randomUUID().slice(0, 8)}`,
      tenantId,
      totalOrders: 0,
      outstandingBalanceCentavos: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.state.customers.push(newCustomer);
    this.commit();
    return newCustomer;
  }

  // Orders (Strict tenant isolation)
  public getOrdersByTenant(tenantId: string): (Order & { items: OrderItem[]; customer?: Customer })[] {
    const tenantOrders = this.state.orders.filter((o) => o.tenantId === tenantId);
    return tenantOrders.map((order) => {
      const items = this.state.order_items.filter((item) => item.orderId === order.id);
      const customer = this.state.customers.find((c) => c.id === order.customerId);
      return {
        ...order,
        items,
        customer,
      };
    });
  }

  public getOrderById(tenantId: string, orderId: string): (Order & { items: OrderItem[]; customer?: Customer; history: OrderStatusHistory[] }) | undefined {
    const order = this.state.orders.find((o) => o.tenantId === tenantId && o.id === orderId);
    if (!order) return undefined;
    const items = this.state.order_items.filter((item) => item.orderId === order.id);
    const customer = this.state.customers.find((c) => c.id === order.customerId);
    const history = this.state.order_status_history.filter((h) => h.orderId === order.id);
    return {
      ...order,
      items,
      customer,
      history,
    };
  }

  // Payments
  public getPaymentsByTenant(tenantId: string): Payment[] {
    return this.state.payments.filter((p) => p.tenantId === tenantId);
  }

  // Subscriptions
  public getSubscriptionByTenant(tenantId: string): Subscription | undefined {
    return this.state.subscriptions.find((s) => s.tenantId === tenantId);
  }

  // Audit Logging
  public logAudit(log: Omit<AuditLog, 'id' | 'createdAt'>): AuditLog {
    const newLog: AuditLog = {
      ...log,
      id: `log-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
    };
    this.state.audit_logs.unshift(newLog);
    // Keep last 500 logs
    if (this.state.audit_logs.length > 500) {
      this.state.audit_logs.pop();
    }
    this.commit();
    return newLog;
  }

  public getAuditLogs(tenantId?: string): AuditLog[] {
    if (!tenantId) {
      return [...this.state.audit_logs];
    }
    return this.state.audit_logs.filter((l) => l.tenantId === tenantId);
  }
}

export const serverDb = new Database();
