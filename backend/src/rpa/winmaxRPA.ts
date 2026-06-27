// rpa/winmaxRPA.ts — Motor RPA WinMax4 AUTOAVENIDA
// Seletores descobertos ao vivo em 16/06/2026

import * as path from 'path'
import * as fs from 'fs'
import { Browser, BrowserContext, Page, chromium } from 'playwright'
import { Fatura, ResultadoFatura, ErroLinha } from '../types'
import { logger } from '../services/logger'
import { appendJobLog } from '../services/firebase'

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
  private context: BrowserContext | null = null
  private page: Page | null = null
  private config: RPAConfig

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
    // Usa chromium em vez de chromium-headless-shell (mais compatível com Render)
    this.browser = await chromium.launch({ 
      headless: true, 
      slowMo: 80,
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

  async fechar(): Promise<void> { await this.browser?.close() }

  async login(): Promise<void> {
    // WinMax4 abre no MainPage.aspx com iframe UserAuthentication_content
    const url = `https://app102.winmax4.com/MainPage.aspx?CompanyCode=${this.config.companyCode}`
    await this.log(`🔑 Login: ${url}`)
    await this.page!.goto(url, { waitUntil: 'networkidle' })
    await this.page!.waitForTimeout(2000)

    // Aguarda iframe de autenticação
    await this.page!.waitForFunction(
      () => !!document.getElementById('UserAuthentication_content'),
      { timeout: 30000 }
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
      this.page!.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
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
        { timeout: 15000 }
      )
    } catch {
      await this.page!.screenshot({ path: 'logs/erro-login.png' })
      throw new Error('Login falhou — Toolbox não carregou após autenticação')
    }
    await this.log('✅ Login OK')
  }

  private async evalIn(iframeId: string, code: string): Promise<unknown> {
    // Usa script injetado no DOM do iframe para evitar restrições de strict mode
    // (window.eval em strict mode bloqueia 'arguments' usado pelo ASP.NET WebForms)
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

  private async waitFor(iframeId: string, selector: string, timeout = 30000): Promise<void> {
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
      await this.evalIn('DocumentIssue_content',
        `document.getElementById('wucButtonExit_linkButton1')?.click()`)
      await this.page!.waitForTimeout(1200)
      await this.log('  🚫 Documento abandonado')
    } catch { /**/ }
  }

  private async abrirNovaFatura(): Promise<void> {
    // Garante que o Toolbox está carregado antes de clicar
    await this.page!.waitForFunction(
      () => {
        const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
        const doc = tb?.contentDocument
        return !!(doc && doc.readyState === 'complete' &&
          doc.querySelectorAll('div[id^="Toolbox_ShortcutIconDiv"]').length > 0)
      },
      { timeout: 15000, polling: 500 }
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
      { timeout: 15000, polling: 300 }
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
    await this.waitFor('DocumentIssue_content', SEL.entityCode, 30000)
    await this.page!.waitForTimeout(800)
  }

  private async preencherCabecalho(fatura: Fatura): Promise<void> {
    const di = 'DocumentIssue_content'
    const tipoVal = TIPO_DOC[fatura.tipo_documento] ?? '37'

    // Muda tipo de documento via dispatchEvent change
    // (__doPostBack falha mesmo em script injetado porque o ScriptManager usa arguments internamente)
    await this.evalIn(di, `
      const s = document.getElementById('ddlDocumentType');
      s.value = '${tipoVal}';
      s.dispatchEvent(new Event('change', { bubbles: true }));
    `)

    // Aguarda o postback ASP.NET completar — espera que o valor mude para o correto
    await this.page!.waitForFunction(
      ({ id, val }: { id: string; val: string }) => {
        const f = document.getElementById(id) as HTMLIFrameElement
        const doc = f?.contentDocument
        if (!doc || doc.readyState !== 'complete') return false
        const s = doc.getElementById('ddlDocumentType') as HTMLSelectElement
        return s?.value === val
      },
      { id: di, val: tipoVal },
      { timeout: 20000, polling: 400 }
    ).catch(async () => {
      // Se timeout, verifica o valor atual
      const val = await this.evalIn(di, `document.getElementById('ddlDocumentType')?.value || '?'`)
      await this.log(`  ⚠️ Timeout aguardando tipo ${tipoVal}, valor atual: ${val}`)
    })
    await this.page!.waitForTimeout(400)

    // Confirma o tipo após postback
    const tipoAtual = await this.evalIn(di, `document.getElementById('ddlDocumentType')?.value || ''`)
    await this.log(`  📄 Tipo documento: ${fatura.tipo_documento} (val=${tipoAtual})`)

    // Preenche código do cliente usando frameLocator do Playwright (mais fiável que evalIn para inputs)
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
      { timeout: 15000, polling: 500 }
    )

    const erroEnt = await this.verificarErro(di)
    if (erroEnt) throw new Error(`Cliente inválido (${fatura.cliente_codigo}): ${erroEnt}`)
    const nome = await this.evalIn(di, `document.getElementById('lblEntityName')?.innerText || ''`)
    await this.log(`  👤 ${nome} (${fatura.cliente_codigo}) | ${fatura.tipo_documento}`)
  }

  private async adicionarLinhaArtigo(linha: Fatura['linhas'][0], idx: number): Promise<void> {
    const di = 'DocumentIssue_content'
    const n = idx + 1

    // Clica "Inserir" para abrir o formulário de nova linha
    await this.page!.frameLocator('#DocumentIssue_content')
      .locator('#wucButtonInsertDocumentDetail_linkButton1')
      .click()
    await this.waitFor(di, '#txtArticleCode', 10000)
    await this.page!.waitForTimeout(300)

    // Insere referência do artigo via frameLocator — WinMax4 preenche descrição e IVA automaticamente
    await this.page!.frameLocator('#DocumentIssue_content')
      .locator('#txtArticleCode')
      .fill(linha.artigo_ref)
    await this.page!.frameLocator('#DocumentIssue_content')
      .locator('#txtArticleCode')
      .press('Tab')
    await this.page!.waitForTimeout(1000)

    const erroArtigo = await this.verificarErro(di)
    if (erroArtigo) throw new ErroLinhaArtigo(n, linha.artigo_ref,
      `Linha ${n} — "${linha.artigo_ref}": ${erroArtigo}`)

    // Preço (vem do Excel)
    await this.evalIn(di, `
      const p = document.getElementById('txtUnitaryPrice');
      p.value = '${String(linha.preco_unitario).replace('.', ',')}';
      p.dispatchEvent(new Event('change', { bubbles: true }));
      p.dispatchEvent(new Event('blur', { bubbles: true }));
    `)
    await this.page!.waitForTimeout(200)

    // Quantidade (vem do Excel)
    await this.evalIn(di, `
      const q = document.getElementById('txtQuantity');
      q.value = '${String(linha.quantidade).replace('.', ',')}';
      q.dispatchEvent(new Event('change', { bubbles: true }));
      q.dispatchEvent(new Event('blur', { bubbles: true }));
    `)
    await this.page!.waitForTimeout(200)

    // Desconto (vem do Excel)
    if (linha.desconto_pct > 0) {
      await this.evalIn(di, `
        const d = document.getElementById('txtDiscount1');
        d.value = '${String(linha.desconto_pct).replace('.', ',')}';
        d.dispatchEvent(new Event('change', { bubbles: true }));
        d.dispatchEvent(new Event('blur', { bubbles: true }));
      `)
    }

    // IVA e descrição vêm da ficha do artigo no WinMax4 — não se preenchem

    // Clica botão "Inserir" via frameLocator (mais fiável que window.InsertDocumentDetail)
    await this.page!.frameLocator('#DocumentIssue_content')
      .locator('#wucButtonInsertDocumentDetail_linkButton1')
      .click()
    await this.page!.waitForTimeout(1200)

    const erroInsert = await this.verificarErro(di)
    if (erroInsert) throw new ErroLinhaArtigo(n, linha.artigo_ref,
      `Linha ${n} — "${linha.artigo_ref}": ${erroInsert}`)

    await this.log(`  📦 Linha ${n}: ${linha.artigo_ref} x${linha.quantidade} @ ${linha.preco_unitario}€`)
  }

  private async adicionarComentario(comentario: string): Promise<void> {
    const di = 'DocumentIssue_content'
    const tem = await this.evalIn(di,
      `!!document.querySelector('input[id^="DetailPropertyRemarks"]')`) as boolean
    if (!tem) { await this.log('  💬 Artigo sem textarea de comentário'); return }

    // Aguarda que o overlay_modal desapareça antes de clicar
    await this.page!.waitForFunction(
      () => !document.getElementById('overlay_modal') ||
            (document.getElementById('overlay_modal') as HTMLElement).style.display === 'none' ||
            !(document.getElementById('overlay_modal') as HTMLElement).offsetParent,
      { timeout: 10000, polling: 300 }
    ).catch(() => {})

    await this.page!.frameLocator('#DocumentIssue_content')
      .locator('input[id^="DetailPropertyRemarks"]')
      .click({ timeout: 10000 })
    await this.page!.waitForTimeout(1500)
    await this.waitFor('DocumentIssueDocumentDetailRemarks_content', SEL.remarksTxt, 8000)

    await this.page!.evaluate(({ txt }) => {
      const f = document.getElementById('DocumentIssueDocumentDetailRemarks_content') as HTMLIFrameElement
      const ta = f?.contentDocument?.getElementById('txtRemarks') as HTMLTextAreaElement
      if (ta) { ta.value = txt; ta.dispatchEvent(new Event('change', { bubbles: true })) }
    }, { txt: comentario })

    await this.page!.evaluate(() => {
      const f = document.getElementById('DocumentIssueDocumentDetailRemarks_content') as HTMLIFrameElement
      ;(f?.contentDocument?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
    })
    await this.page!.waitForTimeout(1000)
    await this.log('  💬 Comentário adicionado')
  }

  private async imprimirEGuardarPDF(numPrevisto: string): Promise<string> {
    // O WinMax4 usa DocumentIssueClose_content para terminar+imprimir
    await this.log('  🖨️ A aguardar iframe de fecho do documento...')
    await this.waitFor('DocumentIssueClose_content', '#wucButtonConfirm_linkButton1', 15000)
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
      const nomeSeguro = numPrevisto.replace(/[\/\\:*?"<>|]/g, '_')
      const destino = path.join(this.config.pastaDestinoPDF || '/tmp/pdfs', `${nomeSeguro}.pdf`)
      fs.mkdirSync(path.dirname(destino), { recursive: true })
      fs.writeFileSync(destino, buffer)
      await this.log(`  🖨️  PDF guardado: ${nomeSeguro}.pdf`)
      return destino
    } catch (e: any) {
      await this.log(`  ⚠️  PDF: erro ao guardar — ${e.message}`)
      return ''
    }
  }

  private async terminarDocumento(fatura: Fatura): Promise<{ numDoc: string; localPDF: string }> {
    const di = 'DocumentIssue_content'
    const numPrevisto = await this.evalIn(di,
      `document.getElementById('lblNextDocumentNumber')?.innerText?.replace(/[()]/g,'').trim() || 'doc'`
    ) as string

    // Cancela linha de edição vazia se estiver aberta
    const temCancelar = await this.evalIn(di,
      `!!document.getElementById('wucButtonCancelDocumentDetail_linkButton1')`
    ) as boolean
    if (temCancelar) {
      await this.page!.frameLocator('#DocumentIssue_content')
        .locator('#wucButtonCancelDocumentDetail_linkButton1')
        .click()
      await this.page!.waitForTimeout(800)
      await this.log('  ✖️  Linha vazia cancelada')
    }

    // Clica "Terminar" — abre DocumentIssueClose_content com opções de impressão
    await this.page!.frameLocator('#DocumentIssue_content')
      .locator('#wucButtonClose_linkButton1')
      .click()
    await this.page!.waitForTimeout(1500)
    await this.log('  ✅ A terminar documento...')

    // imprimirEGuardarPDF aguarda o DocumentIssueClose_content e clica Confirmar
    const localPDF = await this.imprimirEGuardarPDF(numPrevisto)

    const numDoc = await this.evalIn(di,
      `document.getElementById('txtDocumentNumber')?.value?.replace(/^-/,'').trim() || ''`
    ).catch(() => '') as string

    // Renomeia o PDF com o número definitivo
    if (localPDF && numDoc && numDoc !== numPrevisto) {
      const nomeSeguro = numDoc.replace(/[\/\\:*?"<>|]/g, '_')
      const novo = path.join(this.config.pastaDestinoPDF, `${nomeSeguro}.pdf`)
      try { fs.renameSync(localPDF, novo) } catch { /**/ }
    }

    return { numDoc: numDoc || 'EMITIDO', localPDF }
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

    const { numDoc, localPDF } = await this.terminarDocumento(fatura)
    return {
      index: 0, fatura_id: fatura.fatura_id, cliente_codigo: fatura.cliente_codigo, cliente_nome: fatura.cliente_nome,
      tipo_documento: fatura.tipo_documento, sucesso: true,
      numero_documento: numDoc,
      pdf_url: localPDF,   // substituído por URL Firebase Storage no job handler
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
