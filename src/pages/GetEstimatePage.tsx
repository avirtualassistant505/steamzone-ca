import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
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
  calculateEstimate,
  createDefaultCarpetInput,
  createDefaultCommercialWindowInput,
  createDefaultPostConstructionInput,
  createDefaultWindowInput,
  detectZoneFromPostalCode,
  formatBookingMode,
  formatConfidence,
  formatCurrency,
  formatServiceLabel,
  saveEstimateRecord,
  type CarpetEstimateInput,
  type CommercialWindowEstimateInput,
  type EstimateRecord,
  type EstimateResult,
  type LeadContact,
  type PostConstructionEstimateInput,
  type PricingConfig,
  type SchedulePreference,
  type ServiceType,
  type WindowEstimateInput,
  type WindowZone,
} from '../lib/estimateEngine';
import { sendEstimateEmail } from '../lib/estimateMailer';

interface GetEstimatePageProps {
  pricingConfig: PricingConfig;
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

function confidenceClasses(confidence: EstimateResult['confidence']): string {
  if (confidence === 'green') {
    return 'border-emerald-200 bg-emerald-100 text-emerald-700';
  }

  if (confidence === 'yellow') {
    return 'border-amber-200 bg-amber-100 text-amber-700';
  }

  return 'border-rose-200 bg-rose-100 text-rose-700';
}

function contactForService(
  serviceType: ServiceType,
  windowInput: WindowEstimateInput,
  commercialInput: CommercialWindowEstimateInput,
  carpetInput: CarpetEstimateInput,
  postInput: PostConstructionEstimateInput
): LeadContact {
  if (serviceType === 'window') {
    return windowInput.contact;
  }

  if (serviceType === 'commercialWindow') {
    return commercialInput.contact;
  }

  if (serviceType === 'carpet') {
    return carpetInput.contact;
  }

  return postInput.contact;
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function GetEstimatePage({ pricingConfig }: GetEstimatePageProps) {
  const [serviceType, setServiceType] = useState<ServiceType>('window');
  const [step, setStep] = useState(1);

  const [windowInput, setWindowInput] = useState<WindowEstimateInput>(() => createDefaultWindowInput());
  const [commercialInput, setCommercialInput] = useState<CommercialWindowEstimateInput>(() => createDefaultCommercialWindowInput());
  const [carpetInput, setCarpetInput] = useState<CarpetEstimateInput>(() => createDefaultCarpetInput());
  const [postInput, setPostInput] = useState<PostConstructionEstimateInput>(() => createDefaultPostConstructionInput());

  const [result, setResult] = useState<EstimateResult | null>(null);
  const [latestRecord, setLatestRecord] = useState<EstimateRecord | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const labels = useMemo(() => stepLabels[serviceType], [serviceType]);
  const totalSteps = labels.length;

  function switchService(nextService: ServiceType): void {
    setServiceType(nextService);
    setStep(1);
    setResult(null);
    setLatestRecord(null);
    setStatusMessage('');
  }

  function stepForward(): void {
    setStep((previous) => Math.min(totalSteps, previous + 1));
  }

  function stepBack(): void {
    setStep((previous) => Math.max(1, previous - 1));
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

  function isValidContact(): boolean {
    const contact = contactForService(serviceType, windowInput, commercialInput, carpetInput, postInput);

    return (
      contact.fullName.trim().length > 1 &&
      contact.phone.trim().length >= 7 &&
      emailRegex.test(contact.email.trim()) &&
      contact.consentToContact
    );
  }

  async function calculateCurrentEstimate(): Promise<void> {
    if (!isValidContact()) {
      setStatusMessage(
        'Please complete name, phone, valid email, and keep consent checked so we can deliver your instant estimate PDF.'
      );
      return;
    }

    setIsSubmitting(true);
    setStatusMessage('Generating your estimate and preparing email delivery...');

    const answers = currentAnswers();
    const estimate = calculateEstimate(serviceType, answers, pricingConfig);

    const record = saveEstimateRecord({
      serviceType,
      postalCode: answers.postalCode,
      zone: answers.zone,
      contact: answers.contact,
      answers,
      result: estimate,
      pricingVersion: pricingConfig.version,
    });

    setResult(estimate);
    setLatestRecord(record);

    const emailResult = await sendEstimateEmail(record);

    if (emailResult.success) {
      setStatusMessage(`Quote ${record.quoteNumber} generated. Your estimate PDF was emailed instantly to ${record.contact.email}.`);
    } else {
      setStatusMessage(
        `Quote ${record.quoteNumber} generated, but email delivery needs setup: ${emailResult.message}`
      );
    }

    setIsSubmitting(false);
  }

  return (
    <main className="bg-gradient-to-br from-slate-50 via-blue-50 to-white pb-20 pt-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-10 text-center">
          <h1 className="text-4xl font-bold text-gray-900 md:text-5xl">Steinbach Instant Estimate</h1>
          <p className="mx-auto mt-4 max-w-3xl text-lg text-gray-600">
            Choose your service, answer a short guided wizard, and receive a live estimate range with an instant email
            PDF quote.
          </p>
        </div>

        <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ServiceCard
            active={serviceType === 'window'}
            title="Residential Windows"
            description="Pane-based residential pricing with home-size shortcuts and complexity add-ons."
            icon={<Home className="h-6 w-6" />}
            onClick={() => switchService('window')}
          />
          <ServiceCard
            active={serviceType === 'commercialWindow'}
            title="Commercial Windows"
            description="Storefront and low-rise instant ranges with recurring-frequency pricing."
            icon={<Building2 className="h-6 w-6" />}
            onClick={() => switchService('commercialWindow')}
          />
          <ServiceCard
            active={serviceType === 'carpet'}
            title="Carpet Cleaning"
            description="Room or square-foot flow with stairs, hallways, and treatment options."
            icon={<ClipboardCheck className="h-6 w-6" />}
            onClick={() => switchService('carpet')}
          />
          <ServiceCard
            active={serviceType === 'postConstruction'}
            title="Post-Construction"
            description="Stage + dust-load based estimate with add-ons for detail-level finishing."
            icon={<Hammer className="h-6 w-6" />}
            onClick={() => switchService('postConstruction')}
          />
        </div>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xl md:p-8">
          <div className="mb-8">
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">{formatServiceLabel(serviceType)}</p>
            <h2 className="mt-2 text-2xl font-bold text-gray-900">Step {step} of {totalSteps}</h2>
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

          {serviceType === 'window' && (
            <WindowForm
              step={step}
              input={windowInput}
              onInputChange={setWindowInput}
              onPostalChange={updateWindowPostal}
            />
          )}

          {serviceType === 'commercialWindow' && (
            <CommercialWindowForm
              step={step}
              input={commercialInput}
              onInputChange={setCommercialInput}
              onPostalChange={updateCommercialPostal}
            />
          )}

          {serviceType === 'carpet' && (
            <CarpetForm
              step={step}
              input={carpetInput}
              onInputChange={setCarpetInput}
              onPostalChange={updateCarpetPostal}
            />
          )}

          {serviceType === 'postConstruction' && (
            <PostConstructionForm
              step={step}
              input={postInput}
              onInputChange={setPostInput}
              onPostalChange={updatePostPostal}
            />
          )}

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-6">
            <button
              type="button"
              onClick={stepBack}
              disabled={step === 1 || isSubmitting}
              className="rounded-lg border border-gray-300 px-5 py-2.5 font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Back
            </button>

            {step < totalSteps ? (
              <button
                type="button"
                onClick={stepForward}
                disabled={isSubmitting}
                className="rounded-lg bg-blue-600 px-6 py-2.5 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                onClick={calculateCurrentEstimate}
                disabled={isSubmitting}
                className="inline-flex items-center rounded-lg bg-emerald-600 px-6 py-2.5 font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                <Calculator className="mr-2 h-4 w-4" />
                {isSubmitting ? 'Sending...' : 'Generate + Email Estimate'}
              </button>
            )}
          </div>

          {statusMessage && <p className="mt-4 text-sm text-blue-700">{statusMessage}</p>}
        </section>

        {result && (
          <section className="mt-8 rounded-2xl border border-blue-200 bg-white p-6 shadow-lg md:p-8">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-2xl font-bold text-gray-900">Estimate Results</h3>
              {latestRecord && (
                <div className="rounded-full border border-blue-200 bg-blue-50 px-4 py-1 text-sm font-semibold text-blue-700">
                  Quote: {latestRecord.quoteNumber}
                </div>
              )}
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              <div className="rounded-xl bg-blue-50 p-5">
                <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Estimate range</p>
                <p className="mt-2 text-3xl font-bold text-blue-900">
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
              <a href="tel:4312053909" className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700">
                Call to Book
              </a>
              <a
                href="/#contact"
                className="rounded-lg border border-gray-300 px-6 py-3 font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Request Callback
              </a>
              {latestRecord?.contact.email && (
                <div className="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  <Mail className="mr-2 h-4 w-4" />
                  PDF quote sent to {latestRecord.contact.email}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function ServiceCard({
  active,
  title,
  description,
  icon,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  icon: JSX.Element;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-5 text-left transition ${
        active
          ? 'border-blue-600 bg-blue-600 text-white shadow-lg'
          : 'border-gray-200 bg-white text-gray-800 hover:border-blue-300 hover:shadow-md'
      }`}
    >
      <div className="mb-3">{icon}</div>
      <div className="text-lg font-semibold">{title}</div>
      <div className={`mt-1 text-sm ${active ? 'text-blue-100' : 'text-gray-500'}`}>{description}</div>
    </button>
  );
}

interface WindowFormProps {
  step: number;
  input: WindowEstimateInput;
  onInputChange: Dispatch<SetStateAction<WindowEstimateInput>>;
  onPostalChange: (postalCode: string) => void;
}

function WindowForm({ step, input, onInputChange, onPostalChange }: WindowFormProps) {
  if (step === 1) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <InputPostalZone
          postalCode={input.postalCode}
          zone={input.zone}
          onPostalChange={onPostalChange}
          onZoneChange={(zone) => onInputChange((previous) => ({ ...previous, zone }))}
        />

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">House type / storeys</label>
          <select
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
          <label className="mb-1 block text-sm font-medium text-gray-700">Square footage bracket</label>
          <select
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
          <label className="mb-1 block text-sm font-medium text-gray-700">Scope</label>
          <select
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
          <label className="mb-1 block text-sm font-medium text-gray-700">Screens</label>
          <select
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
          <label className="mb-1 block text-sm font-medium text-gray-700">Tracks & sills</label>
          <select
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
          checked={input.hardToReach}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, hardToReach: checked }))}
        />
        <BooleanTile
          label="Hard water removal needed"
          checked={input.hardWaterRemoval}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, hardWaterRemoval: checked }))}
        />
        <BooleanTile
          label="Construction debris / paint on glass"
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
          <label className="mb-1 block text-sm font-medium text-gray-700">Sliding windows removal</label>
          <select
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
          value={input.slidingQuantity}
          onChange={(value) => onInputChange((previous) => ({ ...previous, slidingQuantity: value }))}
        />

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Patio doors</label>
          <select
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
          value={input.patioQuantity}
          onChange={(value) => onInputChange((previous) => ({ ...previous, patioQuantity: value }))}
        />

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Skylights</label>
          <select
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
          value={input.skylightQuantity}
          onChange={(value) => onInputChange((previous) => ({ ...previous, skylightQuantity: value }))}
        />

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Railing glass</label>
          <select
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
          <label className="mb-1 block text-sm font-medium text-gray-700">French panes</label>
          <select
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

        <BooleanTile label="Sunroom" checked={input.sunroom} onChange={(checked) => onInputChange((previous) => ({ ...previous, sunroom: checked }))} />
        <BooleanTile
          label="Walkout basement access"
          checked={input.walkoutBasement}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, walkoutBasement: checked }))}
        />
      </div>
    );
  }

  return (
    <ContactStep
      contact={input.contact}
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
}

function CommercialWindowForm({ step, input, onInputChange, onPostalChange }: CommercialWindowFormProps) {
  if (step === 1) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <InputPostalZone
          postalCode={input.postalCode}
          zone={input.zone}
          onPostalChange={onPostalChange}
          onZoneChange={(zone) => onInputChange((previous) => ({ ...previous, zone }))}
        />

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Building type</label>
          <select
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
          <label className="mb-1 block text-sm font-medium text-gray-700">Storeys</label>
          <select
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
          <label className="mb-1 block text-sm font-medium text-gray-700">How do you want to estimate glass size?</label>
          <select
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
            value={input.paneCount}
            onChange={(value) => onInputChange((previous) => ({ ...previous, paneCount: Math.max(1, value) }))}
            min={1}
          />
        ) : (
          <NumberInput
            label="Frontage (feet)"
            value={input.frontageFeet}
            onChange={(value) => onInputChange((previous) => ({ ...previous, frontageFeet: Math.max(1, value) }))}
            min={1}
          />
        )}

        <NumberInput
          label="Glass door count"
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
          <label className="mb-1 block text-sm font-medium text-gray-700">Cleaning scope</label>
          <select
            value={input.scope}
            onChange={(event) => onInputChange((previous) => ({ ...previous, scope: event.target.value as CommercialWindowEstimateInput['scope'] }))}
            className={fieldClass}
          >
            <option value="exterior">Exterior only</option>
            <option value="both">Interior + exterior</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Service frequency</label>
          <select
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
          checked={input.liftRequired}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, liftRequired: checked }))}
        />
        <BooleanTile
          label="After-hours cleaning required"
          checked={input.afterHours}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, afterHours: checked }))}
        />
        <BooleanTile
          label="Sticker/paint/overspray present"
          checked={input.overspray}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, overspray: checked }))}
        />
        <BooleanTile
          label="Hard water stain treatment needed"
          checked={input.hardWater}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, hardWater: checked }))}
        />
      </div>
    );
  }

  return (
    <ContactStep
      contact={input.contact}
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
}

function CarpetForm({ step, input, onInputChange, onPostalChange }: CarpetFormProps) {
  if (step === 1) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <InputPostalZone
          postalCode={input.postalCode}
          zone={input.zone}
          onPostalChange={onPostalChange}
          onZoneChange={(zone) => onInputChange((previous) => ({ ...previous, zone }))}
        />

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Estimate method</label>
          <select
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
            value={input.rooms}
            onChange={(value) => onInputChange((previous) => ({ ...previous, rooms: Math.max(2, value) }))}
            min={2}
          />
        ) : (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Square footage bracket</label>
            <select
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
          <label className="mb-1 block text-sm font-medium text-gray-700">Condition</label>
          <select
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
          value={input.stairsSteps}
          onChange={(value) => onInputChange((previous) => ({ ...previous, stairsSteps: value }))}
        />
        <NumberInput
          label="Hallways / corridors"
          value={input.hallways}
          onChange={(value) => onInputChange((previous) => ({ ...previous, hallways: value }))}
        />

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Furniture moving</label>
          <select
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
          checked={input.advancedStainRemoval}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, advancedStainRemoval: checked }))}
        />
        <BooleanTile
          label="Odor elimination"
          checked={input.odorElimination}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, odorElimination: checked }))}
        />
        <BooleanTile
          label="Pet treatment"
          checked={input.petTreatment}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, petTreatment: checked }))}
        />
        <BooleanTile
          label="Stain protector"
          checked={input.stainProtector}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, stainProtector: checked }))}
        />
        <BooleanTile
          label="Flooding / mould / unusual condition"
          checked={input.unusualCondition}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, unusualCondition: checked }))}
        />
      </div>
    );
  }

  return (
    <ContactStep
      contact={input.contact}
      schedule={input.schedule}
      onScheduleChange={(schedule) => onInputChange((previous) => ({ ...previous, schedule }))}
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
}

function PostConstructionForm({ step, input, onInputChange, onPostalChange }: PostConstructionFormProps) {
  if (step === 1) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <InputPostalZone
          postalCode={input.postalCode}
          zone={input.zone}
          onPostalChange={onPostalChange}
          onZoneChange={(zone) => onInputChange((previous) => ({ ...previous, zone }))}
        />

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Project type</label>
          <select
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
          <label className="mb-1 block text-sm font-medium text-gray-700">Build type</label>
          <select
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
          <label className="mb-1 block text-sm font-medium text-gray-700">Square footage bracket</label>
          <select
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
          value={input.floors}
          onChange={(value) => onInputChange((previous) => ({ ...previous, floors: Math.max(1, value) }))}
          min={1}
        />
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Cleaning stage</label>
          <select
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
          <label className="mb-1 block text-sm font-medium text-gray-700">Dust load</label>
          <select
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
          <label className="mb-1 block text-sm font-medium text-gray-700">Interior windows</label>
          <select
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
          <label className="mb-1 block text-sm font-medium text-gray-700">Sticker/paint scraping</label>
          <select
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
          <label className="mb-1 block text-sm font-medium text-gray-700">Floor detailing</label>
          <select
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
          checked={input.insideCabinets}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, insideCabinets: checked }))}
        />
        <BooleanTile
          label="Appliance detailing"
          checked={input.appliances}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, appliances: checked }))}
        />
        <BooleanTile
          label="Special detailing (vents/baseboards/doors)"
          checked={input.specialDetailing}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, specialDetailing: checked }))}
        />
        <BooleanTile
          label="Multi-tenant access coordination"
          checked={input.multiTenantAccess}
          onChange={(checked) => onInputChange((previous) => ({ ...previous, multiTenantAccess: checked }))}
        />
      </div>
    );
  }

  return (
    <ContactStep
      contact={input.contact}
      schedule={input.schedule}
      onScheduleChange={(schedule) => onInputChange((previous) => ({ ...previous, schedule }))}
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
  postalCode,
  zone,
  onPostalChange,
  onZoneChange,
}: {
  postalCode: string;
  zone: WindowZone;
  onPostalChange: (value: string) => void;
  onZoneChange: (zone: WindowZone) => void;
}) {
  return (
    <>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Postal code</label>
        <input value={postalCode} onChange={(event) => onPostalChange(event.target.value)} className={fieldClass} placeholder="R5G 2X3" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Travel zone</label>
        <select value={zone} onChange={(event) => onZoneChange(event.target.value as WindowZone)} className={fieldClass}>
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
  value,
  min = 0,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      <input
        type="number"
        min={min}
        value={value}
        onChange={(event) => onChange(Math.max(min, Number(event.target.value) || 0))}
        className={fieldClass}
      />
    </div>
  );
}

function BooleanTile({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-gray-200 p-3 text-sm text-gray-700">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

interface ContactStepProps {
  contact: LeadContact;
  schedule?: SchedulePreference;
  onScheduleChange?: (value: SchedulePreference) => void;
  onContactChange: (field: keyof LeadContact, value: string | boolean) => void;
}

function ContactStep({ contact, schedule, onScheduleChange, onContactChange }: ContactStepProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700">
        <p className="font-semibold">Instant estimate delivery</p>
        <p className="mt-1">Once you submit, we generate your quote PDF and email the estimate results instantly.</p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Full name</label>
        <input
          value={contact.fullName}
          onChange={(event) => onContactChange('fullName', event.target.value)}
          className={fieldClass}
          placeholder="Jane Smith"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Phone number</label>
        <input
          value={contact.phone}
          onChange={(event) => onContactChange('phone', event.target.value)}
          className={fieldClass}
          placeholder="(431) 205-3909"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Email address</label>
        <input
          type="email"
          value={contact.email}
          onChange={(event) => onContactChange('email', event.target.value)}
          className={fieldClass}
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Property address (optional)</label>
        <input
          value={contact.address}
          onChange={(event) => onContactChange('address', event.target.value)}
          className={fieldClass}
          placeholder="120 Parkside Crescent, Mitchell"
        />
      </div>

      {schedule && onScheduleChange && (
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Preferred timeline</label>
          <select value={schedule} onChange={(event) => onScheduleChange(event.target.value as SchedulePreference)} className={fieldClass}>
            <option value="asap">ASAP</option>
            <option value="nextWeek">Next week</option>
            <option value="flexible">Flexible</option>
            <option value="tomorrow">Tomorrow</option>
          </select>
        </div>
      )}

      <label className="md:col-span-2 flex items-start gap-2 rounded-lg border border-gray-200 p-3 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={contact.consentToContact}
          onChange={(event) => onContactChange('consentToContact', event.target.checked)}
          className="mt-0.5"
        />
        I give permission for Steam Zone to contact me regarding this estimate and project details.
      </label>
    </div>
  );
}
