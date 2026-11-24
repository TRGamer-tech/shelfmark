"use client";

// Borrow requests have become loans. Whoever still has the old address is taken to them.

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Splash } from "@/components/Providers";

export default function OldRequestsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/friends/loans");
  }, [router]);
  return <Splash />;
}
