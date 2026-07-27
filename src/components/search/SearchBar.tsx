"use client";

import { useState } from "react";

export default function SearchBar() {
  const [search, setSearch] = useState("");

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();

    if (!search) return;

    window.location.href = `/?search=${search}`;
  }

  return (
    <form
      onSubmit={handleSearch}
      className="w-full max-w-xl"
    >
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar produtos..."
        className="w-full rounded-full border border-gray-300 px-6 py-3 text-gray-700 outline-none transition focus:border-green-600"
      />
    </form>
  );
}