/**
 * LaundryOS - Cloud Firestore Backend Engine
 * Connects Express API routes directly to the provisioned Firestore database
 * via Firebase Auth ID token verification and Firestore REST API.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  Tenant,
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
  AuditLog,
} from '../src/types/database.ts';

interface FirebaseAppletConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId: string;
}

const CONFIG_PATH = path.resolve(process.cwd(), 'firebase-applet-config.json');
let cachedConfig: FirebaseAppletConfig | null = null;

export function getFirebaseConfig(): FirebaseAppletConfig {
  if (!cachedConfig) {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    cachedConfig = JSON.parse(raw) as FirebaseAppletConfig;
  }
  return cachedConfig;
}

export interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
  photoUrl?: string;
}

// Short-lived verification cache (60s) keyed by token hash
const tokenCache = new Map<string, { user: VerifiedFirebaseUser; expiresAt: number }>();

/**
 * Verifies a Firebase Auth ID token against Google Identity Toolkit.
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseUser | null> {
  if (!idToken || idToken.length < 50) return null;

  const hash = crypto.createHash('sha256').update(idToken).digest('hex');
  const cached = tokenCache.get(hash);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  try {
    const { apiKey } = getFirebaseConfig();
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as {
      users?: Array<{
        localId: string;
        email?: string;
        emailVerified?: boolean;
        displayName?: string;
        photoUrl?: string;
      }>;
    };

    const fbUser = data.users?.[0];
    if (!fbUser || !fbUser.localId) {
      return null;
    }

    const verified: VerifiedFirebaseUser = {
      uid: fbUser.localId,
      email: fbUser.email || '',
      emailVerified: Boolean(fbUser.emailVerified),
      displayName: fbUser.displayName,
      photoUrl: fbUser.photoUrl,
    };

    tokenCache.set(hash, {
      user: verified,
      expiresAt: Date.now() + 60_000,
    });

    return verified;
  } catch (err) {
    console.error('Firebase token verification error:', err);
    return null;
  }
}

// ============================================================================
// FIRESTORE REST VALUE CODEC
// ============================================================================

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } }
  | { timestampValue: string };

function toFirestoreValue(val: unknown): FirestoreValue | undefined {
  if (val === undefined) return undefined;
  if (val === null) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (Array.isArray(val)) {
    const values = val.map(toFirestoreValue).filter((v): v is FirestoreValue => v !== undefined);
    return { arrayValue: { values } };
  }
  if (typeof val === 'object') {
    const fields = toFirestoreFields(val as Record<string, unknown>);
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function toFirestoreFields(obj: Record<string, unknown>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    const encoded = toFirestoreValue(v);
    if (encoded !== undefined) {
      fields[k] = encoded;
    }
  }
  return fields;
}

function fromFirestoreValue(val: FirestoreValue): unknown {
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return val.doubleValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(fromFirestoreValue);
  }
  if ('mapValue' in val) {
    return fromFirestoreFields(val.mapValue.fields || {});
  }
  return null;
}

function fromFirestoreFields<T = Record<string, unknown>>(fields?: Record<string, FirestoreValue>): T {
  const result: Record<string, unknown> = {};
  if (!fields) return result as T;
  for (const [k, v] of Object.entries(fields)) {
    result[k] = fromFirestoreValue(v);
  }
  return result as T;
}

function getBaseUrl(): string {
  const { projectId, firestoreDatabaseId } = getFirebaseConfig();
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${firestoreDatabaseId}/documents`;
}

// ============================================================================
// CORE FIRESTORE REST OPERATIONS
// ============================================================================

export async function getFirestoreDoc<T>(docPath: string, idToken: string): Promise<T | null> {
  const url = `${getBaseUrl()}/${docPath}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Firestore GET ${docPath} failed (${res.status}): ${errText}`);
  }

  const doc = (await res.json()) as { fields?: Record<string, FirestoreValue> };
  return fromFirestoreFields<T>(doc.fields);
}

export async function setFirestoreDoc<T>(
  docPath: string,
  data: T,
  idToken: string
): Promise<T> {
  const url = `${getBaseUrl()}/${docPath}`;
  const fields = toFirestoreFields(data as unknown as Record<string, unknown>);

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Firestore SET ${docPath} failed (${res.status}): ${errText}`);
  }

  const saved = (await res.json()) as { fields?: Record<string, FirestoreValue> };
  return fromFirestoreFields<T>(saved.fields);
}

export async function listFirestoreCollection<T>(collectionPath: string, idToken: string): Promise<T[]> {
  const results: T[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${getBaseUrl()}/${collectionPath}`);
    url.searchParams.set('pageSize', '200');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });

    if (res.status === 404) return [];
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Firestore LIST ${collectionPath} failed (${res.status}): ${errText}`);
    }

    const body = (await res.json()) as {
      documents?: Array<{ fields?: Record<string, FirestoreValue> }>;
      nextPageToken?: string;
    };

    for (const doc of body.documents || []) {
      results.push(fromFirestoreFields<T>(doc.fields));
    }

    pageToken = body.nextPageToken;
  } while (pageToken);

  return results;
}

export async function queryTenantsByMemberUid(uid: string, idToken: string): Promise<Tenant[]> {
  const { projectId, firestoreDatabaseId } = getFirebaseConfig();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${firestoreDatabaseId}/documents:runQuery`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'tenants' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'memberUids' },
            op: 'ARRAY_CONTAINS',
            value: { stringValue: uid },
          },
        },
        limit: 100,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Firestore QUERY tenants failed (${res.status}): ${errText}`);
  }

  const rows = (await res.json()) as Array<{ document?: { fields?: Record<string, FirestoreValue> } }>;
  const tenants: Tenant[] = [];
  for (const row of rows) {
    if (row.document?.fields) {
      tenants.push(fromFirestoreFields<Tenant>(row.document.fields));
    }
  }
  return tenants;
}

export async function queryTenantsByOwnerEmail(email: string, idToken: string): Promise<Tenant[]> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return [];
  const { projectId, firestoreDatabaseId } = getFirebaseConfig();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${firestoreDatabaseId}/documents:runQuery`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'tenants' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'ownerEmail' },
            op: 'EQUAL',
            value: { stringValue: normalized },
          },
        },
        limit: 100,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Firestore QUERY tenants by ownerEmail failed (${res.status}): ${errText}`);
  }

  const rows = (await res.json()) as Array<{ document?: { fields?: Record<string, FirestoreValue> } }>;
  const tenants: Tenant[] = [];
  for (const row of rows) {
    if (row.document?.fields) {
      tenants.push(fromFirestoreFields<Tenant>(row.document.fields));
    }
  }
  return tenants;
}

// ============================================================================
// LAUNDRYOS CLOUD FIRESTORE REPOSITORY
// ============================================================================

export const BOOTSTRAPPED_ADMIN_EMAIL = 'fabricantepriscia@gmail.com';

class FirestoreRepository {
  private seededInSession = false;

  /**
   * Ensures the authenticated Firebase user has a profile, membership,
   * and that the Firestore database is seeded if empty.
   */
  public async syncAuthenticatedUserAndSeed(
    fbUser: VerifiedFirebaseUser,
    idToken: string
  ): Promise<{
    user: User;
    memberships: TenantMembership[];
    tenants: Tenant[];
  }> {
    const now = new Date().toISOString();
    const isAdminEmail = fbUser.email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();

    // 1. Ensure /users/{uid} exists
    let fsUser = await getFirestoreDoc<User>(`users/${fbUser.uid}`, idToken);
    if (!fsUser) {
      fsUser = {
        id: fbUser.uid,
        authUid: fbUser.uid,
        email: fbUser.email,
        fullName: fbUser.displayName || fbUser.email.split('@')[0] || 'LaundryOS User',
        avatarUrl: fbUser.photoUrl || '',
        isSuperAdmin: isAdminEmail,
        createdAt: now,
        updatedAt: now,
      };
      await setFirestoreDoc(`users/${fbUser.uid}`, fsUser as unknown as Record<string, unknown>, idToken);
    } else if (isAdminEmail && !fsUser.isSuperAdmin) {
      fsUser.isSuperAdmin = true;
      fsUser.updatedAt = now;
      await setFirestoreDoc(`users/${fbUser.uid}`, fsUser as unknown as Record<string, unknown>, idToken);
    }

    // 2. Ensure /admins/{uid} if bootstrapped admin
    if (isAdminEmail) {
      const adminDoc = await getFirestoreDoc(`admins/${fbUser.uid}`, idToken).catch(() => null);
      if (!adminDoc) {
        await setFirestoreDoc(
          `admins/${fbUser.uid}`,
          {
            uid: fbUser.uid,
            email: fbUser.email,
            createdAt: now,
          },
          idToken
        );
      }
    }

    // 3. Load accessible tenants & ensure membership for this user
    let tenants: Tenant[] = [];
    const memberships: TenantMembership[] = [];

    if (isAdminEmail) {
      tenants = await listFirestoreCollection<Tenant>('tenants', idToken).catch(async () => {
        return queryTenantsByMemberUid(fbUser.uid, idToken).catch(() => []);
      });
    } else {
      // For non-admin users, query both memberUids and assigned ownerEmail via filtered :runQuery.
      const normalizedEmail = fbUser.email.trim().toLowerCase();
      const [queriedByUid, queriedByEmail] = await Promise.all([
        queryTenantsByMemberUid(fbUser.uid, idToken).catch(() => []),
        normalizedEmail
          ? queryTenantsByOwnerEmail(normalizedEmail, idToken).catch(() => [])
          : Promise.resolve([]),
      ]);

      const mapById = new Map<string, Tenant>();
      for (const qt of [...queriedByUid, ...queriedByEmail]) {
        mapById.set(qt.id, qt);
      }

      tenants = Array.from(mapById.values());
    }

    for (const t of tenants) {
      const existingMember = await getFirestoreDoc<TenantMembership>(
        `tenants/${t.id}/members/${fbUser.uid}`,
        idToken
      ).catch(() => null);

      const isAssignedOwner = Boolean(
        t.ownerEmail && fbUser.email && t.ownerEmail.trim().toLowerCase() === fbUser.email.trim().toLowerCase()
      );

      if (isAssignedOwner || isAdminEmail) {
        let activeMember = existingMember;
        if (!existingMember || existingMember.status !== 'active' || existingMember.role !== 'owner') {
          const branches = isAdminEmail ? await this.getBranchesByTenant(t.id, idToken).catch(() => []) : [];
          const newMem: TenantMembership & { authUid: string } = {
            id: fbUser.uid,
            tenantId: t.id,
            userId: fsUser.id,
            authUid: fbUser.uid,
            role: 'owner',
            status: 'active',
            branchId: existingMember?.branchId || branches[0]?.id,
            createdAt: existingMember?.createdAt || now,
            updatedAt: now,
          };
          await setFirestoreDoc(
            `tenants/${t.id}/members/${fbUser.uid}`,
            newMem as unknown as Record<string, unknown>,
            idToken
          );
          activeMember = newMem;
        }
        if (activeMember) {
          memberships.push(activeMember);
        }

        const tenantWithMeta = t as Tenant & { memberUids?: string[]; ownerUid?: string };
        const currentUids = Array.isArray(tenantWithMeta.memberUids) ? tenantWithMeta.memberUids : [];
        const needsMemberUid = !currentUids.includes(fbUser.uid);
        const needsOwnerUid = isAssignedOwner
          ? tenantWithMeta.ownerUid !== fbUser.uid
          : !tenantWithMeta.ownerUid;

        if (needsMemberUid || needsOwnerUid) {
          const updatedTenantDoc = {
            ...tenantWithMeta,
            ownerUid: isAssignedOwner ? fbUser.uid : tenantWithMeta.ownerUid || fbUser.uid,
            memberUids: needsMemberUid ? [...currentUids, fbUser.uid].slice(0, 50) : currentUids,
            updatedAt: now,
          };
          await setFirestoreDoc(`tenants/${t.id}`, updatedTenantDoc, idToken).catch(() => {});
          Object.assign(t, updatedTenantDoc);
        }
      } else if (existingMember && existingMember.status === 'active') {
        memberships.push(existingMember);
      }
    }

    if (!fsUser.isSuperAdmin) {
      const memberTenantIds = new Set(memberships.map((m) => m.tenantId));
      tenants = tenants.filter((t) => memberTenantIds.has(t.id));
    }

    return {
      user: fsUser,
      memberships,
      tenants,
    };
  }

  // --- TENANTS ---
  public async getTenants(idToken: string, fbUser?: VerifiedFirebaseUser): Promise<Tenant[]> {
    if (fbUser && fbUser.email.toLowerCase() !== BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()) {
      const normalizedEmail = fbUser.email.trim().toLowerCase();
      const [queriedByUid, queriedByEmail] = await Promise.all([
        queryTenantsByMemberUid(fbUser.uid, idToken).catch(() => []),
        normalizedEmail
          ? queryTenantsByOwnerEmail(normalizedEmail, idToken).catch(() => [])
          : Promise.resolve([]),
      ]);
      const mapById = new Map<string, Tenant>();
      for (const qt of [...queriedByUid, ...queriedByEmail]) {
        mapById.set(qt.id, qt);
      }
      return Array.from(mapById.values());
    }
    return listFirestoreCollection<Tenant>('tenants', idToken);
  }

  public async getTenantById(tenantId: string, idToken: string): Promise<Tenant | null> {
    return getFirestoreDoc<Tenant>(`tenants/${tenantId}`, idToken);
  }

  public async saveTenant(
    tenant: Tenant & { ownerUid?: string; memberUids?: string[] },
    idToken: string
  ): Promise<Tenant> {
    return setFirestoreDoc<Tenant>(`tenants/${tenant.id}`, tenant, idToken);
  }

  // --- MEMBERSHIPS ---
  public async getMembersByTenant(tenantId: string, idToken: string): Promise<TenantMembership[]> {
    return listFirestoreCollection<TenantMembership>(`tenants/${tenantId}/members`, idToken);
  }

  public async getMembershipForUid(
    tenantId: string,
    uid: string,
    idToken: string
  ): Promise<TenantMembership | null> {
    return getFirestoreDoc<TenantMembership>(`tenants/${tenantId}/members/${uid}`, idToken);
  }

  public async saveMembership(
    tenantId: string,
    membership: TenantMembership & { authUid?: string },
    idToken: string
  ): Promise<TenantMembership> {
    return setFirestoreDoc<TenantMembership>(`tenants/${tenantId}/members/${membership.id}`, membership, idToken);
  }

  // --- BRANCHES ---
  public async getBranchesByTenant(tenantId: string, idToken: string): Promise<Branch[]> {
    return listFirestoreCollection<Branch>(`tenants/${tenantId}/branches`, idToken);
  }

  public async saveBranch(tenantId: string, branch: Branch, idToken: string): Promise<Branch> {
    return setFirestoreDoc<Branch>(`tenants/${tenantId}/branches/${branch.id}`, branch, idToken);
  }

  // --- SERVICES ---
  public async getServicesByTenant(tenantId: string, idToken: string): Promise<Service[]> {
    return listFirestoreCollection<Service>(`tenants/${tenantId}/services`, idToken);
  }

  public async saveService(tenantId: string, service: Service, idToken: string): Promise<Service> {
    return setFirestoreDoc<Service>(`tenants/${tenantId}/services/${service.id}`, service, idToken);
  }

  // --- CUSTOMERS ---
  public async getCustomersByTenant(tenantId: string, idToken: string): Promise<Customer[]> {
    return listFirestoreCollection<Customer>(`tenants/${tenantId}/customers`, idToken);
  }

  public async getCustomerById(tenantId: string, customerId: string, idToken: string): Promise<Customer | null> {
    return getFirestoreDoc<Customer>(`tenants/${tenantId}/customers/${customerId}`, idToken);
  }

  public async saveCustomer(tenantId: string, customer: Customer, idToken: string): Promise<Customer> {
    return setFirestoreDoc<Customer>(`tenants/${tenantId}/customers/${customer.id}`, customer, idToken);
  }

  // --- ORDERS ---
  public async getOrdersByTenant(
    tenantId: string,
    idToken: string
  ): Promise<Array<Order & { items: OrderItem[]; customer?: Customer }>> {
    const [orders, customers] = await Promise.all([
      listFirestoreCollection<Order>(`tenants/${tenantId}/orders`, idToken),
      listFirestoreCollection<Customer>(`tenants/${tenantId}/customers`, idToken),
    ]);

    const customerMap = new Map(customers.map((c) => [c.id, c]));

    const enriched = await Promise.all(
      orders.map(async (order) => {
        const items = await listFirestoreCollection<OrderItem>(
          `tenants/${tenantId}/orders/${order.id}/items`,
          idToken
        );
        return {
          ...order,
          items,
          customer: customerMap.get(order.customerId),
        };
      })
    );

    return enriched.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public async getOrderById(
    tenantId: string,
    orderId: string,
    idToken: string
  ): Promise<(Order & { items: OrderItem[]; customer?: Customer; history: OrderStatusHistory[] }) | null> {
    const order = await getFirestoreDoc<Order>(`tenants/${tenantId}/orders/${orderId}`, idToken);
    if (!order) return null;

    const [items, history, customer] = await Promise.all([
      listFirestoreCollection<OrderItem>(`tenants/${tenantId}/orders/${orderId}/items`, idToken),
      listFirestoreCollection<OrderStatusHistory>(`tenants/${tenantId}/orders/${orderId}/history`, idToken),
      getFirestoreDoc<Customer>(`tenants/${tenantId}/customers/${order.customerId}`, idToken),
    ]);

    return {
      ...order,
      items,
      history,
      customer: customer || undefined,
    };
  }

  public async saveOrder(tenantId: string, order: Order, idToken: string): Promise<Order> {
    // Strip virtual relations before saving to Firestore so strict rules allowlists pass
    const { items: _items, customer: _customer, history: _history, ...cleanOrder } = order as Order & {
      items?: unknown;
      customer?: unknown;
      history?: unknown;
    };
    return setFirestoreDoc<Order>(`tenants/${tenantId}/orders/${order.id}`, cleanOrder as Order, idToken);
  }

  public async saveOrderItem(tenantId: string, orderId: string, item: OrderItem, idToken: string): Promise<OrderItem> {
    return setFirestoreDoc<OrderItem>(`tenants/${tenantId}/orders/${orderId}/items/${item.id}`, item, idToken);
  }

  public async saveOrderHistory(
    tenantId: string,
    orderId: string,
    entry: OrderStatusHistory,
    idToken: string
  ): Promise<OrderStatusHistory> {
    return setFirestoreDoc<OrderStatusHistory>(
      `tenants/${tenantId}/orders/${orderId}/history/${entry.id}`,
      entry,
      idToken
    );
  }

  // --- PAYMENTS ---
  public async getPaymentsByTenant(tenantId: string, idToken: string): Promise<Payment[]> {
    const payments = await listFirestoreCollection<Payment>(`tenants/${tenantId}/payments`, idToken);
    return payments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public async savePayment(tenantId: string, payment: Payment, idToken: string): Promise<Payment> {
    return setFirestoreDoc<Payment>(`tenants/${tenantId}/payments/${payment.id}`, payment, idToken);
  }

  // --- SUBSCRIPTIONS ---
  public async getSubscriptionByTenant(tenantId: string, idToken: string): Promise<Subscription | undefined> {
    const direct = await getFirestoreDoc<Subscription>(`subscriptions/sub-${tenantId}`, idToken).catch(() => null);
    if (direct) return direct;

    const subs = await listFirestoreCollection<Subscription>('subscriptions', idToken).catch(() => []);
    return subs.find((s) => s.tenantId === tenantId);
  }

  public async saveSubscription(subscription: Subscription, idToken: string): Promise<Subscription> {
    return setFirestoreDoc<Subscription>(`subscriptions/${subscription.id}`, subscription, idToken);
  }

  // --- AUDIT LOGS ---
  public async getAuditLogs(tenantId: string, idToken: string): Promise<AuditLog[]> {
    const logs = await listFirestoreCollection<AuditLog>(`tenants/${tenantId}/audit_logs`, idToken);
    return logs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public async getAllAdminAuditLogs(idToken: string): Promise<AuditLog[]> {
    const tenants = await this.getTenants(idToken);
    const logsPerTenant = await Promise.all(
      tenants.map((t) => listFirestoreCollection<AuditLog>(`tenants/${t.id}/audit_logs`, idToken).catch(() => []))
    );
    return logsPerTenant
      .flat()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public async logAudit(log: Omit<AuditLog, 'id' | 'createdAt'>, idToken: string): Promise<AuditLog | null> {
    if (!log.tenantId) return null;
    const newLog: AuditLog = {
      ...log,
      action: log.action.slice(0, 128),
      entityType: log.entityType.slice(0, 64),
      entityId: log.entityId ? log.entityId.slice(0, 128) : null,
      ipAddress: log.ipAddress ? log.ipAddress.slice(0, 64) : undefined,
      userAgent: log.userAgent ? log.userAgent.slice(0, 512) : undefined,
      id: `log-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
    };
    return setFirestoreDoc<AuditLog>(`tenants/${log.tenantId}/audit_logs/${newLog.id}`, newLog, idToken);
  }
}

export const firestoreRepo = new FirestoreRepository();
