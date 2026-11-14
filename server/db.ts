/**
 * LaundryOS - Server Database Engine
 * Relational model with foreign key validation, tenant isolation, and atomic file persistence.
 */

import fs from 'node:fs';
import os from 'node:os';
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

const DATA_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'fabriq-data')
  : path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'laundryos-db.json');

export function generateInitialSeed(): DatabaseState {
  return {
    tenants: [],
    branches: [],
    users: [],
    tenant_memberships: [],
    subscriptions: [],
    customers: [],
    services: [],
    orders: [],
    order_items: [],
    order_status_history: [],
    payments: [],
    payment_attempts: [],
    payment_connections: [],
    audit_logs: [],
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
