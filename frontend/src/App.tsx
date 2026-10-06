import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useState } from 'react'
import { MainLayout } from './components/layout/MainLayout'
import { useAuthStore } from './lib/store'
import { useAuthEvents } from './hooks/useAuthEvents'
import { useAuthCheck } from './hooks/useAuthCheck'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { AppLaunchScreen } from './components/layout/AppLaunchScreen'
import { InstallPrompt } from './components/layout/InstallPrompt'
import { isLaunchedFromPwa } from './lib/pwa'
import { Toaster } from 'react-hot-toast'
import queryClient, { initializePersistence } from './lib/queryClient'
import { installGlobalErrorHandlers, reportFrontendError } from './lib/errorReporter'
import './styles/globals.css'

// Loading component
const LoadingSpinner = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary/20 border-t-primary"></div>
  </div>
)

// Lazy load components for better performance
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Login = lazy(() => import('./pages/Login').then(m => ({ default: m.Login })));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword').then(m => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import('./pages/ResetPassword').then(m => ({ default: m.ResetPassword })));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail').then(m => ({ default: m.VerifyEmail })));
const LandingPage = lazy(() => import('./pages/LandingPage').then(m => ({ default: m.LandingPage })));
const PublicDocs = lazy(() => import('./pages/PublicDocs').then(m => ({ default: m.PublicDocs })));
const EmailList = lazy(() => import('./pages/EmailList').then(m => ({ default: m.EmailList })));
const EmailDetails = lazy(() => import('./pages/EmailDetails').then(m => ({ default: m.EmailDetails })));
const SendEmail = lazy(() => import('./pages/SendEmail').then(m => ({ default: m.SendEmail })));
const ApiKeys = lazy(() => import('./pages/ApiKeys').then(m => ({ default: m.ApiKeys })));
const AiIntegration = lazy(() => import('./pages/AiIntegration').then(m => ({ default: m.AiIntegration })));
const Templates = lazy(() => import('./pages/Templates').then(m => ({ default: m.Templates })));
const Domains = lazy(() => import('./pages/Domains').then(m => ({ default: m.Domains })));
const Analytics = lazy(() => import('./pages/Analytics').then(m => ({ default: m.Analytics })));
const Webhooks = lazy(() => import('./pages/Webhooks').then(m => ({ default: m.Webhooks })));
const SettingsPage = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const DeveloperDocs = lazy(() => import('./pages/DeveloperDocs').then(m => ({ default: m.DeveloperDocs })));
const SuperAdminLogin = lazy(() => import('./pages/SuperAdminLogin').then(m => ({ default: m.SuperAdminLogin })));
const SuperAdminForgotPassword = lazy(() => import('./pages/SuperAdminForgotPassword').then(m => ({ default: m.SuperAdminForgotPassword })));
const SuperAdminResetPassword = lazy(() => import('./pages/SuperAdminResetPassword').then(m => ({ default: m.SuperAdminResetPassword })));
const SuperAdminLayout = lazy(() => import('./modules/super-admin/SuperAdminLayout').then(m => ({ default: m.SuperAdminLayout })));
const SuperAdminOverviewPage = lazy(() => import('./modules/super-admin/pages/SuperAdminOverviewPage').then(m => ({ default: m.SuperAdminOverviewPage })));
const SuperAdminAccountsPage = lazy(() => import('./modules/super-admin/pages/SuperAdminAccountsPage').then(m => ({ default: m.SuperAdminAccountsPage })));
const SuperAdminPlansPage = lazy(() => import('./modules/super-admin/pages/SuperAdminPlansPage').then(m => ({ default: m.SuperAdminPlansPage })));
const SuperAdminUsersPage = lazy(() => import('./modules/super-admin/pages/SuperAdminUsersPage').then(m => ({ default: m.SuperAdminUsersPage })));
const SuperAdminDeliverabilityPage = lazy(() => import('./modules/super-admin/pages/SuperAdminDeliverabilityPage').then(m => ({ default: m.SuperAdminDeliverabilityPage })));
const SuperAdminIntegrationsPage = lazy(() => import('./modules/super-admin/pages/SuperAdminIntegrationsPage').then(m => ({ default: m.SuperAdminIntegrationsPage })));
const SuperAdminAuditPage = lazy(() => import('./modules/super-admin/pages/SuperAdminAuditPage').then(m => ({ default: m.SuperAdminAuditPage })));
const SuperAdminProfilePage = lazy(() => import('./modules/super-admin/pages/SuperAdminProfilePage').then(m => ({ default: m.SuperAdminProfilePage })));

/**
 * Raiz publica: a landing continua servindo visitantes do site, mas a PWA
 * instalada entra direto no fluxo do sistema em vez de passar por ela.
 */
function RootRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthStore()

  if (isLaunchedFromPwa()) {
    if (!isAuthenticated) {
      return <Navigate to="/login" replace />
    }

    return <Navigate to={user?.session_scope === 'super_admin' ? '/super-admin/overview' : '/app'} replace />
  }

  return <>{children}</>
}

function AppRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthStore()
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (user?.session_scope === 'super_admin') {
    return <Navigate to="/super-admin/overview" replace />
  }

  return <>{children}</>
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthStore()
  const location = useLocation()
  
  if (isAuthenticated && user?.session_scope === 'super_admin') {
    return <Navigate to="/super-admin/overview" replace />
  }

  // Allow access to login page if user is specifically on login route or if user data is missing
  // This prevents redirect loops when session expires but localStorage still shows authenticated
  if (
    isAuthenticated
    && user
    && location.pathname !== '/login'
    && location.pathname !== '/admin/login'
    && location.pathname !== '/super-admin/login'
  ) {
    // Only redirect to app if we're sure the user is properly authenticated
    // and not trying to access the login page specifically
    return <Navigate to="/app" replace />
  }

  return <>{children}</>
}

function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthStore()

  if (!isAuthenticated) {
    return <Navigate to="/super-admin/login" replace />
  }

  if (!user?.is_superadmin || user.session_scope !== 'super_admin') {
    return <Navigate to="/super-admin/login" replace />
  }

  return <>{children}</>
}

function AppRoutes() {
  useAuthEvents() // Handle auth events
  useAuthCheck()  // Periodically check auth status

  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
              {/* Public routes */}
              <Route
                path="/"
                element={
                  <RootRoute>
                    <LandingPage />
                  </RootRoute>
                }
              />
              {/* Documentacao publica: aberta a visitantes e tambem a quem ja
                  esta logado, por isso fica fora de PublicRoute. */}
              <Route
                path="/developers"
                element={
                  <Suspense fallback={<LoadingSpinner />}>
                    <PublicDocs />
                  </Suspense>
                }
              />
              <Route path="/docs" element={<Navigate to="/developers" replace />} />
              <Route
                path="/login"
                element={
                  <PublicRoute>
                    <Suspense fallback={<LoadingSpinner />}>
                      <Login />
                    </Suspense>
                  </PublicRoute>
                } 
              />
              {/* Admin login redirect to regular login */}
              <Route 
                path="/admin/login" 
                element={<Navigate to="/super-admin/login" replace />}
              />
              <Route
                path="/super-admin/login"
                element={
                  <Suspense fallback={<LoadingSpinner />}>
                    <SuperAdminLogin />
                  </Suspense>
                }
              />
              <Route
                path="/super-admin/forgot-password"
                element={
                  <PublicRoute>
                    <Suspense fallback={<LoadingSpinner />}>
                      <SuperAdminForgotPassword />
                    </Suspense>
                  </PublicRoute>
                }
              />
              <Route
                path="/super-admin/reset-password"
                element={
                  <PublicRoute>
                    <Suspense fallback={<LoadingSpinner />}>
                      <SuperAdminResetPassword />
                    </Suspense>
                  </PublicRoute>
                }
              />
              <Route
                path="/super-admin"
                element={
                  <SuperAdminRoute>
                    <Suspense fallback={<LoadingSpinner />}>
                      <SuperAdminLayout />
                    </Suspense>
                  </SuperAdminRoute>
                }
              >
                <Route index element={<Navigate to="/super-admin/overview" replace />} />
                <Route
                  path="overview"
                  element={
                    <Suspense fallback={<LoadingSpinner />}>
                      <SuperAdminOverviewPage />
                    </Suspense>
                  }
                />
                <Route
                  path="accounts"
                  element={
                    <Suspense fallback={<LoadingSpinner />}>
                      <SuperAdminAccountsPage />
                    </Suspense>
                  }
                />
                <Route
                  path="plans"
                  element={
                    <Suspense fallback={<LoadingSpinner />}>
                      <SuperAdminPlansPage />
                    </Suspense>
                  }
                />
                <Route
                  path="users"
                  element={
                    <Suspense fallback={<LoadingSpinner />}>
                      <SuperAdminUsersPage />
                    </Suspense>
                  }
                />
                <Route
                  path="deliverability"
                  element={
                    <Suspense fallback={<LoadingSpinner />}>
                      <SuperAdminDeliverabilityPage />
                    </Suspense>
                  }
                />
                <Route
                  path="integrations"
                  element={
                    <Suspense fallback={<LoadingSpinner />}>
                      <SuperAdminIntegrationsPage />
                    </Suspense>
                  }
                />
                <Route
                  path="audit"
                  element={
                    <Suspense fallback={<LoadingSpinner />}>
                      <SuperAdminAuditPage />
                    </Suspense>
                  }
                />
                <Route
                  path="profile"
                  element={
                    <Suspense fallback={<LoadingSpinner />}>
                      <SuperAdminProfilePage />
                    </Suspense>
                  }
                />
              </Route>
              <Route 
                path="/verify-email" 
                element={
                  <Suspense fallback={<LoadingSpinner />}>
                    <VerifyEmail />
                  </Suspense>
                } 
              />
              <Route
                path="/forgot-password"
                element={
                  <PublicRoute>
                    <Suspense fallback={<LoadingSpinner />}>
                      <ForgotPassword />
                    </Suspense>
                  </PublicRoute>
                }
              />
              <Route
                path="/reset-password"
                element={
                  <PublicRoute>
                    <Suspense fallback={<LoadingSpinner />}>
                      <ResetPassword />
                    </Suspense>
                  </PublicRoute>
                }
              />
              
              {/* Protected app routes */}
              <Route
                path="/app"
                element={
                  <AppRoute>
                    <MainLayout />
                  </AppRoute>
                }
              >
                <Route 
                  index 
                  element={
                    <Suspense fallback={<LoadingSpinner />}>
                      <Dashboard />
                    </Suspense>
                  } 
                />
                <Route 
                  path="emails" 
                  element={
                    <Suspense fallback={<LoadingSpinner />}>
                      <EmailList />
                    </Suspense>
                  } 
                />
                <Route 
                  path="emails/send" 
                  element={
                    <Suspense fallback={<LoadingSpinner />}>
                      <SendEmail />
                    </Suspense>
                  } 
                />
                <Route 
                  path="emails/:id" 
                  element={
                    <Suspense fallback={<LoadingSpinner />}>
                      <EmailDetails />
                    </Suspense>
                  } 
                />
                <Route 
                  path="templates" 
                  element={
                    <Suspense fallback={<LoadingSpinner />}>
                      <Templates />
                    </Suspense>
                  } 
                />
                <Route 
                  path="domains" 
                  element={
                    <Suspense fallback={<LoadingSpinner />}>
                      <Domains />
                    </Suspense>
                  } 
                />
                <Route
                  path="domains/setup"
                  element={<Navigate to="/app/domains?mode=setup" replace />}
                />
                <Route 
                  path="analytics" 
                  element={
                    <Suspense fallback={<LoadingSpinner />}>
                      <Analytics />
                    </Suspense>
                  } 
                />
                <Route 
                  path="webhooks" 
                  element={
                    <Suspense fallback={<LoadingSpinner />}>
                      <Webhooks />
                    </Suspense>
                  } 
                />
                <Route 
                  path="api-keys" 
                  element={
                    <Suspense fallback={<LoadingSpinner />}>
                      <ApiKeys />
                    </Suspense>
                  } 
                />
                <Route
                  path="ai"
                  element={
                    <Suspense fallback={<LoadingSpinner />}>
                      <AiIntegration />
                    </Suspense>
                  }
                />
                <Route 
                  path="developers" 
                  element={
                    <Suspense fallback={<LoadingSpinner />}>
                      <DeveloperDocs />
                    </Suspense>
                  } 
                />
                <Route 
                  path="settings" 
                  element={
                    <Suspense fallback={<LoadingSpinner />}>
                      <SettingsPage />
                    </Suspense>
                  } 
                />
              </Route>

              {/* Redirect unknown routes to landing page */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
  )
}

function App() {
  // O splash so existe na experiencia instalada; no navegador seria ruido.
  const [isLaunching, setIsLaunching] = useState(() => isLaunchedFromPwa())

  useEffect(() => {
    initializePersistence()
    const cleanup = installGlobalErrorHandlers()

    return cleanup
  }, [])

  if (isLaunching) {
    return <AppLaunchScreen onFinish={() => setIsLaunching(false)} />
  }

  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        console.error('React Error Boundary:', error, errorInfo);
        void reportFrontendError({
          type: 'react_error',
          message: error.message,
          name: error.name,
          stack: error.stack,
          componentStack: errorInfo.componentStack,
          component: 'App'
        })
      }}
    >
      <QueryClientProvider client={queryClient}>
        <Router>
          <ErrorBoundary>
            <Suspense fallback={<LoadingSpinner />}>
              <AppRoutes />
            </Suspense>
          </ErrorBoundary>
          <InstallPrompt />
          {/* Toast global configurado para toda aplicação */}
          <div aria-live="polite" aria-atomic="true">
            <Toaster
              position="top-right"
              reverseOrder={false}
              gutter={8}
              containerClassName=""
              containerStyle={{
                top: 20,
                right: 20,
                zIndex: 9999
              }}
              toastOptions={{
                duration: 4000,
                style: {
                  background: 'hsl(var(--popover))',
                  color: 'hsl(var(--popover-foreground))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '12px',
                  fontSize: '14px',
                  fontWeight: '500',
                  boxShadow: 'var(--shadow-md)',
                  maxWidth: '400px',
                  padding: '12px 16px'
                },
                success: {
                  iconTheme: {
                    primary: 'hsl(var(--success))',
                    secondary: 'hsl(var(--primary-foreground))'
                  },
                  style: {
                    border: '1px solid hsl(var(--success) / .35)',
                    background: 'hsl(var(--success) / .08)',
                    color: 'hsl(var(--success))'
                  }
                },
                error: {
                  iconTheme: {
                    primary: 'hsl(var(--destructive))',
                    secondary: 'hsl(var(--destructive-foreground))'
                  },
                  style: {
                    border: '1px solid hsl(var(--destructive) / .35)',
                    background: 'hsl(var(--destructive) / .08)',
                    color: 'hsl(var(--destructive))'
                  }
                },
                loading: {
                  iconTheme: {
                    primary: 'hsl(var(--primary))',
                    secondary: 'hsl(var(--primary-foreground))'
                  }
                }
              }}
            />
          </div>
        </Router>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

export default App
