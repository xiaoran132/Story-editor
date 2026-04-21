import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Sparkles, Gamepad2, PenTool, Wallet, Search, Bell, User } from 'lucide-react';

const Header: React.FC = () => {
  const location = useLocation();

  const navItems = [
    { path: '/', label: '探索社区', icon: Sparkles },
    { path: '/play', label: '沉浸体验', icon: Gamepad2 },
    { path: '/editor', label: '创作引擎', icon: PenTool },
    { path: '/dashboard', label: '收益中心', icon: Wallet },
  ];

  return (
    <header data-cmp="Header" className="sticky top-0 z-50 w-full border-b border-white/10 bg-[rgba(10,5,24,0.6)] backdrop-blur-xl">
      <div className="max-w-[1440px] mx-auto px-6 h-20 flex items-center justify-between">
        
        {/* Logo Area */}
        <Link to="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[rgba(168,85,247,1)] to-[rgba(56,189,248,1)] flex items-center justify-center shadow-custom transition-transform duration-300 group-hover:scale-105">
            <Sparkles className="text-white w-6 h-6" />
          </div>
          <span className="text-2xl font-bold tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-white to-[rgba(255,255,255,0.7)]">
            NEXUS<span className="text-[rgba(168,85,247,1)]">.AI</span>
          </span>
        </Link>

        {/* Navigation */}
        <nav className="hidden md:flex items-center gap-2 bg-[rgba(255,255,255,0.03)] p-1.5 rounded-2xl border border-white/5">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ${
                  isActive 
                    ? 'bg-[rgba(168,85,247,0.15)] text-[rgba(216,180,254,1)] border border-[rgba(168,85,247,0.3)] shadow-[0_0_15px_rgba(168,85,247,0.2)]' 
                    : 'text-muted-foreground hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <button className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 border border-white/10 text-muted-foreground hover:text-white hover:bg-white/10 transition-colors">
            <Search className="w-5 h-5" />
          </button>
          <button className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 border border-white/10 text-muted-foreground hover:text-white hover:bg-white/10 transition-colors relative">
            <Bell className="w-5 h-5" />
            <span className="absolute top-2 right-2.5 w-2 h-2 bg-[rgba(239,68,68,1)] rounded-full shadow-[0_0_8px_rgba(239,68,68,0.8)]"></span>
          </button>
          <button className="flex items-center gap-2 pl-2 pr-4 py-1.5 rounded-full bg-gradient-to-r from-[rgba(168,85,247,0.2)] to-transparent border border-[rgba(168,85,247,0.3)] hover:border-[rgba(168,85,247,0.6)] transition-all">
            <div className="w-8 h-8 rounded-full bg-[rgba(168,85,247,0.3)] flex items-center justify-center overflow-hidden">
              <User className="w-5 h-5 text-[rgba(216,180,254,1)]" />
            </div>
            <span className="text-sm font-medium text-white">Creator_01</span>
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;