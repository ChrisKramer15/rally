import { NavLink, Outlet } from 'react-router-dom';
import { TrendingUp, BarChart2, Home, Lightbulb } from 'lucide-react';

export default function Layout() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-indigo-600 text-white'
        : 'text-slate-400 hover:text-white hover:bg-slate-700'
    }`;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      {/* Top nav */}
      <header className="border-b border-slate-700 bg-slate-800">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="text-indigo-400" size={24} />
            <span className="font-bold text-lg tracking-tight text-white">Rally</span>
            <span className="text-xs text-slate-400 ml-1">Trading Desk</span>
          </div>
          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={linkClass}>
              <Home size={15} /> Portfolios
            </NavLink>
            <NavLink to="/markets" className={linkClass}>
              <BarChart2 size={15} /> Markets
            </NavLink>
            <NavLink to="/ideas" className={linkClass}>
              <Lightbulb size={15} /> Ideas
            </NavLink>
          </nav>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-slate-700 text-center text-xs text-slate-600 py-3">
        Rally Trading Desk — data is simulated for demonstration purposes only. Not financial advice.
      </footer>
    </div>
  );
}
