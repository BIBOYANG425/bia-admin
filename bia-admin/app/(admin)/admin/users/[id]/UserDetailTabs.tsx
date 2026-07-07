"use client";

// Client tab switcher for the user detail page. Receives both panes as
// server-rendered nodes and toggles which one is visible — the data fetching
// and markup stay on the server (the page component); only the active-tab
// state lives here.

import { useState, type ReactNode } from "react";

type Tab = "parcels" | "reviews";

export function UserDetailTabs({
  parcelsCount,
  reviewsUnavailable,
  reviewsCount,
  parcelsPane,
  reviewsPane,
}: {
  parcelsCount: number;
  reviewsUnavailable: boolean;
  reviewsCount: number;
  parcelsPane: ReactNode;
  reviewsPane: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("parcels");

  return (
    <>
      <div className="flex gap-2">
        <TabButton active={tab === "parcels"} onClick={() => setTab("parcels")}>
          包裹 · {parcelsCount}
        </TabButton>
        <TabButton active={tab === "reviews"} onClick={() => setTab("reviews")}>
          课评 · {reviewsUnavailable ? "—" : reviewsCount}
        </TabButton>
      </div>

      {tab === "parcels" ? parcelsPane : reviewsPane}
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-4 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-input bg-transparent text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}
