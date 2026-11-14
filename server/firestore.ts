/**
 * LaundryOS - Cloud Firestore Backend Engine
 * Connects Express API routes directly to the provisioned Firestore database
 * via Firebase Auth ID token verification and Firestore REST API.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let cachedConfig: FirebaseAppletConfig | null = null;

export function getFirebaseConfig(): FirebaseAppletConfig {
  if (!cachedConfig) {
    const candidates = [
      path.resolve(process.cwd(), 'firebase-applet-config.json'),
      path.resolve(__dirname, '..', 'firebase-applet-config.json'),
      path.resolve(__dirname, '..', '..', 'firebase-applet-config.json'),
    ];
    const configPath = candidates.find((p) => fs.existsSync(p));
    if (!configPath) {
      throw new Error('firebase-applet-config.json not found in runtime bundle');
    }
    const raw = fs.readFileSync(configPath, 'utf-8');
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

export async function runSubcollectionQuery<T>(
  parentPath: string,
  collectionId: string,
  idToken: string,
  whereField: string,
  op: 'EQUAL' | 'ARRAY_CONTAINS',
  value: FirestoreValue
): Promise<Array<{ name: string; data: T }>> {
  const { projectId, firestoreDatabaseId } = getFirebaseConfig();
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${firestoreDatabaseId}/documents`;
  const url = parentPath ? `${base}/${parentPath}:runQuery` : `${base}:runQuery`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath: whereField },
            op,
            value,
          },
        },
        limit: 500,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Firestore QUERY ${parentPath}/${collectionId} failed (${res.status}): ${errText}`);
  }

  const rows = (await res.json()) as Array<{
    document?: { name?: string; fields?: Record<string, FirestoreValue> };
  }>;
  const results: Array<{ name: string; data: T }> = [];
  for (const row of rows) {
    if (row.document?.fields) {
      results.push({
        name: row.document.name || '',
        data: fromFirestoreFields<T>(row.document.fields),
      });
    }
  }
  return results;
}

export async function listTenantSubcollection<T>(
  parentPath: string,
  collectionId: string,
  idToken: string,
  fbUser?: VerifiedFirebaseUser
): Promise<T[]> {
  if (!fbUser || fbUser.email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()) {
    return listFirestoreCollection<T>(`${parentPath}/${collectionId}`, idToken);
  }

  const normalizedEmail = fbUser.email.trim().toLowerCase();
  const queries: Array<Promise<Array<{ name: string; data: T }>>> = [
    runSubcollectionQuery<T>(parentPath, collectionId, idToken, 'memberUids', 'ARRAY_CONTAINS', {
      stringValue: fbUser.uid,
    }).catch((err) => {
      console.warn(
        `runSubcollectionQuery(memberUids) ${parentPath}/${collectionId} failed:`,
        err instanceof Error ? err.message : err
      );
      return [];
    }),
  ];

  if (normalizedEmail) {
    queries.push(
      runSubcollectionQuery<T>(parentPath, collectionId, idToken, 'ownerEmail', 'EQUAL', {
        stringValue: normalizedEmail,
      }).catch((err) => {
        console.warn(
          `runSubcollectionQuery(ownerEmail) ${parentPath}/${collectionId} failed:`,
          err instanceof Error ? err.message : err
        );
        return [];
      })
    );
  }

  if (collectionId === 'members') {
    queries.push(
      runSubcollectionQuery<T>(parentPath, collectionId, idToken, 'userId', 'EQUAL', {
        stringValue: fbUser.uid,
      }).catch(() => [])
    );
  }

  const batches = await Promise.all(queries);
  const byDocName = new Map<string, T>();
  let fallbackIdx = 0;
  for (const batch of batches) {
    for (const item of batch) {
      const idFromData = (item.data as { id?: string })?.id;
      const key = item.name || idFromData || `row-${fallbackIdx++}`;
      byDocName.set(key, item.data);
    }
  }
  return Array.from(byDocName.values());
}

export async function queryAllTenants(idToken: string): Promise<Tenant[]> {
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
        limit: 200,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Firestore RUNQUERY tenants failed (${res.status}): ${errText}`);
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
  private tenantMetaCache = new Map<
    string,
    { ownerEmail?: string; memberUids: string[]; expiresAt: number }
  >();

  private async getTenantAccessMeta(
    tenantId: string,
    idToken: string,
    fbUser?: VerifiedFirebaseUser
  ): Promise<{ ownerEmail?: string; memberUids: string[] }> {
    const cached = this.tenantMetaCache.get(tenantId);
    let ownerEmail: string | undefined;
    let memberUids: string[] = [];

    if (cached && cached.expiresAt > Date.now()) {
      ownerEmail = cached.ownerEmail;
      memberUids = [...cached.memberUids];
    } else {
      const tenantDoc = await getFirestoreDoc<Tenant & { memberUids?: string[] }>(
        `tenants/${tenantId}`,
        idToken
      ).catch(() => null);
      ownerEmail =
        tenantDoc?.ownerEmail && typeof tenantDoc.ownerEmail === 'string'
          ? tenantDoc.ownerEmail.trim().toLowerCase()
          : undefined;
      memberUids = Array.isArray(tenantDoc?.memberUids) ? [...tenantDoc.memberUids] : [];
      this.tenantMetaCache.set(tenantId, {
        ownerEmail,
        memberUids,
        expiresAt: Date.now() + 15_000,
      });
    }

    if (fbUser?.uid && !memberUids.includes(fbUser.uid)) {
      memberUids.push(fbUser.uid);
    }

    return {
      ownerEmail,
      memberUids: memberUids.slice(0, 50),
    };
  }

  private async attachTenantAccessMeta<T extends Record<string, unknown>>(
    tenantId: string,
    doc: T,
    idToken: string,
    fbUser?: VerifiedFirebaseUser
  ): Promise<T> {
    const meta = await this.getTenantAccessMeta(tenantId, idToken, fbUser);
    const existingUids = Array.isArray((doc as { memberUids?: unknown }).memberUids)
      ? ((doc as { memberUids?: string[] }).memberUids || [])
      : [];
    const mergedUids = Array.from(new Set([...meta.memberUids, ...existingUids])).slice(0, 50);
    const resolvedOwnerEmail =
      (doc as { ownerEmail?: string | null }).ownerEmail || meta.ownerEmail || undefined;

    return {
      ...doc,
      ...(resolvedOwnerEmail ? { ownerEmail: String(resolvedOwnerEmail).trim().toLowerCase().slice(0, 255) } : {}),
      ...(mergedUids.length > 0 ? { memberUids: mergedUids } : {}),
    };
  }

  private isSuperAdminUser(fbUser?: VerifiedFirebaseUser): boolean {
    return !fbUser || fbUser.email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();
  }

  private scheduleLegacyBackfill(
    tenantId: string,
    collectionPath: string,
    docs: Array<Record<string, unknown> & { id: string }>,
    idToken: string,
    fbUser?: VerifiedFirebaseUser
  ): void {
    if (!this.isSuperAdminUser(fbUser) || docs.length === 0) return;
    void (async () => {
      try {
        const meta = await this.getTenantAccessMeta(tenantId, idToken, fbUser);
        if (!meta.ownerEmail && meta.memberUids.length === 0) return;

        for (const d of docs) {
          const docUids = Array.isArray(d.memberUids) ? (d.memberUids as string[]) : [];
          const docOwner = typeof d.ownerEmail === 'string' ? d.ownerEmail.trim().toLowerCase() : undefined;
          const missingUid = meta.memberUids.some((u) => !docUids.includes(u));
          const missingOwner = Boolean(meta.ownerEmail && docOwner !== meta.ownerEmail);
          if (missingUid || missingOwner) {
            const mergedUids = Array.from(new Set([...docUids, ...meta.memberUids])).slice(0, 50);
            const patched = {
              ...d,
              ...(meta.ownerEmail ? { ownerEmail: meta.ownerEmail } : {}),
              ...(mergedUids.length > 0 ? { memberUids: mergedUids } : {}),
            };
            await setFirestoreDoc(`${collectionPath}/${d.id}`, patched, idToken).catch(() => {});
          }
        }
      } catch {
        // Non-blocking background backfill
      }
    })();
  }

  public async syncTenantSubcollectionMeta(
    tenantId: string,
    ownerEmail: string | null | undefined,
    memberUids: string[],
    idToken: string
  ): Promise<void> {
    this.tenantMetaCache.delete(tenantId);
    const normalizedEmail = ownerEmail ? ownerEmail.trim().toLowerCase() : null;
    const collections = ['members', 'branches', 'services', 'customers', 'orders', 'payments', 'audit_logs'];

    await Promise.all(
      collections.map(async (col) => {
        const docs = await listFirestoreCollection<Record<string, unknown> & { id: string }>(
          `tenants/${tenantId}/${col}`,
          idToken
        ).catch(() => []);
        await Promise.all(
          docs.map(async (d) => {
            const existingUids = Array.isArray(d.memberUids) ? (d.memberUids as string[]) : [];
            const mergedUids = Array.from(new Set([...existingUids, ...memberUids])).slice(0, 50);
            const patched: Record<string, unknown> = {
              ...d,
              ownerEmail: normalizedEmail,
              ...(mergedUids.length > 0 ? { memberUids: mergedUids } : {}),
            };
            await setFirestoreDoc(`tenants/${tenantId}/${col}/${d.id}`, patched, idToken).catch(() => {});
            if (col === 'orders') {
              const items = await listFirestoreCollection<Record<string, unknown> & { id: string }>(
                `tenants/${tenantId}/orders/${d.id}/items`,
                idToken
              ).catch(() => []);
              await Promise.all(
                items.map((item) =>
                  setFirestoreDoc(
                    `tenants/${tenantId}/orders/${d.id}/items/${item.id}`,
                    {
                      ...item,
                      ownerEmail: normalizedEmail,
                      ...(mergedUids.length > 0 ? { memberUids: mergedUids } : {}),
                    },
                    idToken
                  ).catch(() => {})
                )
              );
            }
          })
        );
      })
    );
  }

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
        email: fbUser.email.slice(0, 255),
        fullName: (fbUser.displayName || fbUser.email.split('@')[0] || 'Fabriq User').slice(0, 255),
        avatarUrl: (fbUser.photoUrl || '').slice(0, 1024),
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
        return queryAllTenants(idToken).catch(async () => {
          return queryTenantsByMemberUid(fbUser.uid, idToken).catch(() => []);
        });
      });
    } else {
      // For non-admin users, query both memberUids and assigned ownerEmail via filtered :runQuery.
      const normalizedEmail = fbUser.email.trim().toLowerCase();
      const [queriedByUid, queriedByEmail] = await Promise.all([
        queryTenantsByMemberUid(fbUser.uid, idToken).catch((err) => {
          console.warn('queryTenantsByMemberUid failed:', err instanceof Error ? err.message : err);
          return [];
        }),
        normalizedEmail
          ? queryTenantsByOwnerEmail(normalizedEmail, idToken).catch((err) => {
              console.warn('queryTenantsByOwnerEmail failed:', err instanceof Error ? err.message : err);
              return [];
            })
          : Promise.resolve([]),
      ]);

      const mapById = new Map<string, Tenant>();
      for (const qt of [...queriedByUid, ...queriedByEmail]) {
        mapById.set(qt.id, qt);
      }

      tenants = Array.from(mapById.values());
    }

    for (const t of tenants) {
      try {
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
            const branches = isAdminEmail ? await this.getBranchesByTenant(t.id, idToken, fbUser).catch(() => []) : [];
            const tenantWithMeta = t as Tenant & { memberUids?: string[]; ownerUid?: string };
            const currentTenantUids = Array.isArray(tenantWithMeta.memberUids) ? tenantWithMeta.memberUids : [];
            const mergedMemberUids = Array.from(new Set([...currentTenantUids, fbUser.uid])).slice(0, 50);
            const newMem: TenantMembership & { authUid: string; ownerEmail?: string; memberUids?: string[] } = {
              id: fbUser.uid,
              tenantId: t.id,
              userId: fsUser.id,
              authUid: fbUser.uid,
              role: 'owner',
              status: 'active',
              branchId: existingMember?.branchId || branches[0]?.id,
              ...(t.ownerEmail ? { ownerEmail: t.ownerEmail.trim().toLowerCase() } : {}),
              memberUids: mergedMemberUids,
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
            this.tenantMetaCache.delete(t.id);
            Object.assign(t, updatedTenantDoc);
          }
        } else if (existingMember && existingMember.status === 'active') {
          memberships.push(existingMember);
        }
      } catch (memberErr) {
        console.warn(`Failed syncing membership for tenant ${t.id}:`, memberErr);
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
        queryTenantsByMemberUid(fbUser.uid, idToken).catch((err) => {
          console.warn('getTenants queryTenantsByMemberUid failed:', err instanceof Error ? err.message : err);
          return [];
        }),
        normalizedEmail
          ? queryTenantsByOwnerEmail(normalizedEmail, idToken).catch((err) => {
              console.warn('getTenants queryTenantsByOwnerEmail failed:', err instanceof Error ? err.message : err);
              return [];
            })
          : Promise.resolve([]),
      ]);
      const mapById = new Map<string, Tenant>();
      for (const qt of [...queriedByUid, ...queriedByEmail]) {
        mapById.set(qt.id, qt);
      }
      return Array.from(mapById.values());
    }
    return listFirestoreCollection<Tenant>('tenants', idToken).catch(() => queryAllTenants(idToken));
  }

  public async getTenantById(tenantId: string, idToken: string): Promise<Tenant | null> {
    return getFirestoreDoc<Tenant>(`tenants/${tenantId}`, idToken);
  }

  public async saveTenant(
    tenant: Tenant & { ownerUid?: string; memberUids?: string[] },
    idToken: string
  ): Promise<Tenant> {
    this.tenantMetaCache.delete(tenant.id);
    return setFirestoreDoc<Tenant>(`tenants/${tenant.id}`, tenant, idToken);
  }

  // --- MEMBERSHIPS ---
  public async getMembersByTenant(
    tenantId: string,
    idToken: string,
    fbUser?: VerifiedFirebaseUser
  ): Promise<TenantMembership[]> {
    const members = await listTenantSubcollection<TenantMembership>(`tenants/${tenantId}`, 'members', idToken, fbUser);
    this.scheduleLegacyBackfill(
      tenantId,
      `tenants/${tenantId}/members`,
      members as unknown as Array<Record<string, unknown> & { id: string }>,
      idToken,
      fbUser
    );
    return members;
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
    idToken: string,
    fbUser?: VerifiedFirebaseUser
  ): Promise<TenantMembership> {
    const payload = await this.attachTenantAccessMeta(
      tenantId,
      membership as unknown as Record<string, unknown>,
      idToken,
      fbUser
    );
    return setFirestoreDoc<TenantMembership>(`tenants/${tenantId}/members/${membership.id}`, payload as unknown as TenantMembership, idToken);
  }

  // --- BRANCHES ---
  public async getBranchesByTenant(
    tenantId: string,
    idToken: string,
    fbUser?: VerifiedFirebaseUser
  ): Promise<Branch[]> {
    const branches = await listTenantSubcollection<Branch>(`tenants/${tenantId}`, 'branches', idToken, fbUser);
    this.scheduleLegacyBackfill(
      tenantId,
      `tenants/${tenantId}/branches`,
      branches as unknown as Array<Record<string, unknown> & { id: string }>,
      idToken,
      fbUser
    );
    return branches;
  }

  public async saveBranch(
    tenantId: string,
    branch: Branch,
    idToken: string,
    fbUser?: VerifiedFirebaseUser
  ): Promise<Branch> {
    const payload = await this.attachTenantAccessMeta(
      tenantId,
      branch as unknown as Record<string, unknown>,
      idToken,
      fbUser
    );
    return setFirestoreDoc<Branch>(`tenants/${tenantId}/branches/${branch.id}`, payload as unknown as Branch, idToken);
  }

  // --- SERVICES ---
  public async getServicesByTenant(
    tenantId: string,
    idToken: string,
    fbUser?: VerifiedFirebaseUser
  ): Promise<Service[]> {
    const services = await listTenantSubcollection<Service>(`tenants/${tenantId}`, 'services', idToken, fbUser);
    this.scheduleLegacyBackfill(
      tenantId,
      `tenants/${tenantId}/services`,
      services as unknown as Array<Record<string, unknown> & { id: string }>,
      idToken,
      fbUser
    );
    return services;
  }

  public async saveService(
    tenantId: string,
    service: Service,
    idToken: string,
    fbUser?: VerifiedFirebaseUser
  ): Promise<Service> {
    const payload = await this.attachTenantAccessMeta(
      tenantId,
      service as unknown as Record<string, unknown>,
      idToken,
      fbUser
    );
    return setFirestoreDoc<Service>(`tenants/${tenantId}/services/${service.id}`, payload as unknown as Service, idToken);
  }

  // --- CUSTOMERS ---
  public async getCustomersByTenant(
    tenantId: string,
    idToken: string,
    fbUser?: VerifiedFirebaseUser
  ): Promise<Customer[]> {
    const customers = await listTenantSubcollection<Customer>(`tenants/${tenantId}`, 'customers', idToken, fbUser);
    this.scheduleLegacyBackfill(
      tenantId,
      `tenants/${tenantId}/customers`,
      customers as unknown as Array<Record<string, unknown> & { id: string }>,
      idToken,
      fbUser
    );
    return customers;
  }

  public async getCustomerById(tenantId: string, customerId: string, idToken: string): Promise<Customer | null> {
    return getFirestoreDoc<Customer>(`tenants/${tenantId}/customers/${customerId}`, idToken);
  }

  public async saveCustomer(
    tenantId: string,
    customer: Customer,
    idToken: string,
    fbUser?: VerifiedFirebaseUser
  ): Promise<Customer> {
    const payload = await this.attachTenantAccessMeta(
      tenantId,
      customer as unknown as Record<string, unknown>,
      idToken,
      fbUser
    );
    return setFirestoreDoc<Customer>(`tenants/${tenantId}/customers/${customer.id}`, payload as unknown as Customer, idToken);
  }

  // --- ORDERS ---
  public async getOrdersByTenant(
    tenantId: string,
    idToken: string,
    fbUser?: VerifiedFirebaseUser
  ): Promise<Array<Order & { items: OrderItem[]; customer?: Customer }>> {
    const [orders, customers] = await Promise.all([
      listTenantSubcollection<Order>(`tenants/${tenantId}`, 'orders', idToken, fbUser),
      listTenantSubcollection<Customer>(`tenants/${tenantId}`, 'customers', idToken, fbUser),
    ]);

    this.scheduleLegacyBackfill(
      tenantId,
      `tenants/${tenantId}/orders`,
      orders as unknown as Array<Record<string, unknown> & { id: string }>,
      idToken,
      fbUser
    );
    this.scheduleLegacyBackfill(
      tenantId,
      `tenants/${tenantId}/customers`,
      customers as unknown as Array<Record<string, unknown> & { id: string }>,
      idToken,
      fbUser
    );

    const customerMap = new Map(customers.map((c) => [c.id, c]));

    const enriched = await Promise.all(
      orders.map(async (order) => {
        const items = await listTenantSubcollection<OrderItem>(
          `tenants/${tenantId}/orders/${order.id}`,
          'items',
          idToken,
          fbUser
        ).catch(() => []);
        this.scheduleLegacyBackfill(
          tenantId,
          `tenants/${tenantId}/orders/${order.id}/items`,
          items as unknown as Array<Record<string, unknown> & { id: string }>,
          idToken,
          fbUser
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
    idToken: string,
    fbUser?: VerifiedFirebaseUser
  ): Promise<(Order & { items: OrderItem[]; customer?: Customer; history: OrderStatusHistory[] }) | null> {
    const order = await getFirestoreDoc<Order>(`tenants/${tenantId}/orders/${orderId}`, idToken);
    if (!order) return null;

    const [items, history, customer] = await Promise.all([
      listTenantSubcollection<OrderItem>(`tenants/${tenantId}/orders/${orderId}`, 'items', idToken, fbUser),
      listTenantSubcollection<OrderStatusHistory>(`tenants/${tenantId}/orders/${orderId}`, 'history', idToken, fbUser),
      getFirestoreDoc<Customer>(`tenants/${tenantId}/customers/${order.customerId}`, idToken),
    ]);

    return {
      ...order,
      items,
      history,
      customer: customer || undefined,
    };
  }

  public async saveOrder(
    tenantId: string,
    order: Order,
    idToken: string,
    fbUser?: VerifiedFirebaseUser
  ): Promise<Order> {
    // Strip virtual relations before saving to Firestore so strict rules allowlists pass
    const { items: _items, customer: _customer, history: _history, ...cleanOrder } = order as Order & {
      items?: unknown;
      customer?: unknown;
      history?: unknown;
    };
    const payload = await this.attachTenantAccessMeta(
      tenantId,
      cleanOrder as unknown as Record<string, unknown>,
      idToken,
      fbUser
    );
    return setFirestoreDoc<Order>(`tenants/${tenantId}/orders/${order.id}`, payload as unknown as Order, idToken);
  }

  public async saveOrderItem(
    tenantId: string,
    orderId: string,
    item: OrderItem,
    idToken: string,
    fbUser?: VerifiedFirebaseUser
  ): Promise<OrderItem> {
    const payload = await this.attachTenantAccessMeta(
      tenantId,
      item as unknown as Record<string, unknown>,
      idToken,
      fbUser
    );
    return setFirestoreDoc<OrderItem>(`tenants/${tenantId}/orders/${orderId}/items/${item.id}`, payload as unknown as OrderItem, idToken);
  }

  public async saveOrderHistory(
    tenantId: string,
    orderId: string,
    entry: OrderStatusHistory,
    idToken: string,
    fbUser?: VerifiedFirebaseUser
  ): Promise<OrderStatusHistory> {
    const payload = await this.attachTenantAccessMeta(
      tenantId,
      entry as unknown as Record<string, unknown>,
      idToken,
      fbUser
    );
    return setFirestoreDoc<OrderStatusHistory>(
      `tenants/${tenantId}/orders/${orderId}/history/${entry.id}`,
      payload as unknown as OrderStatusHistory,
      idToken
    );
  }

  // --- PAYMENTS ---
  public async getPaymentsByTenant(
    tenantId: string,
    idToken: string,
    fbUser?: VerifiedFirebaseUser
  ): Promise<Payment[]> {
    const payments = await listTenantSubcollection<Payment>(`tenants/${tenantId}`, 'payments', idToken, fbUser);
    this.scheduleLegacyBackfill(
      tenantId,
      `tenants/${tenantId}/payments`,
      payments as unknown as Array<Record<string, unknown> & { id: string }>,
      idToken,
      fbUser
    );
    return payments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public async savePayment(
    tenantId: string,
    payment: Payment,
    idToken: string,
    fbUser?: VerifiedFirebaseUser
  ): Promise<Payment> {
    const payload = await this.attachTenantAccessMeta(
      tenantId,
      payment as unknown as Record<string, unknown>,
      idToken,
      fbUser
    );
    return setFirestoreDoc<Payment>(`tenants/${tenantId}/payments/${payment.id}`, payload as unknown as Payment, idToken);
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
  public async getAuditLogs(
    tenantId: string,
    idToken: string,
    fbUser?: VerifiedFirebaseUser
  ): Promise<AuditLog[]> {
    const logs = await listTenantSubcollection<AuditLog>(`tenants/${tenantId}`, 'audit_logs', idToken, fbUser);
    return logs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public async getAllAdminAuditLogs(idToken: string, fbUser?: VerifiedFirebaseUser): Promise<AuditLog[]> {
    const tenants = await this.getTenants(idToken, fbUser);
    const logsPerTenant = await Promise.all(
      tenants.map((t) => listTenantSubcollection<AuditLog>(`tenants/${t.id}`, 'audit_logs', idToken, fbUser).catch(() => []))
    );
    return logsPerTenant
      .flat()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public async logAudit(
    log: Omit<AuditLog, 'id' | 'createdAt'>,
    idToken: string,
    fbUser?: VerifiedFirebaseUser
  ): Promise<AuditLog | null> {
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
    const payload = await this.attachTenantAccessMeta(
      log.tenantId,
      newLog as unknown as Record<string, unknown>,
      idToken,
      fbUser
    );
    return setFirestoreDoc<AuditLog>(`tenants/${log.tenantId}/audit_logs/${newLog.id}`, payload as unknown as AuditLog, idToken);
  }
}

export const firestoreRepo = new FirestoreRepository();
