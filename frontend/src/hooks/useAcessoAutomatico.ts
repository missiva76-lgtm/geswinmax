import { useEffect, useState } from 'react'
import { auth, signInWithEmailAndPassword } from '../services/firebase'

/**
 * Acesso automático quando a app é aberta a partir de outra aplicação.
 *
 * PARA QUE SERVE
 * O GesWinmax é embebido num iframe noutra aplicação onde o utilizador já se
 * autenticou. Pedir login outra vez seria redundante, por isso a app de fora abre
 * o iframe com uma chave no URL:
 *
 *     https://geswinmax.netlify.app/?acesso=CHAVE
 *
 * Se a chave corresponder, entra-se automaticamente com uma conta dedicada.
 * Sem chave (ou com chave errada), aparece o ecrã de login normal.
 *
 * LIMITAÇÃO DE SEGURANÇA — LER ANTES DE MEXER
 * Quem tiver a chave tem acesso TOTAL à aplicação: importar, sincronizar, emitir
 * faturas, limpar histórico. A chave fica visível no URL do iframe e, portanto, no
 * código-fonte da página que o embebe, no histórico do browser e em eventuais logs
 * de servidores intermédios.
 *
 * Isto só é aceitável enquanto a aplicação de fora tiver acesso restrito. Se algum
 * dia passar a ser pública, esta abordagem deixa de servir — a alternativa correta
 * é partilhar a autenticação Firebase entre as duas aplicações, ou passar as
 * credenciais por `postMessage` com verificação de origem.
 *
 * CONFIGURAÇÃO (variáveis de ambiente no Netlify — nunca no código):
 *   VITE_ACESSO_TOKEN  — a chave secreta
 *   VITE_ACESSO_EMAIL  — conta Firebase a usar
 *   VITE_ACESSO_PASS   — password dessa conta
 *
 * Se qualquer uma faltar, o acesso automático fica simplesmente desativado.
 */
export function useAcessoAutomatico(autenticado: boolean, aVerificar: boolean) {
  const [aEntrar, setAEntrar] = useState(false)
  const [erro, setErro]       = useState<string | null>(null)

  useEffect(() => {
    // Só tenta quando já se sabe que NÃO há sessão iniciada
    if (aVerificar || autenticado || aEntrar) return

    const params = new URLSearchParams(window.location.search)
    const chaveRecebida = params.get('acesso')
    if (!chaveRecebida) return

    const chaveEsperada = import.meta.env.VITE_ACESSO_TOKEN
    const email         = import.meta.env.VITE_ACESSO_EMAIL
    const password      = import.meta.env.VITE_ACESSO_PASS

    if (!chaveEsperada || !email || !password) {
      console.warn('[GesWinmax] Acesso automático não configurado (faltam variáveis de ambiente)')
      return
    }

    if (chaveRecebida !== chaveEsperada) {
      setErro('Chave de acesso inválida')
      return
    }

    setAEntrar(true)
    signInWithEmailAndPassword(auth, email, password)
      .then(() => {
        // Remove a chave da barra de endereço depois de entrar — não a deixa
        // visível nem no histórico de navegação desta sessão.
        const limpo = new URL(window.location.href)
        limpo.searchParams.delete('acesso')
        window.history.replaceState({}, '', limpo.pathname + limpo.search + limpo.hash)
      })
      .catch((e) => {
        console.error('[GesWinmax] Acesso automático falhou:', e)
        setErro('Não foi possível entrar automaticamente')
      })
      .finally(() => setAEntrar(false))
  }, [autenticado, aVerificar, aEntrar])

  return { aEntrar, erro }
}
