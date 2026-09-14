import type { ParticipantSession, SubmissionValue } from "./types";

function storageKey(gameSlug: string) {
  return `goldenbell:participant:${gameSlug}`;
}

function pendingStorageKey(gameSlug: string) {
  return `goldenbell:join-pending:${gameSlug}`;
}

function pendingAnswerStorageKey(gameSlug: string) {
  return `goldenbell:answer-pending:${gameSlug}`;
}

export function createSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function loadParticipantSession(gameSlug: string): ParticipantSession | null {
  try {
    const raw = localStorage.getItem(storageKey(gameSlug));
    if (!raw) return null;

    const value = JSON.parse(raw) as Partial<ParticipantSession>;
    if (
      value.gameSlug !== gameSlug
      || typeof value.gameId !== "string"
      || typeof value.name !== "string"
      || typeof value.participantId !== "string"
      || typeof value.sessionToken !== "string"
    ) {
      return null;
    }

    return value as ParticipantSession;
  } catch {
    return null;
  }
}

export function saveParticipantSession(session: ParticipantSession) {
  localStorage.setItem(storageKey(session.gameSlug), JSON.stringify(session));
}

export function clearParticipantSession(gameSlug: string) {
  localStorage.removeItem(storageKey(gameSlug));
}

export function loadPendingJoin(gameSlug: string) {
  try {
    const raw = localStorage.getItem(pendingStorageKey(gameSlug));
    if (!raw) return null;
    const value = JSON.parse(raw) as { name?: unknown; sessionToken?: unknown };
    if (typeof value.name !== "string" || typeof value.sessionToken !== "string") {
      return null;
    }
    return { name: value.name, sessionToken: value.sessionToken };
  } catch {
    return null;
  }
}

export function savePendingJoin(gameSlug: string, value: { name: string; sessionToken: string }) {
  localStorage.setItem(pendingStorageKey(gameSlug), JSON.stringify(value));
}

export function clearPendingJoin(gameSlug: string) {
  localStorage.removeItem(pendingStorageKey(gameSlug));
}

export function savePendingAnswer(
  gameSlug: string,
  value: { answer: SubmissionValue; questionId: string },
) {
  localStorage.setItem(pendingAnswerStorageKey(gameSlug), JSON.stringify({
    ...value,
    savedAt: new Date().toISOString(),
  }));
}

export function loadPendingAnswer(gameSlug: string, questionId: string) {
  try {
    const raw = localStorage.getItem(pendingAnswerStorageKey(gameSlug));
    if (!raw) return null;
    const value = JSON.parse(raw) as {
      answer?: unknown;
      questionId?: unknown;
      savedAt?: unknown;
    };
    if (
      value.questionId !== questionId
      || (typeof value.answer !== "string" && typeof value.answer !== "number")
    ) {
      return null;
    }
    return { answer: value.answer as SubmissionValue, questionId };
  } catch {
    return null;
  }
}

export function clearPendingAnswer(gameSlug: string, questionId?: string) {
  if (questionId) {
    const pending = loadPendingAnswer(gameSlug, questionId);
    if (!pending) return;
  }
  localStorage.removeItem(pendingAnswerStorageKey(gameSlug));
}
