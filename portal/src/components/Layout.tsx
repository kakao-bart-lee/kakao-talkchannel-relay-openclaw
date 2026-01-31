import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, MessageSquare, Settings, Key, LogOut } from 'lucide-react';
import { Button } from './ui/button';
import { api, type User } from '../lib/api';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: '대시보드' },
  { to: '/messages', icon: MessageSquare, label: '메시지' },
  { to: '/settings/token', icon: Key, label: 'API 토큰' },
  { to: '/settings', icon: Settings, label: '설정', end: true },
];

interface NavItemProps {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  end?: boolean;
  variant: 'desktop' | 'mobile';
}

function NavItem({ to, icon: Icon, label, end, variant }: NavItemProps): React.ReactElement {
  const isMobile = variant === 'mobile';
  const baseStyles = isMobile
    ? 'flex flex-1 items-center justify-center gap-2 rounded-md px-2 py-2 text-xs font-medium transition-colors'
    : 'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors';

  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `${baseStyles} ${
          isActive
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        }`
      }
    >
      <Icon className="h-4 w-4" />
      {isMobile ? <span className="hidden xs:inline">{label}</span> : label}
    </NavLink>
  );
}

export default function Layout(): React.ReactElement {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.me()
      .then(setUser)
      .catch(() => navigate('/login'))
      .finally(() => setLoading(false));
  }, [navigate]);

  const handleLogout = async () => {
    try {
      await api.logout();
    } finally {
      navigate('/login');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground">로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          {/* Logo */}
          <div className="flex items-center gap-6">
            <NavLink to="/" className="flex items-center gap-2 font-semibold">
              <span className="text-lg">🔗 OpenClaw</span>
            </NavLink>

            {/* Navigation */}
            <nav className="hidden items-center gap-1 md:flex">
              {navItems.map((item) => (
                <NavItem key={item.to} {...item} variant="desktop" />
              ))}
            </nav>
          </div>

          {/* User Menu */}
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {user?.email}
            </span>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              로그아웃
            </Button>
          </div>
        </div>

        {/* Mobile Navigation */}
        <nav className="flex items-center gap-1 border-t px-4 py-2 md:hidden">
          {navItems.map((item) => (
            <NavItem key={item.to} {...item} variant="mobile" />
          ))}
        </nav>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-6xl p-4 md:p-8">
        <Outlet context={{ user }} />
      </main>
    </div>
  );
}
