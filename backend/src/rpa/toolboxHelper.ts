// toolboxHelper.ts
// Navega o Toolbox do WinMax4 procurando um atalho pelo título (robusto a mudanças de página/índice)

import { Page } from 'playwright'

export async function clicarToolboxPorTitulo(page: Page, titulo: string, maxPaginas = 11): Promise<boolean> {
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

    // Procura o atalho pelo título nesta página
    const found = await page.evaluate((t: string) => {
      const tb = document.getElementById('Toolbox_content') as HTMLIFrameElement
      const divs = Array.from(tb?.contentDocument?.querySelectorAll('div[id^="Toolbox_ShortcutIconDiv"]') || [])
      const el = divs.find(d => d.getAttribute('title')?.toLowerCase().includes(t.toLowerCase())) as HTMLElement | undefined
      if (el) { el.click(); return el.getAttribute('title') }
      return null
    }, titulo)

    if (found) return true
  }
  return false
}
