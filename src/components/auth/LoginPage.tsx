import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import { ShieldCheck, AlertCircle } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { loginWithGoogle } = useAuth();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showRedirectFallback, setShowRedirectFallback] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogleSignIn = async (useRedirect = false) => {
    try {
      setLoginError(null);
      setGoogleLoading(true);
      await loginWithGoogle(useRedirect);
    } catch (err: unknown) {
      const rawMessage = err instanceof Error ? err.message : 'Google authentication was cancelled or failed.';
      if (rawMessage.includes('auth/unauthorized-domain')) {
        setLoginError(
          `This domain (${window.location.hostname}) is not yet added to Firebase Console → Authentication → Settings → Authorized domains.`
        );
      } else if (
        rawMessage.includes('auth/popup-blocked') ||
        rawMessage.includes('auth/popup-closed-by-user') ||
        rawMessage.includes('auth/cancelled-popup-request')
      ) {
        setShowRedirectFallback(true);
        setLoginError(
          rawMessage.includes('auth/popup-blocked')
            ? 'Sign-in popup was blocked by your browser. Allow popups or use the redirect sign-in option below.'
            : 'Google sign-in popup was closed before completing. Try again or use the redirect sign-in option below.'
        );
      } else {
        setLoginError(rawMessage);
      }
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
            F
          </span>
          <span className="text-2xl font-bold tracking-tight text-slate-900">
            Fabriq
          </span>
        </div>
        <h2 className="text-center text-sm font-semibold text-slate-800">
          Laundry Management
        </h2>
        <p className="mt-1 text-center text-xs text-slate-500">
          Sign in with Google to access the platform admin portal, POS, and customer ledger
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 sm:px-8 rounded-2xl border border-slate-200 shadow-sm space-y-5">
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

          {/* Google Sign-In with Firebase Auth */}
          <div className="space-y-3">
            <button
              onClick={() => handleGoogleSignIn(false)}
              disabled={googleLoading}
              className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 active:scale-[0.99] transition-all shadow-xs min-h-[46px] disabled:opacity-60"
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
              <span>{googleLoading ? 'Signing in with Google...' : 'Continue with Google (Firebase Auth)'}</span>
            </button>

            {showRedirectFallback && (
              <button
                onClick={() => handleGoogleSignIn(true)}
                disabled={googleLoading}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-all min-h-[42px] disabled:opacity-60"
              >
                Use Full-Page Google Redirect Instead
              </button>
            )}

            <p className="text-[11px] text-center text-slate-500 leading-relaxed">
              Platform admins and registered laundry shop owners sign in with their authorized Google account — no separate password needed.
            </p>
          </div>

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

