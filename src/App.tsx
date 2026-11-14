/**
 * LaundryOS - Master Frontend Application
 * Multi-Tenant Laundry Management SaaS for the Philippines
 * Authentication, Multi-Tenant Partitioning, Role-Based Access Control
 */

import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { LoginPage } from './components/auth/LoginPage.tsx';
import { AppShell } from './components/layout/AppShell.tsx';
import { OverviewDashboard } from './components/dashboard/OverviewDashboard.tsx';
import { OrderList } from './components/orders/OrderList.tsx';
import { CustomerList } from './components/customers/CustomerList.tsx';
import { ServiceList } from './components/services/ServiceList.tsx';
import { PaymentsModule } from './components/payments/PaymentsModule.tsx';
import { TenantIsolationDemo } from './components/foundation/TenantIsolationDemo.tsx';
import { SchemaViewer } from './components/foundation/SchemaViewer.tsx';
import { AuditLogViewer } from './components/foundation/AuditLogViewer.tsx';
import { SuperAdminPortal } from './components/admin/SuperAdminPortal.tsx';

function MainApp() {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [orderIntent, setOrderIntent] = useState<{ openNew: boolean; customerId?: string } | null>(null);
  const { isAuthenticated, isLoading, error, user, tenant, logout } = useAuth();

  const openCounterOrder = (customerId?: string) => {
    setOrderIntent({ openNew: true, customerId });
    setActiveTab('orders');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-10 h-10 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
        <h2 className="text-base font-bold text-slate-800">Initializing LaundryOS Session</h2>
        <p className="text-xs text-slate-500 mt-1">
          Connecting to authentication services & verifying tenant access...
        </p>
      </div>
    );
  }

  // If unauthenticated, show dedicated login screen
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-white p-6 rounded-xl border border-rose-200 shadow-sm max-w-md w-full space-y-3">
          <div className="w-10 h-10 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto font-bold">
            !
          </div>
          <h2 className="text-base font-bold text-slate-900">Application Notice</h2>
          <p className="text-xs text-slate-600">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  const tenantScopedTabs = ['dashboard', 'orders', 'payments', 'customers', 'services', 'audit'];
  const needsTenant = !tenant && tenantScopedTabs.includes(activeTab);

  return (
    <AppShell currentTab={activeTab} onTabChange={setActiveTab}>
      {needsTenant && user?.isSuperAdmin ? (
        <SuperAdminPortal />
      ) : needsTenant ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-8 text-center max-w-lg mx-auto my-8 space-y-3">
          <h2 className="text-base font-bold text-slate-900">No Laundry Shop Assigned Yet</h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            Your Google account (<strong>{user?.email}</strong>) is signed in, but is not yet linked to a registered
            laundry shop. Please ask your platform administrator to register your shop and assign your Google email.
          </p>
          <button
            onClick={() => logout()}
            className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800"
          >
            Sign Out
          </button>
        </div>
      ) : (
        <>
          {activeTab === 'dashboard' && (
            <OverviewDashboard onNavigate={setActiveTab} onNewOrder={() => openCounterOrder()} />
          )}
          {activeTab === 'orders' && (
            <OrderList
              openNewOrder={Boolean(orderIntent?.openNew)}
              initialCustomerId={orderIntent?.customerId}
              onClearNewOrderIntent={() => setOrderIntent(null)}
              onNavigate={setActiveTab}
            />
          )}
          {activeTab === 'payments' && <PaymentsModule />}
          {activeTab === 'customers' && (
            <CustomerList onCreateOrderForCustomer={(customerId) => openCounterOrder(customerId)} />
          )}
          {activeTab === 'services' && <ServiceList />}
        </>
      )}
      {activeTab === 'security' && <TenantIsolationDemo />}
      {activeTab === 'schema' && <SchemaViewer />}
      {!needsTenant && activeTab === 'audit' && <AuditLogViewer />}
      {!needsTenant && activeTab === 'superadmin' && <SuperAdminPortal />}
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
