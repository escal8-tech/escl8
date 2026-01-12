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

// Stream of large alternating chat bubbles that animate in from off-screen with smooth scroll animations.
export default function ChatBubbles({ items, startSide = 'left', className = '' }: Props) {
  return (
    <div className={`chat-stream ${className}`}>
      {items.map((item, i) => (
        <AnimatedBubble
          key={i}
          text={item.text}
          side={(item.side ?? (i % 2 === 0 ? startSide : startSide === 'left' ? 'right' : 'left')) as
            | 'left'
            | 'right'}
          index={i}
        />
      ))}
    </div>
  );
}

function AnimatedBubble({ text, side, index }: { text: string; side: 'left' | 'right'; index: number }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Start position - further off screen for smoother entrance
    const fromX = side === 'left' ? -120 : 120;

    // Set initial state
    gsap.set(el, { 
      opacity: 0, 
      x: fromX,
      scale: 0.95
    });

    const ctx = gsap.context(() => {
      gsap.to(el, {
        opacity: 1,
        x: 0,
        scale: 1,
        duration: 1,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: el,
          start: 'top 85%',
          end: 'top 50%',
          toggleActions: 'play none none none',
        },
        delay: index * 0.1, // Stagger effect
      });
    });

    return () => {
      ctx.revert();
      ScrollTrigger.getAll().forEach((st) => {
        if (st.trigger === el) st.kill();
      });
    };
  }, [side, index]);

  return (
    <div ref={ref} className={`chat-bubble ${side}`} data-side={side}>
      {text}
    </div>
  );
}