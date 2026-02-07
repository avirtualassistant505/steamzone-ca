import { useEffect, useMemo, useState } from 'react';
import { Clock3, Database, RefreshCw, Save } from 'lucide-react';
import {
  formatBookingMode,
  formatConfidence,
  formatCurrency,
  formatServiceLabel,
  loadEstimateRecords,
  type EstimateRecord,
  type PricingConfig,
  type WindowZone,
} from '../lib/estimateEngine';

interface AdminPricingPageProps {
  pricingConfig: PricingConfig;
  onSavePricingConfig: (nextConfig: PricingConfig) => void;
  onResetPricingConfig: () => void;
}

const cardClass = 'rounded-2xl border border-gray-200 bg-white p-6 shadow-sm';

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

export default function AdminPricingPage({ pricingConfig, onSavePricingConfig, onResetPricingConfig }: AdminPricingPageProps) {
  const [draftConfig, setDraftConfig] = useState<PricingConfig>(pricingConfig);
  const [saveMessage, setSaveMessage] = useState('');
  const [records, setRecords] = useState<EstimateRecord[]>(() => loadEstimateRecords());

  useEffect(() => {
    setDraftConfig(pricingConfig);
  }, [pricingConfig]);

  const latestRecords = useMemo(() => records.slice(0, 15), [records]);

  function refreshRecords(): void {
    setRecords(loadEstimateRecords());
  }

  function handleSave(): void {
    onSavePricingConfig(draftConfig);
    setSaveMessage('Pricing rules saved. All new quotes now use this configuration.');
  }

  function handleReset(): void {
    onResetPricingConfig();
    setSaveMessage('Pricing rules reset to defaults.');
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

  return (
    <main className="bg-slate-50 pb-20 pt-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold text-gray-900">Estimate Admin</h1>
            <p className="mt-3 max-w-3xl text-gray-600">
              Full pricing control for Steinbach routes: travel zones, per-service base rates, multipliers, add-ons,
              red flags, and estimate range behavior.
            </p>
            <p className="mt-2 text-sm text-gray-500">Last updated: {new Date(draftConfig.updatedAt).toLocaleString()}</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white transition hover:bg-blue-700"
            >
              <Save className="mr-2 h-4 w-4" />
              Save Pricing Rules
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-lg border border-gray-300 px-5 py-2.5 font-semibold text-gray-700 transition hover:bg-gray-100"
            >
              Reset Defaults
            </button>
          </div>
        </div>

        {saveMessage && <p className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{saveMessage}</p>}

        <section className={cardClass}>
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
            <button
              type="button"
              onClick={refreshRecords}
              className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </button>
          </div>

          {latestRecords.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-gray-600">
              No estimate records yet. Generate estimates from the Get Estimate page to populate this table.
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
              Pricing and estimates are currently browser-local. For multi-user shared admin and CRM sync, connect this
              schema to Supabase.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
