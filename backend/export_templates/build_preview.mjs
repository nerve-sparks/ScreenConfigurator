import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const templateRoot = dirname(fileURLToPath(import.meta.url))
const sourceRoot = resolve(templateRoot, 'source')
const distRoot = resolve(sourceRoot, 'dist')
const htmlPath = resolve(distRoot, 'index.html')
const outputPath = resolve(templateRoot, 'preview.template.html')
const placeholder = '__AGENT_RELEASE_BASE64__'

let html = await readFile(htmlPath, 'utf8')

const stylesheetPattern = /<link rel="stylesheet" crossorigin href="([^"]+)">/
const stylesheetMatch = html.match(stylesheetPattern)
if (!stylesheetMatch) {
  throw new Error('The preview build did not contain one stylesheet asset.')
}
const stylesheetPath = resolve(distRoot, stylesheetMatch[1])
const stylesheet = (await readFile(stylesheetPath, 'utf8'))
  .replaceAll('</style', '<\\/style')
html = html.replace(stylesheetPattern, () => `<style>${stylesheet}</style>`)

const scriptPattern = /<script type="module" crossorigin src="([^"]+)"><\/script>/
const scriptMatch = html.match(scriptPattern)
if (!scriptMatch) {
  throw new Error('The preview build did not contain one JavaScript asset.')
}
const scriptPath = resolve(distRoot, scriptMatch[1])
const script = (await readFile(scriptPath, 'utf8'))
  .replaceAll('</script', '<\\/script')
html = html.replace(
  scriptPattern,
  () => [
    `<script id="agent-release-data" type="application/octet-stream">${placeholder}</script>`,
    `<script type="module">${script}</script>`,
  ].join('\n'),
)

if ((html.match(new RegExp(placeholder, 'g')) ?? []).length !== 1) {
  throw new Error('The preview template must contain exactly one release placeholder.')
}
if (html.includes(scriptMatch[0]) || html.includes(stylesheetMatch[0])) {
  throw new Error(
    `The preview template still contains a generated asset reference: script=${html.includes(scriptMatch[0])}, stylesheet=${html.includes(stylesheetMatch[0])}.`,
  )
}
if (/sourceMappingURL/i.test(html)) {
  throw new Error('The preview template must not contain source maps.')
}

await writeFile(outputPath, html, 'utf8')
