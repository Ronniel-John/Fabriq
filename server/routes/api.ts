/**
 * LaundryOS - Server API Router
 * Multi-tenant business logic, authorization, calculations, and security validation.
 * Persists to provisioned Cloud Firestore when Firebase Auth ID Token is verified,
 * with local JSON fallback for unauthenticated sandbox demos.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { serverDb } from '../db.ts';
import { firestoreRepo, verifyFirebaseIdToken } from '../firestore.ts';
import {
  authenticateUser,
  requireAuth,
  requireTenant,
  requireRole,
  requireSuperAdmin,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import type {
  AuditLog,
  Branch,
  OrderStatus,
  PaymentMethod,
  Service,
  Subscription,
  TenantMembership,
  TenantStatus,
} from '../../src/types/database.ts';

const api = Router();

const asyncHandler =
  (fn: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as AuthenticatedRequest, res, next)).catch(next);
  };

// Apply user resolution to all API calls
api.use(authenticateUser);

async function recordAudit(req: AuthenticatedRequest, log: Omit<AuditLog, 'id' | 'createdAt'>): Promise<void> {
  serverDb.logAudit(log);
  if (req.firebaseIdToken && log.tenantId) {
    await firestoreRepo.logAudit(log, req.firebaseIdToken).catch((err) => {
      console.warn('Firestore audit log sync failed:', err instanceof Error ? err.message : err);
    });
  }
}

// ============================================================================
// 1. AUTH & SESSION APIS
// ============================================================================

/**
 * Login with email or demo persona ID.
 */
api.post(
  '/auth/login',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { email, personaId } = req.body;
    let user = personaId ? serverDb.getUserById(personaId) : null;

    if (!user && email) {
      user = serverDb.getUserByEmail(email);
    }

    if (!user) {
      res.status(401).json({
        error: 'Invalid credentials. User with this email does not exist.',
        code: 'INVALID_CREDENTIALS',
      });
      return;
    }

    const memberships = serverDb.getMembershipsByUser(user.id);
    let tenants = user.isSuperAdmin
      ? serverDb.getTenants()
      : memberships.map((m) => serverDb.getTenantById(m.tenantId)!).filter(Boolean);

    if (req.firebaseIdToken) {
      const fsTenants = await firestoreRepo.getTenants(req.firebaseIdToken, req.firebaseUser).catch(() => []);
      if (fsTenants.length > 0) {
        const allowedIds = new Set(tenants.map((t) => t.id));
        tenants = user.isSuperAdmin ? fsTenants : fsTenants.filter((t) => allowedIds.has(t.id));
      }
    }

    await recordAudit(req, {
      tenantId: memberships[0]?.tenantId || null,
      userId: user.id,
      action: 'USER_LOGIN',
      entityType: 'user',
      entityId: user.id,
      metadata: { method: personaId ? 'persona_quick_login' : 'email_password' },
      ipAddress: req.ip,
    });

    res.json({
      user,
      token: user.id,
      memberships,
      tenants,
      storageMode: req.firebaseIdToken ? 'firestore' : 'local_sandbox',
    });
  })
);

/**
 * Synchronize Google Firebase Auth user with Cloud Firestore & session.
 */
api.post('/auth/google-sync', async (req: AuthenticatedRequest, res) => {
  try {
    const { idToken: bodyToken, authUid, email, fullName, avatarUrl } = req.body;
    const token = (bodyToken as string | undefined) || req.firebaseIdToken;

    if (token) {
      const verified = await verifyFirebaseIdToken(token);
      if (!verified) {
        res.status(401).json({ error: 'Invalid or expired Firebase ID token' });
        return;
      }

      const synced = await firestoreRepo.syncAuthenticatedUserAndSeed(verified, token);

      await firestoreRepo
        .logAudit(
          {
            tenantId: synced.tenants[0]?.id || null,
            userId: synced.user.id,
            action: 'USER_LOGIN_GOOGLE',
            entityType: 'user',
            entityId: synced.user.id,
            metadata: { email: verified.email, authUid: verified.uid, backend: 'firestore' },
            ipAddress: req.ip,
          },
          token
        )
        .catch(() => {});

      res.json({
        user: synced.user,
        token: synced.user.id,
        memberships: synced.memberships,
        tenants: synced.tenants,
        storageMode: 'firestore',
      });
      return;
    }

    // Legacy fallback if no token provided
    if (!authUid || !email) {
      res.status(400).json({ error: 'Missing Firebase ID token, authUid, or email' });
      return;
    }

    let user = serverDb
      .getUsers()
      .find((u) => u.authUid === authUid || u.email.toLowerCase() === email.toLowerCase());

    if (user) {
      user.authUid = authUid;
      if (fullName) user.fullName = fullName;
      if (avatarUrl) user.avatarUrl = avatarUrl;
      user.updatedAt = new Date().toISOString();
    } else {
      const now = new Date().toISOString();
      user = {
        id: `u-google-${Date.now().toString().slice(-6)}`,
        authUid,
        email,
        fullName: fullName || email.split('@')[0],
        avatarUrl: avatarUrl || undefined,
        isSuperAdmin: false,
        createdAt: now,
        updatedAt: now,
      };
      serverDb.getState().users.push(user);

      const matchingOwnerTenants = serverDb
        .getTenants()
        .filter((t) => t.ownerEmail && t.ownerEmail.toLowerCase() === email.toLowerCase());

      if (matchingOwnerTenants.length > 0) {
        for (const t of matchingOwnerTenants) {
          serverDb.getState().tenant_memberships.push({
            id: `m-${Date.now()}-${t.id}`,
            tenantId: t.id,
            userId: user.id,
            role: 'owner',
            status: 'active',
            createdAt: now,
            updatedAt: now,
          });
        }
      } else {
        const defaultTenant = serverDb.getTenants()[0];
        if (defaultTenant) {
          serverDb.getState().tenant_memberships.push({
            id: `m-${Date.now()}`,
            tenantId: defaultTenant.id,
            userId: user.id,
            role: 'manager',
            status: 'active',
            createdAt: now,
            updatedAt: now,
          });
        }
      }
      serverDb.commitChanges();
    }

    const memberships = serverDb.getMembershipsByUser(user.id);
    const tenants = user.isSuperAdmin
      ? serverDb.getTenants()
      : memberships.map((m) => serverDb.getTenantById(m.tenantId)!).filter(Boolean);

    res.json({
      user,
      token: user.id,
      memberships,
      tenants,
      storageMode: 'local_sandbox',
    });
  } catch (err) {
    console.error('Google sync error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to synchronize Google user with Firestore',
    });
  }
});

/**
 * Logout route
 */
api.post(
  '/auth/logout',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (req.user) {
      await recordAudit(req, {
        tenantId: null,
        userId: req.user.id,
        action: 'USER_LOGOUT',
        entityType: 'user',
        entityId: req.user.id,
        ipAddress: req.ip,
      });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  })
);

/**
 * Get current session profile, active memberships, and accessible tenants.
 */
api.get('/auth/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user!;

    if (req.firebaseIdToken && req.firebaseUser && user.id === req.firebaseUser.uid) {
      const synced = await firestoreRepo.syncAuthenticatedUserAndSeed(req.firebaseUser, req.firebaseIdToken);
      res.json({
        user: synced.user,
        memberships: synced.memberships,
        tenants: synced.tenants,
        storageMode: 'firestore',
      });
      return;
    }

    const memberships = serverDb.getMembershipsByUser(user.id);
    let tenants = user.isSuperAdmin
      ? serverDb.getTenants()
      : memberships.map((m) => serverDb.getTenantById(m.tenantId)!).filter(Boolean);

    if (req.firebaseIdToken) {
      const fsTenants = await firestoreRepo.getTenants(req.firebaseIdToken, req.firebaseUser).catch(() => []);
      if (fsTenants.length > 0) {
        const allowedIds = new Set(tenants.map((t) => t.id));
        tenants = user.isSuperAdmin ? fsTenants : fsTenants.filter((t) => allowedIds.has(t.id));
      }
    }

    res.json({
      user,
      memberships,
      tenants,
      storageMode: req.firebaseIdToken ? 'firestore' : 'local_sandbox',
    });
  } catch (err) {
    console.error('/auth/me error:', err);
    res.status(500).json({ error: 'Failed to load user profile' });
  }
});

/**
 * List available demo personas for testing roles and tenant isolation.
 */
api.get('/auth/personas', (_req, res) => {
  const users = serverDb.getUsers();
  const personas = users.map((u) => {
    const memberships = serverDb.getMembershipsByUser(u.id);
    const tenantDetails = memberships.map((m) => {
      const t = serverDb.getTenantById(m.tenantId);
      return {
        tenantId: m.tenantId,
        tenantName: t?.name || 'Unknown',
        role: m.role,
      };
    });

    return {
      id: u.id,
      name: u.fullName,
      email: u.email,
      isSuperAdmin: u.isSuperAdmin,
      memberships: tenantDetails,
    };
  });

  res.json(personas);
});

// ============================================================================
// 2. TENANTS APIS (Tenant-Scoped)
// ============================================================================

/**
 * List accessible tenants for the logged in user.
 */
api.get('/tenants', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    if (req.firebaseIdToken) {
      const fsTenants = await firestoreRepo.getTenants(req.firebaseIdToken, req.firebaseUser).catch(() => []);
      if (fsTenants.length > 0) {
        if (req.user?.isSuperAdmin) {
          res.json(fsTenants);
          return;
        }
        const localMemIds = new Set(serverDb.getMembershipsByUser(req.user!.id).map((m) => m.tenantId));
        res.json(
          fsTenants.filter(
            (t) =>
              localMemIds.has(t.id) ||
              (t as { memberUids?: string[] }).memberUids?.includes(req.user!.authUid || req.user!.id) ||
              Boolean(t.ownerEmail && req.user?.email && t.ownerEmail.toLowerCase() === req.user.email.toLowerCase())
          )
        );
        return;
      }
    }

    if (req.user?.isSuperAdmin) {
      res.json(serverDb.getTenants());
      return;
    }
    const memberships = serverDb.getMembershipsByUser(req.user!.id);
    const userTenants = memberships.map((m) => serverDb.getTenantById(m.tenantId)).filter(Boolean);
    res.json(userTenants);
  } catch (err) {
    console.error('GET /tenants error:', err);
    res.status(500).json({ error: 'Failed to load tenants' });
  }
});

/**
 * Register / onboard a new laundry shop (Super Admin only).
 */
api.post('/tenants', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const {
      name,
      tradeName,
      slug: rawSlug,
      contactEmail,
      contactPhone,
      ownerEmail,
      branchName = 'Main Branch',
      branchAddress = 'Metro Manila, Philippines',
      plan = 'growth',
      status = 'active',
    } = req.body as {
      name?: string;
      tradeName?: string;
      slug?: string;
      contactEmail?: string;
      contactPhone?: string;
      ownerEmail?: string;
      branchName?: string;
      branchAddress?: string;
      plan?: 'starter' | 'growth' | 'enterprise';
      status?: 'trial' | 'active';
    };

    if (!name || !name.trim() || !contactEmail || !contactEmail.trim()) {
      res.status(400).json({ error: 'Shop name and contact email are required' });
      return;
    }

    const normalizedContactEmail = contactEmail.trim().toLowerCase();
    const normalizedOwnerEmail = ownerEmail?.trim().toLowerCase() || normalizedContactEmail;
    if (normalizedOwnerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedOwnerEmail)) {
      res.status(400).json({ error: 'Please enter a valid Owner Google Email address' });
      return;
    }

    const baseSlug = (rawSlug || name)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);

    if (!baseSlug) {
      res.status(400).json({ error: 'Valid shop slug is required' });
      return;
    }

    const existingLocal = serverDb.getTenantBySlug(baseSlug);
    const fsTenants = req.firebaseIdToken
      ? await firestoreRepo.getTenants(req.firebaseIdToken, req.firebaseUser).catch(() => [])
      : [];
    const existingFs = fsTenants.find((t) => t.slug === baseSlug);

    if (existingLocal || existingFs) {
      res.status(409).json({ error: `A laundry shop with slug "${baseSlug}" already exists.` });
      return;
    }

    const validPlan: 'starter' | 'growth' | 'enterprise' = ['starter', 'growth', 'enterprise'].includes(plan)
      ? plan
      : 'growth';
    const validStatus: 'trial' | 'active' = status === 'trial' ? 'trial' : 'active';
    const now = new Date().toISOString();
    const ownerUid = req.firebaseUser?.uid || req.user!.id;

    const newTenant = {
      id: `t-${baseSlug}-${crypto.randomUUID().slice(0, 8)}`,
      slug: baseSlug,
      name: name.trim().slice(0, 255),
      tradeName: (tradeName?.trim() || name.trim()).slice(0, 255),
      status: validStatus,
      contactEmail: contactEmail.trim().slice(0, 255),
      contactPhone: (contactPhone?.trim() || '+63 917 000 0000').slice(0, 64),
      ...(normalizedOwnerEmail ? { ownerEmail: normalizedOwnerEmail.slice(0, 255) } : {}),
      currency: 'PHP',
      createdAt: now,
      updatedAt: now,
    };

    const newBranch: Branch = {
      id: `b-${baseSlug}-01`,
      tenantId: newTenant.id,
      name: (branchName.trim() || 'Main Branch').slice(0, 255),
      code: 'MAIN-01',
      address: (branchAddress.trim() || 'Philippines').slice(0, 500),
      phone: (contactPhone?.trim() || '+63 917 000 0000').slice(0, 64),
      isMain: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    const newMembership: TenantMembership & { authUid?: string } = {
      id: ownerUid,
      tenantId: newTenant.id,
      userId: req.user!.id,
      authUid: ownerUid,
      role: 'owner',
      status: 'active',
      branchId: newBranch.id,
      createdAt: now,
      updatedAt: now,
    };

    const planFeeMap: Record<'starter' | 'growth' | 'enterprise', number> = {
      starter: 99900,
      growth: 249900,
      enterprise: 499900,
    };

    const trialEnd = new Date(Date.now() + 14 * 86400_000).toISOString();
    const periodEnd = new Date(Date.now() + 30 * 86400_000).toISOString();

    const newSubscription: Subscription = {
      id: `sub-${newTenant.id}`,
      tenantId: newTenant.id,
      plan: validPlan,
      status: validStatus,
      trialEndsAt: trialEnd,
      currentPeriodEnd: periodEnd,
      maxBranches: validPlan === 'enterprise' ? 10 : 1,
      maxStaff: validPlan === 'starter' ? 5 : validPlan === 'growth' ? 15 : 50,
      monthlyFeeCentavos: planFeeMap[validPlan],
      createdAt: now,
      updatedAt: now,
    };

    const starterService: Service = {
      id: `srv-${baseSlug}-01`,
      tenantId: newTenant.id,
      name: 'Regular Wash & Fold',
      category: 'Wash & Fold',
      pricingUnit: 'kg',
      unitPriceCentavos: 6500,
      minChargeCentavos: 19500,
      minQuantity: 3,
      defaultTurnaroundHours: 24,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    // Persist to Cloud Firestore first when authenticated with Firebase token
    if (req.firebaseIdToken) {
      await firestoreRepo.saveTenant(
        {
          ...newTenant,
          ownerUid,
          memberUids: [ownerUid],
        },
        req.firebaseIdToken
      );
      await firestoreRepo.saveMembership(newTenant.id, newMembership, req.firebaseIdToken);
      await firestoreRepo.saveBranch(newTenant.id, newBranch, req.firebaseIdToken);
      await firestoreRepo.saveSubscription(newSubscription, req.firebaseIdToken);
      await firestoreRepo.saveService(newTenant.id, starterService, req.firebaseIdToken);
    }

    // Update local JSON store after Firestore succeeds
    const localState = serverDb.getState();
    localState.tenants.push(newTenant);
    localState.branches.push(newBranch);
    localState.tenant_memberships.push({
      id: newMembership.id,
      tenantId: newMembership.tenantId,
      userId: newMembership.userId,
      role: newMembership.role,
      status: newMembership.status,
      branchId: newMembership.branchId,
      createdAt: now,
      updatedAt: now,
    });
    localState.subscriptions.push(newSubscription);
    localState.services.push(starterService);
    serverDb.commitChanges();

    await recordAudit(req, {
      tenantId: newTenant.id,
      userId: req.user!.id,
      action: 'TENANT_CREATED',
      entityType: 'tenant',
      entityId: newTenant.id,
      metadata: {
        name: newTenant.name,
        slug: newTenant.slug,
        plan: validPlan,
        status: validStatus,
        ownerEmail: normalizedOwnerEmail || null,
      },
      ipAddress: req.ip,
    });

    res.status(201).json({
      tenant: newTenant,
      branch: newBranch,
      subscription: newSubscription,
    });
  } catch (err) {
    console.error('POST /tenants error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to register new laundry shop' });
  }
});

/**
 * Update laundry shop operational status (Super Admin only).
 */
api.patch('/tenants/:tenantId/status', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId } = req.params;
    const { status } = req.body as { status?: TenantStatus };
    const allowed: TenantStatus[] = ['trial', 'active', 'past_due', 'suspended'];

    if (!status || !allowed.includes(status)) {
      res.status(400).json({ error: 'Invalid tenant status' });
      return;
    }

    let tenant = req.firebaseIdToken
      ? await firestoreRepo.getTenantById(tenantId, req.firebaseIdToken).catch(() => null)
      : null;
    if (!tenant) {
      tenant = serverDb.getTenantById(tenantId) || null;
    }
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const updated = {
      ...tenant,
      status,
      updatedAt: new Date().toISOString(),
    };

    const localTenant = serverDb.getTenantById(tenantId);
    if (localTenant) {
      localTenant.status = status;
      localTenant.updatedAt = updated.updatedAt;
      serverDb.commitChanges();
    }

    if (req.firebaseIdToken) {
      await firestoreRepo.saveTenant(updated, req.firebaseIdToken);
    }

    await recordAudit(req, {
      tenantId,
      userId: req.user!.id,
      action: 'TENANT_STATUS_UPDATED',
      entityType: 'tenant',
      entityId: tenantId,
      metadata: { newStatus: status },
      ipAddress: req.ip,
    });

    res.json({ tenant: updated });
  } catch (err) {
    console.error('PATCH /tenants/:tenantId/status error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update tenant status' });
  }
});

/**
 * Assign or update Shop Owner Google Email (Super Admin only).
 * When the owner logs in via Google Auth with this email, they auto-claim owner access.
 */
api.patch('/tenants/:tenantId/owner', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId } = req.params;
    const { ownerEmail } = req.body as { ownerEmail?: string };
    const normalized = (ownerEmail || '').trim().toLowerCase();

    if (normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      res.status(400).json({ error: 'Please enter a valid Google email address' });
      return;
    }

    let tenant = req.firebaseIdToken
      ? await firestoreRepo.getTenantById(tenantId, req.firebaseIdToken).catch(() => null)
      : null;
    if (!tenant) {
      tenant = serverDb.getTenantById(tenantId) || null;
    }
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const updatedAt = new Date().toISOString();
    const updated = {
      ...tenant,
      ownerEmail: normalized || null,
      updatedAt,
    };

    const localTenant = serverDb.getTenantById(tenantId);
    if (localTenant) {
      if (normalized) {
        localTenant.ownerEmail = normalized;
      } else {
        delete localTenant.ownerEmail;
      }
      localTenant.updatedAt = updatedAt;
      serverDb.commitChanges();
    }

    if (req.firebaseIdToken) {
      await firestoreRepo.saveTenant(updated as unknown as typeof tenant, req.firebaseIdToken);
    }

    await recordAudit(req, {
      tenantId,
      userId: req.user!.id,
      action: 'TENANT_OWNER_ASSIGNED',
      entityType: 'tenant',
      entityId: tenantId,
      metadata: { ownerEmail: normalized || null },
      ipAddress: req.ip,
    });

    res.json({
      tenant: {
        ...updated,
        ownerEmail: normalized || undefined,
      },
    });
  } catch (err) {
    console.error('PATCH /tenants/:tenantId/owner error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to assign shop owner email' });
  }
});

/**
 * Get single tenant info.
 */
api.get(
  '/tenants/:tenantId',
  requireTenant,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenant = req.tenant!;
    const branches = req.firebaseIdToken
      ? await firestoreRepo.getBranchesByTenant(tenant.id, req.firebaseIdToken).catch(() =>
          serverDb.getBranchesByTenant(tenant.id)
        )
      : serverDb.getBranchesByTenant(tenant.id);
    const subscription = req.firebaseIdToken
      ? (await firestoreRepo.getSubscriptionByTenant(tenant.id, req.firebaseIdToken).catch(() => undefined)) ||
        serverDb.getSubscriptionByTenant(tenant.id)
      : serverDb.getSubscriptionByTenant(tenant.id);
    const membership = req.membership;

    res.json({
      ...tenant,
      branches,
      subscription,
      currentRole: req.user?.isSuperAdmin ? 'super_admin' : membership?.role,
    });
  })
);

/**
 * Update tenant settings (Owners only).
 */
api.put(
  '/tenants/:tenantId',
  requireTenant,
  requireRole(['owner']),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenant = req.tenant!;
    const { name, tradeName, contactEmail, contactPhone } = req.body;

    if (name) tenant.name = String(name).trim().slice(0, 255);
    if (tradeName !== undefined) tenant.tradeName = String(tradeName).trim().slice(0, 255);
    if (contactEmail) tenant.contactEmail = String(contactEmail).trim().slice(0, 255);
    if (contactPhone) tenant.contactPhone = String(contactPhone).trim().slice(0, 64);
    tenant.updatedAt = new Date().toISOString();

    if (req.firebaseIdToken) {
      await firestoreRepo.saveTenant(tenant, req.firebaseIdToken);
    }
    const localTenant = serverDb.getTenantById(tenant.id);
    if (localTenant) {
      Object.assign(localTenant, tenant);
      serverDb.commitChanges();
    }

    await recordAudit(req, {
      tenantId: tenant.id,
      userId: req.user!.id,
      action: 'TENANT_SETTINGS_UPDATED',
      entityType: 'tenant',
      entityId: tenant.id,
      metadata: { updatedFields: req.body },
      ipAddress: req.ip,
    });

    res.json(tenant);
  })
);

/**
 * List staff and role assignments in tenant.
 */
api.get(
  '/tenants/:tenantId/members',
  requireTenant,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (req.firebaseIdToken) {
      const fsMembers = await firestoreRepo.getMembersByTenant(req.tenant!.id, req.firebaseIdToken);
      res.json(fsMembers);
      return;
    }
    const members = serverDb.getMembershipsByTenant(req.tenant!.id);
    res.json(members);
  })
);

/**
 * List branches for tenant.
 */
api.get(
  '/tenants/:tenantId/branches',
  requireTenant,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (req.firebaseIdToken) {
      const fsBranches = await firestoreRepo.getBranchesByTenant(req.tenant!.id, req.firebaseIdToken);
      res.json(fsBranches);
      return;
    }
    const branches = serverDb.getBranchesByTenant(req.tenant!.id);
    res.json(branches);
  })
);

/**
 * List services & pricing for tenant.
 */
api.get(
  '/tenants/:tenantId/services',
  requireTenant,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (req.firebaseIdToken) {
      const fsServices = await firestoreRepo.getServicesByTenant(req.tenant!.id, req.firebaseIdToken);
      res.json(fsServices);
      return;
    }
    const services = serverDb.getServicesByTenant(req.tenant!.id);
    res.json(services);
  })
);

/**
 * Create or configure a service (Owners & Managers only).
 */
api.post(
  '/tenants/:tenantId/services',
  requireTenant,
  requireRole(['owner', 'manager']),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { name, category, pricingUnit, unitPriceCentavos, minChargeCentavos, minQuantity, defaultTurnaroundHours } =
      req.body;

    if (!name || !pricingUnit || unitPriceCentavos === undefined) {
      res.status(400).json({ error: 'Missing required service fields' });
      return;
    }

    const normalizedUnit = pricingUnit === 'piece' ? 'piece' : 'kg';
    const now = new Date().toISOString();
    const newService: Service = {
      id: `srv-${req.tenant!.slug}-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: req.tenant!.id,
      name: String(name).trim().slice(0, 255),
      category: String(category || 'General').trim().slice(0, 128),
      pricingUnit: normalizedUnit,
      unitPriceCentavos: Math.max(0, Math.round(Number(unitPriceCentavos))),
      minChargeCentavos: Math.max(0, Math.round(Number(minChargeCentavos || 0))),
      minQuantity: Math.max(0.1, Number(minQuantity || 1)),
      defaultTurnaroundHours: Math.max(1, Math.round(Number(defaultTurnaroundHours || 24))),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    if (req.firebaseIdToken) {
      await firestoreRepo.saveService(req.tenant!.id, newService, req.firebaseIdToken);
    }

    serverDb.getState().services.push(newService);
    serverDb.commitChanges();

    await recordAudit(req, {
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      action: 'SERVICE_CREATED',
      entityType: 'service',
      entityId: newService.id,
      metadata: { name: newService.name, unitPriceCentavos: newService.unitPriceCentavos },
      ipAddress: req.ip,
    });

    res.status(201).json(newService);
  })
);

// ============================================================================
// 3. CUSTOMER APIS (Tenant-Scoped)
// ============================================================================

/**
 * List customers for tenant.
 */
api.get(
  '/tenants/:tenantId/customers',
  requireTenant,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (req.firebaseIdToken) {
      const fsCustomers = await firestoreRepo.getCustomersByTenant(req.tenant!.id, req.firebaseIdToken);
      res.json(fsCustomers);
      return;
    }
    const customers = serverDb.getCustomersByTenant(req.tenant!.id);
    res.json(customers);
  })
);

/**
 * Create customer in tenant.
 */
api.post(
  '/tenants/:tenantId/customers',
  requireTenant,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { name, mobile, email, address, customerType, washPreferences, notes, branchId } = req.body as {
      name?: string;
      mobile?: string;
      email?: string;
      address?: string;
      customerType?: 'walk_in' | 'pickup_delivery' | 'corporate';
      washPreferences?: string;
      notes?: string;
      branchId?: string;
    };

    if (!name?.trim() || !mobile?.trim()) {
      res.status(400).json({ error: 'Name and mobile number are required' });
      return;
    }

    const validCustomerTypes = ['walk_in', 'pickup_delivery', 'corporate'] as const;
    const resolvedType =
      customerType && validCustomerTypes.includes(customerType) ? customerType : 'walk_in';

    const branches = req.firebaseIdToken
      ? await firestoreRepo.getBranchesByTenant(req.tenant!.id, req.firebaseIdToken).catch(() =>
          serverDb.getBranchesByTenant(req.tenant!.id)
        )
      : serverDb.getBranchesByTenant(req.tenant!.id);
    const targetBranchId =
      (branchId && branches.some((b) => b.id === branchId) ? branchId : branches[0]?.id) ||
      `b-${req.tenant!.slug}-01`;

    const customer = serverDb.createCustomer(req.tenant!.id, {
      branchId: targetBranchId,
      name: name.trim().slice(0, 255),
      mobile: mobile.trim().slice(0, 64),
      email: email?.trim() ? email.trim().slice(0, 255) : undefined,
      address: address?.trim() ? address.trim().slice(0, 500) : undefined,
      customerType: resolvedType,
      washPreferences: washPreferences?.trim() ? washPreferences.trim().slice(0, 500) : undefined,
      notes: notes?.trim() ? notes.trim().slice(0, 1000) : undefined,
    });

    if (req.firebaseIdToken) {
      await firestoreRepo.saveCustomer(req.tenant!.id, customer, req.firebaseIdToken);
    }

    await recordAudit(req, {
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      action: 'CUSTOMER_CREATED',
      entityType: 'customer',
      entityId: customer.id,
      metadata: { name: customer.name, mobile: customer.mobile, customerType: resolvedType },
      ipAddress: req.ip,
    });

    res.status(201).json(customer);
  })
);

/**
 * Update existing customer profile in tenant.
 */
api.put(
  '/tenants/:tenantId/customers/:customerId',
  requireTenant,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { customerId } = req.params;
    const { name, mobile, email, address, customerType, washPreferences, notes, branchId } = req.body as {
      name?: string;
      mobile?: string;
      email?: string;
      address?: string;
      customerType?: 'walk_in' | 'pickup_delivery' | 'corporate';
      washPreferences?: string;
      notes?: string;
      branchId?: string;
    };

    let existing = req.firebaseIdToken
      ? await firestoreRepo.getCustomerById(req.tenant!.id, customerId, req.firebaseIdToken).catch(() => null)
      : null;
    if (!existing) {
      existing = serverDb.getCustomerById(req.tenant!.id, customerId) || null;
    }
    if (!existing) {
      res.status(404).json({ error: 'Customer not found in this tenant' });
      return;
    }

    const nextName = name !== undefined ? name.trim().slice(0, 255) : existing.name;
    const nextMobile = mobile !== undefined ? mobile.trim().slice(0, 64) : existing.mobile;
    if (!nextName || !nextMobile) {
      res.status(400).json({ error: 'Name and mobile number are required' });
      return;
    }

    const validCustomerTypes = ['walk_in', 'pickup_delivery', 'corporate'] as const;
    const nextType =
      customerType && validCustomerTypes.includes(customerType)
        ? customerType
        : existing.customerType || 'walk_in';

    const updated = {
      ...existing,
      branchId: branchId?.trim() || existing.branchId,
      name: nextName,
      mobile: nextMobile,
      email: email !== undefined ? (email.trim() ? email.trim().slice(0, 255) : undefined) : existing.email,
      address: address !== undefined ? (address.trim() ? address.trim().slice(0, 500) : undefined) : existing.address,
      customerType: nextType,
      washPreferences:
        washPreferences !== undefined
          ? washPreferences.trim()
            ? washPreferences.trim().slice(0, 500)
            : undefined
          : existing.washPreferences,
      notes: notes !== undefined ? (notes.trim() ? notes.trim().slice(0, 1000) : undefined) : existing.notes,
      updatedAt: new Date().toISOString(),
    };

    if (req.firebaseIdToken) {
      await firestoreRepo.saveCustomer(req.tenant!.id, updated, req.firebaseIdToken);
    }

    const localCust = serverDb.getCustomerById(req.tenant!.id, customerId);
    if (localCust) {
      Object.assign(localCust, updated);
      serverDb.commitChanges();
    }

    await recordAudit(req, {
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      action: 'CUSTOMER_UPDATED',
      entityType: 'customer',
      entityId: customerId,
      metadata: { name: updated.name, mobile: updated.mobile },
      ipAddress: req.ip,
    });

    res.json(updated);
  })
);

// ============================================================================
// 4. ORDERS & CALCULATIONS APIS (Tenant-Scoped)
// ============================================================================

/**
 * List orders for tenant.
 */
api.get(
  '/tenants/:tenantId/orders',
  requireTenant,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (req.firebaseIdToken) {
      const fsOrders = await firestoreRepo.getOrdersByTenant(req.tenant!.id, req.firebaseIdToken);
      res.json(fsOrders);
      return;
    }
    const orders = serverDb.getOrdersByTenant(req.tenant!.id);
    res.json(orders);
  })
);

/**
 * Get single order with history.
 */
api.get(
  '/tenants/:tenantId/orders/:orderId',
  requireTenant,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const order = req.firebaseIdToken
      ? await firestoreRepo.getOrderById(req.tenant!.id, req.params.orderId, req.firebaseIdToken)
      : serverDb.getOrderById(req.tenant!.id, req.params.orderId);

    if (!order) {
      res.status(404).json({ error: 'Order not found in this tenant' });
      return;
    }
    res.json(order);
  })
);

/**
 * Create order with server-side calculation and price snapshots.
 */
api.post(
  '/tenants/:tenantId/orders',
  requireTenant,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { customerId, branchId, items, discountCentavos = 0, expressFeeCentavos = 0, notes, expectedHours = 24 } =
      req.body;

    if (!customerId || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Customer and at least one line item required' });
      return;
    }

    const customer = req.firebaseIdToken
      ? (await firestoreRepo.getCustomerById(req.tenant!.id, customerId, req.firebaseIdToken).catch(() => null)) ||
        serverDb.getCustomerById(req.tenant!.id, customerId)
      : serverDb.getCustomerById(req.tenant!.id, customerId);

    if (!customer) {
      res.status(400).json({ error: 'Customer not found in this tenant' });
      return;
    }

    const branches = req.firebaseIdToken
      ? await firestoreRepo.getBranchesByTenant(req.tenant!.id, req.firebaseIdToken).catch(() =>
          serverDb.getBranchesByTenant(req.tenant!.id)
        )
      : serverDb.getBranchesByTenant(req.tenant!.id);
    const targetBranch = branches.find((b) => b.id === branchId) || branches[0];
    const targetBranchId = targetBranch?.id || customer.branchId || `b-${req.tenant!.slug}-01`;

    const services = req.firebaseIdToken
      ? await firestoreRepo.getServicesByTenant(req.tenant!.id, req.firebaseIdToken).catch(() =>
          serverDb.getServicesByTenant(req.tenant!.id)
        )
      : serverDb.getServicesByTenant(req.tenant!.id);

    let calculatedSubtotal = 0;
    const orderId = `ord-${req.tenant!.slug}-${crypto.randomUUID().slice(0, 8)}`;
    const orderItems = [];

    for (const item of items) {
      const service = services.find((s) => s.id === item.serviceId);
      if (!service) {
        res.status(400).json({ error: `Service ID ${item.serviceId} not found in this tenant` });
        return;
      }

      const qty = Number(item.quantity);
      if (isNaN(qty) || qty <= 0) {
        res.status(400).json({ error: 'Invalid quantity' });
        return;
      }

      let itemSubtotal = Math.round(qty * service.unitPriceCentavos);
      if (service.minChargeCentavos && itemSubtotal < service.minChargeCentavos) {
        itemSubtotal = service.minChargeCentavos;
      }

      calculatedSubtotal += itemSubtotal;

      orderItems.push({
        id: `item-${crypto.randomUUID().slice(0, 8)}`,
        orderId,
        serviceId: service.id,
        serviceNameSnapshot: service.name.slice(0, 255),
        pricingUnitSnapshot: service.pricingUnit,
        unitPriceCentavosSnapshot: service.unitPriceCentavos,
        quantity: qty,
        subtotalCentavos: itemSubtotal,
        notes: String(item.notes || '').slice(0, 500),
      });
    }

    const discount = Math.max(0, Math.round(Number(discountCentavos) || 0));
    const expressFee = Math.max(0, Math.round(Number(expressFeeCentavos) || 0));
    const total = Math.max(0, calculatedSubtotal - discount + expressFee);

    const now = new Date();
    const readyTime = new Date(now.getTime() + (Number(expectedHours) || 24) * 3600000);
    const orderNumber = `${req.tenant!.slug.toUpperCase().slice(0, 3)}-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const newOrder = {
      id: orderId,
      tenantId: req.tenant!.id,
      branchId: targetBranchId,
      customerId: customer.id,
      orderNumber,
      status: 'received' as OrderStatus,
      paymentStatus: 'unpaid' as const,
      subtotalCentavos: calculatedSubtotal,
      discountCentavos: discount,
      expressFeeCentavos: expressFee,
      totalCentavos: total,
      paidCentavos: 0,
      balanceCentavos: total,
      notes: String(notes || '').slice(0, 1000),
      expectedReadyAt: readyTime.toISOString(),
      createdByUserId: req.user!.id,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    const initialHistory = {
      id: `hist-${crypto.randomUUID().slice(0, 8)}`,
      orderId: newOrder.id,
      tenantId: req.tenant!.id,
      fromStatus: null,
      toStatus: 'received' as OrderStatus,
      changedByUserId: req.user!.id,
      notes: 'Order initiated at counter POS',
      timestamp: now.toISOString(),
    };

    customer.totalOrders = (customer.totalOrders || 0) + 1;
    customer.outstandingBalanceCentavos = (customer.outstandingBalanceCentavos || 0) + total;
    customer.updatedAt = now.toISOString();

    if (req.firebaseIdToken) {
      await firestoreRepo.saveOrder(req.tenant!.id, newOrder, req.firebaseIdToken);
      for (const item of orderItems) {
        await firestoreRepo.saveOrderItem(req.tenant!.id, newOrder.id, item, req.firebaseIdToken);
      }
      await firestoreRepo.saveOrderHistory(req.tenant!.id, newOrder.id, initialHistory, req.firebaseIdToken);
      await firestoreRepo.saveCustomer(req.tenant!.id, customer, req.firebaseIdToken);
    }

    const state = serverDb.getState();
    state.orders.unshift(newOrder);
    state.order_items.push(...orderItems);
    state.order_status_history.push(initialHistory);
    const localCust = serverDb.getCustomerById(req.tenant!.id, customer.id);
    if (localCust) Object.assign(localCust, customer);
    serverDb.commitChanges();

    await recordAudit(req, {
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      action: 'ORDER_CREATED',
      entityType: 'order',
      entityId: newOrder.id,
      metadata: {
        orderNumber,
        totalCentavos: total,
        itemCount: orderItems.length,
      },
      ipAddress: req.ip,
    });

    res.status(201).json({
      ...newOrder,
      items: orderItems,
      customer,
    });
  })
);

/**
 * Update order processing status.
 */
api.post(
  '/tenants/:tenantId/orders/:orderId/status',
  requireTenant,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { newStatus, notes } = req.body;
    const order = req.firebaseIdToken
      ? (await firestoreRepo.getOrderById(req.tenant!.id, req.params.orderId, req.firebaseIdToken).catch(() => null)) ||
        serverDb.getOrderById(req.tenant!.id, req.params.orderId)
      : serverDb.getOrderById(req.tenant!.id, req.params.orderId);

    if (!order) {
      res.status(404).json({ error: 'Order not found in this tenant' });
      return;
    }

    if ((order.status === 'cancelled' || order.status === 'released') && !req.user?.isSuperAdmin) {
      res.status(400).json({ error: `Order is already in terminal status "${order.status}" and cannot be transitioned.` });
      return;
    }

    const validStatuses: OrderStatus[] = [
      'received',
      'washing',
      'drying',
      'folding',
      'ready_for_pickup',
      'released',
      'cancelled',
    ];

    if (!validStatuses.includes(newStatus)) {
      res.status(400).json({ error: `Invalid status: ${newStatus}` });
      return;
    }

    const oldStatus = order.status;
    const now = new Date().toISOString();

    const updatedOrder = { ...order, status: newStatus as OrderStatus, updatedAt: now };

    const historyEntry = {
      id: `hist-${crypto.randomUUID().slice(0, 8)}`,
      orderId: updatedOrder.id,
      tenantId: req.tenant!.id,
      fromStatus: oldStatus,
      toStatus: newStatus as OrderStatus,
      changedByUserId: req.user!.id,
      notes: String(notes || `Status changed from ${oldStatus} to ${newStatus}`).slice(0, 500),
      timestamp: now,
    };

    if (req.firebaseIdToken) {
      await firestoreRepo.saveOrder(req.tenant!.id, updatedOrder, req.firebaseIdToken);
      await firestoreRepo.saveOrderHistory(req.tenant!.id, updatedOrder.id, historyEntry, req.firebaseIdToken);
    }

    const localOrder = serverDb.getState().orders.find((o) => o.id === order.id);
    if (localOrder) {
      localOrder.status = newStatus;
      localOrder.updatedAt = now;
    }
    serverDb.getState().order_status_history.push(historyEntry);
    serverDb.commitChanges();

    await recordAudit(req, {
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      action: 'ORDER_STATUS_CHANGED',
      entityType: 'order',
      entityId: updatedOrder.id,
      metadata: { fromStatus: oldStatus, toStatus: newStatus, notes: historyEntry.notes },
      ipAddress: req.ip,
    });

    res.json({
      order: updatedOrder,
      historyEntry,
    });
  })
);

// ============================================================================
// 5. PAYMENTS & FINANCIAL APIS (Tenant-Scoped)
// ============================================================================

/**
 * List tenant payments.
 */
api.get(
  '/tenants/:tenantId/payments',
  requireTenant,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (req.firebaseIdToken) {
      const fsPayments = await firestoreRepo.getPaymentsByTenant(req.tenant!.id, req.firebaseIdToken);
      res.json(fsPayments);
      return;
    }
    const payments = serverDb.getPaymentsByTenant(req.tenant!.id);
    res.json(payments);
  })
);

/**
 * Collect cash or QR Ph payment against an order.
 */
api.post(
  '/tenants/:tenantId/orders/:orderId/payments',
  requireTenant,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { amountCentavos, method, referenceNumber, notes } = req.body as {
      amountCentavos?: number;
      method?: string;
      referenceNumber?: string;
      notes?: string;
    };

    const order = req.firebaseIdToken
      ? (await firestoreRepo.getOrderById(req.tenant!.id, req.params.orderId, req.firebaseIdToken).catch(() => null)) ||
        serverDb.getOrderById(req.tenant!.id, req.params.orderId)
      : serverDb.getOrderById(req.tenant!.id, req.params.orderId);

    if (!order) {
      res.status(404).json({ error: 'Order not found in this tenant' });
      return;
    }

    if (order.status === 'cancelled') {
      res.status(400).json({ error: 'Cannot record payment against a cancelled order' });
      return;
    }

    const amount = Math.round(Number(amountCentavos));
    if (isNaN(amount) || amount <= 0) {
      res.status(400).json({ error: 'Payment amount must be greater than zero' });
      return;
    }

    if (amount > order.balanceCentavos) {
      res.status(400).json({
        error: `Payment amount (₱${(amount / 100).toFixed(2)}) exceeds outstanding balance (₱${(order.balanceCentavos / 100).toFixed(2)})`,
      });
      return;
    }

    const validMethods: PaymentMethod[] = ['cash', 'qr_ph', 'card', 'other'];
    const resolvedMethod: PaymentMethod = validMethods.includes(method as PaymentMethod)
      ? (method as PaymentMethod)
      : 'cash';

    const now = new Date().toISOString();
    const cleanRef =
      referenceNumber && String(referenceNumber).trim()
        ? String(referenceNumber).trim().slice(0, 128)
        : `${resolvedMethod.toUpperCase()}-${Date.now().toString().slice(-6)}`;

    const paymentRecord = {
      id: `pay-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: req.tenant!.id,
      orderId: order.id,
      amountCentavos: amount,
      method: resolvedMethod,
      referenceNumber: cleanRef,
      cashierUserId: req.user!.id,
      notes: String(notes || '').slice(0, 500),
      createdAt: now,
    };

    const newPaid = (order.paidCentavos || 0) + amount;
    const newBalance = Math.max(0, order.totalCentavos - newPaid);
    const updatedOrder = {
      ...order,
      paidCentavos: newPaid,
      balanceCentavos: newBalance,
      paymentStatus: (newBalance === 0 ? 'paid' : 'partial') as 'paid' | 'partial',
      updatedAt: now,
    };

    const customer = req.firebaseIdToken
      ? (await firestoreRepo.getCustomerById(req.tenant!.id, order.customerId, req.firebaseIdToken).catch(() => null)) ||
        serverDb.getCustomerById(req.tenant!.id, order.customerId)
      : serverDb.getCustomerById(req.tenant!.id, order.customerId);

    if (customer) {
      customer.outstandingBalanceCentavos = Math.max(0, (customer.outstandingBalanceCentavos || 0) - amount);
      customer.updatedAt = now;
    }

    if (req.firebaseIdToken) {
      await firestoreRepo.savePayment(req.tenant!.id, paymentRecord, req.firebaseIdToken);
      await firestoreRepo.saveOrder(req.tenant!.id, updatedOrder, req.firebaseIdToken);
      if (customer) {
        await firestoreRepo.saveCustomer(req.tenant!.id, customer, req.firebaseIdToken);
      }
    }

    serverDb.getState().payments.push(paymentRecord);
    const localOrder = serverDb.getState().orders.find((o) => o.id === order.id);
    if (localOrder) {
      localOrder.paidCentavos = newPaid;
      localOrder.balanceCentavos = newBalance;
      localOrder.paymentStatus = updatedOrder.paymentStatus;
      localOrder.updatedAt = now;
    }
    const localCustomer = serverDb.getCustomerById(req.tenant!.id, order.customerId);
    if (localCustomer && customer) {
      localCustomer.outstandingBalanceCentavos = customer.outstandingBalanceCentavos;
      localCustomer.updatedAt = now;
    }
    serverDb.commitChanges();

    await recordAudit(req, {
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      action: 'PAYMENT_COLLECTED',
      entityType: 'payment',
      entityId: paymentRecord.id,
      metadata: {
        orderId: updatedOrder.id,
        amountCentavos: amount,
        method: paymentRecord.method,
        referenceNumber: paymentRecord.referenceNumber,
        newBalanceCentavos: updatedOrder.balanceCentavos,
      },
      ipAddress: req.ip,
    });

    const { items: _items, customer: _customer, history: _history, ...cleanOrderResponse } = updatedOrder as typeof updatedOrder & {
      items?: unknown;
      customer?: unknown;
      history?: unknown;
    };

    res.status(201).json({
      payment: paymentRecord,
      order: cleanOrderResponse,
    });
  })
);

/**
 * Get tenant QR Ph & store payment presentation settings.
 */
api.get(
  '/tenants/:tenantId/qr-settings',
  requireTenant,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    let tenant = req.tenant;
    if (req.firebaseIdToken && tenant) {
      const fsTenant = await firestoreRepo.getTenantById(tenant.id, req.firebaseIdToken).catch(() => null);
      if (fsTenant) tenant = fsTenant;
    }

    res.json({
      qrSettings: tenant?.qrSettings || null,
      tenantName: tenant?.name,
      currency: tenant?.currency || 'PHP',
    });
  })
);

/**
 * Update tenant QR code image and presentation details (Owner & Manager only).
 */
api.put(
  '/tenants/:tenantId/qr-settings',
  requireTenant,
  requireRole(['owner', 'manager']),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { qrCodeImageUrl, merchantName, accountName, accountNumber, provider, notes } = req.body;

    if (!qrCodeImageUrl) {
      res.status(400).json({ error: 'QR Code image or data URL is required' });
      return;
    }

    if (typeof qrCodeImageUrl === 'string' && qrCodeImageUrl.length > 740000) {
      res.status(400).json({
        error: 'QR Code image is too large for Firestore document storage. Please upload an image under 700KB.',
      });
      return;
    }

    const allowedProviders = ['qr_ph', 'gcash', 'maya', 'bank', 'other'] as const;
    const resolvedProvider = allowedProviders.includes(provider) ? provider : 'qr_ph';

    const qrSettings = {
      qrCodeImageUrl,
      merchantName: String(merchantName || req.tenant!.name).slice(0, 255),
      accountName: String(accountName || '').slice(0, 255),
      accountNumber: String(accountNumber || '').slice(0, 128),
      provider: resolvedProvider,
      notes: String(notes || '').slice(0, 1000),
      updatedAt: new Date().toISOString(),
    };

    const tenantToSave = {
      ...req.tenant!,
      qrSettings,
      updatedAt: new Date().toISOString(),
    };

    if (req.firebaseIdToken) {
      await firestoreRepo.saveTenant(tenantToSave, req.firebaseIdToken);
    }

    const updatedTenant = serverDb.updateTenantQrSettings(req.tenant!.id, qrSettings) || tenantToSave;

    await recordAudit(req, {
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      action: 'TENANT_QR_UPDATED',
      entityType: 'tenant',
      entityId: req.tenant!.id,
      metadata: {
        provider: resolvedProvider,
        merchantName: qrSettings.merchantName,
        hasCustomImage: true,
      },
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      qrSettings: updatedTenant.qrSettings,
      tenant: updatedTenant,
    });
  })
);

// ============================================================================
// 6. AUDIT LOGS & DIAGNOSTICS APIS
// ============================================================================

/**
 * Tenant audit logs (Owners & Managers only).
 */
api.get(
  '/tenants/:tenantId/audit-logs',
  requireTenant,
  requireRole(['owner', 'manager']),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (req.firebaseIdToken) {
      const fsLogs = await firestoreRepo.getAuditLogs(req.tenant!.id, req.firebaseIdToken);
      res.json(fsLogs);
      return;
    }
    const logs = serverDb.getAuditLogs(req.tenant!.id);
    res.json(logs);
  })
);

/**
 * Super Admin all audit logs.
 */
api.get(
  '/admin/audit-logs',
  requireSuperAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (req.firebaseIdToken) {
      const fsLogs = await firestoreRepo.getAllAdminAuditLogs(req.firebaseIdToken, req.firebaseUser);
      res.json(fsLogs);
      return;
    }
    const logs = serverDb.getAuditLogs();
    res.json(logs);
  })
);

/**
 * Interactive Database Schema Inspector.
 */
api.get('/system/schema', (_req, res) => {
  const tables = [
    {
      tableName: 'tenants',
      description: 'Independent business tenants with status, slug, QR settings, and contact credentials',
      columns: [
        { name: 'id', type: 'UUID', key: 'PRIMARY KEY', nullable: false },
        { name: 'slug', type: 'VARCHAR(64)', key: 'UNIQUE', nullable: false },
        { name: 'name', type: 'VARCHAR(255)', nullable: false },
        { name: 'trade_name', type: 'VARCHAR(255)', nullable: true },
        { name: 'status', type: 'VARCHAR(32)', check: "('trial', 'active', 'past_due', 'suspended')" },
        { name: 'contact_email', type: 'VARCHAR(255)', nullable: false },
        { name: 'currency', type: 'VARCHAR(8)', default: 'PHP' },
        { name: 'created_at', type: 'TIMESTAMPTZ' },
      ],
      recordCount: serverDb.getState().tenants.length,
    },
    {
      tableName: 'branches',
      description: 'Physical laundry drop-off and washing branch locations per tenant',
      columns: [
        { name: 'id', type: 'UUID', key: 'PRIMARY KEY' },
        { name: 'tenant_id', type: 'UUID', key: 'FOREIGN KEY -> tenants(id)' },
        { name: 'name', type: 'VARCHAR(255)' },
        { name: 'code', type: 'VARCHAR(32)', key: 'UNIQUE(tenant_id, code)' },
        { name: 'address', type: 'TEXT' },
        { name: 'is_main', type: 'BOOLEAN', default: true },
      ],
      recordCount: serverDb.getState().branches.length,
    },
    {
      tableName: 'users',
      description: 'Platform users authenticated via Firebase Auth UID',
      columns: [
        { name: 'id', type: 'UUID', key: 'PRIMARY KEY' },
        { name: 'auth_uid', type: 'VARCHAR(128)', key: 'UNIQUE (Firebase UID)' },
        { name: 'email', type: 'VARCHAR(255)', key: 'UNIQUE' },
        { name: 'full_name', type: 'VARCHAR(255)' },
        { name: 'is_super_admin', type: 'BOOLEAN', default: false },
      ],
      recordCount: serverDb.getState().users.length,
    },
    {
      tableName: 'tenant_memberships',
      description: 'User roles and tenant associations (RBAC)',
      columns: [
        { name: 'id', type: 'UUID', key: 'PRIMARY KEY' },
        { name: 'tenant_id', type: 'UUID', key: 'FOREIGN KEY -> tenants(id)' },
        { name: 'user_id', type: 'UUID', key: 'FOREIGN KEY -> users(id)' },
        { name: 'role', type: 'VARCHAR(32)', check: "('owner', 'manager', 'cashier', 'staff')" },
        { name: 'status', type: 'VARCHAR(32)', check: "('active', 'invited', 'suspended')" },
      ],
      recordCount: serverDb.getState().tenant_memberships.length,
    },
    {
      tableName: 'subscriptions',
      description: 'SaaS subscription status, branch/staff caps, and billing terms',
      columns: [
        { name: 'id', type: 'UUID', key: 'PRIMARY KEY' },
        { name: 'tenant_id', type: 'UUID', key: 'FOREIGN KEY -> tenants(id)' },
        { name: 'plan', type: 'VARCHAR(32)', check: "('starter', 'growth', 'enterprise')" },
        { name: 'status', type: 'VARCHAR(32)', check: "('trial', 'active', 'past_due', 'cancelled')" },
        { name: 'monthly_fee_centavos', type: 'INT', note: 'Integer centavos' },
      ],
      recordCount: serverDb.getState().subscriptions.length,
    },
    {
      tableName: 'customers',
      description: 'Customer profiles strictly isolated per tenant',
      columns: [
        { name: 'id', type: 'UUID', key: 'PRIMARY KEY' },
        { name: 'tenant_id', type: 'UUID', key: 'FOREIGN KEY -> tenants(id)' },
        { name: 'name', type: 'VARCHAR(255)' },
        { name: 'mobile', type: 'VARCHAR(32)', key: 'UNIQUE(tenant_id, mobile)' },
        { name: 'outstanding_balance_centavos', type: 'INT', check: '>= 0' },
      ],
      recordCount: serverDb.getState().customers.length,
    },
    {
      tableName: 'services',
      description: 'Configurable laundry services with kg or piece pricing and minimum charges',
      columns: [
        { name: 'id', type: 'UUID', key: 'PRIMARY KEY' },
        { name: 'tenant_id', type: 'UUID', key: 'FOREIGN KEY -> tenants(id)' },
        { name: 'name', type: 'VARCHAR(255)' },
        { name: 'pricing_unit', type: 'VARCHAR(16)', check: "('kg', 'piece')" },
        { name: 'unit_price_centavos', type: 'INT', check: '>= 0' },
        { name: 'min_charge_centavos', type: 'INT', check: '>= 0' },
      ],
      recordCount: serverDb.getState().services.length,
    },
    {
      tableName: 'orders',
      description: 'Laundry order lifecycles, totals in centavos, and status flags',
      columns: [
        { name: 'id', type: 'UUID', key: 'PRIMARY KEY' },
        { name: 'tenant_id', type: 'UUID', key: 'FOREIGN KEY -> tenants(id)' },
        { name: 'customer_id', type: 'UUID', key: 'FOREIGN KEY -> customers(id)' },
        { name: 'order_number', type: 'VARCHAR(64)', key: 'UNIQUE(tenant_id, order_number)' },
        {
          name: 'status',
          type: 'VARCHAR(32)',
          check: "('received', 'washing', 'drying', 'folding', 'ready_for_pickup', 'released', 'cancelled')",
        },
        { name: 'payment_status', type: 'VARCHAR(32)', check: "('unpaid', 'partial', 'paid')" },
        { name: 'total_centavos', type: 'INT', check: '>= 0' },
        { name: 'balance_centavos', type: 'INT', check: '>= 0' },
      ],
      recordCount: serverDb.getState().orders.length,
    },
    {
      tableName: 'order_items',
      description: 'Line items with historical price snapshots',
      columns: [
        { name: 'id', type: 'UUID', key: 'PRIMARY KEY' },
        { name: 'order_id', type: 'UUID', key: 'FOREIGN KEY -> orders(id)' },
        { name: 'service_name_snapshot', type: 'VARCHAR(255)' },
        { name: 'unit_price_centavos_snapshot', type: 'INT' },
        { name: 'quantity', type: 'NUMERIC(8,2)', check: '> 0' },
        { name: 'subtotal_centavos', type: 'INT', check: '>= 0' },
      ],
      recordCount: serverDb.getState().order_items.length,
    },
    {
      tableName: 'order_status_history',
      description: 'Immutable timestamped audit trail of status progression',
      columns: [
        { name: 'id', type: 'UUID', key: 'PRIMARY KEY' },
        { name: 'order_id', type: 'UUID', key: 'FOREIGN KEY -> orders(id)' },
        { name: 'from_status', type: 'VARCHAR(32)' },
        { name: 'to_status', type: 'VARCHAR(32)' },
        { name: 'changed_by_user_id', type: 'UUID', key: 'FOREIGN KEY -> users(id)' },
        { name: 'timestamp', type: 'TIMESTAMPTZ' },
      ],
      recordCount: serverDb.getState().order_status_history.length,
    },
    {
      tableName: 'payments',
      description: 'Immutable financial payments ledger',
      columns: [
        { name: 'id', type: 'UUID', key: 'PRIMARY KEY' },
        { name: 'tenant_id', type: 'UUID', key: 'FOREIGN KEY -> tenants(id)' },
        { name: 'order_id', type: 'UUID', key: 'FOREIGN KEY -> orders(id)' },
        { name: 'amount_centavos', type: 'INT', check: '> 0' },
        { name: 'method', type: 'VARCHAR(32)', check: "('cash', 'qr_ph', 'card', 'other')" },
        { name: 'reference_number', type: 'VARCHAR(128)' },
      ],
      recordCount: serverDb.getState().payments.length,
    },
    {
      tableName: 'payment_attempts',
      description: 'Dynamic PayMongo QR Ph payment attempts with idempotency',
      columns: [
        { name: 'id', type: 'UUID', key: 'PRIMARY KEY' },
        { name: 'tenant_id', type: 'UUID', key: 'FOREIGN KEY -> tenants(id)' },
        { name: 'idempotency_key', type: 'VARCHAR(128)', key: 'UNIQUE' },
        { name: 'status', type: 'VARCHAR(32)', check: "('pending', 'succeeded', 'failed', 'expired')" },
      ],
      recordCount: serverDb.getState().payment_attempts.length,
    },
    {
      tableName: 'payment_connections',
      description: 'Per-tenant PayMongo merchant connection credentials',
      columns: [
        { name: 'id', type: 'UUID', key: 'PRIMARY KEY' },
        { name: 'tenant_id', type: 'UUID', key: 'UNIQUE FOREIGN KEY -> tenants(id)' },
        { name: 'provider', type: 'VARCHAR(32)', default: 'paymongo' },
        { name: 'status', type: 'VARCHAR(32)', check: "('connected', 'disconnected', 'sandbox')" },
      ],
      recordCount: serverDb.getState().payment_connections.length,
    },
    {
      tableName: 'audit_logs',
      description: 'Platform and tenant audit trail for security events and mutations',
      columns: [
        { name: 'id', type: 'UUID', key: 'PRIMARY KEY' },
        { name: 'tenant_id', type: 'UUID', nullable: true },
        { name: 'action', type: 'VARCHAR(128)' },
        { name: 'entity_type', type: 'VARCHAR(64)' },
        { name: 'created_at', type: 'TIMESTAMPTZ' },
      ],
      recordCount: serverDb.getState().audit_logs.length,
    },
  ];

  res.json({
    engine: 'Cloud Firestore + PostgreSQL Relational Specification',
    currency: 'PHP (Integer Centavos)',
    isolationModel: 'Tenant-Partitioned Multi-Tenant Architecture',
    tables,
  });
});

/**
 * Cross-Tenant Security Penetration Test API
 */
api.post(
  '/system/test-cross-tenant-boundary',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { attackerUserId, victimTenantId } = req.body as {
      attackerUserId?: string;
      victimTenantId?: string;
    };

    const user = (attackerUserId ? serverDb.getUserById(attackerUserId) : null) || req.user;
    if (!user || !victimTenantId) {
      res.status(400).json({ error: 'Authenticated user and target tenant ID are required' });
      return;
    }

    let victimTenant = req.firebaseIdToken
      ? await firestoreRepo.getTenantById(victimTenantId, req.firebaseIdToken).catch(() => null)
      : null;
    if (!victimTenant) {
      victimTenant = serverDb.getTenantById(victimTenantId) || null;
    }

    if (!victimTenant) {
      res.status(404).json({ error: 'Target tenant not found' });
      return;
    }

    let membership = req.firebaseIdToken
      ? await firestoreRepo.getMembershipForUid(victimTenant.id, user.authUid || user.id, req.firebaseIdToken).catch(() => null)
      : null;
    if (!membership) {
      membership = serverDb.findMembership(victimTenant.id, user.id) || null;
    }

    if (!membership && !user.isSuperAdmin) {
      await recordAudit(req, {
        tenantId: victimTenant.id,
        userId: user.id,
        action: 'SECURITY_CROSS_TENANT_VIOLATION_BLOCKED',
        entityType: 'tenant_access',
        entityId: victimTenant.id,
        metadata: {
          simulation: 'PENETRATION_TEST',
          userEmail: user.email,
          attemptedTarget: victimTenant.name,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] as string,
      });

      res.status(403).json({
        success: false,
        blocked: true,
        statusCode: 403,
        securityStatus: 'PASSED_SECURE',
        message: `Cross-tenant access securely blocked by Fabriq middleware! User "${user.fullName}" (${user.email}) has no authorization to access "${victimTenant.name}".`,
        auditLogged: true,
        details: {
          user: { id: user.id, email: user.email },
          targetTenant: { id: victimTenant.id, name: victimTenant.name },
          policy: 'STRICT_TENANT_ISOLATION_AND_MEMBERSHIP_VERIFICATION',
        },
      });
      return;
    }

    res.json({
      success: true,
      blocked: false,
      message: 'User is authorized for this tenant.',
    });
  })
);

/**
 * Clear local cache state.
 */
api.post(
  '/system/reset-demo',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (_req: AuthenticatedRequest, res) => {
    serverDb.resetToSeed();
    res.json({ message: 'Local cache cleared successfully' });
  })
);

// Centralized Express error handler for async API routes
api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled API route error:', err);
  const message = err instanceof Error ? err.message : 'Internal server error';
  const status = message.includes('(403)') || message.includes('PERMISSION_DENIED') ? 403 : 500;
  res.status(status).json({ error: message });
});

export default api;
