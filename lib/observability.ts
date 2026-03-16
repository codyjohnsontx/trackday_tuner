type LogLevel = 'info' | 'warn' | 'error';

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

function writeLog(level: LogLevel, event: string, context: Record<string, unknown> = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...context,
  };

  switch (level) {
    case 'info':
      console.info('[track-tuner]', payload);
      return;
    case 'warn':
      console.warn('[track-tuner]', payload);
      return;
    default:
      console.error('[track-tuner]', payload);
  }
}

export function logInfo(event: string, context?: Record<string, unknown>) {
  writeLog('info', event, context);
}

export function logWarn(event: string, context?: Record<string, unknown>) {
  writeLog('warn', event, context);
}

export function logError(
  event: string,
  error: unknown,
  context: Record<string, unknown> = {},
) {
  writeLog('error', event, {
    ...context,
    error: serializeError(error),
  });
}
