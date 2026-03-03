"use client";

import { useState, useRef } from "react";
import { UploadCloud, FileAudio, CheckCircle, Copy, Check } from "lucide-react";
import styles from "./Uploader.module.css";
import ReactMarkdown from "react-markdown";

const STEPS = [
    { id: 0, label: "Preparing" },
    { id: 1, label: "Uploading" },
    { id: 2, label: "Transcribing" },
    { id: 3, label: "Summarizing" },
    { id: 4, label: "Creating Digest" },
];

export default function Uploader() {
    const [file, setFile] = useState<File | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [transcript, setTranscript] = useState<string | null>(null);
    const [result, setResult] = useState<string | null>(null);
    const [digest, setDigest] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [language, setLanguage] = useState<string>("English");
    const [activeTab, setActiveTab] = useState<"digest" | "summary" | "transcript">("digest");
    const [copied, setCopied] = useState(false);
    const [currentStep, setCurrentStep] = useState(-1);
    const [stepLabel, setStepLabel] = useState("");
    const [elapsedTime, setElapsedTime] = useState(0);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const droppedFile = e.dataTransfer.files[0];
            if (droppedFile.type.startsWith('audio/')) {
                setFile(droppedFile);
                setError(null);
            } else {
                setError("Please upload a valid audio file.");
            }
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setFile(e.target.files[0]);
            setError(null);
        }
    };

    const startTimer = () => {
        setElapsedTime(0);
        timerRef.current = setInterval(() => {
            setElapsedTime(prev => prev + 1);
        }, 1000);
    };

    const stopTimer = () => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    };

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return m > 0 ? `${m}m ${s}s` : `${s}s`;
    };

    const handleUpload = async () => {
        if (!file) return;

        setIsUploading(true);
        setError(null);
        setResult(null);
        setDigest(null);
        setTranscript(null);
        setActiveTab("digest");
        setCurrentStep(0);
        setStepLabel("Starting…");
        startTimer();

        const formData = new FormData();
        formData.append("audio", file);
        formData.append("language", language);

        try {
            const response = await fetch("/api/transcribe", {
                method: "POST",
                body: formData,
            });

            if (!response.ok || !response.body) {
                throw new Error("Transcription failed");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Parse SSE events from the buffer
                const lines = buffer.split("\n");
                buffer = lines.pop() || ""; // Keep incomplete line in buffer

                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        try {
                            const event = JSON.parse(line.slice(6));

                            if (event.type === "progress") {
                                if (event.step >= 0) {
                                    setCurrentStep(event.step);
                                }
                                setStepLabel(event.label);
                            } else if (event.type === "complete") {
                                setTranscript(event.transcript);
                                setResult(event.notes);
                                setDigest(event.digest);
                                setCurrentStep(5); // All done
                                setStepLabel("Complete!");
                            } else if (event.type === "error") {
                                throw new Error(event.error);
                            }
                        } catch (parseErr: any) {
                            if (parseErr.message && parseErr.message !== "Unexpected end of JSON input") {
                                throw parseErr;
                            }
                        }
                    }
                }
            }
        } catch (err: any) {
            setError(err.message || "An error occurred during transcription.");
            setCurrentStep(-1);
        } finally {
            setIsUploading(false);
            stopTimer();
        }
    };

    const resetUploader = () => {
        setFile(null);
        setTranscript(null);
        setResult(null);
        setDigest(null);
        setError(null);
        setActiveTab("digest");
        setCopied(false);
        setCurrentStep(-1);
        setStepLabel("");
        setElapsedTime(0);
    };

    const handleCopy = async () => {
        const text = activeTab === "digest" ? digest : activeTab === "summary" ? result : transcript;
        if (!text) return;
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className={styles.uploaderContainer}>
            {!result ? (
                <div className={styles.uploadSection}>
                    <div
                        className={`${styles.dropZone} ${isDragging ? styles.dragging : ''} ${file ? styles.hasFile : ''} glass-panel`}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={() => !file && fileInputRef.current?.click()}
                    >
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            accept="audio/*"
                            className={styles.hiddenInput}
                        />

                        {file ? (
                            <div className={styles.fileInfo}>
                                <FileAudio size={48} className={styles.fileIcon} />
                                <h3>{file.name}</h3>
                                <p>{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                                <button
                                    className={styles.removeBtn}
                                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                                    disabled={isUploading}
                                >
                                    Remove
                                </button>
                            </div>
                        ) : (
                            <div className={styles.prompt}>
                                <UploadCloud size={64} className={styles.uploadIcon} />
                                <h3>Drag & Drop your audio file here</h3>
                                <p>or click to browse from your device</p>
                                <span className={styles.formats}>Supports MP3, WAV, M4A, etc.</span>
                            </div>
                        )}
                    </div>

                    {error && <div className={styles.errorMsg}>{error}</div>}

                    {/* ── Progress Stepper ── */}
                    {isUploading && (
                        <div className={`${styles.progressContainer} glass-panel`}>
                            <div className={styles.progressHeader}>
                                <span className={styles.progressTitle}>Processing your audio</span>
                                <span className={styles.progressTimer}>{formatTime(elapsedTime)}</span>
                            </div>

                            <div className={styles.stepper}>
                                {STEPS.map((step) => {
                                    let state: "pending" | "active" | "done" = "pending";
                                    if (currentStep > step.id) state = "done";
                                    else if (currentStep === step.id) state = "active";

                                    return (
                                        <div
                                            key={step.id}
                                            className={`${styles.stepItem} ${styles[`step_${state}`]}`}
                                        >
                                            <div className={styles.stepIndicator}>
                                                {state === "done" ? (
                                                    <CheckCircle size={20} />
                                                ) : state === "active" ? (
                                                    <div className={styles.stepPulse} />
                                                ) : (
                                                    <div className={styles.stepDot} />
                                                )}
                                            </div>
                                            <span className={styles.stepLabel}>{step.label}</span>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className={styles.progressBar}>
                                <div
                                    className={styles.progressFill}
                                    style={{ width: `${Math.min((currentStep / STEPS.length) * 100, 100)}%` }}
                                />
                            </div>

                            <p className={styles.progressDetail}>{stepLabel}</p>
                        </div>
                    )}

                    <button
                        className={`${styles.submitBtn} ${!file || isUploading ? styles.disabled : ''}`}
                        onClick={handleUpload}
                        disabled={!file || isUploading}
                    >
                        {isUploading ? "Processing…" : "Generate Notes"}
                    </button>

                    <div className={styles.languageWrapper}>
                        <label htmlFor="language-select">Summary Language:</label>
                        <select
                            id="language-select"
                            className={`${styles.languageSelect} glass-panel`}
                            value={language}
                            onChange={(e) => setLanguage(e.target.value)}
                            disabled={isUploading}
                        >
                            <option value="English">English</option>
                            <option value="Chinese (Simplified)">中文 (简体)</option>
                            <option value="Chinese (Traditional)">中文 (繁體)</option>
                            <option value="Spanish">Español</option>
                            <option value="French">Français</option>
                            <option value="Japanese">日本語</option>
                            <option value="Korean">한국어</option>
                            <option value="German">Deutsch</option>
                        </select>
                    </div>
                </div>
            ) : (
                <div className={styles.resultSection}>
                    <div className={styles.successHeader}>
                        <CheckCircle size={32} className={styles.successIcon} />
                        <h2>Transcription Complete</h2>
                        <button className={styles.newUploadBtn} onClick={resetUploader}>
                            Upload Another
                        </button>
                    </div>

                    <div className={styles.tabBar}>
                        <button
                            className={`${styles.tabBtn} ${activeTab === "digest" ? styles.tabActive : ""}`}
                            onClick={() => setActiveTab("digest")}
                        >
                            Digest
                        </button>
                        <button
                            className={`${styles.tabBtn} ${activeTab === "summary" ? styles.tabActive : ""}`}
                            onClick={() => setActiveTab("summary")}
                        >
                            Summary Notes
                        </button>
                        <button
                            className={`${styles.tabBtn} ${activeTab === "transcript" ? styles.tabActive : ""}`}
                            onClick={() => setActiveTab("transcript")}
                        >
                            Full Transcript
                        </button>
                    </div>

                    <button className={styles.copyBtn} onClick={handleCopy} title="Copy as Markdown">
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                        {copied ? "Copied!" : "Copy Markdown"}
                    </button>

                    <div className={`${styles.notesContainer} ${styles.markdown} glass-panel`}>
                        <ReactMarkdown>
                            {activeTab === "digest" ? digest : activeTab === "summary" ? result : transcript}
                        </ReactMarkdown>
                    </div>
                </div>
            )}
        </div>
    );
}
