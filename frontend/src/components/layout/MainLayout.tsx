import { Outlet } from 'react-router-dom'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { MobileBottomNav } from './MobileBottomNav'
import { useSidebarStore } from '@/lib/store'
import { cn } from '@/lib/utils'

export function MainLayout() {
  const collapsed = useSidebarStore((state) => state.collapsed)

  return (
    <div className="flex min-h-[100dvh] bg-background">
      <Sidebar />
      <div
        className={cn(
          'flex min-h-[100dvh] min-w-0 flex-1 flex-col transition-[margin] duration-200',
          collapsed ? 'lg:ml-[72px]' : 'lg:ml-64'
        )}
      >
        <Header />
        <main
          role="main"
          className="vm-has-bottom-nav flex-1 px-3 py-4 sm:px-4 sm:py-5 lg:px-8 lg:py-8"
          aria-label="Conteúdo principal"
        >
          <div className="mx-auto w-full min-w-0 max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
      <MobileBottomNav />
    </div>
  )
}
