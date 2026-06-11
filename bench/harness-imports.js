// Single import point for the harness — re-exports the library source plus
// the entity detector (not part of the public API but measured directly).
export {
  compress,
  injectContext,
  recall,
  encode,
  decode,
  estimateTokens,
  CompressStream,
} from '../src/index.js'
export { detectEntities as detect } from '../src/entity-detector.js'
