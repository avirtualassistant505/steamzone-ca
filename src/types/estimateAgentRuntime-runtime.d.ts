declare module '*estimateAgentRuntime.mjs' {

  export interface EstimateSessionRecord {
    session_id: string;
    answers: Record<string, unknown>;
    asked_keys: string[];
    transcript?: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; at: string }>;
    last_question_key: string | null;
    created_at?: string;
    updated_at?: string;
  }

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

  export function appendTranscript(sessionId: string, entry: { role: 'user' | 'assistant' | 'tool'; content: string; at: string }): Promise<EstimateSessionRecord>;
  export function getSession(sessionId: string): Promise<EstimateSessionRecord>;
  export function peekNextQuestion(sessionId: string): Promise<NextQuestionResult>;
  export function summaryState(session: EstimateSessionRecord): {
    answers: Record<string, unknown>;
    asked_keys: string[];
    last_question_key: string | null;
    service_type?: string;
  };
  export function toolComputeQuote(sessionId: string): Promise<{
    quote_id: string;
    total: number;
    currency: string;
    line_items: Array<{ label: string; amount: number }>;
    assumptions: string[];
    answers_echo: Record<string, unknown>;
    version: string;
  }>;
  export function toolGetSchema(): Promise<unknown>;
  export function toolGetState(sessionId: string): Promise<EstimateSessionRecord>;
  export function toolNextQuestion(sessionId: string): Promise<NextQuestionResult>;
  export function toolNormalizeAndValidate(fieldKey: string, userText: string, answersSoFar: Record<string, unknown>): Promise<{
    ok: boolean;
    normalized_value: unknown;
    error_message?: string;
    needs_clarification?: boolean;
    clarification_question?: string;
  }>;
  export function toolSetAnswer(
    sessionId: string,
    fieldKey: string,
    normalizedValue: unknown
  ): Promise<EstimateSessionRecord>;
  export function validateRequiredAnswers(answers: Record<string, unknown>): string[];
}
