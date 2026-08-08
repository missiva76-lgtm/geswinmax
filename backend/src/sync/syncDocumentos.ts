// sync/syncDocumentos.ts
//
// Importa a listagem "Documentos emitidos" do WinMax4 — um registo por documento,
// com o respetivo estado de liquidação. Complementa syncArtigos.ts, que traz os
// movimentos ao nível da LINHA (artigo a artigo) e não sabe nada sobre pagamentos.
//
// Caminho no WinMax4: Listagens → Vendas → Documentos → Emitidos
//
// Seletores e valores confirmados ao vivo (08/08/2026):
//   URL:                    /MReports/Transactions/SalesIssuedDocuments.aspx
//   iframe:                 reportTransactionsSalesIssuedDocuments_content
//   data início / fim:      wucCalendarFromDate_txtModernDate / wucCalendarToDate_txtModernDate
//   confirmar:              wucButtonConfirm_linkButton1
//   ddlSendTo:              '2' = Ficheiro   (índice 1 na lista)
//   ddlDocType:             '3' = Excel (.csv)
//   ddlDocumentSituation:   '0' = Fechados   (opção escolhida — ver nota abaixo)
//   ddlShow:                '2' = Não anulados
//
// DECISÕES DE FILTRO (acordadas com o Carlos, 08/08/2026):
//   • Situação = "Fechados" — só documentos finalizados interessam para cobranças
//   • Exibir documentos = "Não anulados" — os anulados não devem constar
//
// ESTADO DE LIQUIDAÇÃO — nota importante:
//   O CSV traz um campo `Paid`, mas ele vem SEMPRE a 0,000000 (verificado em 90
//   registos reais, incluindo documentos que o PDF equivalente mostrava como
//   liquidados). Não serve. O estado real obtém-se de:
//       por_pagar = Total − TotalLiquidated
//   Confirmado contra o PDF da mesma listagem: os valores coincidem exatamente.

import { chromium, Browser, Page, Download } from 'playwright'
import { acquireBrowserLock } from '../services/browserLock'
import * as admin from 'firebase-admin'
import * as fs from 'fs'
import * as path from 'path'
import { db, appendJobLog, getConfig } from '../services/firebase'
import { logger } from '../services/logger'
import { clicarToolboxPorTitulo } from '../rpa/toolboxHelper'

const BASE = 'https://app102.winmax4.com'
const URL_LISTAGEM = '/MReports/Transactions/SalesIssuedDocuments.aspx'
const IFRAME_ID = 'reportTransactionsSalesIssuedDocuments_content'

/** Converte "1234,560000" (formato WinMax4) em número. */
function paraNumero(v?: string): number {
  if (!v || !v.trim()) return 0
  const n = Number(v.trim().replace(/\s/g, '').replace(',', '.'))
  return Number.isNaN(n) ? 0 : n
}

/** Converte "2026/07/01" ou "01/07/2026" em "2026-07-01". */
function normalizarData(v?: string): string {
  if (!v || !v.trim()) return ''
  const s = v.trim().split(' ')[0]
  if (/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(s)) return s.replace(/\//g, '-')
  const p = s.split('/')
  if (p.length === 3 && p[2].length === 4) return `${p[2]}-${p[1]}-${p[0]}`
  return s
}

async function loginWinmax(page: Page, config: any, log: (msg: string) => Promise<void>): Promise<void> {
  const passo = async (msg: string) => { await log(`  · ${msg}`) }

  const url = `${BASE}/MainPage.aspx?CompanyCode=${config.company_code || 'AUTOAVENIDA'}`
  await passo('login 1/5 — a abrir a página do WinMax4')
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForTimeout(3000)

  await passo('login 2/5 — a aguardar o formulário de autenticação')
  await page.waitForFunction(
    () => !!document.getElementById('UserAuthentication_content'), undefined,
    { timeout: 90000 }
  )

  await page.evaluate(({ user, pass }: { user: string; pass: string }) => {
    const f   = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
    const doc = f?.contentDocument
    const u   = doc?.getElementById('txtUserLogin')    as HTMLInputElement
    const p   = doc?.getElementById('txtUserPassword') as HTMLInputElement
    if (u) { u.value = user; u.dispatchEvent(new Event('change', { bubbles: true })) }
    if (p) { p.value = pass; p.dispatchEvent(new Event('change', { bubbles: true })) }
  }, { user: config.utilizador || '', pass: config.password || '' })

  await passo('login 3/5 — credenciais preenchidas, a confirmar')
  await page.waitForTimeout(300)
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {}),
    page.evaluate(() => {
      const f = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
      ;(f?.contentDocument?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
    })
  ])

  await passo('login 4/5 — a aguardar o carregamento pós-autenticação')
  await page.waitForTimeout(3000)
  const aindaLogin = await page.evaluate(
    () => !!document.getElementById('UserAuthentication_content')
  ).catch(() => false)
  if (aindaLogin) {
    const erro = await page.evaluate(() => {
      const f = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
      return f?.contentDocument?.body?.innerText?.substring(0, 200) || ''
    }).catch(() => '')
    await passo(`⚠️ ainda no ecrã de login — resposta do WinMax4: ${erro.slice(0, 120)}`)
  }

  await passo('login 5/5 — a aguardar o Toolbox')
  await page.waitForFunction(() => !!document.getElementById('Toolbox_content'), undefined, { timeout: 90000 })
}

/** Exporta a listagem em CSV e devolve o caminho do ficheiro descarregado. */
async function exportarCSV(
  page: Page,
  company: string,
  di: string,
  df: string,
  timeout: number,
  log: (msg: string) => Promise<void>
): Promise<string | null> {
  // Abre a listagem dentro do MainPage via iframe (mantém a sessão).
  // Remove iframes de relatório anteriores — deixá-los acumulados já provocou
  // falhas de exportação num servidor com pouca memória (ver syncArtigos.ts).
  await page.evaluate(({ urlPath, company, iframeId, base }: any) => {
    document.querySelectorAll('iframe[data-rpa-relatorio]').forEach(el => el.remove())
    const iframe = document.createElement('iframe')
    iframe.id = iframeId
    iframe.name = iframeId
    iframe.dataset.rpaRelatorio = '1'
    iframe.src = `${base}${urlPath}?CompanyCode=${company}`
    iframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;border:none;'
    document.body.appendChild(iframe)
  }, { urlPath: URL_LISTAGEM, company, iframeId: IFRAME_ID, base: BASE })

  await page.waitForTimeout(3000)

  // Expande as opções avançadas (os filtros de situação/anulados só existem depois)
  await page.evaluate((id: string) => {
    const f = document.getElementById(id) as HTMLIFrameElement
    const doc = f?.contentDocument
    // O botão tem nomes diferentes conforme a listagem — tenta ambos
    const btn = (doc?.getElementById('wucButtonCollapse_linkButton1')
      || doc?.getElementById('wucButtonExpand_linkButton1')) as HTMLElement
    btn?.click()
  }, IFRAME_ID)
  await page.waitForTimeout(1500)

  // Datas
  await page.evaluate(({ id, di, df }: any) => {
    const f = document.getElementById(id) as HTMLIFrameElement
    const doc = f?.contentDocument
    const from = doc?.getElementById('wucCalendarFromDate_txtModernDate') as HTMLInputElement
    const to   = doc?.getElementById('wucCalendarToDate_txtModernDate')   as HTMLInputElement
    if (from) { from.value = di; from.dispatchEvent(new Event('change', { bubbles: true })) }
    if (to)   { to.value   = df; to.dispatchEvent(new Event('change', { bubbles: true })) }
  }, { id: IFRAME_ID, di, df })
  await page.waitForTimeout(400)

  // Filtros: só documentos fechados e não anulados
  const filtros = await page.evaluate((id: string) => {
    const f = document.getElementById(id) as HTMLIFrameElement
    const doc = f?.contentDocument
    const aplicados: string[] = []
    const definir = (idCampo: string, valor: string) => {
      const el = doc?.getElementById(idCampo) as HTMLSelectElement
      if (!el) return
      el.value = valor
      el.dispatchEvent(new Event('change', { bubbles: true }))
      aplicados.push(`${idCampo}=${valor}`)
    }
    definir('ddlDocumentSituation', '0') // Fechados
    definir('ddlShow', '2')              // Não anulados
    return aplicados
  }, IFRAME_ID)
  await page.waitForTimeout(600)
  await log(`  🎛️ Filtros aplicados: ${filtros.join(', ') || 'nenhum (campos não encontrados)'}`)

  // "Enviar para" = Ficheiro. Dispara um postback que revela o campo de formato.
  await page.evaluate((id: string) => {
    const f = document.getElementById(id) as HTMLIFrameElement
    const ddl = f?.contentDocument?.getElementById('ddlSendTo') as HTMLSelectElement
    if (!ddl) return
    ddl.selectedIndex = 1 // Ficheiro
    ddl.dispatchEvent(new Event('change', { bubbles: true }))
  }, IFRAME_ID)
  await page.waitForTimeout(2500)

  // Formato = Excel (.csv)
  await page.evaluate((id: string) => {
    const f = document.getElementById(id) as HTMLIFrameElement
    const ddl = f?.contentDocument?.getElementById('ddlDocType') as HTMLSelectElement
    if (ddl) { ddl.value = '3'; ddl.dispatchEvent(new Event('change', { bubbles: true })) }
  }, IFRAME_ID)
  await page.waitForTimeout(500)

  const downloadPromise = page.waitForEvent('download', { timeout })

  await page.evaluate((id: string) => {
    const f = document.getElementById(id) as HTMLIFrameElement
    ;(f?.contentDocument?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
  }, IFRAME_ID)

  try {
    const download: Download = await downloadPromise
    const nome = download.suggestedFilename() || `documentos_${Date.now()}.csv`
    const tmpPath = path.join(process.cwd(), 'tmp', nome)
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true })
    await download.saveAs(tmpPath)
    await log(`  📥 CSV recebido: ${nome} (${fs.statSync(tmpPath).size} bytes)`)
    return tmpPath
  } catch (err) {
    await log(`  ⚠️ Sem download: ${err}`)
    return null
  }
}

/** O WinMax4 exporta em latin1 e antepõe uma linha "sep=;". */
function parsearCSV(csvPath: string): Record<string, string>[] {
  const content = fs.readFileSync(csvPath, 'latin1')
  let linhas = content.split('\n').map(l => l.trim()).filter(l => l)
  if (linhas.length < 2) return []
  if (linhas[0].startsWith('sep=')) linhas = linhas.slice(1)
  if (linhas.length < 2) return []

  const sep = linhas[0].includes(';') ? ';' : ','
  const headers = linhas[0].split(sep).map(h => h.replace(/"/g, '').trim())

  return linhas.slice(1).map(linha => {
    const cells = linha.split(sep).map(c => c.replace(/"/g, '').trim())
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = cells[i] || '' })
    return obj
  }).filter(l => Object.values(l).some(v => v))
}

export async function syncDocumentos(jobId?: string): Promise<void> {
  const log = async (msg: string) => {
    logger.info(msg)
    if (jobId) await appendJobLog(jobId, msg).catch(() => {})
  }

  const config  = await getConfig()
  const company = config.company_code || 'AUTOAVENIDA'

  // Todo o histórico. Ao contrário dos outros syncs, este NÃO pode ser incremental:
  // o estado de liquidação de um documento muda ao longo do tempo (uma fatura por
  // pagar hoje pode estar paga amanhã), pelo que é sempre preciso reimportar tudo.
  const dataInicio = '01/01/2000'
  const dataFim = new Date().toLocaleDateString('pt-PT').replace(/\//g, '/')

  await log(`📄 Sync Documentos emitidos: ${dataInicio} → ${dataFim}`)

  let browser: Browser | null = null
  let releaseLock: (() => void) | null = null
  let paginaAtiva: Page | null = null

  try {
    releaseLock = await acquireBrowserLock()
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    })
    const context = await browser.newContext({
      locale: 'pt-PT', timezoneId: 'Europe/Lisbon', acceptDownloads: true,
      storageState: { cookies: [], origins: [] },
    })
    const page = await context.newPage()
    paginaAtiva = page

    page.on('dialog', async (dialog) => {
      await log(`  🔔 Diálogo nativo do browser: [${dialog.type()}] "${dialog.message()}" — a aceitar`)
      await dialog.accept().catch(() => {})
    })

    await loginWinmax(page, config, log)
    await log('✅ Login OK')

    // Exporta PRIMEIRO — só se limpa a coleção depois de ter os dados em mão.
    // A ordem inversa já causou perda total de dados noutro sync quando a
    // exportação excedeu o tempo limite com a coleção já apagada.
    const csv = await exportarCSV(page, company, dataInicio, dataFim, 300000, log)

    if (!csv) {
      await log('  ⚠️ Sem CSV (timeout ou sem dados) — dados existentes PRESERVADOS, nada foi apagado')
      throw new Error('exportação da listagem de documentos emitidos falhou')
    }

    const linhas = parsearCSV(csv)
    await log(`  → ${linhas.length} documento(s) no CSV`)

    if (linhas.length === 0) {
      await log('  ⚠️ CSV vazio — dados existentes PRESERVADOS')
      fs.rmSync(csv, { force: true })
      return
    }

    // Limpa a coleção (reimportação total — ver nota sobre incremental acima)
    await log('  🗑️ A limpar documentos antigos...')
    let removidos = 0
    for (let ronda = 0; ronda < 200; ronda++) {
      const snap = await db().collection('documentos_emitidos').limit(490).get().catch(() => null)
      if (!snap || snap.empty) break
      const batch = db().batch()
      snap.docs.forEach(d => batch.delete(d.ref))
      await batch.commit().catch(() => {})
      removidos += snap.size
    }
    if (removidos > 0) await log(`  🗑️ ${removidos} documento(s) antigos removidos`)

    const agora = admin.firestore.FieldValue.serverTimestamp()
    const ops = linhas.map(d => {
      const total      = paraNumero(d['Total'])
      const liquidado  = paraNumero(d['TotalLiquidated'])
      // Arredonda a 2 casas para evitar resíduos de vírgula flutuante
      const porPagar   = Math.round((total - liquidado) * 100) / 100
      const tipo       = (d['DocumentCode'] || '').trim()
      const numero     = (d['DocumentNumber'] || '').trim()

      return {
        // Id determinístico: reimportar sobrepõe-se em vez de duplicar
        id: `${tipo}_${numero}`.replace(/[\/\\.#$[\]]/g, '_'),
        data: {
          tipo_documento:   tipo,
          numero_documento: numero,
          data:             normalizarData(d['DocumentDate']),
          data_vencimento:  normalizarData(d['DocumentDueDate'] || d['DocumentExpectedPaymentDate']),
          cliente_codigo:   (d['CustomerCode'] || '').trim(),
          // As faturas simplificadas (FS) são a consumidor final e não têm entidade
          // associada — o nome vem mesmo vazio, não é um erro de importação.
          cliente_nome:     (d['CustomerName'] || '').trim(),
          cliente_nif:      (d['CustomerTaxPayerNumber'] || '').trim(),
          total,
          total_liquidado:  liquidado,
          por_pagar:        porPagar,
          liquidado:        porPagar <= 0.005,
          moeda:            (d['CurrencyCode'] || 'EUR').trim(),
          utilizador:       (d['UserCode'] || '').trim(),
          ultima_sync:      agora,
        },
      }
    })

    // Grava em batches (o Firestore limita a 500 operações por batch)
    const SIZE = 450
    const chunks: typeof ops[] = []
    for (let i = 0; i < ops.length; i += SIZE) chunks.push(ops.slice(i, i + SIZE))

    for (let i = 0; i < chunks.length; i++) {
      const batch = db().batch()
      chunks[i].forEach(op => batch.set(db().collection('documentos_emitidos').doc(op.id), op.data, { merge: true }))
      await batch.commit()
      await log(`  ✅ Batch ${i + 1}/${chunks.length} guardado (${chunks[i].length} docs)`)
    }

    fs.rmSync(csv, { force: true })

    const porLiquidar = ops.filter(o => !o.data.liquidado)
    const totalDivida = Math.round(porLiquidar.reduce((s, o) => s + o.data.por_pagar, 0) * 100) / 100

    await db().collection('sync_log').add({
      tipo: 'documentos_emitidos',
      total: ops.length,
      por_liquidar: porLiquidar.length,
      total_divida: totalDivida,
      executado_em: agora,
      estado: 'ok',
    })

    await log(`✅ ${ops.length} documentos importados · ${porLiquidar.length} por liquidar · ${totalDivida.toFixed(2).replace('.', ',')} € em dívida`)

  } catch (err) {
    await log(`❌ Erro: ${err}`)
    logger.error(`❌ Sync Documentos: ${err}`)
    await db().collection('sync_log').add({
      tipo: 'documentos_emitidos', erro: String(err),
      executado_em: admin.firestore.FieldValue.serverTimestamp(), estado: 'erro',
    })
    throw err
  } finally {
    // Fechar o browser não termina a sessão do lado do WinMax4 — sem isto, o posto
    // de licença fica ocupado e os logins seguintes podem ficar presos.
    if (paginaAtiva) {
      try {
        const ok = await clicarToolboxPorTitulo(paginaAtiva, 'Terminar sessão')
        if (ok) await paginaAtiva.waitForTimeout(2000)
      } catch { /* não crítico */ }
    }
    await browser?.close().catch(() => {})
    releaseLock?.()
  }
}
