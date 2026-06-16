import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Layout from './components/layout/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Emissao from './pages/Emissao'
import Dados from './pages/Dados'
import Arquivo from './pages/Arquivo'
import Configuracoes from './pages/Configuracoes'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/>
    </div>
  )
  return user ? <Layout>{children}</Layout> : <Navigate to="/login" replace/>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login/>}/>
        <Route path="/"               element={<PrivateRoute><Dashboard/></PrivateRoute>}/>
        <Route path="/emissao"        element={<PrivateRoute><Emissao/></PrivateRoute>}/>
        <Route path="/dados"          element={<PrivateRoute><Dados/></PrivateRoute>}/>
        <Route path="/arquivo"        element={<PrivateRoute><Arquivo/></PrivateRoute>}/>
        <Route path="/configuracoes"  element={<PrivateRoute><Configuracoes/></PrivateRoute>}/>
        <Route path="*" element={<Navigate to="/" replace/>}/>
      </Routes>
    </BrowserRouter>
  )
}
