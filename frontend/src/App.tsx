import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Layout from './components/layout/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Emissao from './pages/Emissao'
import Dados from './pages/Dados'
import Arquivo from './pages/Arquivo'
import Configuracoes from './pages/Configuracoes'
import SAFTDashboard from './pages/SAFTDashboard'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  if (!user) return <Navigate to="/login" replace/>

  return <Layout>{children}</Layout>
}

export default function App() {
  const { user, loading } = useAuth()

  // Enquanto verifica o estado de auth, mostra loading
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace/> : <Login/>}/>
        <Route path="/"              element={<PrivateRoute><Dashboard/></PrivateRoute>}/>
        <Route path="/emissao"       element={<PrivateRoute><Emissao/></PrivateRoute>}/>
        <Route path="/dados"         element={<PrivateRoute><Dados/></PrivateRoute>}/>
        <Route path="/arquivo"       element={<PrivateRoute><Arquivo/></PrivateRoute>}/>
        <Route path="/configuracoes" element={<PrivateRoute><Configuracoes/></PrivateRoute>}/>
        <Route path="/saft"          element={<PrivateRoute><SAFTDashboard/></PrivateRoute>}/>
        <Route path="*"              element={<Navigate to="/" replace/>}/>
      </Routes>
    </BrowserRouter>
  )
}
