"use client";

import { useState, useRef } from "react";
import { UploadCloud, FileAudio, Loader2, CheckCircle, Copy, Check } from "lucide-react";
import styles from "./Uploader.module.css";
import ReactMarkdown from "react-markdown";

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

    const fileInputRef = useRef<HTMLInputElement>(null);

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

    const handleUpload = async () => {
        if (!file) return;

        setIsUploading(true);
        setError(null);
        setResult(null);
        setDigest(null);
        setTranscript(null);
        setActiveTab("digest");

        const formData = new FormData();
        formData.append("audio", file);
        formData.append("language", language);

        try {
            const response = await fetch("/api/transcribe", {
                method: "POST",
                body: formData,
            });

            if (!response.ok) {
                throw new Error("Transcription failed");
            }

            const data = await response.json();
            setTranscript(data.transcript);
            setResult(data.notes);
            setDigest(data.digest);
        } catch (err: any) {
            setError(err.message || "An error occurred during transcription.");
        } finally {
            setIsUploading(false);
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

                    <button
                        className={`${styles.submitBtn} ${!file || isUploading ? styles.disabled : ''}`}
                        onClick={handleUpload}
                        disabled={!file || isUploading}
                    >
                        {isUploading ? (
                            <>
                                <Loader2 className={styles.spinner} size={20} />
                                Processing (This may take a minute)...
                            </>
                        ) : (
                            "Generate Notes"
                        )}
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
