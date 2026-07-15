import {
  Building2Icon,
  HomeIcon,
  LayersIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  ScrollTextIcon,
  SettingsIcon,
  SunIcon,
  ZapIcon,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { errorMessage } from '../api'
import { useAuth } from '../auth'
import { useScopeAuthorizationGuard } from '../hooks'
import { LogoMark } from './icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0]!.charAt(0)
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : ''
  return (first + last).toUpperCase()
}

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: <HomeIcon />, end: true },
  { to: '/memories', label: 'Memories', icon: <LayersIcon />, end: false },
  { to: '/audit', label: 'Audit Log', icon: <ScrollTextIcon />, end: false },
  { to: '/orgs', label: 'Organizations', icon: <Building2Icon />, end: false },
  { to: '/connect', label: 'Connect', icon: <ZapIcon />, end: false },
]

export function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  useScopeAuthorizationGuard()

  const onLogout = async () => {
    try {
      await logout()
      navigate('/login')
    } catch (err) {
      toast.error(`Could not log out: ${errorMessage(err)}`)
    }
  }

  return (
    <div className="flex min-h-screen">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-50 -translate-y-20 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>
      {/* Collapses to an icon rail below md; labels stay for screen readers. */}
      <aside className="fixed inset-y-0 left-0 z-10 flex w-60 flex-col border-r border-sidebar-border bg-sidebar p-3 pt-4 text-sidebar-foreground max-md:w-14 max-md:p-2 max-md:pt-4">
        <div className="flex items-center gap-2.5 px-2.5 pb-4 max-md:justify-center max-md:px-0">
          <LogoMark />
          <span className="font-heading text-[17px] font-bold tracking-tight max-md:sr-only">
            Echo
          </span>
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs/relaxed font-medium transition-colors max-md:justify-center max-md:px-0 max-md:py-2 [&_svg]:size-3.5 [&_svg]:shrink-0',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground [&_svg]:text-sidebar-primary'
                    : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                )
              }
            >
              {item.icon}
              <span className="max-md:sr-only">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-2 border-t border-sidebar-border pt-2.5 max-md:flex-col max-md:gap-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 max-md:flex-none max-md:px-0">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/15 text-[11px] font-bold text-scope-personal"
              title={user ? `${user.name} (${user.email})` : undefined}
            >
              {user ? initials(user.name) : '?'}
            </span>
            <div className="min-w-0 max-md:sr-only">
              <div className="truncate text-xs font-semibold">{user?.name}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {user?.email}
              </div>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  title="Settings"
                  aria-label="Settings"
                >
                  <SettingsIcon />
                </Button>
              }
            />
            <DropdownMenuContent side="top" align="start" className="min-w-44">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <SunIcon className="dark:hidden" />
                  <MoonIcon className="hidden dark:block" />
                  Theme
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={theme}
                    onValueChange={(value) => setTheme(value)}
                  >
                    <DropdownMenuRadioItem value="light">
                      <SunIcon />
                      Light
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dark">
                      <MoonIcon />
                      Dark
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="system">
                      <MonitorIcon />
                      System
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => void onLogout()}
              >
                <LogOutIcon />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
      <main
        id="main-content"
        tabIndex={-1}
        className="ml-60 min-w-0 flex-1 px-10 pb-16 pt-8 outline-none max-md:ml-14 max-md:px-5 max-sm:px-3"
      >
        <div className="mx-auto max-w-[960px]">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
