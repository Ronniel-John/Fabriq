/**
 * LaundryOS - Core Database & Domain Models (TypeScript Schema)
 * Designed for PostgreSQL (Cloud SQL) with integer centavos and exact decimals.
 */

export type UserRole = 'super_admin' | 'owner' | 'manager' | 'cashier' | 'staff';

export type TenantStatus = 'trial' | 'active' | 'past_due' | 'suspended';

export type MembershipStatus = 'active' | 'invited' | 'suspended';

export type PricingUnit = 'kg' | 'piece';

export type OrderStatus =
  | 'received'
  | 'washing'
  | 'drying'
  | 'folding'
  | 'ready_for_pickup'
  | 'released'
  | 'cancelled';

export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

export type PaymentMethod = 'cash' | 'qr_ph' | 'card' | 'other';

export type PaymentAttemptStatus = 'pending' | 'succeeded' | 'failed' | 'expired';

export interface TenantQrSettings {
  qrCodeImageUrl: string; // Base64 data URL or hosted image URL
  merchantName: string;
  accountName: string;
  accountNumber: string;
  provider: 'qr_ph' | 'gcash' | 'maya' | 'bank' | 'other';
  notes?: string;
  updatedAt: string;
}

export interface Tenant {
  id: string; // UUID
  slug: string;
  name: string;
  tradeName?: string;
  logoUrl?: string;
  status: TenantStatus;
  contactEmail: string;
  contactPhone: string;
  ownerEmail?: string;
  currency: string; // Default 'PHP'
  qrSettings?: TenantQrSettings;
  createdAt: string;
  updatedAt: string;
}

export interface Branch {
  id: string; // UUID
  tenantId: string;
  name: string;
  code: string;
  address: string;
  phone: string;
  isMain: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string; // UUID
  authUid: string; // Firebase Auth UID
  email: string;
  fullName: string;
  phone?: string;
  avatarUrl?: string;
  isSuperAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TenantMembership {
  id: string; // UUID
  tenantId: string;
  userId: string;
  role: UserRole;
  status: MembershipStatus;
  branchId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: string; // UUID
  tenantId: string;
  plan: 'starter' | 'growth' | 'enterprise';
  status: 'trial' | 'active' | 'past_due' | 'cancelled';
  trialEndsAt: string;
  currentPeriodEnd: string;
  maxBranches: number;
  maxStaff: number;
  monthlyFeeCentavos: number;
  createdAt: string;
  updatedAt: string;
}

export type CustomerType = 'walk_in' | 'pickup_delivery' | 'corporate';

export interface Customer {
  id: string; // UUID
  tenantId: string;
  branchId: string;
  name: string;
  mobile: string;
  email?: string;
  address?: string;
  customerType?: CustomerType;
  washPreferences?: string;
  notes?: string;
  totalOrders: number;
  outstandingBalanceCentavos: number;
  createdAt: string;
  updatedAt: string;
}

export interface Service {
  id: string; // UUID
  tenantId: string;
  name: string;
  category: string;
  pricingUnit: PricingUnit;
  unitPriceCentavos: number; // e.g. 6500 = ₱65.00
  minChargeCentavos: number; // e.g. 19500 = ₱195.00 (3kg min)
  minQuantity: number; // e.g. 3.0 kg
  defaultTurnaroundHours: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  id: string; // UUID
  orderId: string;
  serviceId: string;
  serviceNameSnapshot: string;
  pricingUnitSnapshot: PricingUnit;
  unitPriceCentavosSnapshot: number;
  quantity: number; // exact decimal (e.g. 4.5 kg or 3 pieces)
  subtotalCentavos: number;
  notes?: string;
}

export interface Order {
  id: string; // UUID
  tenantId: string;
  branchId: string;
  customerId: string;
  orderNumber: string; // e.g. "ORD-2026-0001"
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  subtotalCentavos: number;
  discountCentavos: number;
  expressFeeCentavos: number;
  totalCentavos: number;
  paidCentavos: number;
  balanceCentavos: number;
  notes?: string;
  expectedReadyAt: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  // Included relations when fetched
  items?: OrderItem[];
  customer?: Customer;
}

export interface OrderStatusHistory {
  id: string; // UUID
  orderId: string;
  tenantId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  changedByUserId: string;
  notes?: string;
  timestamp: string;
}

export interface Payment {
  id: string; // UUID
  tenantId: string;
  orderId: string;
  amountCentavos: number;
  method: PaymentMethod;
  referenceNumber: string;
  cashierUserId: string;
  notes?: string;
  createdAt: string;
}

export interface PaymentAttempt {
  id: string; // UUID
  tenantId: string;
  orderId: string;
  idempotencyKey: string;
  provider: 'paymongo';
  amountCentavos: number;
  status: PaymentAttemptStatus;
  qrCodeUrl?: string;
  qrString?: string;
  externalReference?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentConnection {
  id: string; // UUID
  tenantId: string;
  provider: 'paymongo';
  status: 'connected' | 'disconnected' | 'sandbox';
  publicKey?: string;
  webhookSecret?: string;
  merchantId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string; // UUID
  tenantId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

/**
 * Role Permission definitions
 */
export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  super_admin: [
    'platform:manage_tenants',
    'platform:view_all_tenants',
    'platform:manage_subscriptions',
    'platform:view_audit_logs',
    'platform:diagnostics',
  ],
  owner: [
    'tenant:manage_settings',
    'tenant:manage_branches',
    'staff:manage_roles',
    'staff:invite',
    'services:manage',
    'pricing:edit',
    'orders:create',
    'orders:update_status',
    'orders:cancel',
    'pos:apply_discount',
    'payments:collect',
    'payments:refund',
    'reports:view_financial',
    'reports:export',
    'customers:manage',
    'audit:view',
  ],
  manager: [
    'tenant:view_settings',
    'staff:view_list',
    'services:manage',
    'orders:create',
    'orders:update_status',
    'orders:cancel',
    'pos:apply_discount',
    'payments:collect',
    'reports:view_operational',
    'customers:manage',
    'audit:view',
  ],
  cashier: [
    'orders:create',
    'orders:update_status',
    'pos:checkout',
    'payments:collect',
    'customers:create',
    'customers:view',
    'reports:view_daily_cash',
  ],
  staff: [
    'orders:view',
    'orders:update_status',
    'customers:view',
  ],
};

export function hasPermission(role: UserRole, permission: string): boolean {
  if (role === 'super_admin') return true;
  return ROLE_PERMISSIONS[role]?.includes(permission) || false;
}
