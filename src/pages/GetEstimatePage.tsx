import { useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type SetStateAction } from 'react';
import {
  AlertTriangle,
  Building2,
  Calculator,
  CheckCircle2,
  ClipboardCheck,
  Hammer,
  Home,
  Mail,
  Timer,
} from 'lucide-react';
import {
  createDefaultCarpetInput,
  createDefaultCommercialWindowInput,
  createDefaultPostConstructionInput,
  createDefaultWindowInput,
  detectZoneFromPostalCode,
  formatBookingMode,
  formatConfidence,
  formatCurrency,
  formatServiceLabel,
  type CarpetEstimateInput,
  type CommercialWindowEstimateInput,
  type EstimateRecord,
  type EstimateResult,
  type LeadContact,
  type PostConstructionEstimateInput,
  type SchedulePreference,
  type ServiceType,
  type WindowEstimateInput,
  type WindowZone,
} from '../lib/estimateEngine';
import type { EstimateDeliveryMode } from '../lib/estimateMailer';

type FieldErrors = Record<string, string>;

function tid(...parts: string[]): string {
  return ['estimate', ...parts].join('__');
}

const IDEMPOTENCY_KEY_STORAGE = 'steamzone_estimate_idempotency_key';
const IDEMPOTENCY_FINGERPRINT_STORAGE = 'steamzone_estimate_idempotency_fingerprint';

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function submissionFingerprint(serviceType: ServiceType, answers: unknown): string {
  try {
    return `${serviceType}:${JSON.stringify(answers)}`;
  } catch {
    // If something is non-serializable, fall back to a nonce so we don't accidentally reuse a key.
    return `${serviceType}:${Date.now()}`;
  }
}

function clearSubmissionIdempotency(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(IDEMPOTENCY_KEY_STORAGE);
  sessionStorage.removeItem(IDEMPOTENCY_FINGERPRINT_STORAGE);
}

function idempotencyKeyForSubmission(serviceType: ServiceType, answers: unknown): string {
  if (typeof window === 'undefined') return generateIdempotencyKey();

  const fingerprint = submissionFingerprint(serviceType, answers);
  const storedFingerprint = sessionStorage.getItem(IDEMPOTENCY_FINGERPRINT_STORAGE);
  const storedKey = sessionStorage.getItem(IDEMPOTENCY_KEY_STORAGE);

  if (storedFingerprint === fingerprint && storedKey) {
    return storedKey;
  }

  const nextKey = generateIdempotencyKey();
  sessionStorage.setItem(IDEMPOTENCY_FINGERPRINT_STORAGE, fingerprint);
  sessionStorage.setItem(IDEMPOTENCY_KEY_STORAGE, nextKey);
  return nextKey;
}

const fieldClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200';

const zoneOptions: Array<{ value: WindowZone; label: string }> = [
  { value: 'zoneA', label: 'Zone A - Steinbach + 15km' },
  { value: 'zoneB', label: 'Zone B - 15km to 35km' },
  { value: 'zoneC', label: 'Zone C - Winnipeg trips' },
  { value: 'zoneD', label: 'Zone D - Extended rural' },
];

const stepLabels: Record<ServiceType, string[]> = {
  window: ['Property', 'Home Size', 'Scope', 'Complexity', 'Contact'],
  commercialWindow: ['Property', 'Glass Size', 'Frequency', 'Access', 'Contact'],
  carpet: ['Area Type', 'Quantity', 'Condition', 'Add-ons', 'Contact'],
  postConstruction: ['Project Type', 'Size', 'Stage', 'Add-ons', 'Contact'],
};

const postalCodeRegex = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;

function confidenceClasses(confidence: EstimateResult['confidence']): string {
  if (confidence === 'green') {
    return 'border-emerald-200 bg-emerald-100 text-emerald-700';
  }

  if (confidence === 'yellow') {
    return 'border-amber-200 bg-amber-100 text-amber-700';
  }

  return 'border-rose-200 bg-rose-100 text-rose-700';
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validatePostalCode(postalCode: string): string | undefined {
  const value = postalCode.trim();
  if (!value) {
    return 'Postal code is required.';
  }

  if (!postalCodeRegex.test(value)) {
    return 'Enter a valid Canadian postal code (example: R5G 2X3).';
  }

  return undefined;
}

function validateContact(contact: LeadContact): FieldErrors {
  const errors: FieldErrors = {};

  if (contact.fullName.trim().length < 2) {
    errors['contact.fullName'] = 'Full name is required.';
  }

  if (contact.phone.replace(/\D/g, '').length < 7) {
    errors['contact.phone'] = 'Phone number is required.';
  }

  if (!emailRegex.test(contact.email.trim())) {
    errors['contact.email'] = 'Enter a valid email address.';
  }

  if (!contact.consentToContact) {
    errors['contact.consentToContact'] = 'Consent is required before submitting.';
  }

  return errors;
}

function validateWizardStep(
  serviceType: ServiceType,
  step: number,
  windowInput: WindowEstimateInput,
  commercialInput: CommercialWindowEstimateInput,
  carpetInput: CarpetEstimateInput,
  postInput: PostConstructionEstimateInput
): FieldErrors {
  if (serviceType === 'window') {
    if (step === 1) {
      const postalError = validatePostalCode(windowInput.postalCode);
      return postalError ? { postalCode: postalError } : {};
    }

    if (step === 4) {
      const errors: FieldErrors = {};

      if (windowInput.slidingRemoval !== 'none' && windowInput.slidingQuantity < 1) {
        errors.slidingQuantity = 'Set sliding quantity to at least 1.';
      }

      if (windowInput.patioDoors !== 'none' && windowInput.patioQuantity < 1) {
        errors.patioQuantity = 'Set patio quantity to at least 1.';
      }

      if (windowInput.skylights !== 'none' && windowInput.skylightQuantity < 1) {
        errors.skylightQuantity = 'Set skylight quantity to at least 1.';
      }

      return errors;
    }

    if (step === 5) {
      return validateContact(windowInput.contact);
    }

    return {};
  }

  if (serviceType === 'commercialWindow') {
    if (step === 1) {
      const postalError = validatePostalCode(commercialInput.postalCode);
      return postalError ? { postalCode: postalError } : {};
    }

    if (step === 2) {
      if (commercialInput.sizeMode === 'paneCount' && commercialInput.paneCount < 1) {
        return { paneCount: 'Pane count must be at least 1.' };
      }

      if (commercialInput.sizeMode === 'frontage' && commercialInput.frontageFeet < 1) {
        return { frontageFeet: 'Frontage must be at least 1 foot.' };
      }
    }

    if (step === 5) {
      return validateContact(commercialInput.contact);
    }

    return {};
  }

  if (serviceType === 'carpet') {
    if (step === 1) {
      const postalError = validatePostalCode(carpetInput.postalCode);
      return postalError ? { postalCode: postalError } : {};
    }

    if (step === 2 && carpetInput.estimateMode === 'rooms' && carpetInput.rooms < 2) {
      return { rooms: 'Room count must be at least 2.' };
    }

    if (step === 5) {
      return validateContact(carpetInput.contact);
    }

    return {};
  }

  if (step === 1) {
    const postalError = validatePostalCode(postInput.postalCode);
    return postalError ? { postalCode: postalError } : {};
  }

  if (step === 2 && postInput.floors < 1) {
    return { floors: 'Floors / levels must be at least 1.' };
  }

  if (step === 5) {
    return validateContact(postInput.contact);
  }

  return {};
}

export default function GetEstimatePage() {
  const [serviceType, setServiceType] = useState<ServiceType>('window');
  const [step, setStep] = useState(1);
  const wizardRef = useRef<HTMLElement | null>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const [windowInput, setWindowInput] = useState<WindowEstimateInput>(() => createDefaultWindowInput());
  const [commercialInput, setCommercialInput] = useState<CommercialWindowEstimateInput>(() => createDefaultCommercialWindowInput());
  const [carpetInput, setCarpetInput] = useState<CarpetEstimateInput>(() => createDefaultCarpetInput());
  const [postInput, setPostInput] = useState<PostConstructionEstimateInput>(() => createDefaultPostConstructionInput());

  const [result, setResult] = useState<EstimateResult | null>(null);
  const [latestRecord, setLatestRecord] = useState<EstimateRecord | null>(null);
  const [emailDeliveryMode, setEmailDeliveryMode] = useState<EstimateDeliveryMode | null>(null);
  const [lastIdempotencyKey, setLastIdempotencyKey] = useState<string | null>(null);
  const [lastEmailResult, setLastEmailResult] = useState<{ success: boolean; message: string; deliveryMode?: EstimateDeliveryMode; idempotent?: boolean; resent?: boolean } | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const labels = useMemo(() => stepLabels[serviceType], [serviceType]);
  const totalSteps = labels.length;
  const stepErrors = useMemo(
    () => validateWizardStep(serviceType, step, windowInput, commercialInput, carpetInput, postInput),
    [serviceType, step, windowInput, commercialInput, carpetInput, postInput]
  );
  const canProceed = Object.keys(stepErrors).length === 0;
  const visibleStepErrors = stepErrors;

  useEffect(() => {
    // Deterministic focus target on step/service change helps keyboard UX and reduces E2E flake.
    stepHeadingRef.current?.focus();
  }, [serviceType, step]);

  function focusFirstInvalid(): void {
    const root = wizardRef.current;
    if (!root) {
      return;
    }

    const invalid = root.querySelector<HTMLElement>('[aria-invalid="true"]');
    invalid?.focus();
  }

  function switchService(nextService: ServiceType): void {
    setServiceType(nextService);
    setStep(1);
    setResult(null);
    setLatestRecord(null);
    setEmailDeliveryMode(null);
    setLastIdempotencyKey(null);
    setLastEmailResult(null);
    setStatusMessage('');
    clearSubmissionIdempotency();
  }

  function stepForward(): void {
    if (!canProceed) {
      // If user tries to continue with errors, move focus to the first invalid field.
      queueMicrotask(() => focusFirstInvalid());
      return;
    }

    if (import.meta.env.DEV) {
      console.debug('[estimate-wizard] continue', {
        serviceType,
        step,
        stepErrors,
      });
    }

    setStatusMessage('');
    setStep((previous) => Math.min(totalSteps, previous + 1));
  }

  function stepBack(): void {
    setStatusMessage('');
    setStep((previous) => Math.max(1, previous - 1));
  }

  function onWizardKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    if (event.key !== 'Enter') {
      return;
    }

    // On non-final steps, prevent Enter from causing implicit navigation/submit.
    if (step >= totalSteps) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    if (target instanceof HTMLInputElement) {
      const type = target.type;
      if (type === 'checkbox' || type === 'radio' || type === 'button' || type === 'submit') {
        return;
      }
    }

    // Allow normal select/option interactions.
    if (target instanceof HTMLSelectElement) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  }

  function updateWindowPostal(postalCode: string): void {
    setWindowInput((previous) => ({
      ...previous,
      postalCode,
      zone: postalCode.trim().length >= 3 ? detectZoneFromPostalCode(postalCode) : previous.zone,
    }));
  }

  function updateCommercialPostal(postalCode: string): void {
    setCommercialInput((previous) => ({
      ...previous,
      postalCode,
      zone: postalCode.trim().length >= 3 ? detectZoneFromPostalCode(postalCode) : previous.zone,
    }));
  }

  function updateCarpetPostal(postalCode: string): void {
    setCarpetInput((previous) => ({
      ...previous,
      postalCode,
      zone: postalCode.trim().length >= 3 ? detectZoneFromPostalCode(postalCode) : previous.zone,
    }));
  }

  function updatePostPostal(postalCode: string): void {
    setPostInput((previous) => ({
      ...previous,
      postalCode,
      zone: postalCode.trim().length >= 3 ? detectZoneFromPostalCode(postalCode) : previous.zone,
    }));
  }

  function currentAnswers():
    | WindowEstimateInput
    | CommercialWindowEstimateInput
    | CarpetEstimateInput
    | PostConstructionEstimateInput {
    if (serviceType === 'window') {
      return windowInput;
    }

    if (serviceType === 'commercialWindow') {
      return commercialInput;
    }

    if (serviceType === 'carpet') {
      return carpetInput;
    }

    return postInput;
  }

  async function calculateCurrentEstimate(): Promise<void> {
    if (!canProceed) {
      return;
    }

    setIsSubmitting(true);
    setStatusMessage('Generating your estimate and preparing email delivery...');

    const answers = currentAnswers();
    try {
      const idempotencyKey = idempotencyKeyForSubmission(serviceType, answers);
      setLastIdempotencyKey(idempotencyKey);

      const response = await fetch('/api/estimate-create', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({ serviceType, answers }),
      });

      const payload = (await response.json()) as {
        record?: EstimateRecord;
        email?: { success: boolean; message: string; deliveryMode?: EstimateDeliveryMode; idempotent?: boolean; resent?: boolean };
        message?: string;
      };

      if (!response.ok || !payload.record) {
        setEmailDeliveryMode(null);
        setLastEmailResult(null);
        setStatusMessage(payload.message ?? 'Unable to generate estimate. Please try again.');
        setIsSubmitting(false);
        return;
      }

      setLatestRecord(payload.record);
      setResult(payload.record.result);
      setLastEmailResult(payload.email ?? null);

      if (payload.email?.success) {
        setEmailDeliveryMode(payload.email.deliveryMode ?? 'customer');

        if (payload.email.idempotent) {
          setStatusMessage(`Quote ${payload.record.quoteNumber} already generated. Duplicate submission was prevented (no extra email sent).`);
          setIsSubmitting(false);
          return;
        }

        if (payload.email.deliveryMode === 'internal') {
          setStatusMessage(`Quote ${payload.record.quoteNumber} generated. Estimate details were sent to Steam Zone for live follow-up.`);
        } else {
          setStatusMessage(`Quote ${payload.record.quoteNumber} generated. Your estimate PDF was emailed instantly to ${payload.record.contact.email}.`);
        }
      } else {
        setEmailDeliveryMode(null);
        setStatusMessage(
          `Quote ${payload.record.quoteNumber} generated, but email delivery needs setup: ${
            payload.email?.message ??
            'Email delivery endpoint is not fully configured yet. Add RESEND_API_KEY and sender env vars in Vercel.'
          }`
        );
      }
    } catch {
      setEmailDeliveryMode(null);
      setLastEmailResult(null);
      setStatusMessage('Unable to reach the estimate engine. Please try again later.');
    }

    setIsSubmitting(false);
  }

  async function resendLatestEmail(): Promise<void> {
    if (!latestRecord || !lastIdempotencyKey) {
      return;
    }

    setIsSubmitting(true);
    setStatusMessage('Re-sending your estimate email...');

    const answers = currentAnswers();
    try {
      const response = await fetch('/api/estimate-create', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-idempotency-key': lastIdempotencyKey,
          'x-idempotency-resend': '1',
        },
        body: JSON.stringify({ serviceType, answers }),
      });

      const payload = (await response.json()) as {
        record?: EstimateRecord;
        email?: { success: boolean; message: string; deliveryMode?: EstimateDeliveryMode; idempotent?: boolean; resent?: boolean };
        message?: string;
      };

      if (!response.ok || !payload.record) {
        setStatusMessage(payload.message ?? 'Unable to resend the email. Please try again.');
        setIsSubmitting(false);
        return;
      }

      setLatestRecord(payload.record);
      setResult(payload.record.result);
      setLastEmailResult(payload.email ?? null);

      if (payload.email?.success) {
        setEmailDeliveryMode(payload.email.deliveryMode ?? 'customer');
        setStatusMessage(`Quote ${payload.record.quoteNumber} emailed successfully.`);
      } else {
        setEmailDeliveryMode(null);
        setStatusMessage(`Quote ${payload.record.quoteNumber} generated, but email could not be delivered: ${payload.email?.message ?? 'Unknown error.'}`);
      }
    } catch {
      setStatusMessage('Unable to reach the estimate engine. Please try again later.');
    }

    setIsSubmitting(false);
  }

  return (
    <main className="bg-gradient-to-br from-slate-50 via-blue-50 to-white pb-20 pt-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-10 text-center">
          <h1 className="text-4xl font-bold text-gray-900 md:text-5xl">Steinbach Instant Estimate</h1>
          <p className="mx-auto mt-4 max-w-3xl text-lg text-gray-600">
            Choose your service, answer a short guided wizard, and receive a live estimate range. Your submission is sent
            instantly for follow-up.
          </p>
        </div>

        <fieldset className="mb-8" data-testid={tid('service_selector')}>
          <legend className="sr-only">Choose a service</legend>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <ServiceRadioTile
              disabled={step !== 1 || isSubmitting}
              active={serviceType === 'window'}
              title="Residential Windows"
              description="Pane-based residential pricing with home-size shortcuts and complexity add-ons."
              icon={<Home className="h-6 w-6" />}
              value="window"
              onChange={switchService}
              testId={tid('service', 'window')}
            />
            <ServiceRadioTile
              disabled={step !== 1 || isSubmitting}
              active={serviceType === 'commercialWindow'}
              title="Commercial Windows"
              description="Storefront and low-rise instant ranges with recurring-frequency pricing."
              icon={<Building2 className="h-6 w-6" />}
              value="commercialWindow"
              onChange={switchService}
              testId={tid('service', 'commercialWindow')}
            />
            <ServiceRadioTile
              disabled={step !== 1 || isSubmitting}
              active={serviceType === 'carpet'}
              title="Carpet Cleaning"
              description="Room or square-foot flow with stairs, hallways, and treatment options."
              icon={<ClipboardCheck className="h-6 w-6" />}
              value="carpet"
              onChange={switchService}
              testId={tid('service', 'carpet')}
            />
            <ServiceRadioTile
              disabled={step !== 1 || isSubmitting}
              active={serviceType === 'postConstruction'}
              title="Post-Construction"
              description="Stage + dust-load based estimate with add-ons for detail-level finishing."
              icon={<Hammer className="h-6 w-6" />}
              value="postConstruction"
              onChange={switchService}
              testId={tid('service', 'postConstruction')}
            />
          </div>
          {step !== 1 && (
            <p className="mt-3 text-sm text-gray-500">
              Service selection is locked after Step 1. Use Back to return to Step 1 if you need to change services.
            </p>
          )}
        </fieldset>

        <section
          ref={(node) => {
            wizardRef.current = node;
          }}
          onKeyDown={onWizardKeyDown}
          data-testid={tid('wizard')}
          className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xl md:p-8"
        >
          <div className="mb-8">
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">{formatServiceLabel(serviceType)}</p>
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              data-testid={tid('step_heading')}
              className="mt-2 text-2xl font-bold text-gray-900"
            >
              Step {step} of {totalSteps}
            </h2>
            <div className="mt-4 grid gap-2 md:grid-cols-5">
              {labels.map((label, index) => {
                const stepNumber = index + 1;
                const active = stepNumber === step;
                const complete = stepNumber < step;

                return (
                  <div
                    key={label}
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      active
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : complete
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                          : 'border-gray-200 bg-gray-50 text-gray-500'
                    }`}
                  >
                    <div className="font-semibold">{stepNumber}. {label}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {step === totalSteps ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void calculateCurrentEstimate();
              }}
            >
              {serviceType === 'window' && (
                <WindowForm
                  step={step}
                  input={windowInput}
                  onInputChange={setWindowInput}
                  onPostalChange={updateWindowPostal}
                  errors={visibleStepErrors}
                />
              )}

              {serviceType === 'commercialWindow' && (
                <CommercialWindowForm
                  step={step}
                  input={commercialInput}
                  onInputChange={setCommercialInput}
                  onPostalChange={updateCommercialPostal}
                  errors={visibleStepErrors}
                />
              )}

              {serviceType === 'carpet' && (
                <CarpetForm
                  step={step}
                  input={carpetInput}
                  onInputChange={setCarpetInput}
                  onPostalChange={updateCarpetPostal}
                  errors={visibleStepErrors}
                />
              )}

              {serviceType === 'postConstruction' && (
                <PostConstructionForm
                  step={step}
                  input={postInput}
                  onInputChange={setPostInput}
                  onPostalChange={updatePostPostal}
                  errors={visibleStepErrors}
                />
              )}

              <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-6">
                <button
                  type="button"
                  onClick={stepBack}
                  disabled={step === 1 || isSubmitting}
                  className="rounded-lg border border-gray-300 px-5 py-2.5 font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid={tid('back')}
                >
                  Back
                </button>

                <button
                  type="submit"
                  disabled={isSubmitting || !canProceed}
                  className="inline-flex items-center rounded-lg bg-emerald-600 px-6 py-2.5 font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                  data-testid={tid('contact', 'submit')}
                >
                  <Calculator className="mr-2 h-4 w-4" />
                  {isSubmitting ? 'Sending...' : 'Generate + Send Estimate'}
                </button>
              </div>
            </form>
          ) : (
            <>
              {serviceType === 'window' && (
                <WindowForm
                  step={step}
                  input={windowInput}
                  onInputChange={setWindowInput}
                  onPostalChange={updateWindowPostal}
                  errors={visibleStepErrors}
                />
              )}

              {serviceType === 'commercialWindow' && (
                <CommercialWindowForm
                  step={step}
                  input={commercialInput}
                  onInputChange={setCommercialInput}
                  onPostalChange={updateCommercialPostal}
                  errors={visibleStepErrors}
                />
              )}

              {serviceType === 'carpet' && (
                <CarpetForm
                  step={step}
                  input={carpetInput}
                  onInputChange={setCarpetInput}
                  onPostalChange={updateCarpetPostal}
                  errors={visibleStepErrors}
                />
              )}

              {serviceType === 'postConstruction' && (
                <PostConstructionForm
                  step={step}
                  input={postInput}
                  onInputChange={setPostInput}
                  onPostalChange={updatePostPostal}
                  errors={visibleStepErrors}
                />
              )}

              <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-6">
            <button
              type="button"
              onClick={stepBack}
              disabled={step === 1 || isSubmitting}
              className="rounded-lg border border-gray-300 px-5 py-2.5 font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid={tid('back')}
            >
              Back
            </button>

            {step < totalSteps ? (
              <button
                type="button"
                onClick={stepForward}
                disabled={isSubmitting || !canProceed}
                className="rounded-lg bg-blue-600 px-6 py-2.5 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                data-testid={tid('continue')}
              >
                Continue
              </button>
            ) : null}
              </div>
            </>
          )}

          {statusMessage && (
            <p className="mt-4 text-sm text-blue-700" data-testid={tid('status_message')}>
              {statusMessage}
            </p>
          )}
          {import.meta.env.DEV && (
            <details
              className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700"
              data-testid={tid('debug_panel')}
            >
              <summary className="cursor-pointer font-semibold">Wizard debug</summary>
              <pre className="mt-2 whitespace-pre-wrap">
                {JSON.stringify({ serviceType, step, canProceed, stepErrors }, null, 2)}
              </pre>
            </details>
          )}
        </section>

        {result && (
          <section className="mt-8 rounded-2xl border border-blue-200 bg-white p-6 shadow-lg md:p-8" data-testid={tid('confirmation')}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-2xl font-bold text-gray-900">Estimate Results</h3>
              {latestRecord && (
                <div
                  className="rounded-full border border-blue-200 bg-blue-50 px-4 py-1 text-sm font-semibold text-blue-700"
                  data-testid={tid('confirmation', 'quoteId')}
                >
                  Quote: {latestRecord.quoteNumber}
                </div>
              )}
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              <div className="rounded-xl bg-blue-50 p-5">
                <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Estimate range</p>
                <p className="mt-2 text-3xl font-bold text-blue-900" data-testid={tid('confirmation', 'range')}>
                  {formatCurrency(result.estimateLow)} - {formatCurrency(result.estimateHigh)}
                </p>
                <p className="mt-2 text-sm text-blue-700">Base subtotal: {formatCurrency(result.subtotal)}</p>
              </div>

              <div className="rounded-xl bg-gray-50 p-5">
                <p className="text-sm font-semibold uppercase tracking-wide text-gray-600">Estimated duration</p>
                <p className="mt-2 flex items-center text-2xl font-bold text-gray-900">
                  <Timer className="mr-2 h-5 w-5 text-blue-600" />
                  {result.durationLowHours} - {result.durationHighHours} hours
                </p>
                {result.estimatedSqft > 0 && (
                  <p className="mt-2 text-sm text-gray-600">Estimated size: {result.estimatedSqft.toLocaleString()} sq ft</p>
                )}
              </div>

              <div className="rounded-xl bg-gray-50 p-5">
                <p className="text-sm font-semibold uppercase tracking-wide text-gray-600">Confidence + next step</p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${confidenceClasses(result.confidence)}`}>
                    {formatConfidence(result.confidence)}
                  </span>
                  <span className="text-xs text-gray-500">Score: {result.complexityScore}</span>
                </div>
                <p className="mt-3 text-sm text-gray-700">{formatBookingMode(result.bookingMode)}</p>
              </div>
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">What's included</h3>
                <ul className="mt-3 space-y-2">
                  {result.includedItems.map((item) => (
                    <li key={item} className="flex items-start text-gray-700">
                      <CheckCircle2 className="mr-2 mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-gray-900">Important notes</h3>
                <ul className="mt-3 space-y-2">
                  {result.notes.map((note) => (
                    <li key={note} className="flex items-start text-gray-700">
                      <AlertTriangle className="mr-2 mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                      {note}
                    </li>
                  ))}
                </ul>

                {result.redFlags.length > 0 && (
                  <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4">
                    <p className="font-semibold text-rose-800">Quote confirmation required</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-700">
                      {result.redFlags.map((flag) => (
                        <li key={flag}>{flag}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <a href="tel:7828217802" className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700">
                Call to Book
              </a>
              <a
                href="/#contact"
                className="rounded-lg border border-gray-300 px-6 py-3 font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Request Callback
              </a>
              {emailDeliveryMode === null && latestRecord && lastEmailResult && !lastEmailResult.success && (
                <button
                  type="button"
                  onClick={resendLatestEmail}
                  disabled={isSubmitting}
                  className="rounded-lg border border-blue-200 bg-blue-50 px-6 py-3 font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid={tid('resend_email')}
                >
                  Try Sending Email Again
                </button>
              )}
              {emailDeliveryMode === 'customer' && latestRecord?.contact.email && (
                <div className="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  <Mail className="mr-2 h-4 w-4" />
                  PDF quote sent to {latestRecord.contact.email}
                </div>
              )}
              {emailDeliveryMode === 'internal' && (
                <div className="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  <Mail className="mr-2 h-4 w-4" />
                  Estimate sent to Steam Zone inbox for follow-up
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function ServiceRadioTile({
  disabled,
  active,
  title,
  description,
  icon,
  value,
  onChange,
  testId,
}: {
  disabled: boolean;
  active: boolean;
  title: string;
  description: string;
  icon: JSX.Element;
  value: ServiceType;
  onChange: (service: ServiceType) => void;
  testId: string;
}) {
  const id = `estimate-service-${value}`;

  return (
    <div>
      <input
        id={id}
        className="sr-only"
        type="radio"
        name="estimate-service"
        value={value}
        checked={active}
        onChange={() => onChange(value)}
        disabled={disabled}
      />
      <label
        htmlFor={id}
        data-testid={testId}
        aria-disabled={disabled ? 'true' : 'false'}
        className={`block rounded-xl border p-5 text-left transition ${
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
        } ${
          active
            ? 'border-blue-600 bg-blue-600 text-white shadow-lg'
            : 'border-gray-200 bg-white text-gray-800 hover:border-blue-300 hover:shadow-md'
        }`}
      >
        <div className="mb-3">{icon}</div>
        <div className="text-lg font-semibold">{title}</div>
        <div className={`mt-1 text-sm ${active ? 'text-blue-100' : 'text-gray-500'}`}>{description}</div>
      </label>
    </div>
  );
}

interface WindowFormProps {
  step: number;
  input: WindowEstimateInput;
  onInputChange: Dispatch<SetStateAction<WindowEstimateInput>>;
  onPostalChange: (postalCode: string) => void;
  errors: FieldErrors;
}

function WindowForm({ step, input, onInputChange, onPostalChange, errors }: WindowFormProps) {
  if (step === 1) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <InputPostalZone
          section="window"
          serviceKey="window"
          postalCode={input.postalCode}
          zone={input.zone}
          onPostalChange={onPostalChange}
          onZoneChange={(zone) => onInputChange((previous) => ({ ...previous, zone }))}
          errors={errors}
        />

        <div>
          <label htmlFor="window-storeys" className="mb-1 block text-sm font-medium text-gray-700">
            House type / storeys
          </label>
          <select
            id="window-storeys"
            name="storeys"
            data-testid={tid('window', 'step_1', 'storey')}
            value={input.storey}
            onChange={(event) => onInputChange((previous) => ({ ...previous, storey: event.target.value as WindowEstimateInput['storey'] }))}
            className={fieldClass}
          >
            <option value="bungalow">Bungalow</option>
            <option value="oneHalf">1.5 storey</option>
            <option value="two">2 storey</option>
            <option value="twoHalf">2.5 storey</option>
            <option value="three">3 storey</option>
          </select>
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="window-square-footage-bracket" className="mb-1 block text-sm font-medium text-gray-700">
            Square footage bracket
          </label>
          <select
            id="window-square-footage-bracket"
            name="squareFootageBracket"
            data-testid={tid('window', 'step_2', 'size_bracket')}
            value={input.sizeBracket}
            onChange={(event) =>
              onInputChange((previous) => ({ ...previous, sizeBracket: event.target.value as WindowEstimateInput['sizeBracket'] }))
            }
            className={fieldClass}
          >
            <option value="under1000">Under 1000 sq ft</option>
            <option value="1000to1500">1000 - 1500 sq ft</option>
            <option value="1500to2000">1500 - 2000 sq ft</option>
            <option value="2000to2500">2000 - 2500 sq ft</option>
            <option value="2500to3000">2500 - 3000 sq ft</option>
            <option value="over3000">3000+ sq ft</option>
          </select>
        </div>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="window-scope" className="mb-1 block text-sm font-medium text-gray-700">
            Scope
          </label>
          <select
            id="window-scope"
            name="scope"
            data-testid={tid('window', 'step_3', 'scope')}
            value={input.scope}
            onChange={(event) => onInputChange((previous) => ({ ...previous, scope: event.target.value as WindowEstimateInput['scope'] }))}
            className={fieldClass}
          >
            <option value="exterior">Exterior only</option>
            <option value="interior">Interior only</option>
            <option value="both">Interior + Exterior</option>
          </select>
        </div>

        <div>
          <label htmlFor="window-screens" className="mb-1 block text-sm font-medium text-gray-700">
            Screens
          </label>
          <select
            id="window-screens"
            name="screens"
            data-testid={tid('window', 'step_3', 'screens')}
            value={input.screens}
            onChange={(event) => onInputChange((previous) => ({ ...previous, screens: event.target.value as WindowEstimateInput['screens'] }))}
            className={fieldClass}
          >
            <option value="none">None</option>
            <option value="some">Some</option>
            <option value="all">All</option>
          </select>
        </div>

        <div>
          <label htmlFor="window-tracks-sills" className="mb-1 block text-sm font-medium text-gray-700">
            Tracks & sills
          </label>
          <select
            id="window-tracks-sills"
            name="tracksSills"
            data-testid={tid('window', 'step_3', 'tracks_sills')}
            value={input.tracks}
            onChange={(event) => onInputChange((previous) => ({ ...previous, tracks: event.target.value as WindowEstimateInput['tracks'] }))}
            className={fieldClass}
          >
            <option value="basic">Basic</option>
            <option value="detailed">Detailed</option>
          </select>
        </div>

        <BooleanTile
          label="Hard-to-reach windows"
          id="window-hard-to-reach"
          name="hardToReach"
          testId={tid('window', 'step_3', 'hard_to_reach')}
          checked={input.hardToReach}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, hardToReach: checked }))}
        />
        <BooleanTile
          label="Hard water removal needed"
          id="window-hard-water-removal"
          name="hardWaterRemoval"
          testId={tid('window', 'step_3', 'hard_water_removal')}
          checked={input.hardWaterRemoval}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, hardWaterRemoval: checked }))}
        />
        <BooleanTile
          label="Construction debris / paint on glass"
          id="window-construction-debris"
          name="constructionDebris"
          testId={tid('window', 'step_3', 'construction_debris')}
          checked={input.constructionDebris}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, constructionDebris: checked }))}
        />
      </div>
    );
  }

  if (step === 4) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="window-sliding-removal-type" className="mb-1 block text-sm font-medium text-gray-700">
            Sliding windows removal
          </label>
          <select
            id="window-sliding-removal-type"
            name="slidingRemovalType"
            data-testid={tid('window', 'step_4', 'sliding_removal')}
            value={input.slidingRemoval}
            onChange={(event) =>
              onInputChange((previous) => ({
                ...previous,
                slidingRemoval: event.target.value as WindowEstimateInput['slidingRemoval'],
              }))
            }
            className={fieldClass}
          >
            <option value="none">No</option>
            <option value="threePanel">3-panel</option>
            <option value="fivePanel">5-panel</option>
          </select>
        </div>

        <NumberInput
          label="Sliding quantity"
          id="window-sliding-quantity"
          name="slidingQty"
          testId={tid('window', 'step_4', 'sliding_quantity')}
          value={input.slidingQuantity}
          onChange={(value) => onInputChange((previous) => ({ ...previous, slidingQuantity: value }))}
          error={errors.slidingQuantity}
        />

        <div>
          <label htmlFor="window-patio-type" className="mb-1 block text-sm font-medium text-gray-700">
            Patio doors
          </label>
          <select
            id="window-patio-type"
            name="patioType"
            data-testid={tid('window', 'step_4', 'patio_type')}
            value={input.patioDoors}
            onChange={(event) =>
              onInputChange((previous) => ({ ...previous, patioDoors: event.target.value as WindowEstimateInput['patioDoors'] }))
            }
            className={fieldClass}
          >
            <option value="none">No patio work</option>
            <option value="takeApart">Take-apart</option>
            <option value="slideOnly">Slide-only</option>
          </select>
        </div>

        <NumberInput
          label="Patio quantity"
          id="window-patio-quantity"
          name="patioQty"
          testId={tid('window', 'step_4', 'patio_quantity')}
          value={input.patioQuantity}
          onChange={(value) => onInputChange((previous) => ({ ...previous, patioQuantity: value }))}
          error={errors.patioQuantity}
        />

        <div>
          <label htmlFor="window-skylight-type" className="mb-1 block text-sm font-medium text-gray-700">
            Skylights
          </label>
          <select
            id="window-skylight-type"
            name="skylightType"
            data-testid={tid('window', 'step_4', 'skylight_type')}
            value={input.skylights}
            onChange={(event) => onInputChange((previous) => ({ ...previous, skylights: event.target.value as WindowEstimateInput['skylights'] }))}
            className={fieldClass}
          >
            <option value="none">None</option>
            <option value="interior">Interior only</option>
            <option value="exterior">Exterior only</option>
            <option value="both">Both sides</option>
          </select>
        </div>

        <NumberInput
          label="Skylight quantity"
          id="window-skylight-quantity"
          name="skylightQty"
          testId={tid('window', 'step_4', 'skylight_quantity')}
          value={input.skylightQuantity}
          onChange={(value) => onInputChange((previous) => ({ ...previous, skylightQuantity: value }))}
          error={errors.skylightQuantity}
        />

        <div>
          <label htmlFor="window-railing-glass" className="mb-1 block text-sm font-medium text-gray-700">
            Railing glass
          </label>
          <select
            id="window-railing-glass"
            name="railingGlass"
            data-testid={tid('window', 'step_4', 'railing_glass')}
            value={input.railingGlass}
            onChange={(event) =>
              onInputChange((previous) => ({ ...previous, railingGlass: event.target.value as WindowEstimateInput['railingGlass'] }))
            }
            className={fieldClass}
          >
            <option value="none">None</option>
            <option value="oneSide">1 side</option>
            <option value="twoSides">2 sides</option>
          </select>
        </div>

        <div>
          <label htmlFor="window-french-panes" className="mb-1 block text-sm font-medium text-gray-700">
            French panes
          </label>
          <select
            id="window-french-panes"
            name="frenchPanes"
            data-testid={tid('window', 'step_4', 'french_panes')}
            value={input.frenchPanes}
            onChange={(event) =>
              onInputChange((previous) => ({ ...previous, frenchPanes: event.target.value as WindowEstimateInput['frenchPanes'] }))
            }
            className={fieldClass}
          >
            <option value="none">None</option>
            <option value="some">Some</option>
            <option value="lots">Lots</option>
          </select>
        </div>

        <BooleanTile
          label="Sunroom"
          id="window-sunroom"
          name="sunroom"
          testId={tid('window', 'step_4', 'sunroom')}
          checked={input.sunroom}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, sunroom: checked }))}
        />
        <BooleanTile
          label="Walkout basement access"
          id="window-walkout-basement"
          name="walkoutBasement"
          testId={tid('window', 'step_4', 'walkout_basement')}
          checked={input.walkoutBasement}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, walkoutBasement: checked }))}
        />
      </div>
    );
  }

  return (
    <ContactStep
      section="window"
      contact={input.contact}
      errors={errors}
      onContactChange={(field, value) =>
        onInputChange((previous) => ({
          ...previous,
          contact: {
            ...previous.contact,
            [field]: value,
          },
        }))
      }
    />
  );
}

interface CommercialWindowFormProps {
  step: number;
  input: CommercialWindowEstimateInput;
  onInputChange: Dispatch<SetStateAction<CommercialWindowEstimateInput>>;
  onPostalChange: (postalCode: string) => void;
  errors: FieldErrors;
}

function CommercialWindowForm({ step, input, onInputChange, onPostalChange, errors }: CommercialWindowFormProps) {
  if (step === 1) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <InputPostalZone
          section="commercial"
          serviceKey="commercialWindow"
          postalCode={input.postalCode}
          zone={input.zone}
          onPostalChange={onPostalChange}
          onZoneChange={(zone) => onInputChange((previous) => ({ ...previous, zone }))}
          errors={errors}
        />

        <div>
          <label htmlFor="commercial-building-type" className="mb-1 block text-sm font-medium text-gray-700">
            Building type
          </label>
          <select
            id="commercial-building-type"
            name="buildingType"
            data-testid={tid('commercialWindow', 'step_1', 'building_type')}
            value={input.buildingType}
            onChange={(event) =>
              onInputChange((previous) => ({
                ...previous,
                buildingType: event.target.value as CommercialWindowEstimateInput['buildingType'],
              }))
            }
            className={fieldClass}
          >
            <option value="storefront">Storefront (ground-floor)</option>
            <option value="lowRise">Office / low-rise (up to 3 storeys)</option>
            <option value="midRise">Mid-rise (4 - 8 storeys)</option>
            <option value="highRise">High-rise (9+ storeys)</option>
          </select>
        </div>

        <div>
          <label htmlFor="commercial-storeys" className="mb-1 block text-sm font-medium text-gray-700">
            Storeys
          </label>
          <select
            id="commercial-storeys"
            name="storeys"
            data-testid={tid('commercialWindow', 'step_1', 'storeys')}
            value={input.storeys}
            onChange={(event) =>
              onInputChange((previous) => ({ ...previous, storeys: event.target.value as CommercialWindowEstimateInput['storeys'] }))
            }
            className={fieldClass}
          >
            <option value="ground">Ground-floor</option>
            <option value="twoToThree">2 - 3 storeys</option>
            <option value="fourToEight">4 - 8 storeys</option>
            <option value="ninePlus">9+ storeys</option>
          </select>
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="commercial-size-mode" className="mb-1 block text-sm font-medium text-gray-700">
            How do you want to estimate glass size?
          </label>
          <select
            id="commercial-size-mode"
            name="sizeMode"
            data-testid={tid('commercialWindow', 'step_2', 'size_mode')}
            value={input.sizeMode}
            onChange={(event) =>
              onInputChange((previous) => ({ ...previous, sizeMode: event.target.value as CommercialWindowEstimateInput['sizeMode'] }))
            }
            className={fieldClass}
          >
            <option value="paneCount">I can count panes</option>
            <option value="frontage">Estimate by frontage length</option>
          </select>
        </div>

        {input.sizeMode === 'paneCount' ? (
          <NumberInput
            label="Pane count"
            id="commercial-pane-count"
            name="paneCount"
            testId={tid('commercialWindow', 'step_2', 'pane_count')}
            value={input.paneCount}
            onChange={(value) => onInputChange((previous) => ({ ...previous, paneCount: Math.max(1, value) }))}
            min={1}
            error={errors.paneCount}
          />
        ) : (
          <NumberInput
            label="Frontage (feet)"
            id="commercial-frontage-feet"
            name="frontageFeet"
            testId={tid('commercialWindow', 'step_2', 'frontage_feet')}
            value={input.frontageFeet}
            onChange={(value) => onInputChange((previous) => ({ ...previous, frontageFeet: Math.max(1, value) }))}
            min={1}
            error={errors.frontageFeet}
          />
        )}

        <NumberInput
          label="Glass door count"
          id="commercial-glass-door-count"
          name="glassDoorCount"
          testId={tid('commercialWindow', 'step_2', 'glass_door_count')}
          value={input.glassDoors}
          onChange={(value) => onInputChange((previous) => ({ ...previous, glassDoors: value }))}
        />
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="commercial-scope" className="mb-1 block text-sm font-medium text-gray-700">
            Cleaning scope
          </label>
          <select
            id="commercial-scope"
            name="scope"
            data-testid={tid('commercialWindow', 'step_3', 'scope')}
            value={input.scope}
            onChange={(event) => onInputChange((previous) => ({ ...previous, scope: event.target.value as CommercialWindowEstimateInput['scope'] }))}
            className={fieldClass}
          >
            <option value="exterior">Exterior only</option>
            <option value="both">Interior + exterior</option>
          </select>
        </div>

        <div>
          <label htmlFor="commercial-frequency" className="mb-1 block text-sm font-medium text-gray-700">
            Service frequency
          </label>
          <select
            id="commercial-frequency"
            name="frequency"
            data-testid={tid('commercialWindow', 'step_3', 'frequency')}
            value={input.frequency}
            onChange={(event) =>
              onInputChange((previous) => ({ ...previous, frequency: event.target.value as CommercialWindowEstimateInput['frequency'] }))
            }
            className={fieldClass}
          >
            <option value="oneTime">One-time visit</option>
            <option value="monthly">Monthly</option>
            <option value="biweekly">Biweekly</option>
            <option value="weekly">Weekly</option>
          </select>
        </div>
      </div>
    );
  }

  if (step === 4) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <BooleanTile
          label="Lift/boom access required"
          id="commercial-lift-required"
          name="liftRequired"
          testId={tid('commercialWindow', 'step_4', 'lift_required')}
          checked={input.liftRequired}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, liftRequired: checked }))}
        />
        <BooleanTile
          label="After-hours cleaning required"
          id="commercial-after-hours"
          name="afterHours"
          testId={tid('commercialWindow', 'step_4', 'after_hours')}
          checked={input.afterHours}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, afterHours: checked }))}
        />
        <BooleanTile
          label="Sticker/paint/overspray present"
          id="commercial-overspray"
          name="overspray"
          testId={tid('commercialWindow', 'step_4', 'overspray')}
          checked={input.overspray}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, overspray: checked }))}
        />
        <BooleanTile
          label="Hard water stain treatment needed"
          id="commercial-hard-water"
          name="hardWater"
          testId={tid('commercialWindow', 'step_4', 'hard_water')}
          checked={input.hardWater}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, hardWater: checked }))}
        />
      </div>
    );
  }

  return (
    <ContactStep
      section="commercial"
      contact={input.contact}
      errors={errors}
      onContactChange={(field, value) =>
        onInputChange((previous) => ({
          ...previous,
          contact: {
            ...previous.contact,
            [field]: value,
          },
        }))
      }
    />
  );
}

interface CarpetFormProps {
  step: number;
  input: CarpetEstimateInput;
  onInputChange: Dispatch<SetStateAction<CarpetEstimateInput>>;
  onPostalChange: (postalCode: string) => void;
  errors: FieldErrors;
}

function CarpetForm({ step, input, onInputChange, onPostalChange, errors }: CarpetFormProps) {
  if (step === 1) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <InputPostalZone
          section="carpet"
          serviceKey="carpet"
          postalCode={input.postalCode}
          zone={input.zone}
          onPostalChange={onPostalChange}
          onZoneChange={(zone) => onInputChange((previous) => ({ ...previous, zone }))}
          errors={errors}
        />

        <div>
          <label htmlFor="carpet-estimate-method" className="mb-1 block text-sm font-medium text-gray-700">
            Estimate method
          </label>
          <select
            id="carpet-estimate-method"
            name="estimateMode"
            data-testid={tid('carpet', 'step_1', 'estimate_method')}
            value={input.estimateMode}
            onChange={(event) => onInputChange((previous) => ({ ...previous, estimateMode: event.target.value as CarpetEstimateInput['estimateMode'] }))}
            className={fieldClass}
          >
            <option value="rooms">By rooms</option>
            <option value="sqft">By square footage</option>
          </select>
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {input.estimateMode === 'rooms' ? (
          <NumberInput
            label="Room count"
            id="carpet-room-count"
            name="roomCount"
            testId={tid('carpet', 'step_2', 'room_count')}
            value={input.rooms}
            onChange={(value) => onInputChange((previous) => ({ ...previous, rooms: Math.max(2, value) }))}
            min={2}
            error={errors.rooms}
          />
        ) : (
          <div>
            <label htmlFor="carpet-square-footage-bracket" className="mb-1 block text-sm font-medium text-gray-700">
              Square footage bracket
            </label>
            <select
              id="carpet-square-footage-bracket"
              name="squareFootageBracket"
              data-testid={tid('carpet', 'step_2', 'square_footage_bracket')}
              value={input.sqftBracket}
              onChange={(event) =>
                onInputChange((previous) => ({ ...previous, sqftBracket: event.target.value as CarpetEstimateInput['sqftBracket'] }))
              }
              className={fieldClass}
            >
              <option value="under500">Under 500 sq ft</option>
              <option value="500to1000">500 - 1000 sq ft</option>
              <option value="1000to1500">1000 - 1500 sq ft</option>
              <option value="1500to2000">1500 - 2000 sq ft</option>
              <option value="over2000">2000+ sq ft</option>
            </select>
          </div>
        )}
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="carpet-condition" className="mb-1 block text-sm font-medium text-gray-700">
            Condition
          </label>
          <select
            id="carpet-condition"
            name="condition"
            data-testid={tid('carpet', 'step_3', 'condition')}
            value={input.condition}
            onChange={(event) => onInputChange((previous) => ({ ...previous, condition: event.target.value as CarpetEstimateInput['condition'] }))}
            className={fieldClass}
          >
            <option value="light">Light (normal wear)</option>
            <option value="moderate">Moderate (pets/spills)</option>
            <option value="heavy">Heavy (deep-set dirt)</option>
          </select>
        </div>
      </div>
    );
  }

  if (step === 4) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <NumberInput
          label="Stairs (steps)"
          id="carpet-stairs-steps"
          name="stairsSteps"
          testId={tid('carpet', 'step_4', 'stairs_steps')}
          value={input.stairsSteps}
          onChange={(value) => onInputChange((previous) => ({ ...previous, stairsSteps: value }))}
        />
        <NumberInput
          label="Hallways / corridors"
          id="carpet-hallways"
          name="hallways"
          testId={tid('carpet', 'step_4', 'hallways')}
          value={input.hallways}
          onChange={(value) => onInputChange((previous) => ({ ...previous, hallways: value }))}
        />

        <div>
          <label htmlFor="carpet-furniture-moving" className="mb-1 block text-sm font-medium text-gray-700">
            Furniture moving
          </label>
          <select
            id="carpet-furniture-moving"
            name="furnitureMoving"
            data-testid={tid('carpet', 'step_4', 'furniture_moving')}
            value={input.furnitureMoving}
            onChange={(event) =>
              onInputChange((previous) => ({ ...previous, furnitureMoving: event.target.value as CarpetEstimateInput['furnitureMoving'] }))
            }
            className={fieldClass}
          >
            <option value="none">None</option>
            <option value="light">Light furniture</option>
            <option value="heavy">Heavy furniture</option>
          </select>
        </div>

        <BooleanTile
          label="Advanced stain removal"
          id="carpet-advanced-stain-removal"
          name="advancedStainRemoval"
          testId={tid('carpet', 'step_4', 'advanced_stain_removal')}
          checked={input.advancedStainRemoval}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, advancedStainRemoval: checked }))}
        />
        <BooleanTile
          label="Odor elimination"
          id="carpet-odor-elimination"
          name="odorElimination"
          testId={tid('carpet', 'step_4', 'odor_elimination')}
          checked={input.odorElimination}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, odorElimination: checked }))}
        />
        <BooleanTile
          label="Pet treatment"
          id="carpet-pet-treatment"
          name="petTreatment"
          testId={tid('carpet', 'step_4', 'pet_treatment')}
          checked={input.petTreatment}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, petTreatment: checked }))}
        />
        <BooleanTile
          label="Stain protector"
          id="carpet-stain-protector"
          name="stainProtector"
          testId={tid('carpet', 'step_4', 'stain_protector')}
          checked={input.stainProtector}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, stainProtector: checked }))}
        />
        <BooleanTile
          label="Flooding / mould / unusual condition"
          id="carpet-unusual-condition"
          name="unusualCondition"
          testId={tid('carpet', 'step_4', 'unusual_condition')}
          checked={input.unusualCondition}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, unusualCondition: checked }))}
        />
      </div>
    );
  }

  return (
    <ContactStep
      section="carpet"
      contact={input.contact}
      schedule={input.schedule}
      onScheduleChange={(schedule) => onInputChange((previous) => ({ ...previous, schedule }))}
      errors={errors}
      onContactChange={(field, value) =>
        onInputChange((previous) => ({
          ...previous,
          contact: {
            ...previous.contact,
            [field]: value,
          },
        }))
      }
    />
  );
}

interface PostConstructionFormProps {
  step: number;
  input: PostConstructionEstimateInput;
  onInputChange: Dispatch<SetStateAction<PostConstructionEstimateInput>>;
  onPostalChange: (postalCode: string) => void;
  errors: FieldErrors;
}

function PostConstructionForm({ step, input, onInputChange, onPostalChange, errors }: PostConstructionFormProps) {
  if (step === 1) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <InputPostalZone
          section="post"
          serviceKey="postConstruction"
          postalCode={input.postalCode}
          zone={input.zone}
          onPostalChange={onPostalChange}
          onZoneChange={(zone) => onInputChange((previous) => ({ ...previous, zone }))}
          errors={errors}
        />

        <div>
          <label htmlFor="post-project-type" className="mb-1 block text-sm font-medium text-gray-700">
            Project type
          </label>
          <select
            id="post-project-type"
            name="projectType"
            data-testid={tid('postConstruction', 'step_1', 'project_type')}
            value={input.projectType}
            onChange={(event) =>
              onInputChange((previous) => ({ ...previous, projectType: event.target.value as PostConstructionEstimateInput['projectType'] }))
            }
            className={fieldClass}
          >
            <option value="residential">Residential</option>
            <option value="commercial">Commercial</option>
          </select>
        </div>

        <div>
          <label htmlFor="post-build-type" className="mb-1 block text-sm font-medium text-gray-700">
            Build type
          </label>
          <select
            id="post-build-type"
            name="buildType"
            data-testid={tid('postConstruction', 'step_1', 'build_type')}
            value={input.buildType}
            onChange={(event) =>
              onInputChange((previous) => ({ ...previous, buildType: event.target.value as PostConstructionEstimateInput['buildType'] }))
            }
            className={fieldClass}
          >
            <option value="renovation">Renovation</option>
            <option value="newBuild">New build</option>
          </select>
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="post-square-footage-bracket" className="mb-1 block text-sm font-medium text-gray-700">
            Square footage bracket
          </label>
          <select
            id="post-square-footage-bracket"
            name="squareFootageBracket"
            data-testid={tid('postConstruction', 'step_2', 'square_footage_bracket')}
            value={input.sqftBracket}
            onChange={(event) =>
              onInputChange((previous) => ({ ...previous, sqftBracket: event.target.value as PostConstructionEstimateInput['sqftBracket'] }))
            }
            className={fieldClass}
          >
            <option value="under1000">Under 1000 sq ft</option>
            <option value="1000to2500">1000 - 2500 sq ft</option>
            <option value="2500to5000">2500 - 5000 sq ft</option>
            <option value="over5000">5000+ sq ft</option>
          </select>
        </div>
        <NumberInput
          label="Floors / levels"
          id="post-floors-levels"
          name="floorsLevels"
          testId={tid('postConstruction', 'step_2', 'floors_levels')}
          value={input.floors}
          onChange={(value) => onInputChange((previous) => ({ ...previous, floors: Math.max(1, value) }))}
          min={1}
          error={errors.floors}
        />
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="post-cleaning-stage" className="mb-1 block text-sm font-medium text-gray-700">
            Cleaning stage
          </label>
          <select
            id="post-cleaning-stage"
            name="cleaningStage"
            data-testid={tid('postConstruction', 'step_3', 'cleaning_stage')}
            value={input.stage}
            onChange={(event) => onInputChange((previous) => ({ ...previous, stage: event.target.value as PostConstructionEstimateInput['stage'] }))}
            className={fieldClass}
          >
            <option value="rough">Rough clean</option>
            <option value="light">Light clean</option>
            <option value="final">Final clean</option>
            <option value="touchUp">Touch-up clean</option>
          </select>
        </div>

        <div>
          <label htmlFor="post-dust-load" className="mb-1 block text-sm font-medium text-gray-700">
            Dust load
          </label>
          <select
            id="post-dust-load"
            name="dustLoad"
            data-testid={tid('postConstruction', 'step_3', 'dust_load')}
            value={input.dustLoad}
            onChange={(event) =>
              onInputChange((previous) => ({ ...previous, dustLoad: event.target.value as PostConstructionEstimateInput['dustLoad'] }))
            }
            className={fieldClass}
          >
            <option value="light">Light</option>
            <option value="medium">Medium</option>
            <option value="heavy">Heavy</option>
          </select>
        </div>
      </div>
    );
  }

  if (step === 4) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="post-interior-windows" className="mb-1 block text-sm font-medium text-gray-700">
            Interior windows
          </label>
          <select
            id="post-interior-windows"
            name="interiorWindows"
            data-testid={tid('postConstruction', 'step_4', 'interior_windows')}
            value={input.interiorWindows}
            onChange={(event) =>
              onInputChange((previous) => ({ ...previous, interiorWindows: event.target.value as PostConstructionEstimateInput['interiorWindows'] }))
            }
            className={fieldClass}
          >
            <option value="none">None</option>
            <option value="small">Small scope</option>
            <option value="medium">Medium scope</option>
            <option value="large">Large scope</option>
          </select>
        </div>

        <div>
          <label htmlFor="post-scraping" className="mb-1 block text-sm font-medium text-gray-700">
            Sticker/paint scraping
          </label>
          <select
            id="post-scraping"
            name="scraping"
            data-testid={tid('postConstruction', 'step_4', 'scraping')}
            value={input.scraping}
            onChange={(event) => onInputChange((previous) => ({ ...previous, scraping: event.target.value as PostConstructionEstimateInput['scraping'] }))}
            className={fieldClass}
          >
            <option value="none">None</option>
            <option value="some">Some</option>
            <option value="lots">Lots</option>
          </select>
        </div>

        <div>
          <label htmlFor="post-floor-detailing" className="mb-1 block text-sm font-medium text-gray-700">
            Floor detailing
          </label>
          <select
            id="post-floor-detailing"
            name="floorDetailing"
            data-testid={tid('postConstruction', 'step_4', 'floor_detailing')}
            value={input.floorDetailing}
            onChange={(event) =>
              onInputChange((previous) => ({ ...previous, floorDetailing: event.target.value as PostConstructionEstimateInput['floorDetailing'] }))
            }
            className={fieldClass}
          >
            <option value="none">None</option>
            <option value="small">Small scope</option>
            <option value="medium">Medium scope</option>
            <option value="large">Large scope</option>
          </select>
        </div>

        <BooleanTile
          label="Inside cabinets / drawers"
          id="post-inside-cabinets"
          name="insideCabinets"
          testId={tid('postConstruction', 'step_4', 'inside_cabinets')}
          checked={input.insideCabinets}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, insideCabinets: checked }))}
        />
        <BooleanTile
          label="Appliance detailing"
          id="post-appliance-detailing"
          name="appliances"
          testId={tid('postConstruction', 'step_4', 'appliance_detailing')}
          checked={input.appliances}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, appliances: checked }))}
        />
        <BooleanTile
          label="Special detailing (vents/baseboards/doors)"
          id="post-special-detailing"
          name="specialDetailing"
          testId={tid('postConstruction', 'step_4', 'special_detailing')}
          checked={input.specialDetailing}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, specialDetailing: checked }))}
        />
        <BooleanTile
          label="Multi-tenant access coordination"
          id="post-multi-tenant-access"
          name="multiTenantAccess"
          testId={tid('postConstruction', 'step_4', 'multi_tenant_access')}
          checked={input.multiTenantAccess}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, multiTenantAccess: checked }))}
        />
      </div>
    );
  }

  return (
    <ContactStep
      section="post"
      contact={input.contact}
      schedule={input.schedule}
      onScheduleChange={(schedule) => onInputChange((previous) => ({ ...previous, schedule }))}
      errors={errors}
      onContactChange={(field, value) =>
        onInputChange((previous) => ({
          ...previous,
          contact: {
            ...previous.contact,
            [field]: value,
          },
        }))
      }
    />
  );
}

function InputPostalZone({
  section,
  serviceKey,
  postalCode,
  zone,
  onPostalChange,
  onZoneChange,
  errors,
}: {
  section: 'window' | 'commercial' | 'carpet' | 'post';
  serviceKey: ServiceType;
  postalCode: string;
  zone: WindowZone;
  onPostalChange: (value: string) => void;
  onZoneChange: (zone: WindowZone) => void;
  errors: FieldErrors;
}) {
  const postalError = errors.postalCode;

  return (
    <>
      <div>
        <label htmlFor={`${section}-postal-code`} className="mb-1 block text-sm font-medium text-gray-700">
          Postal code
        </label>
        <input
          id={`${section}-postal-code`}
          name="postalCode"
          data-testid={tid(serviceKey, 'step_1', 'postal_code')}
          value={postalCode}
          onChange={(event) => onPostalChange(event.target.value)}
          className={`${fieldClass} ${postalError ? 'border-rose-500 focus:border-rose-600 focus:ring-rose-200' : ''}`}
          placeholder="R5G 2X3"
          autoComplete="postal-code"
          aria-invalid={postalError ? 'true' : 'false'}
          aria-describedby={postalError ? `${section}-postal-code-error` : undefined}
        />
        {postalError && (
          <p id={`${section}-postal-code-error`} className="mt-1 text-xs text-rose-700">
            {postalError}
          </p>
        )}
      </div>
      <div>
        <label htmlFor={`${section}-travel-zone`} className="mb-1 block text-sm font-medium text-gray-700">
          Travel zone
        </label>
        <select
          id={`${section}-travel-zone`}
          name="travelZone"
          data-testid={tid(serviceKey, 'step_1', 'travel_zone')}
          value={zone}
          onChange={(event) => onZoneChange(event.target.value as WindowZone)}
          className={fieldClass}
        >
          {zoneOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
    </>
  );
}

function NumberInput({
  label,
  id,
  name,
  testId,
  value,
  min = 0,
  onChange,
  error,
}: {
  label: string;
  id: string;
  name: string;
  testId: string;
  value: number;
  min?: number;
  onChange: (value: number) => void;
  error?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        name={name}
        data-testid={testId}
        type="number"
        min={min}
        step={1}
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(Math.max(min, Number(event.target.value) || 0))}
        className={`${fieldClass} ${error ? 'border-rose-500 focus:border-rose-600 focus:ring-rose-200' : ''}`}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}

function BooleanTile({
  label,
  id,
  name,
  testId,
  checked,
  onChange,
  error,
}: {
  label: string;
  id: string;
  name: string;
  testId: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${
          error ? 'border-rose-300 text-rose-800' : 'border-gray-200 text-gray-700'
        }`}
      >
        <input id={id} name={name} data-testid={testId} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        {label}
      </label>
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}

interface ContactStepProps {
  section: 'window' | 'commercial' | 'carpet' | 'post';
  contact: LeadContact;
  schedule?: SchedulePreference;
  onScheduleChange?: (value: SchedulePreference) => void;
  onContactChange: (field: keyof LeadContact, value: string | boolean) => void;
  errors: FieldErrors;
}

function ContactStep({ section, contact, schedule, onScheduleChange, onContactChange, errors }: ContactStepProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700">
        <p className="font-semibold">Instant estimate submission</p>
        <p className="mt-1">Once you submit, we generate your quote PDF and route the estimate details for follow-up.</p>
      </div>

      <div>
        <label htmlFor={`${section}-full-name`} className="mb-1 block text-sm font-medium text-gray-700">
          Full name
        </label>
        <input
          id={`${section}-full-name`}
          name="fullName"
          data-testid={tid('contact', 'name')}
          value={contact.fullName}
          onChange={(event) => onContactChange('fullName', event.target.value)}
          className={`${fieldClass} ${errors['contact.fullName'] ? 'border-rose-500 focus:border-rose-600 focus:ring-rose-200' : ''}`}
          placeholder="Jane Smith"
          autoComplete="name"
          aria-invalid={errors['contact.fullName'] ? 'true' : 'false'}
          aria-describedby={errors['contact.fullName'] ? `${section}-full-name-error` : undefined}
        />
        {errors['contact.fullName'] && (
          <p id={`${section}-full-name-error`} className="mt-1 text-xs text-rose-700">
            {errors['contact.fullName']}
          </p>
        )}
      </div>

      <div>
        <label htmlFor={`${section}-phone`} className="mb-1 block text-sm font-medium text-gray-700">
          Phone number
        </label>
        <input
          id={`${section}-phone`}
          name="phone"
          data-testid={tid('contact', 'phone')}
          type="tel"
          value={contact.phone}
          onChange={(event) => onContactChange('phone', event.target.value)}
          className={`${fieldClass} ${errors['contact.phone'] ? 'border-rose-500 focus:border-rose-600 focus:ring-rose-200' : ''}`}
          placeholder="(782) 821-7802"
          autoComplete="tel"
          inputMode="tel"
          aria-invalid={errors['contact.phone'] ? 'true' : 'false'}
          aria-describedby={errors['contact.phone'] ? `${section}-phone-error` : undefined}
        />
        {errors['contact.phone'] && (
          <p id={`${section}-phone-error`} className="mt-1 text-xs text-rose-700">
            {errors['contact.phone']}
          </p>
        )}
      </div>

      <div>
        <label htmlFor={`${section}-email`} className="mb-1 block text-sm font-medium text-gray-700">
          Email address
        </label>
        <input
          id={`${section}-email`}
          name="email"
          data-testid={tid('contact', 'email')}
          type="email"
          value={contact.email}
          onChange={(event) => onContactChange('email', event.target.value)}
          className={`${fieldClass} ${errors['contact.email'] ? 'border-rose-500 focus:border-rose-600 focus:ring-rose-200' : ''}`}
          placeholder="you@example.com"
          autoComplete="email"
          aria-invalid={errors['contact.email'] ? 'true' : 'false'}
          aria-describedby={errors['contact.email'] ? `${section}-email-error` : undefined}
        />
        {errors['contact.email'] && (
          <p id={`${section}-email-error`} className="mt-1 text-xs text-rose-700">
            {errors['contact.email']}
          </p>
        )}
      </div>

      <div>
        <label htmlFor={`${section}-address`} className="mb-1 block text-sm font-medium text-gray-700">
          Property address (optional)
        </label>
        <input
          id={`${section}-address`}
          name="address"
          data-testid={tid('contact', 'address')}
          value={contact.address}
          onChange={(event) => onContactChange('address', event.target.value)}
          className={fieldClass}
          placeholder="120 Parkside Crescent, Mitchell"
          autoComplete="street-address"
        />
      </div>

      {schedule && onScheduleChange && (
        <div>
          <label htmlFor={`${section}-schedule`} className="mb-1 block text-sm font-medium text-gray-700">
            Preferred timeline
          </label>
          <select
            id={`${section}-schedule`}
            name="preferredTimeline"
            data-testid={tid('contact', 'preferred_timeline')}
            value={schedule}
            onChange={(event) => onScheduleChange(event.target.value as SchedulePreference)}
            className={fieldClass}
          >
            <option value="asap">ASAP</option>
            <option value="nextWeek">Next week</option>
            <option value="flexible">Flexible</option>
            <option value="tomorrow">Tomorrow</option>
          </select>
        </div>
      )}

      <label
        htmlFor={`${section}-consent`}
        className={`md:col-span-2 flex items-start gap-2 rounded-lg border p-3 text-sm ${
          errors['contact.consentToContact'] ? 'border-rose-300 text-rose-800' : 'border-gray-200 text-gray-700'
        }`}
      >
        <input
          id={`${section}-consent`}
          name="consent"
          data-testid={tid('contact', 'consent')}
          type="checkbox"
          checked={contact.consentToContact}
          onChange={(event) => onContactChange('consentToContact', event.target.checked)}
          className="mt-0.5"
        />
        I give permission for Steam Zone to contact me by text/email to send my estimate. I can opt out at any time.
      </label>
      {errors['contact.consentToContact'] && (
        <p id={`${section}-consent-error`} className="-mt-2 md:col-span-2 text-xs text-rose-700">
          {errors['contact.consentToContact']}
        </p>
      )}

      <label
        htmlFor={`${section}-marketing`}
        className="md:col-span-2 flex items-start gap-2 rounded-lg border border-gray-200 p-3 text-sm text-gray-700"
      >
        <input
          id={`${section}-marketing`}
          name="marketingOptIn"
          data-testid={tid('contact', 'marketing_opt_in')}
          type="checkbox"
          checked={contact.marketingOptIn}
          onChange={(event) => onContactChange('marketingOptIn', event.target.checked)}
          className="mt-0.5"
        />
        Yes, I'd like to receive occasional offers and service updates from Steam Zone by text/email. I can opt out anytime.
      </label>
    </div>
  );
}
