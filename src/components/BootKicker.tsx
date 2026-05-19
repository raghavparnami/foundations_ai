"use client";
import { useEffect } from "react";

export default function BootKicker() {
  useEffect(() => {
    fetch("/api/ensure-setup", { method: "POST" }).catch(() => {});
  }, []);
  return null;
}
