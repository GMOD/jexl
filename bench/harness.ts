type Task = () => unknown

interface Suite {
  name: string
  benches: { name: string; fn: Task }[]
}

const suites: Suite[] = []
let current: Suite | undefined

export function describe(name: string, register: () => void) {
  const suite: Suite = { name, benches: [] }
  suites.push(suite)
  current = suite
  register()
  current = undefined
}

export function bench(name: string, fn: Task) {
  if (current) {
    current.benches.push({ name, fn })
  } else {
    suites.push({ name, benches: [{ name, fn }] })
  }
}

function measure(fn: Task, durationMs: number) {
  const samples: number[] = []
  const end = performance.now() + durationMs
  while (performance.now() < end || samples.length < 10) {
    const start = performance.now()
    fn()
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length
  const p99 = samples[Math.floor(samples.length * 0.99)] ?? mean
  return { mean, p99, count: samples.length }
}

export function run() {
  for (const suite of suites) {
    console.log(`\n${suite.name}`)
    const results = suite.benches.map(({ name, fn }) => {
      measure(fn, 200)
      return { name, ...measure(fn, 1000) }
    })
    const fastest = Math.min(...results.map((r) => r.mean))
    console.table(
      Object.fromEntries(
        results.map((r) => [
          r.name,
          {
            'ops/s': Math.round(1000 / r.mean),
            'mean ms': Number(r.mean.toFixed(4)),
            'p99 ms': Number(r.p99.toFixed(4)),
            samples: r.count,
            'x slower': Number((r.mean / fastest).toFixed(2))
          }
        ])
      )
    )
  }
}
