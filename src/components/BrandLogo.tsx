import { useId } from 'react';

type BrandLogoProps = {
  className?: string;
  href?: string;
  size?: 'nav' | 'footer';
  variant?: 'light' | 'dark';
};

export default function BrandLogo({
  className = '',
  href = '#',
  size = 'nav',
  variant = 'light',
}: BrandLogoProps) {
  const gradientId = useId();

  const isFooter = size === 'footer';
  const isDark = variant === 'dark';

  const rootClass = `inline-flex shrink-0 items-center group ${isFooter ? 'gap-3' : 'gap-4'} ${className}`.trim();
  const iconWrapClass = isFooter
    ? 'relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 via-blue-600 to-indigo-700 shadow-md ring-1 ring-blue-300/30'
    : 'relative flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 via-blue-600 to-indigo-700 shadow-md ring-1 ring-blue-200';
  const iconClass = isFooter ? 'h-7 w-7' : 'h-8 w-8';
  const titleClass = isDark
    ? `block font-black leading-none tracking-[-0.02em] text-slate-50 ${isFooter ? 'text-[1.45rem]' : 'text-[1.65rem]'}`
    : `block font-black leading-none tracking-[-0.02em] text-slate-900 ${isFooter ? 'text-[1.45rem]' : 'text-[1.65rem]'}`;
  const accentClass = isDark
    ? 'text-cyan-300 group-hover:text-cyan-200 transition'
    : 'text-blue-600 group-hover:text-blue-700 transition';
  const subtitleClass = isDark
    ? 'mt-1 block text-[0.64rem] font-bold uppercase leading-none tracking-[0.22em] text-slate-400'
    : 'mt-1 block text-[0.68rem] font-bold uppercase leading-none tracking-[0.22em] text-slate-500';

  return (
    <a href={href} className={rootClass} aria-label="Steam Zone home">
      <span className={iconWrapClass}>
        <svg viewBox="0 0 48 48" className={iconClass} aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#dbeafe" />
            </linearGradient>
          </defs>
          <path
            fill={`url(#${gradientId})`}
            d="M24 8C17 16.7 13 21.8 13 28c0 6.1 4.9 11 11 11s11-4.9 11-11c0-6.2-4-11.3-11-20z"
          />
          <path fill="#bfdbfe" d="M21 28.5c0 1.7-1.4 3.1-3.1 3.1-.4 0-.8-.1-1.2-.2.7 2.8 3.3 4.9 6.3 4.9 3.6 0 6.5-2.9 6.5-6.5 0-1.6-.6-3.1-1.6-4.2-1 1.6-2.8 2.7-4.9 2.7-.7 0-1.4-.1-2-.3.1.2.1.3.1.5z" />
        </svg>
      </span>

      <span className="flex flex-col justify-center pt-0.5">
        <span className={titleClass}>
          Steam <span className={accentClass}>Zone</span>
        </span>
        <span className={subtitleClass}>
          Cleaning Services
        </span>
      </span>
    </a>
  );
}
