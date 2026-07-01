export function startChatStream(body, callbacks) {
    const controller = new AbortController();
    (async () => {
        let res;
        try {
            res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ configId: 'default', ...body }),
                signal: controller.signal,
            });
        }
        catch (err) {
            if (err.name !== 'AbortError') {
                callbacks.onError(err.message ?? 'Network error');
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
                if (done)
                    break;
                sseBuffer += decoder.decode(value, { stream: true });
                // SSE messages are separated by double newlines
                const parts = sseBuffer.split('\n\n');
                // Last element may be incomplete — keep it in buffer
                sseBuffer = parts.pop() ?? '';
                for (const part of parts) {
                    const dataLine = part
                        .split('\n')
                        .find((l) => l.startsWith('data: '));
                    if (!dataLine)
                        continue;
                    let event;
                    try {
                        event = JSON.parse(dataLine.slice(6));
                    }
                    catch {
                        continue;
                    }
                    if (event['type'] === 'text') {
                        callbacks.onText(event['delta']);
                    }
                    else if (event['type'] === 'expression') {
                        callbacks.onExpression(event['timeline']);
                    }
                    else if (event['type'] === 'tool_call') {
                        callbacks.onToolCall?.({
                            name: event['name'],
                            args: event['args'] ?? {},
                            result: event['result'] ?? { ok: false },
                        });
                    }
                    else if (event['type'] === 'done') {
                        callbacks.onDone(event['usage']);
                    }
                    else if (event['type'] === 'error') {
                        callbacks.onError(event['message']);
                    }
                }
            }
        }
        catch (err) {
            if (err.name !== 'AbortError') {
                callbacks.onError(err.message ?? 'Stream read error');
            }
        }
        finally {
            reader.releaseLock();
        }
    })();
    return () => controller.abort();
}
