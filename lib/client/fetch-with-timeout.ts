export class RequestTimeoutError extends Error {
  constructor() {
    super("응답이 지연되고 있습니다. 저장 여부를 다시 확인해주세요.");
    this.name = "RequestTimeoutError";
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 12_000,
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new RequestTimeoutError();
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function networkErrorMessage(error: unknown) {
  if (error instanceof RequestTimeoutError) return error.message;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "인터넷 연결이 끊겼습니다. 연결 후 다시 시도해주세요.";
  }
  return error instanceof Error
    ? error.message
    : "네트워크 오류가 발생했습니다. 다시 시도해주세요.";
}
