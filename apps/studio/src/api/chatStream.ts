/**
 * SSE streaming client for POST /api/chat.
 *
 * Returns a cancel function. Parses the SSE stream manually
 * (EventSource doesn't support POST, so we use fetch + ReadableStream).
 */
import type { ActivityContext } from '@xiaomu/contracts';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ExpressionEvent {
  atCharOffset: number;
  expressionId: string;
  confidence: number;
}

export interface ToolCallResult {
  ok: boolean;
  // start_activity
  activityId?: string;
  activityName?: string;
  activityType?: string;
  audioPlaylist?: string[];
  currentSectionText?: string;
  sectionNumber?: number;
  totalSections?: number;
  speakingInstruction?: string;
  personaAge?: number;
  matchedBucket?: { minAge: number; maxAge: number } | null;
  interactive?: boolean;
  // play_melody (co-creation)
  notes?: string[];
  variant?: 'original' | 'revised' | 'background';
  filename?: string;
  playCount?: number;
  // shared
  error?: string;
}

export interface ToolCallEvent {
  name: string;
  args: Record<string, unknown>;
  result: ToolCallResult;
}

export interface ChatStreamCallbacks {
  onText:       (delta: string) => void;
  onExpression: (timeline: ExpressionEvent[]) => void;
  onToolCall?:  (event: ToolCallEvent) => void;
  onDone:       (usage: { promptTokens: number; completionTokens: number }) => void;
  onError:      (message: string) => void;
}

export function startChatStream(
  body: {
    configId?: string;
    personaId: string;
    messages: ChatMessage[];
    activityContext?: ActivityContext;
  },
  callbacks: ChatStreamCallbacks,
): () => void {
  const controller = new AbortController();

  (async () => {
    let res: Response;
    try {
      res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configId: 'default', ...body }),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        callbacks.onError((err as Error).message ?? 'Network error');
      }
      return;
    }

    if (!res.ok) {
      callbacks.onError(`Server error: ${res.status} ${res.statusText}`);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      callbacks.onError('No response body');
      return;
    }

    const decoder = new TextDecoder();
    let sseBuffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by double newlines
        const parts = sseBuffer.split('\n\n');
        // Last element may be incomplete — keep it in buffer
        sseBuffer = parts.pop() ?? '';

        for (const part of parts) {
          const dataLine = part
            .split('\n')
            .find((l) => l.startsWith('data: '));
          if (!dataLine) continue;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
          } catch {
            continue;
          }

          if (event['type'] === 'text') {
            callbacks.onText(event['delta'] as string);
          } else if (event['type'] === 'expression') {
            callbacks.onExpression(event['timeline'] as ExpressionEvent[]);
          } else if (event['type'] === 'tool_call') {
            callbacks.onToolCall?.({
              name: event['name'] as string,
              args: (event['args'] as Record<string, unknown>) ?? {},
              result: (event['result'] as ToolCallResult) ?? { ok: false },
            });
          } else if (event['type'] === 'done') {
            callbacks.onDone(
              event['usage'] as { promptTokens: number; completionTokens: number },
            );
          } else if (event['type'] === 'error') {
            callbacks.onError(event['message'] as string);
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        callbacks.onError((err as Error).message ?? 'Stream read error');
      }
    } finally {
      reader.releaseLock();
    }
  })();

  return () => controller.abort();
}
