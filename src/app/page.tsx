import styles from "./page.module.css";
import Uploader from "../components/Uploader";

export default function Home() {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Audio to Notes</h1>
        <p>
          Transform your voice recordings into beautifully formatted,
          intelligent notes using Gemini 2.5 Flash.
        </p>
      </header>

      <main className={styles.main}>
        <Uploader />
      </main>

      <footer className={styles.footer}>
        <p>Powered by Next.js and Google Gemini API</p>
      </footer>
    </div>
  );
}
