import React, { useState, useEffect, useRef } from "react";

interface ImageWithPlaceholderProps {
  src: string;
  alt: string;
  className?: string;
  placeholderClassName?: string;
}

export default function ImageWithPlaceholder({
  src,
  alt,
  className = "",
  placeholderClassName = "",
}: ImageWithPlaceholderProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const imgRef = useRef<HTMLDivElement>(null);

  // Intersection Observer for lazy loading
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true);
            observer.disconnect(); // Load once and stop observing
          }
        });
      },
      {
        rootMargin: "100px", // Load 100px before visible
        threshold: 0.01,
      }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={imgRef} className="relative w-full h-full">
      {/* Placeholder */}
      {!isLoaded && !hasError && (
        <div
          className={`absolute inset-0 bg-surface animate-pulse flex items-center justify-center ${placeholderClassName}`}
        >
          <div className="w-8 h-8 border-2 border-border border-t-accent rounded-full animate-spin" />
        </div>
      )}

      {/* Image - only load when in view */}
      {isInView && (
        <img
          src={src}
          alt={alt}
          className={`transition-opacity duration-300 ${
            isLoaded ? "opacity-100" : "opacity-0"
          } ${className}`}
          onLoad={() => setIsLoaded(true)}
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.style.display = "none";
            setHasError(true);
          }}
          style={{ display: hasError ? "none" : undefined }}
        />
      )}
    </div>
  );
}