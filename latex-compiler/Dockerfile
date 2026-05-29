FROM debian:bookworm-slim

# TexLive on Debian uses proper sub-package names.
# texlive-latex-base  → pdflatex binary + article/book/report classes + amsmath
# texlive-latex-recommended → geometry, graphicx, hyperref, beamer, scrlttr2 (KOMA), etc.
# texlive-latex-extra → moderncv, beamer themes, and many community packages
# texlive-fonts-recommended → standard Type1 fonts (avoids missing-font errors)
# texlive-fonts-extra → fonts used by moderncv styles (e.g., FontAwesome)
# texlive-humanities → lingmacros/tree-dvips and related linguistics packages
# texlive-pictures → tikz/pgf used by beamer themes and many other packages
# texlive-bibtex-extra + biber → biblatex with biber backend (used by report-default)
# latexmk → orchestrator that handles multi-pass compiles (TOC, refs, citations)
# ghostscript → ps2pdf for latex -> dvips -> PDF workflows
RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-latex-base \
    texlive-latex-recommended \
    texlive-latex-extra \
    texlive-fonts-recommended \
    texlive-fonts-extra \
    texlive-humanities \
    texlive-pictures \
    texlive-bibtex-extra \
    biber \
    latexmk \
    ghostscript \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
# Install ALL deps first (tsc from devDependencies is needed for the build step)
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Non-root user for security
RUN groupadd --system compiler && useradd --system --gid compiler compiler
USER compiler

EXPOSE 9000
CMD ["node", "dist/index.js"]
