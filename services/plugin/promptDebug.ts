type PromptDebugInput = {
  prompt: string
  context?: unknown
  label?: string
}

export const createPromptDebugLogger = ({
  pluginId,
  channelId,
  logs,
}: {
  pluginId: string
  channelId?: string | null
  logs: string[]
}) => {
  return ({ prompt, context, label = 'default' }: PromptDebugInput) => {
    const serialized = JSON.stringify(
      {
        label,
        prompt,
        context: context ?? null,
      },
      null,
      2
    )

    const scopeSuffix = channelId ? `:${channelId}` : ''
    const message = `[PromptDebug:${pluginId}${scopeSuffix}] ${serialized}`

    logs.push(message)
    console.log(message)

    return serialized
  }
}
