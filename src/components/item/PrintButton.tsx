"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded bg-blue-600 px-6 py-2 font-medium text-white print:hidden"
    >
      印刷
    </button>
  );
}
