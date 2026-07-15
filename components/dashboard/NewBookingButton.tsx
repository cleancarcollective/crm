"use client";

import { useEffect, useState, type ReactNode } from "react";
import { NewBookingModal } from "@/components/dashboard/NewBookingModal";
import { prefetchPricing } from "@/lib/pricingClient";

type Props = {
  defaultDate?: string; // yyyy-MM-dd
  label?: ReactNode;
  className?: string;
};

export function NewBookingButton({ defaultDate, label = "+ New Booking", className = "buttonPrimary" }: Props) {
  const [open, setOpen] = useState(false);

  // Warm the pricing catalogue (and the serverless function) on mount so
  // the modal opens instantly instead of paying a cold-start on click.
  useEffect(() => { prefetchPricing(); }, []);

  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && <NewBookingModal defaultDate={defaultDate} onClose={() => setOpen(false)} />}
    </>
  );
}
