/**
 * LaundryOS - Authentication & Tenant Isolation Middleware
 * Enforces server-side authentication, tenant boundaries, and RBAC.
 * Supports Cloud Firestore verification via Firebase Auth ID Tokens with local fallback.
 */

import type { Request, Response, NextFunction } from 'express';
import { serverDb } from '../db.ts';
import {
  verifyFirebaseIdToken,
  getFirestoreDoc,
  firestoreRepo,
  type VerifiedFirebaseUser,
} from '../firestore.ts';
import type { User, Tenant, TenantMembership, UserRole } from '../../src/types/database.ts';

export interface AuthenticatedRequest extends Request {
  user?: User;
  tenant?: Tenant;
  membership?: TenantMembership;
  firebaseIdToken?: string;
  firebaseUser?: VerifiedFirebaseUser;
}

/**
 * Resolves current user from Firebase ID Token or Development Persona Session.
 */
export async function authenticateUser(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const devUserIdHeader = req.headers['x-user-id'] as string | undefined;
    const firebaseTokenHeader = req.headers['x-firebase-token'] as string | undefined;

    // 1. Check for Firebase ID Token (from x-firebase-token or JWT Bearer header)
    let fbToken = firebaseTokenHeader?.trim();
    if (!fbToken && authHeader && authHeader.startsWith('Bearer ')) {
      const bearer = authHeader.split('Bearer ')[1].trim();
      if (bearer.split('.').length === 3) {
        fbToken = bearer;
      }
    }

    if (fbToken) {
      const verified = await verifyFirebaseIdToken(fbToken);
      if (verified) {
        req.firebaseIdToken = fbToken;
        req.firebaseUser = verified;
      }
    }

    let user: User | undefined;

    // 2. Check explicit persona / user header (x-user-id)
    if (devUserIdHeader) {
      // First check local seed/cache personas
      user = serverDb.getUserById(devUserIdHeader);

      // If not a local demo user and we have a verified Firebase token, fetch from Firestore /users/{uid}
      if (!user && req.firebaseIdToken && req.firebaseUser) {
        const fsUser = await getFirestoreDoc<User>(`users/${devUserIdHeader}`, req.firebaseIdToken).catch(() => null);
        if (fsUser) {
          user = fsUser;
        }
      }
    }

    // 3. Resolve from Firebase token if no explicit user resolved yet
    if (!user && req.firebaseIdToken && req.firebaseUser) {
      const fsUser = await getFirestoreDoc<User>(`users/${req.firebaseUser.uid}`, req.firebaseIdToken).catch(
        () => null
      );
      if (fsUser) {
        user = fsUser;
      } else {
        user = serverDb.getUsers().find((u) => u.authUid === req.firebaseUser!.uid);
      }
    }

    // 4. Fallback: non-JWT Bearer token
    if (!user && authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split('Bearer ')[1].trim();
      if (token.split('.').length !== 3) {
        user = serverDb.getUserById(token) || serverDb.getUsers().find((u) => u.authUid === token);
      }
    }

    if (user) {
      req.user = user;
    }

    next();
  } catch (err) {
    console.error('authenticateUser middleware error:', err);
    next();
  }
}

/**
 * Rejects requests without an authenticated user.
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      error: 'Unauthorized: Authentication required',
      code: 'AUTH_REQUIRED',
    });
    return;
  }
  next();
}

/**
 * Strict Multi-Tenant Isolation Middleware:
 * Resolves target tenant ID and verifies that the user is an active member of this tenant.
 * Cross-tenant access attempts are immediately rejected with 403 Forbidden and logged to audit trail.
 */
export async function requireTenant(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized: Authentication required', code: 'AUTH_REQUIRED' });
      return;
    }

    const targetTenantId = (req.params.tenantId || req.headers['x-tenant-id'] || req.query.tenantId) as
      | string
      | undefined;

    if (!targetTenantId) {
      res.status(400).json({ error: 'Bad Request: Tenant ID missing from request', code: 'TENANT_ID_REQUIRED' });
      return;
    }

    let tenant: Tenant | undefined | null = null;

    if (req.firebaseIdToken) {
      tenant = await firestoreRepo.getTenantById(targetTenantId, req.firebaseIdToken).catch(() => null);
      if (!tenant) {
        const allTenants = await firestoreRepo.getTenants(req.firebaseIdToken, req.firebaseUser).catch(() => []);
        tenant = allTenants.find((t) => t.id === targetTenantId || t.slug === targetTenantId) || null;
      }
    }

    if (!tenant) {
      tenant = serverDb.getTenantById(targetTenantId) || serverDb.getTenantBySlug(targetTenantId);
    }

    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' });
      return;
    }

    // Check tenant suspension status
    if (tenant.status === 'suspended' && !req.user.isSuperAdmin) {
      res.status(403).json({
        error: 'Tenant account is currently suspended. Please contact platform administration.',
        code: 'TENANT_SUSPENDED',
      });
      return;
    }

    // Super Admin bypass for platform oversight
    if (req.user.isSuperAdmin) {
      req.tenant = tenant;
      next();
      return;
    }

    // Verify tenant membership (check Firestore first if authenticated, then local DB)
    let membership: TenantMembership | undefined | null = null;

    if (req.firebaseIdToken) {
      membership = await firestoreRepo
        .getMembershipForUid(tenant.id, req.user.authUid || req.user.id, req.firebaseIdToken)
        .catch(() => null);
      if (!membership) {
        const members = await firestoreRepo.getMembersByTenant(tenant.id, req.firebaseIdToken).catch(() => []);
        membership = members.find((m) => m.userId === req.user!.id || m.id === req.user!.id) || null;
      }
    }

    if (!membership) {
      membership = serverDb.findMembership(tenant.id, req.user.id);
    }

    if (!membership || membership.status !== 'active') {
      const auditPayload = {
        tenantId: tenant.id,
        userId: req.user.id,
        action: 'SECURITY_CROSS_TENANT_VIOLATION_BLOCKED',
        entityType: 'tenant_access',
        entityId: tenant.id,
        metadata: {
          attemptedTenantId: tenant.id,
          userEmail: req.user.email,
          path: req.originalUrl,
          method: req.method,
        },
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'] as string,
      };

      serverDb.logAudit(auditPayload);
      if (req.firebaseIdToken) {
        await firestoreRepo.logAudit(auditPayload, req.firebaseIdToken).catch(() => {});
      }

      res.status(403).json({
        error: `Access Denied: You do not have permission to access records for tenant "${tenant.name}". Cross-tenant access is strictly blocked.`,
        code: 'TENANT_ISOLATION_VIOLATION',
        attemptedTenant: tenant.id,
        user: req.user.email,
      });
      return;
    }

    req.tenant = tenant;
    req.membership = membership;
    next();
  } catch (err) {
    console.error('requireTenant middleware error:', err);
    res.status(500).json({ error: 'Internal server error verifying tenant isolation' });
  }
}

/**
 * Role-Based Access Control (RBAC) Middleware.
 */
export function requireRole(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
      return;
    }

    if (req.user.isSuperAdmin) {
      next();
      return;
    }

    if (!req.membership) {
      res.status(403).json({ error: 'Forbidden: No active tenant role', code: 'MEMBERSHIP_REQUIRED' });
      return;
    }

    if (!allowedRoles.includes(req.membership.role)) {
      res.status(403).json({
        error: `Forbidden: Role "${req.membership.role}" lacks permissions for this operation. Requires one of: [${allowedRoles.join(', ')}]`,
        code: 'INSUFFICIENT_ROLE_PERMISSIONS',
        currentRole: req.membership.role,
        requiredRoles: allowedRoles,
      });
      return;
    }

    next();
  };
}

/**
 * Super Admin only guard.
 */
export function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user || !req.user.isSuperAdmin) {
    res.status(403).json({
      error: 'Forbidden: Platform Super Admin credentials required',
      code: 'SUPER_ADMIN_REQUIRED',
    });
    return;
  }
  next();
}
