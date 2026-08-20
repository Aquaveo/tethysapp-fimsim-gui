// FIM-family footer. Partner logo strip joins once the images land in
// public/images (same set as FIMeval/FIMbench).
export default function Footer() {
  return (
    <footer className="fs-footer">
      <p className="fs-footer-text">
        Part of the{' '}
        <a href="https://sdml.ua.edu/" target="_blank" rel="noreferrer">
          FIM ecosystem
        </a>{' '}
        · Desktop FIMsim by{' '}
        <a href="https://github.com/pnikrou/FIMsim" target="_blank" rel="noreferrer">
          Parvaneh Nikrou
        </a>
      </p>
      <p className="fs-footer-text">CIROH · University of Alabama · SDML · BYU · Aquaveo</p>
    </footer>
  );
}
