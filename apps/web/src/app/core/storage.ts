export const safeStorage = (kind: 'local' | 'session') => {
  const get = (): Storage | null => {
    try {
      return kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage;
    } catch {
      return null;
    }
  };
  return {
    read<T>(key: string): T | null {
      try {
        const raw = get()?.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
      } catch {
        return null;
      }
    },
    write(key: string, value: unknown): boolean {
      try {
        if (value === null || value === undefined) get()?.removeItem(key);
        else get()?.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
  };
};
