// sync/syncArtigos.ts — v3 com logging detalhado para diagnóstico
// Abordagem: tenta múltiplas estratégias e loga o que encontra

import { chromium, Browser, Page } from 'playwright'
import * as admin from 'firebase-admin'
import { db, appendJobLog, getConfig } from '../services/firebase'
import { logger } from '../services/logger'

async function irParaPaginaToolbox(page: Page, paginaAlvo: number): Promise<void> {
  let t = 0
  while (t < 20) {
    const label = await page.evaluate(() => {
      const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
      return tb?.contentDocument?.getElementById('LabelPages')?.innerText?.trim() || '1 / 11'
    })
    const actual = parseInt(label.split('/')[0].trim())
    if (actual === paginaAlvo) break
    await page.evaluate((vai: string) => {
      const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
      ;(tb?.contentDocument?.getElementById(vai) as HTMLElement)?.click()
    }, actual < paginaAlvo ? 'LinkButtonNextPage' : 'LinkButtonPrevPage')
    await page.waitForTimeout(400)
    t++
  }
}

async function abrirAtalhoEAguardar(page: Page, pag: number, div: number, iframeId: string): Promise<void> {
  // Aguarda a toolbox estar disponível
  await page.waitForFunction(
    () => !!(document.getElementById('Toolbox_content') as HTMLIFrameElement)?.contentDocument?.getElementById('LabelPages'),
    { timeout: 15000 }
  )
  await irParaPaginaToolbox(page, pag)
  await page.evaluate((idx: number) => {
    const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
    ;(tb?.contentDocument?.getElementById(`Toolbox_ShortcutIconDiv${idx}`) as HTMLElement)?.click()
  }, div)
  await page.waitForTimeout(2500)
  await page.waitForFunction((id: string) => !!document.getElementById(id), iframeId, { timeout: 20000 })
}

async function confirmarListagem(page: Page, iframeId: string, di: string, df: string, campoInicio: string, campoFim: string): Promise<void> {
  await page.evaluate(({ id, di, df, ci, cf }: any) => {
    const f = document.getElementById(id) as HTMLIFrameElement
    const doc = f?.contentDocument
    if (!doc) return
    const from = doc.getElementById(ci) as HTMLInputElement
    const to   = doc.getElementById(cf) as HTMLInputElement
    if (from) { from.value = di; from.dispatchEvent(new Event('change', { bubbles: true })) }
    if (to)   { to.value   = df; to.dispatchEvent(new Event('change', { bubbles: true })) }
  }, { id: iframeId, di, df, ci: campoInicio, cf: campoFim })
  await page.waitForTimeout(300)
  await page.evaluate((id: string) => {
    const f = document.getElementById(id) as HTMLIFrameElement
    ;(f?.contentDocument?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
  }, iframeId)
  await page.waitForTimeout(5000)  // aguarda mais tempo
}

// Diagnostica o que está dentro de um iframe após confirmar
async function diagnosticarIframe(page: Page, iframeId: string): Promise<string> {
  return page.evaluate((id: string) => {
    const f   = document.getElementById(id) as HTMLIFrameElement
    const doc = f?.contentDocument
    if (!doc) return `iframe ${id} não encontrado`

    // Todos os iframes dentro (pode ter sub-iframes)
    const subIframes = Array.from(doc.querySelectorAll('iframe')).map(sf => sf.id + '|' + sf.src?.replace('https://app102.winmax4.com',''))

    // Tabelas com dados
    const tabelas = Array.from(doc.querySelectorAll('table')).map(t => {
      const ths = Array.from(t.querySelectorAll('th')).map(th => (th as HTMLElement).innerText.trim()).join(',')
      const nLinhas = t.querySelectorAll('tbody tr').length
      return `headers:[${ths}] rows:${nLinhas}`
    })

    // Texto visível resumido
    const texto = doc.body?.innerText?.trim()?.slice(0, 200)

    return JSON.stringify({ subIframes, tabelas, texto })
  }, iframeId)
}

export async function syncWinmax(jobId?: string): Promise<void> {
  const log = async (msg: string) => {
    logger.info(msg)
    if (jobId) await appendJobLog(jobId, msg).catch(() => {})
  }

  const config = await getConfig()
  const dataInicio = (config.sync_data_inicio || '01-01-2000').replace(/-/g, '/')
  const dataFim    = (config.sync_data_fim || new Date().toLocaleDateString('pt-PT').replace(/\//g, '-')).replace(/-/g, '/')

  await log(`🔄 Sync WinMax4: ${dataInicio} → ${dataFim}`)

  let browser: Browser | null = null
  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ locale: 'pt-PT', timezoneId: 'Europe/Lisbon', acceptDownloads: true, storageState: { cookies: [], origins: [] } })
    const page = await context.newPage()

    // Interceta downloads para não bloquear
    page.on('download', async download => {
      const nome = download.suggestedFilename()
      await log(`📥 Download interceptado: ${nome}`)
      await download.cancel()
    })

// Login WinMax4
    // O WinMax4 abre sempre no MainPage com um iframe de autenticação UserAuthentication_content
    // Campos: txtUserLogin / txtUserPassword — botão: wucButtonConfirm_linkButton1
    const url = `https://app102.winmax4.com/MainPage.aspx?CompanyCode=${config.company_code || 'AUTOAVENIDA'}`
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // Aguarda o iframe de autenticação
    await page.waitForFunction(
      () => !!document.getElementById('UserAuthentication_content'),
      { timeout: 15000 }
    )

    // Preenche no iframe de autenticação
    await page.evaluate(({ user, pass }: { user: string; pass: string }) => {
      const f   = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
      const doc = f?.contentDocument
      if (!doc) return
      const u = doc.getElementById('txtUserLogin')   as HTMLInputElement
      const p = doc.getElementById('txtUserPassword') as HTMLInputElement
      if (u) { u.value = user; u.dispatchEvent(new Event('change', { bubbles: true })) }
      if (p) { p.value = pass; p.dispatchEvent(new Event('change', { bubbles: true })) }
    }, { user: config.utilizador || '', pass: config.password || '' })
    await page.waitForTimeout(500)

    // Clica Confirmar
    await page.evaluate(() => {
      const f = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
      ;(f?.contentDocument?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
    })
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    await log('✅ Login OK')

    const now = admin.firestore.FieldValue.serverTimestamp()
    const batch = db().batch()

    // ─── Artigos Existências ───────────────────────────────────────────────
    await log('📦 A abrir Artigos Existências...')
    await abrirAtalhoEAguardar(page, 2, 0, 'reportFileArticlesExistences_content')
    await confirmarListagem(page, 'reportFileArticlesExistences_content',
      dataInicio, dataFim, 'txtFromFamilyCode', 'txtToFamilyCode')
    const diagArtigos = await diagnosticarIframe(page, 'reportFileArticlesExistences_content')
    await log(`  📋 Artigos diagnóstico: ${diagArtigos}`)

    // Tenta extrair da grelha principal
    const artigos = await page.evaluate((id: string) => {
      const f = document.getElementById(id) as HTMLIFrameElement
      const doc = f?.contentDocument
      if (!doc) return []
      // Procura qualquer tabela com dados
      const tables = Array.from(doc.querySelectorAll('table'))
      for (const t of tables) {
        const ths = Array.from(t.querySelectorAll('th')).map(th => (th as HTMLElement).innerText.trim()).filter(h => h)
        if (ths.length < 2) continue
        const rows = Array.from(t.querySelectorAll('tbody tr'))
        if (rows.length === 0) continue
        return rows.map(tr => {
          const cells = Array.from(tr.querySelectorAll('td')).map(td => (td as HTMLElement).innerText.trim())
          const obj: Record<string, string> = {}
          ths.forEach((h, i) => { obj[h] = cells[i] || '' })
          return obj
        }).filter((l: Record<string, string>) => Object.values(l).some((v: string) => v))
      }
      return []
    }, 'reportFileArticlesExistences_content')

    await log(`  📦 ${artigos.length} artigos extraídos`)

    for (const a of artigos) {
      const codigo = a['Código'] || a['Artigo'] || a['Ref.'] || a['Referência'] || a['Cód.'] || Object.values(a)[0]
      if (!codigo) continue
      batch.set(db().collection('artigos').doc(String(codigo).replace(/[\/\\]/g, '_')), {
        codigo: String(codigo),
        descricao:   a['Descrição'] || a['Designação'] || a['Nome'] || '',
        taxa_iva:    parseFloat((a['IVA'] || a['Taxa IVA'] || '23').replace('%','').replace(',','.')) || 23,
        preco_venda: parseFloat((a['Preço'] || a['PVP'] || a['PVP1'] || '0').replace(',','.')) || 0,
        existencias: parseFloat((a['Existências'] || a['Stock'] || a['Saldo'] || '0').replace(',','.')) || 0,
        ultima_sync: now,
      }, { merge: true })
    }

    // ─── Vendas Documentos ────────────────────────────────────────────────
    await log('📈 A abrir Vendas Documentos...')
    await abrirAtalhoEAguardar(page, 2, 5, 'reportTransactionsSalesIssuedDocuments_content')
    await confirmarListagem(page, 'reportTransactionsSalesIssuedDocuments_content',
      dataInicio, dataFim, 'wucCalendarFromDate_txtModernDate', 'wucCalendarToDate_txtModernDate')
    const diagVendas = await diagnosticarIframe(page, 'reportTransactionsSalesIssuedDocuments_content')
    await log(`  📋 Vendas diagnóstico: ${diagVendas}`)

    const vendas = await page.evaluate((id: string) => {
      const f = document.getElementById(id) as HTMLIFrameElement
      const doc = f?.contentDocument
      if (!doc) return []
      const tables = Array.from(doc.querySelectorAll('table'))
      for (const t of tables) {
        const ths = Array.from(t.querySelectorAll('th')).map(th => (th as HTMLElement).innerText.trim()).filter(h => h)
        if (ths.length < 2) continue
        const rows = Array.from(t.querySelectorAll('tbody tr'))
        if (rows.length === 0) continue
        return rows.map(tr => {
          const cells = Array.from(tr.querySelectorAll('td')).map(td => (td as HTMLElement).innerText.trim())
          const obj: Record<string, string> = {}
          ths.forEach((h, i) => { obj[h] = cells[i] || '' })
          return obj
        }).filter((l: Record<string, string>) => Object.values(l).some((v: string) => v))
      }
      return []
    }, 'reportTransactionsSalesIssuedDocuments_content')

    await log(`  📈 ${vendas.length} vendas extraídas`)

    for (const v of vendas) {
      const id = `${v['Nº Doc'] || v['Documento'] || ''}_${v['Data'] || ''}`.replace(/[\/\\]/g,'_')
      if (!id || id === '_') continue
      batch.set(db().collection('movimentos_venda').doc(id), {
        data: v['Data'] || '', numero_doc: v['Nº Doc'] || v['Documento'] || '',
        tipo_doc: v['Tipo'] || '', cliente_codigo: v['Cód. Cliente'] || v['Cliente'] || '',
        cliente_nome: v['Nome'] || v['Entidade'] || '', artigo_codigo: v['Artigo'] || v['Código'] || '',
        artigo_descricao: v['Descrição'] || '',
        quantidade: parseFloat((v['Qtd'] || v['Quantidade'] || '0').replace(',','.')) || 0,
        preco_unitario: parseFloat((v['Preço'] || v['PVP'] || '0').replace(',','.')) || 0,
        total: parseFloat((v['Total'] || v['Líquido'] || '0').replace(',','.')) || 0,
        ultima_sync: now,
      }, { merge: true })
    }

    // ─── Compras Movimentos ───────────────────────────────────────────────
    await log('📉 A abrir Compras Movimentos...')
    await abrirAtalhoEAguardar(page, 1, 7, 'reportTransactionsPurchasesArticleMovements_content')
    await confirmarListagem(page, 'reportTransactionsPurchasesArticleMovements_content',
      dataInicio, dataFim, 'wucCalendarFromDate_txtModernDate', 'wucCalendarToDate_txtModernDate')
    const diagCompras = await diagnosticarIframe(page, 'reportTransactionsPurchasesArticleMovements_content')
    await log(`  📋 Compras diagnóstico: ${diagCompras}`)

    const compras = await page.evaluate((id: string) => {
      const f = document.getElementById(id) as HTMLIFrameElement
      const doc = f?.contentDocument
      if (!doc) return []
      const tables = Array.from(doc.querySelectorAll('table'))
      for (const t of tables) {
        const ths = Array.from(t.querySelectorAll('th')).map(th => (th as HTMLElement).innerText.trim()).filter(h => h)
        if (ths.length < 2) continue
        const rows = Array.from(t.querySelectorAll('tbody tr'))
        if (rows.length === 0) continue
        return rows.map(tr => {
          const cells = Array.from(tr.querySelectorAll('td')).map(td => (td as HTMLElement).innerText.trim())
          const obj: Record<string, string> = {}
          ths.forEach((h, i) => { obj[h] = cells[i] || '' })
          return obj
        }).filter((l: Record<string, string>) => Object.values(l).some((v: string) => v))
      }
      return []
    }, 'reportTransactionsPurchasesArticleMovements_content')

    await log(`  📉 ${compras.length} compras extraídas`)

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
      tipo: 'winmax_completa',
      data_inicio: dataInicio, data_fim: dataFim,
      artigos: artigos.length, vendas: vendas.length, compras: compras.length,
      executado_em: now,
      estado: 'ok',
      nota: artigos.length === 0 ? 'ATENÇÃO: 0 artigos — verificar logs para diagnóstico' : '',
    })

    await log(`✅ Sync: ${artigos.length} artigos | ${vendas.length} vendas | ${compras.length} compras`)

  } catch (err) {
    logger.error(`❌ Sync: ${err}`)
    await db().collection('sync_log').add({
      tipo: 'winmax_completa', erro: String(err),
      executado_em: admin.firestore.FieldValue.serverTimestamp(), estado: 'erro',
    })
    if (jobId) await appendJobLog(jobId, `❌ Erro: ${err}`).catch(() => {})
  } finally {
    await browser?.close()
  }
}
