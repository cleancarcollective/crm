"use client";

import { useState } from "react";
import { NewBookingModal } from "@/components/dashboard/NewBookingModal";

type Props = {
  defaultDate?: string; // yyyy-MM-dd
  label?: string;
  className?: string;
};

export function NewBookingButton({ defaultDate, label = "+ New Booking", className = "buttonPrimary" }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && <NewBookingModal defaultDate={defaultDate} onClose={() => setOpen(false)} />}
    </>
  );
}
