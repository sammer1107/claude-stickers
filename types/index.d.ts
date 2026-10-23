/** Per agent and file (`<agentId or main>|<path, case-folded on Windows>`): a signature of the stickers last shown in full. */
export type Shown = Record<string, string>

declare module 'claude-code' {
  interface PluginState {
    stickers: {
      shown: Shown
    }
  }
}
