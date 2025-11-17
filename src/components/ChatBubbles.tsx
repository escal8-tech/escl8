'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

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
          side={(item.side ?? (i % 2 === 0 ? startSide : startSide === 'left' ? 'right' : 'left')) as
            | 'left'
            | 'right'}
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

    const fromX = side === 'left' ? -200 : 200;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { opacity: 0, x: fromX, y: 30 },
        {
          opacity: 1,
          x: 0,
          y: 0,
          duration: 0.9,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: el,
            start: 'top 80%',   // when bubble enters viewport
            toggleActions: 'play none none none',
          },
        }
      );
    });

    return () => {
      ctx.revert();
      ScrollTrigger.getAll().forEach((st) => {
        if (st.trigger === el) st.kill();
      });
    };
  }, [side]);

  return (
    <div ref={ref} className={`chat-bubble ${side}`} data-side={side}>
      {text}
    </div>
  );
}