'use client';

import { useEffect, useRef } from 'react';

type Item = {
  text: string;
  side?: 'left' | 'right';
};

type Props = {
  items: Item[];
  startSide?: 'left' | 'right';
  className?: string;
};

// Stream of large alternating chat bubbles that animate in from off-screen with teardrop tails.
export default function ChatBubbles({ items, startSide = 'left', className = '' }: Props) {
  return (
    <div className={`chat-stream flex flex-col gap-16 ${className}`}>      
      {items.map((item, i) => (
        <AnimatedBubble
          key={i}
          text={item.text}
          side={(item.side ?? (i % 2 === 0 ? startSide : startSide === 'left' ? 'right' : 'left')) as 'left' | 'right'}
        />
      ))}
    </div>
  );
}

function AnimatedBubble({ text, side }: { text: string; side: 'left' | 'right' }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            el.dataset.inview = 'true';
            io.unobserve(el);
          }
        });
      },
      { threshold: 0.25 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`chat-bubble ${side}`} data-side={side} data-inview="false">{text}</div>
  );
}
