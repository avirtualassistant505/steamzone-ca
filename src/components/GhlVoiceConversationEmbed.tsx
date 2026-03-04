import { useEffect, useRef } from 'react';

const GHL_SCRIPT_SRC = 'https://widgets.leadconnectorhq.com/loader.js';
const GHL_RESOURCES_URL = 'https://widgets.leadconnectorhq.com/chat-widget/loader.js';
const GHL_DEFAULT_LOCATION_ID = 'Aag4ejfEf7EHEqPlsQ2R';
const GHL_DEFAULT_VOICE_AGENT_ID = '6987a47137411f2a349c4abf';
const GHL_VOICE_INSTANCE_ID = 'steamzone-call-us-voice';
const GHL_VOICE_SCRIPT_MARKER_ATTR = 'data-steamzone-voice-loader';

const GHL_LOCATION_ID =
  String(import.meta.env.VITE_GHL_LOCATION_ID ?? '').trim() || GHL_DEFAULT_LOCATION_ID;
const GHL_WIDGET_ID = String(import.meta.env.VITE_GHL_VOICE_WIDGET_ID ?? '').trim();
const GHL_VOICE_AGENT_ID =
  String(import.meta.env.VITE_GHL_VOICE_AGENT_ID ?? '').trim() || GHL_DEFAULT_VOICE_AGENT_ID;
const GHL_VOICE_AGENT_NAME = String(import.meta.env.VITE_GHL_VOICE_AGENT_NAME ?? '').trim();
const GHL_VOICE_AGENT_DESCRIPTION = String(import.meta.env.VITE_GHL_VOICE_AGENT_DESCRIPTION ?? '').trim();

function buildVoiceAgentConfig(): string {
  if (!GHL_VOICE_AGENT_ID) {
    return '';
  }
  const payload: Record<string, string | boolean> = {
    agentId: GHL_VOICE_AGENT_ID,
    isActive: true,
  };
  if (GHL_VOICE_AGENT_NAME) {
    payload.agentName = GHL_VOICE_AGENT_NAME;
  }
  if (GHL_VOICE_AGENT_DESCRIPTION) {
    payload.description = GHL_VOICE_AGENT_DESCRIPTION;
  }
  return JSON.stringify(payload);
}

function removeVoiceArtifacts(root: HTMLElement | null): void {
  const queryRoot = root ?? document.body;
  const selectors = [
    `script[${GHL_VOICE_SCRIPT_MARKER_ATTR}="true"]`,
    `script[data-loader-instance="${GHL_VOICE_INSTANCE_ID}"]`,
    `chat-widget[data-loader-instance-id="${GHL_VOICE_INSTANCE_ID}"]`,
    'chat-widget[chat-type="voiceAiChat"]',
    'chat-widget[voice-ai-agent]',
    `[data-loader-instance-id="${GHL_VOICE_INSTANCE_ID}"]`,
  ];
  for (const selector of selectors) {
    queryRoot.querySelectorAll(selector).forEach((node) => node.remove());
  }
}

export default function GhlVoiceConversationEmbed() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    removeVoiceArtifacts(document.body);

    const script = document.createElement('script');
    script.src = GHL_SCRIPT_SRC;
    script.async = true;
    script.setAttribute(GHL_VOICE_SCRIPT_MARKER_ATTR, 'true');
    script.setAttribute('data-resources-url', GHL_RESOURCES_URL);
    if (GHL_WIDGET_ID) {
      script.setAttribute('data-widget-id', GHL_WIDGET_ID);
    } else if (GHL_LOCATION_ID) {
      // Location mode prevents widget-config overrides from forcing liveChat.
      script.setAttribute('data-location-id', GHL_LOCATION_ID);
    }
    script.setAttribute('data-loader-instance', GHL_VOICE_INSTANCE_ID);
    script.setAttribute('data-inline-mode', 'true');
    script.setAttribute('data-inline-live-chat-mode', 'true');
    script.setAttribute('data-inline-prompt-mode', 'true');
    script.setAttribute('data-inline-success-mode', 'true');
    script.setAttribute('data-inline-live-chat-success-mode', 'true');
    script.setAttribute('chat-type', 'voiceAiChat');
    script.setAttribute('voice-ai-show-ui', 'true');
    const voiceAgentConfig = buildVoiceAgentConfig();
    if (voiceAgentConfig) {
      // GHL widget expects a JSON string payload, not a raw agent id.
      script.setAttribute('voice-ai-agent', voiceAgentConfig);
    }

    host.appendChild(script);

    const relocation = window.setInterval(() => {
      const widget =
        document.querySelector('chat-widget[chat-type="voiceAiChat"]') ??
        document.querySelector('chat-widget[voice-ai-agent]');
      if (!widget || widget.parentElement === host) return;
      host.appendChild(widget);
    }, 250);

    return () => {
      window.clearInterval(relocation);
      removeVoiceArtifacts(document.body);
    };
  }, []);

  return <div ref={hostRef} className="w-full min-h-[760px]" />;
}
