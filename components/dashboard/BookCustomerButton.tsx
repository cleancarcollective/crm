"use client";

import { useState } from "react";

import {
  NewBookingModal,
  type InitialContact,
  type InitialVehicle,
} from "@/components/dashboard/NewBookingModal";

type Props = {
  contact: InitialContact;
  vehicle?: InitialVehicle | null;
  label?: string;
  className?: string;
};

/**
 * Sales-flow shortcut: launches the standard NewBookingModal pre-filled
 * with the contact (and optionally their primary vehicle) so the rep
 * doesn't have to search for the customer they're already on the page of.
 */
export function BookCustomerButton({
  contact,
  vehicle,
  label = "Book this customer →",
  className = "buttonPrimary",
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <NewBookingModal
          onClose={() => setOpen(false)}
          initialContact={contact}
          initialVehicle={vehicle ?? null}
        />
      )}
    </>
  );
}
