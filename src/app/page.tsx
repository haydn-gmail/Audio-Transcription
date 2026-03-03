import styles from "./page.module.css";
import Uploader from "../components/Uploader";
import Footer from "../components/Footer";

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

      <Footer />
    </div>
  );
}

