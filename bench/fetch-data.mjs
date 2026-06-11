// Downloads public-domain benchmark texts into bench/data/ (gitignored).
// Re-running is a no-op when the files already exist.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data')

const SOURCES = [
  {
    file: 'pride-and-prejudice.txt',
    url: 'https://www.gutenberg.org/files/1342/1342-0.txt',
    label: 'Pride and Prejudice (narrative, ~170k tokens)',
  },
  {
    file: 'origin-of-species.txt',
    url: 'https://www.gutenberg.org/files/1228/1228-0.txt',
    label: 'On the Origin of Species (technical prose, ~230k tokens)',
  },
]

mkdirSync(DATA_DIR, { recursive: true })

for (const { file, url, label } of SOURCES) {
  const path = join(DATA_DIR, file)
  if (existsSync(path)) {
    console.log(`already present: ${file}`)
    continue
  }
  console.log(`downloading ${label} ...`)
  const res = await fetch(url)
  if (!res.ok) {
    console.error(`failed to fetch ${url}: ${res.status}`)
    process.exitCode = 1
    continue
  }
  const text = await res.text()
  // strip the Gutenberg header/footer boilerplate
  const start = text.indexOf('*** START')
  const end = text.indexOf('*** END')
  const body =
    start !== -1 && end !== -1
      ? text.slice(text.indexOf('\n', start) + 1, end)
      : text
  writeFileSync(path, body.trim())
  console.log(`saved ${file} (${body.length.toLocaleString()} chars)`)
}
