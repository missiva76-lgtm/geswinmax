import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth, signInWithEmailAndPassword } from '../services/firebase'

export default function Login() {
  const [email, setEmail]     = useState('')
  const [pass, setPass]       = useState('')
  const [erro, setErro]       = useState('')
  const [loading, setLoading] = useState(false)
  const navigate              = useNavigate()

  const login = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro('')
    setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email, pass)
      // Força navegação explícita após login bem sucedido
      navigate('/', { replace: true })
    } catch (err: any) {
      console.error('Login error:', err)
      const codigo = err?.code || ''
      if (codigo === 'auth/user-not-found' || codigo === 'auth/wrong-password' || codigo === 'auth/invalid-credential') {
        setErro('Email ou password incorretos')
      } else if (codigo === 'auth/too-many-requests') {
        setErro('Demasiadas tentativas. Tenta mais tarde.')
      } else if (codigo === 'auth/network-request-failed') {
        setErro('Erro de rede. Verifica a ligação.')
      } else {
        setErro(`Erro: ${err?.message || codigo}`)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white border border-gray-100 rounded-2xl p-8 w-full max-w-sm shadow-sm">
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-gray-900">GesWinmax</h1>
          <p className="text-sm text-gray-400 mt-1">Gestão de faturação WinMax4</p>
        </div>
        <form onSubmit={login} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"/>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
            <input type="password" required value={pass} onChange={e => setPass(e.target.value)}
              autoComplete="current-password"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"/>
          </div>
          {erro && (
            <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{erro}</p>
          )}
          <button type="submit" disabled={loading}
            className="w-full py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium">
            {loading ? 'A entrar...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
