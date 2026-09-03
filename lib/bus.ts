type Listener = (payload: string) => void;

/**
 * Process-wide fan-out for SSE clients. Stashed on globalThis so Next's dev
 * server keeps one bus across hot reloads instead of one per module instance.
 */
class Bus {
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  publish(payload: string) {
    for (const fn of this.listeners) {
      try {
        fn(payload);
      } catch {
        // A dead client shouldn't take down the write that triggered this.
      }
    }
  }

  get size() {
    return this.listeners.size;
  }
}

const g = globalThis as unknown as { __handoffBus?: Bus };
export const bus = (g.__handoffBus ??= new Bus());
