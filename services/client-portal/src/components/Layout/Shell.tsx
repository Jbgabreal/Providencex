'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
  LayoutDashboard,
  Wallet,
  Target,
  Activity,
  Settings,
  LogOut,
  Users,
  Copy,
  Radio,
  CreditCard,
  Tag,
  Gift,
  Bell,
  Trophy,
  MessageSquare,
  Eye,
  ShieldCheck,
  Sparkles,
  BarChart3,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useUnreadNotificationCount } from '@/hooks/useNotifications';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navigation: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Accounts', href: '/accounts', icon: Wallet },
  { name: 'Strategies', href: '/strategies', icon: Target },
  { name: 'Mentors', href: '/mentors', icon: Users },
  { name: 'Leaderboard', href: '/leaderboard', icon: Trophy },
  { name: 'Discover', href: '/discover', icon: Sparkles },
  { name: 'Copy Trading', href: '/copy-trading', icon: Copy },
  { name: 'Shadow Mode', href: '/shadow', icon: Eye },
  { name: 'Mentor Dashboard', href: '/mentor-dashboard', icon: Radio },
  { name: 'Signal Imports', href: '/mentor-imports', icon: MessageSquare },
  { name: 'Mentor Insights', href: '/mentor-insights', icon: BarChart3 },
  { name: 'Referrals', href: '/referrals', icon: Gift },
  { name: 'Pricing', href: '/pricing', icon: Tag },
  { name: 'Billing', href: '/billing', icon: CreditCard },
  { name: 'Activity', href: '/activity', icon: Activity },
  { name: 'Settings', href: '/settings', icon: Settings },
  { name: 'Admin', href: '/admin', icon: ShieldCheck },
];

function NotificationBell() {
  const { data: count } = useUnreadNotificationCount();
  return (
    <Link href="/notifications" className="relative p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100">
      <Bell className="h-5 w-5" />
      {count != null && count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center h-4 min-w-[16px] px-1 text-xs font-bold text-white bg-red-500 rounded-full">
          {count > 99 ? '99+' : String(count)}
        </span>
      )}
    </Link>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    try {
      await logout();
      router.push('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="fixed inset-y-0 left-0 w-64 bg-white border-r border-gray-200">
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center h-16 px-6 border-b border-gray-200">
            <h1 className="text-xl font-bold text-gray-900">ProvidenceX</h1>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-6 space-y-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={clsx(
                    'flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                    isActive
                      ? 'bg-green-50 text-green-700'
                      : 'text-gray-700 hover:bg-gray-100'
                  )}
                >
                  <Icon className="mr-3 h-5 w-5" />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* User section */}
          <div className="px-4 py-4 border-t border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {user?.email || 'User'}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {user?.id || ''}
                </p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="pl-64">
        {/* Top bar */}
        <div className="sticky top-0 z-10 flex h-16 bg-white border-b border-gray-200">
          <div className="flex flex-1 items-center justify-between px-6">
            <div className="flex items-center">
              <span className="text-sm text-gray-600">Status:</span>
              <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                Live
              </span>
            </div>
            <NotificationBell />
          </div>
        </div>

        {/* Page content */}
        <main className="py-6">{children}</main>
      </div>
    </div>
  );
}

