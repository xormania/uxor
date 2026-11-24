FROM mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579
WORKDIR /opt/uxor-browser
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY run.mjs capture.mjs ./
USER pwuser
ENTRYPOINT ["node", "run.mjs", "bundled"]
