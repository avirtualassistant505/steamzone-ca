import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = '/Users/ghl/Documents/websites/steamzone.ca';
const CACHE_DIR = path.join(ROOT, 'tmp', 'voice-adaptive-cache');
const DEFAULT_URL = process.env.VOICE_TEST_URL?.trim() || 'https://steamzoneca.vercel.app/call-us';
const GHL_PROFILE = process.env.GHL_PROFILE?.trim() || 'prod';
const LOCATION_ID = process.env.GHL_LOCATION_ID?.trim() || 'Aag4ejfEf7EHEqPlsQ2R';
const MAX_RUNTIME_MS = Number(process.env.VOICE_TEST_TIMEOUT_MS || 240000);
const POLL_MS = Number(process.env.VOICE_TEST_POLL_MS || 4000);
const STARTUP_WAIT_MS = 8000;
const MAX_PROMPT_REPEATS = 2;
const MAX_IDLE_POLLS = 8;

const scenario = {
  name: 'carpet_case_1',
  initial: 'I would like a carpet cleaning estimate.',
  answers: {
    continueCall: 'Yes, continue the estimate on the call.',
    serviceType: 'Carpet cleaning.',
    postalCode: 'R like Romeo, 5, G like golf, 2, X like x-ray, 3.',
    estimateMode: 'By rooms.',
    rooms: '4.',
    condition: 'Moderate.',
    stairsSteps: '10.',
    hallways: '1.',
    furnitureMoving: 'Light.',
    advancedStainRemoval: 'Yes.',
    odorElimination: 'No.',
    petTreatment: 'No.',
    stainProtector: 'Yes.',
    unusualCondition: 'No.',
    schedule: 'ASAP.',
    fullName: 'Alex Martin.',
    phone: '2 0 4 5 0 1 1 2 6 4.',
    email: 'alex dot martin dot test at example dot com.',
    address: '101 Test Avenue, Steinbach.',
    consentToContact: 'Yes.',
    marketingOptIn: 'No.',
    confirm: 'Yes.',
  },
};

const promptMatchers = [
  { key: 'initial', patterns: [/how can i help/i, /what can i help/i, /what can i do for you/i] },
  { key: 'continueCall', patterns: [/still want to continue/i, /do you still want to continue/i, /are you still there/i, /want me to keep going/i, /want to keep going/i, /continue the estimate on the call/i] },
  { key: 'serviceType', patterns: [/which service/i, /what service/i, /carpet cleaning estimate\?/i, /residential window/i, /commercial window/i, /post-construction/i] },
  { key: 'postalCode', patterns: [/postal code/i, /letters and numbers/i, /r2g3x3/i] },
  { key: 'estimateMode', patterns: [/measure carpet estimate/i, /estimate method/i, /rooms or square footage/i, /by rooms|square footage/i] },
  { key: 'rooms', patterns: [/how many (bed)?rooms/i, /room count/i] },
  { key: 'condition', patterns: [/condition level/i, /soil\/condition/i, /what is the soil/i] },
  { key: 'stairsSteps', patterns: [/stairs/i, /steps/i] },
  { key: 'hallways', patterns: [/hallways/i, /corridors/i] },
  { key: 'furnitureMoving', patterns: [/furniture moving/i, /none, light, or heavy/i] },
  { key: 'advancedStainRemoval', patterns: [/advanced stain removal/i] },
  { key: 'odorElimination', patterns: [/odor elimination/i, /odor treatment/i] },
  { key: 'petTreatment', patterns: [/pet treatment/i] },
  { key: 'stainProtector', patterns: [/stain protector/i] },
  { key: 'unusualCondition', patterns: [/unusual condition/i, /flooding/i, /mould/i, /mold/i] },
  { key: 'schedule', patterns: [/best time/i, /preferred timeline/i, /when is the best time/i, /asap|next week|flexible|tomorrow/i] },
  { key: 'fullName', patterns: [/full name/i, /what.?s your name/i, /what is your name/i] },
  { key: 'phone', patterns: [/callback number/i, /phone number/i, /best callback/i, /read the digits/i] },
  { key: 'email', patterns: [/email/i, /spell it out/i, /spell the/i] },
  { key: 'address', patterns: [/service address/i, /street address/i, /address and city/i, /property address/i] },
  { key: 'consentToContact', patterns: [/permission to contact/i, /consent to contact/i, /permission to store/i] },
  { key: 'marketingOptIn', patterns: [/offers and updates/i, /marketing/i, /occasional offers/i] },
  { key: 'confirm', patterns: [/is that correct/i, /correct\?/i, /did i get that right/i, /just to confirm/i] },
];

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function lastBotLine(transcript) {
  const lines = String(transcript || '').split(/\n+/).map((line) => normalizeText(line)).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].toLowerCase().startsWith('bot:')) return lines[i].slice(4).trim();
  }
  return '';
}

function latestHumanLine(transcript) {
  const lines = String(transcript || '').split(/\n+/).map((line) => normalizeText(line)).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].toLowerCase().startsWith('human:')) return lines[i].slice(6).trim();
  }
  return '';
}

function chooseAnswer(botLine, state) {
  const text = normalizeText(botLine);
  if (!text) return null;
  for (const entry of promptMatchers) {
    if (entry.patterns.some((pattern) => pattern.test(text))) {
      if (entry.key === 'confirm') return scenario.answers.confirm;
      if (entry.key === 'initial') return scenario.initial;
      if (entry.key === 'continueCall') return scenario.answers.continueCall;
      const response = scenario.answers[entry.key];
      if (!response) continue;
      state.matched.push({ bot: text, field: entry.key, answer: response, at: new Date().toISOString() });
      return response;
    }
  }
  return null;
}

function getVoiceLogs() {
  const raw = execFileSync('ghl-admin', ['--profile', GHL_PROFILE, 'voice-ai-call-logs'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(raw);
}

function findCurrentCall(logs, startedAtMs) {
  const callLogs = logs?.result?.callLogs || [];
  return [...callLogs]
    .filter((entry) => {
      const created = Date.parse(entry.createdAt || '');
      return Number.isFinite(created) && created >= startedAtMs - 15000;
    })
    .sort((left, right) => Date.parse(right.createdAt || '') - Date.parse(left.createdAt || ''))[0] || null;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'clip';
}

function ensureClip(text) {
  const slug = slugify(text);
  const wavPath = path.join(CACHE_DIR, `${slug}.wav`);
  if (fs.existsSync(wavPath)) return wavPath;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-clip-'));
  const txtPath = path.join(tmpDir, 'clip.txt');
  const aiffPath = path.join(tmpDir, 'clip.aiff');
  fs.writeFileSync(txtPath, text + '\n');
  execFileSync('say', ['-v', 'Samantha', '-r', '150', '-f', txtPath, '-o', aiffPath], { stdio: 'ignore' });
  execFileSync('ffmpeg', ['-y', '-i', aiffPath, '-ar', '48000', '-ac', '1', wavPath], { stdio: 'ignore' });
  return wavPath;
}

function wavToBase64(filePath) {
  return fs.readFileSync(filePath).toString('base64');
}

async function installSyntheticMic(page) {
  await page.evaluate(() => {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const ctx = new AudioContext({ sampleRate: 48000 });
    const dest = ctx.createMediaStreamDestination();
    const mixer = ctx.createGain();
    mixer.gain.value = 1;
    mixer.connect(dest);
    const silenceBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const silenceSource = ctx.createBufferSource();
    silenceSource.buffer = silenceBuffer;
    silenceSource.loop = true;
    silenceSource.connect(mixer);
    silenceSource.start();
    const queue = [];
    let draining = false;

    async function decodeBase64Audio(base64) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return await ctx.decodeAudioData(bytes.buffer.slice(0));
    }

    async function drain() {
      if (draining) return;
      draining = true;
      try {
        while (queue.length > 0) {
          const { base64, resolve, reject } = queue.shift();
          try {
            await ctx.resume();
            const buffer = await decodeBase64Audio(base64);
            await new Promise((done) => {
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(mixer);
              source.onended = done;
              source.start();
            });
            resolve(true);
          } catch (error) {
            reject(error instanceof Error ? error.message : String(error));
          }
        }
      } finally {
        draining = false;
      }
    }

    window.__voiceHarness = {
      async resume() {
        await ctx.resume();
        return true;
      },
      async enqueue(base64) {
        return await new Promise((resolve, reject) => {
          queue.push({ base64, resolve, reject });
          void drain();
        });
      },
      async isReady() {
        return {
          state: ctx.state,
          trackCount: dest.stream.getAudioTracks().length,
        };
      },
      stream: dest.stream,
    };

    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints && typeof constraints === 'object' && constraints.audio) {
        await ctx.resume();
        return dest.stream;
      }
      return originalGetUserMedia(constraints);
    };
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1400, height: 1200 } });
  const page = await context.newPage();

  const state = {
    startedAtMs: Date.now(),
    callId: null,
    lastTranscriptLength: 0,
    lastBotLine: '',
    lastHumanLine: '',
    matched: [],
    audioSent: [],
    promptRepeatCount: {},
    idlePolls: 0,
    outcome: 'timeout',
    lastExecutedActions: [],
  };

  await page.goto(DEFAULT_URL, { waitUntil: 'domcontentloaded' });
  await installSyntheticMic(page);
  await page.waitForTimeout(STARTUP_WAIT_MS);
  await page.locator('chat-widget').evaluate(async (el) => {
    const deep = el.shadowRoot?.querySelector('.lc_text-widget--voice-talk-button')?.shadowRoot?.querySelector('button');
    if (!deep) throw new Error('no button');
    deep.click();
    await window.__voiceHarness.resume();
  });

  const deadline = Date.now() + MAX_RUNTIME_MS;
  while (Date.now() < deadline) {
    await page.waitForTimeout(POLL_MS);
    let call = null;
    try {
      const logs = getVoiceLogs();
      call = findCurrentCall(logs, state.startedAtMs);
    } catch (error) {
      console.error('log-poll-failed', error instanceof Error ? error.message : String(error));
      continue;
    }
    if (!call) continue;
    if (!state.callId) state.callId = call.id;
    if (call.id !== state.callId) continue;

    const transcript = String(call.transcript || '');
    const transcriptLength = transcript.length;
    const botLine = lastBotLine(transcript);
    const humanLine = latestHumanLine(transcript);
    state.lastExecutedActions = (call.executedCallActions || []).map((a) => a.actionName);
    console.log('poll', JSON.stringify({ callId: call.id, transcriptLength, botLine, humanLine, executedActions: (call.executedCallActions || []).map((a) => a.actionName) }));

    const quoteTriggered = (call.executedCallActions || []).some((a) => /create estimate/i.test(String(a.actionName || '')));
    if (quoteTriggered) {
      console.log('quote-action-triggered');
      state.outcome = 'quote_action_triggered';
      break;
    }

    if (transcriptLength <= state.lastTranscriptLength && botLine === state.lastBotLine && humanLine === state.lastHumanLine) {
      state.idlePolls += 1;
      if (state.idlePolls >= MAX_IDLE_POLLS) {
        console.log('idle-timeout');
        state.outcome = humanLine ? 'idle_after_progress' : 'no_human_transcription';
        break;
      }
      continue;
    }
    state.idlePolls = 0;
    state.lastTranscriptLength = transcriptLength;
    state.lastHumanLine = humanLine;

    if (!botLine) continue;

    const isNewPrompt = botLine !== state.lastBotLine;
    if (isNewPrompt) {
      state.lastBotLine = botLine;
      state.promptRepeatCount[botLine] = 0;
    } else {
      state.promptRepeatCount[botLine] = (state.promptRepeatCount[botLine] || 0) + 1;
      if (state.promptRepeatCount[botLine] > MAX_PROMPT_REPEATS) continue;
    }

    const answer = chooseAnswer(botLine, state);
    if (answer) {
      const clip = ensureClip(answer);
      await page.evaluate(async (base64) => window.__voiceHarness.enqueue(base64), wavToBase64(clip));
      state.audioSent.push({ prompt: botLine, answer, at: new Date().toISOString() });
      console.log('answered', JSON.stringify({ botLine, answer, retry: state.promptRepeatCount[botLine] || 0 }));
    }
  }

  const report = {
    scenario: scenario.name,
    url: DEFAULT_URL,
    startedAt: new Date(state.startedAtMs).toISOString(),
    callId: state.callId,
    outcome: state.outcome,
    lastBotLine: state.lastBotLine,
    lastHumanLine: state.lastHumanLine,
    lastExecutedActions: state.lastExecutedActions,
    matched: state.matched,
    audioSent: state.audioSent,
  };
  const outPath = path.join(ROOT, 'tmp', `voice_adaptive_regression_${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('report', outPath);
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
