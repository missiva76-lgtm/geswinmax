// v202606191609 - tipos documento + FRB + upload fix
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { useAcessoAutomatico } from './hooks/useAcessoAutomatico'
import { usePermissoes } from './hooks/usePermissoes'
import Layout from './components/layout/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Emissao from './pages/Emissao'
import Dados from './pages/Dados'
import Arquivo from './pages/Arquivo'
import Configuracoes from './pages/Configuracoes'
import SAFTDashboard from './pages/SAFTDashboard'
import Historico from './pages/Historico'
import Documentos from './pages/Documentos'

type Permissao = 'podeEmitir' | 'podeVerHistorico' | 'podeConfigurar'

/**
 * `permissao` restringe a rota a quem a tiver. Esconder a entrada do menu não
 * chega — sem isto, escrever o endereço diretamente dava acesso à página.
 * Continua a ser proteção do lado do browser: ver nota em hooks/usePermissoes.ts
 */
function PrivateRoute({ children, permissao }: { children: React.ReactNode; permissao?: Permissao }) {
  const { user, loading } = useAuth()
  const permissoes = usePermissoes()

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  if (!user) return <Navigate to="/login" replace/>

  // Sem permissão, volta ao Dashboard em vez de mostrar um erro
  if (permissao && !permissoes[permissao]) return <Navigate to="/" replace/>

  return <Layout>{children}</Layout>
}

export default function App() {
  const { user, loading } = useAuth()
  // Entrada automática quando aberto a partir de outra app com ?acesso=CHAVE
  // (ver hooks/useAcessoAutomatico.ts para o contexto e as limitações)
  const { aEntrar } = useAcessoAutomatico(!!user, loading)

  // Enquanto verifica o estado de auth (ou entra automaticamente), mostra loading
  if (loading || aEntrar) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace/> : <Login/>}/>
        <Route path="/"              element={<PrivateRoute><Dashboard/></PrivateRoute>}/>
        <Route path="/emissao"       element={<PrivateRoute permissao="podeEmitir"><Emissao/></PrivateRoute>}/>
        <Route path="/dados"         element={<PrivateRoute><Dados/></PrivateRoute>}/>
        <Route path="/arquivo"       element={<PrivateRoute><Arquivo/></PrivateRoute>}/>
        <Route path="/configuracoes" element={<PrivateRoute permissao="podeConfigurar"><Configuracoes/></PrivateRoute>}/>
        <Route path="/saft"          element={<PrivateRoute><SAFTDashboard/></PrivateRoute>}/>
        <Route path="/historico"      element={<PrivateRoute permissao="podeVerHistorico"><Historico/></PrivateRoute>}/>
        <Route path="/documentos"    element={<PrivateRoute><Documentos/></PrivateRoute>}/>
        <Route path="*"              element={<Navigate to="/" replace/>}/>
      </Routes>
    </BrowserRouter>
  )
}
