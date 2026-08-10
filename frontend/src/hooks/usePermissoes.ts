import { useAuth } from './useAuth'

/**
 * Permissões por utilizador.
 *
 * O utilizador de consulta (usado no acesso via iframe a partir de outra aplicação)
 * vê apenas os módulos de leitura: Dashboard, Dados, Arquivo Digital, SAF-T e
 * Documentos emitidos. Não tem acesso a Emissão, Histórico nem Configurações.
 *
 * LIMITAÇÃO IMPORTANTE — LER ANTES DE CONFIAR NISTO
 * Esta verificação acontece no browser, e serve para ESCONDER opções, não para as
 * proteger. Quem souber os endereços (`/emissao`, `/configuracoes`) ou usar as
 * ferramentas de programador consegue na mesma chamar a API — o backend não valida
 * quem faz cada pedido.
 *
 * Ou seja: isto resolve "não quero que estas opções apareçam a quem consulta",
 * mas não impede um acesso deliberado. Proteger a sério exigiria validar o token
 * do Firebase em cada rota do backend e recusar as operações conforme o utilizador.
 */

/** Email da conta de consulta — ver hooks/useAcessoAutomatico.ts */
const EMAIL_CONSULTA = 'geralamg@missiva.net'

export function usePermissoes() {
  const { user, loading } = useAuth()

  // Comparação sem distinguir maiúsculas, porque o Firebase preserva o que foi
  // escrito no registo mas o utilizador pode entrar com outra combinação.
  const soConsulta = (user?.email || '').trim().toLowerCase() === EMAIL_CONSULTA

  return {
    loading,
    soConsulta,
    /** Emitir faturas a partir de Excel */
    podeEmitir: !soConsulta,
    /** Ver o histórico de emissões */
    podeVerHistorico: !soConsulta,
    /** Alterar configurações e forçar sincronizações completas */
    podeConfigurar: !soConsulta,
  }
}
