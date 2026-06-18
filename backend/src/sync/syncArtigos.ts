// sync/syncArtigos.ts — v4
// Navega directamente para os URLs das listagens (sem toolbox)
// URLs confirmados ao vivo:
//   Artigos Existências:  /MReports/Files/ArticleExistences.aspx
//   Artigos Compras/Vend: /MReports/Files/ArticlePurchasesSales.aspx
//   Vendas Documentos:    /MReports/Transactions/SalesIssuedDocuments.aspx
//   Compras Movimentos:   /MReports/Transactions/PurchasesArticleMovements.aspx
// Após confirmar, o resultado é um PDF via /Download.aspx
// A grelha HTML (se existir) está dentro do iframe da listagem

import { chromium, Browser, Page } from 'playwright'
import * as admin from 'firebase-admin'
import { db, appendJobLog, getConfig } from '../services/firebase'
import { logger } from '../services/logger'

const BASE = 'https://app102.winmax4.com'

async function loginWinmax(page: Page, config: any): Promise<void> {
  const url = `${BASE}/MainPage.aspx?CompanyCode=${config.company_code || 'AUTOAVENIDA'}`
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  // Aguarda e preenche o iframe de autenticação
  await page.waitForFunction(
    () => !!document.getElementById('UserAuthentication_content'),
    { timeout: 15000 }
  )

  await page.evaluate(({ user, pass }: { user: string; pass: string }) => {
    const f   = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
    const doc = f?.contentDocument
    if (!doc) return
    const u = doc.getElementById('txtUserLogin')    as HTMLInputElement
    const p = doc.getElementById('txtUserPassword') as HTMLInputElement
    if (u) { u.value = user; u.dispatchEvent(new Event('change', { bubbles: true })) }
    if (p) { p.value = pass; p.dispatchEvent(new Event('change', { bubbles: true })) }
  }, { user: config.utilizador || '', pass: config.password || '' })

  await page.waitForTimeout(300)
  await page.evaluate(() => {
    const f = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
    ;(f?.contentDocument?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
  })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(2000)
}

async function abrirListagem(
  page: Page,
  urlPath: string,
  companyCode: string
): Promise<void> {
  const fullUrl = `${BASE}${urlPath}?CompanyCode=${companyCode}`
  await page.goto(fullUrl, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
}

async function confirmarListagem(
  page: Page,
  di: string,
  df: string,
  campoInicio?: string,
  campoFim?: string
): Promise<void> {
  // Preenche os campos de data se existirem
  if (campoInicio && campoFim) {
    await page.evaluate(({ ci, cf, di, df }: any) => {
      const from = document.getElementById(ci) as HTMLInputElement
      const to   = document.getElementById(cf) as HTMLInputElement
      if (from) { from.value = di; from.dispatchEvent(new Event('change', { bubbles: true })) }
      if (to)   { to.value   = df; to.dispatchEvent(new Event('change', { bubbles: true })) }
    }, { ci: campoInicio, cf: campoFim, di, df })
    await page.waitForTimeout(300)
  }

  // Clica Confirmar
  await page.evaluate(() => {
    const btn = document.getElementById('wucButtonConfirm_linkButton1') as HTMLElement
    btn?.click()
  })
  await page.waitForTimeout(5000) // aguarda o download/resultado
}

async function extrairDados(page: Page): Promise<Record<string, string>[]> {
  return page.evaluate(() => {
    // Procura a tabela de resultados
    const tables = Array.from(document.querySelectorAll('table'))
    for (const t of tables) {
      const ths = Array.from(t.querySelectorAll('th'))
        .map(th => (th as HTMLElement).innerText.trim())
        .filter(h => h)
      if (ths.length < 2) continue
      const rows = Array.from(t.querySelectorAll('tbody tr'))
      if (rows.length === 0) continue
      return rows.map(tr => {
        const cells = Array.from(tr.querySelectorAll('td'))
          .map(td => (td as HTMLElement).innerText.trim())
        const obj: Record<string, string> = {}
        ths.forEach((h, i) => { obj[h] = cells[i] || '' })
        return obj
      }).filter((l: Record<string, string>) => Object.values(l).some((v: string) => v))
    }
    return []
  })
}

export async function syncWinmax(jobId?: string): Promise<void> {
  const log = async (msg: string) => {
    logger.info(msg)
    if (jobId) await appendJobLog(jobId, msg).catch(() => {})
  }

  const config  = await getConfig()
  const company = config.company_code || 'AUTOAVENIDA'
  const dataInicio = (config.sync_data_inicio || '01-01-2000').replace(/-/g, '/')
  const dataFim    = (config.sync_data_fim || new Date().toLocaleDateString('pt-PT').replace(/\//g, '-')).replace(/-/g, '/')

  await log(`🔄 Sync WinMax4: ${dataInicio} → ${dataFim}`)

  let browser: Browser | null = null
  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      locale: 'pt-PT',
      timezoneId: 'Europe/Lisbon',
      acceptDownloads: true,
      storageState: { cookies: [], origins: [] },
    })

    // Interceta downloads (não bloquear)
    context.on('page', p => p.on('download', d => d.cancel()))

    const page = await context.newPage()

    // Login
    await loginWinmax(page, config)
    await log('✅ Login OK')

    const now   = admin.firestore.FieldValue.serverTimestamp()
    const batch = db().batch()

    // ─── Artigos Existências ───────────────────────────────────────────────
    await log('📦 Artigos Existências...')
    await abrirListagem(page, '/MReports/Files/ArticleExistences.aspx', company)
    await confirmarListagem(page, dataInicio, dataFim) // sem campos de data (usa família)
    const artigos = await extrairDados(page)
    await log(`  → ${artigos.length} artigos`)

    for (const a of artigos) {
      const codigo = a['Código'] || a['Artigo'] || a['Ref.'] || a['Referência'] || a['Cód.'] || Object.values(a)[0]
      if (!codigo) continue
      batch.set(db().collection('artigos').doc(String(codigo).replace(/[\/\\]/g,'_')), {
        codigo: String(codigo),
        descricao:   a['Descrição'] || a['Designação'] || a['Nome'] || '',
        taxa_iva:    parseFloat((a['IVA'] || a['Taxa IVA'] || '23').replace('%','').replace(',','.')) || 23,
        preco_venda: parseFloat((a['Preço'] || a['PVP'] || a['PVP1'] || '0').replace(',','.')) || 0,
        existencias: parseFloat((a['Existências'] || a['Stock'] || a['Saldo'] || '0').replace(',','.')) || 0,
        ultima_sync: now,
      }, { merge: true })
    }

    // ─── Vendas Documentos ────────────────────────────────────────────────
    await log('📈 Vendas Documentos...')
    await abrirListagem(page, '/MReports/Transactions/SalesIssuedDocuments.aspx', company)
    await confirmarListagem(page, dataInicio, dataFim,
      'wucCalendarFromDate_txtModernDate', 'wucCalendarToDate_txtModernDate')
    const vendas = await extrairDados(page)
    await log(`  → ${vendas.length} vendas`)

    for (const v of vendas) {
      const id = `${v['Nº Doc'] || v['Documento'] || ''}_${v['Data'] || ''}`.replace(/[\/\\]/g,'_')
      if (!id || id === '_') continue
      batch.set(db().collection('movimentos_venda').doc(id), {
        data: v['Data'] || '', numero_doc: v['Nº Doc'] || v['Documento'] || '',
        tipo_doc: v['Tipo'] || '', cliente_codigo: v['Cód. Cliente'] || v['Cliente'] || '',
        cliente_nome: v['Nome'] || v['Entidade'] || '',
        artigo_codigo: v['Artigo'] || v['Código'] || '', artigo_descricao: v['Descrição'] || '',
        quantidade: parseFloat((v['Qtd'] || v['Quantidade'] || '0').replace(',','.')) || 0,
        preco_unitario: parseFloat((v['Preço'] || v['PVP'] || '0').replace(',','.')) || 0,
        total: parseFloat((v['Total'] || v['Líquido'] || '0').replace(',','.')) || 0,
        ultima_sync: now,
      }, { merge: true })
    }

    // ─── Compras Movimentos ───────────────────────────────────────────────
    await log('📉 Compras Movimentos...')
    await abrirListagem(page, '/MReports/Transactions/PurchasesArticleMovements.aspx', company)
    await confirmarListagem(page, dataInicio, dataFim,
      'wucCalendarFromDate_txtModernDate', 'wucCalendarToDate_txtModernDate')
    const compras = await extrairDados(page)
    await log(`  → ${compras.length} compras`)

    for (const c of compras) {
      const id = `${c['Nº Doc'] || ''}_${c['Artigo'] || ''}_${c['Data'] || ''}`.replace(/[\/\\]/g,'_')
      if (!id || id === '__') continue
      batch.set(db().collection('movimentos_compra').doc(id), {
        data: c['Data'] || '', numero_doc: c['Nº Doc'] || '', tipo_doc: c['Tipo'] || '',
        fornecedor_codigo: c['Cód. Fornecedor'] || c['Fornecedor'] || '', fornecedor_nome: c['Nome'] || '',
        artigo_codigo: c['Artigo'] || c['Código'] || '', artigo_descricao: c['Descrição'] || '',
        quantidade: parseFloat((c['Qtd'] || '0').replace(',','.')) || 0,
        preco_unitario: parseFloat((c['Preço'] || '0').replace(',','.')) || 0,
        total: parseFloat((c['Total'] || '0').replace(',','.')) || 0,
        ultima_sync: now,
      }, { merge: true })
    }

    if (artigos.length + vendas.length + compras.length > 0) await batch.commit()

    await db().collection('sync_log').add({
      tipo: 'winmax_completa', data_inicio: dataInicio, data_fim: dataFim,
      artigos: artigos.length, vendas: vendas.length, compras: compras.length,
      executado_em: now, estado: 'ok',
    })

    await log(`✅ Sync: ${artigos.length} artigos | ${vendas.length} vendas | ${compras.length} compras`)

  } catch (err) {
    logger.error(`❌ Sync: ${err}`)
    await db().collection('sync_log').add({
      tipo: 'winmax_completa', erro: String(err),
      executado_em: admin.firestore.FieldValue.serverTimestamp(), estado: 'erro',
    })
    if (jobId) await appendJobLog(jobId, `❌ ${err}`).catch(() => {})
  } finally {
    await browser?.close()
  }
}
