import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock3, Database, Download, Plus, Save, Trash2 } from 'lucide-react';
import {
  createDefaultPricingConfig,
  formatBookingMode,
  formatConfidence,
  formatCurrency,
  formatServiceLabel,
  type EstimateRecord,
  type PricingConfig,
  type WindowZone,
} from '../lib/estimateEngine';
import {
  AGENT_DEFAULT_MODEL,
  AGENT_DEFAULT_VOICE_MODEL,
  AGENT_MODEL_OPTIONS,
  AGENT_VOICE_MODEL_OPTIONS,
  type AgentModelOption,
} from '../estimate/core/agentModelConfig';
import { parseJsonResponse, type SafeJsonResult } from '../lib/responseParsing';

interface AdminPricingPageProps {
  pricingConfig: PricingConfig;
  onPricingConfigChange: (nextConfig: PricingConfig) => void;
  pricingStatus: 'loading' | 'ready' | 'error';
}

interface TrainingItem {
  question: string;
  answer: string;
  topic?: string;
  subtopic?: string;
  status?: string;
}

interface AgentModelResponse {
  model: string;
  voice_model?: string;
  source: 'db' | 'fallback';
  updatedAt?: string;
  message?: string;
  available_models?: AgentModelOption[];
  available_voice_models?: AgentModelOption[];
}

interface AgentPromptResponse {
  prompt: string;
  source: 'db' | 'fallback';
  updatedAt?: string;
  message?: string;
  defaultPrompt?: string;
}

type TrainingGetPayload = {
  items?: Array<unknown>;
  source?: 'db' | 'fallback';
  updatedAt?: string;
  message?: string;
};

type TrainingSavePayload = {
  items?: Array<TrainingItem>;
  source?: 'db' | 'fallback';
  updatedAt?: string;
  message?: string;
};

type PricingSavePayload = {
  config?: PricingConfig;
  message?: string;
};

type ConversationReviewStatus = 'unprocessed' | 'ready' | 'processed';

type ConversationSummary = {
  session_id: string;
  created_at: string;
  updated_at: string;
  turn_count: number;
  channels: string[];
  preview: string;
  last_question_key: string | null;
  review_status: ConversationReviewStatus;
  review_notes: string;
};

type ConversationTurn = {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  at: string;
  channel: string;
  reasoning?: string;
};

type ConversationDetail = {
  session_id: string;
  created_at: string;
  updated_at: string;
  answers: Record<string, unknown>;
  asked_keys: string[];
  last_question_key: string | null;
  review_status: ConversationReviewStatus;
  review_notes: string;
  transcript: ConversationTurn[];
};

type TranscriptGetPayload = {
  sessions?: ConversationSummary[];
  session?: ConversationDetail;
  storage_mode?: 'database' | 'memory_fallback';
  message?: string;
};

type TranscriptUpdatePayload = {
  session_id: string;
  review_status: ConversationReviewStatus;
  review_notes?: string;
  storage_mode?: 'database' | 'memory_fallback';
  message?: string;
};

type TranscriptDeletePayload = {
  session_id: string;
  deleted: boolean;
  storage_mode: 'database' | 'memory_fallback';
  message?: string;
};

type SupabaseDiagnosticPayload = {
  ok: boolean;
  message: string;
  errorCategory?: 'missing_env' | 'missing_table' | 'cloudflare_error' | 'network_error' | 'html_error' | 'other';
  errorCode?: number;
  remediationHint?: string;
  projectHealthUrl?: string;
  config: {
    hasUrl: boolean;
    hasServiceRoleKey: boolean;
    urlHost: string | null;
    projectRef: string | null;
    keyHint: string | null;
  };
  probe: {
    reachable: boolean;
    estimateSessionsTableExists?: boolean;
    sampleError?: string;
  };
};

function parsePayloadError<T>(result: SafeJsonResult<T>): string {
  return result.textError ?? `Unable to parse response (HTTP ${result.status}).`;
}

const STORAGE_KEY = 'steamzone_training_admin_tab';
type AdminTab = 'pricing' | 'training' | 'prompt' | 'logs' | 'download';

const cardClass = 'rounded-2xl border border-gray-200 bg-white p-6 shadow-sm';
const PROMPT_FALLBACK =
  'You can add your shared system prompt instructions here to control tone, style, and behavior for both web and voice estimate agents.';
const ADMIN_CONVERSATION_VALUE_UNKNOWN = 'Not captured';

const FIELD_LABELS: Record<string, string> = {
  serviceType: 'Service Type',
  postalCode: 'Postal Code',
  zone: 'Travel Zone',
  storey: 'House Type / Storeys',
  sizeBracket: 'Square Footage Bracket',
  scope: 'Cleaning Scope',
  screens: 'Screens',
  tracks: 'Tracks & Sills',
  hardToReach: 'Hard-to-reach windows',
  hardWaterRemoval: 'Hard water removal needed',
  constructionDebris: 'Construction debris / paint on glass',
  slidingRemoval: 'Sliding windows removal',
  slidingQuantity: 'Sliding windows quantity',
  patioDoors: 'Patio doors',
  patioQuantity: 'Patio doors quantity',
  skylights: 'Skylights',
  skylightQuantity: 'Skylight quantity',
  railingGlass: 'Railing glass',
  frenchPanes: 'French panes',
  sunroom: 'Sunroom',
  walkoutBasement: 'Walkout basement access',
  buildingType: 'Building type',
  storeys: 'Storeys',
  sizeMode: 'Glass size method',
  paneCount: 'Pane count',
  frontageFeet: 'Frontage (feet)',
  glassDoors: 'Glass doors',
  frequency: 'Service frequency',
  liftRequired: 'Lift required',
  afterHours: 'After-hours availability',
  overspray: 'Overspray cleanup',
  hardWater: 'Hard-water treatment',
  estimateMode: 'Carpet estimate mode',
  rooms: 'Room count',
  sqftBracket: 'Square footage bracket',
  condition: 'Carpet condition',
  stairsSteps: 'Stairs',
  hallways: 'Hallways',
  advancedStainRemoval: 'Advanced stain removal',
  odorElimination: 'Odor elimination',
  petTreatment: 'Pet treatment',
  stainProtector: 'Stain protection',
  furnitureMoving: 'Furniture moving',
  unusualCondition: 'Unusual condition',
  projectType: 'Project type',
  buildType: 'Build type',
  floors: 'Floors',
  stage: 'Cleaning stage',
  dustLoad: 'Dust load',
  interiorWindows: 'Interior windows',
  scraping: 'Scraping',
  floorDetailing: 'Floor detailing',
  insideCabinets: 'Inside cabinets',
  appliances: 'Appliances',
  specialDetailing: 'Special detailing',
  multiTenantAccess: 'Multi-tenant access',
  schedule: 'Preferred schedule',
  'contact.fullName': 'Contact name',
  'contact.phone': 'Contact phone',
  'contact.email': 'Contact email',
  'contact.address': 'Contact address',
  'contact.consentToContact': 'Consent to contact',
  'contact.marketingOptIn': 'Marketing opt-in',
};

const ENUM_LABELS: Record<string, Record<string, string>> = {
  serviceType: {
    window: 'Residential Windows',
    commercialWindow: 'Commercial Windows',
    carpet: 'Carpet Cleaning',
    postConstruction: 'Post-Construction Cleaning',
  },
  zone: {
    zoneA: 'Zone A - Steinbach + 15km',
    zoneB: 'Zone B - 15km to 35km',
    zoneC: 'Zone C - Winnipeg trips',
    zoneD: 'Zone D - Extended rural',
  },
  storey: {
    bungalow: 'Bungalow',
    oneHalf: '1.5 story',
    two: '2 story',
    twoHalf: '2.5 story',
    three: '3 story',
  },
  sizeBracket: {
    under1000: 'Under 1000 sq ft',
    '1000to1500': '1000-1500 sq ft',
    '1500to2000': '1500-2000 sq ft',
    '2000to2500': '2000-2500 sq ft',
    '2500to3000': '2500-3000 sq ft',
    over3000: '3000+ sq ft',
  },
  scope: {
    exterior: 'Exterior only',
    interior: 'Interior only',
    both: 'Interior + Exterior',
  },
  screens: { none: 'None', some: 'Some', all: 'All' },
  tracks: { basic: 'Basic', detailed: 'Detailed' },
  slidingRemoval: { none: 'No', threePanel: '3-panel', fivePanel: '5-panel' },
  patioDoors: { none: 'No patio work', takeApart: 'Take-apart', slideOnly: 'Slide-only' },
  skylights: { none: 'None', interior: 'Interior', exterior: 'Exterior', both: 'Both sides' },
  railingGlass: { none: 'None', oneSide: 'One side', twoSides: 'Two sides' },
  frenchPanes: { none: 'None', some: 'Some', lots: 'Lots' },
  buildingType: {
    storefront: 'Storefront',
    lowRise: 'Low-rise',
    midRise: 'Mid-rise',
    highRise: 'High-rise',
  },
  storeys: {
    ground: 'Ground floor',
    twoToThree: '2-3 storeys',
    fourToEight: '4-8 storeys',
    ninePlus: '9+ storeys',
  },
  sizeMode: { paneCount: 'Pane count', frontageFeet: 'Frontage feet' },
  frequency: {
    oneTime: 'One-time',
    monthly: 'Monthly',
    biweekly: 'Bi-weekly',
    weekly: 'Weekly',
  },
  condition: { light: 'Light', moderate: 'Moderate', heavy: 'Heavy' },
  estimateMode: { rooms: 'By rooms', sqft: 'By square footage' },
  sqftBracket: {
    under500: 'Under 500 sq ft',
    '500to1000': '500-1000 sq ft',
    '1000to1500': '1000-1500 sq ft',
    '1500to2000': '1500-2000 sq ft',
    over2000: '2000+ sq ft',
    under1000: 'Under 1000 sq ft',
    '1000to2500': '1000-2500 sq ft',
    '2500to5000': '2500-5000 sq ft',
    over5000: '5000+ sq ft',
  },
  furnitureMoving: { none: 'None', light: 'Light', heavy: 'Heavy' },
  projectType: { residential: 'Residential', commercial: 'Commercial' },
  buildType: { renovation: 'Renovation', newBuild: 'New build' },
  stage: { rough: 'Rough', light: 'Light', final: 'Final', touchUp: 'Touch-up' },
  dustLoad: { light: 'Light', medium: 'Medium', heavy: 'Heavy' },
  interiorWindows: {
    none: 'None',
    small: 'Small',
    medium: 'Medium',
    large: 'Large',
  },
  scraping: { none: 'None', some: 'Some', lots: 'Lots' },
  floorDetailing: {
    none: 'None',
    small: 'Small',
    medium: 'Medium',
    large: 'Large',
  },
  schedule: { asap: 'ASAP', nextWeek: 'Next week', flexible: 'Flexible', tomorrow: 'Tomorrow' },
};

type ConversationFlowEntry = {
  key: string;
  label: string;
  value: string;
  answered: boolean;
};

type TrainingAssistantMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  resultIndexes?: number[];
};

type TrainingAssistantProposedAction = {
  type: 'none' | 'add' | 'update';
  target_index: number | null;
  reason: string;
  entry: TrainingItem | null;
};

type TrainingAssistantApiPayload = {
  assistant_message?: string;
  result_indexes?: number[];
  suggested_jump_index?: number | null;
  proposed_action?: TrainingAssistantProposedAction;
  model?: string;
  source?: 'llm' | 'fallback';
  message?: string;
};

type TrainingSearchMatch = {
  index: number;
  score: number;
};

const TRAINING_SEARCH_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'at',
  'be',
  'can',
  'do',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'our',
  'please',
  'the',
  'this',
  'to',
  'we',
  'what',
  'where',
  'which',
  'with',
  'you',
  'your',
]);

function normalizeTrainingSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeTrainingSearch(value: string): string[] {
  const normalized = normalizeTrainingSearchText(value);
  if (!normalized) return [];
  return normalized
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !TRAINING_SEARCH_STOP_WORDS.has(token));
}

function scoreTrainingItemMatch(
  queryNormalized: string,
  queryTokens: string[],
  item: TrainingItem
): number {
  const question = normalizeTrainingSearchText(item.question);
  const answer = normalizeTrainingSearchText(item.answer);
  const topic = normalizeTrainingSearchText(item.topic ?? '');
  const subtopic = normalizeTrainingSearchText(item.subtopic ?? '');
  const corpus = `${question} ${answer} ${topic} ${subtopic}`.trim();
  if (!corpus) return 0;

  let score = 0;
  if (question.includes(queryNormalized)) score += 8;
  if (answer.includes(queryNormalized)) score += 4;
  if (topic.includes(queryNormalized)) score += 2;
  if (subtopic.includes(queryNormalized)) score += 1.5;

  if (queryTokens.length > 0) {
    let overlap = 0;
    for (const token of queryTokens) {
      if (question.includes(token)) {
        overlap += 2;
      } else if (answer.includes(token)) {
        overlap += 1;
      } else if (topic.includes(token) || subtopic.includes(token)) {
        overlap += 1.5;
      }
    }
    score += overlap;
  }

  if (
    /discount|discounts|promotion|promotions/.test(queryNormalized) &&
    /first time|first-time|new customer/.test(queryNormalized) &&
    /first time|first-time|new customer/.test(corpus)
  ) {
    score += 3;
  }

  return score;
}

function findTrainingMatches(trainingItems: TrainingItem[], query: string, limit = 5): TrainingSearchMatch[] {
  const queryNormalized = normalizeTrainingSearchText(query);
  if (!queryNormalized) return [];
  const queryTokens = tokenizeTrainingSearch(query);

  const scored: TrainingSearchMatch[] = [];
  for (let index = 0; index < trainingItems.length; index += 1) {
    const item = trainingItems[index];
    const score = scoreTrainingItemMatch(queryNormalized, queryTokens, item);
    if (score >= 2) {
      scored.push({ index, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, Math.min(limit, 10)));
}

function isAffirmativeInput(value: string): boolean {
  return /\b(yes|yeah|yep|sure|ok|okay|do it|go ahead|jump|open|si|sí)\b/i.test(value.trim().toLowerCase());
}

function isNegativeInput(value: string): boolean {
  return /\b(no|nope|nah|not now|cancel|stop)\b/i.test(value.trim().toLowerCase());
}

function parseEntryNumber(value: string): number | null {
  const match = value.match(/#?\s*(\d{1,4})/);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

function formatFlowLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (character) => character.toUpperCase());
}

function formatFlowValue(key: string, value: unknown): string {
  if (value === undefined || value === null) {
    return ADMIN_CONVERSATION_VALUE_UNKNOWN;
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return ADMIN_CONVERSATION_VALUE_UNKNOWN;
    }

    const map = ENUM_LABELS[key];
    if (map && map[trimmed]) {
      return map[trimmed];
    }

    return trimmed;
  }

  if (Array.isArray(value)) {
    return value.length === 0 ? ADMIN_CONVERSATION_VALUE_UNKNOWN : value.join(', ');
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

function getAnswerByPath(values: Record<string, unknown>, key: string): unknown {
  const path = key.split('.');
  let current: unknown = values;

  for (const segment of path) {
    if (!segment || current === null || current === undefined || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }

    const record = current as Record<string, unknown>;
    current = record[segment];
  }

  return current;
}

function buildConversationFlowEntries(session: ConversationDetail): ConversationFlowEntry[] {
  const seen = new Set<string>();
  const entries: ConversationFlowEntry[] = [];

  const addKey = (key: string): void => {
    if (seen.has(key)) {
      return;
    }

    const value = getAnswerByPath(session.answers, key);
    const answered = value !== undefined;
    const formatted = formatFlowValue(key, value);
    entries.push({ key, label: formatFlowLabel(key), value: formatted, answered });
    seen.add(key);
  };

  session.asked_keys.forEach(addKey);

  if (session.answers?.serviceType && !seen.has('serviceType')) {
    addKey('serviceType');
  }

  if (session.answers?.contact && typeof session.answers.contact === 'object' && !Array.isArray(session.answers.contact)) {
    addKey('contact.fullName');
    addKey('contact.phone');
    addKey('contact.email');
  }

  return entries;
}

function NumberField({
  label,
  value,
  onChange,
  step = '1',
  min,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: string;
  min?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        value={value}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
      />
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

export default function AdminPricingPage({ pricingConfig, onPricingConfigChange, pricingStatus }: AdminPricingPageProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('pricing');
  const [draftConfig, setDraftConfig] = useState<PricingConfig>(pricingConfig);
  const [saveMessage, setSaveMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [agentModel, setAgentModel] = useState(AGENT_DEFAULT_MODEL);
  const [agentVoiceModel, setAgentVoiceModel] = useState(AGENT_DEFAULT_VOICE_MODEL);
  const [agentModelOptions, setAgentModelOptions] = useState<AgentModelOption[]>(AGENT_MODEL_OPTIONS);
  const [agentVoiceModelOptions, setAgentVoiceModelOptions] = useState<AgentModelOption[]>(AGENT_VOICE_MODEL_OPTIONS);
  const [agentModelSource, setAgentModelSource] = useState<'db' | 'fallback'>('fallback');
  const [agentModelUpdatedAt, setAgentModelUpdatedAt] = useState('');
  const [agentModelLoading, setAgentModelLoading] = useState(false);
  const [agentModelSaving, setAgentModelSaving] = useState(false);
  const [agentModelMessage, setAgentModelMessage] = useState('');
  const [agentPrompt, setAgentPrompt] = useState('');
  const [agentPromptSource, setAgentPromptSource] = useState<'db' | 'fallback'>('fallback');
  const [agentPromptUpdatedAt, setAgentPromptUpdatedAt] = useState('');
  const [agentPromptLoading, setAgentPromptLoading] = useState(false);
  const [agentPromptSaving, setAgentPromptSaving] = useState(false);
  const [agentPromptMessage, setAgentPromptMessage] = useState('');
  const [records] = useState<EstimateRecord[]>([]);
  const [trainingItems, setTrainingItems] = useState<TrainingItem[]>([]);
  const [trainingSource, setTrainingSource] = useState('fallback');
  const [trainingUpdatedAt, setTrainingUpdatedAt] = useState('');
  const [trainingMessage, setTrainingMessage] = useState('');
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [trainingError, setTrainingError] = useState('');
  const [trainingLoaded, setTrainingLoaded] = useState(false);
  const [conversationSummaries, setConversationSummaries] = useState<ConversationSummary[]>([]);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState('');
  const [conversationMessage, setConversationMessage] = useState('');
  const [conversationLoaded, setConversationLoaded] = useState(false);
  const [conversationStatusFilter, setConversationStatusFilter] = useState<'all' | ConversationReviewStatus>('unprocessed');
  const [conversationStorageMode, setConversationStorageMode] = useState<'database' | 'memory_fallback' | ''>('');
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [selectedConversation, setSelectedConversation] = useState<ConversationDetail | null>(null);
  const [reviewStatusDraft, setReviewStatusDraft] = useState<ConversationReviewStatus>('unprocessed');
  const [reviewNotesDraft, setReviewNotesDraft] = useState('');
  const [conversationDetailLoading, setConversationDetailLoading] = useState(false);
  const [expandedReasoningTurns, setExpandedReasoningTurns] = useState<Set<string>>(new Set<string>());
  const [supabaseDiagLoading, setSupabaseDiagLoading] = useState(false);
  const [supabaseDiagError, setSupabaseDiagError] = useState('');
  const [supabaseDiagResult, setSupabaseDiagResult] = useState<SupabaseDiagnosticPayload | null>(null);
  const [newQuestion, setNewQuestion] = useState('');
  const [newAnswer, setNewAnswer] = useState('');
  const [newTopic, setNewTopic] = useState('');
  const [newSubtopic, setNewSubtopic] = useState('');
  const [newStatus, setNewStatus] = useState('READY');
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [trainingAssistantInput, setTrainingAssistantInput] = useState('');
  const [trainingAssistantPendingJumpIndex, setTrainingAssistantPendingJumpIndex] = useState<number | null>(null);
  const [trainingAssistantHighlightIndex, setTrainingAssistantHighlightIndex] = useState<number | null>(null);
  const [trainingAssistantPendingAction, setTrainingAssistantPendingAction] = useState<TrainingAssistantProposedAction | null>(null);
  const [trainingAssistantBusy, setTrainingAssistantBusy] = useState(false);
  const [trainingAssistantMessages, setTrainingAssistantMessages] = useState<TrainingAssistantMessage[]>([
    {
      id: 'training-assistant-welcome',
      role: 'assistant',
      content:
        'I can search, propose edits, and help add missing training entries. Ask naturally and I will suggest matches or a draft change for your confirmation.',
    },
  ]);
  const trainingAssistantMessageCounter = useRef(0);
  const trainingEntryRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    setDraftConfig(pricingConfig);
  }, [pricingConfig]);

  useEffect(() => {
    const tab = localStorage.getItem(STORAGE_KEY);
    if (tab === 'training' || tab === 'pricing' || tab === 'prompt' || tab === 'logs' || tab === 'download') {
      setActiveTab(tab);
    }
  }, []);

  useEffect(() => {
    async function loadModelConfig(): Promise<void> {
      setAgentModelLoading(true);
      setAgentModelMessage('');
      setAgentPromptLoading(true);
      setAgentPromptMessage('');

      try {
        const [modelResponse, promptResponse] = await Promise.all([
          parseJsonResponse<AgentModelResponse>(await fetch('/api/agent-model')),
          parseJsonResponse<AgentPromptResponse>(await fetch('/api/agent-prompt')),
        ]);

        const modelPayload = modelResponse.payload;
        const promptPayload = promptResponse.payload;

        if (!modelResponse.ok || !modelPayload?.model) {
          setAgentModelMessage(modelPayload?.message ?? parsePayloadError(modelResponse));
          return;
        }

        setAgentModel(modelPayload.model);
        setAgentVoiceModel(modelPayload.voice_model ?? AGENT_DEFAULT_VOICE_MODEL);
        setAgentModelOptions(
          Array.isArray(modelPayload.available_models) && modelPayload.available_models.length > 0 ? modelPayload.available_models : AGENT_MODEL_OPTIONS
        );
        setAgentVoiceModelOptions(
          Array.isArray(modelPayload.available_voice_models) && modelPayload.available_voice_models.length > 0
            ? modelPayload.available_voice_models
            : AGENT_VOICE_MODEL_OPTIONS
        );
        setAgentModelSource(modelPayload.source ?? 'fallback');
        setAgentModelUpdatedAt(modelPayload.updatedAt ?? '');
        setAgentModelMessage(modelPayload.message ?? `Loaded model ${modelPayload.model}.`);

        if (!promptResponse.ok || !promptPayload?.prompt) {
          setAgentPrompt(PROMPT_FALLBACK);
          setAgentPromptSource(promptPayload?.source ?? 'fallback');
          setAgentPromptUpdatedAt(promptPayload?.updatedAt ?? '');
          setAgentPromptMessage(promptPayload?.message ?? parsePayloadError(promptResponse));
          return;
        }

        setAgentPrompt(promptPayload.prompt);
        setAgentPromptSource(promptPayload.source ?? 'fallback');
        setAgentPromptUpdatedAt(promptPayload.updatedAt ?? '');
        setAgentPromptMessage(promptPayload.message ?? `Loaded prompt ${promptPayload.source === 'db' ? 'from DB' : 'from fallback'}.`);
      } catch {
        setAgentModelMessage('Unable to reach /api/agent-model. Ensure endpoint is deployed.');
        setAgentPromptMessage('Unable to reach /api/agent-prompt. Ensure endpoint is deployed.');
      } finally {
        setAgentModelLoading(false);
        setAgentPromptLoading(false);
      }
    }

    void loadModelConfig();
  }, []);

  useEffect(() => {
    if (agentModelOptions.length > 0) {
      const optionExists = agentModelOptions.some((option) => option.value === agentModel);
      if (!optionExists) {
        setAgentModel(agentModelOptions[0].value);
      }
    }
  }, [agentModel, agentModelOptions]);

  useEffect(() => {
    if (agentVoiceModelOptions.length > 0) {
      const optionExists = agentVoiceModelOptions.some((option) => option.value === agentVoiceModel);
      if (!optionExists) {
        setAgentVoiceModel(agentVoiceModelOptions[0].value);
      }
    }
  }, [agentVoiceModel, agentVoiceModelOptions]);

  useEffect(() => {
    if (trainingAssistantPendingJumpIndex !== null && trainingAssistantPendingJumpIndex >= trainingItems.length) {
      setTrainingAssistantPendingJumpIndex(null);
    }
    if (trainingAssistantHighlightIndex !== null && trainingAssistantHighlightIndex >= trainingItems.length) {
      setTrainingAssistantHighlightIndex(null);
    }
    if (
      trainingAssistantPendingAction?.type === 'update' &&
      (trainingAssistantPendingAction.target_index === null || trainingAssistantPendingAction.target_index >= trainingItems.length)
    ) {
      setTrainingAssistantPendingAction(null);
    }
  }, [trainingItems, trainingAssistantPendingJumpIndex, trainingAssistantHighlightIndex, trainingAssistantPendingAction]);

  async function loadTrainingData(): Promise<void> {
    setTrainingLoading(true);
    setTrainingError('');
    setTrainingMessage('');

    try {
      const response = await parseJsonResponse<TrainingGetPayload>(await fetch('/api/training-get'));
      const payload = response.payload;

      if (!response.ok || !payload) {
        setTrainingError(payload?.message ?? parsePayloadError(response));
        return;
      }

      const rawItems = Array.isArray(payload.items) ? payload.items : [];
      const nextItems: TrainingItem[] = rawItems
        .map((item) => {
          if (!item || typeof item !== 'object') {
            return null;
          }

          const typed = item as Record<string, unknown>;
          const question = String(typed.question ?? '').trim();
          const answer = String(typed.answer ?? '').trim();

          if (!question || !answer) {
            return null;
          }

          return {
            question,
            answer,
            topic: typeof typed.topic === 'string' ? typed.topic.trim() : undefined,
            subtopic: typeof typed.subtopic === 'string' ? typed.subtopic.trim() : undefined,
            status: typeof typed.status === 'string' ? typed.status.trim() : 'READY',
          } as TrainingItem;
        })
        .filter((item): item is TrainingItem => item !== null);

      setTrainingItems(nextItems);
      setTrainingSource(payload.source ?? 'fallback');
      setTrainingUpdatedAt(payload.updatedAt ?? '');
      setTrainingLoaded(true);
      setTrainingMessage(`Loaded ${nextItems.length} FAQ entries from ${payload.source === 'db' ? 'database' : 'fallback'}.`);
    } catch {
      setTrainingError('Unable to load training data. Ensure /api/training-get is deployed.');
    } finally {
      setTrainingLoading(false);
    }
  }

  async function loadConversationData(statusOverride?: 'all' | ConversationReviewStatus): Promise<void> {
    setConversationLoading(true);
    setConversationError('');
    setConversationMessage('');

    try {
      const activeStatus = statusOverride ?? conversationStatusFilter;
      const statusQuery = activeStatus === 'all' ? '' : `&status=${activeStatus}`;
      const response = await parseJsonResponse<TranscriptGetPayload>(
        await fetch(`/api/transcripts-get?limit=100${statusQuery}`)
      );
      const payload = response.payload;

      if (!response.ok || !payload) {
        setConversationError(payload?.message ?? parsePayloadError(response));
        return;
      }

      const summaries = Array.isArray(payload.sessions) ? payload.sessions : [];
      setConversationSummaries(summaries);
      setConversationStorageMode(payload.storage_mode ?? '');
      setConversationLoaded(true);

      const shouldLoadFirst = summaries.length > 0 && (!selectedConversationId || !summaries.some((item) => item.session_id === selectedConversationId));
      if (shouldLoadFirst) {
        const first = summaries[0].session_id;
        if (first) {
          setSelectedConversationId(first);
          void loadConversationDetail(first);
        }
      }
    } catch {
      setConversationError('Unable to load conversation logs. Ensure /api/transcripts-get is deployed.');
    } finally {
      setConversationLoading(false);
    }
  }

  async function loadConversationDetail(sessionId: string): Promise<void> {
    const normalized = sessionId.trim();
    if (!normalized) return;

    setConversationDetailLoading(true);
    setConversationError('');
    setConversationMessage('');
    try {
      const encoded = encodeURIComponent(normalized);
      const response = await parseJsonResponse<TranscriptGetPayload>(await fetch(`/api/transcripts-get?session_id=${encoded}`));
      const payload = response.payload;

      if (!response.ok || !payload?.session) {
        setConversationError(payload?.message ?? parsePayloadError(response));
        return;
      }

      setSelectedConversation(payload.session);
      setSelectedConversationId(normalized);
      setReviewStatusDraft(payload.session.review_status || 'unprocessed');
      setReviewNotesDraft(payload.session.review_notes || '');
      setExpandedReasoningTurns(new Set());
    } catch {
      setConversationError('Unable to load conversation detail.');
    } finally {
      setConversationDetailLoading(false);
    }
  }

  async function runSupabaseDiagnostics(): Promise<void> {
    setSupabaseDiagLoading(true);
    setSupabaseDiagError('');
    try {
      const response = await parseJsonResponse<SupabaseDiagnosticPayload>(
        await fetch('/api/supabase-diagnostics')
      );
      const payload = response.payload;

      if (!response.ok || !payload) {
        setSupabaseDiagError(payload?.message ?? parsePayloadError(response));
        return;
      }

      setSupabaseDiagResult(payload);
    } catch {
      setSupabaseDiagError('Unable to run Supabase diagnostics. Ensure /api/supabase-diagnostics is deployed.');
    } finally {
      setSupabaseDiagLoading(false);
    }
  }

  async function saveConversationReviewState(): Promise<void> {
    if (!selectedConversationId) {
      setConversationError('Select a conversation before saving review notes.');
      return;
    }

    const notesChanged = selectedConversation?.review_notes !== reviewNotesDraft;
    const statusChanged = selectedConversation?.review_status !== reviewStatusDraft;
  const payload: {
      session_id: string;
      review_status?: ConversationReviewStatus;
      review_notes?: string;
    } = {
      session_id: selectedConversationId,
    };

    if (statusChanged) {
      payload.review_status = reviewStatusDraft;
    }

    if (notesChanged) {
      payload.review_notes = reviewNotesDraft;
    }
    if (!notesChanged && !statusChanged) {
      setConversationMessage('No changes to save.');
      return;
    }

    setConversationDetailLoading(true);
    setConversationError('');
    setConversationMessage('');
    try {
      const response = await parseJsonResponse<TranscriptUpdatePayload>(await fetch('/api/transcripts-update', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      }));
      const responsePayload = response.payload;

      if (!response.ok || !responsePayload) {
        setConversationError(responsePayload?.message ?? parsePayloadError(response));
        return;
      }

      setConversationStorageMode(responsePayload.storage_mode ?? conversationStorageMode);
      setSelectedConversation((previous) =>
        previous
          ? {
              ...previous,
              review_status: responsePayload.review_status,
              review_notes: responsePayload.review_notes ?? previous.review_notes,
            }
          : previous
      );
      setReviewStatusDraft(responsePayload.review_status);
      setReviewNotesDraft(responsePayload.review_notes ?? reviewNotesDraft);
      setConversationMessage('Review notes and status saved.');
      setConversationSummaries((previous) =>
        previous.map((item) =>
          item.session_id === responsePayload.session_id
            ? {
                ...item,
                review_status: responsePayload.review_status,
                review_notes: responsePayload.review_notes ?? item.review_notes,
              }
            : item
        )
      );
      setConversationError('');
    } catch {
      setConversationError('Unable to save review state for this session.');
    } finally {
      setConversationDetailLoading(false);
    }
  }

  function getConversationTurnKey(index: number, turn: ConversationTurn): string {
    return `${turn.at}-${index}-${turn.role}`;
  }

  function toggleReasoning(turnKey: string): void {
    setExpandedReasoningTurns((previous) => {
      const next = new Set(previous);
      if (next.has(turnKey)) {
        next.delete(turnKey);
      } else {
        next.add(turnKey);
      }
      return next;
    });
  }

  async function deleteConversation(sessionId?: string): Promise<void> {
    const targetSessionId = (sessionId || selectedConversationId).trim();
    if (!targetSessionId) {
      setConversationError('Select a conversation before deleting.');
      return;
    }

    const confirmed = window.confirm(
      `Delete conversation ${targetSessionId}? This cannot be undone and will remove all transcript turns.`
    );
    if (!confirmed) {
      return;
    }

    setConversationError('');
    setConversationMessage('');
    setConversationDetailLoading(true);

    try {
      const response = await parseJsonResponse<TranscriptDeletePayload>(
        await fetch('/api/transcripts-delete', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ session_id: targetSessionId }),
        })
      );
      const payload = response.payload;

      if (!response.ok || !payload) {
        setConversationError(payload?.message ?? parsePayloadError(response));
        return;
      }

      setConversationStorageMode(payload.storage_mode);
      setConversationMessage(payload.message ?? (payload.deleted ? 'Conversation deleted.' : 'Conversation not found.'));
      setConversationSummaries((previous) => previous.filter((item) => item.session_id !== targetSessionId));
      if (selectedConversationId === targetSessionId) {
        setSelectedConversationId('');
        setSelectedConversation(null);
        setReviewStatusDraft('unprocessed');
        setReviewNotesDraft('');
      }
      await loadConversationData();
    } catch {
      setConversationError('Unable to delete conversation.');
    } finally {
      setConversationDetailLoading(false);
    }
  }

  function setTab(nextTab: AdminTab): void {
    setActiveTab(nextTab);
    localStorage.setItem(STORAGE_KEY, nextTab);

    if (nextTab === 'training' && !trainingLoaded && !trainingLoading) {
      void loadTrainingData();
    }
    if (nextTab === 'logs' && !conversationLoaded && !conversationLoading) {
      void loadConversationData();
    }
  }

  function appendTrainingAssistantMessage(
    role: 'assistant' | 'user',
    content: string,
    resultIndexes?: number[]
  ): void {
    trainingAssistantMessageCounter.current += 1;
    setTrainingAssistantMessages((previous) => [
      ...previous,
      {
        id: `training-assistant-${trainingAssistantMessageCounter.current}`,
        role,
        content,
        resultIndexes,
      },
    ]);
  }

  function jumpToTrainingEntry(index: number): void {
    const target = trainingEntryRefs.current[index];
    if (!target) {
      appendTrainingAssistantMessage('assistant', `I could not find entry #${index + 1} on screen. Reload training data and try again.`);
      return;
    }

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTrainingAssistantHighlightIndex(index);
    setTrainingAssistantPendingJumpIndex(null);
    appendTrainingAssistantMessage('assistant', `Jumped to training entry #${index + 1}.`);
  }

  function applyTrainingAssistantAction(action: TrainingAssistantProposedAction): void {
    if (!action.entry || action.type === 'none') {
      appendTrainingAssistantMessage('assistant', 'I do not have a complete edit payload to apply yet.');
      return;
    }

    if (action.type === 'add') {
      setTrainingItems((previous) => [
        ...previous,
        {
          question: action.entry?.question?.trim() || '',
          answer: action.entry?.answer?.trim() || '',
          topic: action.entry?.topic?.trim() || undefined,
          subtopic: action.entry?.subtopic?.trim() || undefined,
          status: action.entry?.status?.trim() || 'READY',
        },
      ]);
      setTrainingMessage('Assistant added a drafted training entry. Click Save Training Data to persist.');
      appendTrainingAssistantMessage('assistant', 'Done. I added the new training entry draft. Click Save Training Data to persist it.');
      setTrainingAssistantPendingAction(null);
      return;
    }

    if (action.type === 'update') {
      if (action.target_index === null || action.target_index < 0 || action.target_index >= trainingItems.length) {
        appendTrainingAssistantMessage('assistant', 'I could not apply the update because the target entry index is out of range.');
        setTrainingAssistantPendingAction(null);
        return;
      }

      setTrainingItems((previous) =>
        previous.map((item, index) =>
          index === action.target_index
            ? {
                ...item,
                question: action.entry?.question?.trim() || item.question,
                answer: action.entry?.answer?.trim() || item.answer,
                topic: action.entry?.topic?.trim() || undefined,
                subtopic: action.entry?.subtopic?.trim() || undefined,
                status: action.entry?.status?.trim() || 'READY',
              }
            : item
        )
      );
      setTrainingMessage('Assistant updated a training entry draft. Click Save Training Data to persist.');
      appendTrainingAssistantMessage(
        'assistant',
        `Done. I updated training entry #${action.target_index + 1}. Click Save Training Data to persist it.`
      );
      setTrainingAssistantPendingAction(null);
    }
  }

  async function handleTrainingAssistantSend(): Promise<void> {
    const query = trainingAssistantInput.trim();
    if (!query) {
      return;
    }

    appendTrainingAssistantMessage('user', query);
    setTrainingAssistantInput('');

    if (trainingItems.length === 0) {
      appendTrainingAssistantMessage('assistant', 'Training data is empty right now. Load training data first, then ask again.');
      return;
    }

    if (trainingAssistantPendingAction) {
      if (isAffirmativeInput(query)) {
        applyTrainingAssistantAction(trainingAssistantPendingAction);
        return;
      }
      if (isNegativeInput(query)) {
        appendTrainingAssistantMessage('assistant', 'No problem. I cancelled that proposed edit.');
        setTrainingAssistantPendingAction(null);
        return;
      }
    }

    if (trainingAssistantPendingJumpIndex !== null) {
      const requestedEntryNumber = parseEntryNumber(query);
      if (isAffirmativeInput(query)) {
        jumpToTrainingEntry(trainingAssistantPendingJumpIndex);
        return;
      }
      if (isNegativeInput(query)) {
        setTrainingAssistantPendingJumpIndex(null);
        appendTrainingAssistantMessage('assistant', 'No problem. Ask another question and I will find better matches.');
        return;
      }
      if (requestedEntryNumber !== null) {
        const targetIndex = requestedEntryNumber - 1;
        if (targetIndex >= 0 && targetIndex < trainingItems.length) {
          jumpToTrainingEntry(targetIndex);
        } else {
          appendTrainingAssistantMessage(
            'assistant',
            `Entry #${requestedEntryNumber} is out of range. Loaded entries: 1 to ${trainingItems.length}.`
          );
        }
        return;
      }
    }

    const jumpRequestNumber = parseEntryNumber(query);
    if (jumpRequestNumber !== null && /\b(jump|go|open|show|take me)\b/i.test(query)) {
      const targetIndex = jumpRequestNumber - 1;
      if (targetIndex >= 0 && targetIndex < trainingItems.length) {
        jumpToTrainingEntry(targetIndex);
      } else {
        appendTrainingAssistantMessage(
          'assistant',
          `Entry #${jumpRequestNumber} is out of range. Loaded entries: 1 to ${trainingItems.length}.`
        );
      }
      return;
    }

    setTrainingAssistantBusy(true);
    try {
      const response = await parseJsonResponse<TrainingAssistantApiPayload>(
        await fetch('/api/training-assistant', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            query,
            items: trainingItems,
            messages: trainingAssistantMessages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
          }),
        })
      );
      const payload = response.payload;
      if (!response.ok || !payload) {
        throw new Error(payload?.message ?? parsePayloadError(response));
      }

      const resultIndexes = Array.isArray(payload.result_indexes)
        ? payload.result_indexes
            .map((entry) => Number(entry))
            .filter((entry, index, list) => Number.isInteger(entry) && entry >= 0 && entry < trainingItems.length && list.indexOf(entry) === index)
        : [];
      const suggested = Number(payload.suggested_jump_index);
      const suggestedJumpIndex =
        Number.isInteger(suggested) && suggested >= 0 && suggested < trainingItems.length
          ? suggested
          : resultIndexes.length > 0
            ? resultIndexes[0]
            : null;

      const assistantMessage = String(payload.assistant_message ?? '').trim();
      appendTrainingAssistantMessage(
        'assistant',
        assistantMessage || 'I reviewed the training data and prepared suggestions.',
        resultIndexes.length > 0 ? resultIndexes : undefined
      );

      if (suggestedJumpIndex !== null) {
        setTrainingAssistantPendingJumpIndex(suggestedJumpIndex);
      }

      const proposedRaw = payload.proposed_action;
      const proposedType = proposedRaw?.type === 'add' || proposedRaw?.type === 'update' ? proposedRaw.type : 'none';
      if (proposedType !== 'none' && proposedRaw?.entry?.question && proposedRaw?.entry?.answer) {
        const normalizedAction: TrainingAssistantProposedAction = {
          type: proposedType,
          target_index:
            proposedType === 'update' && Number.isInteger(proposedRaw.target_index) && (proposedRaw.target_index ?? -1) >= 0
              ? proposedRaw.target_index
              : null,
          reason: String(proposedRaw.reason ?? '').trim() || 'Assistant suggested a training update.',
          entry: {
            question: String(proposedRaw.entry.question ?? '').trim(),
            answer: String(proposedRaw.entry.answer ?? '').trim(),
            topic: typeof proposedRaw.entry.topic === 'string' ? proposedRaw.entry.topic.trim() : undefined,
            subtopic: typeof proposedRaw.entry.subtopic === 'string' ? proposedRaw.entry.subtopic.trim() : undefined,
            status: typeof proposedRaw.entry.status === 'string' ? proposedRaw.entry.status.trim() : 'READY',
          },
        };
        setTrainingAssistantPendingAction(normalizedAction);
        if (normalizedAction.type === 'update' && normalizedAction.target_index !== null) {
          appendTrainingAssistantMessage(
            'assistant',
            `I prepared an update for entry #${normalizedAction.target_index + 1}.\nQuestion: ${normalizedAction.entry.question}\nAnswer: ${normalizedAction.entry.answer}\n${normalizedAction.reason}\nReply "yes" to apply or "no" to cancel.`
          );
        } else {
          appendTrainingAssistantMessage(
            'assistant',
            `I prepared a new training entry draft.\nQuestion: ${normalizedAction.entry.question}\nAnswer: ${normalizedAction.entry.answer}\n${normalizedAction.reason}\nReply "yes" to add it or "no" to cancel.`
          );
        }
      } else {
        setTrainingAssistantPendingAction(null);
      }
      return;
    } catch {
      // Fall back to deterministic local search when API/model is unavailable.
    } finally {
      setTrainingAssistantBusy(false);
    }

    const matches = findTrainingMatches(trainingItems, query, 5);
    if (matches.length === 0) {
      appendTrainingAssistantMessage(
        'assistant',
        'I could not find a confident match. Try adding more specific terms like service type, topic, or key phrase from the answer.'
      );
      return;
    }

    const topIndexes = matches.map((match) => match.index);
    const previewLines = matches
      .slice(0, 3)
      .map((match) => {
        const item = trainingItems[match.index];
        const preview = item?.question?.trim() || '(no question)';
        return `#${match.index + 1}: ${preview}`;
      })
      .join('\n');
    const primaryIndex = topIndexes[0];

    setTrainingAssistantPendingJumpIndex(primaryIndex);
    appendTrainingAssistantMessage(
      'assistant',
      `I found ${matches.length} likely match${matches.length === 1 ? '' : 'es'}:\n${previewLines}\n\nWould you like me to jump to #${primaryIndex + 1}?`,
      topIndexes
    );
  }

  function parseDownloadFilename(contentDisposition: string | null): string | null {
    if (!contentDisposition) {
      return null;
    }

    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
    if (encoded?.[1]) {
      try {
        return decodeURIComponent(encoded[1].replace(/"/g, ''));
      } catch {
        return encoded[1].replace(/"/g, '');
      }
    }

    const simple = /filename="?([^";]+)"?/i.exec(contentDisposition);
    if (simple?.[1]) {
      return simple[1];
    }

    return null;
  }

  async function downloadSiteArchive(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultName = `steamzone-site-backup-${timestamp}.zip`;
    const requestTimeoutMs = 120_000;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), requestTimeoutMs);
    setDownloadLoading(true);
    setDownloadMessage('Generating backup archive (this can take up to 2 minutes)...');
    setDownloadError('');

    try {
      const response = await fetch('/api/download-site', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ includeDatabase: true, includeBuildArtifacts: false }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        const message = text ? `Backup endpoint returned ${response.status}: ${text.slice(0, 140)}` : `Backup endpoint returned ${response.status}`;
        setDownloadError(message);
        setDownloadMessage('');
        return;
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/zip')) {
        const text = await response.text();
        setDownloadError(`Unexpected backup response content type "${contentType || 'unknown'}". ${text.slice(0, 200)}`);
        setDownloadMessage('');
        return;
      }

      const blob = await response.blob();
      const filename = parseDownloadFilename(response.headers.get('content-disposition')) ?? defaultName;
      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(objectUrl);
      setDownloadMessage(`Backup ready: ${filename}`);
      setDownloadError('');
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'AbortError'
          ? `Backup generation timed out after ${Math.round(requestTimeoutMs / 1000)} seconds. Try again.`
          : error instanceof Error
            ? error.message
            : 'Unable to download backup.';
      setDownloadError(message);
      setDownloadMessage('');
    } finally {
      window.clearTimeout(timeoutId);
      setDownloadLoading(false);
    }
  }

  function updateTrainingItem(index: number, patch: Partial<TrainingItem>): void {
    setTrainingItems((previous) => {
      const next = [...previous];
      const existing = next[index];
      if (!existing) {
        return previous;
      }

      const normalizedQuestion = patch.question !== undefined ? String(patch.question).trimStart() : existing.question;
      const normalizedAnswer = patch.answer !== undefined ? String(patch.answer).trimStart() : existing.answer;

      next[index] = {
        ...existing,
        ...patch,
        question: normalizedQuestion,
        answer: normalizedAnswer,
      };
      return next;
    });
  }

  function removeTrainingItem(index: number): void {
    setTrainingItems((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
  }

  function resetNewTrainingForm(): void {
    setNewQuestion('');
    setNewAnswer('');
    setNewTopic('');
    setNewSubtopic('');
    setNewStatus('READY');
  }

  function addTrainingItem(): void {
    const question = newQuestion.trim();
    const answer = newAnswer.trim();

    if (!question || !answer) {
      setTrainingMessage('Question and answer are both required to add a new training entry.');
      return;
    }

    setTrainingItems((previous) => [
      ...previous,
      {
        question,
        answer,
        topic: newTopic.trim() || undefined,
        subtopic: newSubtopic.trim() || undefined,
        status: newStatus.trim() || 'READY',
      },
    ]);

    resetNewTrainingForm();
    setTrainingMessage('Training question added. Click Save Training Data to persist.');
  }

  async function saveTrainingData(): Promise<void> {
    const sanitized = trainingItems
      .map((item) => ({
        question: item.question.trim(),
        answer: item.answer.trim(),
        topic: item.topic?.trim() || undefined,
        subtopic: item.subtopic?.trim() || undefined,
        status: item.status?.trim() || 'READY',
      }))
      .filter((item) => item.question && item.answer);

    setTrainingItems(sanitized);
    setTrainingLoading(true);
    setTrainingError('');
    setTrainingMessage('Saving training data...');

      try {
      const response = await parseJsonResponse<TrainingSavePayload>(
        await fetch('/api/training-save', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ items: sanitized }),
        })
      );
      const payload = response.payload;

      if (!payload) {
        setTrainingError('Unable to save training data. Response was not valid JSON.');
        return;
      }

      if (!response.ok) {
        setTrainingError(payload.message ?? parsePayloadError(response));
        return;
      }

      if (Array.isArray(payload.items)) {
        setTrainingItems(payload.items);
      }

      setTrainingSource(payload.source ?? 'db');
      setTrainingUpdatedAt(payload.updatedAt ?? '');
      setTrainingMessage(payload.message ?? 'Training data saved. Both web and voice agents now use this content.');
      setTrainingLoaded(true);
    } catch {
      setTrainingError('Unable to reach training-save endpoint. Deploy serverless routes and set env variables in Vercel.');
    } finally {
      setTrainingLoading(false);
    }
  }

  async function saveAgentModel(): Promise<void> {
    if (!agentModel.trim()) {
      setAgentModelMessage('Select a model before saving.');
      return;
    }

    if (!agentVoiceModel.trim()) {
      setAgentModelMessage('Select a voice model before saving.');
      return;
    }

    setAgentModelSaving(true);
    setAgentModelMessage('Saving model settings...');

    try {
      const response = await parseJsonResponse<AgentModelResponse>(
        await fetch('/api/agent-model', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ model: agentModel.trim(), voice_model: agentVoiceModel.trim() }),
        })
      );
      const payload = response.payload;

      if (!response.ok || !payload?.model) {
        setAgentModelMessage(payload?.message ?? parsePayloadError(response));
        return;
      }

      setAgentModel(payload.model);
      setAgentVoiceModel(payload.voice_model ?? AGENT_DEFAULT_VOICE_MODEL);
      setAgentModelSource(payload.source ?? 'fallback');
      setAgentModelUpdatedAt(payload.updatedAt ?? '');
      setAgentModelMessage(payload.message ?? 'Model settings saved. Active for next chat turns.');
    } catch {
      setAgentModelMessage('Unable to reach /api/agent-model.');
    } finally {
      setAgentModelSaving(false);
    }
  }

  async function saveAgentPrompt(): Promise<void> {
    const promptToSave = agentPrompt.trim();
    if (!promptToSave) {
      setAgentPromptMessage('Prompt text is required.');
      return;
    }

    setAgentPromptSaving(true);
    setAgentPromptMessage('Saving agent prompt...');

    try {
      const response = await parseJsonResponse<AgentPromptResponse>(
        await fetch('/api/agent-prompt', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ prompt: promptToSave }),
        })
      );
      const payload = response.payload;

      if (!response.ok || !payload?.prompt) {
        setAgentPromptMessage(payload?.message ?? parsePayloadError(response));
        return;
      }

      setAgentPrompt(payload.prompt);
      setAgentPromptSource(payload.source ?? 'fallback');
      setAgentPromptUpdatedAt(payload.updatedAt ?? '');
      setAgentPromptMessage(payload.message ?? 'Agent prompt saved. Active for next chat turns.');
    } catch {
      setAgentPromptMessage('Unable to reach /api/agent-prompt.');
    } finally {
      setAgentPromptSaving(false);
    }
  }

  useEffect(() => {
    if (activeTab === 'training' && !trainingLoaded && !trainingLoading) {
      void loadTrainingData();
    }
    if (activeTab === 'logs' && !conversationLoaded && !conversationLoading) {
      void loadConversationData();
    }
  }, [activeTab]);

  const latestRecords = useMemo(() => records.slice(0, 15), [records]);

  async function handleSave(): Promise<void> {
    setIsSaving(true);
    setSaveMessage('Saving pricing rules to Supabase...');

    try {
      const response = await fetch('/api/pricing-save', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ config: draftConfig }),
      });

      const responsePayload = await parseJsonResponse<PricingSavePayload>(response);
      const payload = responsePayload.payload;

      if (!responsePayload.ok || !payload?.config) {
        const message = parsePayloadError(responsePayload);
        setSaveMessage(payload?.message ?? message);
        setIsSaving(false);
        return;
      }

      onPricingConfigChange(payload.config);
      setSaveMessage('Pricing rules saved. All new quotes now use this configuration.');
      setIsSaving(false);
    } catch {
      setSaveMessage('Unable to reach pricing-save endpoint. Deploy serverless routes and set env variables in Vercel.');
      setIsSaving(false);
    }
  }

  function handleReset(): void {
    const defaults = createDefaultPricingConfig();
    setDraftConfig(defaults);
    setSaveMessage('Draft reset to defaults. Click Save to publish defaults to Supabase.');
  }

  function updateTravelFee(zone: WindowZone, value: number): void {
    setDraftConfig((previous) => ({
      ...previous,
      travelFees: {
        ...previous.travelFees,
        [zone]: value,
      },
    }));
  }

  const conversationFlow = useMemo(
    () => (selectedConversation ? buildConversationFlowEntries(selectedConversation) : []),
    [selectedConversation]
  );

  return (
    <main className="bg-slate-50 pb-20 pt-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold text-gray-900">Estimate Admin</h1>
            <p className="mt-3 max-w-3xl text-gray-600">
              {activeTab === 'pricing'
                ? 'Full pricing control for Steinbach routes: travel zones, per-service base rates, multipliers, add-ons, red flags, and estimate range behavior.'
                : activeTab === 'prompt'
                  ? 'Adjust shared system prompt and agent model settings used by both web and voice estimate agents.'
                : activeTab === 'training'
                  ? 'Update shared training questions/answers used by both web and voice agents.'
                  : activeTab === 'logs'
                    ? 'Browse saved conversation sessions and full voice/text transcripts.'
                    : 'Create and download a full site backup zip including local code and database snapshot data.'}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <a
                href="/estimate-bot-lab"
                className="inline-flex rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
              >
                Open Text Test Page
              </a>
              <a
                href="/estimate-voice-lab"
                className="inline-flex rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100"
              >
                Open Voice Test Page
              </a>
              <button
                type="button"
                onClick={() => setTab('logs')}
                className="inline-flex rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100"
              >
                Go to Conversation Logs
              </button>
              <button
                type="button"
                onClick={() => setTab('download')}
                className="inline-flex rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100"
              >
                Go to Download Site
              </button>
              <button
                type="button"
                onClick={() => setTab('prompt')}
                className="inline-flex rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100"
              >
                Open Prompt Editor
              </button>
            </div>
            <p className="mt-2 text-sm text-gray-500">Last updated: {new Date(draftConfig.updatedAt).toLocaleString()}</p>
          </div>
        </div>

        {activeTab === 'prompt' && (
          <section className={`${cardClass} mt-6`}>
          <h2 className="text-xl font-bold text-gray-900">Estimate Agent Model Settings</h2>
          <p className="mt-2 text-sm text-gray-600">Configure separate models for text and voice modes.</p>
          <p className="mt-2 text-sm text-gray-500">
            Source: {agentModelSource} {agentModelUpdatedAt ? `• Updated ${new Date(agentModelUpdatedAt).toLocaleString()}` : '• Not saved yet'}
          </p>

          <label className="mt-4 block max-w-2xl">
            <span className="mb-1 block text-sm font-medium text-gray-700">Active model</span>
            <select
              value={agentModel}
              onChange={(event) => setAgentModel(event.target.value)}
              disabled={agentModelLoading || agentModelOptions.length === 0}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              {agentModelLoading && (
                <option value={agentModel}>{agentModel}</option>
              )}
              {!agentModelLoading &&
                agentModelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
              ))}
            </select>
          </label>

          <label className="mt-4 block max-w-2xl">
            <span className="mb-1 block text-sm font-medium text-gray-700">Voice model</span>
            <select
              value={agentVoiceModel}
              onChange={(event) => setAgentVoiceModel(event.target.value)}
              disabled={agentModelLoading || agentVoiceModelOptions.length === 0}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              {agentModelLoading && (
                <option value={agentVoiceModel}>{agentVoiceModel}</option>
              )}
              {!agentModelLoading &&
                agentVoiceModelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
            </select>
          </label>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={saveAgentModel}
              disabled={agentModelSaving}
              className="inline-flex items-center rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {agentModelSaving ? 'Saving...' : 'Save Model'}
            </button>
          </div>

          {agentModelMessage && (
            <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{agentModelMessage}</p>
          )}

          <div className="mt-8 border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900">AI Agent Instructions Prompt</h3>
            <p className="mt-2 text-sm text-gray-600">
              This prompt is shared by all text and voice agents. Edit it to adjust tone, flow, and behavior.
            </p>
            <p className="mt-2 text-sm text-gray-500">
              Source: {agentPromptSource} {agentPromptUpdatedAt ? `• Updated ${new Date(agentPromptUpdatedAt).toLocaleString()}` : '• Not saved yet'}
            </p>
            <label className="mt-4 block">
              <span className="mb-1 block text-sm font-medium text-gray-700">System prompt</span>
              <textarea
                value={agentPrompt}
                onChange={(event) => setAgentPrompt(event.target.value)}
                disabled={agentPromptLoading}
                rows={14}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder={PROMPT_FALLBACK}
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={saveAgentPrompt}
                disabled={agentPromptSaving || agentPromptLoading}
                className="inline-flex items-center rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {agentPromptSaving ? 'Saving...' : 'Save Prompt'}
              </button>
            </div>

            {agentPromptMessage && (
              <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{agentPromptMessage}</p>
            )}
          </div>
          </section>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setTab('pricing')}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'pricing' ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-100'
            }`}
            >
            Pricing Configuration
          </button>
          <button
            type="button"
            onClick={() => setTab('prompt')}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'prompt' ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-100'
            }`}
          >
            Prompt &amp; Models
          </button>
          <button
            type="button"
            onClick={() => setTab('training')}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'training' ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-100'
            }`}
          >
            Training Data
          </button>
          <button
            type="button"
            onClick={() => setTab('logs')}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'logs' ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-100'
            }`}
          >
            Conversation Logs
          </button>
          <button
            type="button"
            onClick={() => setTab('download')}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'download' ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Download className="mr-2 inline h-4 w-4" />
            Download Site
          </button>
        </div>

        {activeTab === 'pricing' && (
          <>
            {saveMessage && <p className="mt-6 mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{saveMessage}</p>}
            <section className={`${cardClass} mt-6`}>
              <h2 className="text-xl font-bold text-gray-900">Supabase Pricing Storage</h2>
            <p className="mt-2 text-sm text-gray-600">
                Pricing rules are loaded from <code className="rounded bg-slate-100 px-1 py-0.5">/api/pricing-get</code>. Click Save to publish your updates.
              </p>
              <p className="mt-2 text-sm text-gray-500">Pricing load status: {pricingStatus}</p>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="inline-flex items-center rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save className="mr-2 h-4 w-4" />
                  {isSaving ? 'Saving...' : 'Save Pricing Rules'}
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded-lg border border-gray-300 px-5 py-2.5 font-semibold text-gray-700 transition hover:bg-gray-100"
                >
                  Reset Defaults
                </button>
              </div>
            </section>

            <section className={`${cardClass} mt-6`}>
          <h2 className="text-xl font-bold text-gray-900">Global Estimate Range + Travel Zones</h2>

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <NumberField
              label="Low range multiplier"
              step="0.01"
              value={draftConfig.estimateRange.lowMultiplier}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  estimateRange: { ...previous.estimateRange, lowMultiplier: value },
                }))
              }
            />
            <NumberField
              label="High range multiplier"
              step="0.01"
              value={draftConfig.estimateRange.highMultiplier}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  estimateRange: { ...previous.estimateRange, highMultiplier: value },
                }))
              }
            />

            <NumberField label="Zone A fee" value={draftConfig.travelFees.zoneA} onChange={(value) => updateTravelFee('zoneA', value)} />
            <NumberField label="Zone B fee" value={draftConfig.travelFees.zoneB} onChange={(value) => updateTravelFee('zoneB', value)} />
            <NumberField label="Zone C fee" value={draftConfig.travelFees.zoneC} onChange={(value) => updateTravelFee('zoneC', value)} />
            <NumberField label="Zone D fee" value={draftConfig.travelFees.zoneD} onChange={(value) => updateTravelFee('zoneD', value)} />
          </div>
        </section>

        <section className={`${cardClass} mt-6`}>
          <h2 className="text-xl font-bold text-gray-900">Residential Window Rules</h2>

          <div className="mt-4 grid gap-4 md:grid-cols-3 xl:grid-cols-4">
            <NumberField
              label="Minimum charge"
              value={draftConfig.window.minimumCharge}
              onChange={(value) =>
                setDraftConfig((previous) => ({ ...previous, window: { ...previous.window, minimumCharge: value } }))
              }
            />
            <NumberField
              label="Per pane rate"
              step="0.01"
              value={draftConfig.window.perPaneRate}
              onChange={(value) =>
                setDraftConfig((previous) => ({ ...previous, window: { ...previous.window, perPaneRate: value } }))
              }
            />
            <NumberField
              label="Yellow threshold"
              value={draftConfig.window.yellowComplexityThreshold}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: { ...previous.window, yellowComplexityThreshold: value },
                }))
              }
            />

            <NumberField
              label="Screens (some)"
              value={draftConfig.window.addOns.screensSome}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: { ...previous.window, addOns: { ...previous.window.addOns, screensSome: value } },
                }))
              }
            />
            <NumberField
              label="Screens per pane"
              step="0.01"
              value={draftConfig.window.addOns.screensPerPane}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: { ...previous.window, addOns: { ...previous.window.addOns, screensPerPane: value } },
                }))
              }
            />
            <NumberField
              label="Tracks detailed"
              value={draftConfig.window.addOns.tracksDetailed}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: { ...previous.window, addOns: { ...previous.window.addOns, tracksDetailed: value } },
                }))
              }
            />
            <NumberField
              label="Hard water add-on"
              value={draftConfig.window.addOns.hardWaterRemoval}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: { ...previous.window, addOns: { ...previous.window.addOns, hardWaterRemoval: value } },
                }))
              }
            />
            <NumberField
              label="Construction debris add-on"
              value={draftConfig.window.addOns.constructionDebris}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: { ...previous.window, addOns: { ...previous.window.addOns, constructionDebris: value } },
                }))
              }
            />

            <NumberField
              label="Panes: 1000-1500"
              value={draftConfig.window.estimatedPanes['1000to1500']}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: {
                    ...previous.window,
                    estimatedPanes: { ...previous.window.estimatedPanes, '1000to1500': value },
                  },
                }))
              }
            />
            <NumberField
              label="Panes: 1500-2000"
              value={draftConfig.window.estimatedPanes['1500to2000']}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: {
                    ...previous.window,
                    estimatedPanes: { ...previous.window.estimatedPanes, '1500to2000': value },
                  },
                }))
              }
            />
            <NumberField
              label="Panes: 2000-2500"
              value={draftConfig.window.estimatedPanes['2000to2500']}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: {
                    ...previous.window,
                    estimatedPanes: { ...previous.window.estimatedPanes, '2000to2500': value },
                  },
                }))
              }
            />
            <NumberField
              label="Panes: 2500-3000"
              value={draftConfig.window.estimatedPanes['2500to3000']}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: {
                    ...previous.window,
                    estimatedPanes: { ...previous.window.estimatedPanes, '2500to3000': value },
                  },
                }))
              }
            />
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ToggleField
              label="3000+ requires quote"
              checked={draftConfig.window.redFlags.over3000RequiresQuote}
              onChange={(checked) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: { ...previous.window, redFlags: { ...previous.window.redFlags, over3000RequiresQuote: checked } },
                }))
              }
            />
            <ToggleField
              label="3-storey + French lots requires quote"
              checked={draftConfig.window.redFlags.threeStoreyFrenchLotsRequiresQuote}
              onChange={(checked) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: {
                    ...previous.window,
                    redFlags: { ...previous.window.redFlags, threeStoreyFrenchLotsRequiresQuote: checked },
                  },
                }))
              }
            />
            <ToggleField
              label="Hard water requires confirmation"
              checked={draftConfig.window.redFlags.hardWaterNeedsConfirmation}
              onChange={(checked) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: { ...previous.window, redFlags: { ...previous.window.redFlags, hardWaterNeedsConfirmation: checked } },
                }))
              }
            />
            <ToggleField
              label="Construction debris requires quote"
              checked={draftConfig.window.redFlags.constructionDebrisNeedsQuote}
              onChange={(checked) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: {
                    ...previous.window,
                    redFlags: { ...previous.window.redFlags, constructionDebrisNeedsQuote: checked },
                  },
                }))
              }
            />
          </div>
        </section>

        <section className={`${cardClass} mt-6`}>
          <h2 className="text-xl font-bold text-gray-900">Commercial Window Rules</h2>

          <div className="mt-4 grid gap-4 md:grid-cols-3 xl:grid-cols-4">
            <NumberField
              label="Minimum charge"
              value={draftConfig.commercialWindow.minimumCharge}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: { ...previous.commercialWindow, minimumCharge: value },
                }))
              }
            />
            <NumberField
              label="Yellow threshold"
              value={draftConfig.commercialWindow.yellowComplexityThreshold}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: { ...previous.commercialWindow, yellowComplexityThreshold: value },
                }))
              }
            />

            <NumberField
              label="Storefront exterior / pane"
              step="0.01"
              value={draftConfig.commercialWindow.storefront.exteriorPerPane}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    storefront: { ...previous.commercialWindow.storefront, exteriorPerPane: value },
                  },
                }))
              }
            />
            <NumberField
              label="Storefront in+out / pane"
              step="0.01"
              value={draftConfig.commercialWindow.storefront.bothSidesPerPane}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    storefront: { ...previous.commercialWindow.storefront, bothSidesPerPane: value },
                  },
                }))
              }
            />
            <NumberField
              label="Storefront glass door"
              step="0.01"
              value={draftConfig.commercialWindow.storefront.perGlassDoor}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    storefront: { ...previous.commercialWindow.storefront, perGlassDoor: value },
                  },
                }))
              }
            />
            <NumberField
              label="Panes per frontage foot"
              step="0.1"
              value={draftConfig.commercialWindow.storefront.panesPerFrontageFoot}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    storefront: { ...previous.commercialWindow.storefront, panesPerFrontageFoot: value },
                  },
                }))
              }
            />

            <NumberField
              label="Low-rise per pane min"
              step="0.01"
              value={draftConfig.commercialWindow.lowRise.perPaneMin}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    lowRise: { ...previous.commercialWindow.lowRise, perPaneMin: value },
                  },
                }))
              }
            />
            <NumberField
              label="Low-rise per pane max"
              step="0.01"
              value={draftConfig.commercialWindow.lowRise.perPaneMax}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    lowRise: { ...previous.commercialWindow.lowRise, perPaneMax: value },
                  },
                }))
              }
            />
            <NumberField
              label="Low-rise upper storey premium %"
              step="0.1"
              value={draftConfig.commercialWindow.lowRise.upperStoreyPremiumPercent}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    lowRise: { ...previous.commercialWindow.lowRise, upperStoreyPremiumPercent: value },
                  },
                }))
              }
            />

            <NumberField
              label="Monthly discount %"
              step="0.1"
              value={draftConfig.commercialWindow.recurringDiscountPercent.monthly}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    recurringDiscountPercent: {
                      ...previous.commercialWindow.recurringDiscountPercent,
                      monthly: value,
                    },
                  },
                }))
              }
            />
            <NumberField
              label="Biweekly discount %"
              step="0.1"
              value={draftConfig.commercialWindow.recurringDiscountPercent.biweekly}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    recurringDiscountPercent: {
                      ...previous.commercialWindow.recurringDiscountPercent,
                      biweekly: value,
                    },
                  },
                }))
              }
            />
            <NumberField
              label="Weekly discount %"
              step="0.1"
              value={draftConfig.commercialWindow.recurringDiscountPercent.weekly}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    recurringDiscountPercent: {
                      ...previous.commercialWindow.recurringDiscountPercent,
                      weekly: value,
                    },
                  },
                }))
              }
            />

            <NumberField
              label="After-hours premium %"
              step="0.1"
              value={draftConfig.commercialWindow.addOns.afterHoursPercent}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    addOns: { ...previous.commercialWindow.addOns, afterHoursPercent: value },
                  },
                }))
              }
            />
            <NumberField
              label="Overspray / pane"
              step="0.01"
              value={draftConfig.commercialWindow.addOns.oversprayPerPane}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    addOns: { ...previous.commercialWindow.addOns, oversprayPerPane: value },
                  },
                }))
              }
            />
            <NumberField
              label="Hard water / pane"
              step="0.01"
              value={draftConfig.commercialWindow.addOns.hardWaterPerPane}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    addOns: { ...previous.commercialWindow.addOns, hardWaterPerPane: value },
                  },
                }))
              }
            />
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ToggleField
              label="Mid-rise requires quote"
              checked={draftConfig.commercialWindow.redFlags.midRiseRequiresQuote}
              onChange={(checked) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    redFlags: { ...previous.commercialWindow.redFlags, midRiseRequiresQuote: checked },
                  },
                }))
              }
            />
            <ToggleField
              label="High-rise requires quote"
              checked={draftConfig.commercialWindow.redFlags.highRiseRequiresQuote}
              onChange={(checked) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    redFlags: { ...previous.commercialWindow.redFlags, highRiseRequiresQuote: checked },
                  },
                }))
              }
            />
            <ToggleField
              label="Lift required => quote"
              checked={draftConfig.commercialWindow.redFlags.liftRequiredRequiresQuote}
              onChange={(checked) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    redFlags: { ...previous.commercialWindow.redFlags, liftRequiredRequiresQuote: checked },
                  },
                }))
              }
            />
            <ToggleField
              label="Overspray needs confirmation"
              checked={draftConfig.commercialWindow.redFlags.oversprayNeedsConfirmation}
              onChange={(checked) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    redFlags: { ...previous.commercialWindow.redFlags, oversprayNeedsConfirmation: checked },
                  },
                }))
              }
            />
          </div>
        </section>

        <section className={`${cardClass} mt-6`}>
          <h2 className="text-xl font-bold text-gray-900">Carpet Cleaning Rules</h2>

          <div className="mt-4 grid gap-4 md:grid-cols-3 xl:grid-cols-4">
            <NumberField
              label="Minimum charge"
              value={draftConfig.carpet.minimumCharge}
              onChange={(value) =>
                setDraftConfig((previous) => ({ ...previous, carpet: { ...previous.carpet, minimumCharge: value } }))
              }
            />
            <NumberField
              label="Base rate / sq ft"
              step="0.01"
              value={draftConfig.carpet.baseRatePerSqft}
              onChange={(value) =>
                setDraftConfig((previous) => ({ ...previous, carpet: { ...previous.carpet, baseRatePerSqft: value } }))
              }
            />
            <NumberField
              label="2 rooms"
              value={draftConfig.carpet.roomPackages.twoRooms}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  carpet: {
                    ...previous.carpet,
                    roomPackages: { ...previous.carpet.roomPackages, twoRooms: value },
                  },
                }))
              }
            />
            <NumberField
              label="3 rooms"
              value={draftConfig.carpet.roomPackages.threeRooms}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  carpet: {
                    ...previous.carpet,
                    roomPackages: { ...previous.carpet.roomPackages, threeRooms: value },
                  },
                }))
              }
            />
            <NumberField
              label="4 rooms"
              value={draftConfig.carpet.roomPackages.fourRooms}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  carpet: {
                    ...previous.carpet,
                    roomPackages: { ...previous.carpet.roomPackages, fourRooms: value },
                  },
                }))
              }
            />
            <NumberField
              label="5 rooms"
              value={draftConfig.carpet.roomPackages.fiveRooms}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  carpet: {
                    ...previous.carpet,
                    roomPackages: { ...previous.carpet.roomPackages, fiveRooms: value },
                  },
                }))
              }
            />
            <NumberField
              label="6 rooms"
              value={draftConfig.carpet.roomPackages.sixRooms}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  carpet: {
                    ...previous.carpet,
                    roomPackages: { ...previous.carpet.roomPackages, sixRooms: value },
                  },
                }))
              }
            />
            <NumberField
              label="Additional room"
              value={draftConfig.carpet.roomPackages.additionalRoom}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  carpet: {
                    ...previous.carpet,
                    roomPackages: { ...previous.carpet.roomPackages, additionalRoom: value },
                  },
                }))
              }
            />

            <NumberField
              label="Stairs / step"
              step="0.01"
              value={draftConfig.carpet.stairsPerStep}
              onChange={(value) => setDraftConfig((previous) => ({ ...previous, carpet: { ...previous.carpet, stairsPerStep: value } }))}
            />
            <NumberField
              label="Hallway price"
              value={draftConfig.carpet.hallwayPrice}
              onChange={(value) => setDraftConfig((previous) => ({ ...previous, carpet: { ...previous.carpet, hallwayPrice: value } }))}
            />
            <NumberField
              label="Advanced stain add-on"
              value={draftConfig.carpet.addOns.advancedStainRemoval}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  carpet: { ...previous.carpet, addOns: { ...previous.carpet.addOns, advancedStainRemoval: value } },
                }))
              }
            />
            <NumberField
              label="Odor add-on"
              value={draftConfig.carpet.addOns.odorElimination}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  carpet: { ...previous.carpet, addOns: { ...previous.carpet.addOns, odorElimination: value } },
                }))
              }
            />
          </div>
        </section>

        <section className={`${cardClass} mt-6`}>
          <h2 className="text-xl font-bold text-gray-900">Post-Construction Rules</h2>

          <div className="mt-4 grid gap-4 md:grid-cols-3 xl:grid-cols-4">
            <NumberField
              label="Minimum charge"
              value={draftConfig.postConstruction.minimumCharge}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  postConstruction: { ...previous.postConstruction, minimumCharge: value },
                }))
              }
            />

            <NumberField
              label="Rough stage $/sq ft"
              step="0.01"
              value={draftConfig.postConstruction.stageRates.rough}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  postConstruction: {
                    ...previous.postConstruction,
                    stageRates: { ...previous.postConstruction.stageRates, rough: value },
                  },
                }))
              }
            />
            <NumberField
              label="Light stage $/sq ft"
              step="0.01"
              value={draftConfig.postConstruction.stageRates.light}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  postConstruction: {
                    ...previous.postConstruction,
                    stageRates: { ...previous.postConstruction.stageRates, light: value },
                  },
                }))
              }
            />
            <NumberField
              label="Final stage $/sq ft"
              step="0.01"
              value={draftConfig.postConstruction.stageRates.final}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  postConstruction: {
                    ...previous.postConstruction,
                    stageRates: { ...previous.postConstruction.stageRates, final: value },
                  },
                }))
              }
            />

            <NumberField
              label="Dust medium multiplier"
              step="0.01"
              value={draftConfig.postConstruction.dustMultipliers.medium}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  postConstruction: {
                    ...previous.postConstruction,
                    dustMultipliers: { ...previous.postConstruction.dustMultipliers, medium: value },
                  },
                }))
              }
            />
            <NumberField
              label="Dust heavy multiplier"
              step="0.01"
              value={draftConfig.postConstruction.dustMultipliers.heavy}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  postConstruction: {
                    ...previous.postConstruction,
                    dustMultipliers: { ...previous.postConstruction.dustMultipliers, heavy: value },
                  },
                }))
              }
            />
            <NumberField
              label="Interior windows (small)"
              value={draftConfig.postConstruction.addOns.interiorWindows.small}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  postConstruction: {
                    ...previous.postConstruction,
                    addOns: {
                      ...previous.postConstruction.addOns,
                      interiorWindows: { ...previous.postConstruction.addOns.interiorWindows, small: value },
                    },
                  },
                }))
              }
            />
            <NumberField
              label="Floor detail (small)"
              value={draftConfig.postConstruction.addOns.floorDetailing.small}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  postConstruction: {
                    ...previous.postConstruction,
                    addOns: {
                      ...previous.postConstruction.addOns,
                      floorDetailing: { ...previous.postConstruction.addOns.floorDetailing, small: value },
                    },
                  },
                }))
              }
            />
          </div>
        </section>

        <section className={`${cardClass} mt-6`}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold text-gray-900">Recent Estimate Records</h2>
          </div>

          {latestRecords.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-gray-600">
              Quote history is now stored server-side in Supabase. Add an admin endpoint to list records if you want this
              table populated again.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-3">Time</th>
                    <th className="px-3 py-3">Quote #</th>
                    <th className="px-3 py-3">Service</th>
                    <th className="px-3 py-3">Contact</th>
                    <th className="px-3 py-3">Estimate</th>
                    <th className="px-3 py-3">Confidence</th>
                    <th className="px-3 py-3">Next step</th>
                    <th className="px-3 py-3">Zone</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {latestRecords.map((record) => (
                    <tr key={record.id} className="hover:bg-gray-50">
                      <td className="px-3 py-3 text-gray-600">
                        <div className="flex items-center gap-2">
                          <Clock3 className="h-4 w-4 text-gray-400" />
                          {new Date(record.createdAt).toLocaleString()}
                        </div>
                      </td>
                      <td className="px-3 py-3 font-semibold text-gray-800">{record.quoteNumber}</td>
                      <td className="px-3 py-3 font-medium text-gray-800">{formatServiceLabel(record.serviceType)}</td>
                      <td className="px-3 py-3 text-gray-700">
                        <div className="font-medium">{record.contact.fullName || 'N/A'}</div>
                        <div className="text-xs text-gray-500">{record.contact.phone || record.contact.email || 'No contact'}</div>
                      </td>
                      <td className="px-3 py-3 text-gray-700">
                        {formatCurrency(record.result.estimateLow)} - {formatCurrency(record.result.estimateHigh)}
                      </td>
                      <td className="px-3 py-3 text-gray-700">{formatConfidence(record.result.confidence)}</td>
                      <td className="px-3 py-3 text-gray-700">{formatBookingMode(record.result.bookingMode)}</td>
                      <td className="px-3 py-3 text-gray-700">{record.zone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            <p className="font-semibold">Storage note</p>
            <p className="mt-1 inline-flex items-center">
              <Database className="mr-2 h-4 w-4" />
              Pricing and estimate creation now run server-side. Pricing loads from Supabase and estimates are stored in
              the <code className="mx-1 rounded bg-blue-100 px-1 py-0.5">estimate_records</code> table.
            </p>
          </div>
        </section>
          </>
        )}

        {(activeTab === 'training' || activeTab === 'logs') && (
          <>
            {activeTab === 'training' && (
              <>
            {trainingMessage && <p className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{trainingMessage}</p>}
            {trainingError && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{trainingError}</p>}

            <section className={cardClass}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Training Data</h2>
                  <p className="mt-2 text-sm text-gray-600">
                    Source: {trainingSource}. Updated: {trainingUpdatedAt || 'never'} · Loaded: {trainingItems.length} entries.
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void loadTrainingData()}
                    disabled={trainingLoading}
                    className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Reload Training Data
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveTrainingData()}
                    disabled={trainingLoading}
                    className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {trainingLoading ? 'Saving...' : 'Save Training Data'}
                  </button>
                </div>
              </div>

              <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50/60 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-gray-900">Training Search Assistant</h3>
                    <p className="mt-1 text-sm text-gray-700">
                      Ask naturally. I will find likely FAQ matches, then ask if you want to jump to the exact entry.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setTrainingAssistantMessages([
                        {
                          id: `training-assistant-reset-${Date.now()}`,
                          role: 'assistant',
                          content:
                            'Reset complete. Ask a new question and I will search the training data and offer jump options.',
                        },
                      ]);
                      setTrainingAssistantPendingJumpIndex(null);
                      setTrainingAssistantHighlightIndex(null);
                      setTrainingAssistantPendingAction(null);
                      setTrainingAssistantInput('');
                    }}
                    className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
                  >
                    Reset
                  </button>
                </div>

                <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-blue-100 bg-white p-3">
                  {trainingAssistantMessages.map((message) => (
                    <div key={message.id} className={message.role === 'user' ? 'text-right' : 'text-left'}>
                      <div
                        className={`inline-block max-w-[95%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                          message.role === 'user'
                            ? 'bg-blue-600 text-white'
                            : 'border border-gray-200 bg-gray-50 text-gray-800'
                        }`}
                      >
                        <p className="whitespace-pre-line">{message.content}</p>
                      </div>
                      {message.role === 'assistant' && message.resultIndexes && message.resultIndexes.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {message.resultIndexes.slice(0, 3).map((entryIndex) => (
                            <button
                              key={`${message.id}-jump-${entryIndex}`}
                              type="button"
                              onClick={() => jumpToTrainingEntry(entryIndex)}
                              className="inline-flex items-center rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                            >
                              Jump to #{entryIndex + 1}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={trainingAssistantInput}
                    onChange={(event) => setTrainingAssistantInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void handleTrainingAssistantSend();
                      }
                    }}
                    placeholder='Example: "first-time discounts" or "cleaning materials included"'
                    disabled={trainingAssistantBusy}
                    className="min-w-[280px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                  <button
                    type="button"
                    onClick={() => void handleTrainingAssistantSend()}
                    disabled={trainingAssistantBusy}
                    className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                  >
                    {trainingAssistantBusy ? 'Thinking...' : 'Ask'}
                  </button>
                  {trainingAssistantPendingJumpIndex !== null && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => jumpToTrainingEntry(trainingAssistantPendingJumpIndex)}
                        className="inline-flex items-center rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
                      >
                        Yes, jump to #{trainingAssistantPendingJumpIndex + 1}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTrainingAssistantPendingJumpIndex(null);
                          appendTrainingAssistantMessage('assistant', 'Okay, no jump for now. Ask another question when ready.');
                        }}
                        className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-100"
                      >
                        No, keep browsing
                      </button>
                    </div>
                  )}
                  {trainingAssistantPendingAction && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => applyTrainingAssistantAction(trainingAssistantPendingAction)}
                        className="inline-flex items-center rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
                      >
                        Yes, apply edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTrainingAssistantPendingAction(null);
                          appendTrainingAssistantMessage('assistant', 'Edit cancelled. I can propose another change if you want.');
                        }}
                        className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-100"
                      >
                        No, cancel edit
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 p-3">
                <h3 className="font-semibold text-gray-900">Add new FAQ entry</h3>
                <div className="mt-3 grid gap-3">
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700">Question</span>
                    <input
                      type="text"
                      value={newQuestion}
                      onChange={(event) => setNewQuestion(event.target.value)}
                      placeholder="What is your question?"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700">Answer</span>
                    <textarea
                      value={newAnswer}
                      onChange={(event) => setNewAnswer(event.target.value)}
                      rows={4}
                      placeholder="Paste the response text..."
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </label>

                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-gray-700">Topic</span>
                      <input
                        type="text"
                        value={newTopic}
                        onChange={(event) => setNewTopic(event.target.value)}
                        placeholder="Residential Carpet Cleaning"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-gray-700">Subtopic</span>
                      <input
                        type="text"
                        value={newSubtopic}
                        onChange={(event) => setNewSubtopic(event.target.value)}
                        placeholder="Process"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-gray-700">Status</span>
                      <input
                        type="text"
                        value={newStatus}
                        onChange={(event) => setNewStatus(event.target.value)}
                        placeholder="READY"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={addTrainingItem}
                    className="inline-flex w-fit items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Entry
                  </button>
                </div>
              </div>

              <div className="mt-6">
                {trainingLoading ? (
                  <p className="text-sm text-gray-500">Loading training entries...</p>
                ) : (
                  <div className="space-y-3">
                    {trainingItems.length === 0 && (
                      <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-4 text-sm text-gray-600">No training items loaded yet.</p>
                    )}

                    {trainingItems.map((item, index) => (
                      <div
                        key={`${item.question}-${index}`}
                        id={`training-entry-${index + 1}`}
                        ref={(node) => {
                          trainingEntryRefs.current[index] = node;
                        }}
                        className={`rounded-lg border p-4 transition ${
                          trainingAssistantHighlightIndex === index
                            ? 'border-blue-400 ring-2 ring-blue-200'
                            : 'border-gray-200'
                        }`}
                      >
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-gray-800">#{index + 1}</p>
                          <button
                            type="button"
                            onClick={() => removeTrainingItem(index)}
                            className="inline-flex items-center rounded border border-red-200 px-3 py-1.5 text-sm text-red-700 transition hover:bg-red-50"
                          >
                            <Trash2 className="mr-1 h-4 w-4" />
                            Remove
                          </button>
                        </div>

                        <label className="block">
                          <span className="mb-1 block text-sm font-medium text-gray-700">Question</span>
                          <input
                            type="text"
                            value={item.question}
                            onChange={(event) => updateTrainingItem(index, { question: event.target.value })}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                          />
                        </label>
                        <label className="mt-3 block">
                          <span className="mb-1 block text-sm font-medium text-gray-700">Answer</span>
                          <textarea
                            value={item.answer}
                            onChange={(event) => updateTrainingItem(index, { answer: event.target.value })}
                            rows={4}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                          />
                        </label>

                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          <label className="block">
                            <span className="mb-1 block text-sm font-medium text-gray-700">Topic</span>
                            <input
                              type="text"
                              value={item.topic ?? ''}
                              onChange={(event) => updateTrainingItem(index, { topic: event.target.value })}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-sm font-medium text-gray-700">Subtopic</span>
                            <input
                              type="text"
                              value={item.subtopic ?? ''}
                              onChange={(event) => updateTrainingItem(index, { subtopic: event.target.value })}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-sm font-medium text-gray-700">Status</span>
                            <input
                              type="text"
                              value={item.status ?? 'READY'}
                              onChange={(event) => updateTrainingItem(index, { status: event.target.value })}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
              </>
            )}

            {activeTab === 'logs' && (
            <section className={`${cardClass} mt-6`}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Conversation Logs</h2>
                  <p className="mt-2 text-sm text-gray-600">
                    Saved text and voice turns from the estimate agent session store.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700">
                    <span className="text-xs font-semibold">Filter</span>
                    <select
                      value={conversationStatusFilter}
                      onChange={(event) => {
                        const nextFilter = event.target.value as 'all' | ConversationReviewStatus;
                        setConversationStatusFilter(nextFilter);
                        if (activeTab === 'logs') {
                          void loadConversationData(nextFilter);
                        }
                      }}
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                    >
                      <option value="all">All</option>
                      <option value="unprocessed">Unprocessed</option>
                      <option value="processed">Processed</option>
                      <option value="ready">Ready</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => void loadConversationData()}
                    disabled={conversationLoading}
                    className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {conversationLoading ? 'Loading...' : 'Reload Logs'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void runSupabaseDiagnostics()}
                    disabled={supabaseDiagLoading}
                    className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {supabaseDiagLoading ? 'Checking...' : 'Run Supabase Diagnostics'}
                  </button>
                </div>
              </div>

              {supabaseDiagError && (
                <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {supabaseDiagError}
                </p>
              )}
              {supabaseDiagResult && (
                <div
                  className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
                    supabaseDiagResult.ok
                      ? 'border-green-200 bg-green-50 text-green-800'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                  }`}
                >
                  <p className="font-semibold">{supabaseDiagResult.ok ? 'Diagnostics Passed' : 'Diagnostics Failed'}</p>
                  <p>{supabaseDiagResult.message}</p>
                  <p className="mt-1">
                    <span className="font-semibold">SUPABASE_URL set:</span> {supabaseDiagResult.config.hasUrl ? 'Yes' : 'No'}
                    {' · '}
                    <span className="font-semibold">SUPABASE_SERVICE_ROLE_KEY set:</span>{' '}
                    {supabaseDiagResult.config.hasServiceRoleKey ? 'Yes' : 'No'}
                  </p>
                  <p className="mt-1">
                    <span className="font-semibold">Host:</span>{' '}
                    {supabaseDiagResult.config.urlHost || 'Missing'}
                    {' · '}
                    <span className="font-semibold">Project:</span>{' '}
                    {supabaseDiagResult.config.projectRef || 'Missing'}
                    {' · '}
                    <span className="font-semibold">Key:</span> {supabaseDiagResult.config.keyHint || 'Missing'}
                  </p>
                  <p className="mt-1">
                    <span className="font-semibold">DB reachability:</span>{' '}
                    {supabaseDiagResult.probe.reachable ? 'Reachable' : 'Not reachable'}
                    {' · '}
                    <span className="font-semibold">estimate_sessions table:</span>{' '}
                    {supabaseDiagResult.probe.estimateSessionsTableExists === undefined
                      ? 'Unknown'
                      : supabaseDiagResult.probe.estimateSessionsTableExists
                        ? 'Present'
                        : 'Missing'}
                  </p>
                  {supabaseDiagResult.probe.sampleError && (
                    <p className="mt-1">
                      <span className="font-semibold">Sample error:</span> {supabaseDiagResult.probe.sampleError}
                    </p>
                  )}
                  {supabaseDiagResult.remediationHint && (
                    <p className="mt-1">
                      <span className="font-semibold">Hint:</span> {supabaseDiagResult.remediationHint}
                    </p>
                  )}
                  {supabaseDiagResult.projectHealthUrl && (
                    <p className="mt-1">
                      <a
                        href={supabaseDiagResult.projectHealthUrl}
                        className="font-semibold text-blue-700 underline underline-offset-4 hover:text-blue-800"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open Supabase project health page
                      </a>
                    </p>
                  )}
                  {supabaseDiagResult.errorCategory === 'cloudflare_error' && (
                    <p className="mt-1">
                      Cloudflare response code detected:
                      {' '}
                      {supabaseDiagResult.errorCode ? `${supabaseDiagResult.errorCode}` : 'unknown'}
                    </p>
                  )}
                </div>
              )}

              {conversationError && (
                <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{conversationError}</p>
              )}
              {conversationMessage && (
                <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  {conversationMessage}
                </p>
              )}
              {conversationStorageMode === 'memory_fallback' && (
                <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Logs are currently using memory fallback, not database persistence.
                  {' '}
                  {supabaseDiagResult
                    ? supabaseDiagResult.remediationHint ||
                      (supabaseDiagResult.config.hasUrl && supabaseDiagResult.config.hasServiceRoleKey
                        ? 'Supabase env vars are present, so the issue is likely missing tables/columns. Run Supabase Diagnostics and apply the SQL migrations shown there.'
                        : 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel, then redeploy.')
                    : 'Run Supabase Diagnostics below to see whether env vars are missing or migrations are incomplete.'}
                </p>
              )}

              <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
                <div className="max-h-[600px] overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2">
                  {conversationSummaries.length === 0 && !conversationLoading && (
                    <p className="px-2 py-3 text-sm text-gray-600">No saved conversation sessions found.</p>
                  )}

                  <div className="space-y-2">
                    {conversationSummaries.map((item) => (
                      <div
                        key={item.session_id}
                        className={`rounded-lg border px-3 py-2 transition ${
                          selectedConversationId === item.session_id
                            ? 'border-blue-300 bg-blue-50'
                            : 'border-gray-200 bg-white hover:bg-gray-100'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => void loadConversationDetail(item.session_id)}
                          className="w-full text-left"
                        >
                          <p className="truncate text-sm font-semibold text-gray-900">{item.session_id}</p>
                          <p className="mt-1 text-xs text-gray-600">
                            {item.turn_count} turns · {item.channels.join(', ') || 'unknown channel'}
                          </p>
                          <p className="mt-1 text-xs text-gray-700">
                            Review status: <span className="font-semibold">{item.review_status}</span>
                          </p>
                          <p className="mt-1 text-xs text-gray-500">
                            Updated {new Date(item.updated_at).toLocaleString()}
                          </p>
                          {item.review_notes && <p className="mt-1 text-xs text-gray-600">{item.review_notes}</p>}
                          {item.preview && <p className="mt-2 line-clamp-2 text-xs text-gray-700">{item.preview}</p>}
                        </button>
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() => void deleteConversation(item.session_id)}
                            className="inline-flex items-center rounded border border-red-200 px-2 py-1 text-xs text-red-700 transition hover:bg-red-50"
                          >
                            <Trash2 className="mr-1 h-3 w-3" />
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-4">
                  {!selectedConversation && !conversationDetailLoading && (
                    <p className="text-sm text-gray-600">Select a session to view full transcript details.</p>
                  )}

                  {conversationDetailLoading && (
                    <p className="text-sm text-gray-600">Loading conversation detail...</p>
                  )}

                  {selectedConversation && !conversationDetailLoading && (
                    <>
                      <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                        <p><span className="font-semibold">Session:</span> {selectedConversation.session_id}</p>
                        <p><span className="font-semibold">Created:</span> {new Date(selectedConversation.created_at).toLocaleString()}</p>
                        <p><span className="font-semibold">Updated:</span> {new Date(selectedConversation.updated_at).toLocaleString()}</p>
                        <p><span className="font-semibold">Last Question Key:</span> {selectedConversation.last_question_key || 'none'}</p>
                        <p>
                          <span className="font-semibold">Channels:</span> {selectedConversation.transcript.length === 0
                            ? 'No turns yet'
                            : Array.from(new Set(selectedConversation.transcript.map((turn) => turn.channel)))
                              .filter(Boolean)
                              .join(', ') || 'unknown'}
                        </p>
                        <div className="mt-4 border-t border-gray-200 pt-3">
                          <p className="font-semibold">Estimate Flow (asked order)</p>
                          {conversationFlow.length === 0 ? (
                            <p className="mt-1 text-xs text-gray-500">No estimate flow captured yet.</p>
                          ) : (
                            <ol className="mt-2 space-y-2">
                              {conversationFlow.map((entry) => (
                                <li key={`${selectedConversation.session_id}-${entry.key}`} className="rounded-md border border-gray-200 bg-slate-50 px-3 py-2 text-xs">
                                  <span className="font-semibold">{entry.label}:</span>{' '}
                                  <span className={entry.answered ? 'text-gray-800' : 'text-amber-700'}>
                                    {entry.value}
                                  </span>
                                </li>
                              ))}
                            </ol>
                          )}
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <label className="block">
                            <span className="mb-1 block text-sm font-medium text-gray-700">Review status</span>
                            <select
                              value={reviewStatusDraft}
                              onChange={(event) =>
                                setReviewStatusDraft(event.target.value as ConversationReviewStatus)
                              }
                              className="w-full rounded-lg border border-gray-300 px-3 py-2"
                            >
                              <option value="unprocessed">unprocessed</option>
                              <option value="processed">processed</option>
                              <option value="ready">ready</option>
                            </select>
                          </label>
                          <div>
                            <span className="mb-1 block text-sm font-medium text-gray-700">Current notes</span>
                            <p className="rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-700">
                              {selectedConversation.review_notes || 'No notes yet.'}
                            </p>
                          </div>
                        </div>
                        <label className="mt-3 block">
                          <span className="mb-1 block text-sm font-medium text-gray-700">Edit review notes</span>
                          <textarea
                            value={reviewNotesDraft}
                            onChange={(event) => setReviewNotesDraft(event.target.value)}
                            rows={4}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => void saveConversationReviewState()}
                          className="mt-3 inline-flex rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                        >
                          Save Review Notes
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteConversation(selectedConversation.session_id)}
                          className="mt-3 ml-2 inline-flex rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50"
                        >
                          Delete Conversation
                        </button>
                      </div>

                      <div className="max-h-[500px] space-y-2 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3">
                        {selectedConversation.transcript.length === 0 && (
                          <p className="text-sm text-gray-600">No transcript turns in this session.</p>
                        )}

                            {selectedConversation.transcript.map((turn, index) => {
                          const turnKey = getConversationTurnKey(index, turn);
                          const showReasoning = turn.role === 'assistant' && Boolean(turn.reasoning?.trim());
                          const isExpanded = expandedReasoningTurns.has(turnKey);
                          const reasoningLines = showReasoning ? (turn.reasoning ?? '').split('\n').map((line) => line.trim()).filter(Boolean) : [];

                          return (
                            <div
                              key={turnKey}
                              className={`rounded-lg border px-3 py-2 text-sm ${
                                turn.role === 'user'
                                  ? 'border-cyan-200 bg-cyan-50'
                                  : turn.role === 'assistant'
                                    ? 'border-emerald-200 bg-emerald-50'
                                    : 'border-amber-200 bg-amber-50'
                              } ${showReasoning ? 'cursor-pointer' : ''}`}
                              role={showReasoning ? 'button' : undefined}
                              tabIndex={showReasoning ? 0 : -1}
                              onClick={() => {
                                if (showReasoning) {
                                  toggleReasoning(turnKey);
                                }
                              }}
                              onKeyDown={(event) => {
                                if (!showReasoning) {
                                  return;
                                }
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  toggleReasoning(turnKey);
                                }
                              }}
                            >
                              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-600">
                                {turn.role} · {turn.channel} · {new Date(turn.at).toLocaleString()}
                                {showReasoning ? ' · Click to view breakdown' : ''}
                              </p>
                              <p className="whitespace-pre-wrap text-gray-800">{turn.content}</p>
                              {showReasoning && (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleReasoning(turnKey);
                                  }}
                                  className="mt-1 inline-flex text-xs text-emerald-700 underline underline-offset-2"
                                >
                                  {isExpanded ? 'Hide how it reasoned' : 'Show how it reasoned'}
                                </button>
                              )}
                              {isExpanded && showReasoning && (
                                <div className="mt-2 rounded bg-white p-2 text-xs text-gray-700 border border-emerald-200">
                                  <p className="mb-1 font-semibold">How the agent reasoned</p>
                                  <ul className="list-disc space-y-1 pl-5">
                                    {reasoningLines.length > 0 ? (
                                      reasoningLines.map((line, lineIndex) => <li key={`${turnKey}-reason-${lineIndex}`}>{line}</li>)
                                    ) : (
                                      <li>No reasoning steps were captured for this message.</li>
                                    )}
                                  </ul>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </section>
            )}
          </>
        )}
        {activeTab === 'download' && (
          <section className={`${cardClass} mt-6`}>
            <h2 className="text-xl font-bold text-gray-900">Download Site Backup</h2>
            <p className="mt-2 text-sm text-gray-600">
              Create a ZIP of your site files and a database snapshot for local archival.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void downloadSiteArchive()}
                disabled={downloadLoading}
                className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="mr-2 h-4 w-4" />
                {downloadLoading ? 'Preparing Download...' : 'Generate Download'}
              </button>
            </div>
            {downloadMessage && (
              <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{downloadMessage}</p>
            )}
            {downloadError && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{downloadError}</p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
