/**
 * LaundryOS - Authentication & Multi-Tenant Context
 * Integrates Firebase Authentication (Google Sign-In), session handling, and role-based permissions.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { User, Tenant, TenantMembership, UserRole } from '../types/database.ts';
import { api, type StorageMode } from '../lib/api.ts';
import { hasPermission } from '../types/database.ts';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { signInWithPopup, signOut } from 'firebase/auth';

export interface PersonaInfo {
  id: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
  memberships: Array<{ tenantId: string; tenantName: string; role: string }>;
}

interface AuthContextType {
  user: User | null;
  tenant: Tenant | null;
  allTenants: Tenant[];
  memberships: TenantMembership[];
  currentRole: UserRole | null;
  personas: PersonaInfo[];
  isLoading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  storageMode: StorageMode;
  login: (email?: string, password?: string, personaId?: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  switchUser: (userId: string) => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [allTenants, setAllTenants] = useState<Tenant[]>([]);
  const [memberships, setMemberships] = useState<TenantMembership[]>([]);
  const [personas, setPersonas] = useState<PersonaInfo[]>([]);
  const [currentRole, setCurrentRole] = useState<UserRole | null>(null);
  const [storageMode, setStorageMode] = useState<StorageMode>('local_sandbox');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize session state on app load
  const initData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Wait for Firebase Auth persistence to restore currentUser before calling API
      await auth.authStateReady().catch(() => {});

      // Fetch personas list for quick-login & demonstration
      const personasList = await api.getPersonas();
      setPersonas(personasList);

      // Check if there is an active session in storage or Firebase Auth
      const savedUserId = sessionStorage.getItem('laundryos_user_id');
      const savedTenantId = sessionStorage.getItem('laundryos_tenant_id');
      const activeUserId = savedUserId || auth.currentUser?.uid || '';

      if (!activeUserId) {
        // No active session: keep user in unauthenticated state to display Login
        setUser(null);
        setTenant(null);
        setCurrentRole(null);
        setStorageMode('local_sandbox');
        setIsLoading(false);
        return;
      }

      api.setContext(activeUserId, savedTenantId || '');

      try {
        const meData = await api.getMe();
        setUser(meData.user);
        setMemberships(meData.memberships);
        setAllTenants(meData.tenants);
        setStorageMode(meData.storageMode || (auth.currentUser ? 'firestore' : 'local_sandbox'));

        const activeTenant =
          meData.tenants.find((t) => t.id === savedTenantId) || meData.tenants[0] || null;
        setTenant(activeTenant);
        if (activeTenant) {
          api.setContext(meData.user.id, activeTenant.id);
        }

        if (meData.user.isSuperAdmin) {
          setCurrentRole('super_admin');
        } else if (activeTenant) {
          const mem = meData.memberships.find((m) => m.tenantId === activeTenant.id);
          setCurrentRole(mem?.role || null);
        } else {
          setCurrentRole(null);
        }
      } catch (authErr) {
        // Stale or invalid token: reset session
        sessionStorage.removeItem('laundryos_user_id');
        sessionStorage.removeItem('laundryos_tenant_id');
        api.setContext('', '');
        setUser(null);
        setTenant(null);
        setCurrentRole(null);
        setStorageMode('local_sandbox');
      }
    } catch (err) {
      console.error('Failed to load personas/session:', err);
      setError(err instanceof Error ? err.message : 'Session initialization failed');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    initData();
  }, [initData]);

  // Standard Email / Demo Persona Login
  const login = async (email?: string, password?: string, personaId?: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await api.login({ email, password, personaId });
      setUser(res.user);
      setMemberships(res.memberships);
      setAllTenants(res.tenants);
      setStorageMode(res.storageMode || (auth.currentUser ? 'firestore' : 'local_sandbox'));

      const activeTenant = res.tenants[0] || null;
      setTenant(activeTenant);

      if (res.user.isSuperAdmin) {
        setCurrentRole('super_admin');
      } else if (activeTenant) {
        const mem = res.memberships.find((m) => m.tenantId === activeTenant.id);
        setCurrentRole(mem?.role || null);
      } else {
        setCurrentRole(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setError(msg);
      throw new Error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Google Sign-In with Firebase Auth
  const loginWithGoogle = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Popup Google sign-in via Firebase Client SDK
      const credential = await signInWithPopup(auth, googleAuthProvider);
      const firebaseUser = credential.user;
      const idToken = await firebaseUser.getIdToken();

      // Sync user profile to Cloud Firestore & assign tenant membership
      const res = await api.loginWithGoogle({
        idToken,
        authUid: firebaseUser.uid,
        email: firebaseUser.email || '',
        fullName: firebaseUser.displayName || '',
        avatarUrl: firebaseUser.photoURL || undefined,
      });

      setUser(res.user);
      setMemberships(res.memberships);
      setAllTenants(res.tenants);
      setStorageMode(res.storageMode || 'firestore');

      const activeTenant = res.tenants[0] || null;
      setTenant(activeTenant);

      if (res.user.isSuperAdmin) {
        setCurrentRole('super_admin');
      } else if (activeTenant) {
        const mem = res.memberships.find((m) => m.tenantId === activeTenant.id);
        setCurrentRole(mem?.role || null);
      } else {
        setCurrentRole(null);
      }
    } catch (err: any) {
      console.error('Firebase Google Auth error:', err);
      const msg = err.message || 'Google sign-in failed';
      setError(msg);
      throw new Error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Logout
  const logout = async () => {
    try {
      await signOut(auth).catch(() => {});
      await api.logout();
    } finally {
      setUser(null);
      setTenant(null);
      setMemberships([]);
      setAllTenants([]);
      setCurrentRole(null);
      setStorageMode('local_sandbox');
    }
  };

  // Persona Switcher
  const switchUser = async (userId: string) => {
    await login(undefined, undefined, userId);
  };

  // Tenant Switcher
  const switchTenant = async (tenantId: string) => {
    if (!user) return;
    const targetTenant = allTenants.find((t) => t.id === tenantId);
    if (!targetTenant) return;

    api.setContext(user.id, targetTenant.id);
    setTenant(targetTenant);

    if (user.isSuperAdmin) {
      setCurrentRole('super_admin');
    } else {
      const mem = memberships.find((m) => m.tenantId === targetTenant.id);
      setCurrentRole(mem?.role || null);
    }
  };

  const can = (permission: string): boolean => {
    if (!currentRole) return false;
    return hasPermission(currentRole, permission);
  };

  const refresh = async () => {
    if (user) {
      const meData = await api.getMe();
      setUser(meData.user);
      setMemberships(meData.memberships);
      setAllTenants(meData.tenants);
      if (tenant) {
        const updatedCurrent = meData.tenants.find((t) => t.id === tenant.id);
        if (updatedCurrent) setTenant(updatedCurrent);
      } else if (meData.tenants[0]) {
        api.setContext(meData.user.id, meData.tenants[0].id);
        setTenant(meData.tenants[0]);
      }
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        tenant,
        allTenants,
        memberships,
        currentRole,
        personas,
        isLoading,
        error,
        isAuthenticated: user !== null,
        storageMode,
        login,
        loginWithGoogle,
        logout,
        switchUser,
        switchTenant,
        can,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
