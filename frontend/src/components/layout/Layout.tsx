import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { FileSpreadsheet, LayoutDashboard, Package, Archive, Settings, LogOut, Menu, X, BarChart2, History } from 'lucide-react'
const APP_VERSION = '202606291200'
import { auth, signOut } from '../../services/firebase'

const nav = [
  { to: '/',             icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/emissao',      icon: FileSpreadsheet,  label: 'Emissão' },
  { to: '/dados',        icon: Package,          label: 'Dados WinMax4' },
  { to: '/arquivo',      icon: Archive,          label: 'Arquivo digital' },
  { to: '/saft',         icon: BarChart2,         label: 'SAF-T' },
  { to: '/historico',    icon: History,          label: 'Histórico' },
  { to: '/configuracoes',icon: Settings,         label: 'Configurações' },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Sidebar desktop */}
      <aside className="hidden md:flex flex-col w-60 fixed h-full z-10" style={{ background: '#0d7b6b' }}>
        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="3" width="15" height="13" rx="1"/>
                <path d="M16 8h4l3 5v3h-7V8z"/>
                <circle cx="5.5" cy="18.5" r="2.5"/>
                <circle cx="18.5" cy="18.5" r="2.5"/>
              </svg>
            </div>
            <div>
              <h1 className="text-white font-black text-base tracking-tight">AMG<span className="text-teal-200">24</span></h1>
              <p className="text-white/60 text-xs uppercase tracking-widest">GesWinmax</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-0.5">
          {nav.map(({ to, icon: Icon, label }) => (
            <Link key={to} to={to}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all
                ${pathname === to
                  ? 'bg-white text-teal-700 shadow-sm'
                  : 'text-white/80 hover:bg-white/10 hover:text-white'}`}>
              <Icon size={16} strokeWidth={2}/>
              {label}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-3 py-4 border-t border-white/10">
          <button onClick={() => signOut(auth)}
            className="flex items-center gap-3 px-3 py-2.5 w-full rounded-lg text-sm text-white/70 hover:bg-white/10 hover:text-white transition-all">
            <LogOut size={16} strokeWidth={2}/> Sair
          </button>
          <p className="text-white/30 text-xs text-center mt-2">v{APP_VERSION}</p>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-20 px-4 py-3 flex items-center justify-between" style={{ background: '#0d7b6b' }}>
        <h1 className="text-white font-black text-base">AMG<span className="text-teal-200">24</span></h1>
        <button onClick={() => setOpen(!open)} className="p-1 text-white">
          {open ? <X size={20}/> : <Menu size={20}/>}
        </button>
      </div>

      {open && (
        <div className="md:hidden fixed inset-0 z-10 pt-14" style={{ background: '#0d7b6b' }}>
          <nav className="py-3 px-3 space-y-0.5">
            {nav.map(({ to, icon: Icon, label }) => (
              <Link key={to} to={to} onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all
                  ${pathname === to ? 'bg-white text-teal-700' : 'text-white/80'}`}>
                <Icon size={16}/>{label}
              </Link>
            ))}
          </nav>
        </div>
      )}

      {/* Conteúdo principal */}
      <main className="flex-1 md:ml-60 pt-14 md:pt-0 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 py-6">
          {children}
        </div>
      </main>
    </div>
  )
}
