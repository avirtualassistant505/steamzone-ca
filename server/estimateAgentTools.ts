import { computeDeterministicQuote } from '../src/quote/quoteEngine';
import {
  buildInputUiHint,
  buildQuestionText,
  getEstimateSchema,
  getRequiredVisibleFieldsInOrder,
  getSchemaField,
  isAnswered,
  pruneInvisibleAnswers,
  type ServiceType,
  withAnswerValue,
} from '../src/quote/schema';
import {
  normalizeAndValidateField,
  type NormalizeValidateResult,
  validateRequiredAnswers,
} from '../src/quote/normalization';
import {
  createEmptySession,
  getSession,
  saveSession,
  type EstimateSessionRecord,
} from './estimateAgentSessionStore';

export interface NextQuestionResult {
  done: boolean;
  next_field_key?: string;
  question_text?: string;
  input_ui_hint?: {
    type: string;
    options?: Array<{ value: string; label: string }>;
    min?: number;
    max?: number;
    placeholder?: string;
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function computeNextQuestionFromSession(session: EstimateSessionRecord): NextQuestionResult {
  const requiredFields = getRequiredVisibleFieldsInOrder(session.answers);
  const nextField = requiredFields.find((field) => !isAnswered(field, session.answers));
  if (!nextField) {
    return { done: true };
  }

  return {
    done: false,
    next_field_key: nextField.key,
    question_text: buildQuestionText(nextField, session.answers),
    input_ui_hint: buildInputUiHint(nextField, session.answers),
  };
}

export async function toolGetSchema() {
  return getEstimateSchema();
}

export async function toolGetState(sessionId: string): Promise<EstimateSessionRecord> {
  return getSession(sessionId);
}

export async function toolNormalizeAndValidate(
  fieldKey: string,
  userText: string,
  answersSoFar: Record<string, unknown>
): Promise<NormalizeValidateResult> {
  return normalizeAndValidateField(fieldKey, userText, answersSoFar);
}

export async function toolSetAnswer(
  sessionId: string,
  fieldKey: string,
  normalizedValue: unknown
): Promise<EstimateSessionRecord> {
  const field = getSchemaField(fieldKey);
  if (!field) {
    throw new Error(`Unknown field key: ${fieldKey}`);
  }

  const session = await getSession(sessionId);
  const updatedAnswers = pruneInvisibleAnswers(withAnswerValue(session.answers, fieldKey, normalizedValue));

  const next: EstimateSessionRecord = {
    ...session,
    answers: updatedAnswers,
    updated_at: nowIso(),
  };

  return saveSession(next);
}

export async function toolNextQuestion(sessionId: string): Promise<NextQuestionResult> {
  const session = await getSession(sessionId);
  const next = computeNextQuestionFromSession(session);
  if (next.done || !next.next_field_key) {
    return next;
  }

  const askedKeys = session.asked_keys.includes(next.next_field_key)
    ? session.asked_keys
    : [...session.asked_keys, next.next_field_key];

  await saveSession({
    ...session,
    asked_keys: askedKeys,
    last_question_key: next.next_field_key,
    updated_at: nowIso(),
  });

  return next;
}

export async function toolComputeQuote(sessionId: string) {
  const session = await getSession(sessionId);
  const errors = validateRequiredAnswers(session.answers);
  if (errors.length > 0) {
    throw new Error(`Missing required answers: ${errors.join('; ')}`);
  }

  const quote = await computeDeterministicQuote(session.answers);
  return quote;
}

export function newSessionState(sessionId: string): EstimateSessionRecord {
  return createEmptySession(sessionId);
}

export function summaryState(session: EstimateSessionRecord): {
  answers: Record<string, unknown>;
  asked_keys: string[];
  last_question_key: string | null;
  service_type?: ServiceType;
} {
  return {
    answers: session.answers,
    asked_keys: session.asked_keys,
    last_question_key: session.last_question_key,
    service_type: (session.answers.serviceType as ServiceType | undefined) ?? undefined,
  };
}

export async function peekNextQuestion(sessionId: string): Promise<NextQuestionResult> {
  const session = await getSession(sessionId);
  return computeNextQuestionFromSession(session);
}
