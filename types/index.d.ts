/** Per file (case-folded on Windows): a signature of the stickers last shown in full this session. */
export type Shown = Record<string, string>

declare module 'claude-code' {
  interface PluginState {
    stickers: {
      shown: Shown
    }
  }
}
