import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { FileSpreadsheet, LayoutDashboard, Package, Archive, Settings, LogOut, Menu, X, BarChart2 } from 'lucide-react'
const APP_VERSION = '202606201147'
import { auth, signOut } from '../../services/firebase'

const nav = [
  { to: '/',             icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/emissao',      icon: FileSpreadsheet,  label: 'Emissão' },
  { to: '/dados',        icon: Package,          label: 'Dados WinMax4' },
  { to: '/arquivo',      icon: Archive,          label: 'Arquivo digital' },
  { to: '/saft',         icon: BarChart2,         label: 'SAF-T' },
  { to: '/configuracoes',icon: Settings,         label: 'Configurações' },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Sidebar desktop */}
      <aside className="hidden md:flex flex-col w-56 bg-white border-r border-gray-200 fixed h-full z-10">
        <div className="px-5 py-4 border-b border-gray-100">
          <h1 className="text-base font-semibold text-gray-900">GesWinmax</h1>
          <p className="text-xs text-gray-400 mt-0.5">AUTOAVENIDA</p>
        </div>
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {nav.map(({ to, icon: Icon, label }) => (
            <Link key={to} to={to}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors
                ${pathname === to
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}>
              <Icon size={16} strokeWidth={1.75}/>
              {label}
            </Link>
          ))}
        </nav>
        <div className="px-2 py-3 border-t border-gray-100">
          <button onClick={() => signOut(auth)}
            className="flex items-center gap-2.5 px-3 py-2 w-full rounded-lg text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors">
            <LogOut size={16} strokeWidth={1.75}/> Sair
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-20 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <h1 className="text-base font-semibold text-gray-900">GesWinmax</h1>
        <button onClick={() => setOpen(!open)} className="p-1 text-gray-500">
          {open ? <X size={20}/> : <Menu size={20}/>}
        </button>
      </div>

      {open && (
        <div className="md:hidden fixed inset-0 z-10 bg-white pt-14">
          <nav className="py-3 px-2 space-y-0.5">
            {nav.map(({ to, icon: Icon, label }) => (
              <Link key={to} to={to} onClick={() => setOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors
                  ${pathname === to ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600'}`}>
                <Icon size={16}/>{label}
              </Link>
            ))}
          </nav>
        </div>
      )}

      {/* Conteúdo principal */}
      <main className="flex-1 md:ml-56 pt-14 md:pt-0">
        <div className="max-w-5xl mx-auto px-4 py-6">
          {children}
        </div>
      </main>
    </div>
  )
}
