// rpa/winmaxRPA.ts — Motor RPA WinMax4 AUTOAVENIDA
// Seletores descobertos ao vivo em 16/06/2026
// CORRIGIDO 02/07/2026: bug de sintaxe em evalIn (const/if dentro de return(), 'as HTMLInputElement'
// em string injetada no browser) que impedia preenchimento de Preço/Quantidade/Desconto/limpeza de cliente.

import * as path from 'path'
import * as fs from 'fs'
import { Browser, BrowserContext, Page, chromium } from 'playwright'
import { Fatura, ResultadoFatura, ErroLinha } from '../types'
import { logger } from '../services/logger'
import { appendJobLog } from '../services/firebase'
import { acquireBrowserLock } from '../services/browserLock'

interface RPAConfig {
  winmaxUrl: string
  companyCode: string
  utilizador: string
  password: string
  templatePDF: string
  pastaDestinoPDF: string
  jobId?: string   // para log em tempo real no Firestore
}

const SEL = {
  loginUser:   '#txtUserCode',
  loginPass:   '#txtPassword',
  loginBtn:    '#btnLogin',
  entityCode:  '#txtEntityCode',
  entityName:  '#lblEntityName',
  docType:     '#ddlDocumentType',
  nextDocNum:  '#lblNextDocumentNumber',
  articleCode: '#txtArticleCode',
  designation: '#txtDesignation',
  taxFeeRate:  '#ddlTaxFeeRates',
  unitPrice:   '#txtUnitaryPrice',
  quantity:    '#txtQuantity',
  discount1:   '#txtDiscount1',
  remarksBtn:  'input[id^="DetailPropertyRemarks"]',
  remarksTxt:  '#txtRemarks',
  confirmBtn:  '#wucButtonConfirm_linkButton1',
  printReport: '#ddlPrintReportName',
  msgPanel:    '#wucMessagePanel1_idMessagePanel',
  msgBody:     '#wucMessagePanel1_LabelMessageDiv',
}

const TIPO_DOC: Record<string, string> = {
  FAA: '37',  // Fatura A
  FR:  '55',  // Fatura Recibo
  FS:  '46',  // Fatura Simplificada
  FTB: '45',  // Fat Recibo B
  FRB: '53',  // Fatura Reboque ← confirmado ao vivo 19/06/2026
  NCC: '40',  // Nota de Crédito
  GT:  '49',  // Guia de Transporte
  FO:  '50',  // Folha de Obra
  GR:  '3',   // Guia de Remessa
  NBB: '43',  // Nota de Débito
  ORR: '42',  // Orçamento
  REE: '35',  // Recibo
  RC:  '48',  // Recibo IVA Caixa
  VDD: '33',  // Venda a Dinheiro
  VDB: '34',  // Venda a Dinheiro B
  CM:  '59',  // Comprovativo
  CO:  '56',  // Conta
}

const MENU = {
  imprimir:            'transactionDocumentsIssueCustomerStandardDocumentPrint',
  terminar:            'transactionDocumentsIssueCustomerStandardDocumentClose',
  terminarSemImprimir: 'transactionDocumentsIssueCustomerStandardDocumentCloseWithoutPrinting',
}

class ErroLinhaArtigo extends Error {
  constructor(
    public readonly linha: number,
    public readonly artigo_ref: string,
    msg: string
  ) { super(msg); this.name = 'ErroLinhaArtigo' }
}

export class WinmaxRPA {
  private browser: Browser | null = null
  private releaseLock: (() => void) | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private config: RPAConfig
  // CORRIGIDO 08/07/2026: marca se a fatura ANTERIOR falhou especificamente durante o
  // fecho do documento (não durante a edição normal) — ver nota detalhada em
  // imprimirEGuardarPDF. Usado por abrirNovaFatura() para decidir se precisa de uma
  // recuperação mais agressiva (recarregar a página) em vez do abandono normal.
  private falhaDuranteFecho = false

  constructor(config: RPAConfig) { this.config = config }

  private async log(msg: string) {
    logger.info(msg)
    if (this.config.jobId) {
      await appendJobLog(this.config.jobId, msg).catch(() => {})
    }
  }

  async iniciar(): Promise<void> {
    await this.log('🚀 A iniciar browser Playwright...')
    if (!fs.existsSync(this.config.pastaDestinoPDF)) {
      fs.mkdirSync(this.config.pastaDestinoPDF, { recursive: true })
    }
    // Semáforo: só um browser de cada vez no Render
    this.releaseLock = await acquireBrowserLock()
    // Usa chromium em vez de chromium-headless-shell (mais compatível com Render)
    this.browser = await chromium.launch({ 
      headless: true, 
      slowMo: 40,
      channel: undefined,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    })
    this.context = await this.browser.newContext({
      locale: 'pt-PT',
      timezoneId: 'Europe/Lisbon',
      acceptDownloads: true,
      storageState: { cookies: [], origins: [] },
    })
    this.page = await this.context.newPage()
    await this.log('✅ Browser iniciado (headless)')
  }

  async fechar(): Promise<void> { 
    await this.browser?.close()
    this.releaseLock?.()
    this.releaseLock = null
  }

  async login(): Promise<void> {
    // WinMax4 abre no MainPage.aspx com iframe UserAuthentication_content
    const url = `https://app102.winmax4.com/MainPage.aspx?CompanyCode=${this.config.companyCode}`
    await this.log(`🔑 Login: ${url}`)
    await this.page!.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await this.page!.waitForTimeout(2000)

    // Aguarda iframe de autenticação
    await this.page!.waitForFunction(
      () => !!document.getElementById('UserAuthentication_content'),
      { timeout: 60000 }
    )

    // Preenche utilizador e password no iframe
    await this.page!.evaluate(({ user, pass }: { user: string; pass: string }) => {
      const f   = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
      const doc = f?.contentDocument
      if (!doc) return
      const u = doc.getElementById('txtUserLogin')    as HTMLInputElement
      const p = doc.getElementById('txtUserPassword') as HTMLInputElement
      if (u) { u.value = user; u.dispatchEvent(new Event('change', { bubbles: true })) }
      if (p) { p.value = pass; p.dispatchEvent(new Event('change', { bubbles: true })) }
    }, { user: this.config.utilizador, pass: this.config.password })
    await this.page!.waitForTimeout(500)

    // Clica Confirmar — o WinMax4 faz uma navegação após login bem sucedido
    await Promise.all([
      this.page!.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}),
      this.page!.evaluate(() => {
        const f = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
        ;(f?.contentDocument?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
      })
    ])
    await this.page!.waitForTimeout(2000)

    // Verifica se o login foi bem sucedido — aguarda que o Toolbox esteja presente
    try {
      await this.page!.waitForFunction(
        () => !!document.getElementById('Toolbox_content'),
        { timeout: 60000 }
      )
    } catch {
      await this.page!.screenshot({ path: 'logs/erro-login.png' })
      throw new Error('Login falhou — Toolbox não carregou após autenticação')
    }
    await this.log('✅ Login OK')
  }

  private async iframeExiste(iframeId: string): Promise<boolean> {
    // CORRIGIDO 03/07/2026: em lotes grandes (ex: 33 faturas), observado em produção
    // que o iframe DocumentIssue_content pode desaparecer por completo a meio de uma
    // linha (provável timeout de sessão, popup inesperado do WinMax4, ou recarga da
    // página). Sem esta verificação, o código perdia tempo em tentativas de reaplicar
    // valores que nunca poderiam funcionar, e o clique final em "Inserir" ficava
    // pendurado até ao timeout por omissão do Playwright (~30s) antes de desistir.
    // Esta verificação é rápida (não lança exceção) e permite desistir de imediato.
    return this.page!.evaluate((id: string) => {
      const f = document.getElementById(id) as HTMLIFrameElement
      return !!(f?.contentWindow && f?.contentDocument)
    }, iframeId).catch(() => false)
  }

  private async dismissarOverlayPreso(): Promise<void> {
    // CORRIGIDO 04/07/2026: o WinMax4 mostra um overlay "a processar" (ShowProcessingPanel(),
    // visível no onclick do botão "Inserir": id="overlay_modal") sempre que envia um pedido
    // ao servidor, e esconde-o quando a resposta chega. Se essa resposta nunca chegar (rede,
    // lentidão do servidor), o overlay fica preso visível PARA SEMPRE, bloqueando todos os
    // cliques reais seguintes — confirmado em produção: "locator.click: Timeout 30000ms
    // exceeded ... <div id="overlay_modal"> intercepts pointer events", repetido em 2 faturas
    // consecutivas (o overlay vive ao nível da página principal, não do iframe do documento,
    // por isso sobrevive a abrir/fechar documentos), até o próprio browser falhar.
    // Havia já uma proteção parcial (esperar até 10s que desaparecesse sozinho) em
    // adicionarComentario, mas isso não chega quando fica preso permanentemente — por isso
    // aqui FORÇAMOS a ocultação em vez de apenas esperar, e aplicamos antes de todos os
    // cliques/preenchimentos reais no documento.
    await this.page!.evaluate(() => {
      const overlay = document.getElementById('overlay_modal') as HTMLElement | null
      if (overlay) {
        overlay.style.display = 'none'
        overlay.style.pointerEvents = 'none'
      }
    }).catch(() => {})
  }

  private async evalIn(iframeId: string, code: string): Promise<unknown> {
    // Usa script injetado no DOM do iframe para evitar restrições de strict mode
    // (window.eval em strict mode bloqueia 'arguments' usado pelo ASP.NET WebForms)
    // IMPORTANTE: 'code' deve ser sempre uma ÚNICA EXPRESSÃO válida (ex: uma IIFE),
    // porque é injetado dentro de `return ( code )`. Nunca usar 'const'/'if' soltos aqui,
    // nem sintaxe TypeScript (ex: 'as HTMLInputElement') — isto corre no browser como
    // JavaScript puro, não passa pelo compilador tsc.
    return this.page!.evaluate(
      ({ id, code }) => {
        const f = document.getElementById(id) as HTMLIFrameElement
        if (!f?.contentWindow || !f?.contentDocument) throw new Error(`Iframe não encontrado: ${id}`)
        const doc = f.contentDocument
        // Remove script anterior se existir
        const old = doc.getElementById('__rpa_eval__')
        if (old) old.remove()
        return new Promise<unknown>((resolve, reject) => {
          try {
            // Cria um script que executa no contexto do iframe (não-strict)
            const script = doc.createElement('script')
            script.id = '__rpa_eval__'
            script.textContent = `
              (function() {
                try {
                  var __result__ = (function() { return (${code}); })();
                  window.__rpa_result__ = __result__;
                  window.__rpa_error__ = null;
                } catch(e) {
                  window.__rpa_result__ = null;
                  window.__rpa_error__ = e.message || String(e);
                }
              })();
            `
            doc.head.appendChild(script)
            const err = (f.contentWindow as any).__rpa_error__
            if (err) reject(new Error(err))
            else resolve((f.contentWindow as any).__rpa_result__)
          } catch(e: any) {
            reject(e)
          }
        })
      },
      { id: iframeId, code }
    )
  }

  private async waitFor(iframeId: string, selector: string, timeout = 60000): Promise<void> {
    await this.page!.waitForFunction(
      ({ id, sel }) => {
        const f = document.getElementById(id) as HTMLIFrameElement
        if (!f) return false
        const doc = f.contentDocument
        if (!doc || doc.readyState === 'loading') return false
        return !!doc.querySelector(sel)
      },
      { id: iframeId, sel: selector },
      { timeout, polling: 500 }
    )
  }

  private async verificarErro(di: string): Promise<string | null> {
    // O painel de erro do WinMax4 está sempre no DOM — só conta se tiver texto
    return this.page!.evaluate(({ id, bodySel }) => {
      const f = document.getElementById(id) as HTMLIFrameElement
      const doc = f?.contentDocument
      if (!doc) return null
      const body = doc.querySelector(bodySel) as HTMLElement
      const texto = body?.innerText?.trim() || ''
      return texto.length > 0 ? texto : null
    }, { id: di, bodySel: SEL.msgBody })
  }

  private async abandonarDocumento(): Promise<void> {
    try {
      const di = 'DocumentIssue_content'

      // 1. Apagar todas as linhas existentes (padrão DeleteCompound*)
      let tentativas = 0
      while (tentativas < 20) {
        // CORRIGIDO: tinha '(btns[0] as HTMLElement)' — sintaxe TS inválida em string
        // injetada no browser. Falhava sempre silenciosamente (apanhado pelo .catch abaixo),
        // fazendo crer que não havia linhas a apagar mesmo quando havia — documentos
        // abandonados podiam ficar com linhas residuais.
        const temLinhas = await this.evalIn(di, `
          (function() {
            var btns = document.querySelectorAll('[id^="DeleteCompound"]');
            if (btns.length === 0) return false;
            btns[0].click();
            return true;
          })()
        `).catch((e) => { this.log(`  ⚠️ Falha ao apagar linha: ${e}`); return false })
        
        if (!temLinhas) break
        
        // Confirmar eliminação se aparecer confirmação
        await this.page!.waitForTimeout(500)
        await this.evalIn(di, `
          document.getElementById('LbConfirmDeleteRow')?.click()
        `).catch(() => {})
        await this.page!.waitForTimeout(500)
        tentativas++
      }

      // 2. Limpar campo de cliente
      // CORRIGIDO: era `const el = ... as HTMLInputElement` solto (sintaxe TS inválida
      // no browser, e 'const'+'if' não cabem dentro de `return(...)`). Agora IIFE válida.
      await this.evalIn(di, `
        (function() {
          var el = document.getElementById('txtEntityCode');
          if (el) { el.value = ''; el.dispatchEvent(new Event('change', { bubbles: true })); }
          return true;
        })()
      `).catch((e) => this.log(`  ⚠️ Falha ao limpar cliente: ${e}`))
      await this.page!.waitForTimeout(300)

      // 3. Sair do documento
      await this.evalIn(di, `
        document.getElementById('wucButtonExit_linkButton1')?.click()
      `).catch(() => {})
      await this.page!.waitForTimeout(2000)

      // 4. Fechar a listagem que abre após sair
      await this.fecharListagem()
      await this.page!.waitForTimeout(1000)

      await this.log('  🚫 Documento abandonado (linhas apagadas)')
    } catch (e) {
      await this.log(`  ⚠️ Erro ao abandonar: ${e}`)
    }
  }

  private async fecharListagem(): Promise<void> {
    try {
      // Tenta fechar qualquer iframe de listagem/documento aberto
      const fechou = await this.page!.evaluate(() => {
        // Botões de fechar conhecidos no contexto principal
        const btnIds = [
          'wucButtonClose_linkButton1',
          'wucButtonExit_linkButton1', 
          'wucButtonCancel_linkButton1',
        ]
        // Procura em iframes de listagem
        const iframeIds = [
          'transactionDocumentsIssueCustomerStandard_content',
          'transactionDocuments_content',
          'DocumentIssue_content',
        ]
        for (const iframeId of iframeIds) {
          const f = document.getElementById(iframeId) as HTMLIFrameElement
          const doc = f?.contentDocument
          if (!doc) continue
          for (const btnId of btnIds) {
            const btn = doc.getElementById(btnId) as HTMLElement
            if (btn && btn.offsetParent !== null) {
              btn.click()
              return true
            }
          }
        }
        return false
      }).catch(() => false)

      if (fechou) {
        await this.page!.waitForTimeout(1500)
        await this.log('  📋 Listagem/documento fechado')
      }
    } catch { /**/ }
  }

  private async abrirNovaFatura(): Promise<void> {
    // CORRIGIDO 08/07/2026: se a fatura ANTERIOR falhou especificamente durante o fecho
    // do documento (ver falhaDuranteFecho em imprimirEGuardarPDF), o abandonarDocumento()
    // normal pode não bastar — foi concebido para um documento ainda em edição, não um
    // que já entrou no fluxo de "Terminar". Confirmado em produção: depois de uma falha
    // destas, a fatura seguinte teve um erro espúrio "Cliente inválido" para um cliente
    // que tinha funcionado momentos antes — sinal de estado de sessão corrompido.
    // Nestes casos, recarrega-se a página e faz-se login de novo, em vez de apenas
    // tentar abandonar o documento — mais lento, mas garante um estado limpo.
    if (this.falhaDuranteFecho) {
      await this.log('  🔄 A fatura anterior falhou durante o fecho do documento — a recarregar sessão para garantir estado limpo...')
      this.falhaDuranteFecho = false
      try {
        await this.login()
      } catch (e) {
        await this.log(`  ⚠️ Falha ao recarregar sessão: ${e} — a tentar recuperação normal`)
      }
    }

    // Verificar se há documento aberto — se sim, abandonar primeiro
    const documentoAberto = await this.page!.evaluate(() => {
      const f = document.getElementById('DocumentIssue_content') as HTMLIFrameElement
      return !!(f?.contentDocument?.getElementById('ddlDocumentType'))
    }).catch(() => false)

    if (documentoAberto) {
      await this.log('  ⚠️ Documento aberto detetado — a abandonar antes de continuar...')
      await this.abandonarDocumento()
      await this.page!.waitForTimeout(1500)
    }

    // Garante que o Toolbox está carregado antes de clicar
    await this.page!.waitForFunction(
      () => {
        const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
        const doc = tb?.contentDocument
        return !!(doc && doc.readyState === 'complete' &&
          doc.querySelectorAll('div[id^="Toolbox_ShortcutIconDiv"]').length > 0)
      },
      { timeout: 60000, polling: 500 }
    )

    // Verifica se o atalho existe e clica
    const encontrado = await this.page!.evaluate(() => {
      const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
      const tbDoc = tb?.contentDocument
      const divs = Array.from(tbDoc?.querySelectorAll('div[id^="Toolbox_ShortcutIconDiv"]') || [])
      const docClientes = divs.find(d => d.getAttribute('title') === 'Documentos de clientes') as HTMLElement | undefined
      if (docClientes) { docClientes.click(); return true }
      return false
    })
    await this.log(`  🖱️ Clique "Documentos de clientes": ${encontrado ? 'OK' : 'NÃO ENCONTRADO'}`)

    // Aguarda o iframe aparecer no DOM
    await this.page!.waitForFunction(
      () => !!document.getElementById('transactionDocumentsIssueCustomerStandard_content'),
      { timeout: 60000, polling: 300 }
    )
    await this.log('  📋 Iframe transactionDocuments presente')

    // Aguarda o botão dentro do iframe
    await this.waitFor('transactionDocumentsIssueCustomerStandard_content',
      '#wucFileList1_wucButtonInsert_linkButton1', 20000)
    await this.log('  📂 Lista de documentos carregada')
    await this.page!.waitForTimeout(800)
    await this.page!.evaluate(() => {
      const li = document.getElementById('transactionDocumentsIssueCustomerStandard_content') as HTMLIFrameElement
      ;(li?.contentDocument?.getElementById('wucFileList1_wucButtonInsert_linkButton1') as HTMLElement)?.click()
    })
    await this.waitFor('DocumentIssue_content', SEL.entityCode, 60000)
    await this.page!.waitForTimeout(800)
  }

  private async preencherCabecalho(fatura: Fatura): Promise<void> {
    const di = 'DocumentIssue_content'
    const tipoVal = TIPO_DOC[fatura.tipo_documento] ?? '37'

    // Aguarda que o ddlDocumentType esteja enabled (não disabled) antes de tentar selecionar
    await this.page!.waitForFunction(
      (id: string) => {
        const f = document.getElementById(id) as HTMLIFrameElement
        const s = f?.contentDocument?.getElementById('ddlDocumentType') as HTMLSelectElement
        return s && !s.disabled
      },
      di,
      { timeout: 30000, polling: 500 }
    ).catch(async () => {
      await this.log('  ⚠️ ddlDocumentType ainda disabled — a tentar fechar documento aberto...')
      await this.abandonarDocumento()
      await this.page!.waitForTimeout(2000)
      await this.abrirNovaFatura()
      // Segunda tentativa de aguardar enabled
      await this.page!.waitForFunction(
        (id: string) => {
          const f = document.getElementById(id) as HTMLIFrameElement
          const s = f?.contentDocument?.getElementById('ddlDocumentType') as HTMLSelectElement
          return s && !s.disabled
        },
        di,
        { timeout: 30000, polling: 500 }
      )
    })

    // Muda tipo de documento via frameLocator (mais fiável no Playwright headless)
    await this.dismissarOverlayPreso()
    await this.page!.frameLocator('#DocumentIssue_content')
      .locator('#ddlDocumentType')
      .selectOption(tipoVal)
    
    // Aguarda postback completar — espera que o valor seja confirmado
    const tipoOk = await this.page!.waitForFunction(
      ({ id, val }: { id: string; val: string }) => {
        const f = document.getElementById(id) as HTMLIFrameElement
        const doc = f?.contentDocument
        if (!doc || doc.readyState !== 'complete') return false
        const s = doc.getElementById('ddlDocumentType') as HTMLSelectElement
        return s?.value === val
      },
      { id: di, val: tipoVal },
      { timeout: 20000, polling: 300 }
    ).then(() => true).catch(() => false)
    
    await this.page!.waitForTimeout(500)
    const tipoAtual = await this.evalIn(di, `document.getElementById('ddlDocumentType')?.value || ''`)
    await this.log(`  📄 Tipo documento: ${fatura.tipo_documento} (val=${tipoAtual})${tipoOk ? '' : ' ⚠️ não confirmado'}`)

    // Preenche código do cliente usando frameLocator do Playwright (mais fiável que evalIn para inputs)
    await this.dismissarOverlayPreso()
    const frame = this.page!.frameLocator(`#${di}`)
    await frame.locator('#txtEntityCode').fill(String(fatura.cliente_codigo))
    await frame.locator('#txtEntityCode').press('Tab')
    await this.page!.waitForTimeout(500)

    // Aguarda o postback de validação do cliente (lblEntityName preenche quando válido)
    await this.page!.waitForFunction(
      (id: string) => {
        const f = document.getElementById(id) as HTMLIFrameElement
        const nome = f?.contentDocument?.getElementById('lblEntityName')?.innerText?.trim() || ''
        return nome.length > 0
      },
      di,
      { timeout: 60000, polling: 500 }
    )

    const erroEnt = await this.verificarErro(di)
    if (erroEnt) throw new Error(`Cliente inválido (${fatura.cliente_codigo}): ${erroEnt}`)
    const nome = await this.evalIn(di, `document.getElementById('lblEntityName')?.innerText || ''`)
    await this.log(`  👤 ${nome} (${fatura.cliente_codigo}) | ${fatura.tipo_documento}`)
  }

  private async adicionarLinhaArtigo(linha: Fatura['linhas'][0], idx: number): Promise<void> {
    const di = 'DocumentIssue_content'
    const n = idx + 1

    // Verificação rápida antes de sequer tentar abrir a linha — evita ficar pendurado
    // no timeout por omissão do Playwright (~30s) se o documento já tiver desaparecido
    // (ver nota detalhada em iframeExiste()).
    if (!(await this.iframeExiste(di))) {
      throw new ErroLinhaArtigo(n, linha.artigo_ref,
        `Linha ${n} — "${linha.artigo_ref}": iframe do documento desapareceu antes de iniciar a linha (possível timeout de sessão ou popup inesperado do WinMax4)`)
    }

    // Clica "Inserir" para abrir o formulário de nova linha
    await this.dismissarOverlayPreso()
    await this.page!.frameLocator('#DocumentIssue_content')
      .locator('#wucButtonInsertDocumentDetail_linkButton1')
      .click()
    await this.waitFor(di, '#txtArticleCode', 10000)
    await this.page!.waitForTimeout(300)

    // Insere referência do artigo via frameLocator — WinMax4 preenche descrição e IVA automaticamente
    await this.dismissarOverlayPreso()
    await this.page!.frameLocator('#DocumentIssue_content')
      .locator('#txtArticleCode')
      .fill(linha.artigo_ref)
    await this.page!.frameLocator('#DocumentIssue_content')
      .locator('#txtArticleCode')
      .press('Tab')
    // Aguardar que o artigo carregue — pelo menos a descrição deve ficar preenchida
    await this.page!.waitForFunction(
      (id: string) => {
        const f = document.getElementById(id) as HTMLIFrameElement
        const desc = f?.contentDocument?.getElementById('txtArticleDesignation') as HTMLInputElement
        return desc && desc.value && desc.value.length > 0
      },
      di,
      { timeout: 15000, polling: 300 }
    ).catch(() => {})
    await this.page!.waitForTimeout(500)

    const erroArtigo = await this.verificarErro(di)
    if (erroArtigo) {
      // CORRIGIDO 02/07/2026: produção registou "Artigo não definido ou inválido" para o
      // código TX, que é um artigo válido e existente (confirmado no WinMax4 e via MCP,
      // reproduzindo a mesma sequência sem erro). O artigo_ref já vem .trim().toUpperCase()
      // desde emissaoJob.ts, por isso não é problema de dados sujos. A hipótese mais provável
      // é uma mensagem de validação transitória do WinMax4 (ex: sob latência/carga no Render),
      // que se resolve sozinha pouco depois. Por isso, reconfirmamos antes de desistir da linha.
      await this.log(`  ⏳ Possível erro no artigo "${linha.artigo_ref}" — a reconfirmar antes de desistir...`)
      await this.page!.waitForTimeout(1500)
      const erroArtigoConfirmado = await this.verificarErro(di)
      if (erroArtigoConfirmado) {
        throw new ErroLinhaArtigo(n, linha.artigo_ref,
          `Linha ${n} — "${linha.artigo_ref}": ${erroArtigoConfirmado}`)
      }
      await this.log(`  ✅ Falso alarme — mensagem desapareceu, artigo "${linha.artigo_ref}" válido`)
    }

    // Aguardar que txtUnitaryPrice esteja enabled (artigo carregado)
    await this.page!.waitForFunction(
      (id: string) => {
        const f = document.getElementById(id) as HTMLIFrameElement
        const el = f?.contentDocument?.getElementById('txtUnitaryPrice') as HTMLInputElement
        return el && !el.disabled
      },
      di,
      { timeout: 15000, polling: 300 }
    ).catch(() => {})

    // Preencher preço sempre — se for 0 força zero (substitui o preço da ficha)
    // CORRIGIDO: bloco anterior tinha 'const ... as HTMLInputElement' e 'if' soltos dentro
    // de return(...) do evalIn — nunca chegava a correr (erro de sintaxe silencioso).
    const precoStr = String(linha.preco_unitario).replace('.', ',')
    await this.evalIn(di, `
      (function() {
        var el = document.getElementById('txtUnitaryPrice');
        if (el) {
          el.value = '${precoStr}';
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        }
        return true;
      })()
    `).catch((e) => this.log(`  ⚠️ Falha ao preencher preço: ${e}`))
    await this.page!.waitForTimeout(300)

    // Quantidade — preencher sempre via evaluate para garantir o valor correto
    // CORRIGIDO: mesmo problema de sintaxe do bloco do preço.
    const qtdStr = String(linha.quantidade).replace('.', ',')
    await this.evalIn(di, `
      (function() {
        var el = document.getElementById('txtQuantity');
        if (el) {
          el.value = '${qtdStr}';
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        }
        return true;
      })()
    `).catch((e) => this.log(`  ⚠️ Falha ao preencher quantidade: ${e}`))
    await this.page!.waitForTimeout(500)

    // Desconto (vem do Excel)
    // CORRIGIDO: bloco anterior não tinha 'if (d)' de proteção nem '.catch()' —
    // se o elemento não existisse ou o script falhasse, a exceção subia e podia
    // interromper todo o criarFatura a meio, deixando o documento aberto/preso.
    if (linha.desconto_pct > 0) {
      await this.evalIn(di, `
        (function() {
          var d = document.getElementById('txtDiscount1');
          if (d) {
            d.value = '${String(linha.desconto_pct).replace('.', ',')}';
            d.dispatchEvent(new Event('change', { bubbles: true }));
            d.dispatchEvent(new Event('blur', { bubbles: true }));
          }
          return true;
        })()
      `).catch((e) => this.log(`  ⚠️ Falha ao preencher desconto: ${e}`))
      await this.page!.waitForTimeout(300)
    }

    // IVA e descrição vêm da ficha do artigo no WinMax4 — não se preenchem

    // CORRIGIDO 03/07/2026: em produção, o campo Quantidade por vezes reverte para o
    // valor por omissão (1) mesmo depois de o preenchermos corretamente (confirmado no
    // log: "📦 Linha 3: KM x55 @ 0.4€" mas a fatura emitida mostrou Quantidade=1,00).
    // O log antigo só mostrava o valor PRETENDIDO (do Excel), não o que ficou de facto
    // no campo — não provava sucesso. A causa mais provável é o WinMax4 (ASP.NET
    // WebForms) disparar um postback assíncrono ao alterar o Preço unitário (recalcular
    // totais da linha), que só termina DEPOIS de já termos escrito a Quantidade,
    // repondo-a ao valor por omissão quando a resposta do servidor atualiza a linha.
    // No teste manual via MCP isto não aparecia porque cada passo tinha tempo de sobra
    // entre ações; no RPA automático os intervalos são fixos e mais curtos.
    // Correção: em vez de tentar adivinhar o tempo exato do postback, verificamos e
    // reaplicamos os valores mesmo antes de clicar em "Inserir" — corrige qualquer
    // desvio de última hora, independentemente da causa exata.
    const paraComparar = (v: string) => Number(String(v).replace(',', '.'))
    const lerCampo = async (id: string): Promise<string> =>
      (await this.evalIn(di, `document.getElementById('${id}')?.value || ''`).catch(() => '')) as string

    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      // Verificação rápida: se o iframe do documento desapareceu por completo (timeout de
      // sessão, popup inesperado, recarga da página), não vale a pena continuar a tentar
      // reaplicar valores — isso nunca vai funcionar. Desiste já com uma mensagem clara,
      // em vez de perder ~30s no timeout por omissão do clique em "Inserir" mais à frente.
      if (!(await this.iframeExiste(di))) {
        throw new ErroLinhaArtigo(n, linha.artigo_ref,
          `Linha ${n} — "${linha.artigo_ref}": iframe do documento desapareceu (possível timeout de sessão ou popup inesperado do WinMax4)`)
      }

      const precoAtual = await lerCampo('txtUnitaryPrice')
      const qtdAtual = await lerCampo('txtQuantity')
      const precoOk = paraComparar(precoAtual) === paraComparar(precoStr)
      const qtdOk = paraComparar(qtdAtual) === paraComparar(qtdStr)

      if (precoOk && qtdOk) break

      await this.log(`  ⚠️ Divergência antes de inserir (tentativa ${tentativa}): preço campo="${precoAtual}" esperado="${precoStr}" | qtd campo="${qtdAtual}" esperado="${qtdStr}" — a reaplicar`)

      if (!precoOk) {
        await this.evalIn(di, `
          (function() {
            var el = document.getElementById('txtUnitaryPrice');
            if (el) {
              el.value = '${precoStr}';
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.dispatchEvent(new Event('blur', { bubbles: true }));
            }
            return true;
          })()
        `).catch((e) => this.log(`  ⚠️ Falha ao reaplicar preço: ${e}`))
      }
      if (!qtdOk) {
        await this.evalIn(di, `
          (function() {
            var el = document.getElementById('txtQuantity');
            if (el) {
              el.value = '${qtdStr}';
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.dispatchEvent(new Event('blur', { bubbles: true }));
            }
            return true;
          })()
        `).catch((e) => this.log(`  ⚠️ Falha ao reaplicar quantidade: ${e}`))
      }
      // Espera generosa para deixar qualquer postback assíncrono do WinMax4 estabilizar
      // antes de verificar de novo ou avançar para o clique em "Inserir".
      await this.page!.waitForTimeout(1000)
    }

    // Última verificação antes do clique final — elimina por completo o risco de ficar
    // pendurado no timeout por omissão do Playwright (~30s) se o iframe tiver
    // desaparecido entre o fim do loop acima e este ponto.
    if (!(await this.iframeExiste(di))) {
      throw new ErroLinhaArtigo(n, linha.artigo_ref,
        `Linha ${n} — "${linha.artigo_ref}": iframe do documento desapareceu antes do clique final em Inserir`)
    }

    // Clica botão "Inserir" via frameLocator (mais fiável que window.InsertDocumentDetail)
    await this.dismissarOverlayPreso()
    await this.page!.frameLocator('#DocumentIssue_content')
      .locator('#wucButtonInsertDocumentDetail_linkButton1')
      .click()
    await this.page!.waitForTimeout(1200)

    const erroInsert = await this.verificarErro(di)
    if (erroInsert) {
      // Mesma lógica de reconfirmação aplicada acima — evita abandonar o documento
      // por causa de uma mensagem transitória do WinMax4 logo após o clique em Inserir.
      await this.log(`  ⏳ Possível erro ao inserir "${linha.artigo_ref}" — a reconfirmar antes de desistir...`)
      await this.page!.waitForTimeout(1500)
      const erroInsertConfirmado = await this.verificarErro(di)
      if (erroInsertConfirmado) {
        throw new ErroLinhaArtigo(n, linha.artigo_ref,
          `Linha ${n} — "${linha.artigo_ref}": ${erroInsertConfirmado}`)
      }
      await this.log(`  ✅ Falso alarme — mensagem desapareceu, linha "${linha.artigo_ref}" inserida`)
    }

    await this.log(`  📦 Linha ${n}: ${linha.artigo_ref} x${linha.quantidade} @ ${linha.preco_unitario}€`)
  }

  private normalizarComentario(txt: string): string {
    return txt.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  }

  private async verificarEReabrirComentario(comentarioEsperado: string): Promise<boolean> {
    // Duplo check redundante: reabre a janela de comentário depois de a termos fechado,
    // e confirma que o texto ficou mesmo guardado — em vez de assumir sucesso só porque
    // o clique em "Confirmar" não deu erro visível.
    try {
      await this.dismissarOverlayPreso()
      await this.page!.frameLocator('#DocumentIssue_content')
        .locator('input[id^="DetailPropertyRemarks"]')
        .last()
        .click({ timeout: 5000 })
      await this.page!.waitForTimeout(1000)
      const abriu = await this.waitFor('DocumentIssueDocumentDetailRemarks_content', SEL.remarksTxt, 5000)
        .then(() => true).catch(() => false)
      if (!abriu) return false

      const valorAtual = await this.page!.evaluate(() => {
        const f = document.getElementById('DocumentIssueDocumentDetailRemarks_content') as HTMLIFrameElement
        return (f?.contentDocument?.getElementById('txtRemarks') as HTMLTextAreaElement)?.value || ''
      })

      // Fecha a janela de novo (reconfirma o mesmo texto lido — inofensivo e idempotente)
      await this.page!.evaluate(() => {
        const f = document.getElementById('DocumentIssueDocumentDetailRemarks_content') as HTMLIFrameElement
        ;(f?.contentDocument?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
      })
      await this.page!.waitForTimeout(800)

      return this.normalizarComentario(valorAtual) === this.normalizarComentario(comentarioEsperado)
    } catch {
      return false
    }
  }

  private async adicionarComentario(comentario: string, tentativa = 1): Promise<void> {
    const di = 'DocumentIssue_content'
    const maxTentativas = 2

    // CORRIGIDO 04/07/2026: a verificação de existência do botão de comentário era
    // IMEDIATA, sem esperar o WinMax4 desenhar o ícone (aparece só depois de um postback
    // assíncrono ao inserir a linha). Em produção isto falhava intermitentemente
    // ("Artigo sem textarea de comentário") mesmo em artigos COM comentário no Excel —
    // confirmado com a fatura F25 (ZURICH), preço 26,49€, comentário "Marca: JEEP...".
    // Agora espera-se (com polling) até 8s que o botão apareça antes de desistir, e há
    // um sistema de repetição com duplo check para confirmar que o texto ficou guardado.
    const apareceu = await this.page!.waitForFunction(
      (id: string) => {
        const f = document.getElementById(id) as HTMLIFrameElement
        return !!f?.contentDocument?.querySelector('input[id^="DetailPropertyRemarks"]')
      },
      di,
      { timeout: 8000, polling: 300 }
    ).then(() => true).catch(() => false)

    if (!apareceu) {
      if (tentativa < maxTentativas) {
        await this.log(`  ⏳ Botão de comentário ainda não visível (tentativa ${tentativa}/${maxTentativas}) — a tentar novamente...`)
        await this.page!.waitForTimeout(1000)
        return this.adicionarComentario(comentario, tentativa + 1)
      }
      // CORRIGIDO 08/07/2026: quando o botão nunca aparece mesmo após esperar, pode
      // haver uma mensagem de erro/validação escondida do WinMax4 a bloquear o
      // desenho do ícone (ex: um aviso relacionado com o preço da linha) que não
      // estávamos a verificar neste ponto. Log-a para diagnóstico, sem interromper.
      const erroOculto = await this.verificarErro(di)
      await this.log(`  ⚠️ Artigo sem textarea de comentário (confirmado após espera) — comentário NÃO aplicado${erroOculto ? ` | Mensagem WinMax4: "${erroOculto}"` : ''}`)
      return
    }

    // Força a ocultação do overlay em vez de apenas esperar que desapareça sozinho —
    // já observámos em produção que pode ficar preso indefinidamente (ver dismissarOverlayPreso).
    await this.dismissarOverlayPreso()

    await this.page!.frameLocator('#DocumentIssue_content')
      .locator('input[id^="DetailPropertyRemarks"]')
      .last()
      .click({ timeout: 10000 })
    await this.page!.waitForTimeout(1500)
    const dialogAbriu = await this.waitFor('DocumentIssueDocumentDetailRemarks_content', SEL.remarksTxt, 8000)
      .then(() => true).catch(() => false)

    if (!dialogAbriu) {
      if (tentativa < maxTentativas) {
        await this.log(`  ⏳ Janela de comentário não abriu (tentativa ${tentativa}/${maxTentativas}) — a tentar novamente...`)
        return this.adicionarComentario(comentario, tentativa + 1)
      }
      await this.log(`  ❌ Janela de comentário não abriu após ${maxTentativas} tentativas — comentário NÃO aplicado`)
      return
    }

    await this.page!.evaluate(({ txt }) => {
      const f = document.getElementById('DocumentIssueDocumentDetailRemarks_content') as HTMLIFrameElement
      const ta = f?.contentDocument?.getElementById('txtRemarks') as HTMLTextAreaElement
      if (ta) { ta.value = txt; ta.dispatchEvent(new Event('change', { bubbles: true })) }
    }, { txt: comentario })

    await this.page!.evaluate(() => {
      const f = document.getElementById('DocumentIssueDocumentDetailRemarks_content') as HTMLIFrameElement
      ;(f?.contentDocument?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
    })
    await this.page!.waitForTimeout(1200)

    const confirmado = await this.verificarEReabrirComentario(comentario)
    if (!confirmado) {
      if (tentativa < maxTentativas) {
        await this.log(`  ⚠️ Comentário não confirmado após aplicar (tentativa ${tentativa}/${maxTentativas}) — a tentar novamente...`)
        return this.adicionarComentario(comentario, tentativa + 1)
      }
      await this.log(`  ❌ Comentário não pôde ser confirmado após ${maxTentativas} tentativas`)
      return
    }

    await this.log('  💬 Comentário adicionado e confirmado')
  }

  private async imprimirEGuardarPDF(numPrevisto: string, tipDoc = '', clienteCodigo = ''): Promise<string> {
    // O WinMax4 usa DocumentIssueClose_content para terminar+imprimir
    await this.log('  🖨️ A aguardar iframe de fecho do documento...')

    // Tratar janela de confirmação intermédia se aparecer (LbConfirmOnCloseWindow)
    await this.page!.waitForTimeout(800)
    await this.page!.evaluate(() => {
      const di = document.getElementById('DocumentIssue_content') as HTMLIFrameElement
      const doc = di?.contentDocument
      const confirmBtn = doc?.getElementById('LbConfirmOnCloseWindow') as HTMLElement
        || doc?.getElementById('LbConfirmOnCloseValuesWindow') as HTMLElement
        || doc?.getElementById('LbConfirmCloseCreditDocumentWithoutDetailRelation') as HTMLElement
      if (confirmBtn && confirmBtn.offsetParent !== null) confirmBtn.click()
    }).catch(() => {})
    await this.page!.waitForTimeout(500)

    // CORRIGIDO 04/07/2026: timeout de 15s era demasiado curto — confirmado em produção
    // (fatura 3/4, "INTER PARTNER ASSISTANCE") que o WinMax4 pode demorar mais tempo a
    // preparar a janela de fecho/impressão, especialmente com documentos de várias linhas
    // ou sob carga do servidor. A falha aqui interrompeu a fatura a meio e deixou o browser
    // num estado que a fatura seguinte teve dificuldade em recuperar. Aumentado para 30s
    // (consistente com outras esperas dependentes do servidor no resto do código), e
    // adicionada uma segunda tentativa: se ainda assim não aparecer, tenta clicar de novo
    // em diálogos de confirmação intermédios (podem ter aparecido tarde) antes de desistir.
    const apareceuClose = await this.waitFor('DocumentIssueClose_content', '#wucButtonConfirm_linkButton1', 30000)
      .then(() => true).catch(() => false)

    if (!apareceuClose) {
      await this.log('  ⏳ Janela de fecho ainda não apareceu após 30s — a tentar diálogos intermédios de novo...')
      await this.page!.evaluate(() => {
        const di = document.getElementById('DocumentIssue_content') as HTMLIFrameElement
        const doc = di?.contentDocument
        const confirmBtn = doc?.getElementById('LbConfirmOnCloseWindow') as HTMLElement
          || doc?.getElementById('LbConfirmOnCloseValuesWindow') as HTMLElement
          || doc?.getElementById('LbConfirmCloseCreditDocumentWithoutDetailRelation') as HTMLElement
        if (confirmBtn && confirmBtn.offsetParent !== null) confirmBtn.click()
      }).catch(() => {})
      // Última tentativa, com mais paciência ainda
      const apareceuNaUltima = await this.waitFor('DocumentIssueClose_content', '#wucButtonConfirm_linkButton1', 20000)
        .then(() => true).catch(() => false)

      if (!apareceuNaUltima) {
        // CORRIGIDO 08/07/2026: confirmado em produção que clicar em "Terminar" pode já
        // ter enviado o pedido de fecho ao servidor mesmo que a confirmação visual nunca
        // apareça — nesse caso, o documento pode ter sido criado no WinMax4 (fatura
        // "fantasma") apesar de o nosso código marcar esta fatura como falhada. Verifica-se
        // aqui se já foi atribuído um número de documento, para pelo menos AVISAR
        // claramente em vez de ficar em silêncio sobre esta possibilidade.
        const numeroJaAtribuido = await this.evalIn('DocumentIssue_content',
          `document.getElementById('txtDocumentNumber')?.value?.replace(/^-/,'').trim() || ''`
        ).catch(() => '') as string
        if (numeroJaAtribuido) {
          await this.log(`  🚨 ATENÇÃO: número de documento "${numeroJaAtribuido}" já foi atribuído — o documento PODE TER SIDO CRIADO no WinMax4 apesar deste erro. Verificar manualmente antes de reenviar.`)
        }
        // Marca que esta falha aconteceu especificamente DURANTE o fecho — a próxima
        // fatura vai usar uma recuperação mais agressiva (ver abrirNovaFatura), já que
        // abandonarDocumento() foi concebido para um documento ainda em edição, não um
        // que já entrou no fluxo de fecho (pode deixar o estado da sessão corrompido,
        // como observado: erro "Cliente inválido" espúrio na fatura seguinte, para um
        // cliente que tinha funcionado sem problemas momentos antes).
        this.falhaDuranteFecho = true
        throw new Error(`Timeout ao aguardar janela de fecho do documento (após 2 tentativas, ~50s)${numeroJaAtribuido ? ` — possível documento fantasma nº ${numeroJaAtribuido}` : ''}`)
      }
    }
    await this.page!.waitForTimeout(500)

    // Seleciona template PDF se configurado
    if (this.config.templatePDF) {
      await this.page!.evaluate(({ tpl }) => {
        const f = document.getElementById('DocumentIssueClose_content') as HTMLIFrameElement
        const ddl = f?.contentDocument?.getElementById('ddlPrintReportName') as HTMLSelectElement
        if (ddl) { ddl.value = tpl; ddl.dispatchEvent(new Event('change', { bubbles: true })) }
      }, { tpl: this.config.templatePDF })
      await this.page!.waitForTimeout(500)
    }

    // Clica Confirmar — verifica também se precisa de confirmar documento com total zero
    await this.page!.evaluate(() => {
      const f = document.getElementById('DocumentIssueClose_content') as HTMLIFrameElement
      const doc = f?.contentDocument
      // Verifica se há link especial para total zero
      const totalZero = doc?.getElementById('lbConfirmCloseDocumentWithTotalZero') as HTMLElement
      if (totalZero && totalZero.offsetParent !== null) {
        totalZero.click()
      } else {
        ;(doc?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
      }
    })
    await this.page!.waitForTimeout(5000)

    // Captura o URL do Download.aspx — aguarda até 10s que o viewer apareça
    try {
      let downloadUrl: string | null = null
      for (let i = 0; i < 10; i++) {
        downloadUrl = await this.page!.evaluate(() => {
          const iframes = Array.from(document.querySelectorAll('iframe'))
          const viewer = iframes.find(f => f.src?.includes('Download.aspx'))
          return viewer?.src || null
        })
        if (downloadUrl) break
        await this.page!.waitForTimeout(1000)
      }

      if (!downloadUrl) {
        await this.log('  ⚠️  PDF: URL de download não encontrado após 10s')
        return ''
      }
      await this.log(`  🖨️  PDF URL encontrado`)

      // Faz fetch do PDF usando as cookies da sessão Playwright
      const cookies = await this.page!.context().cookies()
      const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')
      const resp = await fetch(downloadUrl, { headers: { Cookie: cookieHeader } })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

      const buffer = Buffer.from(await resp.arrayBuffer())
      const nomeSeguro = `${clienteCodigo ? clienteCodigo + '_' : ''}${tipDoc ? tipDoc + '_' : ''}${numPrevisto}`.replace(/[\/\\:*?"<>|]/g, '_')
      const destino = path.join(this.config.pastaDestinoPDF || '/tmp/pdfs', `${nomeSeguro}.pdf`)
      fs.mkdirSync(path.dirname(destino), { recursive: true })
      fs.writeFileSync(destino, buffer)

      // Upload para Firebase Storage (persistente — sobrevive a reboots do Render)
      try {
        const { uploadPDFToStorage } = await import('../services/firebase')
        const jobId = path.basename(this.config.pastaDestinoPDF || 'job')
        const urlStorage = await uploadPDFToStorage(buffer, `${nomeSeguro}.pdf`, jobId)
        await this.log(`  🖨️  PDF guardado: ${nomeSeguro}.pdf`)
        return urlStorage
      } catch (storageErr: any) {
        await this.log(`  ⚠️  Storage: ${storageErr.message} — usando path local`)
        await this.log(`  🖨️  PDF guardado: ${nomeSeguro}.pdf`)
        return destino
      }
    } catch (e: any) {
      await this.log(`  ⚠️  PDF: erro ao guardar — ${e.message}`)
      return ''
    }
  }

  private async terminarDocumento(fatura: Fatura): Promise<{ numDoc: string; localPDF: string; dataDocumento: string }> {
    const di = 'DocumentIssue_content'
    const numPrevisto = await this.evalIn(di,
      `document.getElementById('lblNextDocumentNumber')?.innerText?.replace(/[()]/g,'').trim() || 'doc'`
    ) as string

    // Cancela linha de edição vazia se estiver aberta
    const temCancelar = await this.evalIn(di,
      `!!document.getElementById('wucButtonCancelDocumentDetail_linkButton1')`
    ) as boolean
    if (temCancelar) {
      await this.dismissarOverlayPreso()
      await this.page!.frameLocator('#DocumentIssue_content')
        .locator('#wucButtonCancelDocumentDetail_linkButton1')
        .click()
      await this.page!.waitForTimeout(800)
      await this.log('  ✖️  Linha vazia cancelada')
    }

    // Clica "Terminar" — abre DocumentIssueClose_content com opções de impressão
    await this.page!.waitForFunction(
      (id: string) => {
        const f = document.getElementById(id) as HTMLIFrameElement
        const btn = f?.contentDocument?.getElementById('wucButtonClose_linkButton1') as HTMLElement
        return btn && btn.offsetParent !== null
      },
      'DocumentIssue_content',
      { timeout: 30000, polling: 500 }
    ).catch(() => {})
    await this.dismissarOverlayPreso()
    await this.page!.frameLocator('#DocumentIssue_content')
      .locator('#wucButtonClose_linkButton1')
      .click({ timeout: 15000 })
    await this.page!.waitForTimeout(1500)
    await this.log('  ✅ A terminar documento...')

    // imprimirEGuardarPDF aguarda o DocumentIssueClose_content e clica Confirmar
    const localPDF = await this.imprimirEGuardarPDF(numPrevisto, fatura.tipo_documento, fatura.cliente_codigo)

    // Tenta obter número do documento — do iframe ou do nome do PDF
    let numDoc = await this.evalIn(di,
      `document.getElementById('txtDocumentNumber')?.value?.replace(/^-/,'').trim() || ''`
    ).catch(() => '') as string

    // Se não conseguiu do iframe, extrai do nome do PDF
    if (!numDoc && localPDF) {
      const nomePDF = path.basename(localPDF, '.pdf')
      // Remove o prefixo do tipo (ex: FRB_ → 2026_85 → 2026/85)
      const semTipo = nomePDF.replace(/^[A-Z]+_/, '')
      numDoc = semTipo.replace('_', '/') // 2026_85 → 2026/85
    }

    // Renomeia o PDF com o número definitivo
    if (localPDF && numDoc && numDoc !== numPrevisto) {
      const nomeSeguro = numDoc.replace(/[\/\\:*?"<>|]/g, '_')
      const novo = path.join(this.config.pastaDestinoPDF, `${nomeSeguro}.pdf`)
      try { fs.renameSync(localPDF, novo) } catch { /**/ }
    }

    const dataDocumento = await this.evalIn(di,
      `document.getElementById('txtDocumentDate')?.value || ''`
    ).catch(() => '') as string

    return { numDoc: numDoc || 'EMITIDO', localPDF, dataDocumento }
  }

  async criarFatura(fatura: Fatura): Promise<ResultadoFatura> {
    const inicio = Date.now()
    const errosLinhas: ErroLinha[] = []

    await this.abrirNovaFatura()
    await this.preencherCabecalho(fatura)
    await this.log(`  📋 ${fatura.linhas.length} linha(s)`)

    for (let i = 0; i < fatura.linhas.length; i++) {
      const linha = fatura.linhas[i]
      try {
        await this.adicionarLinhaArtigo(linha, i)
        if (linha.comentario?.trim()) await this.adicionarComentario(linha.comentario)
      } catch (err) {
        if (err instanceof ErroLinhaArtigo) {
          errosLinhas.push({ linha: err.linha, artigo_ref: err.artigo_ref, mensagem: err.message })
          await this.log(`  ❌ ${err.message}`)
          await this.log('  ⛔ A abandonar documento')
          await this.abandonarDocumento()
          return {
            index: 0, fatura_id: fatura.fatura_id, cliente_codigo: fatura.cliente_codigo, cliente_nome: fatura.cliente_nome,
            tipo_documento: fatura.tipo_documento, sucesso: false,
            total_linhas: fatura.linhas.length, linhas_ok: i,
            erros_linhas: errosLinhas, erro: err.message, duracao_ms: Date.now() - inicio,
          }
        }
        throw err
      }
    }

    const { numDoc, localPDF, dataDocumento } = await this.terminarDocumento(fatura)
    return {
      index: 0, fatura_id: fatura.fatura_id, cliente_codigo: fatura.cliente_codigo, cliente_nome: fatura.cliente_nome,
      tipo_documento: fatura.tipo_documento, sucesso: true,
      numero_documento: numDoc,
      data_documento: dataDocumento || null,
      pdf_url: localPDF,
      total: fatura.linhas.reduce((s, l) => s + (l.preco_unitario * l.quantidade * (1 - (l.desconto_pct || 0) / 100)), 0),
      total_linhas: fatura.linhas.length, linhas_ok: fatura.linhas.length,
      duracao_ms: Date.now() - inicio,
    }
  }

  async processarFaturas(
    faturas: Fatura[],
    onProgresso?: (pct: number, resultado: ResultadoFatura) => void
  ): Promise<ResultadoFatura[]> {
    const resultados: ResultadoFatura[] = []
    await this.log(`\n📋 ${faturas.length} fatura(s)`)

    for (let i = 0; i < faturas.length; i++) {
      const fatura = faturas[i]
      await this.log(`\n[${i+1}/${faturas.length}] ${fatura.cliente_nome} | ${fatura.tipo_documento}`)

      let resultado: ResultadoFatura
      try {
        resultado = await this.criarFatura(fatura)
        resultado.index = i + 1
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await this.page?.screenshot({ path: `logs/erro-${i+1}.png` }).catch(() => {})
        resultado = {
          index: i+1, fatura_id: fatura.fatura_id, cliente_codigo: fatura.cliente_codigo, cliente_nome: fatura.cliente_nome,
          tipo_documento: fatura.tipo_documento, sucesso: false,
          total_linhas: fatura.linhas.length, linhas_ok: 0, erro: msg,
        }
        await this.log(`  ❌ ${msg}`)
      }

      resultados.push(resultado)
      if (onProgresso) {
        const pct = Math.round(((i + 1) / faturas.length) * 100)
        onProgresso(pct, resultado)
      }

      if (i < faturas.length - 1) await this.page?.waitForTimeout(2000)
    }

    const ok = resultados.filter(r => r.sucesso).length
    await this.log(`\n✅ Emitidas: ${ok} | ❌ Erros: ${resultados.length - ok}`)
    return resultados
  }
}
