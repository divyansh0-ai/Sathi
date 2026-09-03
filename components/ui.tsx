export function PaneHeader({ label, hint, accent }: { label: string; hint?: string; accent?: boolean }) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-[#151a23] px-4 py-2.5">
      <h1
        className={`text-[10.5px] font-semibold uppercase tracking-[0.13em] ${
          accent ? "text-amber-300" : "text-[#6b7688]"
        }`}
      >
        {label}
      </h1>
      {hint && <span className="font-mono text-[10px] text-[#454f60]">{hint}</span>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-10 text-center text-[12px] leading-relaxed text-[#5b6474]">{children}</div>;
}
