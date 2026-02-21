"use client";

import Image from "next/image";
import { useState } from "react";
import styles from "./page.module.css";

const testimonials = [
  {
    quote:
      "Before Escal8, our team was constantly switching between WhatsApp, Instagram, and live chat just to keep up. Now everything runs through one inbox, and the AI handles most incoming questions automatically. We're responding faster and closing more deals without hiring more agents.",
    name: "Adams Smith",
    role: "Head of Growth, Nova Digital",
  },
  {
    quote:
      "Escal8 gave us one place to manage every channel. We cut repetitive support work, responded faster to new leads, and kept service quality consistent even during peak hours.",
    name: "Lila Azar",
    role: "Operations Lead, Scale Commerce",
  },
  {
    quote:
      "Our team stopped jumping across apps and started focusing on sales. The assistant qualifies intent, answers routine questions, and passes high-value conversations to reps at the right moment.",
    name: "Peter Parker",
    role: "Revenue Manager, Bright Retail",
  },
  {
    quote:
      "We used to lose inquiries outside office hours. With Escal8 running 24/7, every conversation is captured, answered, and tracked so we can follow up with full context.",
    name: "Elena John",
    role: "Customer Success Manager, Orbit Labs",
  },
];

export default function TestimonialCarousel() {
  const [activeTestimonial, setActiveTestimonial] = useState(0);
  const currentTestimonial = testimonials[activeTestimonial];

  const handlePrevTestimonial = () => {
    setActiveTestimonial((prev) =>
      prev === 0 ? testimonials.length - 1 : prev - 1
    );
  };

  const handleNextTestimonial = () => {
    setActiveTestimonial((prev) =>
      prev === testimonials.length - 1 ? 0 : prev + 1
    );
  };

  return (
    <div className={styles.testimonialCarousel}>
      <article className={styles.testimonialCard}>
        <div className={styles.testimonialPhoto}>
          <Image
            src="/landing/feature-orbit-core.png"
            alt={`${currentTestimonial.name} portrait`}
            width={422}
            height={490}
            className={styles.testimonialImage}
          />
        </div>
        <div className={styles.testimonialContent}>
          <Image
            src="/landing/quote-icon.svg"
            alt=""
            width={56}
            height={52}
            className={styles.quoteMark}
          />
          <p>{currentTestimonial.quote}</p>
          <div className={styles.person}>
            <strong>- {currentTestimonial.name}</strong>
            <span>{currentTestimonial.role}</span>
          </div>
        </div>
      </article>

      <div className={styles.testimonialControls}>
        <button
          type="button"
          className={`${styles.testimonialNavButton} ${styles.testimonialPrev}`}
          onClick={handlePrevTestimonial}
          aria-label="Show previous testimonial"
        >
          <span className={styles.testimonialNavIcon} aria-hidden />
        </button>
        <div className={styles.testimonialDots} aria-label="Testimonial slides">
          {testimonials.map((item, index) => (
            <button
              key={`${item.name}-${index}`}
              type="button"
              onClick={() => setActiveTestimonial(index)}
              aria-label={`Show testimonial ${index + 1}`}
              aria-pressed={activeTestimonial === index}
              className={`${styles.testimonialDot} ${
                activeTestimonial === index ? styles.testimonialDotActive : ""
              }`}
            />
          ))}
        </div>
        <button
          type="button"
          className={styles.testimonialNavButton}
          onClick={handleNextTestimonial}
          aria-label="Show next testimonial"
        >
          <span className={styles.testimonialNavIcon} aria-hidden />
        </button>
      </div>
    </div>
  );
}
