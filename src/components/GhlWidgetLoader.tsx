import { useEffect } from 'react';

const GHL_SCRIPT_ID = 'ghl-chat-widget-loader';
const GHL_SCRIPT_SRC = 'https://widgets.leadconnectorhq.com/loader.js';
const GHL_RESOURCES_URL = 'https://widgets.leadconnectorhq.com/chat-widget/loader.js';
const GHL_WIDGET_ID = '698926cae64c73005344d35c';

function removeGhlArtifacts(): void {
  const script = document.getElementById(GHL_SCRIPT_ID);
  if (script) {
    script.remove();
  }

  const selectors = [
    'iframe[src*="leadconnectorhq.com"]',
    'script[src*="leadconnectorhq.com/chat-widget"]',
    '[id*="chat-widget"]',
    '[class*="chat-widget"]',
    '[data-widget-id="698926cae64c73005344d35c"]',
  ];

  for (const selector of selectors) {
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
