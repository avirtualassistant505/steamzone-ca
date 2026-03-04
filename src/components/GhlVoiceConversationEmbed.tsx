import { useEffect, useRef } from 'react';

const GHL_SCRIPT_SRC = 'https://widgets.leadconnectorhq.com/loader.js';
const GHL_RESOURCES_URL = 'https://widgets.leadconnectorhq.com/chat-widget/loader.js';
const GHL_WIDGET_ID = '698926cae64c73005344d35c';
const GHL_VOICE_INSTANCE_ID = 'steamzone-call-us-voice';
const GHL_VOICE_AGENT_ID = String(import.meta.env.VITE_GHL_VOICE_AGENT_ID ?? '').trim();

function removeVoiceArtifacts(root: HTMLElement | null): void {
  const queryRoot = root ?? document.body;
  const selectors = [
    `script[data-loader-instance="${GHL_VOICE_INSTANCE_ID}"]`,
    `chat-widget[data-loader-instance-id="${GHL_VOICE_INSTANCE_ID}"]`,
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
    script.setAttribute('data-resources-url', GHL_RESOURCES_URL);
    script.setAttribute('data-widget-id', GHL_WIDGET_ID);
    script.setAttribute('data-loader-instance', GHL_VOICE_INSTANCE_ID);
    script.setAttribute('data-inline-mode', 'true');
    script.setAttribute('data-inline-live-chat-mode', 'true');
    script.setAttribute('data-inline-prompt-mode', 'true');
    script.setAttribute('data-inline-success-mode', 'true');
    script.setAttribute('data-inline-live-chat-success-mode', 'true');

    // If a voice agent is configured, request the Voice AI mode from GHL widget.
    if (GHL_VOICE_AGENT_ID) {
      script.setAttribute('chat-type', 'voiceAi');
      script.setAttribute('voice-ai-agent', GHL_VOICE_AGENT_ID);
      script.setAttribute('voice-ai-show-ui', 'true');
    }

    host.appendChild(script);

    const relocation = window.setInterval(() => {
      const widget = document.querySelector(`chat-widget[data-loader-instance-id="${GHL_VOICE_INSTANCE_ID}"]`);
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
