import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import {
  LayoutDashboard,
  Package,
  QrCode,
  Users,
  Sparkles,
  ShieldCheck,
  Database,
  History,
  ShieldAlert,
  Building2,
  ChevronDown,
  UserCheck,
  Menu,
  X,
  LogOut,
  ChevronRight,
} from 'lucide-react';

interface AppShellProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ currentTab, onTabChange, children }) => {
  const { user, tenant, allTenants, currentRole, personas, storageMode, switchUser, switchTenant, logout } = useAuth();
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [personaDropdownOpen, setPersonaDropdownOpen] = useState(false);
  const [tenantDropdownOpen, setTenantDropdownOpen] = useState(false);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'orders', label: 'Orders Lifecycle', icon: Package },
    { id: 'payments', label: 'Payments & QR Ph', icon: QrCode },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'services', label: 'Services & Pricing', icon: Sparkles },
    { id: 'security', label: 'Tenant Isolation & RBAC', icon: ShieldCheck },
    { id: 'schema', label: 'Relational Schema', icon: Database },
    { id: 'audit', label: 'Audit Trail', icon: History },
  ];

  if (user?.isSuperAdmin) {
    navItems.push({ id: 'superadmin', label: 'Super Admin Portal', icon: ShieldAlert });
  }

  const handleSelectTab = (tabId: string) => {
    onTabChange(tabId);
    setMobileDrawerOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans overflow-x-hidden">
      {/* Top Header - Responsive, Single-Line, Never Clips */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-3 sm:px-5 lg:px-6 flex items-center justify-between h-14 sm:h-15 gap-2 sm:gap-4">
          {/* Zone 1: Brand & Drawer Trigger */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Drawer trigger visible on mobile & tablet (< lg) */}
            <button
              onClick={() => setMobileDrawerOpen(true)}
              className="lg:hidden p-2 text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors"
              aria-label="Open Navigation Drawer"
            >
              <Menu className="w-5 h-5" />
            </button>

            <button
              onClick={() => handleSelectTab('dashboard')}
              className="flex items-center gap-2 text-left group"
            >
              <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white font-bold text-xs sm:text-sm tracking-wider shadow-xs group-hover:bg-slate-800 transition-colors">
                L
              </span>
              <span className="text-sm sm:text-base font-bold tracking-tight text-slate-900 whitespace-nowrap hidden xs:inline">
                LaundryOS
              </span>
            </button>
          </div>

          {/* Zone 2: Responsive Tenant Selector Dropdown */}
          <div className="relative shrink min-w-0 max-w-[160px] xs:max-w-[200px] sm:max-w-xs md:max-w-sm">
            <button
              onClick={() => setTenantDropdownOpen(!tenantDropdownOpen)}
              className="w-full flex items-center justify-between gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 rounded-lg transition-colors min-h-[38px]"
            >
              <div className="flex items-center gap-1.5 truncate">
                <Building2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <span className="truncate">{tenant?.name || 'Select Shop'}</span>
              </div>
              <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
            </button>

            {tenantDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setTenantDropdownOpen(false)}
                />
                <div className="absolute left-0 mt-1.5 w-64 bg-white rounded-xl shadow-xl border border-slate-200 p-1.5 z-50 text-xs space-y-1">
                  <div className="px-2.5 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    Switch Operating Tenant:
                  </div>
                  {allTenants.length === 0 ? (
                    <div className="px-2.5 py-2 text-slate-500 text-[11px]">
                      No laundry shops registered yet.
                    </div>
                  ) : (
                    allTenants.map((t) => {
                      const isCurrent = t.id === tenant?.id;
                      return (
                        <button
                          key={t.id}
                          onClick={() => {
                            switchTenant(t.id);
                            setTenantDropdownOpen(false);
                          }}
                          className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center justify-between transition-colors ${
                            isCurrent
                              ? 'bg-indigo-50 font-semibold text-indigo-950 border border-indigo-100'
                              : 'hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <div className="truncate pr-2">
                            <div className="truncate">{t.name}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{t.slug}</div>
                          </div>
                          {isCurrent && (
                            <span className="text-[10px] bg-indigo-600 text-white px-1.5 py-0.5 rounded font-mono">
                              ACTIVE
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>

          {/* Zone 3: User Profile & Role Dropdown */}
          <div className="relative shrink-0">
            <button
              onClick={() => setPersonaDropdownOpen(!personaDropdownOpen)}
              className="flex items-center gap-1.5 sm:gap-2 text-xs font-medium text-slate-700 hover:text-slate-900 px-2 sm:px-3 py-1.5 bg-slate-100 rounded-lg border border-slate-200 hover:bg-slate-200/60 transition-colors min-h-[38px]"
            >
              <div className="w-6 h-6 rounded-md bg-indigo-600 text-white flex items-center justify-center font-bold text-[11px] shrink-0">
                {user?.fullName?.charAt(0) || 'U'}
              </div>
              <div className="text-left hidden sm:block max-w-[120px] truncate">
                <span className="font-semibold text-slate-900 truncate block">
                  {user?.fullName?.split(' ')[0]}
                </span>
                <span className="text-slate-400 text-[10px] font-mono uppercase block -mt-0.5">
                  {currentRole}
                </span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>

            {personaDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setPersonaDropdownOpen(false)}
                />
                <div className="absolute right-0 mt-1.5 w-72 bg-white rounded-xl shadow-xl border border-slate-200 p-2 z-50 text-xs space-y-1">
                  <div className="px-3 py-1.5 border-b border-slate-100 pb-2">
                    <div className="font-bold text-slate-900 text-sm truncate">{user?.fullName}</div>
                    <div className="text-[11px] text-slate-500 font-mono truncate">{user?.email}</div>
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] font-mono text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded w-fit uppercase font-semibold">
                      Role: {currentRole}
                    </div>
                  </div>

                  {personas.length > 0 && (
                    <>
                      <div className="px-3 pt-2 pb-1 font-semibold text-slate-400 uppercase tracking-wider text-[10px]">
                        Switch Role / Persona:
                      </div>
                      <div className="max-h-56 overflow-y-auto space-y-0.5">
                        {personas.map((p) => {
                          const isCurrent = p.id === user?.id;
                          const firstMembership = p.memberships[0];
                          return (
                            <button
                              key={p.id}
                              onClick={() => {
                                switchUser(p.id);
                                setPersonaDropdownOpen(false);
                              }}
                              className={`w-full text-left px-2.5 py-1.5 rounded-lg flex flex-col transition-colors ${
                                isCurrent
                                  ? 'bg-indigo-50 border border-indigo-200 text-indigo-950 font-semibold'
                                  : 'hover:bg-slate-50 text-slate-700'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-slate-900 truncate pr-1">{p.name}</span>
                                <span className="font-mono text-[9px] text-slate-500 uppercase shrink-0">
                                  {p.isSuperAdmin ? 'ADMIN' : firstMembership?.role || 'STAFF'}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-400 truncate">
                                {p.isSuperAdmin ? 'Platform Administrator' : firstMembership?.tenantName || p.email}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}

                  <div className="pt-2 mt-1 border-t border-slate-100">
                    <button
                      onClick={() => {
                        setPersonaDropdownOpen(false);
                        logout();
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg text-rose-600 hover:bg-rose-50 flex items-center gap-2 font-medium transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Log Out of LaundryOS</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Layout Container */}
      <div className="max-w-7xl mx-auto w-full flex-1 flex px-3 sm:px-5 lg:px-6 py-4 sm:py-6 gap-6">
        {/* Persistent Desktop Sidebar (Visible on large screens lg: 1024px+) */}
        <aside className="hidden lg:flex flex-col w-60 xl:w-64 shrink-0 space-y-1">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-2">
            Application Modules
          </div>

          <nav className="space-y-1 flex-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all ${
                    active
                      ? 'bg-slate-900 text-white font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-indigo-400' : 'text-slate-400'}`} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="pt-4 mt-auto border-t border-slate-200 text-[11px] text-slate-400 px-3 space-y-1 font-mono">
            <div>Tenant: {tenant?.slug}</div>
            <div>
              DB: {storageMode === 'firestore' ? 'Cloud Firestore' : 'Local Sandbox'}
            </div>
            <div>Status: Operational</div>
          </div>

          <div className="pt-2 px-1">
            <button
              onClick={() => logout()}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              <span>Log Out</span>
            </button>
          </div>
        </aside>

        {/* Mobile & Tablet Slide-Over Drawer (< lg) */}
        {mobileDrawerOpen && (
          <div className="lg:hidden fixed inset-0 z-50 flex">
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
              onClick={() => setMobileDrawerOpen(false)}
            />

            {/* Slide-out Menu Panel */}
            <div className="relative w-72 max-w-[80vw] bg-white h-full shadow-2xl flex flex-col p-5 z-50 overflow-y-auto">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-slate-900 flex items-center justify-center text-white font-bold text-xs tracking-wider">
                    L
                  </span>
                  <span className="text-base font-bold text-slate-900">LaundryOS</span>
                </div>
                <button
                  onClick={() => setMobileDrawerOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center"
                  aria-label="Close Menu"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Active Tenant Context in Drawer */}
              <div className="my-4 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
                <div className="text-[10px] font-mono text-slate-400 uppercase">Current Business:</div>
                <div className="font-bold text-slate-900 truncate">{tenant?.name}</div>
                <div className="text-[11px] text-indigo-600 font-mono uppercase font-semibold">
                  Role: {currentRole}
                </div>
              </div>

              {/* Navigation Links */}
              <div className="space-y-1 flex-1">
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-2 py-1">
                  Menu
                </div>
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const active = currentTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSelectTab(item.id)}
                      className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-medium min-h-[44px] transition-colors ${
                        active
                          ? 'bg-slate-900 text-white font-semibold'
                          : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="w-4 h-4 shrink-0" />
                        <span>{item.label}</span>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 opacity-40" />
                    </button>
                  );
                })}
              </div>

              {/* Drawer Footer */}
              <div className="pt-4 mt-4 border-t border-slate-100 space-y-2">
                <div className="px-3 text-[11px] font-mono text-slate-400">
                  DB: {storageMode === 'firestore' ? 'Cloud Firestore' : 'Local Sandbox'}
                </div>
                <button
                  onClick={() => {
                    setMobileDrawerOpen(false);
                    logout();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-3 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-xl transition-colors min-h-[44px]"
                >
                  <LogOut className="w-4 h-4 shrink-0" />
                  <span>Log Out of LaundryOS</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Content Viewport */}
        <main className="flex-1 min-w-0 pb-20 lg:pb-8">{children}</main>
      </div>

      {/* Ergonomic Mobile & Tablet Bottom Tab Bar (< lg) */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-5 items-center h-15 px-1 shadow-lg">
        {[
          { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
          { id: 'orders', label: 'Orders', icon: Package },
          { id: 'payments', label: 'QR Pay', icon: QrCode },
          { id: 'customers', label: 'Clients', icon: Users },
          { id: 'services', label: 'Pricing', icon: Sparkles },
        ].map((item) => {
          const Icon = item.icon;
          const active = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`flex flex-col items-center justify-center h-full min-h-[48px] py-1 transition-colors ${
                active ? 'text-indigo-600 font-semibold' : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" />
              <span className="text-[10px] mt-0.5 truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
