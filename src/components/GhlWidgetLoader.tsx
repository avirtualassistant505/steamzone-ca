import { useEffect } from 'react';

const GHL_SCRIPT_ID = 'ghl-chat-widget-loader';
const GHL_SCRIPT_SRC = 'https://widgets.leadconnectorhq.com/loader.js';
const GHL_RESOURCES_URL = 'https://widgets.leadconnectorhq.com/chat-widget/loader.js';
const GHL_WIDGET_ID = '698926cae64c73005344d35c';
const GHL_CHAT_INSTANCE_ID = 'steamzone-floating-chat';

function removeGhlArtifacts(): void {
  const script = document.getElementById(GHL_SCRIPT_ID);
  if (script) {
    script.remove();
  }

  const scriptSelectors = [
    `script[data-loader-instance="${GHL_CHAT_INSTANCE_ID}"]`,
    `script[src="${GHL_SCRIPT_SRC}"][data-widget-id="${GHL_WIDGET_ID}"]`,
  ];
  for (const selector of scriptSelectors) {
    document.querySelectorAll(selector).forEach((node) => node.remove());
  }

  const widgetSelectors = [
    `chat-widget[data-loader-instance-id="${GHL_CHAT_INSTANCE_ID}"]`,
    `chat-widget[widget-id="${GHL_WIDGET_ID}"]`,
    `[data-loader-instance-id="${GHL_CHAT_INSTANCE_ID}"]`,
  ];
  for (const selector of widgetSelectors) {
    document.querySelectorAll(selector).forEach((node) => {
      const element = node as HTMLElement;
      if (element.id === 'root') return;
      element.remove();
    });
  }
}

function ensureGhlScript(): void {
  const existing = document.getElementById(GHL_SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    return;
  }

  const script = document.createElement('script');
  script.id = GHL_SCRIPT_ID;
  script.src = GHL_SCRIPT_SRC;
  script.async = true;
  script.setAttribute('data-resources-url', GHL_RESOURCES_URL);
  script.setAttribute('data-widget-id', GHL_WIDGET_ID);
  script.setAttribute('data-loader-instance', GHL_CHAT_INSTANCE_ID);
  document.body.appendChild(script);
}

export default function GhlWidgetLoader({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (enabled) {
      ensureGhlScript();
      return;
    }

    removeGhlArtifacts();
  }, [enabled]);

  return null;
}
