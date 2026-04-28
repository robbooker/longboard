import Link from "next/link";
import { type ReactNode } from "react";
import "./command.css";
import CommandSubnav from "@/components/command/CommandSubnav";

export default function CommandLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="command-page">
      <div className="command-shell">
        <CommandSubnav />
        {children}
      </div>
    </div>
  );
}

