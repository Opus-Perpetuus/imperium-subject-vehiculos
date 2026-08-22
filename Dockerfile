# syntax=docker/dockerfile:1.4
FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json ./
COPY --from=kit . /opt/kit
RUN mkdir -p /app/vendor \
  && cp -a /opt/kit /app/vendor/kit \
  && sed -i 's|"file:../../kit"|"file:./vendor/kit"|g' package.json \
  && bun install --production

FROM oven/bun:1.3-alpine
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/Opus-Perpetuus/imperium-subject-vehiculos"
LABEL org.opencontainers.image.url="https://github.com/Opus-Perpetuus/imperium-subject-vehiculos"
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/vendor ./vendor
COPY --from=deps /app/package.json ./package.json
COPY manifest.json VERSION ./
COPY src ./src
ENV PORT=3000 \
    SUBJECT_TECHNICAL_ID=subject-vehiculos \
    KIRLET_TECHNICAL_ID=subject-vehiculos \
    DATA_DIR=/data \
    SUBJECT_AUTH=on \
    KIRLET_AUTH=on
RUN mkdir -p /data/files && chown -R bun:bun /data /app
USER bun
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=3s --retries=5 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "run", "src/server.ts"]
