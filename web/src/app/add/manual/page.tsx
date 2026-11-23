"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookForm } from "@/components/BookForm";
import { takeDraft } from "@/lib/draft";
import { newBook } from "@/lib/model";

/** A new book typed in by hand, starting from whatever the search left as a draft. */
export default function ManualPage() {
  const router = useRouter();
  const [initial] = useState(() => takeDraft() ?? newBook({ title: "" }));
  return <BookForm initial={initial} isNew backHref="/add" onSaved={(id) => router.push(`/book?id=${id}`)} />;
}
