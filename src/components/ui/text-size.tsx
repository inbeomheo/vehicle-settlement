'use client';
import { useEffect, useState } from 'react';

/**
 * 글자 크기 조절. 앱 전체가 rem 단위라 루트 글자 크기만 바꾸면
 * 버튼·입력칸·간격이 함께 커진다. 선택은 이 기기에만 기억한다.
 */
const sizes = [
  { key: 'normal', label: '보통', px: 16 },
  { key: 'large', label: '크게', px: 18 },
  { key: 'xlarge', label: '아주 크게', px: 20 },
] as const;
type SizeKey = (typeof sizes)[number]['key'];
const storageKey = 'vehicle-text-size';

function read(fallback: SizeKey): SizeKey {
  try {
    const saved = localStorage.getItem(storageKey);
    return sizes.some((size) => size.key === saved) ? (saved as SizeKey) : fallback;
  } catch {
    return fallback;
  }
}

function apply(key: SizeKey) {
  const size = sizes.find((item) => item.key === key) ?? sizes[0];
  document.documentElement.style.fontSize = `${size.px}px`;
}

/** 페이지가 그려지기 전에 저장된 크기를 적용하는 스크립트(깜빡임 방지). */
export function TextSizeScript({ fallback }: { fallback: SizeKey }) {
  const px = Object.fromEntries(sizes.map((size) => [size.key, size.px]));
  const code = `try{var k=localStorage.getItem('${storageKey}');var m=${JSON.stringify(px)};document.documentElement.style.fontSize=(m[k]||m['${fallback}'])+'px'}catch(e){}`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

export function TextSizeControl({
  fallback,
  tone = 'light',
}: {
  fallback: SizeKey;
  tone?: 'light' | 'dark';
}) {
  const [current, setCurrent] = useState<SizeKey>(fallback);
  useEffect(() => setCurrent(read(fallback)), [fallback]);
  function choose(key: SizeKey) {
    setCurrent(key);
    apply(key);
    try {
      localStorage.setItem(storageKey, key);
    } catch {
      /* 저장이 막힌 브라우저에서는 이번 화면에만 적용한다. */
    }
  }
  return (
    <div
      role="radiogroup"
      aria-label="글자 크기"
      className={`inline-flex rounded-lg p-0.5 ${tone === 'dark' ? 'bg-white/10' : 'bg-slate-200'}`}
    >
      {sizes.map((size, index) => {
        const on = current === size.key;
        return (
          <button
            key={size.key}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`글자 ${size.label}`}
            onClick={() => choose(size.key)}
            className={`h-11 w-11 rounded-md font-bold ${
              on
                ? tone === 'dark'
                  ? 'bg-white text-ink'
                  : 'bg-white text-ink shadow-sm'
                : tone === 'dark'
                  ? 'text-slate-300'
                  : 'text-slate-600'
            }`}
            style={{ fontSize: `${(13 + index * 3) / 16}rem`, lineHeight: 1 }}
          >
            가
          </button>
        );
      })}
    </div>
  );
}
