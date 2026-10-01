// rpa/loginWinmax.ts — login no WinMax4, usado por TODOS os módulos
//
// PORQUE EXISTE (01/10/2026)
// --------------------------
// Havia cinco cópias do login (winmaxRPA, syncArtigos, syncArquivoDigital,
// syncDocumentos, syncSAFT) e uma sexta na rota de download do arquivo, todas com
// o mesmo defeito. O log do Arquivo Digital de 01/10/2026 11:21 mostrou-o em
// cheio:
//
//   · login 2/5 — a aguardar o formulário de autenticação   10:21:22.062
//   · login 3/5 — credenciais preenchidas, a confirmar      10:21:22.750
//   · login 4/5 — a aguardar o carregamento pós-autenticação 10:22:22.886
//   · ⚠️ ainda no ecrã de login — resposta: ... Utilizador * Password Confirmar
//     ... Atenção Existem campos (assinalados com <*>) com valores não definidos
//     ou incorretos.
//
// O WinMax4 recebeu o formulário VAZIO. O código antigo esperava apenas que o
// ELEMENTO <iframe id="UserAuthentication_content"> existisse e preenchia logo a
// seguir — mas o documento DENTRO do iframe ainda não estava carregado, pelo que
// `doc.getElementById('txtUserLogin')` devolvia null. Como o preenchimento estava
// protegido por `if (u) { ... }`, não dava erro nenhum: simplesmente não escrevia
// nada, clicava em Confirmar e o WinMax4 reclamava dos campos obrigatórios. Entre
// o passo 3 e o 4 passou exactamente 1 minuto, que é o timeout do
// waitForNavigation a expirar porque nunca houve navegação.
//
// É uma condição de corrida, e é por isso que funcionava quase sempre: só falha
// quando o iframe demora mais meio segundo a carregar do que o habitual — algo
// mais provável numa instância do Render acabada de acordar.
//
// O QUE ESTE LOGIN FAZ DE DIFERENTE
// ---------------------------------
// 1. Valida as credenciais ANTES de abrir o browser. Sem utilizador ou password
//    configurados, falha de imediato com uma mensagem clara em vez de gastar
//    três minutos em timeouts.
// 2. Espera pelos CAMPOS dentro do iframe, não pelo iframe. É esta a correção da
//    causa.
// 3. Confirma que os valores ficaram escritos (lê-os de volta) e reaplica até 3
//    vezes antes de clicar em Confirmar. Nunca submete um formulário vazio.
// 4. Depois de confirmar, espera pelo Toolbox OU pela mensagem do WinMax4, em vez
//    de esperar 60s pelo Toolbox e só então olhar para a mensagem.
// 5. Repete o ciclo até 3 vezes SE a mensagem indicar campos em falta (falha
//    nossa). Se a mensagem indicar credenciais inválidas, utilizador inativo ou
//    sessão ocupada, falha logo: repetir seria inútil e pode bloquear a conta —
//    o utilizador do WinMax4 já ficou inativo uma vez (20/09/2026).
import type { Page } from 'playwright'

export interface CredenciaisWinmax {
  // Aceita as duas formas usadas no projeto: config do Firestore (company_code,
  // utilizador, password) e a config do RPA de emissão (companyCode).
  company_code?: string
  companyCode?: string
  utilizador?: string
  password?: string
  winmax_url?: string
}

export interface OpcoesLogin {
  /** Timeout por espera, em ms. Por omissão 90000. */
  timeout?: number
  /** Nº de tentativas completas quando o formulário é submetido vazio. Por omissão 3. */
  tentativas?: number
  /** Prefixo das linhas de log. Por omissão '  · '. */
  prefixo?: string
}

const BASE_POR_OMISSAO = 'https://app102.winmax4.com'

/** Mensagens do WinMax4 que indicam que o formulário chegou vazio (falha nossa). */
function pedeNovaTentativa(msg: string): boolean {
  const m = msg.toLowerCase()
  return m.includes('não definidos')
      || m.includes('nao definidos')
      || m.includes('valores não')
      || m.includes('valores nao')
}

export async function loginWinmax(
  page: Page,
  config: CredenciaisWinmax,
  log?: (msg: string) => Promise<void> | void,
  opcoes?: OpcoesLogin,
): Promise<void> {
  const timeout    = opcoes?.timeout ?? 90000
  const tentativas = opcoes?.tentativas ?? 3
  const prefixo    = opcoes?.prefixo ?? '  · '

  const passo = async (msg: string) => {
    console.log(`[login] ${msg}`)
    await log?.(`${prefixo}${msg}`)
  }

  const utilizador = (config.utilizador || '').trim()
  const password   = config.password || ''
  const empresa    = config.company_code || config.companyCode || 'AUTOAVENIDA'
  const base       = (config.winmax_url || BASE_POR_OMISSAO).replace(/\/+$/, '')
  const url        = `${base}/MainPage.aspx?CompanyCode=${empresa}`

  // 1. Credenciais — falhar aqui poupa minutos de timeouts sem explicação.
  if (!utilizador || !password) {
    throw new Error(
      'Credenciais do WinMax4 em falta na configuração '
      + `(utilizador: ${utilizador ? 'definido' : 'VAZIO'}, password: ${password ? 'definida' : 'VAZIA'}). `
      + 'Preencher em Configurações na aplicação.'
    )
  }

  let ultimaMensagem = ''

  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    if (tentativa > 1) await passo(`login — nova tentativa (${tentativa}/${tentativas})`)

    await passo('login 1/5 — a abrir a página do WinMax4')
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout })

    // 2. Esperar pelos CAMPOS dentro do iframe (e não apenas pelo iframe).
    await passo('login 2/5 — a aguardar os campos de autenticação')
    await page.waitForFunction(() => {
      const f = document.getElementById('UserAuthentication_content') as HTMLIFrameElement | null
      const doc = f?.contentDocument
      if (!doc) return false
      const u = doc.getElementById('txtUserLogin') as HTMLInputElement | null
      const p = doc.getElementById('txtUserPassword') as HTMLInputElement | null
      const b = doc.getElementById('wucButtonConfirm_linkButton1')
      // offsetParent !== null garante que o campo está realmente visível/renderizado.
      return !!u && !!p && !!b && u.offsetParent !== null
    }, undefined, { timeout })

    // 3. Preencher e confirmar que os valores ficaram escritos.
    let escrito = false
    for (let i = 1; i <= 3 && !escrito; i++) {
      const resultado = await page.evaluate(({ user, pass }: { user: string; pass: string }) => {
        const f = document.getElementById('UserAuthentication_content') as HTMLIFrameElement | null
        const doc = f?.contentDocument
        if (!doc) return { ok: false, user: '', passLen: 0, motivo: 'documento do iframe indisponível' }
        const u = doc.getElementById('txtUserLogin') as HTMLInputElement | null
        const p = doc.getElementById('txtUserPassword') as HTMLInputElement | null
        if (!u || !p) return { ok: false, user: '', passLen: 0, motivo: 'campos não encontrados' }
        for (const [el, valor] of [[u, user], [p, pass]] as [HTMLInputElement, string][]) {
          el.focus()
          el.value = valor
          // 'input' e 'change': os WebForms do WinMax4 reagem ao change, mas o
          // input mantém coerente qualquer validação do lado do cliente.
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
          el.blur()
        }
        // Lê de volta — é esta leitura que impede submeter um formulário vazio.
        return { ok: u.value === user && p.value.length === pass.length, user: u.value, passLen: p.value.length, motivo: '' }
      }, { user: utilizador, pass: password })

      escrito = resultado.ok
      if (!escrito) {
        await passo(`login — campos não aceitaram os valores (tentativa ${i}/3): `
          + `utilizador="${resultado.user}" password=${resultado.passLen} caracteres`
          + (resultado.motivo ? ` — ${resultado.motivo}` : ''))
        await page.waitForTimeout(1000)
      }
    }
    if (!escrito) {
      ultimaMensagem = 'não foi possível escrever as credenciais no formulário'
      continue  // nova tentativa completa, com recarga da página
    }

    await passo('login 3/5 — credenciais preenchidas e confirmadas no formulário')
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout }).catch(() => {}),
      page.evaluate(() => {
        const f = document.getElementById('UserAuthentication_content') as HTMLIFrameElement | null
        ;(f?.contentDocument?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
      }),
    ])

    // 4. Esperar pelo Toolbox OU por uma mensagem do WinMax4 — o que vier primeiro.
    await passo('login 4/5 — a aguardar a resposta do WinMax4')
    const desfecho = await page.waitForFunction(() => {
      if (document.getElementById('Toolbox_content')) return { tipo: 'toolbox', msg: '' }
      const f = document.getElementById('UserAuthentication_content') as HTMLIFrameElement | null
      const texto = f?.contentDocument?.body?.innerText?.replace(/\s+/g, ' ').trim() || ''
      // "Atenção" é o cabeçalho do painel de avisos do WinMax4.
      if (texto.includes('Atenção')) return { tipo: 'mensagem', msg: texto }
      return false
    }, undefined, { timeout }).then(h => h.jsonValue()).catch(() => null)

    if (desfecho && desfecho.tipo === 'toolbox') {
      await passo('login 5/5 — Toolbox presente')
      await log?.('✅ Login OK')
      return
    }

    const mensagem = desfecho?.msg?.slice(0, 600) || ''
    if (mensagem) {
      ultimaMensagem = mensagem
      await passo(`⚠️ resposta do WinMax4: ${mensagem}`)
      if (!pedeNovaTentativa(mensagem)) {
        // Credenciais inválidas, utilizador inativo, sessão ocupada: repetir não
        // resolve e pode bloquear a conta.
        throw new Error(`Login recusado pelo WinMax4: ${mensagem}`)
      }
      continue
    }

    // Nem Toolbox nem mensagem dentro do timeout: pode ser lentidão. Confirma o
    // Toolbox uma última vez antes de desistir desta tentativa.
    const temToolbox = await page.evaluate(() => !!document.getElementById('Toolbox_content')).catch(() => false)
    if (temToolbox) {
      await passo('login 5/5 — Toolbox presente (resposta lenta)')
      await log?.('✅ Login OK')
      return
    }
    ultimaMensagem = `sem Toolbox e sem mensagem do WinMax4 após ${timeout} ms`
    await passo(`⚠️ ${ultimaMensagem}`)
  }

  throw new Error(`Login falhou após ${tentativas} tentativas — ${ultimaMensagem}`)
}
