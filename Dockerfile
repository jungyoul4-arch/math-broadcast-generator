# ============================================
# math-broadcast-generator Dockerfile
# Node.js + Playwright + TeX Live + Ghostscript
# ============================================

# --- Stage 1: Build ---
FROM node:20-bookworm AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Stage 2: Production ---
FROM node:20-bookworm-slim AS runner

# 시스템 패키지: Playwright Chromium 의존성 + TeX Live + Ghostscript + 한글 폰트
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Playwright Chromium 런타임 의존성
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    libxshmfence1 libx11-xcb1 libdbus-1-3 \
    # Ghostscript (PDF → 투명 PNG)
    ghostscript \
    # TeX Live (XeLaTeX + TikZ + 한글)
    texlive-xetex \
    texlive-latex-extra \
    texlive-pictures \
    texlive-fonts-recommended \
    texlive-lang-korean \
    fonts-nanum \
    fontconfig \
    # 유틸리티
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -fv

# Playwright Chromium 브라우저 설치
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright@1.58.2 install chromium

WORKDIR /app

# 환경변수 (Linux 경로)
ENV NODE_ENV=production
ENV LATEX_PATH=/usr/bin
ENV GS_PATH=/usr/bin/gs
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# standalone 빌드 결과물 복사
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# serverExternalPackages로 지정된 패키지는 standalone에 포함 안 됨 — 수동 복사
COPY --from=builder /app/node_modules/playwright ./node_modules/playwright
COPY --from=builder /app/node_modules/playwright-core ./node_modules/playwright-core
COPY --from=builder /app/node_modules/sharp ./node_modules/sharp
COPY --from=builder /app/node_modules/@img ./node_modules/@img

# public 폴더 복사
COPY --from=builder /app/public ./public

# data 초기 파일 복사 (Volume 마운트 시 Volume 내용이 우선됨)
# Volume이 비어있을 때만 초기 데이터로 사용
COPY --from=builder /app/data ./data-init

# 시작 스크립트: Volume이 비어있으면 초기 데이터 복사 후 서버 시작
RUN echo '#!/bin/sh\n\
if [ ! -f /app/data/users.json ]; then\n\
  echo "Volume empty — copying initial data..."\n\
  cp -r /app/data-init/* /app/data/ 2>/dev/null || true\n\
  mkdir -p /app/data/libraries\n\
fi\n\
exec node server.js' > /app/start.sh && chmod +x /app/start.sh

EXPOSE 3000

CMD ["/app/start.sh"]
