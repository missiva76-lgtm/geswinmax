// sync/syncArtigos.ts
// Seletores confirmados ao vivo em 17/06/2026
//
// Toolbox atalhos (página 2):
//   Div0 → Artigos Existências   → reportFileArticlesExistences_content
//          filtros: txtFromFamilyCode / txtToFamilyCode
//          confirmar: wucButtonConfirm_linkButton1
//          download: Download.aspx?type=4&filename=...ArticleExistences...pdf
//
//   Div1 → Artigos Compras/Vendas → reportFileArticlesPurchasesSales_content
//          filtros: wucCalFromDate_txtModernDate / wucCalToDate_txtModernDate
//
//   Div5 → Vendas Documentos      → reportTransactionsSalesIssuedDocuments_content
//          filtros: wucCalendarFromDate_txtModernDate / wucCalendarToDate_txtModernDate
//
// Toolbox página 1 Div7 → Compras Movimentos → reportTransactionsPurchasesArticleMovements_content
//          filtros: wucCalendarFromDate_txtModernDate / wucCalendarToDate_txtModernDate
//
// NOTA: As listagens exportam PDF via Download.aspx
// Para sync de dados, o Playwright intercepta o download, lê o XML/PDF
// e extrai os dados. Alternativamente, usa-se web scraping directo da grelha.

import { chromium, Browser, Page } from 'playwright'
import * as admin from 'firebase-admin'
import { db, getConfig } from '../services/firebase'
import { logger } from '../services/logger'

// Navega para a página N da toolbox
async function irParaPaginaToolbox(page: Page, paginaAlvo: number): Promise<void> {
  const toolbox = () => page.evaluate(() => {
    const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
    return tb?.contentDocument?.getElementById('LabelPages')?.innerText?.trim() || '1 / 11'
  })

  let tentativas = 0
  while (tentativas < 15) {
    const label = await toolbox()
    const actual = parseInt(label.split('/')[0].trim())
    if (actual === paginaAlvo) break
    if (actual < paginaAlvo) {
      await page.evaluate(() => {
        const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
        ;(tb?.contentDocument?.getElementById('LinkButtonNextPage') as HTMLElement)?.click()
      })
    } else {
      await page.evaluate(() => {
        const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
        ;(tb?.contentDocument?.getElementById('LinkButtonPrevPage') as HTMLElement)?.click()
      })
    }
    await page.waitForTimeout(500)
    tentativas++
  }
}

// Abre um atalho da toolbox e aguarda o iframe
async function abrirAtalho(page: Page, paginaToolbox: number, divIdx: number, iframeId: string): Promise<void> {
  await irParaPaginaToolbox(page, paginaToolbox)
  await page.evaluate((idx: number) => {
    const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
    ;(tb?.contentDocument?.getElementById(`Toolbox_ShortcutIconDiv${idx}`) as HTMLElement)?.click()
  }, divIdx)
  await page.waitForTimeout(1500)
  await page.waitForFunction(
    (id: string) => !!document.getElementById(id),
    iframeId, { timeout: 10000 }
  )
}

// Preenche datas e confirma uma listagem
async function confirmarListagem(
  page: Page,
  iframeId: string,
  dataInicio: string,
  dataFim: string,
  campoInicio: string,
  campoFim: string
): Promise<void> {
  await page.evaluate(({ id, di, df, ci, cf }: { id: string; di: string; df: string; ci: string; cf: string }) => {
    const f   = document.getElementById(id) as HTMLIFrameElement
    const doc = f?.contentDocument
    if (!doc) return
    const from = doc.getElementById(ci) as HTMLInputElement
    const to   = doc.getElementById(cf) as HTMLInputElement
    if (from) { from.value = di; from.dispatchEvent(new Event('change', { bubbles: true })) }
    if (to)   { to.value   = df; to.dispatchEvent(new Event('change', { bubbles: true })) }
  }, { id: iframeId, di: dataInicio, df: dataFim, ci: campoInicio, cf: campoFim })
  await page.waitForTimeout(300)

  await page.evaluate((id: string) => {
    const f = document.getElementById(id) as HTMLIFrameElement
    ;(f?.contentDocument?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
  }, iframeId)
  await page.waitForTimeout(4000)
}

// Extrai dados da grelha de uma listagem (se disponível)
async function extrairGrelha(page: Page, iframeId: string): Promise<Record<string, string>[]> {
  return page.evaluate((id: string) => {
    const f   = document.getElementById(id) as HTMLIFrameElement
    const doc = f?.contentDocument
    if (!doc) return []

    const tabelas = Array.from(doc.querySelectorAll('table'))
    const tabela  = tabelas.find(t => {
      const headers = Array.from(t.querySelectorAll('th')).map(th => (th as HTMLElement).innerText.trim())
      return headers.length > 2
    })
    if (!tabela) return []

    const headers = Array.from(tabela.querySelectorAll('th'))
      .map(th => (th as HTMLElement).innerText.trim())
      .filter(h => h)

    return Array.from(tabela.querySelectorAll('tbody tr')).map(tr => {
      const cells = Array.from(tr.querySelectorAll('td'))
        .map(td => (td as HTMLElement).innerText.trim())
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => { obj[h] = cells[i] || '' })
      return obj
    }).filter(l => Object.values(l).some(v => v))
  }, iframeId)
}

export async function syncWinmax(): Promise<void> {
  const config  = await getConfig()
  const dataInicio = (config.sync_data_inicio || '01-01-2000').replace(/-/g, '/')
  const dataFim    = (config.sync_data_fim || new Date().toLocaleDateString('pt-PT').replace(/\//g, '-')).replace(/-/g, '/')

  logger.info(`🔄 Sync WinMax4: ${dataInicio} → ${dataFim}`)

  let browser: Browser | null = null

  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ locale: 'pt-PT', timezoneId: 'Europe/Lisbon', acceptDownloads: true })
    const page    = await context.newPage()

    // Login
    const url = `https://app102.winmax4.com/Default.aspx?CompanyCode=${config.company_code || 'AUTOAVENIDA'}`
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.fill('#txtUserCode', config.utilizador || '')
    await page.fill('#txtPassword', config.password   || '')
    await page.click('#btnLogin')
    await page.waitForLoadState('networkidle')
    logger.info('✅ Login sync OK')

    const batch = db().batch()
    const now   = admin.firestore.FieldValue.serverTimestamp()

    // ─── Artigos + Existências (página 2, Div0) ─────────────────────────────
    await abrirAtalho(page, 2, 0, 'reportFileArticlesExistences_content')
    await confirmarListagem(page, 'reportFileArticlesExistences_content',
      dataInicio, dataFim,
      'txtFromFamilyCode', 'txtToFamilyCode'   // estes campos são famílias, não datas
    )
    const artigos = await extrairGrelha(page, 'reportFileArticlesExistences_content')
    logger.info(`  📦 ${artigos.length} artigos`)

    for (const a of artigos) {
      const codigo = a['Código'] || a['Artigo'] || a['Ref.'] || a['Referência']
      if (!codigo) continue
      const ref = db().collection('artigos').doc(codigo.replace(/[\/\\]/g, '_'))
      batch.set(ref, {
        codigo,
        descricao:   a['Descrição'] || a['Designação'] || '',
        taxa_iva:    parseFloat((a['IVA'] || a['Taxa IVA'] || '23').replace('%','').replace(',','.')) || 23,
        preco_venda: parseFloat((a['Preço'] || a['PVP'] || a['PVP1'] || '0').replace(',','.')) || 0,
        existencias: parseFloat((a['Existências'] || a['Stock'] || a['Saldo'] || '0').replace(',','.')) || 0,
        ultima_sync: now,
      }, { merge: true })
    }

    // ─── Artigos Compras/Vendas (página 2, Div1) ────────────────────────────
    await abrirAtalho(page, 2, 1, 'reportFileArticlesPurchasesSales_content')
    await confirmarListagem(page, 'reportFileArticlesPurchasesSales_content',
      dataInicio, dataFim,
      'wucCalFromDate_txtModernDate', 'wucCalToDate_txtModernDate'
    )
    const artComprasVendas = await extrairGrelha(page, 'reportFileArticlesPurchasesSales_content')
    logger.info(`  📊 ${artComprasVendas.length} artigos compras/vendas`)

    // ─── Vendas Documentos (página 2, Div5) ─────────────────────────────────
    await abrirAtalho(page, 2, 5, 'reportTransactionsSalesIssuedDocuments_content')
    await confirmarListagem(page, 'reportTransactionsSalesIssuedDocuments_content',
      dataInicio, dataFim,
      'wucCalendarFromDate_txtModernDate', 'wucCalendarToDate_txtModernDate'
    )
    const vendas = await extrairGrelha(page, 'reportTransactionsSalesIssuedDocuments_content')
    logger.info(`  📈 ${vendas.length} documentos de venda`)

    for (const v of vendas) {
      const id = `${v['Nº Doc'] || v['Documento'] || ''}_${v['Data'] || ''}`.replace(/[\/\\]/g,'_')
      if (!id || id === '_') continue
      batch.set(db().collection('movimentos_venda').doc(id), {
        data:             v['Data'] || '',
        numero_doc:       v['Nº Doc'] || v['Documento'] || '',
        tipo_doc:         v['Tipo'] || '',
        cliente_codigo:   v['Cód. Cliente'] || v['Cliente'] || '',
        cliente_nome:     v['Nome'] || v['Entidade'] || '',
        artigo_codigo:    v['Artigo'] || v['Código'] || '',
        artigo_descricao: v['Descrição'] || '',
        quantidade:       parseFloat((v['Qtd'] || v['Quantidade'] || '0').replace(',','.')) || 0,
        preco_unitario:   parseFloat((v['Preço'] || v['PVP'] || '0').replace(',','.')) || 0,
        total:            parseFloat((v['Total'] || v['Líquido'] || '0').replace(',','.')) || 0,
        ultima_sync:      now,
      }, { merge: true })
    }

    // ─── Compras Movimentos (página 1, Div7) ─────────────────────────────────
    await abrirAtalho(page, 1, 7, 'reportTransactionsPurchasesArticleMovements_content')
    await confirmarListagem(page, 'reportTransactionsPurchasesArticleMovements_content',
      dataInicio, dataFim,
      'wucCalendarFromDate_txtModernDate', 'wucCalendarToDate_txtModernDate'
    )
    const compras = await extrairGrelha(page, 'reportTransactionsPurchasesArticleMovements_content')
    logger.info(`  📉 ${compras.length} movimentos de compra`)

    for (const c of compras) {
      const id = `${c['Nº Doc'] || ''}_${c['Artigo'] || ''}_${c['Data'] || ''}`.replace(/[\/\\]/g,'_')
      if (!id || id === '__') continue
      batch.set(db().collection('movimentos_compra').doc(id), {
        data:               c['Data'] || '',
        numero_doc:         c['Nº Doc'] || '',
        tipo_doc:           c['Tipo'] || '',
        fornecedor_codigo:  c['Cód. Fornecedor'] || c['Fornecedor'] || '',
        fornecedor_nome:    c['Nome'] || '',
        artigo_codigo:      c['Artigo'] || c['Código'] || '',
        artigo_descricao:   c['Descrição'] || '',
        quantidade:         parseFloat((c['Qtd'] || '0').replace(',','.')) || 0,
        preco_unitario:     parseFloat((c['Preço'] || '0').replace(',','.')) || 0,
        total:              parseFloat((c['Total'] || '0').replace(',','.')) || 0,
        ultima_sync:        now,
      }, { merge: true })
    }

    await batch.commit()

    await db().collection('sync_log').add({
      tipo:        'winmax_completa',
      data_inicio: dataInicio,
      data_fim:    dataFim,
      artigos:     artigos.length,
      vendas:      vendas.length,
      compras:     compras.length,
      executado_em: now,
      estado:      'ok',
    })

    logger.info('✅ Sync concluída')
  } catch (err) {
    logger.error(`❌ Sync falhou: ${err}`)
    await db().collection('sync_log').add({
      tipo: 'winmax_completa', erro: String(err),
      executado_em: admin.firestore.FieldValue.serverTimestamp(), estado: 'erro',
    })
  } finally {
    await browser?.close()
  }
}
