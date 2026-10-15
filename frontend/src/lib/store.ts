import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import { buildApiUrl } from './apiBase'
import { shouldKeepConnected } from './authPreferences'

interface User {
  id: number
  name: string
  email: string
  is_verified: boolean
  is_active?: boolean
  is_admin?: boolean
  is_superadmin?: boolean
  session_scope?: 'app' | 'super_admin'
  active_organization?: {
    id: number | null
    name: string
    slug: string
    role: 'owner' | 'admin' | 'member'
    account_user_id: number
  }
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  login: (user: User) => void
  logout: () => void
  updateUser: (user: Partial<User>) => void
  checkAuthStatus: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      
      login: (user) => {
        set({ user, isAuthenticated: true })
      },
      
      logout: async () => {
        try {
          // Call logout API to clear httpOnly cookies
          await fetch(buildApiUrl('/auth/logout'), {
            method: 'POST',
            credentials: 'include'
          })
        } catch (error) {
          console.error('Error during logout:', error)
        }
        
        set({ user: null, isAuthenticated: false })
        
        // Use custom event for secure navigation instead of direct location change
        const event = new CustomEvent('auth:logout');
        window.dispatchEvent(event);
      },
      
      updateUser: (userData) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...userData } : null,
        })),
      
      checkAuthStatus: async () => {
        try {
          // Try to fetch user profile to check if session is still valid
          const response = await fetch(buildApiUrl('/auth/profile'), {
            method: 'GET',
            credentials: 'include'
          })
          
          if (!response.ok) {
            // Session is invalid, clear auth state
            set({ user: null, isAuthenticated: false })
            return
          }
          
          const data = await response.json()
          if (data.user) {
            // Update user data if session is valid
            set({ user: data.user, isAuthenticated: true })
          }
        } catch (error) {
          // Network error or session invalid, clear auth state
          console.error('Auth status check failed:', error)
          set({ user: null, isAuthenticated: false })
        }
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(
        (): StateStorage => ({
          getItem: (name) => {
            if (shouldKeepConnected()) {
              return localStorage.getItem(name)
            }
            return sessionStorage.getItem(name)
          },
          setItem: (name, value) => {
            if (shouldKeepConnected()) {
              localStorage.setItem(name, value)
              sessionStorage.removeItem(name)
              return
            }

            sessionStorage.setItem(name, value)
            localStorage.removeItem(name)
          },
          removeItem: (name) => {
            localStorage.removeItem(name)
            sessionStorage.removeItem(name)
          }
        })
      ),
    }
  )
)

interface SidebarState {
  isOpen: boolean
  toggle: () => void
  close: () => void
  open: () => void
  collapsed: boolean
  toggleCollapsed: () => void
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      // Fechada por padrao: no mobile a sidebar e um drawer sobreposto, e abrir
      // por default cobria o conteudo com overlay ja no primeiro carregamento.
      // No desktop o `lg:translate-x-0` mantem a sidebar sempre visivel.
      isOpen: false,
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
      close: () => set({ isOpen: false }),
      open: () => set({ isOpen: true }),
      // Desktop: menu completo ou so icones, escolhido pelo usuario.
      collapsed: false,
      toggleCollapsed: () => set((state) => ({ collapsed: !state.collapsed })),
    }),
    {
      name: 'sidebar-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ collapsed: state.collapsed }),
    }
  )
)

interface ThemeState {
  theme: 'light' | 'dark' | 'system'
  setTheme: (theme: 'light' | 'dark' | 'system') => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'theme-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
)

interface EmailState {
  currentEmail: any | null
  drafts: any[]
  setCurrentEmail: (email: any) => void
  saveDraft: (draft: any) => void
  removeDraft: (id: string) => void
  clearDrafts: () => void
}

export const useEmailStore = create<EmailState>()((set) => ({
  currentEmail: null,
  drafts: [],
  
  setCurrentEmail: (email) => set({ currentEmail: email }),
  
  saveDraft: (draft) =>
    set((state) => ({
      drafts: [...state.drafts.filter(d => d.id !== draft.id), draft],
    })),
  
  removeDraft: (id) =>
    set((state) => ({
      drafts: state.drafts.filter(d => d.id !== id),
    })),
  
  clearDrafts: () => set({ drafts: [] }),
}))

interface NotificationState {
  notifications: Array<{
    id: string
    type: 'info' | 'success' | 'warning' | 'error'
    title: string
    message: string
    timestamp: Date
    read: boolean
  }>
  addNotification: (notification: Omit<NotificationState['notifications'][0], 'id' | 'timestamp' | 'read'>) => void
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  removeNotification: (id: string) => void
  clearNotifications: () => void
}

export const useNotificationStore = create<NotificationState>()((set) => ({
  notifications: [],
  
  addNotification: (notification) =>
    set((state) => ({
      notifications: [
        {
          ...notification,
          id: Math.random().toString(36).substring(2, 15),
          timestamp: new Date(),
          read: false,
        },
        ...state.notifications,
      ].slice(0, 50), // Keep only last 50 notifications
    })),
  
  markAsRead: (id) =>
    set((state) => ({
      notifications: state.notifications.map(n =>
        n.id === id ? { ...n, read: true } : n
      ),
    })),
  
  markAllAsRead: () =>
    set((state) => ({
      notifications: state.notifications.map(n => ({ ...n, read: true })),
    })),
  
  removeNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter(n => n.id !== id),
    })),
  
  clearNotifications: () => set({ notifications: [] }),
}))

interface SettingsState {
  settings: {
    emailsPerPage: number
    autoRefresh: boolean
    refreshInterval: number
    language: 'pt-BR' | 'en-US'
    analyticsDefaultTimeRange: '24h' | '7d' | '30d' | '90d'
    theme: 'light' | 'dark' | 'system'
    timezone: string
    dateFormat: string
    timeFormat: '12h' | '24h'
  }
  updateSettings: (settings: Partial<SettingsState['settings']>) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: {
        emailsPerPage: 20,
        autoRefresh: true,
        refreshInterval: 30000, // 30 seconds
        language: 'pt-BR',
        analyticsDefaultTimeRange: '30d',
        theme: 'light',
        timezone: 'America/Sao_Paulo',
        dateFormat: 'DD/MM/YYYY',
        timeFormat: '24h',
      },
      
      updateSettings: (newSettings) =>
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        })),
    }),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
