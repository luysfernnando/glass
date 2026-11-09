// A parsed reply as HTML and as plain text, for the copy button's formats.
// Only what the parser yields: paragraphs, headings, lists, fences, quotes,
// alerts, tables, callouts. Written for glass's Block and Inline types.
import { inlineText } from './markdown'
import type { Block, Inline } from './markdown'

export const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function inlineHtml(inlines: Inline[]): string {
  return inlines
    .map(n => {
      switch (n.kind) {
        case 'text':
          return escapeHtml(n.text)
        case 'code':
          return `<code>${escapeHtml(n.text)}</code>`
        case 'bold':
          return `<strong>${inlineHtml(n.children)}</strong>`
        case 'italic':
          return `<em>${inlineHtml(n.children)}</em>`
        case 'strike':
          return `<del>${inlineHtml(n.children)}</del>`
        case 'link':
          return `<a href="${escapeHtml(n.href)}">${escapeHtml(n.text)}</a>`
      }
    })
    .join('')
}

const cell = (tag: 'th' | 'td', inlines: Inline[]) => `<${tag}>${inlineHtml(inlines)}</${tag}>`

export function blocksHtml(blocks: Block[]): string {
  return blocks.map(blockHtml).join('\n')
}

function blockHtml(b: Block): string {
  switch (b.kind) {
    case 'paragraph':
      return `<p>${inlineHtml(b.inlines)}</p>`
    case 'heading':
      return `<h${b.level}>${inlineHtml(b.inlines)}</h${b.level}>`
    case 'code':
      return `<pre><code${b.lang ? ` class="language-${escapeHtml(b.lang)}"` : ''}>${escapeHtml(b.source.replace(/\n$/, ''))}</code></pre>`
    case 'alert':
      return `<blockquote><p><strong>${b.level[0]!.toUpperCase()}${b.level.slice(1)}</strong></p>${blocksHtml(b.blocks)}</blockquote>`
    case 'quote':
      return `<blockquote>${blocksHtml(b.blocks)}</blockquote>`
    case 'list': {
      const ordered = b.items.length > 0 && /^\d/.test(b.items[0]!.marker)
      const tag = ordered ? 'ol' : 'ul'
      const items = b.items.map(it => {
        const box = it.task ? (it.task === 'done' ? '[x] ' : '[ ] ') : ''
        return `<li style="margin-left:${it.depth * 1.5}em">${box}${inlineHtml(it.inlines)}${it.blocks ? blocksHtml(it.blocks) : ''}</li>`
      })
      return `<${tag}>${items.join('')}</${tag}>`
    }
    case 'rule':
      return '<hr>'
    case 'raw':
      return `<p>${escapeHtml(b.text)}</p>`
    case 'table':
      return `<table><thead><tr>${b.header.map(h => cell('th', h)).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map(c => cell('td', c)).join('')}</tr>`).join('')}</tbody></table>`
    case 'callout':
      return `<blockquote><p><strong>${escapeHtml(b.title)}</strong></p>${b.rows.map(r => `<p><strong>${escapeHtml(r.label)}</strong> ${inlineHtml(r.inlines)}</p>`).join('')}</blockquote>`
  }
}

export function blocksText(blocks: Block[]): string {
  return blocks.map(blockText).join('\n\n')
}

function blockText(b: Block): string {
  switch (b.kind) {
    case 'paragraph':
    case 'heading':
      return inlineText(b.inlines)
    case 'code':
      return b.source.replace(/\n$/, '')
    case 'alert':
      return `${b.level.toUpperCase()}\n${blocksText(b.blocks)}`
    case 'quote':
      return blocksText(b.blocks)
        .split('\n')
        .map(l => `> ${l}`)
        .join('\n')
    case 'list':
      return b.items
        .map(it => `${'  '.repeat(it.depth)}${it.marker} ${it.task ? (it.task === 'done' ? '[x] ' : '[ ] ') : ''}${inlineText(it.inlines)}${it.blocks ? '\n' + blocksText(it.blocks) : ''}`)
        .join('\n')
    case 'rule':
      return '---'
    case 'raw':
      return b.text
    case 'table':
      return [b.header, ...b.rows].map(r => r.map(c => inlineText(c).replace(/[\t\n]/g, ' ')).join('\t')).join('\n')
    case 'callout':
      return [b.title, ...b.rows.map(r => `${r.label}: ${inlineText(r.inlines)}`)].join('\n')
  }
}
