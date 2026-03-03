"use client";

import { useState, useEffect } from "react";

export default function Footer() {
    const [copyright, setCopyright] = useState("");

    useEffect(() => {
        fetch("/copyright.txt")
            .then((r) => r.text())
            .then((t) => setCopyright(t.trim()))
            .catch(() => setCopyright(""));
    }, []);

    return (
        <footer
            style={{
                textAlign: "center",
                padding: "24px 16px",
                color: "var(--text-secondary)",
                fontSize: "0.85rem",
                opacity: 0.6,
                display: "flex",
                flexDirection: "column",
                gap: "4px",
            }}
        >
            <p>Powered by Next.js and Google Gemini API</p>
            {copyright && <p>{copyright}</p>}
        </footer>
    );
}
