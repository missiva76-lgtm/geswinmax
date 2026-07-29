// toolboxHelper.ts
// Navega o Toolbox do WinMax4 procurando um atalho pelo título (robusto a mudanças de página/índice)

import { Page } from 'playwright'

/** Espera até o Toolbox ter ícones desenhados. Devolve true se chegou a vê-los. */
async function aguardarIcones(page: Page, timeout: number): Promise<boolean> {
  return page.waitForFunction(
    () => {
      const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
      const doc = tb?.contentDocument
      return !!(doc && doc.readyState === 'complete' &&
        doc.querySelectorAll('div[id^="Toolbox_ShortcutIconDiv"]').length > 0)
    },
    { timeout, polling: 500 }
  ).then(() => true).catch(() => false)
}

/** Volta à página 1 do Toolbox, um clique de cada vez (cada um é um postback). */
async function irParaPagina1(page: Page): Promise<void> {
  // CORRIGIDO 27/07/2026: este bloco disparava vários cliques em "página anterior"
  // TODOS dentro do mesmo page.evaluate(), sem esperar nada entre eles. Como cada
  // clique dispara um postback ASP.NET (não instantâneo), na prática só um tinha
  // efeito — deixando o Toolbox numa página imprevisível.
  for (let i = 0; i < 15; i++) {
    const label = await page.evaluate(() => {
      const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
      return tb?.contentDocument?.getElementById('LabelPages')?.innerText?.trim() || '1 / 1'
    })
    const atual = parseInt(label.split('/')[0].trim()) || 1
    if (atual <= 1) break
    await page.evaluate(() => {
      const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
      ;(tb?.contentDocument?.getElementById('LinkButtonPrevPage') as HTMLElement)?.click()
    })
    await page.waitForTimeout(600)
  }
  await page.waitForTimeout(400)
}

/** Percorre as páginas do Toolbox à procura do atalho. Devolve se clicou e o que viu. */
async function percorrerPaginas(
  page: Page,
  titulo: string,
  maxPaginas: number,
  log?: (msg: string) => Promise<void> | void
): Promise<{ clicou: boolean; viuAlgumIcone: boolean }> {
  let viuAlgumIcone = false

  for (let p = 1; p <= maxPaginas; p++) {
    // Navega até à página p
    let tentativas = 0
    while (tentativas < 15) {
      const label = await page.evaluate(() => {
        const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
        return tb?.contentDocument?.getElementById('LabelPages')?.innerText?.trim() || '1 / 1'
      })
      const actual = parseInt(label.split('/')[0].trim())
      if (actual === p) break
      await page.evaluate((vai: string) => {
        const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
        ;(tb?.contentDocument?.getElementById(vai) as HTMLElement)?.click()
      }, actual < p ? 'LinkButtonNextPage' : 'LinkButtonPrevPage')
      await page.waitForTimeout(600)
      tentativas++
    }

    const resultado = await page.evaluate((t: string) => {
      const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
      const divs = Array.from(tb?.contentDocument?.querySelectorAll('div[id^="Toolbox_ShortcutIconDiv"]') || [])
      const titulos = divs.map(d => d.getAttribute('title') || '').filter(Boolean)
      const el = divs.find(d => d.getAttribute('title')?.toLowerCase().includes(t.toLowerCase())) as HTMLElement | undefined
      if (el) { el.click(); return { found: el.getAttribute('title'), titulos } }
      return { found: null, titulos }
    }, titulo)

    if (resultado.titulos.length > 0) viuAlgumIcone = true
    if (resultado.found) return { clicou: true, viuAlgumIcone: true }

    // Regista os atalhos realmente vistos em cada página — se falhar, ficamos a
    // saber exatamente o que o Toolbox continha, em vez de só "não encontrado".
    await log?.(`  🔍 Toolbox pág. ${p}/${maxPaginas}: [${resultado.titulos.join(', ') || 'vazia'}]`)
  }

  return { clicou: false, viuAlgumIcone }
}

export async function clicarToolboxPorTitulo(
  page: Page,
  titulo: string,
  maxPaginas = 11,
  log?: (msg: string) => Promise<void> | void
): Promise<boolean> {
  // CORRIGIDO 29/07/2026: observado em produção (sync Arquivo Digital das 02:30) um
  // caso contraditório — a espera inicial CONFIRMOU que havia ícones (avançou aos 31s,
  // bem antes do limite de 60s), mas a pesquisa seguinte encontrou todas as 11 páginas
  // vazias. Ou seja, os ícones existiam e desapareceram entre as duas etapas: o iframe
  // do Toolbox recarregou entretanto. O SAF-T, que usa este mesmo código, correu bem
  // 30 minutos depois — confirmando que é transitório, não um problema de permissões.
  //
  // Passa a haver uma segunda tentativa completa quando a primeira não vê ícone nenhum.
  // Isto não mascara um problema real: se o utilizador não tiver mesmo atalhos, ambas
  // as tentativas falham e o diagnóstico (log + screenshot) mantém-se igual.
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    await aguardarIcones(page, 60000)
    await irParaPagina1(page)

    const { clicou, viuAlgumIcone } = await percorrerPaginas(page, titulo, maxPaginas, log)
    if (clicou) return true

    // Se viu ícones mas não o atalho procurado, repetir não ajuda — o atalho não existe.
    if (viuAlgumIcone) return false

    if (tentativa < 2) {
      await log?.('  ⏳ Toolbox sem ícones visíveis — provável recarregamento do iframe; a repetir...')
      await page.waitForTimeout(5000)
    }
  }

  return false
}
