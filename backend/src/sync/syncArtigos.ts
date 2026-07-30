// sync/syncArtigos.ts — v6
// Exporta as listagens em formato CSV usando o campo ddlDocType
// Seletores confirmados ao vivo:
//   ddlSendTo: '1' = Ficheiro
//   ddlDocType: '3' = Excel (.csv)  /  '1' = Excel (.xls)
//   __doPostBack('ddlSendTo', '') para activar o select de formato

import { chromium, Browser, Page, Download } from 'playwright'
import { acquireBrowserLock } from '../services/browserLock'
import * as admin from 'firebase-admin'
import * as fs from 'fs'
import * as path from 'path'
import { db, appendJobLog, getConfig } from '../services/firebase'
import { logger } from '../services/logger'
import { clicarToolboxPorTitulo } from '../rpa/toolboxHelper'

const BASE = 'https://app102.winmax4.com'

// CORRIGIDO 30/07/2026: o login tem cinco etapas distintas, mas nenhuma aparecia no
// log do job — só na consola do servidor, invisível para quem usa a aplicação. Quando
// falhou com "TimeoutError: 30000ms" (um valor que não corresponde a nenhuma espera
// deste ficheiro, todas de 90s), o log tinha apenas duas linhas e não havia forma de
// saber em que etapa parou. Passa a registar cada passo, para a próxima falha ser
// diagnosticável de imediato em vez de exigir mais uma ronda de tentativas.
async function loginWinmax(page: Page, config: any, log?: (msg: string) => Promise<void> | void): Promise<void> {
  const passo = async (msg: string) => { console.log(`[Sync] ${msg}`); await log?.(`  · ${msg}`) }

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
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch((e) => {
      console.log('[Sync] waitForNavigation falhou (pode ser normal):', e.message)
    }),
    page.evaluate(() => {
      const f = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
      ;(f?.contentDocument?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
    })
  ])
  await passo('login 4/5 — a aguardar o carregamento pós-autenticação')
  await page.waitForTimeout(3000)
  
  // Verifica se ainda está no ecrã de login (credenciais erradas)
  const aindaLogin = await page.evaluate(() => !!document.getElementById('UserAuthentication_content')).catch(() => false)
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

// Abre uma listagem, muda para CSV e faz download
async function exportarCSV(
  page: Page,
  urlPath: string,
  company: string,
  opts?: {
    campoInicio?: string
    campoFim?: string
    di?: string
    df?: string
    timeout?: number
  }
): Promise<string | null> {
  // Abre a listagem dentro do MainPage via iframe (mantém a sessão)
  const iframeId = urlPath.split('/').pop()?.replace('.aspx','') + '_content'
  
  // Injeta a listagem como iframe dentro do MainPage
  await page.evaluate(({ urlPath, company, iframeId, base }: any) => {
    // CORRIGIDO 30/07/2026: removia-se apenas o iframe com o MESMO id, pelo que os
    // relatórios anteriores ficavam na página. Ao chegar às compras já havia três
    // iframes em ecrã inteiro empilhados (artigos, vendas, compras), cada um com uma
    // página de relatório do WinMax4 carregada — num servidor com 512 MB. É a
    // explicação mais provável para a exportação das compras falhar sempre que corre
    // depois das vendas, e nunca quando corre cedo. Agora removem-se todos.
    document.querySelectorAll('iframe[data-rpa-relatorio]').forEach(el => el.remove())

    // Cria novo iframe
    const iframe = document.createElement('iframe')
    iframe.id = iframeId
    iframe.name = iframeId
    iframe.dataset.rpaRelatorio = '1'
    iframe.src = `${base}${urlPath}?CompanyCode=${company}`
    iframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;border:none;'
    document.body.appendChild(iframe)
  }, { urlPath, company, iframeId, base: BASE })

  await page.waitForTimeout(3000)

  // Expande as opções
  await page.evaluate((id: string) => {
    const f = document.getElementById(id) as HTMLIFrameElement
    ;(f?.contentDocument?.getElementById('wucButtonExpand_linkButton1') as HTMLElement)?.click()
  }, iframeId)
  await page.waitForTimeout(1000)

  // Preenche datas
  if (opts?.campoInicio && opts?.campoFim && opts?.di && opts?.df) {
    await page.evaluate(({ id, ci, cf, di, df }: any) => {
      const f = document.getElementById(id) as HTMLIFrameElement
      const doc = f?.contentDocument
      const from = doc?.getElementById(ci) as HTMLInputElement
      const to   = doc?.getElementById(cf) as HTMLInputElement
      if (from) { from.value = di; from.dispatchEvent(new Event('change', { bubbles: true })) }
      if (to)   { to.value   = df; to.dispatchEvent(new Event('change', { bubbles: true })) }
    }, { id: iframeId, ci: opts.campoInicio, cf: opts.campoFim, di: opts.di, df: opts.df })
    await page.waitForTimeout(300)
  }

  // Muda ddlSendTo para Ficheiro via dispatchEvent change
  // (__doPostBack falha mesmo em script injetado porque ScriptManager usa arguments internamente)
  await page.evaluate((id: string) => {
    const f = document.getElementById(id) as HTMLIFrameElement
    const doc = f?.contentDocument
    if (!doc) return
    const ddl = doc.getElementById('ddlSendTo') as HTMLSelectElement
    if (!ddl) return
    ddl.selectedIndex = 1  // Ficheiro
    ddl.dispatchEvent(new Event('change', { bubbles: true }))
  }, iframeId)
  await page.waitForTimeout(2000)

  // Selecciona CSV
  await page.evaluate((id: string) => {
    const f = document.getElementById(id) as HTMLIFrameElement
    const doc = f?.contentDocument
    const ddlDoc = doc?.getElementById('ddlDocType') as HTMLSelectElement
    if (ddlDoc) ddlDoc.value = '3'  // Excel (.csv)
  }, iframeId)
  await page.waitForTimeout(300)

  // Aguarda o download
  const downloadPromise = page.waitForEvent('download', { timeout: opts?.timeout || 60000 })

  // Confirma dentro do iframe
  await page.evaluate((id: string) => {
    const f = document.getElementById(id) as HTMLIFrameElement
    ;(f?.contentDocument?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
  }, iframeId)

  try {
    const download: Download = await downloadPromise
    const nome = download.suggestedFilename() || `sync_${Date.now()}.csv`
    const tmpPath = path.join(process.cwd(), 'tmp', nome)
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true })
    await download.saveAs(tmpPath)
    logger.info(`  Download: ${nome} (${fs.statSync(tmpPath).size} bytes)`)
    return tmpPath
  } catch (err) {
    logger.warn(`  Sem download: ${err}`)
    return null
  }
}

// Parseia CSV e devolve array de objectos
function parsearCSV(csvPath: string): Record<string, string>[] {
  const content = fs.readFileSync(csvPath, 'latin1')  // WinMax4 usa encoding latin1
  let linhas    = content.split('\n').map(l => l.trim()).filter(l => l)

  if (linhas.length < 2) return []

  // Remove linha "sep=," ou "sep=;" que o WinMax4 adiciona para compatibilidade Excel
  if (linhas[0].startsWith('sep=')) linhas = linhas.slice(1)

  if (linhas.length < 2) return []

  // Detecta separador (ponto-e-vírgula ou vírgula)
  const sep = linhas[0].includes(';') ? ';' : ','

  const headers = linhas[0].split(sep).map(h => h.replace(/"/g, '').trim())

  return linhas.slice(1).map(linha => {
    const cells = linha.split(sep).map(c => c.replace(/"/g, '').trim())
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = cells[i] || '' })
    return obj
  }).filter(l => Object.values(l).some(v => v))
}

export type ParteSync = 'tudo' | 'artigos' | 'vendas' | 'compras'

/**
 * Sincroniza dados do WinMax4.
 *
 * `parte` permite correr apenas uma das exportações — cada uma num job próprio,
 * com browser novo. Existe porque a exportação de compras falhava sistematicamente
 * quando corria depois das vendas (~6 min de trabalho intenso antes dela), e nenhuma
 * das tentativas de a recuperar dentro da mesma sessão funcionou: nem novo login,
 * nem limpar os iframes acumulados. Correr isolada elimina o problema pela raiz e
 * dá controlo para repetir só o que falhou, em vez de repetir 15 minutos.
 */
export async function syncWinmax(
  jobId?: string,
  opts?: { forceCompleto?: boolean; parte?: ParteSync }
): Promise<void> {
  const log = async (msg: string) => {
    logger.info(msg)
    if (jobId) await appendJobLog(jobId, msg).catch(() => {})
  }

  const parte: ParteSync = opts?.parte || 'tudo'
  const config  = await getConfig()
  const company = config.company_code || 'AUTOAVENIDA'

  // CORRIGIDO 29/07/2026: os movimentos passam a cobrir SEMPRE todo o histórico.
  // Antes usavam `config.sync_data_inicio` (01-01-2024), o que tornava a
  // "Sincronização Completa" afinal incompleta — ficava limitada a essa data.
  // Esse campo continua a aplicar-se ao Arquivo Digital, onde faz sentido limitar
  // o volume; para os movimentos, o que se quer é a totalidade.
  const MOVIMENTOS_DESDE = '01/01/2000'
  let dataInicio = MOVIMENTOS_DESDE
  const dataFim = (config.sync_data_fim || new Date().toLocaleDateString('pt-PT').replace(/\//g,'-')).replace(/-/g,'/')

  if (!opts?.forceCompleto) {
    // Sync incremental: usa a data da última sync bem-sucedida (menos 2 dias de margem)
    //
    // CORRIGIDO 29/07/2026: esta consulta ordenava por `criado_em`, mas os registos
    // de sync_log gravam a data no campo `executado_em` — nunca `criado_em`. No
    // Firestore, ordenar por um campo inexistente EXCLUI esses documentos, pelo que
    // a consulta devolvia sempre vazio e a data nunca era ajustada. Resultado: o sync
    // dito "incremental" reimportava sempre o intervalo completo, todas as noites.
    //
    // Também se evita aqui `orderBy` combinado com `where` (exigiria um índice
    // composto no Firestore): traz-se um punhado de registos e ordena-se em memória.
    const ultimaSyncSnap = await db().collection('sync_log')
      .where('tipo', '==', 'winmax_completa')
      .limit(50)
      .get()
      .catch(() => null)

    const bemSucedidas = (ultimaSyncSnap?.docs || [])
      .map(d => d.data())
      .filter(d => d.estado === 'ok' && d.executado_em?.toDate)
      .sort((a, b) => b.executado_em.toDate().getTime() - a.executado_em.toDate().getTime())

    if (bemSucedidas.length > 0) {
      const ultimaData: Date | null = bemSucedidas[0].executado_em.toDate()
      if (ultimaData) {
        const margem = new Date(ultimaData)
        margem.setDate(margem.getDate() - 2)
        const incrementalStr = margem.toLocaleDateString('pt-PT')
        const [di, mi, yi] = dataInicio.split('/').map(Number)
        const dataInicioObj = new Date(yi, mi - 1, di)
        if (margem > dataInicioObj) {
          dataInicio = incrementalStr
        }
      }
    }
    await log(`🔄 Sync WinMax4 (incremental${parte !== 'tudo' ? ` — só ${parte}` : ''}): ${dataInicio} → ${dataFim}`)
  } else {
    await log(`🔄 Sync WinMax4 (COMPLETO${parte !== 'tudo' ? ` — só ${parte}` : ''}): ${dataInicio} → ${dataFim}`)
  }

  let browser: Browser | null = null
  let releaseLock: (() => void) | null = null
  // Referência acessível no `finally`, para libertar o posto de licença do WinMax4
  // mesmo quando a sincronização termina com erro.
  let libertarSessao: (() => Promise<void>) | null = null
  try {
    releaseLock = await acquireBrowserLock()

    // CORRIGIDO 30/07/2026: cada parte passa a correr com um browser NOVO.
    //
    // Confirmado em produção: a exportação de compras falhava sistematicamente
    // quando corria depois das vendas na mesma sessão (5 min de espera esgotados,
    // duas vezes seguidas), mas correu sem qualquer dificuldade em 155 segundos
    // quando executada isoladamente. Nem novo login, nem limpar os iframes
    // acumulados resolveram — só um browser limpo. Reiniciá-lo entre partes torna a
    // "Sincronização Completa" fiável sem obrigar a usar os botões individuais.
    let page!: Page

    const abrirBrowser = async () => {
      browser = await chromium.launch({
        headless: true,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
        // Evita crash do Chromium por falta de espaço em /dev/shm em containers.
        args: [
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
        ],
      })
      const context = await browser.newContext({
        locale: 'pt-PT', timezoneId: 'Europe/Lisbon', acceptDownloads: true,
        storageState: { cookies: [], origins: [] },
      })
      page = await context.newPage()

      // Um diálogo nativo do browser (alert/confirm), sem handler registado, bloqueia
      // a página inteira até ao timeout — ver nota equivalente em winmaxRPA.ts.
      page.on('dialog', async (dialog) => {
        await log(`  🔔 Diálogo nativo do browser detetado: [${dialog.type()}] "${dialog.message()}" — a aceitar automaticamente`)
        await dialog.accept().catch(() => {})
      })

      await loginWinmax(page, config, log)
      await log('✅ Login OK')
    }

    /**
     * Termina a sessão no WinMax4 antes de fechar o browser.
     *
     * CORRIGIDO 30/07/2026: fechar o browser NÃO termina a sessão do lado do servidor
     * — o WinMax4 mantém-na (e o posto de licença) ocupada. Confirmado em produção:
     * com browser novo e tudo, o TERCEIRO login consecutivo ficava preso no ecrã de
     * autenticação (90s à espera de uma navegação que nunca acontecia), enquanto o
     * primeiro e o segundo passavam sem problema. A instalação tem um número limitado
     * de postos, e cada sessão abandonada consome um deles.
     */
    const terminarSessao = async () => {
      try {
        const ok = await clicarToolboxPorTitulo(page, 'Terminar sessão')
        if (ok) {
          await page.waitForTimeout(2000)
          await log('  🔓 Sessão do WinMax4 terminada')
        } else {
          await log('  ⚠️ Atalho "Terminar sessão" não encontrado — sessão pode ficar ocupada')
        }
      } catch (e) {
        await log(`  ⚠️ Não foi possível terminar a sessão: ${e}`)
      }
    }

    libertarSessao = terminarSessao

    /** Fecha o browser atual e abre outro — sessão limpa para a parte seguinte. */
    const renovarBrowser = async () => {
      await log('  ♻️ A reiniciar o browser para a parte seguinte...')
      await terminarSessao()
      await browser?.close().catch(() => {})
      browser = null
      await abrirBrowser()
    }

    await abrirBrowser()

    const now = admin.firestore.FieldValue.serverTimestamp()

    // CORRIGIDO 03/07/2026: os batches eram gravados UM DE CADA VEZ (sequencialmente),
    // com uma pausa fixa de 500ms extra entre cada um — mesmo o Firestore aguentando
    // facilmente vários batches em paralelo. Para coleções grandes (milhares de artigos/
    // movimentos), isto tornava a sincronização desnecessariamente lenta. Agora processa-se
    // com um limite de concorrência controlado (CONCORRENCIA batches em simultâneo), e o
    // tamanho de cada batch sobe de 250 para 450 (o limite real do Firestore é 500
    // operações por batch — fica-se com margem de segurança).
    const commitBatches = async (ops: Array<{ col: string; id: string; data: Record<string, unknown> }>) => {
      if (ops.length === 0) { await log('  ⚠️ Sem operações para guardar'); return }
      const SIZE = 450
      const CONCORRENCIA = 4

      const chunks: Array<typeof ops> = []
      for (let i = 0; i < ops.length; i += SIZE) chunks.push(ops.slice(i, i + SIZE))

      const totalChunks = chunks.length
      let concluidos = 0

      const executarChunk = async (chunk: typeof ops, indice: number) => {
        try {
          const batch = db().batch()
          for (const op of chunk) {
            batch.set(db().collection(op.col).doc(op.id), op.data, { merge: true })
          }
          await Promise.race([
            batch.commit(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 45s no batch')), 45000))
          ])
          concluidos++
          await log(`  ✅ Batch ${indice + 1}/${totalChunks} guardado (${chunk.length} docs)`)
        } catch (e) {
          concluidos++
          await log(`  ⚠️ Batch ${indice + 1}/${totalChunks} falhou (a continuar): ${e}`)
        }
      }

      // Pool de concorrência simples: mantém até CONCORRENCIA promessas em voo,
      // arrancando a próxima assim que uma termina.
      let proximoIndice = 0
      const worker = async () => {
        while (proximoIndice < chunks.length) {
          const indice = proximoIndice++
          await executarChunk(chunks[indice], indice)
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, chunks.length) }, () => worker()))
    }

    // ─── Artigos Existências ───────────────────────────────────────────────
    if (parte === 'tudo' || parte === 'artigos') {
    await log('📦 Artigos Existências (CSV)...')
    const csvArtigos = await exportarCSV(page, '/MReports/Files/ArticleExistences.aspx', company)
    if (csvArtigos) {
      const artigos = parsearCSV(csvArtigos)
      await log(`  → ${artigos.length} artigos | TODOS headers: ${Object.keys(artigos[0] || {}).join(' | ')}`)
      const artigoTeste = artigos.find(a => a['ArticleCode'] === '0.009.4683.0') || artigos[10] || artigos[0]
      if (artigoTeste) await log(`  → Stock/Preço (${artigoTeste['ArticleCode']}): ${JSON.stringify({CurrentStock: artigoTeste['CurrentStock'], ArticleBatchCurrentStock: artigoTeste['ArticleBatchCurrentStock'], SalePrice1: artigoTeste['SalePrice1WithoutTaxesFees'], NetCost: artigoTeste['NetCostPrice'], IsActive: artigoTeste['IsActive']})}`)
      const ops = artigos.flatMap(a => {
        const codigo = a['ArticleCode'] || a['Code'] || a['Código'] || a['Artigo'] || a['Ref'] || a['Referência'] || Object.values(a)[0]
        if (!codigo) return []
        // Taxa IVA — vem no campo PurchaseTaxesToShow ou similar (ex: "23.00")
        const taxaIva = parseFloat((a['PurchaseTaxesToShow'] || a['SaleTaxesToShow'] || '23').replace(',','.')) || 23
        const precoSemIva = parseFloat((a['SalePrice1WithoutTaxesFees'] || '0').replace(',','.')) || 0
        const precoComIva = precoSemIva * (1 + taxaIva / 100)
        return [{ col: 'artigos', id: String(codigo).replace(/[\/\\]/g,'_'), data: {
          codigo:           String(codigo),
          descricao:        a['ArticleDesignation'] || '',
          familia:          a['FamilyDesignation'] || '',
          sub_familia:      a['SubFamilyDesignation'] || '',
          tipo:             a['ArticleType'] || '',
          ativo:            a['IsActive'] === 'True' || a['IsActive'] === '1',
          unidade:          a['StockUnitCode'] || '',
          stock:            parseFloat((a['CurrentStock'] || a['Stock'] || a['ArticleBatchCurrentStock'] || '0').replace(',','.')) || 0,
          preco_custo:      parseFloat((a['NetCostPrice'] || '0').replace(',','.')) || 0,
          preco_sem_iva:    precoSemIva,
          preco_com_iva:    Math.round(precoComIva * 100) / 100,
          preco_venda:      precoSemIva,
          taxa_iva:         taxaIva,
          ultima_sync:      now,
        }}]
      })
      await commitBatches(ops)
      fs.rmSync(csvArtigos, { force: true })
    } else {
      await log('  ⚠️ Sem ficheiro CSV')
    }

    }

    // ─── Vendas por Artigo ────────────────────────────────────────────────
    if (parte === 'tudo' || parte === 'vendas') {
    if (parte === 'tudo') await renovarBrowser()
    await log('📈 Vendas por Artigo (CSV)...')
    // Limpa a coleção antes de reimportar — APENAS em sincronização completa.
    //
    // CORRIGIDO 29/07/2026: esta limpeza era incondicional. Combinada com o sync
    // incremental (que só traz os últimos dias), apagaria todo o histórico e
    // deixaria apenas essa janela. Não chegou a acontecer em produção porque o
    // incremental estava ele próprio avariado (ver nota acima) e trazia sempre tudo
    // — mas ao corrigir o incremental, esta limpeza passaria a ser destrutiva.
    //
    // Numa sincronização incremental não é necessária: cada movimento tem um id
    // determinístico (documento_artigo_data), pelo que a reimportação sobrepõe-se
    // aos registos existentes sem duplicar. A limpeza continua a fazer sentido na
    // sincronização completa, para eliminar registos órfãos de importações antigas.
    // CORRIGIDO 30/07/2026: a ordem era APAGAR e só depois exportar. Confirmado em
    // produção: ao alargar o intervalo para 01/01/2000, a exportação das vendas
    // ultrapassou o timeout e, como a coleção já tinha sido apagada, o utilizador
    // ficou SEM VENDAS NENHUMAS. A exportação passa a ser feita PRIMEIRO — a
    // coleção só é limpa depois de os dados estarem garantidos em mão.
    const csvVendas = await exportarCSV(page, '/MReports/Transactions/SalesArticleMovements.aspx', company, {
      campoInicio: 'wucCalendarFromDate_txtModernDate',
      campoFim:    'wucCalendarToDate_txtModernDate',
      di: dataInicio, df: dataFim,
      // Intervalos longos (histórico completo) obrigam o WinMax4 a gerar mais dados.
      // 5 minutos cobre folgadamente o caso real medido (vendas: 147s).
      timeout: 300000,
    })

    if (csvVendas && opts?.forceCompleto) {
      await log('  🗑️ A limpar movimentos_venda antigos...')
      // CORRIGIDO 03/07/2026: o limite de 10 rondas × 400 registos = teto rígido de 4000.
      // Coleções maiores ficavam com registos órfãos por limpar, silenciosamente.
      let totalRemovidosVenda = 0
      for (let tentativa = 0; tentativa < 200; tentativa++) {
        const snap = await db().collection('movimentos_venda').limit(490).get().catch(() => null)
        if (!snap || snap.empty) break
        const delBatch = db().batch()
        snap.docs.forEach(d => delBatch.delete(d.ref))
        await delBatch.commit().catch(() => {})
        totalRemovidosVenda += snap.size
      }
      if (totalRemovidosVenda > 0) await log(`  🗑️ ${totalRemovidosVenda} registos de vendas antigos removidos`)
    } else if (!opts?.forceCompleto) {
      await log('  ↻ Sync incremental — histórico de vendas preservado (só se atualiza o período recente)')
    }
    if (csvVendas) {
      const vendas = parsearCSV(csvVendas)
      await log(`  → ${vendas.length} linhas vendas | headers: ${Object.keys(vendas[0] || {}).join(' | ')}`)
      if (vendas[0]) await log(`  → Exemplo: ${JSON.stringify(Object.entries(vendas[0]).slice(0,8))}`)
      const ops = vendas.flatMap(v => {
        const id = `${v['Document'] || v['DocumentID'] || ''}_${v['ArticleCode'] || ''}_${v['DocumentDate'] || ''}`.split('/').join('_')
        if (!v['DocumentDate'] || !v['ArticleCode']) return []
        const qtd = parseFloat((v['Quantity'] || '0').replace(',','.')) || 0
        const precoUnitSemIva = parseFloat((v['UnitaryPriceWithoutTaxesAfterDiscounts'] || '0').replace(',','.')) || 0
        // O campo "Total" do CSV SalesArticleMovements é SEM IVA (confirmado: ≈ preço unit. x qtd)
        const totalSemIva = parseFloat((v['Total'] || '0').replace(',','.')) || (precoUnitSemIva * qtd)
        const taxaIva = parseFloat((v['TaxFeeRatePercentage'] || '23').replace(',','.')) || 23
        const totalComIva = Math.round(totalSemIva * (1 + taxaIva / 100) * 100) / 100
        return [{ col: 'movimentos_venda', id, data: {
          data:             v['DocumentDate'] || '',
          numero_doc:       v['Document'] || v['DocumentID'] || '',
          cliente_codigo:   v['EntityCode'] || '',
          cliente_nome:     v['EntityName'] || '',
          artigo_codigo:    v['ArticleCode'] || '',
          artigo_descricao: v['ArticleDesignation'] || '',
          familia:          v['FamilyDesignation'] || '',
          quantidade:       qtd,
          preco_unitario:   precoUnitSemIva,
          total:            totalComIva,
          total_sem_iva:    Math.round(totalSemIva * 100) / 100,
          vendedor:         v['SalesPersonName'] || '',
          ultima_sync:      now,
        }}]
      })
      await commitBatches(ops)
      fs.rmSync(csvVendas, { force: true })
    } else {
      await log('  ⚠️ Sem CSV de vendas (timeout ou sem dados) — dados existentes PRESERVADOS, nada foi apagado')
    }

    }

    // ─── Compras por Artigo ───────────────────────────────────────────────
    if (parte === 'tudo' || parte === 'compras') {
    if (parte === 'tudo') await renovarBrowser()
    await log('📉 Compras por Artigo (CSV)...')
    // Limpa a coleção antes de reimportar — APENAS em sincronização completa.
    // Ver nota detalhada no bloco equivalente das vendas, acima.
    // CORRIGIDO 03/07/2026: mesmo problema do teto rígido de 4000 registos que existia
    // em movimentos_venda — ver comentário acima para detalhe.
    // Mesma inversão de ordem aplicada às vendas — ver nota detalhada acima.

    // CORRIGIDO 30/07/2026: a exportação das compras falhava sistematicamente quando
    // corria DEPOIS de todo o trabalho pesado das vendas (~6 min após o login). Os
    // números mostraram que não era lentidão — esgotava sempre o limite, fosse ele de
    // 240s ou de 600s, ou seja, o download nunca chegava a acontecer. Já numa execução
    // em que as vendas falharam cedo, as compras exportaram sem problema. Tudo aponta
    // para a sessão do WinMax4 se degradar ao fim de vários minutos de trabalho
    // intenso. Por isso, se a exportação falhar, renova-se a sessão e tenta-se de novo.
    const exportarCompras = () => exportarCSV(page, '/MReports/Transactions/PurchasesArticleMovements.aspx', company, {
      campoInicio: 'wucCalendarFromDate_txtModernDate',
      campoFim:    'wucCalendarToDate_txtModernDate',
      di: dataInicio, df: dataFim,
      timeout: 300000,
    })

    let csvCompras = await exportarCompras()

    if (!csvCompras) {
      // CORRIGIDO 30/07/2026: aqui tentava-se um novo login. Não funciona — o WinMax4
      // mantém a sessão anterior ativa e devolve sempre o ecrã de autenticação sem
      // avançar (confirmado no log: 90s à espera de uma navegação que nunca acontece).
      // Uma simples repetição, já com os iframes anteriores limpos, é mais adequada.
      await log('  ⚠️ Exportação de compras falhou — a tentar de novo com a página limpa...')
      await page.waitForTimeout(5000)
      csvCompras = await exportarCompras()
      if (csvCompras) await log('  ✅ Segunda tentativa das compras bem sucedida')
    }

    if (csvCompras && opts?.forceCompleto) {
      await log('  🗑️ A limpar movimentos_compra antigos...')
      let totalRemovidosCompra = 0
      for (let tentativa = 0; tentativa < 200; tentativa++) {
        const snap = await db().collection('movimentos_compra').limit(490).get().catch(() => null)
        if (!snap || snap.empty) break
        const delBatch = db().batch()
        snap.docs.forEach(d => delBatch.delete(d.ref))
        await delBatch.commit().catch(() => {})
        totalRemovidosCompra += snap.size
      }
      if (totalRemovidosCompra > 0) await log(`  🗑️ ${totalRemovidosCompra} registos de compras antigos removidos`)
    } else if (!opts?.forceCompleto) {
      await log('  ↻ Sync incremental — histórico de compras preservado (só se atualiza o período recente)')
    }

    if (csvCompras) {
      const compras = parsearCSV(csvCompras)
      await log(`  → ${compras.length} linhas compras | headers: ${Object.keys(compras[0] || {}).join(' | ')}`)
      if (compras[0]) await log(`  → Exemplo: ${JSON.stringify(Object.entries(compras[0]).slice(0,8))}`)
      const opsCompras = compras.flatMap(c => {
        const id = `${c['Document'] || ''}_${c['ArticleCode'] || ''}_${c['DocumentDate'] || ''}`.split('/').join('_')
        if (!id || id === '__') return []
        const totalSemIva = parseFloat((c['TotalWithoutTaxes'] || '0').replace(',','.')) || 0
        const totalComIva = parseFloat((c['TotalWithTaxes'] || c['Total'] || '0').replace(',','.')) || totalSemIva
        return [{ col: 'movimentos_compra', id, data: {
          data:              c['DocumentDate'] || '',
          numero_doc:        c['Document'] || '',
          fornecedor_codigo: c['EntityCode'] || '',
          fornecedor_nome:   c['EntityName'] || '',
          artigo_codigo:     c['ArticleCode'] || '',
          artigo_descricao:  c['ArticleDesignation'] || '',
          familia:           c['FamilyDesignation'] || '',
          quantidade:        parseFloat((c['Quantity'] || '0').replace(',','.')) || 0,
          preco_unitario:    parseFloat((c['UnitaryPriceWithoutTaxesAfterDiscounts'] || '0').replace(',','.')) || 0,
          total:             totalComIva,
          total_sem_iva:     totalSemIva,
          vendedor:          c['SalesPersonName'] || '',
          ultima_sync: now,
        }}]
      })
      await commitBatches(opsCompras)
      fs.rmSync(csvCompras, { force: true })
    } else {
      await log('  ⚠️ Sem CSV de compras (timeout ou sem dados) — dados existentes PRESERVADOS, nada foi apagado')
    }

    }

    await db().collection('sync_log').add({
      tipo: 'winmax_completa', data_inicio: dataInicio, data_fim: dataFim,
      executado_em: now, estado: 'ok',
    })

    await log('✅ Sync concluída')

  } catch (err) {
    logger.error(`❌ Sync: ${err}`)
    await db().collection('sync_log').add({
      tipo: 'winmax_completa', erro: String(err),
      executado_em: admin.firestore.FieldValue.serverTimestamp(), estado: 'erro',
    })
    if (jobId) await appendJobLog(jobId, `❌ ${err}`).catch(() => {})
    // CORRIGIDO 30/07/2026: o erro era registado mas NÃO relançado, pelo que quem
    // chama (routes/jobs.ts) dava o job como 'concluido' — o Dashboard mostrava
    // sucesso mesmo quando a sincronização tinha falhado. Relançar garante que o
    // estado do job reflete o que realmente aconteceu.
    throw err
  } finally {
    // Termina a sessão antes de fechar — ver nota em terminarSessao(). Sem isto, o
    // posto de licença fica ocupado e os logins seguintes ficam presos no ecrã de
    // autenticação.
    if (libertarSessao) await libertarSessao().catch(() => {})
    await browser?.close().catch(() => {})
    releaseLock?.()
  }
}
