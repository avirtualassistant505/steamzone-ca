import { useEffect, useRef } from 'react';

const GHL_SCRIPT_SRC = 'https://widgets.leadconnectorhq.com/loader.js';
const GHL_RESOURCES_URL = 'https://widgets.leadconnectorhq.com/chat-widget/loader.js';
const GHL_WIDGET_ID = '698926cae64c73005344d35c';
const GHL_VOICE_INSTANCE_ID = 'steamzone-call-us-voice';

function removeVoiceArtifacts(root: HTMLElement | null): void {
  if (!root) return;
  const selectors = [
    `script[data-loader-instance="${GHL_VOICE_INSTANCE_ID}"]`,
    `chat-widget[data-loader-instance-id="${GHL_VOICE_INSTANCE_ID}"]`,
    `[data-loader-instance-id="${GHL_VOICE_INSTANCE_ID}"]`,
  ];
  for (const selector of selectors) {
    root.querySelectorAll(selector).forEach((node) => node.remove());
  }
}

export default function GhlVoiceConversationEmbed() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    removeVoiceArtifacts(host);

    const container = document.createElement('div');
    container.setAttribute('data-chat-widget', '');
    container.className = 'min-h-[720px]';

    const script = document.createElement('script');
    script.src = GHL_SCRIPT_SRC;
    script.async = true;
    script.setAttribute('data-resources-url', GHL_RESOURCES_URL);
    script.setAttribute('data-widget-id', GHL_WIDGET_ID);
    script.setAttribute('data-loader-instance', GHL_VOICE_INSTANCE_ID);
    script.setAttribute('chat-type', 'voice');

    container.appendChild(script);
    host.appendChild(container);

    return () => {
      removeVoiceArtifacts(host);
      container.remove();
    };
  }, []);

  return <div ref={hostRef} className="w-full" />;
}

