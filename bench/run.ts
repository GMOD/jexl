import { run } from './harness.ts'

const only = process.argv.slice(2)
const files = ['parse', 'eval', 'host-hooks'].filter(
  (f) => only.length === 0 || only.includes(f)
)
for (const file of files) {
  await import(`./${file}.bench.js`)
}
run()
