import GhlVoiceConversationEmbed from '../components/GhlVoiceConversationEmbed';
import { langText, useSiteLanguage } from '../i18n/siteLanguage';

const ghlVoiceConversationEmbedUrl = String(import.meta.env.VITE_GHL_VOICE_CONVERSATION_EMBED_URL ?? '').trim();

function sanitizeEmbedUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl);
    if (!/^https?:$/.test(parsed.protocol)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

export default function CallUsPage() {
  const { language } = useSiteLanguage();
  const voiceEmbedUrl = sanitizeEmbedUrl(ghlVoiceConversationEmbedUrl);

  return (
    <main className="bg-gradient-to-br from-slate-50 via-blue-50 to-white pb-20 pt-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-gray-900 md:text-5xl">
            {langText(language, { en: 'Call Us', es: 'Llámanos' })}
          </h1>
          <p className="mx-auto mt-4 max-w-3xl text-lg text-gray-600">
            {langText(language, {
              en: 'Talk to our AI voice assistant for instant estimates and service questions.',
              es: 'Habla con nuestro asistente de voz con IA para cotizaciones instantáneas y preguntas de servicio.',
            })}
          </p>
        </div>

        <section className="overflow-hidden rounded-2xl border border-blue-100 bg-white p-3 shadow-sm sm:p-4">
          {voiceEmbedUrl ? (
            <iframe
              title={langText(language, { en: 'Steam Zone Voice Assistant', es: 'Asistente de Voz de Steam Zone' })}
              src={voiceEmbedUrl}
              className="h-[760px] w-full rounded-xl"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          ) : (
            <GhlVoiceConversationEmbed />
          )}
        </section>

        <p className="mt-4 text-center text-sm text-gray-500">
          {langText(language, {
            en: 'If microphone permission is blocked, allow mic access in your browser and refresh.',
            es: 'Si el permiso del micrófono está bloqueado, habilítalo en tu navegador y recarga.',
          })}
        </p>
      </div>
    </main>
  );
}

