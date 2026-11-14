import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import { ShieldCheck, Lock, Mail, ArrowRight, UserCheck, Sparkles, Building2, AlertCircle } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login, loginWithGoogle, personas, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    try {
      setLoginError(null);
      setIsSubmitting(true);
      await login(email, password);
    } catch (err: any) {
      setLoginError(err.message || 'Login failed. Please check credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setLoginError(null);
      setGoogleLoading(true);
      await loginWithGoogle();
    } catch (err: any) {
      setLoginError(err.message || 'Google authentication was cancelled or failed.');
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Brand Lockup */}
        <div className="flex items-center justify-center gap-2.5 mb-3">
          <span className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-white font-bold text-base tracking-wider shadow-sm">
            L
          </span>
          <span className="text-2xl font-bold tracking-tight text-slate-900">
            LaundryOS
          </span>
        </div>
        <h2 className="text-center text-sm font-semibold text-slate-800">
          Philippine Multi-Tenant Laundry Management SaaS
        </h2>
        <p className="mt-1 text-center text-xs text-slate-500">
          Sign in to access your laundry shop terminal, POS, and customer ledger
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-xl">
        <div className="bg-white py-8 px-6 sm:px-10 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          {/* Error Alert */}
          {loginError && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-semibold">Authentication Notice</div>
                <div className="text-[11px] leading-relaxed">{loginError}</div>
              </div>
            </div>
          )}

          {/* Method 1: Google Sign-In with Firebase Auth */}
          <div className="space-y-3">
            <button
              onClick={handleGoogleSignIn}
              disabled={googleLoading || isSubmitting}
              className="w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-xl border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 active:scale-[0.99] transition-all shadow-xs min-h-[44px]"
            >
              {googleLoading ? (
                <div className="w-4 h-4 border-2 border-slate-600 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
              )}
              <span>Continue with Google (Firebase Auth)</span>
            </button>

            <p className="text-[11px] text-center text-slate-500">
              Registered laundry shop owners sign in with their assigned Google email — no password needed.
            </p>

            <div className="relative flex items-center justify-center my-4">
              <div className="border-t border-slate-200 w-full" />
              <span className="bg-white px-3 text-[11px] uppercase tracking-wider text-slate-400 font-medium">
                or with email credentials
              </span>
            </div>
          </div>

          {/* Method 2: Email & Password Sign-In Form */}
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Business Email Address</label>
              <div className="relative">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@yourshop.ph"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Password</label>
              <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-mono"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 active:scale-[0.99] transition-all flex items-center justify-center gap-2 min-h-[44px]"
            >
              {isSubmitting ? (
                <span>Authenticating...</span>
              ) : (
                <>
                  <span>Sign In to Tenant Portal</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>

          {/* Security Guarantee Notice */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Multi-Tenant Partitioned</span>
            </div>
            <span>Server-Verified RBAC</span>
            <span>Philippine Peso (₱)</span>
          </div>
        </div>
      </div>
    </div>
  );
};
