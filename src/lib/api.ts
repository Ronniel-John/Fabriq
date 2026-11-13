/**
 * LaundryOS - Client API Client
 * Sends authentication and tenant isolation headers with every request.
 */

import type {
  User,
  Tenant,
  TenantQrSettings,
  TenantMembership,
  Branch,
  Subscription,
  Customer,
  Service,
  Order,
  Payment,
  AuditLog,
  OrderStatus,
} from '../types/database.ts';
import { auth } from './firebase.ts';

export type StorageMode = 'firestore' | 'local_sandbox';

class ApiClient {
  private currentUserId: string = '';
  private currentTenantId: string = '';

  constructor() {
    // Restore session from sessionStorage if available
    try {
      if (typeof window !== 'undefined') {
        const savedUser = sessionStorage.getItem('laundryos_user_id');
        const savedTenant = sessionStorage.getItem('laundryos_tenant_id');
        if (savedUser) this.currentUserId = savedUser;
        if (savedTenant) this.currentTenantId = savedTenant;
      }
    } catch {
      // sessionStorage might not be available in SSR/sandboxes
    }
  }

  public setContext(userId: string, tenantId: string) {
    this.currentUserId = userId;
    this.currentTenantId = tenantId;
    try {
      if (typeof window !== 'undefined') {
        if (userId) sessionStorage.setItem('laundryos_user_id', userId);
        else sessionStorage.removeItem('laundryos_user_id');
        if (tenantId) sessionStorage.setItem('laundryos_tenant_id', tenantId);
        else sessionStorage.removeItem('laundryos_tenant_id');
      }
    } catch {}
  }

  public getContext() {
    return {
      userId: this.currentUserId,
      tenantId: this.currentTenantId,
    };
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers || {});
    headers.set('Content-Type', 'application/json');
    if (this.currentUserId) {
      headers.set('x-user-id', this.currentUserId);
      headers.set('Authorization', `Bearer ${this.currentUserId}`);
    }
    if (this.currentTenantId) {
      headers.set('x-tenant-id', this.currentTenantId);
    }

    try {
      await auth.authStateReady();
      if (auth.currentUser) {
        const idToken = await auth.currentUser.getIdToken();
        if (idToken) {
          headers.set('x-firebase-token', idToken);
        }
      }
    } catch {
      // Proceed without Firebase ID token in sandbox/offline fallback
    }

    const res = await fetch(path, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(errorBody.error || errorBody.message || `Request failed with ${res.status}`);
    }

    return res.json();
  }

  // Auth & Session
  public async login(payload: { email?: string; password?: string; personaId?: string }): Promise<{
    user: User;
    token: string;
    memberships: TenantMembership[];
    tenants: Tenant[];
    storageMode?: StorageMode;
  }> {
    const res = await this.request<{
      user: User;
      token: string;
      memberships: TenantMembership[];
      tenants: Tenant[];
      storageMode?: StorageMode;
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    this.setContext(res.user.id, res.tenants[0]?.id || '');
    return res;
  }

  public async loginWithGoogle(payload: {
    idToken?: string;
    authUid: string;
    email: string;
    fullName?: string;
    avatarUrl?: string;
  }): Promise<{
    user: User;
    token: string;
    memberships: TenantMembership[];
    tenants: Tenant[];
    storageMode?: StorageMode;
  }> {
    const res = await this.request<{
      user: User;
      token: string;
      memberships: TenantMembership[];
      tenants: Tenant[];
      storageMode?: StorageMode;
    }>('/api/auth/google-sync', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    this.setContext(res.user.id, res.tenants[0]?.id || '');
    return res;
  }

  public async logout(): Promise<void> {
    try {
      await this.request('/api/auth/logout', { method: 'POST' });
    } catch {}
    this.setContext('', '');
  }

  public async getMe(): Promise<{
    user: User;
    memberships: TenantMembership[];
    tenants: Tenant[];
    storageMode?: StorageMode;
  }> {
    return this.request('/api/auth/me');
  }

  public async getPersonas(): Promise<Array<{
    id: string;
    name: string;
    email: string;
    isSuperAdmin: boolean;
    memberships: Array<{ tenantId: string; tenantName: string; role: string }>;
  }>> {
    return this.request('/api/auth/personas');
  }

  // Tenants
  public async getTenants(): Promise<Tenant[]> {
    return this.request('/api/tenants');
  }

  public async createTenant(payload: {
    name: string;
    tradeName?: string;
    slug?: string;
    contactEmail: string;
    contactPhone?: string;
    ownerEmail?: string;
    branchName?: string;
    branchAddress?: string;
    plan?: 'starter' | 'growth' | 'enterprise';
    status?: 'trial' | 'active';
  }): Promise<{ tenant: Tenant; branch: Branch; subscription: Subscription }> {
    return this.request('/api/tenants', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public async updateTenantStatus(
    tenantId: string,
    status: 'trial' | 'active' | 'past_due' | 'suspended'
  ): Promise<{ tenant: Tenant }> {
    return this.request(`/api/tenants/${tenantId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  public async updateTenantOwner(
    tenantId: string,
    ownerEmail: string
  ): Promise<{ tenant: Tenant }> {
    return this.request(`/api/tenants/${tenantId}/owner`, {
      method: 'PATCH',
      body: JSON.stringify({ ownerEmail }),
    });
  }

  public async getTenant(tenantId: string): Promise<Tenant & { branches: Branch[]; subscription: Subscription; currentRole: string }> {
    return this.request(`/api/tenants/${tenantId}`);
  }

  public async updateTenant(tenantId: string, data: Partial<Tenant>): Promise<Tenant> {
    return this.request(`/api/tenants/${tenantId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  public async getMembers(tenantId: string): Promise<(TenantMembership & { user?: User })[]> {
    return this.request(`/api/tenants/${tenantId}/members`);
  }

  public async getBranches(tenantId: string): Promise<Branch[]> {
    return this.request(`/api/tenants/${tenantId}/branches`);
  }

  // Services
  public async getServices(tenantId: string): Promise<Service[]> {
    return this.request(`/api/tenants/${tenantId}/services`);
  }

  public async createService(tenantId: string, service: Partial<Service>): Promise<Service> {
    return this.request(`/api/tenants/${tenantId}/services`, {
      method: 'POST',
      body: JSON.stringify(service),
    });
  }

  // Customers
  public async getCustomers(tenantId: string): Promise<Customer[]> {
    return this.request(`/api/tenants/${tenantId}/customers`);
  }

  public async createCustomer(tenantId: string, customer: Partial<Customer>): Promise<Customer> {
    return this.request(`/api/tenants/${tenantId}/customers`, {
      method: 'POST',
      body: JSON.stringify(customer),
    });
  }

  public async updateCustomer(tenantId: string, customerId: string, customer: Partial<Customer>): Promise<Customer> {
    return this.request(`/api/tenants/${tenantId}/customers/${customerId}`, {
      method: 'PUT',
      body: JSON.stringify(customer),
    });
  }

  // Orders
  public async getOrders(tenantId: string): Promise<Order[]> {
    return this.request(`/api/tenants/${tenantId}/orders`);
  }

  public async getOrder(tenantId: string, orderId: string): Promise<Order> {
    return this.request(`/api/tenants/${tenantId}/orders/${orderId}`);
  }

  public async createOrder(tenantId: string, payload: {
    customerId: string;
    branchId?: string;
    items: Array<{ serviceId: string; quantity: number; notes?: string }>;
    discountCentavos?: number;
    expressFeeCentavos?: number;
    notes?: string;
    expectedHours?: number;
  }): Promise<Order> {
    return this.request(`/api/tenants/${tenantId}/orders`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public async updateOrderStatus(tenantId: string, orderId: string, newStatus: OrderStatus, notes?: string): Promise<{ order: Order }> {
    return this.request(`/api/tenants/${tenantId}/orders/${orderId}/status`, {
      method: 'POST',
      body: JSON.stringify({ newStatus, notes }),
    });
  }

  // Payments
  public async getPayments(tenantId: string): Promise<Payment[]> {
    return this.request(`/api/tenants/${tenantId}/payments`);
  }

  public async recordPayment(tenantId: string, orderId: string, payload: {
    amountCentavos: number;
    method: string;
    notes?: string;
  }): Promise<{ payment: Payment; order: Order }> {
    return this.request(`/api/tenants/${tenantId}/orders/${orderId}/payments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public async getQrSettings(tenantId: string): Promise<{
    qrSettings: TenantQrSettings | null;
    tenantName?: string;
    currency?: string;
  }> {
    return this.request(`/api/tenants/${tenantId}/qr-settings`);
  }

  public async updateQrSettings(tenantId: string, payload: {
    qrCodeImageUrl: string;
    merchantName?: string;
    accountName?: string;
    accountNumber?: string;
    provider?: string;
    notes?: string;
  }): Promise<{ success: boolean; qrSettings: TenantQrSettings; tenant: Tenant }> {
    return this.request(`/api/tenants/${tenantId}/qr-settings`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  // Audit Logs
  public async getAuditLogs(tenantId: string): Promise<AuditLog[]> {
    return this.request(`/api/tenants/${tenantId}/audit-logs`);
  }

  public async getAdminAuditLogs(): Promise<AuditLog[]> {
    return this.request('/api/admin/audit-logs');
  }

  // System & Schema
  public async getSchema(): Promise<{
    engine: string;
    currency: string;
    isolationModel: string;
    tables: Array<{
      tableName: string;
      description: string;
      columns: Array<{ name: string; type: string; key?: string; check?: string; default?: unknown }>;
      recordCount: number;
    }>;
  }> {
    return this.request('/api/system/schema');
  }

  public async testCrossTenantBoundary(attackerUserId: string, victimTenantId: string): Promise<{
    success: boolean;
    blocked: boolean;
    statusCode: number;
    securityStatus: string;
    message: string;
    auditLogged: boolean;
    details: {
      user: { id: string; email: string };
      targetTenant: { id: string; name: string };
      policy: string;
    };
  }> {
    return this.request('/api/system/test-cross-tenant-boundary', {
      method: 'POST',
      body: JSON.stringify({ attackerUserId, victimTenantId }),
    });
  }

  public async resetDemo(): Promise<{ message: string }> {
    return this.request('/api/system/reset-demo', {
      method: 'POST',
    });
  }
}

export const api = new ApiClient();
